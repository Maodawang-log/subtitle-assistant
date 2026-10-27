import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

vi.mock("../extension/study/model-manager-ui.js", () => ({ setupModelManager: vi.fn() }));
vi.mock("../extension/study/appearance.js", () => ({ setupAppearance: vi.fn() }));
vi.mock("../extension/study/dictionary-db.js", () => ({ dictionaryInventory: vi.fn(async () => ({ installed: [], defaults: {} })), setDefaultDictionary: vi.fn(), lookupDictionary: vi.fn() }));

const key = "biliscriptJapaneseSettings";
const provider = { apiKey: "fixture-not-a-real-key", model: "synthetic-model", baseUrl: "https://synthetic.example/v1", compatibility: "standard", asrModel: "small" };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
let disk: Map<string, any>, area: ReturnType<typeof createMemoryStorageArea>, permission: ReturnType<typeof vi.fn>, send: ReturnType<typeof vi.fn>;
async function flush() { for (let n = 0; n < 36; n++) await Promise.resolve(); }
async function mount(saved = { ...provider } as Record<string, unknown>) {
  // options.js is a legacy checked-in entry; build-study bundles options.ts.
  const sourceEntry = "../extension/study/options.ts";
  disk.set(key, saved); await import(sourceEntry); await flush();
}
beforeEach(() => {
  vi.resetModules(); disk = new Map(); area = createMemoryStorageArea(disk); permission = vi.fn(async () => true); send = vi.fn();
  document.body.innerHTML = new DOMParser().parseFromString(readFileSync("extension/study/options.html", "utf8"), "text/html").body.innerHTML;
  vi.stubGlobal("chrome", { storage: { local: area }, runtime: { getURL: (path: string) => path, sendMessage: send }, permissions: { request: permission } });
  vi.stubGlobal("Worker", class { onmessage: any; onerror: any; postMessage = vi.fn(); });
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("default source language options independent review", () => {
  it("loads legacy settings as Japanese without writing settings or starting service calls", async () => {
    await mount();
    expect($<HTMLSelectElement>("defaultSourceLanguage").value).toBe("ja");
    expect(area.set).not.toHaveBeenCalled(); expect(permission).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it("saves a language choice independently of provider permission and preserves the latest provider settings", async () => {
    await mount(); disk.set(key, { ...provider, model: "changed-in-another-page", asrModel: "medium" });
    $<HTMLSelectElement>("defaultSourceLanguage").value = "en";
    $("defaultSourceLanguage").dispatchEvent(new Event("change", { bubbles: true })); await flush();
    expect(disk.get(key)).toEqual({ ...provider, model: "changed-in-another-page", asrModel: "medium", sourceLanguage: "en" });
    expect(permission).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    expect(area.set.mock.calls.every(([entry]) => Object.keys(entry).length === 1 && key in entry)).toBe(true);
  });

  it("restores English and preserves it when saving other settings with a blank key field", async () => {
    await mount({ ...provider, sourceLanguage: "en" });
    expect($<HTMLSelectElement>("defaultSourceLanguage").value).toBe("en");
    expect($<HTMLInputElement>("apiKey").value).toBe("");
    $<HTMLInputElement>("model").value = "new-synthetic-model"; $("save").click(); await flush();
    expect(disk.get(key)).toMatchObject({ sourceLanguage: "en", apiKey: provider.apiKey, model: "new-synthetic-model", autoStart: false, autoTranslate: false });
    expect(permission).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not use the provider save button to overwrite local defaults or erase an existing provider", async () => {
    await mount();
    disk.set(key, { ...provider, model: "latest-other-page-model", retainedPreference: true });
    for (const id of ["baseUrl", "model", "apiKey"]) $<HTMLInputElement>(id).value = "";
    $<HTMLSelectElement>("asrModel").value = "medium"; $<HTMLSelectElement>("defaultSourceLanguage").value = "en";
    $("save").click(); await flush();
    expect(disk.get(key)).toEqual({ ...provider, model: "latest-other-page-model", retainedPreference: true });
    expect($("status").classList.contains("error")).toBe(true);
    expect(permission).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it("saves a complete address and model without requesting origin permission when no key exists", async () => {
    await mount({ sourceLanguage: "ja", asrModel: "small" });
    $<HTMLInputElement>("baseUrl").value = "https://synthetic.example/v1";
    $<HTMLInputElement>("model").value = "keyless-fixture-model";
    $("save").click(); await flush();
    expect(disk.get(key)).toMatchObject({ baseUrl: "https://synthetic.example/v1", model: "keyless-fixture-model", apiKey: "" });
    expect(permission).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it("requests permission for a newly supplied key and does not save when permission is declined", async () => {
    const original = { sourceLanguage: "ja", asrModel: "small" };
    await mount(original); permission.mockResolvedValue(false);
    $<HTMLInputElement>("baseUrl").value = "https://synthetic.example/v1";
    $<HTMLInputElement>("model").value = "fixture-model"; $<HTMLInputElement>("apiKey").value = "new-fixture-key";
    $("save").click(); await flush();
    expect(permission).toHaveBeenCalledExactlyOnceWith({ origins: ["https://synthetic.example/*"] });
    expect(disk.get(key)).toEqual(original); expect(area.set).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
});
