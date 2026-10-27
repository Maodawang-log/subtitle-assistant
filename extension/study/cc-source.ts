// Passive CC adapter: importing this module never starts a request. The study
// controller calls it only after the user enables the current video.
import { fetchVideoMeta, fetchSubtitleBundle, type SubtitleTrack } from "../bilibili/gateway.js";
import { computeCurrentClipSignature, extractBvid, extractPageIndex } from "../bilibili/video-id-shared.js";
import { isSourceTrack, sourceLanguageName, type SourceLanguage } from "./source-language.js";
import { sendStudyMessage } from "./messaging.js";

export interface StudyCue { from: number; to: number; content: string }
export interface JapaneseCcResult {
  status: "ready" | "no-japanese" | "no-source";
  bvid: string;
  cid: string;
  title: string;
  duration?: number;
  tracks: SubtitleTrack[];
  cues: StudyCue[];
  chineseCues?: StudyCue[];
  chineseWarning?: string;
  selectedTrackId?: string;
}
export class StudyCcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "StudyCcError";
  }
}
export interface JapaneseCcOptions {
  language?: SourceLanguage;
  signal: AbortSignal;
  onStatus?: (message: string) => void;
  preferredTrackId?: string;
  includeChinese?: boolean;
}
export interface CcSourceDependencies {
  currentUrl(): string;
  fetchJson(url: string, signal: AbortSignal): Promise<unknown>;
}

function aborted(): DOMException { return new DOMException("字幕请求已取消", "AbortError"); }
// A separate cancellable route keeps the upstream legacy fetch-json contract
// intact for getSourceAudioUrl. Neither route accepts arbitrary network hosts.
export function fetchStudyBiliJson(url: string, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) return Promise.reject(aborted());
  const requestId = globalThis.crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(value);
    };
    const onAbort = () => {
      // Cancellation has its own message, so it does not wait behind the request.
      void sendStudyMessage({ type: "study-bili-cancel", requestId }).catch(() => {});
      finish(aborted());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void sendStudyMessage({ type: "study-bili-request", requestId, url }).then((response) => {
      if (signal.aborted) return finish(aborted());
      if (!response.ok) {
        finish(new StudyCcError(response.error.code, response.error.message));
      } else finish(undefined, response.data);
    }, (error) => finish(error));
  });
}

export function isJapaneseTrack(track: Pick<SubtitleTrack, "lan">): boolean {
  return /^(?:ai-)?(?:ja|jp)(?:[-_]|$)/i.test(track.lan);
}
function isChineseTrack(track: SubtitleTrack): boolean { return /^(?:ai-)?zh(?:[-_]|$)/i.test(track.lan); }

function cueBody(payload: unknown): StudyCue[] {
  const body = (payload as { body?: unknown })?.body;
  if (!Array.isArray(body)) throw new StudyCcError("INVALID_SUBTITLE", "字幕接口未返回有效正文");
  const cues = body.flatMap((raw) => {
    const row = raw as { from?: unknown; to?: unknown; content?: unknown };
    const from = Number(row?.from), to = Number(row?.to);
    const content = typeof row?.content === "string" ? row.content.trim() : "";
    return Number.isFinite(from) && from >= 0 && Number.isFinite(to) && to > from && content
      ? [{ from, to, content }] : [];
  }).sort((a, b) => a.from - b.from);
  if (!cues.length) throw new StudyCcError("EMPTY_SUBTITLE", "这条字幕轨没有可用正文");
  return cues;
}

