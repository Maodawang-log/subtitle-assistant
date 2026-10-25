import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

vi.mock("../extension/study/local-proxy.bg.js", () => ({}));

const SETTINGS = "biliscriptJapaneseSettings";
const CACHE = "biliscriptJapaneseAiCache";
const extensionId = "study-test";
const configured = { baseUrl: "https://compatible.example/v1/", model: "japanese-text-model", apiKey: "synthetic-test-key" };
const sender = (tabId = 7) => ({ id: extensionId, tab: { id: tabId } });
const answer = (text = "自然な訳文") => ({ ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content: text } }] }) }) as Response;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

let storage: ReturnType<typeof createMemoryStorageArea>;
let disk: Map<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
let handle: (message: any, sender: any, reply: (response: any) => void) => unknown;
let requestCounter: number;

function dispatch(message: any, from: any = sender()) {
  const reply = vi.fn();
  let resolve!: (value: any) => void;
  const response = new Promise<any>((done) => { resolve = done; });
  reply.mockImplementation(resolve);
  const handled = handle(message, from, reply);
  return { handled, reply, response };
}

function studyRequest(patch: Record<string, unknown> = {}, from: any = sender()) {
  return dispatch({ type: "study-ai", kind: "translate", text: "食べてみましょう。", context: "日语字幕上下文",
    resource: "BV1test000000:111", requestId: `test-${++requestCounter}`, ...patch }, from);
}

beforeEach(async () => {
  vi.resetModules();
  requestCounter = 0;
  disk = new Map();
  storage = createMemoryStorageArea(disk);
  fetchMock = vi.fn(async () => answer());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("chrome", {
    runtime: { id: extensionId, getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      openOptionsPage: vi.fn(), onMessage: { addListener: (listener: typeof handle) => { handle = listener; } } },
    action: { onClicked: { addListener: vi.fn() } },
    tabs: { sendMessage: vi.fn(async () => ({ success: true })), create: vi.fn(async () => ({})),
      onRemoved: { addListener: vi.fn() } },
    storage: { local: storage, session: createMemoryStorageArea() }
  });
  await import("../extension/study/background.js");
});

