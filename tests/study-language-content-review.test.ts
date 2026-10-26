import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importStorageKey } from "../extension/study/source-language.js";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

const state = vi.hoisted(() => ({ cc: vi.fn(), asrStart: vi.fn(), asrStop: vi.fn(), asrOptions: null as any }));
vi.mock("../extension/study/cc-source.js", () => ({ getJapaneseCc: (options: any) => state.cc(options) }));
vi.mock("../extension/study/native-source.js", () => ({ getNativeStudySource: async () => ({ status: "unavailable", reason: "TEST" }), sameNativeBinding: () => false }));
vi.mock("../extension/study/bounded-asr.js", () => ({
  createBoundedAsrController: (options: any) => { state.asrOptions = options; return { start: state.asrStart, stop: state.asrStop, seek() {}, updateTime() {} }; },
  requestStudyAudioWindow: vi.fn()
}));
vi.mock("../extension/study/inline-recorder.js", () => ({ createInlineRecorder: () => ({ clear() {}, stop() {}, open() {} }) }));

const settingsKey = "biliscriptJapaneseSettings", url = "https://www.bilibili.com/video/BV1ab411c7mD/", identity = "BV1ab411c7mD:111";
const sourceText = { ja: "日本語の字幕。", en: "Hello, world!" };
let disk: Map<string, any>, area: ReturnType<typeof createMemoryStorageArea>, send: ReturnType<typeof vi.fn>, root: ShadowRoot;
let events: Array<[EventTarget, string, any, any]>, listeners: Array<(changes: any, area: string) => void>, aiReply: (message: any) => Promise<any>;
let defaultLanguage: "ja" | "en", route: string, tokenizerBuilder: ReturnType<typeof vi.fn>;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function flush() { for (let n = 0; n < 48; n++) await Promise.resolve(); }
const cue = (text: string) => ({ from: 1, to: 3, content: text });
const cc = (language: "ja" | "en") => ({ status: "ready", bvid: "BV1ab411c7mD", cid: "111", title: "fixture", tracks: [], cues: [cue(sourceText[language])] });
const find = (id: string) => (root.getElementById(id) || document.getElementById("biliscript-study-controls")?.shadowRoot?.getElementById(id)) as HTMLElement;
async function click(id: string) { find(id).click(); await flush(); }
async function changeLanguage(language: "ja" | "en") {
  (find("sourceLanguage") as HTMLSelectElement).value = language;
  find("sourceLanguage").dispatchEvent(new Event("change", { bubbles: true })); await flush();
}
const aiRequests = () => send.mock.calls.map(([m]) => m).filter(m => m.type === "study-ai");
async function mount() { await import("../extension/study/content.js"); await flush(); root = document.getElementById("biliscript-japanese-study")!.shadowRoot!; }
async function importFile(text: string | Promise<string>, name = "source.srt") {
  const input = find("subtitleFile") as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [{ name, size: 70, text: () => Promise.resolve(text) }] });
  input.dispatchEvent(new Event("change", { bubbles: true })); await flush();
}
const imported = (text: string, name = "saved.srt") => ({ identity, name, offset: 0, cues: [{ start: 1, end: 3, text }] });
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); events = []; listeners = []; defaultLanguage = "ja";
  state.cc.mockReset(); state.asrStart.mockReset(); state.asrStop.mockReset(); state.asrOptions = null;
  state.cc.mockImplementation(async options => cc(options.language || "ja"));
  history.replaceState({}, "", url);
  document.body.innerHTML = '<div class="bpx-player-container"><video></video></div>';
  const video = document.querySelector("video")!;
  Object.defineProperties(video, { currentTime: { configurable: true, writable: true, value: 1.5 }, duration: { configurable: true, value: 300 }, paused: { configurable: true, value: true } });
  video.pause = vi.fn(); video.play = vi.fn(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  disk = new Map([[settingsKey, { sourceLanguage: "ja", model: "synthetic-model" }]]); area = createMemoryStorageArea(disk);
  aiReply = async () => ({ ok: true, text: "当前讲解。" });
  send = vi.fn(async (message: any) => message.type === "study-settings-public" ? { ok: true, config: {
    sourceLanguage: defaultLanguage, configured: true, model: "synthetic-model", baseUrl: "https://synthetic.example/v1", asrModel: "small"
  } } : message.type === "study-ai" ? aiReply(message) : message.type === "study-dictionary-lookup" ? { ok: true, entries: [] } : { ok: true });
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `chrome-extension://language-review/${path}`, sendMessage: send, onMessage: { addListener: vi.fn() } },
    storage: { local: area, onChanged: { addListener: (listener: any) => { if (!listeners.includes(listener)) listeners.push(listener); }, removeListener: (listener: any) => { listeners = listeners.filter(item => item !== listener); } } } });
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  tokenizerBuilder = vi.fn(() => ({ build: (done: Function) => done(null, { tokenize: (text: string) => [{ surface_form: text, basic_form: text, reading: text, pos: "名詞" }] }) }));
  vi.stubGlobal("kuromoji", { builder: tokenizerBuilder });
  const core = readFileSync("extension/study/core.js", "utf8");
  vi.stubGlobal("JSTUDY", new Function(`${core}\nreturn JSTUDY;`)());
  route = (globalThis as any).JSTUDY.keyOf((globalThis as any).JSTUDY.resource(url));
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation(((type: string, listener: any, options: any) => { events.push([target, type, listener, options]); add(type, listener, options); }) as any);
  }
});
afterEach(() => {
  for (const [target, type, listener, options] of events) target.removeEventListener(type, listener, options);
  vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.replaceChildren();
});

