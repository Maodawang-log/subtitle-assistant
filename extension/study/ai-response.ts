import { stripThinkBlocks } from "../ui/markdown.js";

type RecordValue = Record<string, any>;
const object = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
const finishes = new Set(["stop", "length", "content_filter", "tool_calls", "function_call", "insufficient_system_resource"]);
export interface AiDiagnostic {
 kind: string; scope: string; at: number; code: string; httpStatus?: number;
 finishReason?: string; contentShape?: string; reasoningPresent?: boolean;
 promptTokens?: number; completionTokens?: number; reasoningTokens?: number;
}
export function parseAiResponse(raw: unknown) {
 const json = object(raw) ? raw : {};
 const choice = Array.isArray(json.choices) && object(json.choices[0]) ? json.choices[0] : {};
 const message = object(choice.message) ? choice.message : {};
 let content = message.content;
 let shape = typeof content === "string" ? "string" : Array.isArray(content) ? "parts" : content == null ? "empty" : "unsupported";
 let text = "";
 if (typeof content === "string") text = content;
 else if (Array.isArray(content)) text = content.filter(object).filter(p => p.type === "text" || p.type === "output_text").map(p => typeof p.text === "string" ? p.text : object(p.text) && typeof p.text.value === "string" ? p.text.value : "").join("\n");
 else if (typeof choice.text === "string") {text = choice.text;shape = "legacy-text";}
 const reasoningPresent = typeof message.reasoning_content === "string" && !!message.reasoning_content.trim()
  || typeof message.reasoning === "string" && !!message.reasoning.trim() || /<think\b/i.test(text);
 text = stripThinkBlocks(text).trim();
 const finishReason = finishes.has(choice.finish_reason) ? choice.finish_reason : "unknown";
 const usage = object(json.usage) ? json.usage : {};
 const diagnostic = {finishReason,contentShape:shape,reasoningPresent,
  promptTokens:count(usage.prompt_tokens),completionTokens:count(usage.completion_tokens),
  reasoningTokens:count(usage.completion_tokens_details?.reasoning_tokens)};
 const refused = !!message.refusal || finishReason === "content_filter";
 const code = refused ? "REFUSED" : text ? finishReason === "length" ? "TRUNCATED" : "OK"
  : finishReason === "length" ? "OUTPUT_LIMIT" : reasoningPresent ? "REASONING_ONLY"
  : !Array.isArray(json.choices) || shape === "unsupported" ? "RESPONSE_FORMAT" : "EMPTY";
 const errors: Record<string,string> = {
  REFUSED:"接口未提供这次请求的正文。可调整选句后手动重试。",
  OUTPUT_LIMIT:"输出额度耗尽，尚未得到最终讲解。可手动重试，或检查服务的思考模式设置。",
  REASONING_ONLY:"接口只返回推理字段，没有最终正文。请检查服务的思考模式兼容设置，再手动重试。",
  RESPONSE_FORMAT:"接口返回的正文格式不兼容。设置页可导出不含字幕和 Key 的诊断。",
  EMPTY:"接口返回空正文。可手动重试；设置页可查看失败类型。"
 };
 return {text:refused?"":text,code,diagnostic,error:errors[code],
  warning:code==="TRUNCATED"?"正文因输出上限被截断，以下是不完整结果。可手动重试。":undefined};
}
export function aiRequestPolicy(base: URL, kind: string, scope: string, compatibility = "auto") {
 const deepseek = compatibility === "deepseek" || compatibility !== "standard" && base.hostname === "api.deepseek.com";
 return {max_tokens:kind==="translate"?1024:kind==="word"?2048:scope==="context"?6144:4096,
  ...(deepseek ? {thinking:{type:"disabled"}} : {})};
}
