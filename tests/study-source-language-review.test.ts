import "./helpers/study-learning-store-host.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeSourceLanguage, sourceLanguageName, isSourceTrack, tokenizeEnglish, importStorageKey } from "../extension/study/source-language.js";
import { createJapaneseCcSource } from "../extension/study/cc-source.js";
import { createWordPanel } from "../extension/study/word-panel.js";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
async function flush() { for (let i = 0; i < 32; i++) await Promise.resolve(); }
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("source language boundary independent review", () => {
  it("defaults old and invalid settings to Japanese while preserving explicit English", () => {
    for (const value of [undefined, null, "", "ja", "zh", "ko", "unknown", {}, 1]) expect(normalizeSourceLanguage(value)).toBe("ja");
    expect(normalizeSourceLanguage("en")).toBe("en");
    expect(sourceLanguageName("ja")).toBe("日语"); expect(sourceLanguageName("en")).toBe("英语");
  });

  it("matches source tracks by full language prefix without accepting unrelated languages", () => {
    for (const lan of ["ja", "jp", "ja-JP", "ai-ja", "ai-jp", "JA_jp"]) {
      expect(isSourceTrack({ lan }, "ja")).toBe(true); expect(isSourceTrack({ lan }, "en")).toBe(false);
    }
    for (const lan of ["en", "en-US", "en_GB", "ai-en", "AI-EN-us"]) {
      expect(isSourceTrack({ lan }, "en")).toBe(true); expect(isSourceTrack({ lan }, "ja")).toBe(false);
    }
    for (const lan of ["zh", "zh-CN", "ai-zh", "ko", "japanese", "english", "", "fr"]) {
      expect(isSourceTrack({ lan }, "ja")).toBe(false); expect(isSourceTrack({ lan }, "en")).toBe(false);
    }
  });

  it("partitions import keys by exact route and source language", () => {
    const route = "BV1test000000:p1", other = "BV1test000000:p2";
    const keys = [importStorageKey(route, "ja"), importStorageKey(route, "en"), importStorageKey(other, "ja"), importStorageKey(other, "en")];
    expect(new Set(keys).size).toBe(4);
    expect(keys.every(key => key.startsWith("biliscript-study-import:"))).toBe(true);
  });

  it("keeps the complete readable English subtitle through tokenization", () => {
    for (const text of ["Hello, world!", "Don't give up — it's 2026.", "A\nnew line.", "  Keep  spaces.  "]) {
      const tokens = tokenizeEnglish(text);
      expect(tokens.map((token: any) => token.surface_form).join("")).toBe(text);
      expect(tokens.filter((token: any) => /[A-Za-z]/.test(token.surface_form)).length).toBeGreaterThan(0);
    }
  });
});

describe("Japanese and English CC routing independent review", () => {
  const base = "https://www.bilibili.com/video/BV1test000000/";
  const meta = { code: 0, data: { aid: 123, title: "language fixture", cid: 111, pages: [{ page: 1, cid: 111 }] } };
  const track = (lan: string, id: string) => ({ id_str: id, lan, subtitle_url: `//aisubtitle.hdslb.com/bfs/ai_subtitle/${lan}.json?auth_key=fixture` });
  const tracks = [track("ai-en", "4"), track("ja", "1"), track("en-US", "2"), track("zh-CN", "3")];
  function fixture(available = tracks) {
    const fetchJson = vi.fn(async (url: string) => url.includes("web-interface/view") ? meta :
      url.includes("/x/player/") ? { code: 0, data: { subtitle: { subtitles: available } } } :
      { body: [{ from: 1, to: 3, content: url.includes("/ja.json") ? "日本語です。" : url.includes("/zh-CN.json") ? "中文参考。" : "English source." }] });
    return { fetchJson, get: createJapaneseCcSource({ currentUrl: () => base, fetchJson }) };
  }

  it("remains passive and keeps the old missing-language call Japanese", async () => {
    const { get, fetchJson } = fixture(); expect(fetchJson).not.toHaveBeenCalled();
    const result = await get({ signal: new AbortController().signal });
    expect(result).toMatchObject({ status: "ready", selectedTrackId: "1", cues: [{ content: "日本語です。" }] });
    expect(fetchJson.mock.calls.at(-1)![0]).toContain("/ja.json");
  });

  it("selects a human English track before AI English and keeps Chinese optional", async () => {
    const { get, fetchJson } = fixture();
    const result = await get({ signal: new AbortController().signal, language: "en", includeChinese: true });
    expect(result).toMatchObject({ status: "ready", selectedTrackId: "2", cues: [{ content: "English source." }], chineseCues: [{ content: "中文参考。" }] });
    expect(fetchJson.mock.calls.slice(2).map(([url]) => url)).toEqual([expect.stringContaining("/en-US.json"), expect.stringContaining("/zh-CN.json")]);
    expect(fetchJson.mock.calls.some(([url]) => url.includes("/ja.json"))).toBe(false);
  });

  it("accepts a current-language preferred AI track and rejects a Japanese track in English mode", async () => {
    const { get, fetchJson } = fixture();
    expect(await get({ signal: new AbortController().signal, language: "en", preferredTrackId: "4" })).toMatchObject({ status: "ready", selectedTrackId: "4" });
    expect(fetchJson.mock.calls.at(-1)![0]).toContain("/ai-en.json");
    await expect(get({ signal: new AbortController().signal, language: "en", preferredTrackId: "1" })).rejects.toMatchObject({ code: "TRACK" });
  });

  it("does not relabel Japanese or Chinese tracks as English and preserves the legacy no-Japanese status", async () => {
    const english = fixture([track("ja", "1"), track("zh-CN", "3")]);
    expect(await english.get({ signal: new AbortController().signal, language: "en" })).toMatchObject({ status: "no-source", cues: [] });
    expect(english.fetchJson).toHaveBeenCalledTimes(2);
    const japanese = fixture([track("en", "2"), track("zh-CN", "3")]);
    expect(await japanese.get({ signal: new AbortController().signal })).toMatchObject({ status: "no-japanese", cues: [] });
    expect(japanese.fetchJson).toHaveBeenCalledTimes(2);
  });
});

