import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

vi.mock("../extension/study/local-proxy.bg.js", () => ({}));
vi.mock("../extension/study/native-source.bg.js", () => ({}));
vi.mock("../extension/study/model-manager.bg.js", () => ({}));
let handle: any, disk: Map<string, unknown>, counter: number, fetcher: ReturnType<typeof vi.fn>;
const sender = { id: "root-proof-review", tab: { id: 7 } };
const suggestion = { status: "suggested", suggestedText: "暮らしの変化を取材しました。", reason: "上下文支持这个词形。" };
const answer = (content: string, finish_reason = "stop") => ({ ok: true, status: 200,
  headers: { get: () => "application/json" }, json: async () => ({ choices: [{ message: { content }, finish_reason }] }) });
function request(patch: any = {}) {
  return new Promise<any>(resolve => handle({ type: "study-ai", kind: "proofread", channel: "proofread", text: "暮らしの変化お取材しました。",
    context: "前の文。\n暮らしの変化お取材しました。\n後の文。", resource: "BV1ab411c7mD:111", cueRevisionKey: "cue-a:1", requestId: String(++counter), ...patch }, sender, resolve));
}
beforeEach(async () => {
  vi.resetModules(); counter = 0;
  disk = new Map([["biliscriptJapaneseSettings", { apiKey: "synthetic-review-only", model: "fixture", baseUrl: "https://compatible.example/v1" }]]);
  fetcher = vi.fn(async () => answer(JSON.stringify(suggestion))); vi.stubGlobal("fetch", fetcher); vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("chrome", { runtime: { id: sender.id, getURL: (path: string) => `chrome-extension://${sender.id}/${path}`, onMessage: { addListener: (listener: any) => { handle = listener; } } },
    storage: { local: createMemoryStorageArea(disk) }, action: { onClicked: { addListener: vi.fn() } }, tabs: { onRemoved: { addListener: vi.fn() } } });
  await import("../extension/study/background.js");
});
afterEach(() => { handle({ type: "study-stop-ai" }, sender, () => {}); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("requests conservative target-only correction without sending a timestamp-editing surface", async () => {
  expect(await request()).toMatchObject({ ok: true });
  const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
  expect(body.messages[0].content).toContain("没有音频");
  expect(body.messages[0].content).toContain("不输出时间戳");
  expect(JSON.parse(body.messages[1].content)).toEqual({ text: "暮らしの変化お取材しました。", context: "前の文。\n暮らしの変化お取材しました。\n後の文。" });
});

it("rejects malformed and timestamp-bearing suggestions without caching them", async () => {
  for (const content of ["not json", JSON.stringify({ ...suggestion, start: 4 }), JSON.stringify({ status: "suggested", suggestedText: "changed" })]) {
    fetcher.mockResolvedValueOnce(answer(content));
    expect(await request()).toMatchObject({ ok: false });
  }
  expect(disk.get("biliscriptJapaneseAiCache")).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("rejects even valid-looking JSON if the provider says the result was truncated", async () => {
  fetcher.mockResolvedValueOnce(answer(JSON.stringify(suggestion), "length"));
  expect(await request()).toMatchObject({ ok: false });
  expect(disk.get("biliscriptJapaneseAiCache")).toBeUndefined();
});

it("reuses completed suggestions only for the matching cue revision and context", async () => {
  expect(await request()).toMatchObject({ ok: true, fromCache: false });
  expect(await request()).toMatchObject({ ok: true, fromCache: true });
  expect(await request({ cueRevisionKey: "cue-a:2" })).toMatchObject({ ok: true, fromCache: false });
  expect(await request({ context: "修订后的上下文。" })).toMatchObject({ ok: true, fromCache: false });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