describe("current-video language isolation independent content review", () => {
  it("loads the configured English default passively and renders English without Japanese tokenization", async () => {
    defaultLanguage = "en"; await mount();
    expect((find("sourceLanguage") as HTMLSelectElement).value).toBe("en");
    expect(state.cc).not.toHaveBeenCalled(); expect(state.asrStart).not.toHaveBeenCalled(); expect(aiRequests()).toEqual([]);
    await click("enable");
    expect(state.cc).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }));
    expect(find("current").textContent).toBe(sourceText.en); expect(tokenizerBuilder).not.toHaveBeenCalled();
    expect(find("current").querySelectorAll("rt")).toHaveLength(0);
    find("current").querySelector<HTMLElement>("[role=button]")!.click(); await flush();
    expect(send.mock.calls.map(([message]) => message)).toContainEqual(expect.objectContaining({ type: "study-dictionary-lookup", language: "en" }));
  });

  it("keeps a current-video override through settings refresh without persisting it as the default", async () => {
    await mount(); await changeLanguage("en");
    expect(state.cc).not.toHaveBeenCalled(); expect(area.set).not.toHaveBeenCalled();
    await click("enable"); await click("explain");
    expect(state.cc).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }));
    expect(aiRequests()).toHaveLength(1); expect(aiRequests()[0]).toMatchObject({ language: "en", kind: "explain" });
    expect(disk.get(settingsKey).sourceLanguage).toBe("ja");
    listeners.forEach(listener => listener({ [settingsKey]: { oldValue: { sourceLanguage: "ja" }, newValue: { sourceLanguage: "ja", model: "changed" } } }, "local")); await flush();
    expect((find("sourceLanguage") as HTMLSelectElement).value).toBe("en");
  });

  it("closes subtitles on language change and returns to the default on another route without automatically reopening", async () => {
    await mount(); await click("enable"); await changeLanguage("en");
    expect(find("enable").textContent).toBe("开启字幕"); expect(state.cc).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.map(([message]) => message)).toContainEqual({ type: "study-stop-ai" });
    history.replaceState({}, "", url + "?p=2"); await vi.advanceTimersByTimeAsync(250); await flush();
    expect((find("sourceLanguage") as HTMLSelectElement).value).toBe("ja");
    expect(find("enable").textContent).toBe("开启字幕"); expect(state.cc).toHaveBeenCalledTimes(1);
  });

  it("rejects a late old-language CC response even when its transport resolves after cancellation", async () => {
    const pending = deferred<any>(); state.cc.mockImplementationOnce(() => pending.promise);
    await mount(); await click("enable");
    const signal = state.cc.mock.calls[0][0].signal as AbortSignal;
    await changeLanguage("en"); expect(signal.aborted).toBe(true); await click("enable");
    expect(find("current").textContent).toBe(sourceText.en);
    pending.resolve(cc("ja")); await flush();
    expect(find("current").textContent).toBe(sourceText.en);
  });

  it.each(["explain", "proofread", "translate"])("rejects a late %s result after Japanese to English to Japanese", async kind => {
    const pending = deferred<any>(); aiReply = () => pending.promise;
    await mount(); await click("enable");
    if (kind === "proofread") { find("rows").querySelector<HTMLButtonElement>(".cue-proofread")!.click(); await flush(); }
    else await click(kind === "translate" ? "translate" : "explain");
    expect(aiRequests()).toHaveLength(1); expect(aiRequests()[0].language).toBe("ja");
    await changeLanguage("en"); await changeLanguage("ja"); await click("enable");
    pending.resolve({ ok: true, text: kind === "proofread" ? JSON.stringify({ status: "suggested", suggestedText: "OLD_LANGUAGE_RESULT", reason: "fixture" }) : "OLD_LANGUAGE_RESULT" }); await flush();
    expect(find("detail").textContent).not.toContain("OLD_LANGUAGE_RESULT");
    expect(find("detail").querySelector(".proof-apply")).toBeNull();
    expect(find("rows").textContent).not.toContain("OLD_LANGUAGE_RESULT");
    expect(find("current").textContent).toBe(sourceText.ja);
  });

  it("requests English ASR and refuses a Japanese callback while English is active", async () => {
    defaultLanguage = "en"; state.cc.mockResolvedValue({ ...cc("en"), status: "no-source", cues: [] });
    await mount(); await click("enable");
    expect(state.asrStart).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }));
    const meta = { bvid: "BV1ab411c7mD", cid: "111", resourceId: identity, model: "small", windowStart: 0, duration: 30, cached: true };
    state.asrOptions.onCues([cue("STALE_JAPANESE_CUE")], { ...meta, language: "ja" }); await flush();
    expect(find("current").textContent).not.toContain("STALE_JAPANESE_CUE");
    state.asrOptions.onCues([cue(sourceText.en)], { ...meta, language: "en" }); await flush();
    expect(find("current").textContent).toBe(sourceText.en);
  });
});

