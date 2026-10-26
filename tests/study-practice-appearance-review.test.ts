import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, appearanceCss, normalizeAppearance, setupAppearance } from "../extension/study/appearance.js";
import { createWordPanel } from "../extension/study/word-panel.js";
import { createInlineRecorder } from "../extension/study/inline-recorder.js";
import { createStudyShell } from "../extension/study/ui-shell.js";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

const vocabularyKey = "biliscriptStudyVocabulary";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
function input(id: string, value: string) { $<HTMLInputElement>(id).value = value; $(id).dispatchEvent(new Event("input", { bubbles: true })); }
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("subtitle appearance independent settings review", () => {
  it("normalizes absent, malformed and non-finite values without accepting CSS payloads", () => {
    for (const value of [undefined, null, {}, { size: "not-a-size", color: "url(https://invalid.test/color)" }, { size: NaN, color: "#fff;display:none" }, { size: Infinity }, { size: -Infinity }]) {
      expect(normalizeAppearance(value)).toEqual(DEFAULT_APPEARANCE);
    }
    expect(normalizeAppearance({ size: -5, color: "#AABBCC" })).toEqual({ mode: "auto", size: 16, color: "#aabbcc" });
    expect(normalizeAppearance({ size: 80, color: "#112233" })).toEqual({ mode: "auto", size: 52, color: "#112233" });
    expect(normalizeAppearance({ mode: "manual", size: "40", color: "#00aa55" })).toEqual({ mode: "manual", size: 40, color: "#00aa55" });
  });

  it("emits coordinated Japanese, Chinese and ruby sizes with a safe selected color", () => {
    const style = document.createElement("style");
    style.textContent = appearanceCss({ mode: "manual", size: 40, color: "#FFDDAA" }); document.body.append(style);
    const rules = [...style.sheet!.cssRules] as CSSStyleRule[];
    const japanese = rules.find(rule => rule.selectorText === ".ja")!;
    const chinese = rules.find(rule => rule.selectorText === ".zh")!;
    const ruby = rules.find(rule => rule.selectorText === "rt")!;
    const color = rules.find(rule => rule.selectorText.includes(".ja") && rule.style.color)!;
    expect(japanese.style.fontSize).toBe("40px");
    expect(parseFloat(chinese.style.fontSize)).toBeGreaterThan(0);
    expect(parseFloat(chinese.style.fontSize)).toBeLessThan(40);
    expect(ruby.style.fontSize).toMatch(/^[\d.]+em$/);
    expect(color.style.color).toBe("rgb(255, 221, 170)");
    expect(appearanceCss({ size: "1px;}body{display:none", color: "red;}body{display:none" })).not.toContain("display:none");
  });

  it("restores saved appearance and immediately saves edits without touching provider settings", async () => {
    const originalProvider = { apiKey: "fixture-not-a-real-key", model: "fixture-model", asrModel: "medium" };
    const storage = new Map<string, unknown>([[APPEARANCE_KEY, { mode: "manual", size: 36, color: "#aabbcc" }], ["biliscriptJapaneseSettings", originalProvider]]);
    const area = createMemoryStorageArea(storage);
    vi.stubGlobal("chrome", { storage: { local: area } });
    document.body.innerHTML = '<select id="subtitleSizeMode"><option value="auto">自动</option><option value="manual">手动</option></select><input id="subtitleSize" type="range" min="16" max="52"><input id="subtitleSizeNumber" type="number"><input id="subtitleColor" type="color"><div id="appearancePreview"></div><p id="appearanceStatus"></p><button data-subtitle-color="#fff4b8">暖黄</button><button id="appearanceReset">恢复默认</button>';
    setupAppearance(); await flush();
    expect($<HTMLInputElement>("subtitleSize").value).toBe("36");
    expect($<HTMLInputElement>("subtitleSizeNumber").value).toBe("36");
    expect($<HTMLInputElement>("subtitleColor").value).toBe("#aabbcc");
    expect(area.set).not.toHaveBeenCalled();
    input("subtitleSize", "40"); input("subtitleSizeNumber", "34"); input("subtitleColor", "#0055aa"); await flush();
    expect(storage.get(APPEARANCE_KEY)).toEqual({ mode: "manual", size: 34, color: "#0055aa" });
    expect($<HTMLInputElement>("subtitleSize").value).toBe("34");
    expect($("appearancePreview").style.fontSize).toBe("34px");
    document.querySelector<HTMLButtonElement>("[data-subtitle-color]")!.click(); await flush();
    expect(storage.get(APPEARANCE_KEY)).toEqual({ mode: "manual", size: 34, color: "#fff4b8" });
    $("appearanceReset").click(); await flush();
    expect(storage.get(APPEARANCE_KEY)).toEqual(DEFAULT_APPEARANCE);
    expect(storage.get("biliscriptJapaneseSettings")).toBe(originalProvider);
    expect(area.get.mock.calls).toEqual([[APPEARANCE_KEY]]);
    expect(area.set.mock.calls.every(([value]) => Object.keys(value).length === 1 && APPEARANCE_KEY in value)).toBe(true);
  });
});

