import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBoundedAsrController,
  normalizeStudyAudioCues,
  requestStudyAudioWindow,
  studyAudioCacheKey,
  type StudyAsrMessage,
  type StudyAsrStart,
  type StudyAudioWindow
} from "../extension/study/bounded-asr.js";
import { createChromeStudyAudioCache, STUDY_AUDIO_CACHE_STORAGE_KEY } from "../extension/study/study-audio-cache.js";

const video: StudyAsrStart = { enabled: true, bvid: "BVtest", cid: "123", currentTime: 0, duration: 3600 };
const source = { url: "https://example.bilivideo.com/audio.m4s?token=private", backupUrls: [] };
const windowPayload: StudyAudioWindow = {
  audio_url: source.url,
  backup_urls: [],
  bvid: "BVtest",
  cid: "123",
  start: 0,
  duration: 30,
  language: "ja",
  model: "small"
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function result(start: number, text = "日本語です") {
  return { timestamp_origin: "absolute", segments: [{ start: start + 1, end: start + 3, text }] };
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

afterEach(() => { vi.useRealTimers(); });

describe("bounded playback-window ASR", () => {
  it("does not obtain a source or invoke ASR unless explicitly enabled", async () => {
    const getAudioSource = vi.fn(async () => source);
    const requestWindow = vi.fn(async () => result(0));
    const controller = createBoundedAsrController({ cacheStore: null, onCues: vi.fn(), getAudioSource, requestWindow });
    controller.start({ ...video, enabled: undefined });
    controller.seek(500);
    controller.updateTime(1000);
    await flush();
    expect(getAudioSource).not.toHaveBeenCalled();
    expect(requestWindow).not.toHaveBeenCalled();
  });

  it("delivers each completed chunk immediately and stops after at most 60 seconds of coverage", async () => {
    const requests: Array<{ window: StudyAudioWindow; pending: ReturnType<typeof deferred<unknown>> }> = [];
    const onCues = vi.fn();
    const onStatus = vi.fn();
    const controller = createBoundedAsrController({ cacheStore: null,
      onCues,
      onStatus,
      getAudioSource: async () => source,
      requestWindow: (window) => {
        const pending = deferred<unknown>();
        requests.push({ window, pending });
        return pending.promise;
      }
    });
    controller.start({ ...video, currentTime: 5, resourceId: "owner-1" });
    await flush();
    expect(requests.map((request) => request.window.start)).toEqual([0]);
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "waiting", resourceId: "owner-1" }));
    requests[0].pending.resolve(result(0));
    await flush();
    expect(onCues).toHaveBeenCalledWith([{ from: 1, to: 3, content: "日本語です" }], expect.objectContaining({ windowStart: 0, resourceId: "owner-1", cached: false }));
    expect(requests.map((request) => request.window.start)).toEqual([0, 30]);
    requests[1].pending.resolve(result(30));
    await flush();
    expect(requests).toHaveLength(2);
    expect(requests.every(({ window }) => window.duration <= 30 && window.start + window.duration <= 65)).toBe(true);
    controller.updateTime(29.9);
    await flush();
    expect(requests).toHaveLength(2);
    controller.updateTime(30);
    await flush();
    expect(requests.map((request) => request.window.start)).toEqual([0, 30, 60]);
    controller.stop();
  });

  it("cancels obsolete work on seek and never accepts its late response", async () => {
    const calls: Array<{ start: number; signal: AbortSignal; pending: ReturnType<typeof deferred<unknown>> }> = [];
    const onCues = vi.fn();
    const controller = createBoundedAsrController({ cacheStore: null,
      onCues,
      getAudioSource: async () => source,
      requestWindow: (window, signal) => {
        const pending = deferred<unknown>();
        calls.push({ start: window.start, signal, pending });
        return pending.promise; // Deliberately ignores abort to test the owner guard.
      }
    });
    controller.start(video);
    await flush();
    controller.seek(310);
    await flush();
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls.map((call) => call.start)).toEqual([0, 300]);
    calls[0].pending.resolve(result(0, "obsolete"));
    await flush();
    expect(onCues).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
    calls[1].pending.resolve(result(300));
    await flush();
    expect(onCues).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.start)).toEqual([0, 300, 330]);
    controller.stop();
  });

  it("stops queued windows and suppresses old-video/source responses", async () => {
    const audioSource = deferred<typeof source>();
    const sourceSignals: AbortSignal[] = [];
    const onCues = vi.fn();
    const requestWindow = vi.fn(async (window: StudyAudioWindow) => result(window.start));
    const controller = createBoundedAsrController({ cacheStore: null, onCues, requestWindow, getAudioSource: (_video, signal) => {
      sourceSignals.push(signal);
      return audioSource.promise;
    } });
    controller.start(video);
    controller.stop();
    expect(sourceSignals[0].aborted).toBe(true);
    audioSource.resolve(source);
    await flush();
    expect(requestWindow).not.toHaveBeenCalled();
    expect(onCues).not.toHaveBeenCalled();

    const pending = deferred<unknown>();
    const activeSignals: AbortSignal[] = [];
    const nextController = createBoundedAsrController({ cacheStore: null,
      onCues,
      getAudioSource: async () => source,
      requestWindow: (_window, signal) => { activeSignals.push(signal); return pending.promise; }
    });
    nextController.start(video);
    await flush();
    nextController.start({ ...video, enabled: false, bvid: "BVother" });
    expect(activeSignals[0].aborted).toBe(true);
    pending.resolve(result(0));
    await flush();
    expect(activeSignals).toHaveLength(1);
    expect(onCues).not.toHaveBeenCalled();
  });

  it("keys text cache by BV, CID, language, model, start and duration", async () => {
    const getAudioSource = vi.fn(async () => source);
    const requestWindow = vi.fn(async (window: StudyAudioWindow) => result(window.start));
    const onCues = vi.fn();
    const controller = createBoundedAsrController({ cacheStore: null, onCues, getAudioSource, requestWindow });
    controller.start({ ...video, duration: 45 });
    await flush();
    expect(requestWindow.mock.calls.map(([window]) => [window.start, window.duration])).toEqual([[0, 30], [30, 15]]);
    controller.stop();
    controller.start({ ...video, duration: 45 });
    await flush();
    expect(requestWindow).toHaveBeenCalledTimes(2);
    expect(onCues).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ cached: true, windowStart: 30, duration: 15 }));
    controller.start({ ...video, cid: "124", duration: 45 });
    await flush();
    expect(requestWindow).toHaveBeenCalledTimes(4);
    controller.start({ ...video, language: "en", duration: 45 });
    await flush();
    expect(requestWindow).toHaveBeenCalledTimes(6);
    controller.start({ ...video, model: "other", duration: 45 });
    await flush();
    expect(requestWindow).toHaveBeenCalledTimes(8);
    controller.stop();
    expect(studyAudioCacheKey({ ...windowPayload, start: 0, duration: 30 })).not.toBe(
      studyAudioCacheKey({ ...windowPayload, start: 0, duration: 15 })
    );
  });

  it("advances from a playback clock and stops its timer when disabled", async () => {
    vi.useFakeTimers();
    let time = 0;
    const getCurrentTime = vi.fn(() => time);
    const requestWindow = vi.fn(async (window: StudyAudioWindow) => result(window.start));
    const controller = createBoundedAsrController({ cacheStore: null, onCues: vi.fn(), getAudioSource: async () => source, requestWindow, getCurrentTime });
    controller.start(video);
    await flush();
    time = 95;
    await vi.advanceTimersByTimeAsync(1000);
    expect(requestWindow.mock.calls.map(([window]) => window.start)).toEqual([0, 30, 90, 120]);
    controller.stop();
    const reads = getCurrentTime.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(getCurrentTime).toHaveBeenCalledTimes(reads);
  });

  it("persists only text windows, reuses them in a new controller and evicts the least recently used window", async () => {
    const requestWindow = vi.fn(async (window: StudyAudioWindow) => result(window.start));
    const first = createBoundedAsrController({
      onCues: vi.fn(),
      cacheLimit: 2,
      getAudioSource: async () => source,
      requestWindow
    });
    first.start(video);
    await flush();
    first.updateTime(30);
    await flush();
    first.stop();
    await flush();
    const disk = await chrome.storage.local.get(STUDY_AUDIO_CACHE_STORAGE_KEY);
    expect(JSON.stringify(disk)).not.toContain("audio.m4s");
    expect(JSON.stringify(disk)).not.toContain("token=private");
    const entries = await createChromeStudyAudioCache(2).read();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => JSON.parse(entry.key)[4])).toEqual([30, 60]);

    const onCues = vi.fn();
    const second = createBoundedAsrController({
      onCues,
      cacheLimit: 2,
      getAudioSource: async () => source,
      requestWindow
    });
    second.start({ ...video, currentTime: 30, resourceId: "after-reload" });
    await flush();
    expect(requestWindow).toHaveBeenCalledTimes(3);
    expect(onCues).toHaveBeenCalledTimes(2);
    expect(onCues).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ cached: true, resourceId: "after-reload" }));
    second.stop();
  });

  it("does not retry a failed paused window indefinitely or leak URL tokens into status", async () => {
    const onStatus = vi.fn();
    const requestWindow = vi.fn(async () => { throw new Error(`CDN rejected ${source.url}`); });
    const controller = createBoundedAsrController({ cacheStore: null, onCues: vi.fn(), onStatus, getAudioSource: async () => source, requestWindow });
    controller.start(video);
    await flush();
    for (let i = 0; i < 10; i++) controller.updateTime(0);
    await flush();
    expect(requestWindow).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain("token=private");
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "error" }));
    controller.stop();
  });

  it("uses an explicit validated source without API discovery and caps a non-30-second preview tail", async () => {
    const getAudioSource = vi.fn(async () => { throw new Error("playurl 412"); });
    const requestWindow = vi.fn(async (window: StudyAudioWindow) => result(window.start));
    const snapshot = { url: "https://upos-hz-mirrorakam.akamaized.net/audio.m4s?token=snapshot", backupUrls: ["https://example.bilivideo.com/backup.m4s"] };
    const controller = createBoundedAsrController({ cacheStore: null, onCues: vi.fn(), getAudioSource, requestWindow });
    controller.start({ ...video, validatedAudioSource: snapshot, playableDuration: 47.25 });
    snapshot.url = "https://example.bilivideo.com/mutated.m4s";
    snapshot.backupUrls[0] = "https://example.bilivideo.com/mutated-backup.m4s";
    await flush();
    expect(getAudioSource).not.toHaveBeenCalled();
    expect(requestWindow.mock.calls.map(([window]) => [window.start, window.duration])).toEqual([[0, 30], [30, 17.25]]);
    expect(requestWindow.mock.calls.every(([window]) => window.start + window.duration <= 47.25)).toBe(true);
    expect(requestWindow.mock.calls[1][0]).toMatchObject({
      audio_url: "https://upos-hz-mirrorakam.akamaized.net/audio.m4s?token=snapshot",
      backup_urls: ["https://example.bilivideo.com/backup.m4s"]
    });
    controller.updateTime(60);
    await flush();
    expect(requestWindow).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  it("refuses a validated source without a positive finite playable limit and makes no request at or beyond the cap", async () => {
    const getAudioSource = vi.fn(async () => source);
    const requestWindow = vi.fn(async (window: StudyAudioWindow) => result(window.start));
    const onStatus = vi.fn();
    const controller = createBoundedAsrController({ cacheStore: null, onCues: vi.fn(), onStatus, getAudioSource, requestWindow });
    for (const playableDuration of [undefined, 0, -1, NaN, Infinity]) {
      controller.start({ ...video, validatedAudioSource: source, playableDuration });
      await flush();
      expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "error" }));
    }
    for (const currentTime of [47.25, 60, 600]) {
      controller.start({ ...video, validatedAudioSource: source, playableDuration: 47.25, currentTime });
      await flush();
    }
    expect(getAudioSource).not.toHaveBeenCalled();
    expect(requestWindow).not.toHaveBeenCalled();
    controller.stop();
  });

  it("uses the smaller nominal or playable duration and preserves the default discovery path", async () => {
    const getAudioSource = vi.fn(async () => source);
    const requestWindow = vi.fn(async (window: StudyAudioWindow) => result(window.start));
    const controller = createBoundedAsrController({ cacheStore: null, onCues: vi.fn(), getAudioSource, requestWindow });
    controller.start({ ...video, duration: 35.5, playableDuration: 47.25 });
    await flush();
    expect(getAudioSource).toHaveBeenCalledTimes(1);
    expect(requestWindow.mock.calls.map(([window]) => [window.start, window.duration])).toEqual([[0, 30], [30, 5.5]]);
    controller.stop();
  });

  it("discards a validated URL on seek and stop, rejects late results and needs a fresh snapshot to continue", async () => {
    const getAudioSource = vi.fn(async () => source);
    const onCues = vi.fn();
    const calls: Array<{ window: StudyAudioWindow; signal: AbortSignal; pending: ReturnType<typeof deferred<unknown>> }> = [];
    const controller = createBoundedAsrController({ cacheStore: null, onCues, getAudioSource,
      requestWindow: (window, signal) => {
        const pending = deferred<unknown>();
        calls.push({ window, signal, pending });
        return pending.promise;
      } });
    controller.start({ ...video, validatedAudioSource: source, playableDuration: 75 });
    await flush();
    controller.seek(35);
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].pending.resolve(result(0, "obsolete"));
    await flush();
    expect(onCues).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(getAudioSource).not.toHaveBeenCalled();
    controller.seek(35, { url: "https://example.bilivideo.com/fresh.m4s", backupUrls: [] });
    await flush();
    expect(calls[1].window).toMatchObject({ start: 30, audio_url: "https://example.bilivideo.com/fresh.m4s" });
    controller.stop();
    expect(calls[1].signal.aborted).toBe(true);
    calls[1].pending.resolve(result(30, "also obsolete"));
    await flush();
    expect(onCues).not.toHaveBeenCalled();
    controller.start({ ...video, bvid: "BVother", cid: "456" });
    await flush();
    expect(getAudioSource).toHaveBeenCalledWith({ bvid: "BVother", cid: "456" }, expect.any(AbortSignal));
    expect(calls[2].window).toMatchObject({ bvid: "BVother", cid: "456", audio_url: source.url });
    controller.stop();
  });

  it("never persists a validated source URL or its signed query", async () => {
    const controller = createBoundedAsrController({ onCues: vi.fn(),
      requestWindow: async (window) => result(window.start) });
    controller.start({ ...video, validatedAudioSource: { url: "https://upos-hz-mirrorakam.akamaized.net/audio.m4s?private=validated", backupUrls: [] }, playableDuration: 15.5 });
    await flush();
    controller.stop();
    await flush();
    const disk = await chrome.storage.local.get(STUDY_AUDIO_CACHE_STORAGE_KEY);
    expect(JSON.stringify(disk)).not.toContain("akamaized");
    expect(JSON.stringify(disk)).not.toContain("private=validated");
    expect((await createChromeStudyAudioCache().read())[0].cues).toEqual([{ from: 1, to: 3, content: "日本語です" }]);
  });
});

