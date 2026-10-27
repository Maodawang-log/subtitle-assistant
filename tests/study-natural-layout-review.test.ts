import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStudyShell } from "../extension/study/ui-shell.js";
import { createInlineRecorder } from "../extension/study/inline-recorder.js";

let shell: ReturnType<typeof createStudyShell> | undefined;
let recording: ReturnType<typeof createInlineRecorder> | undefined;
let fullscreen: Element | null = null;
const labels: Record<string, string> = { prev: "上句", pause: "暂停", replay: "重播", next: "下句", loop: "循环：关", translate: "双语字幕：关", explain: "本句讲解", paragraph: "邻近几句", readPanel: "字幕 / 讲解" };
const element = <T extends HTMLElement = HTMLElement>(id: string) => shell!.$(id)! as T;
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

function nativePage(width: number, sideWidth = 350) {
  vi.stubGlobal("innerWidth", width); vi.stubGlobal("innerHeight", 850);
  document.body.innerHTML = '<main id="app" style="display:grid;gap:24px;max-width:1800px"><section class="left-container" style="width:1120px;flex:1 0 auto"><div id="playerWrap" style="height:676px;min-height:480px"><div id="bilibili-player" style="height:100%;min-height:480px"><div class="bpx-docker-major" style="height:630px"><div class="bpx-player-container" style="height:630px;min-height:360px"><video style="object-fit:contain;width:100%;height:100%"></video><div class="bpx-player-control-bottom-right"><button class="bpx-player-ctrl-setting">原生设置</button></div></div></div></div></div><div id="native-actions">原生操作区</div></section><aside class="right-container" style="width:350px;flex:0 0 auto;margin-left:20px"><div id="native-recommendations">推荐视频</div></aside></main>';
  const native = [...document.querySelectorAll<HTMLElement>("#app,.left-container,.right-container,#playerWrap,#bilibili-player,.bpx-docker-major,.bpx-player-container,video")];
  for (const node of native) vi.spyOn(node, "getBoundingClientRect").mockReturnValue({ x: 0, y: 200, top: 200, left: 0, right: node.matches(".right-container") ? sideWidth : 1120, bottom: 830, width: node.matches(".right-container") ? sideWidth : 1120, height: 630, toJSON: () => ({}) });
  shell = createStudyShell();
  return { native, video: document.querySelector("video")!, full: document.querySelector(".bpx-player-container")! };
}

// jsdom does not style Shadow DOM. Mount an exact markup clone and adapt only
// :host selectors; this checks the actual CSS cascade, not browser geometry.
function styledControls(isFullscreen = false) {
  const clone = shell!.controls.cloneNode(false) as HTMLElement;
  clone.dataset.styleReview = ""; clone.toggleAttribute("data-fullscreen", isFullscreen);
  clone.innerHTML = shell!.controls.shadowRoot!.innerHTML;
  clone.querySelectorAll("link").forEach(link => link.remove());
  const style = document.createElement("style");
  style.textContent = readFileSync("extension/study/ui.css", "utf8")
    .replaceAll(":host(:not([data-fullscreen]))", "[data-style-review]:not([data-fullscreen])")
    .replace(/:host\(([^)]+)\)/g, "[data-style-review]$1")
    .replace(/:host\b/g, "[data-style-review]");
  document.body.append(style, clone);
  return clone;
}

