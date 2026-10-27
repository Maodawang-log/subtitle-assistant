import "./helpers/study-learning-store-host.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

// Real content entry and timeline; transport-only fixtures deliberately resolve
// after cancellation so the receiving identity/revision guards are exercised.
const source = vi.hoisted(() => ({ options: null as any, cc: null as any }));
vi.mock("../extension/study/cc-source.js", () => ({ getJapaneseCc: async () => source.cc }));
vi.mock("../extension/study/native-source.js", () => ({
  getNativeStudySource: async () => ({ status: "unavailable", reason: "TEST" }), sameNativeBinding: () => false
}));
vi.mock("../extension/study/bounded-asr.js", () => ({
  createBoundedAsrController: (options: unknown) => {
    source.options = options;
    return { start() {}, stop() {}, seek() {}, updateTime() {} };
  }, requestStudyAudioWindow: vi.fn()
}));
vi.mock("../extension/study/inline-recorder.js", () => ({
  createInlineRecorder: () => ({ clear() {}, stop() {}, open() {}, show() {}, setCurrent() {} })
}));

const identity = "BV1ab411c7mD:111", url = "https://www.bilibili.com/video/BV1ab411c7mD/";
const corrected = "修正した字幕。";
const correction = () => ({ ok: true, text: JSON.stringify({ status: "suggested", suggestedText: corrected, reason: "只修改目标句的错字。" }) });
const cue = (from: number, to: number, content: string) => ({ from, to, content });
let root: ShadowRoot, video: HTMLVideoElement, send: ReturnType<typeof vi.fn>;
let events: Array<[EventTarget, string, EventListenerOrEventListenerObject, any]>;
let storageListeners: Array<(changes: any, area: string) => void>;
let model: string, aiReply: (message: any) => Promise<any>;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function flush() { for (let n = 0; n < 35; n++) await Promise.resolve(); }
function find(id: string): HTMLElement {
  return (root.getElementById(id) || document.getElementById("biliscript-study-controls")?.shadowRoot?.getElementById(id)) as HTMLElement;
}
async function click(id: string) { find(id).click(); await flush(); }
async function emit(items: any[], start = 0, duration = 30, cached = false) {
  source.options.onCues(items, { bvid: "BV1ab411c7mD", cid: "111", resourceId: identity,
    language: "ja", model: "medium", windowStart: start, duration, cached });
  await flush();
}
function textOfCurrent() { return find("current").textContent; }
function allRows() { return [...find("rows").querySelectorAll<HTMLElement>(".cue")]; }
function chineseOf(index: number) { return allRows()[index].querySelector("#chinese,.cue-zh")?.textContent; }
function requests(kind?: string) { return send.mock.calls.map(([m]) => m).filter(m => m.type === "study-ai" && (!kind || m.kind === kind)); }
async function selectText(text: string) {
  const row = allRows().find(el => el.querySelector("[data-study-text]")?.textContent === text)!;
  row.querySelector<HTMLButtonElement>(".cue-time")!.click(); await flush();
}
async function proofread(index = 0) { allRows()[index].querySelector<HTMLButtonElement>(".cue-proofread")!.click(); await flush(); }
async function setModel(next: string) {
  const previous = model; model = next;
  for (const listener of storageListeners) listener({ biliscriptJapaneseSettings: { oldValue: { model: previous }, newValue: { model: next } } }, "local");
  await flush();
}
async function useChineseCc() {
  source.cc = { status: "ready", bvid: "BV1ab411c7mD", cid: "111", title: "CC fixture", tracks: [],
    cues: [cue(1, 3, "元の字幕。"), cue(10, 12, "他の字幕。")],
    chineseCues: [cue(1, 3, "原来的中文。"), cue(10, 12, "另一句中文。")] };
  await click("reload");
}

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); source.options = null; model = "model-A"; storageListeners = [];
  source.cc = { status: "no-japanese", bvid: "BV1ab411c7mD", cid: "111", title: "ASR fixture", tracks: [] };
  history.replaceState({}, "", url);
  document.body.innerHTML = '<div class="bpx-player-container"><video></video></div>';
  video = document.querySelector("video")!;
  Object.defineProperties(video, {
    currentTime: { configurable: true, writable: true, value: 1.5 },
    duration: { configurable: true, value: 300 }, paused: { configurable: true, value: true }
  });
  video.pause = vi.fn(); video.play = vi.fn(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  aiReply = async message => message.kind === "proofread" ? correction() : { ok: true, text: "译文：" + message.text };
  send = vi.fn(async (message: any) => message.type === "study-settings-public" ? {
    ok: true, config: { configured: true, model, baseUrl: "https://synthetic.example/v1", asrModel: "medium" }
  } : message.type === "study-ai" ? aiReply(message) : { ok: true });
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://review/${path}`, sendMessage: send, onMessage: { addListener: vi.fn() } },
    storage: { local: createMemoryStorageArea(), onChanged: { addListener: (listener: any) => { if (!storageListeners.includes(listener)) storageListeners.push(listener); }, removeListener: (listener: any) => { storageListeners = storageListeners.filter(item => item !== listener); } } }
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("kuromoji", { builder: () => ({ build: (done: Function) => done(null, {
    tokenize: (text: string) => [{ surface_form: text, basic_form: text, reading: text, pos: "名詞" }]
  }) }) });
  const core = readFileSync("extension/study/core.js", "utf8");
  vi.stubGlobal("JSTUDY", new Function(`${core}\nreturn JSTUDY;`)());
  events = [];
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation(((type: string, listener: any, options: any) => {
      events.push([target, type, listener, options]); add(type, listener, options);
    }) as any);
  }
  await import("../extension/study/content.js"); await flush();
  root = document.getElementById("biliscript-japanese-study")!.shadowRoot!;
  await click("enable");
});
afterEach(() => {
  for (const [target, type, listener, options] of events) target.removeEventListener(type, listener, options);
  vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  for (const id of ["biliscript-japanese-study", "biliscript-study-slot", "biliscript-study-controls", "biliscript-study-entry", "biliscript-study-overlay"]) document.getElementById(id)?.remove();
  document.body.replaceChildren();
});