describe("multiword card folding independent review", () => {
  type Reply = { ok: boolean; entries: { term: string; reading: string; meaning: string; source: string; dictionaryId: string; version: string }[] };
  const word = (term: string) => ({ surface_form: term, basic_form: term, reading: "くらし", pos: "名詞" });
  const reply = (term: string): Reply => ({ ok: true, entries: [{ term, reading: "くらし", meaning: "生活；生计", source: "日中词典", dictionaryId: "ja-zh", version: "1" }] });
  const source = { sentence: "暮らしの変化です。", url: "https://www.bilibili.com/video/BV1test000000/?p=2", time: 13.4, resource: "BV1test000000:p2" };
  let storage: Map<string, unknown>, lookup: ReturnType<typeof vi.fn>, panel: ReturnType<typeof createWordPanel>;
  const cards = () => [...document.querySelectorAll<HTMLElement>(".word-card")];
  const bulk = (expanded: boolean) => document.querySelector<HTMLButtonElement>(expanded ? "#expandWords,.word-expand-all" : "#collapseWords,.word-collapse-all")!;
  const folded = (card: HTMLElement) => ({ expanded: card.querySelector(".word-toggle")!.getAttribute("aria-expanded"), hidden: card.querySelector<HTMLElement>(".word-body")!.hidden });

  beforeEach(async () => {
    storage = new Map(); const area = createMemoryStorageArea(storage);
    vi.stubGlobal("chrome", { storage: { local: area, onChanged: { addListener: vi.fn() } } });
    vi.stubGlobal("JSTUDY", { hiragana: (text: string) => text, conjugation: () => "" });
    document.body.innerHTML = '<div id="wordDetail"></div><div id="wordList"></div><button id="exportWords"></button>';
    lookup = vi.fn(async (queries: string[]) => reply(queries[0]));
    panel = createWordPanel({ $ }, { binding: () => "video-1", lookup, fallback: () => undefined, error: vi.fn(), explain: vi.fn() });
    await flush();
  });

  it("starts expanded and folds the complete word body while keeping its heading and star", async () => {
    await panel.show([word("暮らし"), word("変化")], source);
    expect(cards()).toHaveLength(2);
    expect(cards().map(folded)).toEqual([{ expanded: "true", hidden: false }, { expanded: "true", hidden: false }]);
    const first = cards()[0], body = first.querySelector<HTMLElement>(".word-body")!;
    expect(body.contains(first.querySelector(".word-reading"))).toBe(true);
    expect(body.contains(first.querySelector(".word-meaning"))).toBe(true);
    expect(body.contains(first.querySelector(".word-explain"))).toBe(true);
    expect(body.contains(first.querySelector(".word-star"))).toBe(false);
    first.querySelector<HTMLButtonElement>(".word-toggle")!.click();
    expect(folded(first)).toEqual({ expanded: "false", hidden: true });
    expect(folded(cards()[1])).toEqual({ expanded: "true", hidden: false });
    first.querySelector<HTMLButtonElement>(".word-toggle")!.click();
    expect(folded(first)).toEqual({ expanded: "true", hidden: false });
  });

  it("keeps late dictionary results and subsequently created cards folded after collapse-all", async () => {
    const pending = deferred<Reply>(); lookup.mockImplementationOnce(() => pending.promise);
    const show = panel.show([word("暮らし"), word("変化")], source); await flush();
    expect(cards()).toHaveLength(1);
    bulk(false).click();
    expect(folded(cards()[0])).toEqual({ expanded: "false", hidden: true });
    pending.resolve(reply("暮らし")); await show;
    expect(cards()).toHaveLength(2);
    expect(cards().map(folded)).toEqual([{ expanded: "false", hidden: true }, { expanded: "false", hidden: true }]);
    expect(cards()[0].querySelector(".word-meaning")!.textContent).toContain("生活；生计");
    bulk(true).click();
    expect(cards().map(folded)).toEqual([{ expanded: "true", hidden: false }, { expanded: "true", hidden: false }]);
    bulk(false).click(); await panel.show([word("新しい句")], source);
    expect(cards().map(folded)).toEqual([{ expanded: "true", hidden: false }]);
  });

  it("does not toggle folding when a collapsed word is saved and preserves complete merged meanings", async () => {
    lookup.mockResolvedValue({ ok: true, entries: [reply("暮らし").entries[0], reply("暮し").entries[0], { ...reply("暮らし").entries[0], meaning: "谋生；生活方式" }] });
    await panel.show([word("暮らし")], source);
    const first = cards()[0];
    expect(first.querySelectorAll(".word-meaning p > div")).toHaveLength(2);
    expect(first.querySelector(".word-meaning strong")!.textContent).toContain("暮らし / 暮し");
    bulk(false).click(); first.querySelector<HTMLButtonElement>(".word-star")!.click(); await flush();
    expect(folded(first)).toEqual({ expanded: "false", hidden: true });
    const saved = storage.get(vocabularyKey) as any[];
    expect(saved).toHaveLength(1); expect(saved[0].source).toEqual(source);
    expect(saved[0].meaning).toContain("生活；生计"); expect(saved[0].meaning).toContain("谋生；生活方式");
    first.querySelector<HTMLButtonElement>(".word-star")!.click(); await flush();
    expect(folded(first)).toEqual({ expanded: "false", hidden: true });
    expect(storage.get(vocabularyKey)).toEqual([]);
  });
});

