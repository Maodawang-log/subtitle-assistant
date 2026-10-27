import "./helpers/study-learning-store-host.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWordPanel } from "../extension/study/word-panel.js";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

const $ = (id: string) => document.getElementById(id)!;
const token = { surface_form: "test", basic_form: "test", reading: "", pos: "" };
let language: "ja" | "en", disk: Map<string, any>, lookup: ReturnType<typeof vi.fn>, panel: ReturnType<typeof createWordPanel>;
async function flush() { for (let n = 0; n < 24; n++) await Promise.resolve(); }
const star = () => $("wordDetail").querySelector<HTMLButtonElement>(".word-star")!;
beforeEach(async () => {
  language = "ja";
  disk = new Map([["biliscriptStudyVocabulary", [{ term: "test", reading: "", meaning: "旧日语收藏", at: 1 }]]]);
  vi.stubGlobal("chrome", { storage: { local: createMemoryStorageArea(disk), onChanged: { addListener: vi.fn() } } });
  vi.stubGlobal("JSTUDY", { hiragana: (value: string) => value, conjugation: () => "" });
  document.body.innerHTML = '<div id="wordDetail"></div><div id="wordList"></div><button id="exportWords"></button>';
  lookup = vi.fn(async (_queries, selectedLanguage) => ({ ok: true, entries: [{ term: "test", reading: "", meaning: selectedLanguage === "en" ? "英语释义" : "日语释义", source: "Review dictionary" }] }));
  panel = createWordPanel({ $ }, { binding: () => "video:" + language, language: () => language, fallback: () => undefined, lookup, error: vi.fn() });
  await flush();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("keeps a legacy Japanese favorite separate from the same spelling in English", async () => {
  language = "en";
  await panel.show([token], { language, sentence: "This is a test.", url: "https://www.bilibili.com/video/BV1test000000/", time: 1 });
  expect(lookup.mock.calls[0][1]).toBe("en");
  expect(star().getAttribute("aria-pressed")).toBe("false");
  star().click(); await flush();
  const saved = disk.get("biliscriptStudyVocabulary");
  expect(saved).toHaveLength(2);
  expect(saved.some((item: any) => item.term === "test" && item.language === "en")).toBe(true);
  expect(saved.some((item: any) => item.meaning === "旧日语收藏")).toBe(true);
  expect(star().getAttribute("aria-pressed")).toBe("true");
  star().click(); await flush();
  expect(disk.get("biliscriptStudyVocabulary")).toHaveLength(1);
  expect(disk.get("biliscriptStudyVocabulary")[0].meaning).toBe("旧日语收藏");
});

it("still recognizes legacy favorites as Japanese and removes only that language", async () => {
  language = "ja";
  await panel.show([token], { language, sentence: "test", time: 1 });
  expect(lookup.mock.calls[0][1]).toBe("ja");
  expect(star().getAttribute("aria-pressed")).toBe("true");
  star().click(); await flush();
  expect(disk.get("biliscriptStudyVocabulary")).toEqual([]);
});

it("does not publish a delayed word lookup into a different language result", async () => {
  let finish!: (value: any) => void;
  lookup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  language = "ja";
  const old = panel.show([token], { language, sentence: "test" });
  language = "en";
  await panel.show([token], { language, sentence: "This is a test." });
  finish({ ok: true, entries: [{ term: "test", meaning: "STALE JAPANESE RESPONSE", source: "review" }] });
  await old;
  expect($("wordDetail").textContent).not.toContain("STALE JAPANESE RESPONSE");
  expect($("wordDetail").textContent).toContain("英语释义");
});
