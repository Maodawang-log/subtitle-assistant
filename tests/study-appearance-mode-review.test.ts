import { afterEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, appearanceCss, normalizeAppearance, resolveSubtitleSize, setupAppearance } from "../extension/study/appearance.js";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const input = (id: string, value: string) => {
  $<HTMLInputElement>(id).value = value;
  $(id).dispatchEvent(new Event("input", { bubbles: true }));
};
const mode = (value: "auto" | "manual") => {
  $<HTMLSelectElement>("subtitleSizeMode").value = value;
  $("subtitleSizeMode").dispatchEvent(new Event("change", { bubbles: true }));
};
async function flush() { for (let i = 0; i < 32; i++) await Promise.resolve(); }
async function openAppearance(saved?: unknown) {
  const provider = { apiKey: "fixture-not-a-real-key", model: "fixture-model" };
  const storage = new Map<string, unknown>([["biliscriptJapaneseSettings", provider]]);
  if (saved !== undefined) storage.set(APPEARANCE_KEY, saved);
  const area = createMemoryStorageArea(storage);
  vi.stubGlobal("chrome", { storage: { local: area } });
  document.body.innerHTML = `
    <select id="subtitleSizeMode"><option value="auto">自动</option><option value="manual">手动</option></select>
    <input id="subtitleSize" type="range" min="16" max="52" value="32">
    <input id="subtitleSizeNumber" type="number" min="16" max="52" value="32">
    <input id="subtitleColor" type="color" value="#ffffff">
    <span id="appearancePreview"><ruby>日本語<rt>にほんご</rt></ruby></span>
    <p id="appearanceStatus"></p>
    <button data-subtitle-color="#ffe595">浅黄</button>
    <button id="appearanceReset">恢复默认</button>`;
  setupAppearance(); await flush();
  return { storage, area, provider };
}
function expectManualControls(size: number, disabled: boolean) {
  for (const id of ["subtitleSize", "subtitleSizeNumber"]) {
    expect($<HTMLInputElement>(id).value).toBe(String(size));
    expect($<HTMLInputElement>(id).disabled).toBe(disabled);
  }
}
function cssRules(css: string) {
  const style = document.createElement("style"); style.textContent = css; document.head.append(style);
  return [...style.sheet!.cssRules] as CSSStyleRule[];
}
afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("style").forEach(style => style.remove());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("subtitle size mode independent normalization review", () => {
  it("defaults absent or unknown mode to auto while retaining legacy size and color", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ mode: "auto", size: 32, color: "#ffffff" });
    for (const value of [undefined, null, {}]) expect(normalizeAppearance(value)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ size: 44, color: "#AABBCC" })).toEqual({ mode: "auto", size: 44, color: "#aabbcc" });
    expect(normalizeAppearance({ mode: "unknown", size: 36, color: "#0055AA" })).toEqual({ mode: "auto", size: 36, color: "#0055aa" });
  });

  it("keeps the full manual 16 through 52 range independently of auto limits", () => {
    for (const [size, expected] of [[-5, 16], [16, 16], [40, 40], [52, 52], [80, 52]]) {
      expect(normalizeAppearance({ mode: "manual", size, color: "#112233" })).toEqual({ mode: "manual", size: expected, color: "#112233" });
    }
    expect(normalizeAppearance({ mode: "manual", size: "48", color: "#FFFFFF" })).toEqual({ mode: "manual", size: 48, color: "#ffffff" });
  });

  it("rejects malformed numeric and color values without losing a valid mode", () => {
    for (const size of [NaN, Infinity, -Infinity, "not-a-size"]) {
      expect(normalizeAppearance({ mode: "manual", size, color: "#fff;display:none" })).toEqual({ mode: "manual", size: 32, color: "#ffffff" });
    }
  });
});

describe("subtitle player-bound sizing independent review", () => {
  it.each([
    [1000, 800, 32, "width-limited"],
    [1400, 400, 26, "height-limited"],
    [320, 180, 20, "lower limit"],
    [2526, 1187, 34, "upper limit"],
  ])("resolves %sx%s to %s px (%s)", (width, height, expected) => {
    expect(resolveSubtitleSize({ mode: "auto", size: 52, color: "#ffffff" }, { width, height })).toBe(expected);
  });

  it("changes automatically for the player without mutating its remembered manual size", () => {
    const saved = Object.freeze({ mode: "auto", size: 48, color: "#aabbcc" });
    expect(resolveSubtitleSize(saved, { width: 1000, height: 800 })).toBe(32);
    expect(resolveSubtitleSize(saved, { width: 1400, height: 400 })).toBe(26);
    expect(resolveSubtitleSize(saved, { width: 320, height: 180 })).toBe(20);
    expect(saved).toEqual({ mode: "auto", size: 48, color: "#aabbcc" });
  });

  it("treats legacy values as auto and uses the same size for every manual player size", () => {
    expect(resolveSubtitleSize({ size: 48, color: "#aabbcc" }, { width: 1000, height: 800 })).toBe(32);
    for (const size of [16, 32, 52]) {
      for (const bounds of [{ width: 320, height: 180 }, { width: 1000, height: 800 }, { width: 2526, height: 1187 }]) {
        expect(resolveSubtitleSize({ mode: "manual", size, color: "#ffffff" }, bounds)).toBe(size);
      }
    }
  });

  it("keeps Japanese, Chinese and ruby proportions and the selected color in manual CSS", () => {
    const rules = cssRules(appearanceCss({ mode: "manual", size: 40, color: "#FFDDAA" }, { width: 320, height: 180 }));
    expect(rules.find(rule => rule.selectorText === ".ja")!.style.fontSize).toBe("40px");
    expect(rules.find(rule => rule.selectorText === ".zh")!.style.fontSize).toBe("32px");
    expect(rules.find(rule => rule.selectorText === "rt")!.style.fontSize).toBe("0.4em");
    const colors = rules.filter(rule => rule.style.color);
    expect(colors.some(rule => rule.selectorText.includes(".ja") && rule.style.color === "rgb(255, 221, 170)")).toBe(true);
    expect(colors.some(rule => rule.selectorText.includes(".zh") && rule.style.color === "rgb(255, 221, 170)")).toBe(true);
  });

  it("uses the resolved automatic size in CSS and never exposes arbitrary CSS values", () => {
    const saved = Object.freeze({ mode: "auto", size: 48, color: "#0055aa" });
    const rules = cssRules(appearanceCss(saved, { width: 1400, height: 400 }));
    expect(rules.find(rule => rule.selectorText === ".ja")!.style.fontSize).toBe("26px");
    expect(rules.find(rule => rule.selectorText === ".zh")!.style.fontSize).toBe("21px");
    expect(saved.size).toBe(48);
    expect(appearanceCss({ mode: "manual", size: "1px;}body{display:none", color: "red;}body{display:none" }, { width: 1000, height: 800 })).not.toContain("display:none");
  });
});

