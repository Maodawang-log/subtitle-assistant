import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { setupModelManager } from "../extension/study/model-manager-ui.js";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

const settingsKey = "biliscriptJapaneseSettings";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  return {
    protocolVersion: 2, version: "1.1.0", directory: "E:\\Fixture\\future-models", service: null,
    managedService: false, canStop: false, starting: false, stopReason: "", job: null,
    legacyDefault: "small", legacyModels: ["small", "medium"], catalog: { checkedAt: 0, errors: [] },
    models: [
      { id: "small", name: "Whisper small", installed: true, owned: false, bytes: 100 * 1048576, path: "E:\\Fixture\\legacy-small", japaneseSupported: true, language: "多语言（含日语）", positioning: "较小模型，速度优先" },
      { id: "medium", name: "Whisper medium", installed: true, owned: false, bytes: 200 * 1048576, path: "E:\\Fixture\\legacy-medium", japaneseSupported: true, language: "多语言（含日语）", positioning: "较慢，兼顾识别能力" },
      { id: "imported-ja-demo", name: "导入的兼容日语模型", installed: true, owned: false, bytes: 42 * 1048576, path: "E:\\Fixture\\imported-view-path", japaneseSupported: true, language: "多语言（含日语）", positioning: "已安装原位复用" },
      { id: "base.en", name: "Whisper base.en", installed: true, owned: true, bytes: 80 * 1048576, path: "E:\\Fixture\\english", japaneseSupported: false, language: "仅英语", positioning: "不适用于日语字幕" },
      { id: "large-v2", name: "Whisper large-v2", installed: false, owned: false, bytes: 2900 * 1048576, japaneseSupported: true, language: "多语言（含日语）", positioning: "较大模型，硬件负担更高", source: "https://huggingface.co/Systran/faster-whisper-large-v2" }
    ]
  };
}

