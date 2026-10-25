import {describe,it,expect} from "vitest";
import {parseAiResponse,aiRequestPolicy} from "../extension/study/ai-response.js";
const response=(message:any,finish_reason="stop")=>({choices:[{message,finish_reason}],usage:{prompt_tokens:50,completion_tokens:1500,completion_tokens_details:{reasoning_tokens:1500}}});
describe("compatible AI answers and private diagnostics",()=>{
 it("accepts strings, structured text parts and legacy text without stringifying objects",()=>{
  expect(parseAiResponse(response({content:"中文正文"})).text).toBe("中文正文");
  expect(parseAiResponse(response({content:[{type:"text",text:"第一段"},{type:"reasoning",text:"隐藏推理"},{type:"output_text",text:{value:"第二段"}}]})).text).toBe("第一段\n第二段");
  expect(parseAiResponse({choices:[{text:"旧格式正文"}]}).text).toBe("旧格式正文");
  expect(parseAiResponse(response({content:{arbitrary:"private"}})).code).toBe("RESPONSE_FORMAT");
 });
 it("distinguishes reasoning-only exhaustion, empty, malformed, refused and partial output",()=>{
  const r=parseAiResponse(response({content:"",reasoning_content:"private reasoning"},"length"));
  expect(r).toMatchObject({code:"OUTPUT_LIMIT",text:"",diagnostic:{finishReason:"length",reasoningPresent:true,reasoningTokens:1500}});
  expect(JSON.stringify(r)).not.toContain("private reasoning");
  expect(parseAiResponse(response({content:"",reasoning_content:"reasoning"})).code).toBe("REASONING_ONLY");
  expect(parseAiResponse(response({reasoning_content:"reasoning"})).code).toBe("REASONING_ONLY");
  expect(parseAiResponse(response({reasoning_content:"reasoning"},"length")).code).toBe("OUTPUT_LIMIT");
  expect(parseAiResponse(response({content:null})).code).toBe("EMPTY");
  expect(parseAiResponse({error:{message:"secret"}}).code).toBe("RESPONSE_FORMAT");
  expect(parseAiResponse(response({content:"not an answer",refusal:"policy"})).text).toBe("");
  expect(parseAiResponse(response({content:"已写出的部分"},"length"))).toMatchObject({code:"TRUNCATED",text:"已写出的部分",warning:expect.any(String)});
 });
 it("never treats think blocks as final answers or accepts arbitrary finish reason text in diagnostics",()=>{
  expect(parseAiResponse(response({content:"<think>secret</think>正文"})).text).toBe("正文");
  expect(parseAiResponse(response({content:"<think>unfinished secret"})).text).toBe("");
  const d=parseAiResponse(response({content:"body"},"private subtitle")).diagnostic;
  expect(d.finishReason).toBe("unknown");expect(JSON.stringify(d)).not.toContain("private subtitle");expect(JSON.stringify(d)).not.toContain("body");
 });
 it("scopes DeepSeek thinking fields to verified host or explicit setting and bounds context budget",()=>{
  expect(aiRequestPolicy(new URL("https://api.deepseek.com/v1"),"explain","context")).toEqual({max_tokens:6144,thinking:{type:"disabled"}});
  expect(aiRequestPolicy(new URL("https://api.deepseek.com.evil.test"),"explain","sentence")).toEqual({max_tokens:4096});
  expect(aiRequestPolicy(new URL("https://compatible.test"),"translate","sentence")).toEqual({max_tokens:1024});
  expect(aiRequestPolicy(new URL("https://api.deepseek.com"),"word","sentence","standard")).toEqual({max_tokens:2048});
 });
 it("does not present a tool preface as a final answer, even when a proxy reports stop",()=>{
  const tool={id:"private-id",type:"function",function:{name:"private-tool",arguments:"private-arguments"}};
  for(const finish of ["tool_calls","stop"]){
   const result=parseAiResponse(response({content:"Let me call a tool.",tool_calls:[tool]},finish));
   expect(result).toMatchObject({code:"TOOL_CALLS",text:"",diagnostic:{toolCallsPresent:true}});
   expect(JSON.stringify(result)).not.toContain("private-");
  }
  expect(parseAiResponse(response({content:null,reasoning_content:"private reasoning"},"tool_calls"))).toMatchObject({code:"TOOL_CALLS",text:""});
  expect(parseAiResponse(response({content:"preface",function_call:tool.function},"function_call"))).toMatchObject({code:"TOOL_CALLS",text:""});
 });
 it.each(["aborted","insufficient_system_resource"])("marks %s as interrupted, keeping any partial text visibly incomplete",finish=>{
  expect(parseAiResponse(response({content:"partial"},finish))).toMatchObject({code:"INTERRUPTED_PARTIAL",text:"partial",warning:expect.stringContaining("未完成")});
  expect(parseAiResponse(response({content:null,reasoning_content:"private reasoning"},finish))).toMatchObject({code:"INTERRUPTED",text:"",diagnostic:{finishReason:finish}});
 });
 it("preserves missing-finish legacy compatibility without caching explicitly unconfirmed endings",()=>{
  expect(parseAiResponse({choices:[{message:{content:"body"}}]})).toMatchObject({code:"OK",diagnostic:{finishReasonPresent:false}});
  for(const finish of [null,"private-end",42]){
   expect(parseAiResponse({choices:[{message:{content:"partial"},finish_reason:finish}]})).toMatchObject({code:"UNCONFIRMED_PARTIAL",warning:expect.any(String),diagnostic:{finishReason:"unknown",finishReasonPresent:true}});
  }
 });
 it("distinguishes stream chunks and broken envelopes from a genuinely empty message",()=>{
  expect(parseAiResponse({object:"chat.completion.chunk",choices:[{delta:{content:"private partial"},finish_reason:"stop"}]})).toMatchObject({code:"UNEXPECTED_STREAM",text:""});
  for(const value of [{choices:[]},{choices:[null]},{choices:[{finish_reason:"stop"}]}])expect(parseAiResponse(value)).toMatchObject({code:"RESPONSE_FORMAT",text:""});
  expect(parseAiResponse(response({content:null}))).toMatchObject({code:"EMPTY",text:""});
 });
});
