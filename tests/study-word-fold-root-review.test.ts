import "./helpers/study-learning-store-host.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWordPanel } from "../extension/study/word-panel.js";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

const word = (text: string) => ({ surface_form: text, basic_form: text, reading: text, pos: "名詞" });
const $ = (id: string) => document.getElementById(id)!;
let panel: ReturnType<typeof createWordPanel>, disk: Map<string, unknown>, lookup: ReturnType<typeof vi.fn>;
async function flush() { for (let n = 0; n < 20; n++) await Promise.resolve(); }
const bodies = () => [...$("wordDetail").querySelectorAll<HTMLElement>(".word-body")];
function button(selector: string) { return $("wordDetail").querySelector<HTMLButtonElement>(selector)!; }

beforeEach(async () => {
  disk = new Map();
  vi.stubGlobal("chrome", { storage: { local: createMemoryStorageArea(disk), onChanged: { addListener: vi.fn() } } });
  vi.stubGlobal("JSTUDY", { hiragana: (text: string) => text, conjugation: () => "" });
  document.body.innerHTML = '<div id="wordDetail"></div><div id="wordList"></div><button id="exportWords"></button>';
  lookup = vi.fn(async () => ({ ok: true, entries: [] }));
  panel = createWordPanel({ $ }, { binding: () => "video-a", fallback: () => "本地释义", lookup, error: vi.fn() });
  await flush();
});
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("starts every fresh lookup expanded and lets a title toggle just its own details", async () => {
  await panel.show([word("暮らし"), word("変化")]);
  expect(bodies().map(x => x.hidden)).toEqual([false, false]);
  button(".word-toggle").click();
  expect(bodies().map(x => x.hidden)).toEqual([true, false]);
  expect(button(".word-toggle").getAttribute("aria-expanded")).toBe("false");
  button(".word-collapse-all").click();
  expect(bodies().every(x => x.hidden)).toBe(true);
  await panel.show([word("静か")]);
  expect(bodies().map(x => x.hidden)).toEqual([false]);
});

it("can favorite a collapsed result without opening it or losing its definition", async () => {
  await panel.show([word("暮らし")]);
  button(".word-toggle").click();
  button(".word-star").click(); await flush();
  expect(bodies()[0].hidden).toBe(true);
  expect(button(".word-star").getAttribute("aria-pressed")).toBe("true");
  expect((disk.get("biliscriptStudyVocabulary") as any[])[0]).toMatchObject({ term: "暮らし", meaning: "本地释义" });
  button(".word-star").click(); await flush();
  expect(disk.get("biliscriptStudyVocabulary")).toEqual([]);
  expect(bodies()[0].hidden).toBe(true);
});

it("applies collapse-all to later results when the first dictionary query is still pending", async () => {
  let resolve!: (value: any) => void;
  lookup.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = panel.show([word("暮らし"), word("変化"), word("静か")]);
  button(".word-collapse-all").click();
  resolve({ ok: true, entries: [] }); await pending;
  expect(bodies()).toHaveLength(3);
  expect(bodies().every(x => x.hidden)).toBe(true);
  button(".word-expand-all").click();
  expect(bodies().every(x => !x.hidden)).toBe(true);
});