describe("language-owned vocabulary independent review", () => {
  const key = "biliscriptStudyVocabulary";
  const token = { surface_form: "can", basic_form: "can", reading: "", pos: "名詞" };
  const legacy = { term: "can", reading: "", meaning: "旧日语收藏", at: 1 };
  const english = { language: "en", term: "can", reading: "", meaning: "英语收藏", at: 2 };
  async function fixture(saved: any[] = [legacy], initial: "ja" | "en" = "ja") {
    let language = initial, epoch = 0;
    const disk = new Map<string, unknown>([[key, saved]]), area = createMemoryStorageArea(disk);
    const lookup = vi.fn(async (_queries: string[], current: string) => ({ ok: true, entries: [{ term: "can", reading: "", meaning: current === "en" ? "能够" : "日语释义", source: "fixture", dictionaryId: current, version: "1" }] }));
    const fallback = vi.fn(() => undefined);
    vi.stubGlobal("chrome", { storage: { local: area, onChanged: { addListener: vi.fn() } } });
    vi.stubGlobal("JSTUDY", { hiragana: vi.fn((value: string) => value), conjugation: vi.fn(() => "") });
    document.body.innerHTML = '<div id="wordDetail"></div><div id="wordList"></div><button id="exportWords"></button>';
    const panel = createWordPanel({ $ }, { language: () => language, binding: () => `${epoch}|${language}`, lookup, fallback, error: vi.fn() });
    await flush();
    return { panel, disk, area, lookup, fallback, switchLanguage(next: "ja" | "en") { language = next; epoch++; panel.reset(true); } };
  }
  const star = () => document.querySelector<HTMLButtonElement>(".word-star")!;

  it("shows legacy entries only as Japanese and keeps an English same-term entry independent", async () => {
    const { panel, disk, switchLanguage } = await fixture([legacy, english]);
    expect($("wordList").textContent).toContain("旧日语收藏"); expect($("wordList").textContent).not.toContain("英语收藏");
    await panel.show([token]); expect(star().getAttribute("aria-pressed")).toBe("true");
    star().click(); await flush();
    expect(disk.get(key)).toEqual([english]);
    switchLanguage("en"); await panel.show([token]);
    expect($("wordList").textContent).toContain("英语收藏"); expect(star().getAttribute("aria-pressed")).toBe("true");
  });

  it("saves an English same-term favorite without replacing the old Japanese favorite", async () => {
    const { panel, disk, lookup, fallback } = await fixture([legacy], "en");
    await panel.show([token]);
    expect(star().getAttribute("aria-pressed")).toBe("false");
    expect(lookup).toHaveBeenCalledWith(expect.arrayContaining(["can"]), "en");
    expect(fallback).not.toHaveBeenCalled();
    star().click(); await flush();
    const saved = disk.get(key) as any[];
    expect(saved).toHaveLength(2);
    expect(saved.map(item => item.language || "ja").sort()).toEqual(["en", "ja"]);
    expect(saved.find(item => item.language === "en")).toMatchObject({ term: "can", meaning: expect.stringContaining("能够") });
    expect(saved.find(item => !item.language || item.language === "ja")).toMatchObject(legacy);
  });

  it("removes a book entry by language and term without deleting its other-language counterpart", async () => {
    const { disk } = await fixture([legacy, english], "en");
    expect($("wordList").querySelectorAll(".saved-word")).toHaveLength(1);
    $("wordList").querySelector<HTMLButtonElement>("button")!.click(); await flush();
    const saved = disk.get(key) as any[];
    expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject(legacy);
  });

  it("ignores a late dictionary reply after the same term switches to the other language", async () => {
    const { panel, lookup, switchLanguage } = await fixture([]);
    let finish!: (value: any) => void;
    lookup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = panel.show([token]); await flush();
    switchLanguage("en"); await panel.show([token]);
    finish({ ok: true, entries: [{ term: "can", meaning: "迟到的日语释义", source: "fixture", reading: "", dictionaryId: "ja", version: "1" }] }); await old;
    expect($("wordDetail").textContent).toContain("能够"); expect($("wordDetail").textContent).not.toContain("迟到的日语释义");
    expect(lookup.mock.calls.map(([, language]) => language)).toEqual(["ja", "en"]);
  });
});