afterEach(() => {
  dispatch({ type: "study-stop-ai" }, sender(7));
  dispatch({ type: "study-stop-ai" }, sender(8));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("study AI background integration", () => {
  it("does no startup network work, defaults automatic startup off and never exposes API keys in public settings", async () => {
    expect(fetchMock).not.toHaveBeenCalled();
    const defaults = await dispatch({ type: "study-settings-public" }).response;
    expect(defaults).toMatchObject({ ok: true, config: { autoStart: false, configured: false } });
    disk.set(SETTINGS, { ...configured, autoStart: true });
    const publicSettings = await dispatch({ type: "study-settings-public" }).response;
    expect(publicSettings.config).toMatchObject({ autoStart: true, configured: true, model: configured.model });
    expect(publicSettings.config).not.toHaveProperty("apiKey");
    expect(JSON.stringify(publicSettings)).not.toContain(configured.apiKey);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts explicit study requests only from this extension and a source tab", async () => {
    disk.set(SETTINGS, configured);
    const foreign = studyRequest({}, { id: "different-extension", tab: { id: 7 } });
    expect(foreign.handled).toBeUndefined();
    expect(foreign.reply).not.toHaveBeenCalled();
    const noTab = await studyRequest({}, { id: extensionId }).response;
    expect(noTab).toMatchObject({ ok: false, error: expect.stringContaining("当前视频") });
    const unrelated = dispatch({ type: "anything-else" });
    expect(unrelated.reply).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await studyRequest().response).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the configured compatible endpoint, model and authorization only for the explicit text request", async () => {
    disk.set(SETTINGS, configured);
    expect(await studyRequest({ kind: "word", text: "食べて", context: "食べてみましょう。" }).response).toMatchObject({ ok: true, text: "自然な訳文" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://compatible.example/v1/chat/completions");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${configured.apiKey}`, "Content-Type": "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: configured.model, stream: false });
    expect(body.messages[0].content).toContain("原形");
    expect(JSON.parse(body.messages[1].content)).toEqual({ text: "食べて", context: "食べてみましょう。" });
    expect(String(init.body)).not.toContain(configured.apiKey);
  });

  it("reuses cached answers after a key rotation while isolating resources, models and subtitle contexts", async () => {
    disk.set(SETTINGS, configured);
    expect(await studyRequest().response).toMatchObject({ ok: true, fromCache: false });
    disk.set(SETTINGS, { ...configured, apiKey: "rotated-synthetic-key" });
    expect(await studyRequest().response).toMatchObject({ ok: true, fromCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await studyRequest({ resource: "BV1test000000:222" }).response).toMatchObject({ fromCache: false });
    expect(await studyRequest({ context: "另一个上下文" }).response).toMatchObject({ fromCache: false });
    disk.set(SETTINGS, { ...configured, model: "other-text-model" });
    expect(await studyRequest().response).toMatchObject({ fromCache: false });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const cached = disk.get(CACHE) as Record<string, unknown>;
    expect(Object.keys(cached)).toHaveLength(4);
    expect(Object.keys(cached).every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
    expect(JSON.stringify(cached)).not.toContain(configured.apiKey);
    expect(JSON.stringify(cached)).not.toContain("rotated-synthetic-key");
  });

  it("cancels only the requesting tab and suppresses a late successful response and cache write", async () => {
    disk.set(SETTINGS, configured);
    const pending: Array<{ signal: AbortSignal; text: string; finish: ReturnType<typeof deferred<Response>> }> = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const finish = deferred<Response>();
      const body = JSON.parse(String(init.body));
      pending.push({ signal: init.signal as AbortSignal, text: JSON.parse(body.messages[1].content).text, finish });
      return finish.promise; // Simulates a transport that resolves after abort.
    });
    const one = studyRequest({ requestId: "same", resource: "one", text: "tab-one" }, sender(7));
    const two = studyRequest({ requestId: "same", resource: "two", text: "tab-two" }, sender(8));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(await dispatch({ type: "study-stop-ai" }, sender(7)).response).toMatchObject({ ok: true });
    const firstTab = pending.find((request) => request.text === "tab-one")!;
    const secondTab = pending.find((request) => request.text === "tab-two")!;
    expect(firstTab.signal.aborted).toBe(true);
    expect(secondTab.signal.aborted).toBe(false);
    firstTab.finish.resolve(answer("cancelled-tab-answer"));
    secondTab.finish.resolve(answer("other-tab-answer"));
    expect(await one.response).toMatchObject({ ok: false, canceled: true });
    expect(await two.response).toMatchObject({ ok: true, text: "other-tab-answer" });
    expect(JSON.stringify(disk.get(CACHE))).not.toContain("cancelled-tab-answer");
    expect(JSON.stringify(disk.get(CACHE))).toContain("other-tab-answer");
  });

  it("does not write cache or report success when stopped while a cache write is awaiting storage", async () => {
    disk.set(SETTINGS, configured);
    const originalGet = storage.get.getMockImplementation()!;
    const delayedCache = deferred<Record<string, unknown>>();
    let cacheReads = 0;
    storage.get.mockImplementation(async (key) => {
      if (key === CACHE && ++cacheReads === 2) return delayedCache.promise;
      return originalGet(key);
    });
    const pending = studyRequest();
    await vi.waitFor(() => expect(cacheReads).toBe(2));
    await dispatch({ type: "study-stop-ai" }).response;
    delayedCache.resolve({});
    expect(await pending.response).toMatchObject({ ok: false, canceled: true });
    expect(disk.has(CACHE)).toBe(false);
  });

  it("returns useful errors for missing credentials and HTTP failures without inventing answers", async () => {
    const missing = await studyRequest().response;
    expect(missing).toMatchObject({ ok: false, error: expect.stringContaining("尚未配置") });
    expect(fetchMock).not.toHaveBeenCalled();
    disk.set(SETTINGS, configured);
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: vi.fn() });
    const http = await studyRequest().response;
    expect(http).toMatchObject({ ok: false, canceled: false, error: expect.stringContaining("HTTP 429") });
    expect(http).not.toHaveProperty("text");
    expect(disk.has(CACHE)).toBe(false);
  });

  it("rejects unsafe endpoints and unknown operations before any HTTP request", async () => {
    for (const baseUrl of ["http://remote.example/v1", "file:///C:/private/"]) {
      disk.set(SETTINGS, { ...configured, baseUrl });
      expect(await studyRequest().response).toMatchObject({ ok: false, error: expect.stringContaining("HTTPS") });
    }
    disk.set(SETTINGS, configured);
    expect(await studyRequest({ kind: "automatic-summary" }).response).toMatchObject({ ok: false, error: expect.stringContaining("未知") });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
