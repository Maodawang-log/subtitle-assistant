import { expect, it } from "vitest";
import { renderDictionaryResults } from "../extension/study/dictionary-view.js";

const base = { term: "暮らし", reading: "くらし", meaning: "生活方式；生活；生计\n愿能过上更好的生活。", source: "Jitendex 社区日中词典", dictionaryId: "ja-zh", version: "1" };
function render(entries: typeof base[]) {
  const target = document.createElement("div");
  renderDictionaryResults(target, entries);
  return target;
}

it("shows variant spellings together with one exact shared definition", () => {
  const entries = [{ ...base }, { ...base, term: "暮し" }, { ...base }];
  const before = JSON.stringify(entries), target = render(entries);
  expect(target.querySelectorAll("strong")).toHaveLength(1);
  expect(target.querySelector("strong")!.textContent).toBe("暮らし / 暮し · くらし");
  expect([...target.querySelectorAll("p > div")].map(el => el.textContent)).toEqual([base.meaning]);
  expect(target.querySelectorAll("small")).toHaveLength(1);
  expect(JSON.stringify(entries)).toBe(before);
});

it("preserves genuinely different definitions even when the spelling matches", () => {
  const target = render([{ ...base }, { ...base, meaning: "另一条不同释义" }]);
  expect(target.querySelectorAll("p > div")).toHaveLength(2);
});

it("does not merge different readings or dictionary provenance", () => {
  for (const patch of [{ reading: "べつ" }, { source: "另一词典" }, { dictionaryId: "other" }, { version: "2" }]) {
    expect(render([{ ...base }, { ...base, ...patch }]).querySelectorAll("strong")).toHaveLength(2);
  }
});

it("compares definitions exactly without dropping punctuation or whitespace differences", () => {
  for (const meaning of [base.meaning + " ", base.meaning.replace("；", "、")]) {
    expect(render([{ ...base }, { ...base, term: "暮し", meaning }]).querySelectorAll("strong")).toHaveLength(2);
  }
});

it("keeps dictionary text inert and replaces previous lookup results", () => {
  const target = render([{ ...base, term: "<img src=x>", meaning: "<script>bad()</script>" }]);
  expect(target.querySelector("img,script")).toBeNull();
  expect(target.textContent).toContain("<script>bad()</script>");
  renderDictionaryResults(target, [{ ...base }]);
  expect(target.querySelectorAll("strong")).toHaveLength(1);
  expect(target.textContent).not.toContain("bad()");
});
