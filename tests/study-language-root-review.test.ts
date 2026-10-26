import { describe, expect, it, vi } from "vitest";
import { createJapaneseCcSource } from "../extension/study/cc-source.js";
import { importStorageKey, isSourceTrack, tokenizeEnglish } from "../extension/study/source-language.js";

const url = "https://www.bilibili.com/video/BV1test000000/";
const meta = { code: 0, data: { aid: 123, title: "English review", cid: 111, pages: [{ page: 1, cid: 111 }] } };
const track = (lan: string, id: string) => ({ id: 1, id_str: id, lan, subtitle_url: `//aisubtitle.hdslb.com/bfs/ai_subtitle/${lan}.json` });
const bundle = (tracks: unknown[]) => ({ code: 0, data: { subtitle: { subtitles: tracks } } });
function source(tracks: unknown[]) {
  const fetchJson = vi.fn(async (requested: string) => requested.includes("web-interface/view") ? meta : requested.includes("/x/player/") ? bundle(tracks) :
    { body: [{ from: 1, to: 4, content: requested.includes("/zh-CN.json") ? "中文对照" : requested.includes("/ja.json") ? "日本語です。" : "Don't change the original." }] });
  return { fetchJson, get: createJapaneseCcSource({ currentUrl: () => url, fetchJson }) };
}

describe("independent English source and Japanese isolation review", () => {
  it("does not fetch until invoked and selects native regional English over Japanese and AI English", async () => {
    const { get, fetchJson } = source([track("ja", "1"), track("ai-en", "2"), track("en-US", "9007199254740999"), track("zh-CN", "4")]);
    expect(fetchJson).not.toHaveBeenCalled();
    const result = await get({ language: "en", signal: new AbortController().signal });
    expect(result).toMatchObject({ status: "ready", selectedTrackId: "9007199254740999", cues: [{ from: 1, to: 4, content: "Don't change the original." }] });
    expect(fetchJson.mock.calls.at(-1)![0]).toContain("/en-US.json");
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it("never uses Japanese or Chinese as English source text when no English track exists", async () => {
    const { get, fetchJson } = source([track("ja", "1"), track("zh-CN", "4")]);
    const result = await get({ language: "en", signal: new AbortController().signal, includeChinese: true });
    expect(result.status).not.toBe("ready"); expect(result.cues).toEqual([]);
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("rejects a preferred track from the other source language instead of silently relabeling it", async () => {
    const { get, fetchJson } = source([track("ja", "1"), track("en", "2")]);
    await expect(get({ language: "en", preferredTrackId: "1", signal: new AbortController().signal })).rejects.toThrow();
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("loads a Chinese reference only alongside the requested English original", async () => {
    const { get, fetchJson } = source([track("ja", "1"), track("ai-en", "2"), track("zh-CN", "3")]);
    const result = await get({ language: "en", includeChinese: true, signal: new AbortController().signal });
    expect(result).toMatchObject({ status: "ready", selectedTrackId: "2", chineseCues: [{ from: 1, to: 4, content: "中文对照" }] });
    expect(fetchJson.mock.calls[2][0]).toContain("/ai-en.json");
    expect(fetchJson.mock.calls[3][0]).toContain("/zh-CN.json");
  });

  it("retains Japanese as the compatibility default without selecting an English track", async () => {
    const { get, fetchJson } = source([track("en", "1"), track("ja", "2")]);
    expect((await get({ signal: new AbortController().signal })).selectedTrackId).toBe("2");
    expect(fetchJson.mock.calls.at(-1)![0]).toContain("/ja.json");
  });

  it("keeps language-specific imported subtitle storage distinct for one video", () => {
    expect(importStorageKey("BV1test000000:p1", "ja")).not.toBe(importStorageKey("BV1test000000:p1", "en"));
    expect(importStorageKey("BV1test000000:p2", "en")).not.toBe(importStorageKey("BV1test000000:p1", "en"));
  });

  it("preserves English spaces, contractions, punctuation and mixed-case source while splitting words", () => {
    const text = "Don't  re-enter NASA’s co-op!\nVersion 2.0 — okay?";
    const tokens = tokenizeEnglish(text);
    expect(tokens.map(token => token.surface_form).join("")).toBe(text);
    const words = tokens.filter(token => token.pos !== "記号");
    expect(words.map(token => token.surface_form)).toContain("Don't");
    expect(words.map(token => token.surface_form)).toContain("NASA’s");
    expect(words.find(token => token.surface_form === "NASA’s")?.basic_form).toBe("nasa’s");
    expect(words.every(token => token.reading === "")).toBe(true);
  });

  it("matches complete language codes rather than similar language prefixes", () => {
    for (const lan of ["en", "en-US", "en_GB", "ai-en", "ai-en-US"]) expect(isSourceTrack({ lan }, "en")).toBe(true);
    for (const lan of ["ja", "ai-ja", "zh-en", "english", "enough", "fr"]) expect(isSourceTrack({ lan }, "en")).toBe(false);
  });
});
