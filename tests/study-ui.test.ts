import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

const sources = vi.hoisted(() => ({
  cc: vi.fn(),
  asrOptions: undefined as any,
  asr: { start: vi.fn(), stop: vi.fn(), seek: vi.fn(), updateTime: vi.fn() }
}));
vi.mock("../extension/study/cc-source.js", () => ({ getJapaneseCc: sources.cc }));
vi.mock("../extension/study/bounded-asr.js", () => ({
  createBoundedAsrController: (options: unknown) => { sources.asrOptions = options; return sources.asr; }
}));

const normalUrl = "https://www.bilibili.com/video/BV1ab411c7mD/";
const identity = "BV1ab411c7mD:111";
const japanese = [
  { from: 1, to: 3, content: "最初の文です。" },
  { from: 3, to: 6, content: "次の文です。" },
  { from: 30, to: 33, content: "遠くの文です。" },
  { from: 33, to: 36, content: "遠くの次です。" }
];
const readyCc = () => ({ status: "ready", bvid: "BV1ab411c7mD", cid: "111", title: "日本語",
  cues: japanese, chineseCues: [{ from: 1, to: 3, content: "这是第一句。" }], tracks: [], selectedTrackId: "1" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

let video: HTMLVideoElement;
let time: number;
let paused: boolean;
let shadow: ShadowRoot;
let send: ReturnType<typeof vi.fn>;
let listeners: Array<(message: any, sender: unknown, reply: (response: any) => void) => unknown>;
let windowEvents: Array<Parameters<typeof window.addEventListener>> = [];
let documentEvents: Array<Parameters<typeof document.addEventListener>> = [];
let settings: { autoStart: boolean; autoTranslate: boolean; configured: boolean };
let ai: (message: any) => Promise<unknown>;
let nativeSource: () => Promise<unknown>;
let mediaSrc: string;

function element<T extends HTMLElement = HTMLElement>(id: string): T { return shadow.getElementById(id) as T; }
async function click(id: string) { element(id).click(); await flush(); }
async function sync() { await vi.advanceTimersByTimeAsync(250); await flush(); }
function aiCalls() { return send.mock.calls.map(([message]) => message).filter((message) => message.type === "study-ai"); }
function nativeCalls() { return send.mock.calls.map(([message]) => message).filter((message) => message.type === "study-native-source"); }
function readyNative(patch: Record<string, unknown> = {}) {
  const playableDuration = typeof patch.playableDuration === "number" ? patch.playableDuration : 30;
  return {
    status: "ready", bvid: "BV1ab411c7mD", cid: "111", title: "实际播放音轨", duration: 300, playableDuration,
    subtitleListPresent: true, japaneseTrackCount: 0,
    source: { url: "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/111/audio.m4s?test=original", backupUrls: [] },
    binding: { documentId: "test-document", timeOrigin: 1000, routeKey: "BV1ab411c7mD:p1", routeEpoch: 1,
      videoGeneration: 1, videoTag: video.getAttribute("data-biliscript-study-binding"), mediaSrc },
    audit: { exactUrlMatch: true, responseStatus: 206, requestStart: 300, epochStart: 100, videoEpoch: 200,
      cidPathMatch: true, previewSeconds: playableDuration, host: "upos-hz-mirrorakam.akamaized.net" },
    ...patch
  };
}
function emitAsr(cues: unknown[], start = 0, duration = 30, resourceId = identity) {
  sources.asrOptions.onCues(cues, { bvid: "BV1ab411c7mD", cid: "111", language: "ja", model: "small", resourceId,
    windowStart: start, duration, cached: false });
}
async function runtimeMessage(message: unknown) {
  const responses: unknown[] = [];
  for (const listener of listeners) listener(message, {}, (response) => responses.push(response));
  await flush();
  return responses[0] as any;
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  sources.cc.mockReset();
  sources.cc.mockResolvedValue(readyCc());
  Object.values(sources.asr).forEach((mock) => mock.mockReset());
  sources.asrOptions = undefined;
  history.replaceState({}, "", normalUrl);
  document.body.innerHTML = '<div class="bpx-player-container"><video></video></div>';
  document.getElementById("biliscript-japanese-study")?.remove();
  document.getElementById("biliscript-study-overlay")?.remove();
  video = document.querySelector("video")!;
  video.setAttribute("data-biliscript-study-binding", "native-video-1");
  mediaSrc = "blob:https://www.bilibili.com/test-media";
  time = 1.5;
  paused = true;
  Object.defineProperties(video, {
    currentTime: { configurable: true, get: () => time, set: (value: number) => {
      time = value;
      // Browsers deliver seeking asynchronously for Player.play/tick writes too.
      queueMicrotask(() => video.dispatchEvent(new Event("seeking")));
    } },
    duration: { configurable: true, get: () => 300 },
    currentSrc: { configurable: true, get: () => mediaSrc },
    paused: { configurable: true, get: () => paused }
  });
  video.play = vi.fn(async () => { paused = false; });
  video.pause = vi.fn(() => { paused = true; });
  settings = { autoStart: false, autoTranslate: false, configured: false };
  listeners = [];
  ai = async () => ({ ok: true, text: "中文译文" });
  nativeSource = async () => ({ status: "unavailable", reason: "TEST", message: "未建立关联" });
  send = vi.fn(async (message: any) => {
    if (message.type === "study-settings-public") return { ok: true, config: settings };
    if (message.type === "study-ai") return ai(message);
    if (message.type === "study-native-source") return nativeSource();
    if (message.action === "studyOpenRecorder") return { success: true };
    return { ok: true };
  });
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: send, getURL: (path: string) => `chrome-extension://test/${path}`,
      onMessage: { addListener: (listener: typeof listeners[number]) => listeners.push(listener) } },
    storage: { local: createMemoryStorageArea() }
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("kuromoji", { builder: () => ({ build: (callback: (error: unknown, tokenizer: unknown) => void) => callback(null, {
    tokenize: (text: string) => [{ surface_form: text, basic_form: text, pos: "名詞", reading: text }]
  }) }) });
  // Exercise the actual classic script shared with the shipped UI, including
  // its Player implementation; do not replace seeking logic with a test double.
  const coreSource = readFileSync("extension/study/core.js", "utf8");
  vi.stubGlobal("JSTUDY", new Function(`${coreSource}\nreturn JSTUDY;`)());
  windowEvents = [];
  documentEvents = [];
  const windowAdd = window.addEventListener.bind(window);
  const documentAdd = document.addEventListener.bind(document);
  vi.spyOn(window, "addEventListener").mockImplementation(((...args: Parameters<typeof window.addEventListener>) => {
    windowEvents.push(args); windowAdd(...args);
  }) as typeof window.addEventListener);
  vi.spyOn(document, "addEventListener").mockImplementation(((...args: Parameters<typeof document.addEventListener>) => {
    documentEvents.push(args); documentAdd(...args);
  }) as typeof document.addEventListener);
  await import("../extension/study/content.js");
  await flush();
  shadow = document.getElementById("biliscript-japanese-study")!.shadowRoot!;
});

