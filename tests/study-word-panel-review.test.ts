import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWordPanel } from "../extension/study/word-panel.js";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

const key = "biliscriptStudyVocabulary";
const word = (term: string) => ({ surface_form: term, basic_form: term, reading: "くらし", pos: "名詞" });
const source = { sentence: "私たちの暮らしに広がる変化です。", url: "https://www.bilibili.com/video/BV1Qtnt6JEy8/?p=1", time: 12.7 };
let storage: Map<string, unknown>, panel: ReturnType<typeof createWordPanel>, lookup: ReturnType<typeof vi.fn>;
const $ = (id: string) => document.getElementById(id)!;
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
function make(seed: unknown[] = []) {
  storage.set(key, seed);
  const area = createMemoryStorageArea(storage);
  vi.stubGlobal("chrome", { storage: { local: area, onChanged: { addListener: vi.fn() } } });
  panel = createWordPanel({ $ }, { binding: () => "video-1", fallback: () => undefined, lookup, error: vi.fn() });
}
beforeEach(() => {
  document.body.innerHTML = '<div id="wordDetail"></div><div id="wordList"></div><button id="exportWords"></button>';
  storage = new Map();
  lookup = vi.fn(async (queries: string[]) => ({ ok: true, entries: [{ term: queries[0], reading: "くらし", meaning: "生活；生计", source: "日中词典", dictionaryId: "ja-zh", version: "1" }] }));
  vi.stubGlobal("JSTUDY", { hiragana: (text: string) => text, conjugation: () => "" });
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("keeps old favorites, starts with collapsed details, and does not invent a video source", async () => {
  const old = { term: "暮らし", reading: "くらし", meaning: "旧收藏的完整释义", at: 1 };
  make([old]); await flush();
  expect(panel.items).toEqual([old]);
  expect($("wordList").querySelectorAll(".saved-word")).toHaveLength(1);
  expect($("wordList").querySelector("details")!.open).toBe(false);
  expect($("wordList").textContent).toContain(old.meaning);
  expect($("wordList").querySelector("a")).toBeNull();
  expect(storage.get(key)).toEqual([old]);
});

it("lets the heading star save and un-save the word with its exact original context", async () => {
  make(); await flush(); await panel.show([word("暮らし")], source);
  const star = $("wordDetail").querySelector<HTMLButtonElement>(".word-star")!;
  expect(star.getAttribute("aria-pressed")).toBe("false");
  star.click(); await flush();
  expect(star.getAttribute("aria-pressed")).toBe("true");
  const saved = storage.get(key) as any[];
  expect(saved).toHaveLength(1); expect(saved[0].source).toEqual(source);
  expect(saved[0].meaning).toContain("生活；生计");
  const link = $("wordList").querySelector<HTMLAnchorElement>(".source-link")!;
  expect(new URL(link.href).searchParams.get("t")).toBe("12");
  expect(new URL(link.href).searchParams.get("p")).toBe("1");
  star.click(); await flush();
  expect(storage.get(key)).toEqual([]);
  expect(star.getAttribute("aria-pressed")).toBe("false");
});

it("shows the selected words separately and merges identical spelling-variant definitions within one word", async () => {
  lookup.mockImplementation(async (queries: string[]) => ({ ok: true, entries: [
    { term: queries[0], reading: "くらし", meaning: "生活；生计", source: "日中词典", dictionaryId: "ja-zh", version: "1" },
    { term: "暮し", reading: "くらし", meaning: "生活；生计", source: "日中词典", dictionaryId: "ja-zh", version: "1" }
  ] }));
  make(); await flush();
  await panel.show([word("暮らし"), word("変化"), word("暮らし"), { ...word("。"), pos: "記号" }], source);
  expect($("wordDetail").querySelectorAll(".word-card")).toHaveLength(2);
  expect(lookup).toHaveBeenCalledTimes(2);
  const first = $("wordDetail").querySelector(".word-card")!;
  expect(first.querySelector(".word-meaning strong")!.textContent).toBe("暮らし / 暮し · くらし");
  expect(first.querySelectorAll(".word-meaning p > div")).toHaveLength(1);
});

it("stores the final favorite state after rapid star toggles", async () => {
  make(); await flush(); await panel.show([word("暮らし")], source);
  const star = $("wordDetail").querySelector<HTMLButtonElement>(".word-star")!;
  star.click(); star.click(); star.click(); await flush();
  expect((storage.get(key) as any[]).map(item => item.term)).toEqual(["暮らし"]);
});

it("renders glossary text inertly and rejects unsafe origin links", async () => {
  make([{ term: "<img src=x>", reading: "", meaning: "<script>bad()</script>", source: { ...source, url: "javascript:bad()" } }]);
  await flush();
  expect($("wordList").querySelector("img,script,a")).toBeNull();
  expect($("wordList").textContent).toContain("<script>bad()</script>");
});
