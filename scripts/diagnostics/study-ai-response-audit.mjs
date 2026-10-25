// Execute the actual distribution background bundle with in-memory Chrome APIs.
// Every fetch is a fixture. No browser profile, real credentials or network access.
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";

const [bundlePath, reportPath] = process.argv.slice(2);
if (!bundlePath || !reportPath || !vm.SourceTextModule) throw new Error("Usage: node --experimental-vm-modules study-ai-response-audit.mjs background.js report.json");
const source = await fs.readFile(bundlePath, "utf8");
const PRIVATE = "FIXTURE_PRIVATE_";
const key = PRIVATE + "KEY";
const bodyText = "这是夹具中的最终讲解。";
const partialText = "这是尚未完成的讲解。";
const completion = (content, finish_reason = "stop", extra = {}) => ({
  choices: [{ message: { role: "assistant", content, ...extra }, finish_reason }],
  usage: { prompt_tokens: 40, completion_tokens: 1500, completion_tokens_details: { reasoning_tokens: 1200 } }
});
const accepted = (code = "OK") => ({ ok: true, code, cached: code === "OK", warning: code !== "OK" });
const rejected = code => ({ ok: false, code, cached: false, warning: false });
const cases = [];
const jsonCase = (id, json, expect) => cases.push({ id, json, expect });
jsonCase("normal-stop", completion(bodyText), accepted());
jsonCase("reasoning-and-final-stop", completion(bodyText, "stop", { reasoning_content: PRIVATE + "REASONING" }), accepted());
jsonCase("partial-length", completion(partialText, "length"), accepted("TRUNCATED"));
for (const [finish, code] of [["length", "OUTPUT_LIMIT"], ["stop", "REASONING_ONLY"], ["tool_calls", "TOOL_CALLS"], ["aborted", "INTERRUPTED"]]) {
  jsonCase("reasoning-only-" + finish, completion("", finish, { reasoning_content: PRIVATE + "REASONING" }), rejected(code));
}
jsonCase("empty-stop", completion(null), rejected("EMPTY"));
jsonCase("empty-length", completion("", "length"), rejected("OUTPUT_LIMIT"));
jsonCase("reasoning-omitted-content-stop", { choices: [{ message: { reasoning_content: PRIVATE + "REASONING" }, finish_reason: "stop" }] }, rejected("REASONING_ONLY"));
jsonCase("reasoning-omitted-content-length", { choices: [{ message: { reasoning_content: PRIVATE + "REASONING" }, finish_reason: "length" }] }, rejected("OUTPUT_LIMIT"));
const tool = { id: "fixture-call", type: "function", function: { name: PRIVATE + "TOOL", arguments: PRIVATE + "ARGUMENTS" } };
jsonCase("tool-empty", completion(null, "tool_calls", { tool_calls: [tool] }), rejected("TOOL_CALLS"));
jsonCase("tool-preface", completion(partialText, "tool_calls", { tool_calls: [tool] }), rejected("TOOL_CALLS"));
jsonCase("tool-payload-with-stop", completion(partialText, "stop", { tool_calls: [tool] }), rejected("TOOL_CALLS"));
jsonCase("legacy-function-call", completion(partialText, "function_call", { function_call: tool.function }), rejected("TOOL_CALLS"));
for (const finish of ["insufficient_system_resource", "aborted"]) {
  jsonCase(finish + "-empty", completion(null, finish), rejected("INTERRUPTED"));
  jsonCase(finish + "-partial", completion(partialText, finish), accepted("INTERRUPTED_PARTIAL"));
}
jsonCase("unrecognized-finish", completion(partialText, PRIVATE + "FINISH"), accepted("UNCONFIRMED_PARTIAL"));
jsonCase("null-finish", completion(partialText, null), accepted("UNCONFIRMED_PARTIAL"));
jsonCase("missing-finish-compatible", { choices: [{ message: { content: bodyText } }] }, accepted());
jsonCase("refused", completion(bodyText, "stop", { refusal: PRIVATE + "REFUSAL" }), rejected("REFUSED"));
jsonCase("content-filter", completion(partialText, "content_filter"), rejected("REFUSED"));
jsonCase("text-parts", completion([{ type: "text", text: "第一段" }, { type: "reasoning", text: PRIVATE + "REASONING" }, { type: "output_text", text: { value: "第二段" } }]), accepted());
jsonCase("legacy-text", { choices: [{ text: bodyText, finish_reason: "stop" }] }, accepted());
jsonCase("object-content", completion({ arbitrary: PRIVATE + "CONTENT" }), rejected("RESPONSE_FORMAT"));
jsonCase("missing-choices", { error: { message: PRIVATE + "ERROR" } }, rejected("RESPONSE_FORMAT"));
jsonCase("empty-choices", { choices: [] }, rejected("RESPONSE_FORMAT"));
jsonCase("missing-message", { choices: [{ finish_reason: "stop" }] }, rejected("RESPONSE_FORMAT"));
jsonCase("delta-json", { object: "chat.completion.chunk", choices: [{ delta: { content: bodyText }, finish_reason: "stop" }] }, rejected("UNEXPECTED_STREAM"));
jsonCase("responses-api-shape", { output: [{ type: "message", content: [{ type: "output_text", text: bodyText }] }] }, rejected("RESPONSE_FORMAT"));
jsonCase("anthropic-shape", { content: [{ type: "text", text: bodyText }], stop_reason: "end_turn" }, rejected("RESPONSE_FORMAT"));
jsonCase("inline-think-and-final", completion("<think>" + PRIVATE + "REASONING</think>" + bodyText), accepted());
const sse = 'data: {"choices":[{"delta":{"reasoning_content":"' + PRIVATE + 'REASONING"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{"content":"最终讲解"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
cases.push({ id: "sse-header", raw: sse, contentType: "text/event-stream", expect: rejected("UNEXPECTED_STREAM") });
cases.push({ id: "sse-mislabeled-json", raw: sse, contentType: "application/json", expect: rejected("INVALID_JSON") });
cases.push({ id: "json-with-text-header", raw: JSON.stringify(completion(bodyText)), contentType: "text/plain", expect: accepted() });
cases.push({ id: "invalid-json", raw: '<html>' + PRIVATE + 'ERROR</html>', expect: rejected("INVALID_JSON") });
for (const status of [400, 401, 402, 404, 422, 429, 500, 503]) {
  cases.push({ id: "http-" + status, status, json: { error: { message: PRIVATE + "ERROR" } }, expect: rejected("HTTP") });
}
cases.push({ id: "network-rejected", networkError: true, expect: rejected("NETWORK") });