describe("route and language owned import independent content review", () => {
  it("restores the legacy route-only import only for Japanese", async () => {
    disk.set("biliscript-study-import:" + route, imported("LEGACY_JAPANESE"));
    await mount(); await click("enable");
    expect(find("current").textContent).toBe("LEGACY_JAPANESE"); expect(state.cc).not.toHaveBeenCalled();
    await changeLanguage("en"); await click("enable");
    expect(find("current").textContent).toBe(sourceText.en); expect(state.cc).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }));
    expect(disk.get("biliscript-study-import:" + route).cues[0].text).toBe("LEGACY_JAPANESE");
  });

  it("prefers the language key and never restores another route's import", async () => {
    disk.set("biliscript-study-import:" + route, imported("LEGACY_JAPANESE"));
    disk.set(importStorageKey(route, "ja"), imported("CURRENT_JAPANESE"));
    disk.set(importStorageKey(route, "en"), imported("CURRENT_ENGLISH"));
    await mount(); await click("enable"); expect(find("current").textContent).toBe("CURRENT_JAPANESE");
    await changeLanguage("en"); await click("enable"); expect(find("current").textContent).toBe("CURRENT_ENGLISH");
    history.replaceState({}, "", url + "?p=2"); await vi.advanceTimersByTimeAsync(250); await flush();
    await click("enable"); expect(find("current").textContent).toBe(sourceText.ja);
    expect(state.cc).toHaveBeenCalledTimes(1);
  });

  it("saves a manual import under the current language and route without replacing the other language", async () => {
    disk.set(importStorageKey(route, "ja"), imported("KEEP_JAPANESE"));
    await mount(); await changeLanguage("en"); await click("enable");
    await importFile("1\n00:00:01,000 --> 00:00:03,000\nNew English line.\n");
    expect(disk.get(importStorageKey(route, "en"))).toMatchObject({ language: "en", name: "source.srt", cues: [{ start: 1, end: 3, text: "New English line." }] });
    expect(disk.get(importStorageKey(route, "ja")).cues[0].text).toBe("KEEP_JAPANESE");
    expect(disk.has("biliscript-study-import:" + route)).toBe(false);
  });

  it("discards an unfinished file read after the language changes", async () => {
    const pending = deferred<string>(); await mount(); await click("enable");
    await importFile(pending.promise); await changeLanguage("en"); await click("enable");
    pending.resolve("1\n00:00:01,000 --> 00:00:03,000\nOLD_IMPORT\n"); await flush();
    expect(find("current").textContent).toBe(sourceText.en);
    expect(disk.has(importStorageKey(route, "ja"))).toBe(false); expect(disk.has(importStorageKey(route, "en"))).toBe(false);
  });
});
