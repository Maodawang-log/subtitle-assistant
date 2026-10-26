// Independent study service-worker entry. No old background / prefetch / AI
// overview entry is imported. Importing registers listeners, never a request.
import { bgFetchJson } from "../bilibili/gateway-core.js";
import { readStudyPageJsonResult, type StudyWireFailure } from "./messaging.js";

export const STUDY_LOCAL_ORIGIN = "http://127.0.0.1:18766";
type Sender = { id?: string; tab?: { id?: number }; url?: string };
type Reply = (response: unknown) => void;
type WireError = StudyWireFailure;
interface Pending { controller: AbortController; tabId?: number; remoteId: string; local: boolean }
interface ProxyDependencies {
  extensionId: string;
  fetchImpl?: typeof fetch;
  legacyFetchJson?: (url: string) => Promise<unknown>;
  mainWorldFetch?: (tabId: number, url: string, requestId: string) => Promise<unknown>;
  mainWorldCancel?: (tabId: number, requestId: string) => Promise<void>;
}
const errorReply = (code: string, message: string): WireError => ({ ok: false, error: { code, message } });

interface StudyScripting {
  executeScript(options: { target: { tabId: number }; world: "MAIN";
    func: (...args: string[]) => unknown; args: string[] }): Promise<Array<{ result?: unknown }>>;
}
// Only API JSON uses the page's logged-in request context. Function arguments
// come from the SW URL allowlist; this does not inspect Cookie or page tokens.
async function mainWorldFetch(tabId: number, url: string, requestId: string): Promise<unknown> {
  const scripting = chrome.scripting as unknown as StudyScripting;
  const results = await scripting.executeScript({ target: { tabId }, world: "MAIN", args: [url, requestId],
    func: async (requestUrl: string, id: string) => {
      type Entry = { controller?: AbortController; cancelled?: boolean; expires: number };
      const host = globalThis as unknown as { __BILISCRIPT_STUDY_FETCHES__?: Record<string, Entry> };
      const entries = host.__BILISCRIPT_STUDY_FETCHES__ ||= Object.create(null) as Record<string, Entry>;
      for (const key of Object.keys(entries)) if (entries[key].expires < Date.now()) delete entries[key];
      if (entries[id]?.cancelled) return { ok: false };
      const controller = new AbortController();
      entries[id] = { controller, expires: Date.now() + 60000 };
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(requestUrl, { credentials: "include", cache: "no-store",
          redirect: "error", signal: controller.signal });
        if (!response.ok) return { ok: false };
        const data: unknown = await response.json();
        return controller.signal.aborted ? { ok: false } : { ok: true, data };
      } catch { return { ok: false }; }
      finally { clearTimeout(timeout); delete entries[id]; }
    }
  });
  const result = readStudyPageJsonResult(results[0]?.result);
  if (!result.ok) throw new Error("Page JSON request failed");
  return result.data;
}
async function mainWorldCancel(tabId: number, requestId: string): Promise<void> {
  const scripting = chrome.scripting as unknown as StudyScripting;
  await scripting.executeScript({ target: { tabId }, world: "MAIN", args: [requestId], func: (id: string) => {
    type Entry = { controller?: AbortController; cancelled?: boolean; expires: number };
    const host = globalThis as unknown as { __BILISCRIPT_STUDY_FETCHES__?: Record<string, Entry> };
    const entries = host.__BILISCRIPT_STUDY_FETCHES__ ||= Object.create(null) as Record<string, Entry>;
    entries[id]?.controller?.abort();
    // A cancel injection can overtake a fetch injection. Keep a bounded tombstone
    // so that late fetch cannot start after the user has disabled the video.
    entries[id] = { cancelled: true, expires: Date.now() + 60000 };
    for (const key of Object.keys(entries)) if (entries[key].expires < Date.now()) delete entries[key];
  } });
}

