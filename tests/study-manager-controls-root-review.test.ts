import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { setupModelManager } from "../extension/study/model-manager-ui.js";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
async function flush() { for (let n = 0; n < 25; n++) await Promise.resolve(); }

it("does not discard the user's pending legacy-default choice when periodic status polling returns", async () => {
  vi.useFakeTimers();
  const parsed = new DOMParser().parseFromString(readFileSync("extension/study/options.html", "utf8"), "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  const disk = new Map<string, unknown>([["biliscriptJapaneseSettings", { asrModel: "medium" }]]);
  const status = { protocolVersion: 2, version: "1.1.0", directory: "E:\\fixture", service: null, managedService: false, canStop: false,
    legacyDefault: "small", legacyModels: ["small", "medium"], models: ["small", "medium"].map(id => ({ id, name: "Whisper " + id, installed: true, japaneseSupported: true, bytes: 123, path: "E:\\fixture\\" + id })), catalog: {}, job: null };
  vi.stubGlobal("chrome", { runtime: { id: "fixture", sendMessage: vi.fn(async () => ({ ok: true, data: status })) }, storage: { local: createMemoryStorageArea(disk) } });
  setupModelManager(); await flush();
  const select = document.getElementById("legacyDefault") as HTMLSelectElement;
  expect(select.value).toBe("small");
  select.value = "medium"; select.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(1500); await flush();
  expect(select.value).toBe("medium");
});
