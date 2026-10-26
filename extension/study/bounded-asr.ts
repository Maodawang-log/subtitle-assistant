// Explicitly enabled, playback-window ASR. Audio bytes are fetched and decoded by
// the loopback service; HTMLMediaElement.buffered is never used as byte data.
// This controller owns no global state and never calls the upstream whole-track
// pipeline. The owner must stop it when the video changes or learning is disabled.
import { getSourceAudioUrl } from "../asr/audio-source.js";
import type { AudioSource } from "../asr/audio-source.js";
import { fetchStudyBiliJson } from "./cc-source.js";
import { createChromeStudyAudioCache, type StudyAudioCacheStore } from "./study-audio-cache.js";
import { repairAsrSegments } from "./cue-revisions.js";
import { sendStudyMessage, type StudyAudioWindowPayload, type StudyAsrWindowMessage, type StudyAsrCancelMessage } from "./messaging.js";

export const STUDY_ASR_CHUNK_SECONDS = 30;
export const STUDY_ASR_AHEAD_SECONDS = 60;
export const STUDY_ASR_DEFAULT_MODEL = "small";

export interface StudyAudioCue {
  from: number;
  to: number;
  content: string;
}

export interface StudyAsrStart {
  // Omission is deliberately the same as false. Merely creating the controller
  // or visiting a video page must not fetch audio or start a local model.
  enabled?: boolean;
  bvid: string;
  cid: string | number;
  currentTime: number;
  duration?: number;
  // Only the owner that verified MAIN-page BV/CID and the exact played audio
  // URL may supply this snapshot. It is session memory, never persisted.
  validatedAudioSource?: StudyValidatedAudioSource;
  // Mandatory for a validated snapshot. This is the current playable/preview
  // limit, not the video's nominal full duration or a buffered time range.
  playableDuration?: number;
  language?: string;
  model?: string;
  resourceId?: string | number;
}

export interface StudyValidatedAudioSource {
  url: string;
  backupUrls: string[];
}

export interface StudyAsrCueMeta {
  bvid: string;
  cid: string;
  language: string;
  model: string;
  resourceId?: string | number;
  windowStart: number;
  duration: number;
  cached: boolean;
}

export interface StudyAsrStatus {
  phase: "disabled" | "loading-source" | "waiting" | "transcribing" | "ready" | "error";
  message: string;
  bvid?: string;
  cid?: string;
  resourceId?: string | number;
  windowStart?: number;
  duration?: number;
}

export type StudyAudioWindow = StudyAudioWindowPayload;
export type StudyAsrMessage = StudyAsrWindowMessage | StudyAsrCancelMessage;

export type StudyAsrMessageSender = (message: StudyAsrMessage) => Promise<unknown>;

export interface BoundedAsrOptions {
  // Incremental results: the owner merges these by video/window identity. A
  // session/resource guard also prevents late callbacks after stop or seek.
  onCues: (cues: StudyAudioCue[], meta: StudyAsrCueMeta) => void;
  onStatus?: (status: StudyAsrStatus) => void;
  // Supply the current video time to advance the window automatically, or call
  // updateTime from timeupdate. seek additionally cancels obsolete work now.
  getCurrentTime?: () => number;
  getAudioSource?: (video: { bvid: string; cid: string }, signal: AbortSignal) => Promise<AudioSource>;
  requestWindow?: (window: StudyAudioWindow, signal: AbortSignal) => Promise<unknown>;
  cacheLimit?: number;
  // Default: chrome.storage.local, 64 text windows, LRU. null disables disk
  // storage; an injected store can supply a different persistence host.
  cacheStore?: StudyAudioCacheStore | null;
}

export interface BoundedAsrController {
  start(input: StudyAsrStart): void;
  stop(): void;
  seek(time: number, validatedAudioSource?: StudyValidatedAudioSource): void;
  updateTime(time: number): void;
}