export function isStudyBiliJsonUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (url.hostname === "api.bilibili.com") {
      return ["/x/web-interface/view", "/x/player/v2", "/x/player/wbi/v2", "/x/player/playurl"].includes(url.pathname);
    }
    return url.hostname.endsWith(".hdslb.com") && url.pathname.startsWith("/bfs/") && url.pathname.endsWith(".json");
  } catch { return false; }
}
function audioUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "upos-hz-mirrorakam.akamaized.net" ||
        ["bilivideo.com", "bilivideo.cn"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)));
  } catch { return false; }
}
function windowPayload(raw: unknown, requestId: string): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!audioUrl(p.audio_url) || typeof p.bvid !== "string" || !/^BV[0-9A-Za-z]+$/.test(p.bvid) ||
      typeof p.cid !== "string" || !/^\d+$/.test(p.cid) ||
      typeof p.start !== "number" || !Number.isFinite(p.start) || p.start < 0 ||
      typeof p.duration !== "number" || !Number.isFinite(p.duration) || p.duration <= 0 || p.duration > 30 ||
      (p.language !== undefined && p.language !== "ja") ||
      (p.model !== undefined && (typeof p.model !== "string" || !/^[A-Za-z0-9][\w.-]{0,63}$/.test(p.model)))) return null;
  const backups = p.backup_urls === undefined ? [] : p.backup_urls;
  if (!Array.isArray(backups) || backups.length > 8 || !backups.every(audioUrl)) return null;
  // Explicit projection: never forward Cookie, Authorization, API keys, arbitrary
  // endpoint URLs or future message fields into the local service.
  return { request_id: requestId, audio_url: p.audio_url, backup_urls: backups,
    bvid: p.bvid, cid: p.cid, start: p.start, duration: p.duration,
    language: "ja", model: p.model || "small" };
}

function localServiceError(data: unknown): WireError | null {
  const error = (data as { error?: unknown } | null)?.error;
  if (!error) return null;
  const raw = error as { code?: unknown; message?: unknown };
  const code = /^[\w-]{1,40}$/.test(String(raw.code)) ? String(raw.code) : "SERVICE";
  // The loopback service uses fixed messages, never native CDN exceptions.
  // Also redact URL-bearing/overlong text if an incompatible service is running.
  const message = typeof raw.message === "string" && raw.message.length <= 300 && !/https?:\/\//i.test(raw.message)
    ? raw.message : "本地日语服务未完成这段音频识别";
  return errorReply(`LOCAL_${code}`, message);
}