export function createJapaneseCcSource(deps: CcSourceDependencies) {
  return async function getJapaneseCc(options: JapaneseCcOptions): Promise<JapaneseCcResult> {
    const { signal, language = "ja" } = options;
    const name = sourceLanguageName(language);
    const initialUrl = deps.currentUrl();
    const parsed = new URL(initialUrl);
    const bvid = extractBvid(initialUrl);
    const pageIndex = extractPageIndex(initialUrl);
    const signature = computeCurrentClipSignature(initialUrl);
    const requestedPage = Number(parsed.searchParams.get("p") || "1");
    if (parsed.hostname !== "www.bilibili.com" || !bvid || !Number.isInteger(requestedPage) || requestedPage < 1) {
      throw new StudyCcError("VIDEO_ID", "当前页面没有可验证的 B 站视频身份");
    }
    const guard = () => {
      const current = new URL(deps.currentUrl());
      if (signal.aborted || current.hostname !== parsed.hostname ||
          !Number.isInteger(Number(current.searchParams.get("p") || "1")) ||
          computeCurrentClipSignature(current.href) !== signature) throw aborted();
    };
    const status = (message: string) => { guard(); options.onStatus?.(message); };
    const transport = async (url: string) => {
      guard();
      const value = await deps.fetchJson(url, signal);
      guard();
      if (/\/x\/player\/(?:wbi\/)?v2\?/.test(url)) {
        const payload = value as { code?: number; data?: { subtitle?: { subtitles?: unknown } } };
        if (payload?.code === 0 && !Array.isArray(payload.data?.subtitle?.subtitles)) {
          throw new StudyCcError("INVALID_TRACK_LIST", "字幕接口未返回有效轨道列表");
        }
      }
      return value;
    };
    guard();
    status("正在读取当前分P信息…");
    // Reuse upstream metadata parsing and subtitle-list failover, rather than
    // importing its prefetch / subtitle-accept / overview orchestration.
    const meta = await fetchVideoMeta(transport, bvid);
    guard();
    const page = meta.pages.find((item) => item.page === pageIndex);
    // Never silently fall back to P1 for an invalid/unknown P index.
    const cid = page?.cid || (pageIndex === 1 && meta.pages.length === 0 ? meta.defaultCid : "");
    if (!/^\d+$/.test(cid)) throw new StudyCcError("PAGE_ID", "无法确认当前分P的 CID，请重试");
    const title = pageIndex > 1 && page?.part ? `${meta.title} · ${page.part}` : meta.title;
    status(`正在检查${name}字幕轨…`);
    const { tracks } = await fetchSubtitleBundle(transport, { bvid, cid, aid: meta.aid });
    guard();
    const japanese = tracks.filter(track => isSourceTrack(track, language));
    const preferred = options.preferredTrackId
      ? japanese.find((track) => track.id === options.preferredTrackId) : undefined;
    if (options.preferredTrackId && !preferred) {
      throw new StudyCcError("TRACK", `所选${name}字幕轨已不可用`);
    }
    const selected = preferred || japanese.find((track) => !/^ai-/i.test(track.lan)) || japanese[0];
    const result: JapaneseCcResult = { status: selected ? "ready" : language === "ja" ? "no-japanese" : "no-source", bvid, cid, title, duration:page?.duration || (pageIndex===1?meta.defaultDuration:0) || undefined, tracks, cues: [] };
    if (!selected) return result; // Chinese-only CC is never relabelled or back-translated.
    status(`正在读取${name}字幕…`);
    result.cues = cueBody(await transport(selected.subtitleUrl));
    result.selectedTrackId = selected.id;
    if (options.includeChinese) {
      const chinese = tracks.find((track) => isChineseTrack(track));
      if (chinese) {
        try {
          result.chineseCues = cueBody(await transport(chinese.subtitleUrl));
        } catch (error) {
          // The Japanese track is already usable. A failed optional reference
          // track must not discard it, while cancellation still ends the run.
          guard();
          if ((error as { name?: unknown })?.name === "AbortError") throw error;
          result.chineseCues = [];
          result.chineseWarning = `中文字幕暂不可用，已保留${name}原文`;
        }
      }
    }
    guard();
    return result;
  };
}

export const getJapaneseCc = createJapaneseCcSource({
  currentUrl: () => location.href,
  fetchJson: fetchStudyBiliJson
});
