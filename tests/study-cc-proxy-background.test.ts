import { describe, expect, it, vi } from "vitest";
import { createStudyProxy, isStudyBiliJsonUrl, STUDY_LOCAL_ORIGIN } from "../extension/study/local-proxy.bg.js";

const sender = { id: "test", tab: { id: 7 } };
const payload = { audio_url: "https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/audio.m4s?token=private",
  backup_urls: ["https://cn-some.bilivideo.cn/audio.m4s"], bvid: "BV1test000000", cid: "222", start: 12, duration: 30,
  language: "ja", model: "small" };
const ok = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("independent study background proxy", () => {
  it("does no startup I/O and forwards only the bounded window schema to the fixed server", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok({ segments: [], timestamp_origin: "absolute" }));
    const proxy = createStudyProxy({ extensionId: "test", fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    const reply = vi.fn();
    expect(proxy.handle({ type: "study-local-asr", action: "window", requestId: "one",
      payload: { ...payload, Cookie: "secret", api_key: "secret", endpoint: "http://evil/" } }, sender, reply)).toBe(true);
    await tick();
    expect(fetchImpl.mock.calls[0][0]).toBe(`${STUDY_LOCAL_ORIGIN}/v1/audio/window`);
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ ...payload, request_id: "7:one" });
    expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
    expect(reply).toHaveBeenCalledWith({ ok: true, data: { segments: [], timestamp_origin: "absolute" } });
  });

  it("forwards an explicitly English bounded window without changing its language", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok({ segments: [], timestamp_origin: "absolute" }));
    const proxy = createStudyProxy({ extensionId: "test", fetchImpl }), reply = vi.fn();
    proxy.handle({ type: "study-local-asr", action: "window", requestId: "english", payload: { ...payload, language: "en" } }, sender, reply);
    await tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${STUDY_LOCAL_ORIGIN}/v1/audio/window`);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]!.body))).toEqual({ ...payload, language: "en", request_id: "7:english" });
    expect(reply).toHaveBeenCalledWith({ ok: true, data: { segments: [], timestamp_origin: "absolute" } });
  });

  it("rejects other senders, overlong windows, unsupported languages and non-CDN audio before fetch", () => {
    const fetchImpl = vi.fn();
    const proxy = createStudyProxy({ extensionId: "test", fetchImpl });
    const reply = vi.fn();
    proxy.handle({ type: "study-local-asr", action: "health", requestId: "one" }, { id: "another" }, reply);
    for (const patch of [{ duration: 31 }, { duration: -1 }, { start: NaN }, { language: "ko" },
      { audio_url: "http://127.0.0.1/" }, { audio_url: "https://bilivideo.com.evil.example/a" },
      { backup_urls: ["https://evil.example/a"] }, { model: "../../config" }]) {
      proxy.handle({ type: "study-local-asr", action: "window", requestId: "one", payload: { ...payload, ...patch } }, sender, reply);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledTimes(9);
  });

  it("allows the observed exact Akamai audio host while rejecting sibling hosts and deceptive subdomains", async () => {
    const fetchImpl = vi.fn(async () => ok({ segments: [], timestamp_origin: "absolute" }));
    const proxy = createStudyProxy({ extensionId: "test", fetchImpl });
    const accepted = vi.fn();
    proxy.handle({ type: "study-local-asr", action: "window", requestId: "akamai-exact",
      payload: { ...payload, audio_url: "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/audio.m4s" } }, sender, accepted);
    await tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(accepted).toHaveBeenCalledWith({ ok: true, data: { segments: [], timestamp_origin: "absolute" } });
    for (const [index, host] of ["akamaized.net", "another.akamaized.net", "child.upos-hz-mirrorakam.akamaized.net",
      "upos-hz-mirrorakam.akamaized.net.evil.example"].entries()) {
      const rejected = vi.fn();
      proxy.handle({ type: "study-local-asr", action: "window", requestId: `akamai-rejected-${index}`,
        payload: { ...payload, audio_url: `https://${host}/audio.m4s` } }, sender, rejected);
      expect(rejected).toHaveBeenCalledWith({ ok: false, error: { code: "PAYLOAD", message: "音频窗口参数无效" } });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("cancels a registered request, calls service cancel and keeps cancellation scoped to the sending tab", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/cancel")) return Promise.resolve(ok({}));
      signals.push(init!.signal as AbortSignal);
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("abort"))));
    });
    const proxy = createStudyProxy({ extensionId: "test", fetchImpl });
    const one = vi.fn(), two = vi.fn();
    const message = { type: "study-local-asr", action: "window", requestId: "same", payload };
    proxy.handle(message, sender, one);
    proxy.handle(message, { id: "test", tab: { id: 8 } }, two);
    proxy.handle({ type: "study-local-asr", action: "cancel", requestId: "same" }, sender, vi.fn());
    await tick();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(one).toHaveBeenCalledWith({ ok: false, error: { code: "ABORTED", message: "请求已取消" } });
    expect(two).not.toHaveBeenCalled();
    expect(JSON.parse(String(fetchImpl.mock.calls[2][1]!.body))).toEqual({ request_id: "7:same" });
    proxy.cancelTab(8);
    await tick();
    expect(signals[1].aborted).toBe(true);
  });

  it("remembers cancellation that overtakes a request and never starts that window", () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok({}));
    const proxy = createStudyProxy({ extensionId: "test", fetchImpl });
    proxy.handle({ type: "study-local-asr", action: "cancel", requestId: "fast" }, sender, vi.fn());
    const reply = vi.fn();
    proxy.handle({ type: "study-local-asr", action: "window", requestId: "fast", payload }, sender, reply);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/v1/audio/cancel");
    expect(reply).toHaveBeenCalledWith({ ok: false, error: { code: "ABORTED", message: "请求已取消" } });
  });

  it("uses page MAIN fetch for Bilibili API, supports cancellation and suppresses late results", async () => {
    let finish!: (data: unknown) => void;
    const mainWorldFetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const mainWorldCancel = vi.fn(async () => {});
    const fetchImpl = vi.fn();
    const proxy = createStudyProxy({ extensionId: "test", fetchImpl, mainWorldFetch, mainWorldCancel });
    const reply = vi.fn();
    const url = "https://api.bilibili.com/x/web-interface/view?bvid=BV1test000000";
    proxy.handle({ type: "study-bili-request", requestId: "cc", url }, sender, reply);
    expect(mainWorldFetch).toHaveBeenCalledWith(7, url, "7:cc");
    proxy.handle({ type: "study-bili-cancel", requestId: "cc" }, sender, vi.fn());
    expect(mainWorldCancel).toHaveBeenCalledWith(7, "7:cc");
    finish({ code: 0 });
    await tick();
    expect(reply.mock.calls[0][0]).toMatchObject({ ok: false, error: { code: "ABORTED" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reuses upstream JSON transport without a page sender and retains legacy audio-source response contract", async () => {
    const legacyFetchJson = vi.fn(async () => ({ code: 0, data: { dash: { audio: [] } } }));
    const proxy = createStudyProxy({ extensionId: "test", legacyFetchJson });
    const reply = vi.fn();
    proxy.handle({ type: "fetch-json", url: "https://api.bilibili.com/x/player/playurl?bvid=BV1test000000&cid=222" }, { id: "test" }, reply);
    await tick();
    expect(legacyFetchJson).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][0]).toMatchObject({ ok: true, data: { code: 0 } });
  });

  it("allows only needed HTTPS Bilibili JSON paths and keeps signed URLs out of errors", async () => {
    for (const url of ["http://api.bilibili.com/x/player/v2", "https://api.bilibili.com/x/v2/reply/add",
      "https://api.bilibili.com.evil.test/x/player/v2", "https://user:pass@api.bilibili.com/x/player/v2",
      "https://aisubtitle.hdslb.com/bfs/a.mp4"]) expect(isStudyBiliJsonUrl(url)).toBe(false);
    const fetchImpl = vi.fn(async () => { throw new Error("https://aisubtitle.hdslb.com/?token=private"); });
    const proxy = createStudyProxy({ extensionId: "test", fetchImpl });
    const reply = vi.fn();
    proxy.handle({ type: "study-bili-request", requestId: "cc", url: "https://aisubtitle.hdslb.com/bfs/a.json?token=private" }, sender, reply);
    await tick();
    expect(JSON.stringify(reply.mock.calls)).not.toContain("private");
    expect(reply.mock.calls[0][0]).toMatchObject({ ok: false, error: { code: "FETCH" } });
  });

  it("recognizes service errors in a heartbeat JSON response instead of treating them as empty captions", async () => {
    const fetchImpl = vi.fn(async () => ok({ error: { code: 503, message: "本地模型未准备好" } }));
    const proxy = createStudyProxy({ extensionId: "test", fetchImpl });
    const reply = vi.fn();
    proxy.handle({ type: "study-local-asr", action: "window", requestId: "error", payload }, sender, reply);
    await tick();
    expect(reply).toHaveBeenCalledWith({ ok: false, error: { code: "LOCAL_503", message: "本地模型未准备好" } });
  });
});