afterEach(() => {
  for (const [type, listener, options] of windowEvents) window.removeEventListener(type, listener, options);
  for (const [type, listener, options] of documentEvents) document.removeEventListener(type, listener, options);
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.getElementById("biliscript-japanese-study")?.remove();
  document.getElementById("biliscript-study-overlay")?.remove();
});

describe("opt-in learning UI integration", () => {
  it("starts disabled and performs no subtitle, audio or AI requests", async () => {
    await sync();
    expect(element("enable").textContent).toBe("开启学习");
    expect(sources.cc).not.toHaveBeenCalled();
    expect(sources.asr.start).not.toHaveBeenCalled();
    expect(aiCalls()).toEqual([]);
    expect(nativeCalls()).toEqual([]);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith("chrome-extension://test/"))).toBe(true);
    expect(document.getElementById("biliscript-study-overlay")).toBeNull();
  });

  it("renders real Japanese and paired Chinese inside the player and clears the overlay on close", async () => {
    await click("enable");
    await sync();
    const overlay = document.querySelector(".bpx-player-container > #biliscript-study-overlay")!;
    expect(overlay.shadowRoot!.querySelector(".ja")!.textContent).toContain("最初の文です。");
    expect(overlay.shadowRoot!.querySelector(".zh")!.textContent).toBe("这是第一句。");
    expect(sources.asr.start).not.toHaveBeenCalled();
    await click("enable");
    expect(document.getElementById("biliscript-study-overlay")).toBeNull();
    expect(sources.asr.stop).toHaveBeenCalled();
  });

  it("aborts an in-flight CC request and remains off after SPA video or P changes", async () => {
    const pending = deferred<any>();
    sources.cc.mockReturnValue(pending.promise);
    await click("enable");
    const signal = sources.cc.mock.calls[0][0].signal as AbortSignal;
    history.replaceState({}, "", normalUrl + "?p=2");
    await sync();
    expect(signal.aborted).toBe(true);
    expect(element("enable").textContent).toBe("开启学习");
    pending.resolve(readyCc());
    await flush();
    expect(element("current").textContent).toContain("开启后");
    expect(sources.asr.start).not.toHaveBeenCalled();
    expect(sources.cc).toHaveBeenCalledTimes(1);
  });

  it("keeps programmatic replay alive until the sentence end and keeps loop enabled across owned seeks", async () => {
    await click("enable");
    await click("replay");
    expect(paused).toBe(false);
    time = 3.1; // Natural playback progress, not a user seek.
    await sync();
    expect(paused).toBe(true);
    expect(time).toBeCloseTo(2.985);
    await click("loop");
    expect(element("loop").getAttribute("aria-pressed")).toBe("true");
    time = 3.1;
    await sync();
    expect(time).toBe(1);
    expect(paused).toBe(false);
    expect(element("loop").getAttribute("aria-pressed")).toBe("true");
    video.currentTime = 30.5; // Genuine user jump cancels sentence looping.
    await flush();
    expect(element("loop").getAttribute("aria-pressed")).toBe("false");
  });

  it("waits for unrecognized ASR windows, resumes a recognized silent lead-in and ignores obsolete resource results", async () => {
    sources.cc.mockResolvedValue({ ...readyCc(), status: "no-japanese", cues: [], chineseCues: [] });
    time = 0;
    paused = false;
    await click("enable");
    expect(sources.asr.start).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, currentTime: 0, resourceId: identity }));
    expect(paused).toBe(true);
    emitAsr([{ from: 1, to: 3, content: "最初の文です。" }]);
    await flush();
    expect(paused).toBe(false); // Window ready even though no speech at t=0.
    expect(element("current").textContent).not.toContain("准备中");
    time = 31;
    await sync();
    expect(paused).toBe(true); // Natural progress must also wait for a slow next window.
    expect(element("current").textContent).toContain("准备中");
    emitAsr([], 30, 30); // A genuinely silent window is still ready to play.
    await flush();
    expect(paused).toBe(false);
    history.replaceState({}, "", normalUrl + "?p=2");
    await sync();
    emitAsr([{ from: 31, to: 32, content: "obsolete" }], 30);
    expect(element("current").textContent).not.toContain("obsolete");
    expect(element("enable").textContent).toBe("开启学习");
  });

  it("seeks ASR to the new playback window, resumes only after that window is ready and stops on close", async () => {
    sources.cc.mockResolvedValue({ ...readyCc(), status: "no-japanese", cues: [], chineseCues: [] });
    paused = false;
    await click("enable");
    emitAsr(japanese.slice(0, 2));
    await flush();
    video.currentTime = 95;
    await flush();
    expect(sources.asr.seek).toHaveBeenLastCalledWith(95);
    expect(paused).toBe(true);
    emitAsr([{ from: 31, to: 33, content: "not the target" }], 30);
    await flush();
    expect(paused).toBe(true);
    emitAsr([{ from: 94, to: 97, content: "目的の文です。" }], 90);
    await flush();
    expect(paused).toBe(false);
    expect(element("current").textContent).toContain("目的の文です。");
    await click("enable");
    const stops = sources.asr.stop.mock.calls.length;
    await sync();
    expect(sources.asr.stop).toHaveBeenCalledTimes(stops);
    expect(document.getElementById("biliscript-study-overlay")).toBeNull();
  });

  it("keeps ASR replay seeks within recognized windows without cancelling the decoder or pausing a silent gap", async () => {
    sources.cc.mockResolvedValue({ ...readyCc(), status: "no-japanese", cues: [], chineseCues: [] });
    paused = false;
    await click("enable");
    emitAsr(japanese.slice(0, 2));
    await flush();
    expect(paused).toBe(false);
    await click("replay");
    expect(sources.asr.seek).not.toHaveBeenCalled();
    time = 3.1;
    await sync();
    expect(paused).toBe(true);
    expect(sources.asr.seek).not.toHaveBeenCalled();
    await video.play();
    time = 10; // Silent gap within the already recognized 0–30 second window.
    await sync();
    expect(paused).toBe(false);
    expect(element("current").textContent).not.toContain("准备中");
    expect(sources.asr.seek).not.toHaveBeenCalled();
  });

  it("lets the user continue playback after an ASR error instead of pausing again on every timer tick", async () => {
    sources.cc.mockResolvedValue({ ...readyCc(), status: "no-japanese", cues: [], chineseCues: [] });
    paused = false;
    await click("enable");
    expect(paused).toBe(true);
    sources.asrOptions.onStatus({ phase: "error", message: "本地服务不可用" });
    await video.play();
    await sync();
    await sync();
    expect(paused).toBe(false);
    expect(element("status").textContent).toContain("本地服务不可用");
  });

  it("automatically translates only the current and next sentence and never queues the next after close", async () => {
    settings.autoTranslate = true;
    settings.configured = true;
    const pending = deferred<unknown>();
    ai = () => pending.promise;
    sources.cc.mockResolvedValue({ ...readyCc(), chineseCues: [] });
    await click("enable");
    expect(aiCalls().map((message) => message.text)).toEqual([japanese[0].content]);
    await click("enable");
    pending.resolve({ ok: true, text: "迟到的译文" });
    await flush();
    await sync();
    expect(aiCalls()).toHaveLength(1);
    expect(element("chinese").textContent).not.toContain("迟到");
    expect(document.getElementById("biliscript-study-overlay")).toBeNull();
  });

  it("limits successful automatic translation to the current sentence and one next sentence", async () => {
    settings.autoTranslate = true;
    settings.configured = true;
    sources.cc.mockResolvedValue({ ...readyCc(), chineseCues: [] });
    await click("enable");
    await sync();
    await sync();
    expect(aiCalls().map((message) => message.text)).toEqual([japanese[0].content, japanese[1].content]);
  });

  it("recomputes automatic translation candidates after a user jump instead of queuing the old next sentence", async () => {
    settings.autoTranslate = true;
    settings.configured = true;
    sources.cc.mockResolvedValue({ ...readyCc(), chineseCues: [] });
    const first = deferred<unknown>();
    ai = (message) => message.text === japanese[0].content ? first.promise : Promise.resolve({ ok: true, text: "译文" });
    await click("enable");
    video.currentTime = 30.5;
    await flush();
    first.resolve({ ok: true, text: "旧请求结果" });
    await flush();
    await sync();
    expect(aiCalls().map((message) => message.text)).not.toContain(japanese[1].content);
    expect(aiCalls().map((message) => message.text)).toContain(japanese[2].content);
    expect(aiCalls().map((message) => message.text)).toContain(japanese[3].content);
  });

  it("drops stale translation candidates after natural playback advances during a slow AI response", async () => {
    settings.autoTranslate = true;
    settings.configured = true;
    sources.cc.mockResolvedValue({ ...readyCc(), chineseCues: [] });
    const first = deferred<unknown>();
    ai = (message) => message.text === japanese[0].content ? first.promise : Promise.resolve({ ok: true, text: "译文" });
    await click("enable");
    time = 30.5;
    await sync();
    first.resolve({ ok: true, text: "旧请求结果" });
    await flush();
    await sync();
    expect(aiCalls().map((message) => message.text)).not.toContain(japanese[1].content);
    expect(aiCalls().map((message) => message.text)).toContain(japanese[2].content);
    expect(aiCalls().map((message) => message.text)).toContain(japanese[3].content);
  });

  it("binds recorder references to the active BV/CID and rejects references after switching the video", async () => {
    await click("enable");
    await click("record");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "studyOpenRecorder", resource: identity,
      cue: expect.objectContaining({ start: 1, end: 3, text: japanese[0].content }) }));
    expect(await runtimeMessage({ action: "studyPlayReference", resource: "BVother:222", cue: { start: 1, end: 3 } })).toMatchObject({ success: false });
    expect(await runtimeMessage({ action: "studyPlayReference", resource: identity, cue: { start: 1, end: 3 }, command: "play" })).toMatchObject({ success: true });
    history.replaceState({}, "", normalUrl + "?p=2");
    await sync();
    expect(await runtimeMessage({ action: "studyPlayReference", resource: identity, cue: { start: 1, end: 3 }, command: "play" })).toMatchObject({ success: false });
  });
});

