import { stripThinkBlocks } from "../ui/markdown.js";

type RecordValue = Record<string, any>;
const object = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
const finishes = new Set(["stop", "length", "content_filter", "tool_calls", "function_call", "insufficient_system_resource", "aborted"]);
export interface AiDiagnostic {
 kind: string; scope: string; at: number; code: string; httpStatus?: number;
 finishReason?: string; contentShape?: string; reasoningPresent?: boolean;
 promptTokens?: number; completionTokens?: number; reasoningTokens?: number;
 finishReasonPresent?: boolean; toolCallsPresent?: boolean;
 responseTransport?: "json" | "event-stream" | "other" | "unknown";
 endpointType?: "deepseek-direct" | "compatible";
 streamRequested?: boolean; maxOutputTokens?: number; thinkingMode?: "disabled" | "unspecified";
}
export function parseAiResponse(raw: unknown) {
 const json = object(raw) ? raw : {};
 const validChoice = Array.isArray(json.choices) && object(json.choices[0]);
 const choice = validChoice ? json.choices[0] : {};
 const message = object(choice.message) ? choice.message : {};
 const content = message.content;
 let shape = typeof content === "string" ? "string" : Array.isArray(content) ? "parts" : content == null ? "empty" : "unsupported";
 let text = "";
 if (typeof content === "string") text = content;
 else if (Array.isArray(content)) text = content.filter(object).filter(p => p.type === "text" || p.type === "output_text").map(p => typeof p.text === "string" ? p.text : object(p.text) && typeof p.text.value === "string" ? p.text.value : "").join("\n");
 else if (content == null && typeof choice.text === "string") {text = choice.text;shape = "legacy-text";}
 const reasoningPresent = typeof message.reasoning_content === "string" && !!message.reasoning_content.trim()
  || typeof message.reasoning === "string" && !!message.reasoning.trim() || /<think\b/i.test(text);
 text = stripThinkBlocks(text).trim();
 const finishReason = finishes.has(choice.finish_reason) ? choice.finish_reason : "unknown";
 const finishReasonPresent = Object.hasOwn(choice, "finish_reason");
 const toolCallsPresent = finishReason === "tool_calls" || finishReason === "function_call"
  || Array.isArray(message.tool_calls) && message.tool_calls.length > 0 || object(message.function_call);
 const streamed = json.object === "chat.completion.chunk" || object(choice.delta);
 const validShape = validChoice && (object(choice.message) && (Object.hasOwn(message, "content") || reasoningPresent) || shape === "legacy-text") && shape !== "unsupported";
 const interrupted = finishReason === "insufficient_system_resource" || finishReason === "aborted";
 const usage = object(json.usage) ? json.usage : {};
 const diagnostic = {finishReason,finishReasonPresent,contentShape:shape,reasoningPresent,toolCallsPresent,
  promptTokens:count(usage.prompt_tokens),completionTokens:count(usage.completion_tokens),
  reasoningTokens:count(usage.completion_tokens_details?.reasoning_tokens)};
 const refused = !!message.refusal || finishReason === "content_filter";
 const code = streamed ? "UNEXPECTED_STREAM" : refused ? "REFUSED" : toolCallsPresent ? "TOOL_CALLS"
  : !validShape ? "RESPONSE_FORMAT" : interrupted ? text ? "INTERRUPTED_PARTIAL" : "INTERRUPTED"
  : finishReasonPresent && finishReason === "unknown" ? text ? "UNCONFIRMED_PARTIAL" : "UNCONFIRMED_END"
  : text ? finishReason === "length" ? "TRUNCATED" : "OK"
  : finishReason === "length" ? "OUTPUT_LIMIT" : reasoningPresent ? "REASONING_ONLY" : "EMPTY";
 const errors: Record<string,string> = {
  UNEXPECTED_STREAM:"接口返回了流式片段，但本次请求要求非流式正文。请检查服务的兼容设置。",
  TOOL_CALLS:"接口返回了工具调用，尚未给出最终讲解。当前讲解不执行工具，请检查服务的兼容设置后手动重试。",
  INTERRUPTED:"服务端中断了生成，未提供最终讲解。可稍后手动重试。",
  UNCONFIRMED_END:"接口没有提供可确认的结束状态和最终正文。设置页可导出安全诊断。",
  REFUSED:"接口未提供这次请求的正文。可调整选句后手动重试。",
  OUTPUT_LIMIT:"输出额度耗尽，尚未得到最终讲解。可手动重试，或检查服务的思考模式设置。",
  REASONING_ONLY:"接口只返回推理字段，没有最终正文。请检查服务的思考模式兼容设置，再手动重试。",
  RESPONSE_FORMAT:"接口返回的正文格式不兼容。设置页可导出不含字幕和 Key 的诊断。",
  EMPTY:"接口返回空正文。可手动重试；设置页可查看失败类型。"
 };
 const warnings: Record<string,string> = {
  TRUNCATED:"正文因输出上限被截断，以下是不完整结果。可手动重试。",
  INTERRUPTED_PARTIAL:"服务端中断了生成，以下是未完成的正文，未存入缓存。可稍后手动重试。",
  UNCONFIRMED_PARTIAL:"接口返回了无法确认的结束状态，以下正文可能不完整，未存入缓存。"
 };
 return {text:code === "OK" || warnings[code] ? text : "",code,diagnostic,error:errors[code],warning:warnings[code]};
}
export function aiRequestPolicy(base: URL, kind: string, scope: string, compatibility = "auto") {
 const deepseek = compatibility === "deepseek" || compatibility !== "standard" && base.hostname === "api.deepseek.com";
 return {max_tokens:kind==="translate"?1024:kind==="word"?2048:scope==="context"?6144:4096,
  ...(deepseek ? {thinking:{type:"disabled"}} : {})};
}
