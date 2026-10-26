import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSubtitleSelection, selectedSubtitleText } from "../extension/study/subtitle-selection.js";

let root: HTMLElement, selection: Selection;
let controller: ReturnType<typeof createSubtitleSelection> | undefined;
const onSelect = vi.fn(), onDrag = vi.fn();
let generation = 1, language: "ja" | "en" = "en";
const binding = () => generation + "|BV-fixture:1|" + language;
function selectBetween(start: Node, from: number, end: Node, to: number) {
  const range = document.createRange(); range.setStart(start, from); range.setEnd(end, to);
  selection.removeAllRanges(); selection.addRange(range);
}
function pointer(target: EventTarget, type: string, x = 0) {
  const event = new MouseEvent(type, { bubbles: true, composed: true, button: 0, clientX: x, clientY: 10 });
  Object.defineProperty(event, "pointerId", { value: 1 }); target.dispatchEvent(event);
}
const word = (id: string) => root.querySelector<HTMLElement>("#" + id)!;

beforeEach(() => {
  generation = 1; language = "en"; onSelect.mockReset(); onDrag.mockReset();
  document.body.innerHTML = '<div id="captions"><div data-study-text data-cue="cue-1" data-index="2" lang="en"><span id="first" class="token" role="button">I</span> <span id="contraction" class="token" role="button">don’t</span>  <span id="mind" class="token" role="button">mind</span>—<span id="last" class="token" role="button">really</span>.</div><div class="translation">我真的不介意。</div><button>校对</button><div data-study-text data-cue="cue-2" data-index="3" lang="en"><span id="second" class="token" role="button">State</span>-of-the-art <span id="secondLast" class="token" role="button">ideas</span>!</div></div><p id="outside">unrelated page text</p>';
  root = document.getElementById("captions")!; selection = document.getSelection()!;
  controller = createSubtitleSelection({ binding, onDrag, onSelect }); controller.bind(root);
});
afterEach(() => { controller?.destroy(); selection.removeAllRanges(); document.body.replaceChildren(); });

describe("English subtitle selection independent review", () => {
  it("preserves source spaces, smart apostrophes and punctuation between word spans", () => {
    const first = root.querySelector("[data-study-text]")!;
    selectBetween(word("first").firstChild!, 0, first.lastChild!, 1);
    expect(selectedSubtitleText(root, selection)).toEqual({ text: "I don’t  mind—really.", first: "cue-1", last: "cue-1", index: 2 });
  });

  it("keeps partial-word boundaries and English row breaks while excluding translations and controls", () => {
    selectBetween(word("contraction").firstChild!, 2, word("secondLast").firstChild!, 3);
    expect(selectedSubtitleText(root, selection)).toEqual({ text: "n’t  mind—really.\nState-of-the-art ide", first: "cue-1", last: "cue-2", index: 2 });
  });

  it("submits an English phrase only after a completed drag, preserving its resource binding", () => {
    selectBetween(word("first").firstChild!, 0, word("last").firstChild!, 6);
    pointer(word("first"), "pointerdown"); pointer(document, "pointerup");
    expect(onSelect).not.toHaveBeenCalled(); expect(onDrag).not.toHaveBeenCalled();
    pointer(word("first"), "pointerdown"); pointer(document, "pointermove", 25);
    expect(onSelect).not.toHaveBeenCalled();
    pointer(document, "pointerup", 25);
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ text: "I don’t  mind—really", first: "cue-1", last: "cue-1", index: 2 }, "1|BV-fixture:1|en");
    expect(controller!.suppressClick()).toBe(true);
  });

  it("rejects an old drag when a language epoch changes even if the source language returns to English", () => {
    selectBetween(word("first").firstChild!, 0, word("last").firstChild!, 6);
    pointer(word("first"), "pointerdown"); pointer(document, "pointermove", 25);
    language = "ja"; generation++; language = "en"; generation++;
    pointer(document, "pointerup", 25);
    expect(onSelect).not.toHaveBeenCalled();
    pointer(word("first"), "pointerdown"); pointer(document, "pointermove", 25); pointer(document, "pointerup", 25);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][1]).toBe("3|BV-fixture:1|en");
  });
});
