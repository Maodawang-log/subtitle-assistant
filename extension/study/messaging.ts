// The opt-in study entry has its own SW and protocol. Keep its response mapping
// here rather than registering these messages in the upstream background router.
// Runtime/MAIN-world values cross an unknown boundary and are validated once;
// consumers receive the response type selected by the message discriminator.

export interface StudyAudioWindowPayload {
  audio_url: string;
  backup_urls: string[];
  bvid: string;
  cid: string;
  start: number;
  duration: number;
  language: string;
  model: string;
}

export type StudyBiliRequestMessage = { type: "study-bili-request"; requestId: string; url: string };
export type StudyBiliCancelMessage = { type: "study-bili-cancel"; requestId: string };
export type StudyAsrWindowMessage = { type: "study-local-asr"; action: "window"; requestId: string; payload: StudyAudioWindowPayload };
export type StudyAsrCancelMessage = { type: "study-local-asr"; action: "cancel"; requestId: string };
export type StudyAsrHealthMessage = { type: "study-local-asr"; action: "health"; requestId: string };
export type StudyMessage = StudyBiliRequestMessage | StudyBiliCancelMessage | StudyAsrWindowMessage | StudyAsrCancelMessage | StudyAsrHealthMessage;

export type StudyWireFailure = { ok: false; error: { code: string; message: string } };
export type StudyWireResult<T> = { ok: true; data: T } | StudyWireFailure;
export type StudyBiliRequestResponse = StudyWireResult<unknown>;
export type StudyCancelResponse = StudyWireResult<{ cancelled: true }>;
export interface StudyAudioWindowData {
  timestamp_origin: "absolute";
  segments: Array<{ start: number; end: number; text: string }>;
}
export type StudyAsrWindowResponse = StudyWireResult<StudyAudioWindowData>;
export type StudyAsrHealthResponse = StudyWireResult<Record<string, unknown>>;

interface StudyResponses {
  "study-bili-request": StudyBiliRequestResponse;
  "study-bili-cancel": StudyCancelResponse;
  "study-local-asr/window": StudyAsrWindowResponse;
  "study-local-asr/cancel": StudyCancelResponse;
  "study-local-asr/health": StudyAsrHealthResponse;
}
type StudyMessageKind<M extends StudyMessage> = M extends { type: "study-local-asr"; action: infer A extends string }
  ? `study-local-asr/${A}` : M["type"];
export type StudyResponseOf<M extends StudyMessage> = StudyResponses[StudyMessageKind<M>];
export type StudyRuntimeSender = (message: StudyMessage) => Promise<unknown>;

export class StudyMessagingError extends Error {
  constructor(readonly code: "CONNECTION" | "RESPONSE", message: string) {
    super(message);
    this.name = "StudyMessagingError";
  }
}

export function isStudyRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalidResponse(): never {
  throw new StudyMessagingError("RESPONSE", "扩展服务返回了无效响应，请刷新页面后重试");
}
function readResult<T>(raw: unknown, readData: (data: unknown) => T): StudyWireResult<T> {
  if (!isStudyRecord(raw)) return invalidResponse();
  if (raw.ok === false) {
    if (!isStudyRecord(raw.error) || typeof raw.error.code !== "string" || typeof raw.error.message !== "string") return invalidResponse();
    return { ok: false, error: { code: raw.error.code, message: raw.error.message } };
  }
  if (raw.ok !== true || !("data" in raw)) return invalidResponse();
  return { ok: true, data: readData(raw.data) };
}
function readCancel(raw: unknown): StudyCancelResponse {
  return readResult(raw, (data) => {
    if (!isStudyRecord(data) || data.cancelled !== true) return invalidResponse();
    return { cancelled: true };
  });
}
function readWindow(raw: unknown): StudyAsrWindowResponse {
  return readResult(raw, (data) => {
    if (!isStudyRecord(data) || data.timestamp_origin !== "absolute" || !Array.isArray(data.segments)) return invalidResponse();
    const segments: StudyAudioWindowData["segments"] = [];
    for (const segment of data.segments) {
      if (!isStudyRecord(segment) || typeof segment.start !== "number" || !Number.isFinite(segment.start)
        || typeof segment.end !== "number" || !Number.isFinite(segment.end) || typeof segment.text !== "string") return invalidResponse();
      segments.push({ start: segment.start, end: segment.end, text: segment.text });
    }
    return { timestamp_origin: "absolute", segments };
  });
}
const responseReaders: { [K in keyof StudyResponses]: (raw: unknown) => StudyResponses[K] } = {
  "study-bili-request": (raw) => readResult(raw, (data) => data),
  "study-bili-cancel": readCancel,
  "study-local-asr/window": readWindow,
  "study-local-asr/cancel": readCancel,
  "study-local-asr/health": (raw) => readResult(raw, (data) => isStudyRecord(data) ? data : invalidResponse())
};

function messageKind<M extends StudyMessage>(message: M): StudyMessageKind<M> {
  // This assertion relates only a validated discriminated union's two key forms;
  // response values themselves are constructed by the typed runtime readers.
  return (message.type === "study-local-asr" ? `${message.type}/${message.action}` : message.type) as StudyMessageKind<M>;
}

function runtimeSend(message: StudyMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (raw: unknown) => {
        if (chrome.runtime.lastError) reject(new StudyMessagingError("CONNECTION", "扩展连接已断开，请刷新页面"));
        else resolve(raw);
      });
    } catch {
      reject(new StudyMessagingError("CONNECTION", "扩展连接已断开，请刷新页面"));
    }
  });
}

export async function sendStudyMessage<M extends StudyMessage>(
  message: M,
  send: (message: M) => Promise<unknown> = runtimeSend
): Promise<StudyResponseOf<M>> {
  const raw = await send(message);
  return responseReaders[messageKind(message)](raw);
}

// chrome.scripting.executeScript returns unknown. The injected function uses a
// deliberately smaller result than runtime messaging and never returns native
// fetch exceptions or CDN URLs to its consumer.
export function readStudyPageJsonResult(raw: unknown): { ok: true; data: unknown } | { ok: false } {
  if (!isStudyRecord(raw) || raw.ok !== true || !("data" in raw)) return { ok: false };
  return { ok: true, data: raw.data };
}