interface WindowSlot {
  start: number;
  duration: number;
  key: string;
}

interface Session {
  bvid: string;
  cid: string;
  language: string;
  model: string;
  resourceId?: string | number;
  currentTime: number;
  duration?: number;
  source?: AudioSource;
  validatedSource: boolean;
  sourceAbort: AbortController;
  delivered: Set<string>;
  failed: Map<string, string>;
}

interface ActiveWindow {
  session: Session;
  slot: WindowSlot;
  abort: AbortController;
}

function abortError(): Error {
  const error = new Error("已停止语音识别");
  error.name = "AbortError";
  return error;
}

// Each request has its own cancellation identity. Aborting rejects immediately
// and sends an explicit cancellation through the SW to the loopback worker; a
// detached Chrome message Promise by itself would not stop audio/model work.
export function requestStudyAudioWindow(
  payload: StudyAudioWindow,
  signal: AbortSignal,
  send?: StudyAsrMessageSender
): Promise<unknown> {
  if (signal.aborted) return Promise.reject(abortError());
  const requestId = `study-asr-${crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, data?: unknown): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(data);
    };
    const cancel = (): void => {
      // Cancellation is best effort if the extension context has already gone
      // away, but the controller has still stopped queuing and delivering work.
      void sendStudyMessage({ type: "study-local-asr", action: "cancel", requestId }, send).catch(() => {});
      finish(abortError());
    };
    signal.addEventListener("abort", cancel, { once: true });
    void sendStudyMessage({ type: "study-local-asr", action: "window", requestId, payload }, send).then(
      (response) => {
        if (!response.ok) {
          finish(new Error(response.error.message));
          return;
        }
        finish(null, response.data);
      },
      (error) => finish(error)
    );
  });
}

export function studyAudioCacheKey(input: {
  bvid: string;
  cid: string;
  language: string;
  model: string;
  start: number;
  duration: number;
}): string {
  return JSON.stringify([input.bvid, input.cid, input.language, input.model, input.start, input.duration]);
}

// The service contract uses absolute video seconds. Reject an ambiguous origin
// rather than guessing and silently adding the window offset twice.
export function normalizeStudyAudioCues(raw: unknown, slot: { start: number; duration: number }): StudyAudioCue[] {
  const data = raw as { timestamp_origin?: unknown; segments?: unknown } | null;
  if (data?.timestamp_origin !== "absolute" || !Array.isArray(data.segments)) {
    throw new Error("本地语音服务未返回绝对时间轴字幕");
  }
  const cues: StudyAudioCue[] = [];
  const end = slot.start + slot.duration;
  for (const value of data.segments) {
    const segment = value as { start?: unknown; end?: unknown; text?: unknown } | null;
    const from = Number(segment?.start);
    const to = Number(segment?.end);
    const content = String(segment?.text || "").trim();
    if (!Number.isFinite(from) || !Number.isFinite(to) || !content || to <= from) continue;
    const clippedFrom = Math.max(slot.start, from);
    const clippedTo = Math.min(end, to);
    if (clippedTo > clippedFrom) cues.push({ from: clippedFrom, to: clippedTo, content });
  }
  return repairAsrSegments(cues);
}

function readableError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error || "识别失败");
  // Do not show or log expiring CDN URLs, including their signed query strings.
  return text.replace(/https?:\/\/[^\s]+/gi, "[音轨地址]").slice(0, 240);
}

export function createBoundedAsrController(options: BoundedAsrOptions): BoundedAsrController {
  const getAudioSource = options.getAudioSource || ((video, signal) =>
    getSourceAudioUrl(video, (url) => fetchStudyBiliJson(url, signal)));
  const requestWindow = options.requestWindow || requestStudyAudioWindow;
  const cacheLimit = Math.max(2, Math.min(128, Math.floor(options.cacheLimit || 64)));
  const cacheStore = options.cacheStore === null ? undefined : options.cacheStore || createChromeStudyAudioCache(cacheLimit);
  const cache = new Map<string, StudyAudioCue[]>();
  let cacheReady: Promise<void> | undefined;
  let cacheWrites = Promise.resolve();
  let session: Session | undefined;
  let active: ActiveWindow | undefined;
  let queue: WindowSlot[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastStatus = "";

  function status(phase: StudyAsrStatus["phase"], message: string, owner = session, slot?: WindowSlot): void {
    const next: StudyAsrStatus = {
      phase,
      message,
      ...(owner ? { bvid: owner.bvid, cid: owner.cid, resourceId: owner.resourceId } : {}),
      ...(slot ? { windowStart: slot.start, duration: slot.duration } : {})
    };
    const signature = JSON.stringify(next);
    if (signature === lastStatus) return;
    lastStatus = signature;
    options.onStatus?.(next);
  }

  function stop(): void {
    // Clear the owner before aborting: even a late or non-cooperative transport
    // cannot cache/emit an old video's response or schedule the next window.
    const previousSession = session;
    session = undefined;
    queue = [];
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    const previous = active;
    active = undefined;
    previous?.abort.abort();
    previousSession?.sourceAbort.abort();
    if (previousSession) previousSession.source = undefined;
    status("disabled", "日语学习已关闭");
  }

  function desired(owner: Session): WindowSlot[] {
    if (owner.duration !== undefined && owner.currentTime >= owner.duration) return [];
    const start = Math.floor(owner.currentTime / STUDY_ASR_CHUNK_SECONDS) * STUDY_ASR_CHUNK_SECONDS;
    const end = Math.min(start + STUDY_ASR_AHEAD_SECONDS, owner.duration ?? Infinity);
    const slots: WindowSlot[] = [];
    // Current + next 30-second window. Their furthest end is never later than
    // playbackTime + 60 seconds, and there is only one in-flight audio request.
    for (let at = start; at < end; at += STUDY_ASR_CHUNK_SECONDS) {
      const duration = Math.min(STUDY_ASR_CHUNK_SECONDS, end - at);
      slots.push({ start: at, duration, key: studyAudioCacheKey({ ...owner, start: at, duration }) });
    }
    return slots;
  }

  function deliver(owner: Session, slot: WindowSlot, cues: StudyAudioCue[], cached: boolean): void {
    if (session !== owner || owner.delivered.has(slot.key)) return;
    owner.delivered.add(slot.key);
    options.onCues(cues.map((cue) => ({ ...cue })), {
      bvid: owner.bvid,
      cid: owner.cid,
      language: owner.language,
      model: owner.model,
      resourceId: owner.resourceId,
      windowStart: slot.start,
      duration: slot.duration,
      cached
    });
  }

  function putCache(key: string, cues: StudyAudioCue[], persist = true): void {
    cache.delete(key);
    cache.set(key, cues);
    while (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
    if (persist && cacheStore) {
      const entries = [...cache].map(([entryKey, entryCues]) => ({ key: entryKey, cues: entryCues }));
      // Serialize snapshots so a slow earlier write cannot replace newer LRU
      // state. Storage failure does not turn successful speech recognition into
      // a failure or trigger audio downloads again in this session.
      cacheWrites = cacheWrites.catch(() => {}).then(() => cacheStore.write(entries)).catch(() => {});
    }
  }

  function loadCache(): Promise<void> {
    if (!cacheReady) {
      cacheReady = cacheStore ? cacheStore.read().then((entries) => {
        for (const entry of entries.slice(-cacheLimit)) putCache(entry.key, entry.cues, false);
      }).catch(() => {}) : Promise.resolve();
    }
    return cacheReady;
  }

  function plan(owner: Session): void {
    if (session !== owner || !owner.source) return;
    const slots = desired(owner);
    queue = [];
    for (const slot of slots) {
      const hit = cache.get(slot.key);
      if (hit) {
        putCache(slot.key, hit);
        deliver(owner, slot, hit, true);
      } else if (!owner.failed.has(slot.key) && active?.slot.key !== slot.key) {
        queue.push(slot);
      }
    }
    pump(owner);
  }

  function pump(owner: Session): void {
    if (session !== owner || active || !owner.source) return;
    const slot = queue.shift();
    if (!slot) {
      const current = desired(owner)[0];
      const failure = current && owner.failed.get(current.key);
      if (failure) status("error", `当前片段识别失败：${failure}。关闭后重新开启可重试。`, owner, current);
      else if (current && cache.has(current.key)) status("ready", "当前播放窗口字幕已准备，等待播放推进", owner, current);
      else if (owner.duration !== undefined && owner.currentTime >= owner.duration) status("ready", "已到达当前可播放范围，未请求范围外音频", owner);
      else status("waiting", "等待可识别的播放片段", owner);
      return;
    }
    const job: ActiveWindow = { session: owner, slot, abort: new AbortController() };
    active = job;
    const current = desired(owner)[0];
    const isCurrentReady = current && cache.has(current.key);
    status(isCurrentReady ? "transcribing" : "waiting", isCurrentReady
      ? "正在识别后续片段…"
      : "正在识别当前播放位置，字幕生成后会显示，请稍候…", owner, slot);
    void requestWindow({
      audio_url: owner.source.url!,
      backup_urls: owner.source.backupUrls.slice(0, 3),
      bvid: owner.bvid,
      cid: owner.cid,
      start: slot.start,
      duration: slot.duration,
      language: owner.language,
      model: owner.model
    }, job.abort.signal).then((raw) => {
      if (session !== owner || job.abort.signal.aborted) return;
      const cues = normalizeStudyAudioCues(raw, slot);
      putCache(slot.key, cues);
      deliver(owner, slot, cues, false);
    }).catch((error: unknown) => {
      if (session !== owner || job.abort.signal.aborted) return;
      owner.failed.set(slot.key, readableError(error));
      status("error", `片段识别失败：${readableError(error)}`, owner, slot);
    }).finally(() => {
      if (active !== job) return;
      active = undefined;
      if (session === owner) plan(owner);
    });
  }

  function updateTime(time: number): void {
    const owner = session;
    if (!owner || !Number.isFinite(time)) return;
    const next = Math.max(0, time);
    const oldAnchor = Math.floor(owner.currentTime / STUDY_ASR_CHUNK_SECONDS);
    owner.currentTime = next;
    const newAnchor = Math.floor(next / STUDY_ASR_CHUNK_SECONDS);
    if (oldAnchor === newAnchor) return;
    if (active && !desired(owner).some((slot) => slot.key === active?.slot.key)) {
      const previous = active;
      active = undefined;
      previous.abort.abort();
    }
    plan(owner);
  }

  function seek(time: number, validatedAudioSource?: StudyValidatedAudioSource): void {
    const owner = session;
    if (!owner || !Number.isFinite(time)) return;
    owner.currentTime = Math.max(0, time);
    queue = [];
    const previous = active;
    active = undefined;
    previous?.abort.abort();
    // An explicit seek may retry a failed target; ordinary time updates never
    // create an unbounded retry loop while playback is paused.
    for (const slot of desired(owner)) owner.failed.delete(slot.key);
    if (owner.validatedSource) {
      // A played-page URL is scoped to the validated playback snapshot. A real
      // seek cannot silently reuse it or fall back to a previously rejected API.
      // The UI normally stop()s, revalidates MAIN state, then start()s afresh.
      owner.source = undefined;
      owner.sourceAbort.abort();
      if (validatedAudioSource) acquireSource(owner, validatedAudioSource);
      else status("error", "播放位置已改变，请重新验证当前可播放音轨", owner);
      return;
    }
    plan(owner);
  }

  function acquireSource(owner: Session, supplied?: StudyValidatedAudioSource): void {
    owner.sourceAbort.abort();
    owner.sourceAbort = new AbortController();
    const attempt = owner.sourceAbort;
    owner.source = undefined;
    if (!desired(owner).length) {
      status("ready", "已到达当前可播放范围，未请求范围外音频", owner);
      return;
    }
    status("loading-source", supplied ? "正在准备已验证的当前播放音轨…" : "正在获取当前视频音轨…", owner);
    // A supplied URL bypasses only source discovery. The bounded window queue,
    // cancellation and text-only cache remain the same as the default path.
    let sourceRequest: Promise<AudioSource>;
    try {
      if (supplied) {
        if (typeof supplied.url !== "string" || !supplied.url.trim() || !Array.isArray(supplied.backupUrls)
          || !supplied.backupUrls.every((url) => typeof url === "string")) throw new Error("已验证的播放音轨无效");
        sourceRequest = Promise.resolve({ url: supplied.url, backupUrls: supplied.backupUrls.slice(0, 3) });
      } else sourceRequest = getAudioSource({ bvid: owner.bvid, cid: owner.cid }, attempt.signal);
    } catch (error) {
      sourceRequest = Promise.reject(error);
    }
    void Promise.all([sourceRequest, loadCache()]).then(([source]) => {
      if (session !== owner || owner.sourceAbort !== attempt || attempt.signal.aborted) return;
      if (typeof source.url !== "string" || !source.url.trim() || !Array.isArray(source.backupUrls)
        || !source.backupUrls.every((url) => typeof url === "string")) throw new Error("该视频没有可用音轨");
      // Copy the snapshot so later mutations of the owner's object cannot swap
      // the URL or backups while another window is queued.
      owner.source = { url: source.url, backupUrls: source.backupUrls.slice(0, 3) };
      plan(owner);
    }).catch((error: unknown) => {
      if (session !== owner || owner.sourceAbort !== attempt || attempt.signal.aborted) return;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      status("error", `无法取得音轨：${readableError(error)}`, owner);
    });
  }

  function start(input: StudyAsrStart): void {
    stop();
    if (input.enabled !== true) return;
    const bvid = String(input.bvid || "").trim();
    const cid = String(input.cid || "").trim();
    if (!bvid || !cid) {
      status("error", "无法取得当前视频身份，请重新开启学习");
      return;
    }
    const duration = Number(input.duration);
    const hasValidatedSource = input.validatedAudioSource !== undefined;
    const playableDuration = input.playableDuration;
    if ((hasValidatedSource || playableDuration !== undefined)
      && (typeof playableDuration !== "number" || !Number.isFinite(playableDuration) || playableDuration <= 0)) {
      status("error", "当前播放音轨缺少有效的可播放时长，未请求音频");
      return;
    }
    const durationLimit = Math.min(Number.isFinite(duration) && duration > 0 ? duration : Infinity, playableDuration ?? Infinity);
    const owner: Session = {
      bvid,
      cid,
      language: String(input.language || "ja").trim() || "ja",
      model: String(input.model || STUDY_ASR_DEFAULT_MODEL).trim() || STUDY_ASR_DEFAULT_MODEL,
      resourceId: input.resourceId,
      currentTime: Number.isFinite(input.currentTime) ? Math.max(0, input.currentTime) : 0,
      ...(Number.isFinite(durationLimit) ? { duration: durationLimit } : {}),
      validatedSource: hasValidatedSource,
      sourceAbort: new AbortController(),
      delivered: new Set(),
      failed: new Map()
    };
    session = owner;
    if (options.getCurrentTime) {
      timer = setInterval(() => {
        if (session !== owner) return;
        try { updateTime(options.getCurrentTime!()); } catch { /* The player may be tearing down. */ }
      }, 1000);
    }
    acquireSource(owner, input.validatedAudioSource);
  }

  return { start, stop, seek, updateTime };
}
