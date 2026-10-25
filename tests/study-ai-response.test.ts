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
});
