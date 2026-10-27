import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCueTimeline } from "../extension/study/cue-revisions.js";
import { createProofreader } from "../extension/study/proofreader.js";
import { parseProofreading } from "../extension/study/proofreading-result.js";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

vi.mock("../extension/study/local-proxy.bg.js", () => ({}));
vi.mock("../extension/study/native-source.bg.js", () => ({}));
vi.mock("../extension/study/model-manager.bg.js", () => ({}));

const original = "ここで本を読んでいます。";
const suggestion = (text = "ここで本を読んでいました。") => JSON.stringify({
  status: "suggested", suggestedText: text, reason: "文末の認識を確認してください。"
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("strict sentence proofreading result", () => {
  it.each(["suggested", "unchanged", "uncertain"] as const)("accepts the explicit %s status without inventing a correction", status => {
    const result = parseProofreading(JSON.stringify({ status, suggestedText: status === "uncertain" ? "" : "建议原句", reason: "需要结合原声判断。" }), original);
    expect(result.status).toBe(status);
    expect(result.suggestedText).toBe(status === "unchanged" ? original : status === "uncertain" ? "" : "建议原句");
  });

  it("accepts one complete JSON code fence and normalizes an identical suggestion to unchanged", () => {
    expect(parseProofreading('```json\n' + suggestion(original) + '\n```', original)).toEqual({
      status: "unchanged", suggestedText: original, reason: "文末の認識を確認してください。"
    });
  });

  it.each(["start", "end", "timestamp", "timestamps", "segments"])("rejects the extra %s field instead of allowing model-owned timestamps", field => {
    expect(() => parseProofreading(JSON.stringify({ ...JSON.parse(suggestion()), [field]: 99 }), original)).toThrow("格式不完整");
  });

  it.each([
    '{"status":"suggested","suggestedText":"未完成',
    '前言：' + suggestion(),
    JSON.stringify({ status: "confirmed", suggestedText: original, reason: "不可确认的状态" }),
    JSON.stringify({ status: "suggested", suggestedText: 42, reason: "无有效文字" }),
    JSON.stringify({ status: "suggested", suggestedText: "正文", reason: "  " }),
    JSON.stringify([{ status: "unchanged", suggestedText: original, reason: "数组不能作为建议" }]),
    JSON.stringify({ status: "suggested", suggestedText: "文".repeat(2001), reason: "过长" })
  ])("rejects malformed or incomplete suggestions %#", value => {
    expect(() => parseProofreading(value, original)).toThrow("字幕未修改");
  });
});

describe("manual sentence proofreading interaction", () => {
  const $ = (id: string) => document.getElementById(id)!;
  type Result = { text: string };
  let fixture: ReturnType<typeof makeFixture>;
  function makeFixture() {
    const timeline = createCueTimeline();
    timeline.load(Array.from({ length: 7 }, (_, index) => ({
      start: index * 6 + 0.125, end: index * 6 + 4.875,
      text: index === 3 ? original : `文${index}です。`
    })), "BV1test000000:p1|track-1");
    let binding = "generation-1|BV1test000000:p1|111", model = "model-A", configurationRevision = 0;
    const request = vi.fn(async (_snapshot: any): Promise<Result> => ({ text: suggestion() }));
    const edit = vi.fn((id: string, revision: number, text: string) => timeline.edit(id, revision, text));
    const pause = vi.fn(), cancel = vi.fn(), listen = vi.fn();
    const ui = { $, pane: "subtitles", setPane(value: string) { this.pane = value; } };
    const panel = createProofreader(ui, {
      cues: () => timeline.cues, binding: () => binding, configuration: () => configurationRevision,
      request, edit, pause, cancel, listen
    });
    return { timeline, panel, ui, request, edit, pause, cancel, listen,
      setBinding(value: string) { binding = value; },
      setModel(value: string) { model = value; configurationRevision++; },
      get model() { return model; },
      get target() { return timeline.cues[3]; },
      mutateTarget() { const cue = timeline.cues[3]; timeline.edit(cue.id, cue.revision, "重识别后的另一份原文。"); }
    };
  }
  beforeEach(() => {
    document.body.innerHTML = '<h3 id="detailTitle"></h3><p id="explainScope"></p><div id="detail"></div>';
    fixture = makeFixture();
  });
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

  it("does no request before the explicit action and snapshots only the target plus two neighbors on each side", async () => {
    expect(fixture.request).not.toHaveBeenCalled();
    expect(fixture.pause).not.toHaveBeenCalled();
    await fixture.panel.check(fixture.target.id);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(fixture.request.mock.calls[0][0]).toMatchObject({
      cue: { text: original, start: 18.125, end: 22.875 },
      context: ["文1です。", "文2です。", original, "文4です。", "文5です。"].join("\n"),
      binding: "generation-1|BV1test000000:p1|111", configuration: 0
    });
    expect(fixture.ui.pane).toBe("explanation");
    expect(fixture.pause).toHaveBeenCalledTimes(1);
    expect(fixture.edit).not.toHaveBeenCalled();
    expect($("detail").textContent).toContain("尚未核对原声音频");
  });

  it.each([0, 6])("clamps the context at the boundary cue %i", async index => {
    const cues = fixture.timeline.cues;
    await fixture.panel.check(cues[index].id);
    expect(fixture.request.mock.calls[0][0].context).toBe(cues.slice(index === 0 ? 0 : 4, index === 0 ? 3 : 7).map(c => c.text).join("\n"));
  });

  it("changes text only after adoption and restores the exact source while preserving both timestamps", async () => {
    const before = { ...fixture.target }, others = fixture.timeline.cues.filter(c => c.id !== before.id).map(c => ({ ...c }));
    await fixture.panel.check(before.id);
    expect(fixture.target).toEqual(before);
    $("detail").querySelector<HTMLButtonElement>(".proof-apply")!.click();
    expect(fixture.target).toMatchObject({ id: before.id, originalText: original, text: "ここで本を読んでいました。", start: before.start, end: before.end });
    expect(fixture.target.revision).not.toBe(before.revision);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    $("detail").querySelector<HTMLButtonElement>(".proof-restore")!.click();
    expect(fixture.target).toMatchObject({ id: before.id, originalText: original, text: original, start: before.start, end: before.end, edited: false });
    expect(fixture.timeline.cues.filter(c => c.id !== before.id)).toEqual(others);
    expect(fixture.edit).toHaveBeenCalledTimes(2);
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });

  it.each(["uncertain", "unchanged"])("shows %s without an adopt action and only plays audio on a separate user click", async status => {
    fixture.request.mockResolvedValue({ text: JSON.stringify({ status, suggestedText: "不得自动采用的文字", reason: "先听原声确认。" }) });
    const before = { ...fixture.target };
    await fixture.panel.check(before.id);
    expect($("detail").querySelector(".proof-apply")).toBeNull();
    expect(fixture.edit).not.toHaveBeenCalled();
    expect(fixture.listen).not.toHaveBeenCalled();
    $("detail").querySelector<HTMLButtonElement>(".proof-listen")!.click();
    expect(fixture.listen).toHaveBeenCalledWith(before);
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });

  it("renders suggested text and reasons as inert text", async () => {
    fixture.request.mockResolvedValue({ text: JSON.stringify({ status: "suggested", suggestedText: '<img src=x onerror="bad()">', reason: '<script>bad()</script>' }) });
    await fixture.panel.check(fixture.target.id);
    expect($("detail").querySelector("script,img")).toBeNull();
    expect($("detail").textContent).toContain('<img src=x onerror="bad()">');
  });

  it("rejects an earlier sentence response after a second explicit request wins", async () => {
    const old = deferred<Result>(), latest = deferred<Result>();
    fixture.request.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => latest.promise);
    const first = fixture.panel.check(fixture.target.id);
    const nextCue = fixture.timeline.cues[4];
    const second = fixture.panel.check(nextCue.id);
    latest.resolve({ text: suggestion("新しく選んだ文です。") }); await second;
    old.resolve({ text: suggestion("古い句の提案です。") }); await first;
    expect($("detail").textContent).toContain("新しく選んだ文です。");
    expect($("detail").textContent).not.toContain("古い句の提案です。");
    $("detail").querySelector<HTMLButtonElement>(".proof-apply")!.click();
    expect(fixture.edit.mock.calls[0][0]).toBe(nextCue.id);
  });

  it.each(["binding", "revision", "configuration"])("suppresses a pending answer after its %s changes", async changed => {
    const pending = deferred<Result>(); fixture.request.mockReturnValue(pending.promise);
    const checking = fixture.panel.check(fixture.target.id);
    if (changed === "binding") fixture.setBinding("generation-2|BV1test000000:p2|222");
    if (changed === "revision") fixture.mutateTarget();
    if (changed === "configuration") fixture.setModel("model-B");
    fixture.panel.changed();
    pending.resolve({ text: suggestion("不得出现的旧建议。") }); await checking;
    expect($("detail").querySelector(".proof-apply")).toBeNull();
    expect($("detail").textContent).toContain("建议已失效");
    expect($("detail").textContent).not.toContain("不得出现的旧建议。");
    expect(fixture.edit).not.toHaveBeenCalled();
  });

  it.each(["binding", "revision", "configuration"])("revalidates a displayed adopt button against the latest %s", async changed => {
    await fixture.panel.check(fixture.target.id);
    const apply = $("detail").querySelector<HTMLButtonElement>(".proof-apply")!;
    if (changed === "binding") fixture.setBinding("generation-2|BV1other00000:p1|555");
    if (changed === "revision") fixture.mutateTarget();
    if (changed === "configuration") fixture.setModel("model-B");
    apply.click();
    expect(fixture.edit).not.toHaveBeenCalled();
    expect($("detail").textContent).toContain("建议已失效");
  });

  it("does not revive a request after configuration A to B to A changes", async () => {
    const pending = deferred<Result>(); fixture.request.mockReturnValue(pending.promise);
    const checking = fixture.panel.check(fixture.target.id);
    fixture.setModel("model-B"); fixture.panel.changed();
    fixture.setModel("model-A"); fixture.panel.changed();
    expect(fixture.model).toBe("model-A");
    pending.resolve({ text: suggestion("旧模型请求不应复活。") }); await checking;
    expect($("detail").querySelector(".proof-apply")).toBeNull();
    expect(fixture.edit).not.toHaveBeenCalled();
    expect($("detail").textContent).not.toContain("旧模型请求不应复活。");
  });

  it("keeps another explanation intact when a proofreading answer finishes later", async () => {
    const pending = deferred<Result>(); fixture.request.mockReturnValue(pending.promise);
    const checking = fixture.panel.check(fixture.target.id);
    $("detailTitle").textContent = "选段讲解"; $("detail").textContent = "当前的选段讲解";
    pending.resolve({ text: suggestion() }); await checking;
    expect($("detail").textContent).toBe("当前的选段讲解");
  });

  it("leaves source text untouched on failure and permits an explicit retry", async () => {
    fixture.request.mockRejectedValueOnce(new Error("接口失败")).mockResolvedValueOnce({ text: suggestion() });
    const before = { ...fixture.target };
    await fixture.panel.check(before.id);
    expect($("detail").textContent).toContain("接口失败");
    expect(fixture.target).toEqual(before);
    $("detail").querySelector<HTMLButtonElement>(".proof-retry")!.click();
    await vi.waitFor(() => expect($("detail").querySelector(".proof-apply")).not.toBeNull());
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(fixture.edit).not.toHaveBeenCalled();
  });
});

describe("proofreading background completion and cache boundary", () => {
  const SETTINGS = "biliscriptJapaneseSettings", CACHE = "biliscriptStudyTemporaryV2", extensionId = "proofread-test";
  const configuration = { baseUrl: "https://compatible.example/v1", model: "synthetic-model-A", apiKey: "synthetic-test-key" };
  let disk: Map<string, unknown>, fetchMock: ReturnType<typeof vi.fn>, handle: any, counter: number;
  const response = (finish_reason = "stop", text = suggestion()) => new Response(JSON.stringify({
    choices: [{ finish_reason, message: { content: text } }]
  }), { headers: { "Content-Type": "application/json" } });
  function dispatch(patch: Record<string, unknown> = {}) {
    return new Promise<any>(resolve => handle({ type: "study-ai", kind: "proofread", channel: "proofread", text: original,
      context: "前句\n" + original + "\n后句", resource: "BV1test000000:p1|111", cueRevisionKey: "source-cue:1",
      requestId: `proofread-${++counter}`, ...patch }, { id: extensionId, tab: { id: 7 } }, resolve));
  }
  beforeEach(async () => {
    vi.resetModules(); counter = 0; disk = new Map([[SETTINGS, configuration]]);
    fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("chrome", {
      runtime: { id: extensionId, getURL: (path: string) => `chrome-extension://${extensionId}/${path}`, openOptionsPage: vi.fn(),
        onMessage: { addListener(listener: any) { handle = listener; } } },
      action: { onClicked: { addListener: vi.fn() } },
      tabs: { sendMessage: vi.fn(async () => ({})), onRemoved: { addListener: vi.fn() } },
      storage: { local: createMemoryStorageArea(disk), session: createMemoryStorageArea() }
    });
    await import("../extension/study/background.js");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(["length", "aborted", "insufficient_system_resource", "unrecognized_finish"])("rejects a %s completion even if its JSON body looks valid", async finishReason => {
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response(finishReason));
    expect(await dispatch()).toMatchObject({ ok: false, error: expect.stringContaining("未完整结束") });
    expect(disk.has(CACHE)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a completed response with timestamp fields before writing the answer cache", async () => {
    fetchMock.mockResolvedValue(response("stop", JSON.stringify({ ...JSON.parse(suggestion()), start: 100, end: 120 })));
    expect(await dispatch()).toMatchObject({ ok: false, error: expect.stringContaining("格式不完整") });
    expect(disk.has(CACHE)).toBe(false);
  });

  it("caches complete suggestions while isolating cue revision, context and provider model", async () => {
    expect(await dispatch()).toMatchObject({ ok: true, fromCache: false });
    expect(await dispatch()).toMatchObject({ ok: true, fromCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await dispatch({ cueRevisionKey: "source-cue:2" })).toMatchObject({ ok: true, fromCache: false });
    expect(await dispatch({ context: "另一个前后文" })).toMatchObject({ ok: true, fromCache: false });
    disk.set(SETTINGS, { ...configuration, model: "synthetic-model-B" });
    expect(await dispatch()).toMatchObject({ ok: true, fromCache: false });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(JSON.parse(body.messages[1].content)).toEqual({ text: original, context: "前句\n" + original + "\n后句" });
    expect(body.messages[0].content).toContain("没有音频");
    expect(body.messages[0].content).toContain("不输出时间戳");
    expect(JSON.stringify(disk.get(CACHE))).not.toContain(configuration.apiKey);
  });
});