it.each([
  { name: "deletes", replacement: [cue(1, 3, "修订后的首句。" )] },
  { name: "inserts", replacement: [cue(1, 3, "首句。"), cue(8, 9, "新增句一。"), cue(11, 12, "新增句二。"), cue(15, 16, "早段末句。") ] }
])("keeps the selected cue identity in a speech gap when an earlier window $name rows", async ({ replacement }) => {
  await emit([cue(1, 3, "旧首句。"), cue(10, 12, "旧次句。")]);
  await emit([cue(31, 33, "选中的句子。"), cue(40, 42, "后面的句子。")], 30);
  await selectText("选中的句子。");
  const selectedKey = find("current").dataset.cue;
  // Ordinary playback entering silence does not constitute a user seek.
  video.currentTime = 35; await vi.advanceTimersByTimeAsync(250); await flush();
  expect(textOfCurrent()).toBe("选中的句子。");
  await emit(replacement, 0, 30, true);
  expect(textOfCurrent()).toBe("选中的句子。");
  expect(find("current").dataset.cue).toBe(selectedKey);
  await click("replay");
  expect(video.currentTime).toBe(31);
});

it("stops an active sentence loop when an empty replacement removes its last cue", async () => {
  await emit([cue(1, 3, "之后被移除的句子。")]);
  await click("loop");
  expect(find("loop").getAttribute("aria-pressed")).toBe("true");
  await emit([]);
  expect(allRows()).toHaveLength(0);
  expect(find("loop").getAttribute("aria-pressed")).toBe("false");
  expect(find("loop").textContent).toBe("循环：关");
});

