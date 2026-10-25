import { describe, expect, it, vi } from "vitest";
import { readStudyPageJsonResult, sendStudyMessage, StudyMessagingError } from "../extension/study/messaging.js";

const windowMessage = { type: "study-local-asr", action: "window", requestId: "one", payload: {
  audio_url: "https://example.bilivideo.com/audio.m4s", backup_urls: [], bvid: "BV1test000000", cid: "111",
  start: 30, duration: 30, language: "ja", model: "small"
} } as const;
// The payload is intentionally mutable like the caller's audio-source result.
const requestWindow = { ...windowMessage, payload: { ...windowMessage.payload, backup_urls: [] } };

describe("independent study message response contract", () => {
  it("maps each discriminated message to validated data without consumer assertions", async () => {
    const window = await sendStudyMessage(requestWindow, async () => ({ ok: true, data: {
      timestamp_origin: "absolute", segments: [{ start: 31, end: 33, text: "日本語" }], ignored: "field"
    } }));
    expect(window.ok).toBe(true);
    if (window.ok) {
      expect(window.data.timestamp_origin).toBe("absolute");
      expect(window.data.segments[0].start).toBe(31);
      expect(window.data).not.toHaveProperty("ignored");
    }
    const cancelled = await sendStudyMessage({ type: "study-bili-cancel", requestId: "one" }, async () => ({ ok: true, data: { cancelled: true } }));
    if (cancelled.ok) expect(cancelled.data.cancelled).toBe(true);
    const json = await sendStudyMessage({ type: "study-bili-request", requestId: "json", url: "https://api.bilibili.com/x/player/v2" },
      async () => ({ ok: true, data: { arbitraryApiShape: true } }));
    if (json.ok) {
      // API JSON remains unknown until its own domain parser examines it.
      // @ts-expect-error An arbitrary Bilibili JSON body is not ASR window data.
      void json.data.segments;
    }
  });

  it("preserves validated service failures while rejecting ambiguous response envelopes", async () => {
    expect(await sendStudyMessage(requestWindow, async () => ({ ok: false, error: { code: "LOCAL_BUSY", message: "服务忙，请稍候" } })))
      .toEqual({ ok: false, error: { code: "LOCAL_BUSY", message: "服务忙，请稍候" } });
    for (const raw of [undefined, {}, { ok: true }, { ok: false, error: "native exception" }, { ok: false, error: { code: 123, message: "bad" } }]) {
      await expect(sendStudyMessage(requestWindow, async () => raw)).rejects.toMatchObject({ name: "StudyMessagingError", code: "RESPONSE" });
    }
  });

  it("rejects relative timestamps, malformed segments and unacknowledged cancellation", async () => {
    for (const data of [
      { segments: [] },
      { timestamp_origin: "relative", segments: [] },
      { timestamp_origin: "absolute", segments: [{ start: "31", end: 33, text: "bad" }] }
    ]) {
      await expect(sendStudyMessage(requestWindow, async () => ({ ok: true, data }))).rejects.toBeInstanceOf(StudyMessagingError);
    }
    await expect(sendStudyMessage({ type: "study-local-asr", action: "cancel", requestId: "one" },
      async () => ({ ok: true, data: { cancelled: false } }))).rejects.toMatchObject({ code: "RESPONSE" });
  });

  it("validates actual Chrome callback results and reports extension disconnection without exposing native details", async () => {
    const original = globalThis.chrome;
    const send = vi.fn((_message, callback) => callback({ ok: true, data: { available_models: ["small", "medium"] } }));
    vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
    try {
      expect(await sendStudyMessage({ type: "study-local-asr", action: "health", requestId: "health" }))
        .toEqual({ ok: true, data: { available_models: ["small", "medium"] } });
      vi.stubGlobal("chrome", { runtime: { sendMessage: send, lastError: { message: "native detail https://private.invalid/token" } } });
      await expect(sendStudyMessage({ type: "study-bili-cancel", requestId: "cancel" }))
        .rejects.toMatchObject({ code: "CONNECTION", message: "扩展连接已断开，请刷新页面" });
    } finally {
      vi.stubGlobal("chrome", original);
    }
  });

  it("validates MAIN-world JSON results before the SW consumes them", () => {
    expect(readStudyPageJsonResult({ ok: true, data: { code: 0 } })).toEqual({ ok: true, data: { code: 0 } });
    for (const raw of [undefined, {}, { ok: true }, { ok: false }, { ok: "true", data: {} }]) {
      expect(readStudyPageJsonResult(raw)).toEqual({ ok: false });
    }
  });
});