describe("loopback transport and time-axis contract", () => {
  it("sends a real cancel message and ignores a late successful response", async () => {
    const abort = new AbortController();
    const pending = deferred<unknown>();
    const send = vi.fn((message: StudyAsrMessage) => message.action === "window" ? pending.promise : Promise.resolve({ ok: true }));
    const promise = requestStudyAudioWindow(windowPayload, abort.signal, send);
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    abort.abort();
    await assertion;
    expect(send.mock.calls[0][0]).toMatchObject({ type: "study-local-asr", action: "window", payload: windowPayload });
    expect(send.mock.calls[1][0]).toEqual({ type: "study-local-asr", action: "cancel", requestId: send.mock.calls[0][0].requestId });
    pending.resolve({ ok: true, data: result(0) });
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("clips absolute segments to the window and rejects relative or missing origins", () => {
    expect(normalizeStudyAudioCues({ timestamp_origin: "absolute", segments: [
      { start: 28, end: 33, text: " 前半 " },
      { start: 58, end: 66, text: "後半" },
      { start: 70, end: 72, text: "outside" },
      { start: 34, end: 35, text: " " },
      { start: NaN, end: 35, text: "bad" }
    ] }, { start: 30, duration: 30 })).toEqual([
      { from: 30, to: 33, content: "前半" },
      { from: 58, to: 60, content: "後半" }
    ]);
    expect(() => normalizeStudyAudioCues({ segments: [{ start: 0, end: 1, text: "relative" }] }, { start: 30, duration: 30 })).toThrow("绝对时间轴");
  });
});