it("stops an obsolete loop when only unaligned sentence fragments would remain", async () => {
  await emit([cue(1, 12, "时间被后续窗口裁短的原句。")]);
  await click("loop");
  const before = find("current").dataset.cue;
  expect(find("loop").getAttribute("aria-pressed")).toBe("true");
  await emit([cue(4.5, 6.5, "覆盖中间区间的新句。")], 4, 5);
  expect(textOfCurrent()).toBe("覆盖中间区间的新句。");
  expect(find("current").dataset.cue).not.toBe(before);
  expect(find("loop").getAttribute("aria-pressed")).toBe("false");
});

it("rejects a previous translation after the same window is revised from cached data", async () => {
  const old = deferred<any>();
  aiReply = async message => message.text === "旧的原文。" ? old.promise : { ok: true, text: "新版本中文。" };
  await emit([cue(1, 3, "旧的原文。")]); await click("translate");
  expect(requests("translate")).toHaveLength(1);
  await emit([cue(1.02, 3.02, "新的原文。")], 0, 30, true);
  expect(chineseOf(0)).toBe("新版本中文。");
  old.resolve({ ok: true, text: "过期中文不得回填。" }); await flush();
  expect(chineseOf(0)).toBe("新版本中文。");
  expect(find("rows").textContent).not.toContain("过期中文不得回填。");
});

it("invalidates only the edited CC sentence's Chinese while its replacement translation is pending", async () => {
  const translated = deferred<any>();
  await useChineseCc(); await click("translate");
  expect(chineseOf(0)).toBe("原来的中文。"); expect(chineseOf(1)).toBe("另一句中文。");
  aiReply = async message => message.kind === "proofread" ? correction() : translated.promise;
  await proofread(); find("detail").querySelector<HTMLButtonElement>(".proof-apply")!.click(); await flush();
  expect(chineseOf(0)).toBe(""); expect(chineseOf(1)).toBe("另一句中文。");
  expect(requests("translate").map(m => m.text)).toEqual([corrected]);
  translated.resolve({ ok: true, text: "修订后的中文。" }); await flush();
  expect(chineseOf(0)).toBe("修订后的中文。"); expect(chineseOf(1)).toBe("另一句中文。");
});

it("does not translate during adoption or restoration while bilingual captions are off", async () => {
  await useChineseCc(); await proofread();
  find("detail").querySelector<HTMLButtonElement>(".proof-apply")!.click(); await flush();
  expect(requests("translate")).toHaveLength(0); expect(chineseOf(0)).toBe("");
  find("detail").querySelector<HTMLButtonElement>(".proof-restore")!.click(); await flush();
  expect(requests("translate")).toHaveLength(0);
  await click("translate");
  expect(chineseOf(0)).toBe("原来的中文。"); expect(requests("translate")).toHaveLength(0);
});

it("discards a pending correction on a real video seeking event even when old cues remain", async () => {
  const pending = deferred<any>(); aiReply = () => pending.promise;
  await emit([cue(1, 3, "待校对原句。")]); await proofread();
  video.currentTime = 35; video.dispatchEvent(new Event("seeking")); await flush();
  pending.resolve(correction()); await flush();
  expect(find("detail").querySelector(".proof-apply")).toBeNull();
  expect(find("detail").textContent).toContain("建议已失效");
  expect(allRows()[0].textContent).toContain("待校对原句。");
});

it("uses real content storage notifications to reject a pending model A to B to A correction", async () => {
  const pending = deferred<any>(); aiReply = () => pending.promise;
  await emit([cue(1, 3, "待校对原句。")]); await proofread();
  await setModel("model-B"); await setModel("model-A");
  pending.resolve(correction()); await flush();
  expect(find("detail").querySelector(".proof-apply")).toBeNull();
  expect(find("detail").textContent).toContain("建议已失效");
  expect(textOfCurrent()).toBe("待校对原句。");
});
