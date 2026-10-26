import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

vi.mock("../extension/study/local-proxy.bg.js", () => ({}));
vi.mock("../extension/study/native-source.bg.js", () => ({}));
vi.mock("../extension/study/model-manager.bg.js", () => ({}));
let handle: any, disk: Map<string, any>, fetcher: ReturnType<typeof vi.fn>, counter: number;
const sender = { id: "root-language-review", tab: { id: 71 } };
const answer = (content: string) => ({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }] }) });
function request(patch: any = {}) {
  return new Promise<any>(resolve => handle({ type: "study-ai", kind: "translate", channel: "translation", text: "AI", context: "Review context", resource: "BV1test000000:111", language: "en", requestId: String(++counter), ...patch }, sender, resolve));
}
beforeEach(async () => {
  vi.resetModules(); counter = 0;
  disk = new Map([["biliscriptJapaneseSettings", { sourceLanguage: "en", apiKey: "synthetic-language-review", model: "fixture", baseUrl: "https://compatible.example/v1" }]]);
  fetcher = vi.fn(async () => answer("独立测试结果")); vi.stubGlobal("fetch", fetcher); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("chrome", { runtime: { id: sender.id, getURL: (path: string) => `chrome-extension://${sender.id}/${path}`, onMessage: { addListener: (listener: any) => { handle = listener; } } },
    storage: { local: createMemoryStorageArea(disk) }, action: { onClicked: { addListener: vi.fn() } }, tabs: { onRemoved: { addListener: vi.fn() } } });
  await import("../extension/study/background.js");
});
afterEach(() => { handle({ type: "study-stop-ai" }, sender, () => {}); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("publishes the saved English default without leaking a provider secret", async () => {
  const result = await new Promise<any>(resolve => handle({ type: "study-settings-public" }, sender, resolve));
  expect(result).toMatchObject({ ok: true, config: { sourceLanguage: "en", configured: true, autoStart: false, autoTranslate: false } });
  expect(JSON.stringify(result)).not.toContain("synthetic-language-review");
  expect(fetcher).not.toHaveBeenCalled();
});

it("requests English-to-Chinese translation and language-correct word explanation", async () => {
  expect(await request()).toMatchObject({ ok: true });
  const translation = JSON.parse(String(fetcher.mock.calls[0][1].body));
  expect(translation.messages[0].content).toContain("英语");
  expect(translation.messages[0].content).toContain("简体中文");
  expect(translation.messages[0].content).not.toContain("日语");
  expect(JSON.parse(translation.messages[1].content)).toEqual({ text: "AI", context: "Review context" });
  expect(await request({ kind: "word", channel: "selection", text: "running" })).toMatchObject({ ok: true });
  const word = JSON.parse(String(fetcher.mock.calls[1][1].body));
  expect(word.messages[0].content).toContain("英语词");
  expect(word.messages[0].content).not.toContain("这个日语词");
});

it("does not share identical text results across Japanese and English caches", async () => {
  expect(await request({ language: "ja" })).toMatchObject({ ok: true, fromCache: false });
  expect(await request({ language: "en" })).toMatchObject({ ok: true, fromCache: false });
  expect(await request({ language: "ja" })).toMatchObject({ ok: true, fromCache: true });
  expect(await request({ language: "en" })).toMatchObject({ ok: true, fromCache: true });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(Object.keys(disk.get("biliscriptJapaneseAiCache"))).toHaveLength(2);
});

it("rejects unsupported source language before any provider request", async () => {
  expect(await request({ language: "ko" })).toMatchObject({ ok: false });
  expect(fetcher).not.toHaveBeenCalled();
  expect(disk.get("biliscriptJapaneseAiCache")).toBeUndefined();
});

it("does not cache a delayed English response after the tab cancels language work", async () => {
  let finish!: (value: any) => void;
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = request();
  for (let n = 0; n < 100 && !finish; n++) await new Promise(resolve => setTimeout(resolve, 1));
  expect(finish).toBeTypeOf("function");
  handle({ type: "study-stop-ai" }, sender, () => {});
  finish(answer("不应显示的旧语言结果"));
  expect(await pending).toMatchObject({ ok: false, canceled: true });
  expect(disk.get("biliscriptJapaneseAiCache")).toBeUndefined();
});