describe("subtitle appearance options mode independent review", () => {
  it("opens the default auto mode with manual controls disabled and makes no storage writes", async () => {
    const { area, storage } = await openAppearance();
    expect($<HTMLSelectElement>("subtitleSizeMode").value).toBe("auto");
    expectManualControls(32, true);
    expect($<HTMLInputElement>("subtitleColor").value).toBe("#ffffff");
    expect(area.set).not.toHaveBeenCalled(); expect(storage.has(APPEARANCE_KEY)).toBe(false);
  });

  it("opens old size/color settings as auto without overwriting the stored manual size", async () => {
    const legacy = { size: 46, color: "#aabbcc" };
    const { area, storage } = await openAppearance(legacy);
    expect($<HTMLSelectElement>("subtitleSizeMode").value).toBe("auto");
    expectManualControls(46, true);
    expect($<HTMLInputElement>("subtitleColor").value).toBe("#aabbcc");
    expect(area.set).not.toHaveBeenCalled(); expect(storage.get(APPEARANCE_KEY)).toEqual(legacy);
    mode("manual"); await flush();
    expectManualControls(46, false);
    expect($("appearancePreview").style.fontSize).toBe("46px");
    expect(storage.get(APPEARANCE_KEY)).toEqual({ mode: "manual", size: 46, color: "#aabbcc" });
  });

  it("restores saved manual mode with editable controls", async () => {
    const saved = { mode: "manual", size: 52, color: "#0055aa" };
    const { area, storage } = await openAppearance(saved);
    expect($<HTMLSelectElement>("subtitleSizeMode").value).toBe("manual");
    expectManualControls(52, false);
    expect($("appearancePreview").style.fontSize).toBe("52px");
    expect(storage.get(APPEARANCE_KEY)).toEqual(saved); expect(area.set).not.toHaveBeenCalled();
  });

  it("round trips manual to auto to manual and keeps the remembered size through auto color edits", async () => {
    const { storage, area, provider } = await openAppearance({ mode: "manual", size: 48, color: "#ffffff" });
    mode("auto"); await flush();
    expectManualControls(48, true);
    expect(storage.get(APPEARANCE_KEY)).toEqual({ mode: "auto", size: 48, color: "#ffffff" });
    input("subtitleColor", "#0055aa"); await flush();
    expect(storage.get(APPEARANCE_KEY)).toEqual({ mode: "auto", size: 48, color: "#0055aa" });
    mode("manual"); await flush();
    expectManualControls(48, false);
    expect($("appearancePreview").style.fontSize).toBe("48px");
    expect(storage.get(APPEARANCE_KEY)).toEqual({ mode: "manual", size: 48, color: "#0055aa" });
    expect(area.set.mock.calls.map(([entry]) => (entry[APPEARANCE_KEY] as { size: number }).size)).toEqual([48, 48, 48]);
    expect(storage.get("biliscriptJapaneseSettings")).toBe(provider);
    expect(area.set.mock.calls.every(([entry]) => Object.keys(entry).length === 1 && APPEARANCE_KEY in entry)).toBe(true);
  });

  it("persists manual input limits and preset colors without changing its selected mode", async () => {
    const { storage } = await openAppearance({ mode: "manual", size: 32, color: "#ffffff" });
    input("subtitleSize", "40"); await flush();
    expectManualControls(40, false);
    input("subtitleSizeNumber", "90"); await flush();
    expectManualControls(52, false);
    input("subtitleSizeNumber", "10"); await flush();
    expectManualControls(16, false);
    document.querySelector<HTMLButtonElement>("[data-subtitle-color]")!.click(); await flush();
    expect(storage.get(APPEARANCE_KEY)).toEqual({ mode: "manual", size: 16, color: "#ffe595" });
  });

  it("resets size, color and mode together and returns to auto disabled controls", async () => {
    const { storage, area, provider } = await openAppearance({ mode: "manual", size: 52, color: "#0055aa" });
    input("subtitleSizeNumber", "44"); mode("auto"); mode("manual"); $("appearanceReset").click(); await flush();
    expect(storage.get(APPEARANCE_KEY)).toEqual({ mode: "auto", size: 32, color: "#ffffff" });
    expect($<HTMLSelectElement>("subtitleSizeMode").value).toBe("auto");
    expectManualControls(32, true);
    expect($<HTMLInputElement>("subtitleColor").value).toBe("#ffffff");
    expect(storage.get("biliscriptJapaneseSettings")).toBe(provider);
    expect(area.get.mock.calls).toEqual([[APPEARANCE_KEY]]);
  });
});