describe("validated native-audio UI integration", () => {
  it("uses a verified empty Japanese track list to start bounded ASR with the native source and preview cap", async () => {
    const snapshot = readyNative();
    nativeSource = async () => snapshot;
    await click("enable");
    expect(nativeCalls()).toHaveLength(1);
    expect(sources.cc).not.toHaveBeenCalled();
    expect(sources.asr.start).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true, bvid: "BV1ab411c7mD", cid: "111", currentTime: 1.5,
      duration: 300, playableDuration: 30, validatedAudioSource: snapshot.source, resourceId: identity
    }));
  });

  it("ends native recognition at the preview cap without pausing for an impossible next window and preserves an outside-seek error", async () => {
    nativeSource = async () => readyNative();
    paused = false;
    await click("enable");
    emitAsr(japanese.slice(0, 2), 0, 30);
    await flush();
    expect(paused).toBe(false);
    const pauses = vi.mocked(video.pause).mock.calls.length;
    const stops = sources.asr.stop.mock.calls.length;
    time = 30;
    await sync();
    expect(vi.mocked(video.pause)).toHaveBeenCalledTimes(pauses);
    expect(paused).toBe(false);
    expect(sources.asr.stop).toHaveBeenCalledTimes(stops + 1);
    expect(sources.asr.start).toHaveBeenCalledTimes(1);
    expect(nativeCalls()).toHaveLength(1);
    expect(sources.cc).not.toHaveBeenCalled();
    expect(element("status").textContent).toContain("允许的识别范围");
    expect(element("current").textContent).not.toContain("准备中");
    expect(document.getElementById("biliscript-study-overlay")).toBeNull();

    nativeSource = async () => ({ status: "unavailable", reason: "PREVIEW_END", message: "跳转已超出试看范围" });
    video.currentTime = 35;
    await flush();
    expect(element("status").textContent).toBe("跳转已超出试看范围");
    await video.play();
    await sync();
    await sync();
    expect(element("status").textContent).toBe("跳转已超出试看范围");
    expect(paused).toBe(false);
    expect(sources.asr.start).toHaveBeenCalledTimes(1);
    expect(nativeCalls()).toHaveLength(2);
    expect(sources.cc).not.toHaveBeenCalled();
  });

  it.each([
    { subtitleListPresent: false, japaneseTrackCount: 0 },
    { subtitleListPresent: true, japaneseTrackCount: 1 }
  ])("keeps the CC path when the native list is unknown or includes Japanese: %j", async (list) => {
    nativeSource = async () => readyNative(list);
    await click("enable");
    expect(sources.cc).toHaveBeenCalledTimes(1);
    expect(sources.asr.start).not.toHaveBeenCalled();
    expect(element("current").textContent).toContain(japanese[0].content);
  });

  it.each(["PREVIEW_END", "PREVIEW_UNKNOWN"])("does not downgrade preview denial %s to ordinary ASR when CC has no Japanese", async (reason) => {
    nativeSource = async () => ({ status: "unavailable", reason, message: "当前试看范围无法继续识别" });
    sources.cc.mockResolvedValue({ ...readyCc(), status: "no-japanese", cues: [], chineseCues: [] });
    await click("enable");
    expect(sources.cc).toHaveBeenCalledTimes(1);
    expect(sources.asr.start).not.toHaveBeenCalled();
    await sync();
    expect(sources.asr.start).not.toHaveBeenCalled();
    expect(element("status").textContent).toContain("当前试看范围无法继续识别");
  });

  it("uses the validated source and preview cap when an unknown native list is followed by CC confirming no Japanese", async () => {
    const snapshot = readyNative({ subtitleListPresent: false, japaneseTrackCount: 0 });
    nativeSource = async () => snapshot;
    sources.cc.mockResolvedValue({ ...readyCc(), status: "no-japanese", cues: [], chineseCues: [] });
    await click("enable");
    expect(sources.cc).toHaveBeenCalledTimes(1);
    expect(sources.asr.start).toHaveBeenCalledTimes(1);
    expect(sources.asr.start).toHaveBeenCalledWith(expect.objectContaining({
      bvid: "BV1ab411c7mD", cid: "111", playableDuration: 30, validatedAudioSource: snapshot.source
    }));
  });

  it("stops immediately on a real seek, waits for fresh association and starts with the refreshed preview cap", async () => {
    nativeSource = async () => readyNative();
    await click("enable");
    const fresh = deferred<unknown>();
    const order: string[] = [];
    sources.asr.stop.mockImplementation(() => { order.push("stop"); });
    nativeSource = () => { order.push("snapshot"); return fresh.promise; };
    video.currentTime = 10;
    await flush();
    expect(order).toEqual(["stop", "snapshot"]);
    expect(sources.asr.start).toHaveBeenCalledTimes(1);
    expect(sources.asr.seek).not.toHaveBeenCalled();
    expect(element("current").textContent).toContain("准备中");
    video.setAttribute("data-biliscript-study-binding", "native-video-2");
    const snapshot = readyNative({ playableDuration: 45,
      source: { url: "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/111/audio.m4s?test=fresh", backupUrls: [] } });
    fresh.resolve(snapshot);
    await flush();
    expect(sources.asr.start).toHaveBeenCalledTimes(2);
    expect(sources.asr.start).toHaveBeenLastCalledWith(expect.objectContaining({
      currentTime: 10, playableDuration: 45, validatedAudioSource: snapshot.source
    }));
    expect(sources.cc).not.toHaveBeenCalled();
  });

  it.each(["close", "page"])("ignores a late opening snapshot after %s", async (change) => {
    const late = deferred<unknown>();
    nativeSource = () => late.promise;
    await click("enable");
    if (change === "close") await click("enable");
    else {
      history.replaceState({}, "", normalUrl + "?p=2");
      await sync();
    }
    late.resolve(readyNative());
    await flush();
    expect(sources.asr.start).not.toHaveBeenCalled();
    expect(sources.cc).not.toHaveBeenCalled();
    expect(element("enable").textContent).toBe("开启学习");
  });

  it.each(["close", "page"])("ignores a late seek association after %s", async (change) => {
    nativeSource = async () => readyNative();
    await click("enable");
    const late = deferred<unknown>();
    nativeSource = () => late.promise;
    video.currentTime = 10;
    await flush();
    if (change === "close") await click("enable");
    else {
      history.replaceState({}, "", normalUrl + "?p=2");
      await sync();
    }
    late.resolve(readyNative({ playableDuration: 45 }));
    await flush();
    expect(sources.asr.start).toHaveBeenCalledTimes(1);
    expect(sources.cc).not.toHaveBeenCalled();
    expect(element("enable").textContent).toBe("开启学习");
  });

  it.each(["tag", "mediaSrc"])("stops the old audio session when the live video's binding %s changes", async (bindingPart) => {
    nativeSource = async () => readyNative();
    await click("enable");
    const stops = sources.asr.stop.mock.calls.length;
    if (bindingPart === "tag") video.setAttribute("data-biliscript-study-binding", "native-replaced-video");
    else mediaSrc = "blob:https://www.bilibili.com/replacement-media";
    await sync();
    expect(sources.asr.stop).toHaveBeenCalledTimes(stops + 1);
    expect(element("enable").textContent).toBe("开启学习");
    expect(element("status").textContent).toContain("播放器资源已更新");
    expect(nativeCalls()).toHaveLength(1);
    emitAsr([{ from: 1, to: 3, content: "old native result" }]);
    expect(element("current").textContent).not.toContain("old native result");
  });
});