async function run(fixture) {
  const listeners = [], requests = [], timers = new Set();
  const disk = new Map([["biliscriptJapaneseSettings", { baseUrl: "https://compatible.example/v1", model: "fixture-model", apiKey: key, compatibility: "standard" }]]);
  const storage = {
    async get(key) { return typeof key === "string" ? { [key]: disk.get(key) } : Object.fromEntries(disk); },
    async set(value) { for (const [key, item] of Object.entries(value)) disk.set(key, structuredClone(item)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) disk.delete(key); }
  };
  const noEvent = { addListener() {} };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, crypto: webcrypto, URL, TextEncoder, TextDecoder,
    AbortController, DOMException, structuredClone,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ endpointPath: new URL(url).pathname, stream: body.stream, maxTokens: body.max_tokens, toolsSent: Object.hasOwn(body, "tools"), authorizationMatchesFixture: init.headers.Authorization === "Bearer " + key });
      if (fixture.networkError) throw new TypeError(PRIVATE + "NETWORK");
      return new Response(fixture.raw ?? JSON.stringify(fixture.json), { status: fixture.status ?? 200, headers: { "Content-Type": fixture.contentType ?? "application/json" } });
    },
    chrome: {
      runtime: { id: "fixture-extension", getURL: name => "chrome-extension://fixture-extension/" + name, onMessage: { addListener(fn) { listeners.push(fn); } }, openOptionsPage() {} },
      action: { onClicked: noEvent }, tabs: { onRemoved: noEvent, sendMessage: async () => ({}), create: async () => ({}) },
      storage: { local: storage, session: storage }, scripting: { executeScript: async () => [] }
    }
  };
  try {
    const module = new vm.SourceTextModule(source, { context: vm.createContext(sandbox), identifier: path.basename(bundlePath) });
    await module.link(() => { throw new Error("Unexpected external module in bundled distribution"); });
    await module.evaluate({ timeout: 5000 });
    if (requests.length) throw new Error("Unexpected startup request");
    const request = { type: "study-ai", kind: "explain", scope: "context", text: PRIVATE + "SUBTITLE", context: PRIVATE + "CONTEXT", resource: "fixture-resource", requestId: fixture.id };
    const response = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error("Fixture did not reply")), 5000);
      let handled = false;
      const reply = value => { clearTimeout(deadline); resolve(value); };
      for (const listener of listeners) if (listener(request, { id: "fixture-extension", tab: { id: 7 } }, reply) === true) handled = true;
      if (!handled) { clearTimeout(deadline); reject(new Error("No study listener")); }
    });
    const diagnostic = disk.get("biliscriptJapaneseAiDiagnostics")?.[0] ?? null;
    const cached = Object.keys(disk.get("biliscriptJapaneseAiCache") ?? {}).length > 0;
    const observed = { ok: response.ok, code: diagnostic?.code ?? null, cached, warning: !!response.warning };
    const mismatches = Object.entries(fixture.expect).filter(([key, value]) => observed[key] !== value).map(([key, value]) => `${key}: expected ${value}, observed ${observed[key]}`);
    const diagnosticsPrivate = JSON.stringify(diagnostic).includes(PRIVATE);
    const replyPrivate = JSON.stringify(response).includes(PRIVATE);
    if (diagnosticsPrivate) mismatches.push("private fixture material in diagnostics");
    if (replyPrivate) mismatches.push("private fixture material in UI response");
    if (requests.length !== 1 || requests[0]?.stream !== false || requests[0]?.toolsSent) mismatches.push("request count/stream/tools contract mismatch");
    return { id: fixture.id, expected: fixture.expect, observed, error: replyPrivate ? "[redacted fixture leakage]" : response.error, warning: response.warning, replyTextLength: response.text?.length ?? 0, diagnostic, requests, diagnosticsPrivate, replyPrivate, mismatches };
  } finally { for (const timer of timers) clearTimeout(timer); }
}
const results = [];
for (const fixture of cases) results.push(await run(fixture));
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), bundlePath: path.resolve(bundlePath), bundleSha256: createHash("sha256").update(source).digest("hex"), mode: "actual-bundle-in-memory-chrome-and-fetch-fixtures", realApiCalls: 0, userSecretsAccessed: false, fixtures: results.length, matchingHardenedContract: results.filter(row => !row.mismatches.length).length, results };
await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ bundleSha256: report.bundleSha256, fixtures: report.fixtures, matchingHardenedContract: report.matchingHardenedContract, deviationIds: results.filter(row => row.mismatches.length).map(row => row.id), reportPath: path.resolve(reportPath) }, null, 2));
if (process.argv.includes("--assert") && report.matchingHardenedContract !== report.fixtures) process.exitCode = 1;