describe("practice device selection and retained recording independent review", () => {
  const recorderKey = "biliscriptStudyRecorder";
  const originalCue = { start: 13.4, end: 16.2, text: "暮らしの変化です。" };
  const deviceInfo = (id: string, label: string, kind = "audioinput") => ({ deviceId: id, label, kind, groupId: "fixture-group" });
  let storage: Map<string, unknown>, devices: ReturnType<typeof deviceInfo>[], streams: any[], created: FakeRecorder[];
  let getUserMedia: ReturnType<typeof vi.fn>, enumerateDevices: ReturnType<typeof vi.fn>, media: EventTarget;
  let recording: ReturnType<typeof createInlineRecorder> | undefined, shell: ReturnType<typeof createStudyShell> | undefined;
  let reference: Mock<(cue: unknown) => Promise<void>>, pause: Mock<() => void>, ui: any;
  class FakeRecorder {
    static isTypeSupported() { return true; }
    state = "inactive"; mimeType = "audio/webm"; ondataavailable: any; onstop: any; onerror: any;
    start = vi.fn(() => { this.state = "recording"; });
    stop = vi.fn(() => { this.state = "inactive"; });
    constructor(public stream: unknown) { created.push(this); }
    finish(text = "fixture-audio") { this.ondataavailable?.({ data: new Blob([text]) }); this.onstop?.(); }
  }
  function makeStream(id = "default") {
    const track = { stop: vi.fn(), onended: null as (() => void) | null, label: id, getSettings: () => ({ deviceId: id }) };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] }; streams.push(stream); return stream;
  }
  const element = <T extends HTMLElement = HTMLElement>(id: string) => ui.$(id) as T;
  async function click(id: string) { element(id).click(); await flush(); }
  async function open(preferred = "", customUi?: any) {
    if (preferred) storage.set(recorderKey, { deviceId: preferred });
    ui = customUi || { $, pin: vi.fn(), reveal: vi.fn(), layoutChanged: vi.fn() };
    recording = createInlineRecorder(ui, reference, pause); recording.open(originalCue); await flush();
  }
  beforeEach(() => {
    vi.useFakeTimers(); storage = new Map(); devices = []; streams = []; created = [];
    reference = vi.fn(async (_cue: unknown) => {}); pause = vi.fn(() => {}); recording = undefined; shell = undefined;
    const area = createMemoryStorageArea(storage);
    vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => path }, storage: { local: area } });
    getUserMedia = vi.fn(async () => makeStream()); enumerateDevices = vi.fn(async () => devices);
    media = Object.assign(new EventTarget(), { getUserMedia, enumerateDevices });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: media });
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {});
    let nextUrl = 0; vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:practice-review-" + ++nextUrl), revokeObjectURL: vi.fn() }));
    document.body.innerHTML = '<section id="practice" hidden><p id="practiceCue"></p><p id="practiceStatus"></p><p id="practiceTime"></p><select id="micDevice"><option value="">系统默认麦克风</option></select><audio id="micAudio"></audio>' + ["micDevices", "micStart", "micStop", "micReplay", "micSave", "micOriginal", "practiceClose"].map(id => '<button id="' + id + '"></button>').join("") + '</section>';
  });
  afterEach(() => {
    recording?.clear(); shell?.destroy(); delete (document as any).fullscreenElement;
    vi.clearAllTimers(); vi.useRealTimers();
  });

  it("does not acquire a microphone on open and retains a saved choice when permission hides devices", async () => {
    await open("saved-usb");
    expect(getUserMedia).not.toHaveBeenCalled(); expect(created).toHaveLength(0);
    expect(element<HTMLSelectElement>("micDevice").value).toBe("saved-usb");
    expect(storage.get(recorderKey)).toEqual({ deviceId: "saved-usb" });
    expect(element("practiceCue").textContent).toBe(originalCue.text);
  });

  it("authorizes only on request, enumerates audio inputs, releases the probe and saves a selected device", async () => {
    await open(); devices = [deviceInfo("default", "系统默认"), deviceInfo("usb", "USB 麦克风"), deviceInfo("headset", "耳机麦克风"), deviceInfo("camera", "摄像头", "videoinput")];
    await click("micDevices");
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true, video: false });
    expect(created).toHaveLength(0); expect(streams[0].getTracks()[0].stop).toHaveBeenCalledTimes(1);
    const select = element<HTMLSelectElement>("micDevice");
    expect([...select.options].map(option => option.value)).toEqual(["", "usb", "headset"]);
    select.value = "headset"; select.dispatchEvent(new Event("change", { bubbles: true })); await flush();
    expect(storage.get(recorderKey)).toEqual({ deviceId: "headset" });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await click("micStart");
    expect(getUserMedia.mock.calls[1][0]).toMatchObject({ audio: { deviceId: { exact: "headset" } }, video: false });
    expect(created).toHaveLength(1); expect(created[0].state).toBe("recording");
  });

  it("falls back once for an unavailable saved device and explains the default-device choice", async () => {
    await open("missing-usb");
    getUserMedia.mockRejectedValueOnce(new DOMException("missing", "OverconstrainedError"));
    await click("micStart");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ audio: { deviceId: { exact: "missing-usb" } } });
    expect(getUserMedia.mock.calls[1][0].audio).not.toHaveProperty("deviceId");
    expect(storage.get(recorderKey)).toEqual({ deviceId: "" });
    expect(element<HTMLSelectElement>("micDevice").value).toBe("");
    expect(element("practiceStatus").textContent).toContain("系统默认");
    expect(created).toHaveLength(1);
  });

  it("does not silently change microphones after permission denial and permits explicit retry", async () => {
    devices = [deviceInfo("usb", "USB 麦克风")]; await open("usb");
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await click("micStart");
    expect(getUserMedia).toHaveBeenCalledTimes(1); expect(created).toHaveLength(0);
    expect(element("practiceStatus").textContent).toContain("未获允许");
    expect(element<HTMLButtonElement>("micStart").disabled).toBe(false);
    expect(storage.get(recorderKey)).toEqual({ deviceId: "usb" });
    await click("micStart"); expect(created).toHaveLength(1);
    expect(getUserMedia.mock.calls[1][0]).toMatchObject({ audio: { deviceId: { exact: "usb" } } });
  });

  it("refreshes after device removal without reacquiring audio or discarding the completed recording", async () => {
    devices = [deviceInfo("usb", "USB 麦克风")]; await open("usb");
    await click("micStart"); await click("micStop"); created[0].finish(); await flush();
    const savedUrl = element<HTMLAudioElement>("micAudio").src;
    devices = [deviceInfo("default", "系统默认")]; media.dispatchEvent(new Event("devicechange")); await flush();
    expect(element<HTMLSelectElement>("micDevice").value).toBe("");
    expect(storage.get(recorderKey)).toEqual({ deviceId: "" });
    expect(element("practiceStatus").textContent).toContain("已不可用");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(element<HTMLAudioElement>("micAudio").src).toBe(savedUrl);
    expect(element<HTMLButtonElement>("micSave").disabled).toBe(false);
  });

  it("retains interrupted audio and a visible device-disconnection explanation without automatic restart", async () => {
    devices = [deviceInfo("usb", "USB 麦克风")]; await open("usb"); await click("micStart");
    const ended = streams[0].getTracks()[0].onended!; devices = [deviceInfo("default", "系统默认")]; ended(); await flush();
    expect(created[0].stop).toHaveBeenCalledTimes(1); expect(getUserMedia).toHaveBeenCalledTimes(1);
    created[0].finish("interrupted-recording"); await flush();
    expect(element<HTMLButtonElement>("micSave").disabled).toBe(false);
    expect(storage.get(recorderKey)).toEqual({ deviceId: "" });
    expect(element("practiceStatus").textContent).toContain("断开");
    expect(element("practiceStatus").textContent).toContain("默认");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("does not request a fallback microphone when a rejected saved-device request arrives after closing practice", async () => {
    await open("saved-usb"); const pending = deferred<any>(); getUserMedia.mockImplementationOnce(() => pending.promise);
    await click("micStart"); await click("practiceClose"); pending.reject(new DOMException("gone", "NotFoundError")); await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0); expect(element("practice").hidden).toBe(true);
  });

  it("moves the same live practice DOM between normal and fullscreen and preserves its cue, Blob and playback", async () => {
    document.body.innerHTML = '<main class="left-container"><div id="playerWrap"><div class="bpx-player-container"><video></video><div class="bpx-player-control-bottom-right"></div></div></div></main>';
    const video = document.querySelector("video")!, full = document.querySelector(".bpx-player-container")!;
    let fullscreen: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
    shell = createStudyShell(); shell.setEnabled(true); shell.setPane("practice"); shell.mount(video); await open("", shell);
    const practice = element("practice"), audio = element<HTMLAudioElement>("micAudio");
    expect(practice.parentElement).toBe(element("practiceHome"));
    await click("micStart"); fullscreen = full; shell.mount(video);
    expect(element("practice")).toBe(practice); expect(element("micAudio")).toBe(audio);
    expect(practice.parentElement).toBe(element("learningControls")); expect(created[0].state).toBe("recording");
    expect(getUserMedia).toHaveBeenCalledTimes(1); expect(streams[0].getTracks()[0].stop).not.toHaveBeenCalled();
    await click("micStop"); created[0].finish("retained-mode-recording"); await flush(); const url = audio.src;
    fullscreen = null; shell.mount(video);
    expect(element("practice")).toBe(practice); expect(element("micAudio")).toBe(audio);
    expect(practice.parentElement).toBe(element("practiceHome")); expect(audio.src).toBe(url);
    expect(element("practiceCue").textContent).toBe(originalCue.text);
    expect(element<HTMLButtonElement>("micSave").disabled).toBe(false);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await click("micReplay"); expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    await click("micOriginal"); expect(reference).toHaveBeenCalledExactlyOnceWith(originalCue);
  });
});
