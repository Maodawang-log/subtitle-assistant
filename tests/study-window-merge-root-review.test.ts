import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

// Review the observed symptom through the real content entry, not a second
// implementation of its merge algorithm. Only the ASR transport is replaced.
const transport = vi.hoisted(() => ({ options: null as any }));
vi.mock("../extension/study/cc-source.js", () => ({
  getJapaneseCc: async () => ({ status: "no-japanese", bvid: "BV1ab411c7mD", cid: "111", title: "review", tracks: [] })
}));
vi.mock("../extension/study/native-source.js", () => ({
  getNativeStudySource: async () => ({ status: "unavailable", reason: "TEST" }),
  sameNativeBinding: () => false
}));
vi.mock("../extension/study/bounded-asr.js", () => ({
  createBoundedAsrController: (options: unknown) => {
    transport.options = options;
    return { start() {}, stop() {}, seek() {}, updateTime() {} };
  },
  requestStudyAudioWindow: vi.fn()
}));

const identity = "BV1ab411c7mD:111";
const url = "https://www.bilibili.com/video/BV1ab411c7mD/";
let root: ShadowRoot;
let events: Array<[EventTarget, string, EventListenerOrEventListenerObject, any]>;
let aiReply: (message: any) => Promise<any>;
async function flush() { for (let n = 0; n < 30; n++) await Promise.resolve(); }
function find(id: string): HTMLElement {
  return (root.getElementById(id) || document.getElementById("biliscript-study-controls")?.shadowRoot?.getElementById(id)) as HTMLElement;
}
async function emit(items: any[], start = 0, duration = 30, resourceId = identity) {
  transport.options.onCues(items, { bvid: "BV1ab411c7mD", cid: "111", resourceId,
    language: "ja", model: "medium", windowStart: start, duration, cached: false });
  await flush();
}
function rows() {
  return [...find("rows").querySelectorAll("[data-study-text]")].map(node => node.textContent);
}

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); transport.options = null;
  history.replaceState({}, "", url);
  document.body.innerHTML = '<div class="bpx-player-container"><video></video></div>';
  for (const id of ["biliscript-japanese-study", "biliscript-study-slot", "biliscript-study-controls", "biliscript-study-entry", "biliscript-study-overlay"]) document.getElementById(id)?.remove();
  const video = document.querySelector("video")!;
  Object.defineProperties(video, {
    currentTime: { configurable: true, writable: true, value: 1.5 },
    duration: { configurable: true, value: 300 },
    paused: { configurable: true, value: true }
  });
  video.pause = vi.fn(); video.play = vi.fn(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const storage = createMemoryStorageArea();
  aiReply = async () => ({ ok: true, text: JSON.stringify({ status: "suggested", suggestedText: "修正した字幕。", reason: "上下文中的识别错字。" }) });
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://review/${path}`,
      sendMessage: vi.fn(async (message: any) => message.type === "study-settings-public" ? { ok: true, config: { configured: false } } : message.type === "study-ai" ? aiReply(message) : { ok: true }),
      onMessage: { addListener: vi.fn() } },
    storage: { local: storage, onChanged: { addListener: vi.fn() } }
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("kuromoji", { builder: () => ({ build: (done: Function) => done(null, {
    tokenize: (text: string) => [{ surface_form: text, basic_form: text, reading: text, pos: "名詞" }]
  }) }) });
  const source = readFileSync("extension/study/core.js", "utf8");
  vi.stubGlobal("JSTUDY", new Function(`${source}\nreturn JSTUDY;`)());
  events = [];
  for (const target of [window, document]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation(((type: string, listener: any, options: any) => {
      events.push([target, type, listener, options]); original(type, listener, options);
    }) as any);
  }
  await import("../extension/study/content.js"); await flush();
  root = document.getElementById("biliscript-japanese-study")!.shadowRoot!;
  find("enable").click(); await flush();
});

afterEach(() => {
  for (const [target, type, listener, options] of events) target.removeEventListener(type, listener, options);
  vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  for (const id of ["biliscript-japanese-study", "biliscript-study-slot", "biliscript-study-controls", "biliscript-study-entry", "biliscript-study-overlay"]) document.getElementById(id)?.remove();
  document.body.replaceChildren();
});

it("replaces revised text and timing from the same audio window instead of showing both versions", async () => {
  await emit([{ from: 0, to: 5.9, content: "静かに強い言葉が出てくるけどですね。" }, { from: 6, to: 10, content: "中国との関係はどうするんだ。" }]);
  await emit([{ from: 0.04, to: 5.97, content: "静かに強い言葉が出てくるけどですね。" }, { from: 6.06, to: 10.2, content: "中国との関係はどうするんだと。" }]);
  expect(rows()).toEqual(["静かに強い言葉が出てくるけどですね。", "中国との関係はどうするんだと。"]);
});

