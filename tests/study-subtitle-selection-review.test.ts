import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSubtitleSelection, selectedSubtitleText } from "../extension/study/subtitle-selection.js";

let root: HTMLElement, selection: Selection;
let controller: ReturnType<typeof createSubtitleSelection> | undefined;
let resource: string;
const select = vi.fn(), pause = vi.fn();
function pointer(target: EventTarget, type: string, x = 0) {
  const event = new MouseEvent(type, { bubbles: true, composed: true, button: 0, clientX: x, clientY: 10 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}
function range(start: Node, startOffset: number, end: Node, endOffset: number) {
  const value = document.createRange();
  value.setStart(start, startOffset); value.setEnd(end, endOffset);
  selection.removeAllRanges(); selection.addRange(value);
}
function gesture() {
  pointer(root.querySelector("ruby")!, "pointerdown");
  pointer(document, "pointermove", 20);
  pointer(document, "pointerup", 20);
}
beforeEach(() => {
  document.body.innerHTML = '<div id="captions"><div data-study-text data-cue="cue-1" data-index="2"><span><ruby>暮らし<rt>くらし</rt></ruby></span><span><ruby>に</ruby></span><span><ruby>広がる<rt>ひろがる</rt></ruby></span></div><div class="translation">扩展到生活中</div><div data-study-text data-cue="cue-2" data-index="3">変化です。</div></div><p id="outside">普通网页文字</p>';
  root = document.getElementById("captions")!;
  selection = document.getSelection()!;
  resource = "video-1:part-1"; select.mockReset(); pause.mockReset();
  controller = createSubtitleSelection({ binding: () => resource, onDrag: pause, onSelect: select });
  controller.bind(root);
});
afterEach(() => { controller?.destroy(); selection.removeAllRanges(); document.body.replaceChildren(); });

it("reads a continuous phrase across words while excluding ruby pronunciation", () => {
  const words = root.querySelectorAll("ruby");
  range(words[0].firstChild!, 0, words[2].firstChild!, 3);
  expect(selectedSubtitleText(root, selection)).toEqual({ text: "暮らしに広がる", first: "cue-1", last: "cue-1", index: 2 });
});

it("preserves partial-word boundaries and separates selected subtitle rows", () => {
  const start = root.querySelector("ruby")!.firstChild!;
  const end = root.querySelectorAll("[data-study-text]")[1].firstChild!;
  range(start, 1, end, 2);
  expect(selectedSubtitleText(root, selection)?.text).toBe("らしに広がる\n変化");
});

it("ignores selections outside captions, Chinese-only selections, and empty clicks", () => {
  const outside = document.getElementById("outside")!.firstChild!;
  range(outside, 0, outside, 2);
  expect(selectedSubtitleText(root, selection)).toBeNull();
  const chinese = root.querySelector(".translation")!.firstChild!;
  range(chinese, 0, chinese, 2);
  expect(selectedSubtitleText(root, selection)).toBeNull();
  range(root.querySelector("ruby")!.firstChild!, 0, root.querySelector("ruby")!.firstChild!, 0);
  expect(selectedSubtitleText(root, selection)).toBeNull();
});

it("requests once on mouse release, never for a plain single-word click or during movement", () => {
  const words = root.querySelectorAll("ruby");
  range(words[0].firstChild!, 0, words[2].firstChild!, 3);
  pointer(words[0], "pointerdown"); pointer(document, "pointerup");
  expect(select).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
  pointer(words[0], "pointerdown"); pointer(document, "pointermove", 20); pointer(document, "pointermove", 30);
  expect(pause).toHaveBeenCalledTimes(1); expect(select).not.toHaveBeenCalled();
  pointer(document, "pointerup", 30); pointer(document, "pointerup", 30);
  expect(select).toHaveBeenCalledTimes(1);
  expect(select.mock.calls[0][0].text).toBe("暮らしに広がる");
  expect(controller!.suppressClick()).toBe(true);
});

it("allows the same phrase to be selected again after an unsuccessful request", () => {
  const words = root.querySelectorAll("ruby");
  range(words[0].firstChild!, 0, words[2].firstChild!, 3);
  gesture(); gesture();
  expect(select).toHaveBeenCalledTimes(2);
});

it("drops a canceled gesture or one from a video that changed while dragging", () => {
  const words = root.querySelectorAll("ruby");
  range(words[0].firstChild!, 0, words[2].firstChild!, 3);
  pointer(words[0], "pointerdown"); pointer(document, "pointermove", 20);
  resource = "video-2:part-1"; pointer(document, "pointerup", 20);
  expect(select).not.toHaveBeenCalled();
  pointer(words[0], "pointerdown"); pointer(document, "pointermove", 20);
  pointer(document, "pointercancel", 20); pointer(document, "pointerup", 20);
  expect(select).not.toHaveBeenCalled();
});