beforeEach(() => {
  vi.useFakeTimers(); fullscreen = null; shell = undefined; recording = undefined;
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => path }, storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } } });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
});
afterEach(() => {
  recording?.clear(); shell?.destroy(); document.body.replaceChildren();
  delete (document as any).fullscreenElement;
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("natural windowed layout independent review", () => {
  it.each([[1440, 350], [1024, 280], [820, 0]])("preserves native player dimensions, video fit and column flex at viewport %ipx", (width, sideWidth) => {
    const { native, video } = nativePage(width, sideWidth);
    const originals = native.map(node => ({ node, style: node.style.cssText, parent: node.parentNode }));
    shell!.setEnabled(true); shell!.setPane("practice");
    for (let i = 0; i < 4; i++) shell!.mount(video);
    for (const { node, style, parent } of originals) {
      expect(node.style.cssText, node.tagName + "#" + node.id + "." + node.className).toBe(style);
      expect(node.parentNode).toBe(parent);
    }
    expect(shell!.slot.previousElementSibling?.id).toBe("playerWrap");
    expect(shell!.slot.nextElementSibling?.id).toBe("native-actions");
    expect(shell!.controls.parentElement).toBe(shell!.slot);
    expect(document.getElementById("playerWrap")!.contains(shell!.controls)).toBe(false);
    expect(shell!.host.hasAttribute("data-below")).toBe(sideWidth === 0);
    expect(shell!.host.parentElement).toBe(sideWidth ? document.querySelector(".right-container") : shell!.slot);
    shell!.setEnabled(false); shell!.mount(video);
    for (const { node, style } of originals) expect(node.style.cssText).toBe(style);
    expect(document.getElementById("native-recommendations")!.style.display).toBe("");
  });

  it("keeps full button labels at readable sizes and allows natural toolbar wrapping", () => {
    const { video } = nativePage(1440); shell!.setEnabled(true); shell!.mount(video);
    const clone = styledControls(), toolbar = clone.querySelector<HTMLElement>(".toolbar")!;
    for (const [id, text] of Object.entries(labels)) {
      const button = clone.querySelector<HTMLButtonElement>("#" + id)!;
      const style = getComputedStyle(button);
      expect(button.textContent).toContain(text);
      expect(style.display, id).not.toBe("none");
      expect(parseFloat(style.fontSize), id).toBeGreaterThanOrEqual(13);
      expect(parseFloat(style.minHeight), id).toBeGreaterThanOrEqual(36);
      expect(parseFloat(style.minHeight), id).toBeLessThanOrEqual(40);
      expect(style.maxHeight, id).not.toMatch(/^\d/);
    }
    for (const group of [toolbar, ...clone.querySelectorAll<HTMLElement>(".transport,.actions")]) expect(getComputedStyle(group).flexWrap).toBe("wrap");
    expect(getComputedStyle(toolbar).maxHeight).not.toMatch(/^\d/);
    expect(getComputedStyle(toolbar).overflow).not.toBe("hidden");
    expect(getComputedStyle(clone.querySelector("#record")!).display).toBe("none");
    expect(getComputedStyle(clone.querySelector("#stopStudy")!).display).toBe("none");
    expect(shell!.shadow.querySelectorAll('[data-pane="practice"]')).toHaveLength(1);
  });

  it("retains fullscreen text controls and the existing recorder action order", () => {
    nativePage(1440);
    const clone = styledControls(true);
    for (const id of [...Object.keys(labels), "record", "stopStudy"]) {
      const button = clone.querySelector<HTMLButtonElement>("#" + id)!;
      expect(getComputedStyle(button).display, id).not.toBe("none");
      expect(parseFloat(getComputedStyle(button).fontSize), id).toBeGreaterThanOrEqual(13);
    }
    expect([...clone.querySelectorAll(".practice-actions button")].map(button => button.id)).toEqual(["micStart", "micStop", "micReplay", "micSave", "micOriginal"]);
    for (const label of clone.querySelectorAll(".practice-intro,.practice-cue-label,.practice-original-label,.practice-recording-label")) expect(getComputedStyle(label).display).toBe("none");
    expect(getComputedStyle(clone.querySelector(".practice-current")!).display).toBe("contents");
    expect(getComputedStyle(clone.querySelector(".practice-actions")!).display).toBe("flex");
  });

  it("gives the normal practice view a current-sentence card and separate reference and recording sections", () => {
    nativePage(1440);
    const clone = styledControls(), current = clone.querySelector(".practice-current")!;
    expect(current.contains(clone.querySelector("#practiceCue"))).toBe(true);
    expect(getComputedStyle(current).display).toBe("block");
    expect(getComputedStyle(current).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(parseFloat(getComputedStyle(current).paddingTop)).toBeGreaterThanOrEqual(12);
    for (const [selector, text] of [[".practice-cue-label", "当前句"], [".practice-original-label", "原声"], [".practice-recording-label", "我的录音"]]) {
      const label = clone.querySelector(selector)!;
      expect(label.textContent).toBe(text); expect(getComputedStyle(label).display).not.toBe("none");
    }
    expect(getComputedStyle(clone.querySelector(".practice-actions")!).display).toBe("grid");
    for (const id of ["micStart", "micStop", "micOriginal", "micReplay", "micSave"]) expect(parseFloat(getComputedStyle(clone.querySelector("#" + id)!).minHeight)).toBeGreaterThanOrEqual(36);
    expect(clone.querySelectorAll("#practice")).toHaveLength(1);
    expect(clone.querySelector("meter,[role=meter],canvas")).toBeNull();
  });

  it("moves one live practice card and audio element through fullscreen without losing a recording", async () => {
    const { video, full } = nativePage(1440);
    const track = { stop: vi.fn(), onended: null };
    const stream = { getTracks: () => [track] };
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("navigator", { mediaDevices: Object.assign(new EventTarget(), { getUserMedia, enumerateDevices: vi.fn(async () => []) }) });
    class FakeRecorder {
      static isTypeSupported() { return true; }
      state = "inactive"; mimeType = "audio/webm";
      ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["mock-recording"]) }); this.onstop?.(); }
    }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    const createObjectURL = vi.fn(() => "blob:natural-layout-review"), revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL; });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {});
    shell!.setEnabled(true); shell!.setPane("practice"); shell!.mount(video);
    const reference = vi.fn(async (_cue: unknown) => {}), cue = { start: 12.4, end: 15.8, text: "力強い言葉で話します。" };
    recording = createInlineRecorder(shell, reference, vi.fn()); recording.open(cue); await flush();
    const practice = element("practice"), audio = element<HTMLAudioElement>("micAudio");
    expect(practice.parentElement).toBe(element("practiceHome"));
    expect(getUserMedia).not.toHaveBeenCalled();
    element("micStart").click(); await flush();
    fullscreen = full; shell!.mount(video);
    expect(element("practice")).toBe(practice); expect(element("micAudio")).toBe(audio);
    expect(practice.parentElement).toBe(element("practiceHome"));
    expect(track.stop).not.toHaveBeenCalled();
    expect(element<HTMLButtonElement>("micStop").disabled).toBe(false);
    element("micStop").click(); await flush();
    const savedUrl = audio.src;
    shell!.setPane("subtitles"); shell!.mount(video);
    expect(practice.parentElement).toBe(element("learningControls"));
    expect(element("micAudio")).toBe(audio); expect(audio.src).toBe(savedUrl);
    expect(element<HTMLButtonElement>("micSave").disabled).toBe(false);
    shell!.setPane("practice"); shell!.mount(video);
    expect(practice.parentElement).toBe(element("practiceHome")); expect(audio.src).toBe(savedUrl);
    fullscreen = null; shell!.mount(video);
    expect(element("practice")).toBe(practice); expect(element("micAudio")).toBe(audio);
    expect(practice.parentElement).toBe(element("practiceHome"));
    expect(audio.src).toBe(savedUrl); expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(element("practiceCue").textContent).toBe(cue.text);
    expect(element<HTMLButtonElement>("micSave").disabled).toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(1); expect(revokeObjectURL).not.toHaveBeenCalled();
    element("micReplay").click(); await flush(); expect(play).toHaveBeenCalledTimes(1);
    element("micOriginal").click(); await flush(); expect(reference).toHaveBeenCalledExactlyOnceWith(cue);
  });
});