describe("model manager settings UI independent review", () => {
  let state: any, storage: Map<string, unknown>, send: Mock<(message: any) => Promise<any>>, confirmation: Mock<(message?: string) => boolean>;
  let handlers: Map<string, (args: any) => any>, addedListeners: ReturnType<typeof vi.spyOn>;
  const actions = () => send.mock.calls.map(([message]) => message.action);
  const requests = (action: string) => send.mock.calls.map(([message]) => message).filter(message => message.action === action);
  const card = (id: string) => [...$("models").querySelectorAll<HTMLElement>(".model-card")].find(node => node.dataset.model === id)!;
  const button = (id: string, label: string) => [...card(id).querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
  async function click(id: string) { $(id).click(); await flush(); }
  async function open(value = fixture(), saved = "medium") {
    state = copy(value); storage.set(settingsKey, { asrModel: saved, model: "fixture-provider", apiKey: "fixture-not-a-real-key", retainedPreference: true });
    setupModelManager(); await flush();
  }
  function select(id: string, value: string) { $<HTMLSelectElement>(id).value = value; $(id).dispatchEvent(new Event("change", { bubbles: true })); }

  beforeEach(() => {
    vi.useFakeTimers(); state = fixture(); storage = new Map(); handlers = new Map();
    document.body.innerHTML = readFileSync(join(process.cwd(), "extension/study/options.html"), "utf8");
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    addedListeners = vi.spyOn(window, "addEventListener");
    confirmation = vi.fn(() => true); vi.stubGlobal("confirm", confirmation);
    send = vi.fn(async message => handlers.has(message.action) ? handlers.get(message.action)!(message.args) : { ok: true, data: copy(state) });
    vi.stubGlobal("chrome", { runtime: { id: "a".repeat(32), sendMessage: send }, storage: { local: createMemoryStorageArea(storage) } });
  });
  afterEach(() => {
    window.dispatchEvent(new Event("pagehide"));
    for (const call of addedListeners.mock.calls) if (call[0] === "pagehide") window.removeEventListener("pagehide", call[1] as EventListener);
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
  });

  it("opens old protocol status safely and disables new operations while showing an actionable upgrade path", async () => {
    const old = fixture() as any; delete old.protocolVersion; delete old.version; delete old.catalog; delete old.legacyDefault; delete old.legacyModels;
    await open(old);
    expect($("connectionHelp").hidden).toBe(true); expect($("managerUpgrade").hidden).toBe(false);
    expect($("managerUpgrade").textContent).toContain("1.1.0");
    expect($("managerUpgrade").textContent).toContain("Install-Connection.cmd");
    expect($("managerUpgrade").textContent).toContain("无需停止");
    expect($<HTMLButtonElement>("managerCatalog").disabled).toBe(true);
    expect($<HTMLButtonElement>("managerImport").disabled).toBe(true);
    expect(button("small", "删除模型文件").disabled).toBe(true);
    await click("managerCatalog"); await click("managerImport");
    await vi.advanceTimersByTimeAsync(4500); await flush();
    expect(actions().every(action => action === "status")).toBe(true);
    expect($<HTMLSelectElement>("asrModel").value).toBe("medium");
  });

  it("builds dynamic Japanese choices and preserves an unsaved model selection through manual refresh and polling", async () => {
    await open();
    expect($("managerUpgrade").hidden).toBe(true);
    expect([...$<HTMLSelectElement>("asrModel").options].map(option => option.value)).toEqual(["small", "medium", "imported-ja-demo"]);
    expect(card("imported-ja-demo").textContent).toContain("42.0 MiB");
    expect(card("imported-ja-demo").textContent).toContain("多语言（含日语）");
    expect(card("large-v2").textContent).toContain("硬件负担更高");
    expect(card("large-v2").querySelector<HTMLAnchorElement>(".model-source")!.href).toBe("https://huggingface.co/Systran/faster-whisper-large-v2");
    select("asrModel", "imported-ja-demo"); await click("managerRefresh");
    await vi.advanceTimersByTimeAsync(4500); await flush();
    expect($<HTMLSelectElement>("asrModel").value).toBe("imported-ja-demo");
    expect((storage.get(settingsKey) as any).asrModel).toBe("medium");
    expect(actions().every(action => action === "status")).toBe(true);
    await click("managerStart");
    expect(requests("start").at(-1).args).toEqual({ model: "imported-ja-demo" });
    expect(requests("download")).toHaveLength(0);
  });

  it("keeps an unsaved legacy-default choice across polling until the user explicitly confirms it", async () => {
    await open(); select("legacyDefault", "medium");
    await vi.advanceTimersByTimeAsync(4500); await flush();
    await click("managerRefresh");
    expect($<HTMLSelectElement>("legacyDefault").value).toBe("medium");
    expect(requests("setLegacyDefault")).toHaveLength(0); expect(confirmation).not.toHaveBeenCalled();
    handlers.set("setLegacyDefault", args => { state.legacyDefault = args.model; return { ok: true, data: copy(state) }; });
    await click("managerLegacyDefault");
    expect(confirmation).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("从 small 改为 medium"));
    expect(requests("setLegacyDefault").at(-1).args).toEqual({ model: "medium", confirm: "change-original-default" });
    expect(requests("stop")).toHaveLength(0); expect(requests("restart")).toHaveLength(0);
  });

  it("previews exact model files and retained extras before requesting deletion, passing only the returned confirmation token", async () => {
    await open(); const preview = deferred<any>();
    handlers.set("prepareDelete", () => preview.promise);
    handlers.set("delete", () => { state.models = state.models.filter((model: any) => model.id !== "imported-ja-demo"); return { ok: true, data: copy(state) }; });
    button("imported-ja-demo", "删除模型文件").click(); await flush();
    expect(requests("prepareDelete").at(-1).args).toEqual({ model: "imported-ja-demo" });
    expect(confirmation).not.toHaveBeenCalled(); expect(requests("delete")).toHaveLength(0);
    const exactPath = "E:\\Fixture\\resolved-model-directory";
    preview.resolve({ ok: true, data: { ...copy(state), deletion: { path: exactPath, bytes: 42 * 1048576, confirm: "opaque-preview-token", preservedFiles: ["user-notes.txt", "calibration.json"] } } }); await flush();
    expect(confirmation).toHaveBeenCalledTimes(1);
    const prompt = confirmation.mock.calls[0][0]!;
    expect(prompt).toContain(exactPath); expect(prompt).toContain("42.0 MiB");
    expect(prompt).toContain("user-notes.txt"); expect(prompt).toContain("calibration.json");
    expect(prompt).not.toContain("imported-view-path");
    expect(requests("delete").at(-1).args).toEqual({ model: "imported-ja-demo", confirm: "opaque-preview-token" });
    expect(card("imported-ja-demo")).toBeUndefined();
  });

  it("cancels a model deletion after preview without issuing a delete command", async () => {
    await open(); confirmation.mockReturnValue(false);
    handlers.set("prepareDelete", () => ({ ok: true, data: { ...copy(state), deletion: { path: "E:\\Fixture\\cancelled", bytes: 1, confirm: "cancel-token", preservedFiles: [] } } }));
    button("imported-ja-demo", "删除模型文件").click(); await flush();
    expect(requests("prepareDelete")).toHaveLength(1); expect(confirmation).toHaveBeenCalledTimes(1);
    expect(requests("delete")).toHaveLength(0); expect(card("imported-ja-demo")).toBeDefined();
  });

  it("blocks deletion of both the saved default and the currently selected unsaved default", async () => {
    await open(); select("asrModel", "small");
    button("medium", "删除模型文件").click(); await flush();
    expect($("managerNote").textContent).toContain("默认模型");
    button("small", "删除模型文件").click(); await flush();
    expect($("managerNote").classList.contains("error")).toBe(true);
    expect(requests("prepareDelete")).toHaveLength(0); expect(requests("delete")).toHaveLength(0);
    expect(confirmation).not.toHaveBeenCalled();
  });

  it("surfaces the native legacy-default safeguard without asking for deletion confirmation", async () => {
    await open(); handlers.set("prepareDelete", () => ({ ok: false, error: "这是原启动方式的默认模型，请先明确切换。" }));
    button("small", "删除模型文件").click(); await flush();
    expect(requests("prepareDelete")).toHaveLength(1);
    expect($("managerNote").textContent).toContain("原启动方式的默认模型");
    expect(confirmation).not.toHaveBeenCalled(); expect(requests("delete")).toHaveLength(0);
  });

  it("starts catalog metadata work only after a click, then exposes imported models without triggering a download", async () => {
    await open(); expect(actions()).toEqual(["status"]);
    handlers.set("refreshCatalog", () => { state.job = { phase: "catalog", done: 0, total: 8 }; return { ok: true, data: copy(state) }; });
    await click("managerCatalog");
    expect(requests("refreshCatalog")).toHaveLength(1); expect(requests("refreshCatalog")[0].args).toEqual({});
    expect($("downloadState").textContent).toContain("只读元数据");
    expect($<HTMLButtonElement>("managerImport").disabled).toBe(true);
    expect($("managerCancel").hidden).toBe(false); expect(requests("download")).toHaveLength(0);
    state.job = null; state.catalog = { checkedAt: 1793000000, errors: [] };
    await vi.advanceTimersByTimeAsync(1500); await flush();
    expect($("catalogState").textContent).toContain("上次联网检查");
    handlers.set("chooseImport", () => { state.models.push({ id: "imported-second", name: "第二个导入模型", installed: true, owned: false, bytes: 123, path: "E:\\Fixture\\already-installed", japaneseSupported: true }); return { ok: true, data: copy(state) }; });
    await click("managerImport");
    expect(requests("chooseImport")).toHaveLength(1); expect(requests("chooseImport")[0].args).toEqual({});
    expect([...$<HTMLSelectElement>("asrModel").options].map(option => option.value)).toContain("imported-second");
    expect(card("imported-second").textContent).toContain("E:\\Fixture\\already-installed");
    expect($("managerNote").textContent).toContain("没有复制权重");
    expect(requests("download")).toHaveLength(0); expect(requests("start")).toHaveLength(0);
  });

  it("keeps non-Japanese models out of the Japanese default selector while allowing read-only catalog filtering", async () => {
    await open(); expect(card("base.en")).toBeUndefined();
    select("modelFilter", "all");
    expect(card("base.en")).toBeDefined(); expect(button("base.en", "设为默认").disabled).toBe(true);
    expect([...$<HTMLSelectElement>("asrModel").options].map(option => option.value)).not.toContain("base.en");
    select("modelFilter", "installed"); expect(card("large-v2")).toBeUndefined();
    expect(actions()).toEqual(["status"]);
  });
});