export function createStudyProxy(deps: ProxyDependencies) {
  const fetchImpl = deps.fetchImpl || fetch;
  const legacyFetch = deps.legacyFetchJson || bgFetchJson;
  const pageFetch = deps.mainWorldFetch || mainWorldFetch;
  const pageCancel = deps.mainWorldCancel || mainWorldCancel;
  const pending = new Map<string, Pending>();
  const cancelled = new Map<string, number>();
  const owner = (sender: Sender) => sender.tab?.id === undefined ? "extension" : String(sender.tab.id);
  const keyOf = (sender: Sender, id: string) => `${owner(sender)}:${id}`;
  function rememberCancel(key: string) {
    const now = Date.now();
    for (const [id, time] of cancelled) if (now - time > 60000) cancelled.delete(id);
    cancelled.set(key, now);
    if (cancelled.size > 512) cancelled.delete(cancelled.keys().next().value!);
  }
  async function cancelRemote(remoteId: string) {
    try {
      await fetchImpl(`${STUDY_LOCAL_ORIGIN}/v1/audio/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-BiliScript-Consumer": "study-extension" },
        body: JSON.stringify({ request_id: remoteId }), credentials: "omit", cache: "no-store",
        signal: AbortSignal.timeout(5000)
      });
    } catch { /* A stopped service or already finished worker needs no retry. */ }
  }
  function cancelOwned(key: string, local: boolean) {
    rememberCancel(key);
    const task = pending.get(key);
    task?.controller.abort();
    if (task && !task.local && task.tabId !== undefined) void pageCancel(task.tabId, key).catch(() => {});
    if (task?.local || local) void cancelRemote(task?.remoteId || key);
  }
  function cancelTab(tabId: number) {
    for (const [key, task] of pending) {
      if (task.tabId === tabId) cancelOwned(key, task.local);
    }
  }
  function handle(raw: unknown, sender: Sender, reply: Reply): boolean {
    if (!raw || typeof raw !== "object") return false;
    const message = raw as Record<string, unknown>;
    if (!["study-local-asr", "study-bili-request", "study-bili-cancel", "fetch-json"].includes(String(message.type))) return false;
    if (!deps.extensionId || sender.id !== deps.extensionId) {
      reply(errorReply("SENDER", "请求来源不是当前扩展")); return false;
    }
    if (message.type === "fetch-json") {
      if (!isStudyBiliJsonUrl(message.url)) { reply({ ok: false, error: "Unsupported Bilibili JSON URL" }); return false; }
      // Actual upstream transport used by asr/audio-source -> contentFetchJson.
      // Keep its old string-error response contract and avoid logging signed URLs.
      const request = sender.tab?.id !== undefined && new URL(message.url).hostname === "api.bilibili.com"
        ? pageFetch(sender.tab.id, message.url, `legacy:${globalThis.crypto.randomUUID()}`)
        : legacyFetch(message.url);
      void request.then((data) => reply({ ok: true, data }), () => reply({ ok: false, error: "Bilibili JSON request failed" }));
      return true;
    }
    const id = message.requestId;
    if (typeof id !== "string" || !/^[\w-]{1,80}$/.test(id)) { reply(errorReply("REQUEST_ID", "请求标识无效")); return false; }
    const key = keyOf(sender, id);
    const local = message.type === "study-local-asr";
    if (message.type === "study-bili-cancel" || (local && message.action === "cancel")) {
      cancelOwned(key, local); reply({ ok: true, data: { cancelled: true } }); return false;
    }
    if (cancelled.has(key)) { reply(errorReply("ABORTED", "请求已取消")); return false; }
    if (pending.has(key)) { reply(errorReply("DUPLICATE", "请求标识已在使用")); return false; }
    let url: string;
    let init: RequestInit;
    if (local) {
      if (message.action === "health") {
        url = `${STUDY_LOCAL_ORIGIN}/health`; init = { method: "GET" };
      } else if (message.action === "window") {
        const body = windowPayload(message.payload, key);
        if (!body) { reply(errorReply("PAYLOAD", "音频窗口参数无效")); return false; }
        url = `${STUDY_LOCAL_ORIGIN}/v1/audio/window`;
        init = { method: "POST", headers: { "Content-Type": "application/json", "X-BiliScript-Consumer": "study-extension" }, body: JSON.stringify(body) };
      } else { reply(errorReply("ACTION", "不支持的本地服务操作")); return false; }
      init.credentials = "omit";
    } else {
      if (!isStudyBiliJsonUrl(message.url)) { reply(errorReply("URL", "不支持的 B 站字幕地址")); return false; }
      url = message.url;
      // The upstream transport has no AbortSignal parameter; this narrow route
      // adds real cancellation while retaining the same Bilibili credentials.
      init = { method: "GET", credentials: "include", referrer: "https://www.bilibili.com/",
        referrerPolicy: "strict-origin-when-cross-origin", headers: { Accept: "application/json, text/plain, */*" } };
    }
    const task: Pending = { controller: new AbortController(), tabId: sender.tab?.id, remoteId: key, local };
    // Register synchronously before fetch/await: an immediately following cancel
    // can always reach the window, including startup and server queue time.
    pending.set(key, task);
    init.signal = task.controller.signal;
    init.cache = "no-store";
    // Reject redirects instead of allowing a validated URL to reach another host.
    init.redirect = "error";
    void (async () => {
      try {
        let data: unknown;
        if (!local && task.tabId !== undefined && new URL(url).hostname === "api.bilibili.com") {
          data = await pageFetch(task.tabId, url, key);
        } else {
          const response = await fetchImpl(url, init);
          if (!response.ok) throw new Error("HTTP");
          data = await response.json();
        }
        reply(task.controller.signal.aborted ? errorReply("ABORTED", "请求已取消") :
          (local ? localServiceError(data) : null) || { ok: true, data });
      } catch {
        // Never return native fetch error text: it can include a signed CDN URL.
        reply(task.controller.signal.aborted ? errorReply("ABORTED", "请求已取消") :
          errorReply("FETCH", local ? "本地日语服务请求失败，请检查服务状态" : "B 站字幕请求失败，请重试"));
      } finally {
        if (pending.get(key) === task) pending.delete(key);
      }
    })();
    return true;
  }
  return { handle, cancelTab };
}

// MV3 listeners are registered synchronously. No startup probe or audio request.
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  const extensionId = new URL(chrome.runtime.getURL("")).hostname;
  const proxy = createStudyProxy({ extensionId });
  chrome.runtime.onMessage.addListener(proxy.handle);
  type TabEvents = { onRemoved?: { addListener(fn: (tabId: number) => void): void };
    onUpdated?: { addListener(fn: (tabId: number, change: { status?: string; url?: string }) => void): void } };
  const tabs = chrome.tabs as unknown as TabEvents | undefined;
  tabs?.onRemoved?.addListener(proxy.cancelTab);
  tabs?.onUpdated?.addListener((tabId, change) => {
    if (change.status === "loading" || change.url) proxy.cancelTab(tabId);
  });
}