it("can replace two earlier segments with one corrected segment without leaving the old rows", async () => {
  await emit([{ from: 1, to: 3, content: "私たちの暮らしに" }, { from: 3, to: 6, content: "広がる変化です。" }]);
  await emit([{ from: 1, to: 6, content: "私たちの暮らしに広がる変化です。" }]);
  expect(rows()).toEqual(["私たちの暮らしに広がる変化です。"]);
});

it("removes a hallucinated row when a replacement result for that window is empty", async () => {
  await emit([{ from: 1, to: 5, content: "架空の字幕です。" }]);
  await emit([]);
  expect(rows()).toEqual([]);
});

it("keeps genuine repetitions in different windows and does not erase an unrelated later window", async () => {
  await emit([{ from: 1, to: 3, content: "ありがとうございます。" }]);
  await emit([{ from: 31, to: 33, content: "ありがとうございます。" }], 30);
  await emit([{ from: 1.05, to: 3.05, content: "本当にありがとうございます。" }]);
  expect(rows()).toEqual(["本当にありがとうございます。", "ありがとうございます。"]);
});

it("keeps separate repeated utterances within the same window", async () => {
  await emit([{ from: 1, to: 2, content: "はい。" }, { from: 6, to: 7, content: "はい。" }]);
  expect(rows()).toEqual(["はい。", "はい。"]);
});

it("ignores another video's ASR callback and late callbacks after captions are closed", async () => {
  await emit([{ from: 1, to: 3, content: "正しい動画です。" }]);
  await emit([{ from: 1, to: 3, content: "別動画の結果です。" }], 0, 30, "BVOTHER:222");
  expect(rows()).toEqual(["正しい動画です。"]);
  find("enable").click(); await flush();
  await emit([{ from: 1, to: 3, content: "停止後の遅い結果です。" }]);
  expect(rows()).not.toContain("停止後の遅い結果です。");
});

it("only adopts the requested correction after the user clicks apply, keeps its timestamp, and restores the original", async () => {
  await emit([{ from: 1, to: 3, content: "元の字幕。" }]);
  find("rows").querySelector<HTMLButtonElement>(".cue-proofread")!.click(); await flush();
  expect(rows()).toEqual(["元の字幕。"]);
  expect(find("detail").textContent).toContain("修正した字幕。");
  find("detail").querySelector<HTMLButtonElement>(".proof-apply")!.click(); await flush();
  expect(rows()).toEqual(["修正した字幕。"]);
  expect(find("rows").querySelector(".cue-time")!.textContent).toBe("0:01");
  find("detail").querySelector<HTMLButtonElement>(".proof-restore")!.click(); await flush();
  expect(rows()).toEqual(["元の字幕。"]);
});

it("keeps a pending correction when an unrelated future window arrives outside its two-sentence context", async () => {
  await emit([{ from: 1, to: 3, content: "元の字幕。" }, { from: 5, to: 7, content: "参考の次文。" }, { from: 9, to: 11, content: "参考の最後。" }]);
  let resolve!: (reply: any) => void;
  aiReply = () => new Promise(done => { resolve = done; });
  find("rows").querySelector<HTMLButtonElement>(".cue-proofread")!.click(); await flush();
  await emit([{ from: 31, to: 34, content: "無関係な後続文。" }], 30);
  resolve({ ok: true, text: JSON.stringify({ status: "suggested", suggestedText: "修正した字幕。", reason: "上下文中的识别错字。" }) });
  await flush();
  expect(find("detail").querySelector(".proof-apply")).not.toBeNull();
  expect(find("detail").textContent).toContain("修正した字幕。");
});

it("does not apply a late correction when the target itself has been retranscribed", async () => {
  await emit([{ from: 1, to: 3, content: "元の字幕。" }]);
  let resolve!: (reply: any) => void;
  aiReply = () => new Promise(done => { resolve = done; });
  find("rows").querySelector<HTMLButtonElement>(".cue-proofread")!.click(); await flush();
  await emit([{ from: 1.02, to: 3.02, content: "新しい認識結果。" }]);
  resolve({ ok: true, text: JSON.stringify({ status: "suggested", suggestedText: "古い修正案。", reason: "旧原文への返答。" }) });
  await flush();
  expect(rows()).toEqual(["新しい認識結果。"]);
  expect(find("detail").querySelector(".proof-apply")).toBeNull();
});

it("offers listening rather than an apply action when the correction model is uncertain", async () => {
  await emit([{ from: 1, to: 3, content: "元の字幕。" }]);
  aiReply = async () => ({ ok: true, text: JSON.stringify({ status: "uncertain", suggestedText: "", reason: "需要听原声确认。" }) });
  find("rows").querySelector<HTMLButtonElement>(".cue-proofread")!.click(); await flush();
  expect(find("detail").querySelector(".proof-apply")).toBeNull();
  expect(find("detail").querySelector(".proof-listen")).not.toBeNull();
  expect(rows()).toEqual(["元の字幕。"]);
});
