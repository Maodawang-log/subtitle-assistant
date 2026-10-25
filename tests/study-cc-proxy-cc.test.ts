import { describe, expect, it, vi } from "vitest";
import { createJapaneseCcSource, fetchStudyBiliJson, StudyCcError } from "../extension/study/cc-source.js";

const base = "https://www.bilibili.com/video/BV1test000000/";
const meta = { code: 0, data: { aid: 123, title: "日本語", cid: 111,
  pages: [{ page: 1, cid: 111 }, { page: 2, cid: 222, part: "後編" }] } };
function track(lan: string, id: string) {
  return { id: 9007199254740992, id_str: id, lan, subtitle_url: `//aisubtitle.hdslb.com/bfs/ai_subtitle/${lan}.json?auth_key=private` };
}
const bundle = (tracks: unknown[]) => ({ code: 0, data: { subtitle: { subtitles: tracks } } });
const body = { body: [{ from: 4, to: 5, content: " 二番 " }, { from: 1, to: 2, content: "一番" }] };

describe("passive Japanese CC source", () => {
  it("has no request before invocation, resolves P2 from authoritative pages, preserves exact track IDs", async () => {
    const fetchJson = vi.fn(async (url: string) => url.includes("web-interface/view") ? meta :
      url.includes("/x/player/") ? bundle([track("ai-ja", "9007199254740993"), track("ja", "9007199254740995"), track("zh-CN", "3")]) : body);
    const get = createJapaneseCcSource({ currentUrl: () => `${base}?p=2`, fetchJson });
    expect(fetchJson).not.toHaveBeenCalled();
    const result = await get({ signal: new AbortController().signal });
    expect(result).toMatchObject({ status: "ready", cid: "222", title: "日本語 · 後編", selectedTrackId: "9007199254740995",
      cues: [{ from: 1, to: 2, content: "一番" }, { from: 4, to: 5, content: "二番" }] });
    expect(fetchJson.mock.calls[1][0]).toContain("/x/player/wbi/v2?aid=123&cid=222");
    expect(fetchJson.mock.calls[2][0]).toContain("/ja.json");
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it("returns no-japanese for Chinese-only tracks without fetching or reverse translating Chinese", async () => {
    const fetchJson = vi.fn(async (url: string) => url.includes("web-interface/view") ? meta : bundle([track("zh-CN", "3")]));
    const result = await createJapaneseCcSource({ currentUrl: () => base, fetchJson })({ signal: new AbortController().signal });
    expect(result).toMatchObject({ status: "no-japanese", cid: "111", cues: [] });
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("lets the session choose ai-ja and loads Chinese only when explicitly requested", async () => {
    const fetchJson = vi.fn(async (url: string) => url.includes("web-interface/view") ? meta :
      url.includes("/x/player/") ? bundle([track("ja", "1"), track("ai-ja", "2"), track("zh-CN", "3")]) : body);
    const result = await createJapaneseCcSource({ currentUrl: () => base, fetchJson })({ signal: new AbortController().signal,
      preferredTrackId: "2", includeChinese: true });
    expect(result.selectedTrackId).toBe("2");
    expect(result.chineseCues).toEqual(result.cues);
    expect(fetchJson.mock.calls[2][0]).toContain("/ai-ja.json");
    expect(fetchJson.mock.calls[3][0]).toContain("/zh-CN.json");
  });

  it("does not treat an API failure or malformed track list as missing Japanese", async () => {
    for (const broken of [{ code: -101, message: "未登录" }, { code: 0, data: {} }]) {
      const fetchJson = vi.fn(async (url: string) => url.includes("web-interface/view") ? meta : broken);
      await expect(createJapaneseCcSource({ currentUrl: () => base, fetchJson })({ signal: new AbortController().signal })).rejects.toThrow();
    }
  });

  it("keeps ready Japanese when optional Chinese is empty or fails, but still propagates cancellation", async () => {
    for (const failure of ["empty", "403", "abort", "page-change"]) {
      let current = base;
      const fetchJson = vi.fn(async (url: string) => {
        if (url.includes("web-interface/view")) return meta;
        if (url.includes("/x/player/")) return bundle([track("ja", "1"), track("zh-CN", "3")]);
        if (url.includes("/zh-CN.json")) {
          if (failure === "empty") return { body: [] };
          if (failure === "abort") throw new DOMException("cancelled", "AbortError");
          if (failure === "page-change") current = `${base}?p=2`;
          throw new Error("HTTP 403");
        }
        return body;
      });
      const promise = createJapaneseCcSource({ currentUrl: () => current, fetchJson })({
        signal: new AbortController().signal, includeChinese: true
      });
      if (failure === "abort" || failure === "page-change") {
        await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      } else {
        const result = await promise;
        expect(result.status).toBe("ready");
        expect(result.cues).toHaveLength(2);
        expect(result.chineseCues).toEqual([]);
        expect(result.chineseWarning).toBeTruthy();
      }
    }
  });

  it("does not fall back to P1 for unavailable or invalid page numbers", async () => {
    const fetchJson = vi.fn(async () => meta);
    for (const page of ["3", "1.5", "bad", "0"]) {
      await expect(createJapaneseCcSource({ currentUrl: () => `${base}?p=${page}`, fetchJson })({ signal: new AbortController().signal }))
        .rejects.toBeInstanceOf(StudyCcError);
    }
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("rejects late metadata on a P change before status callbacks or more requests", async () => {
    let current = base;
    const statuses: string[] = [];
    let finish!: (value: unknown) => void;
    const fetchJson = vi.fn(() => new Promise<unknown>((resolve) => { finish = resolve; }));
    const promise = createJapaneseCcSource({ currentUrl: () => current, fetchJson })({ signal: new AbortController().signal,
      onStatus: (text) => statuses.push(text) });
    current = `${base}?p=2`;
    finish(meta);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(statuses).toHaveLength(1);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("cancels the real SW transport immediately and ignores its late response", async () => {
    let response!: (value: unknown) => void;
    const send = vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(((message: { type: string }, callback?: (value: unknown) => void) => {
      if (message.type === "study-bili-request") response = callback!;
      else callback?.({ ok: true });
    }) as typeof chrome.runtime.sendMessage);
    const controller = new AbortController();
    const promise = fetchStudyBiliJson("https://api.bilibili.com/x/web-interface/view?bvid=BV1test000000", controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(send.mock.calls[1][0]).toMatchObject({ type: "study-bili-cancel" });
    response({ ok: true, data: meta });
    send.mockRestore();
  });
});
