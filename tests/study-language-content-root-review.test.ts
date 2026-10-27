import "./helpers/study-learning-store-host.js";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryStorageArea } from "./helpers/memory-storage-area.js";

const transport = vi.hoisted(() => ({ callbacks: null as any, sessions: [] as any[], cc: null as any, ccRequests: [] as any[] }));
vi.mock("../extension/study/cc-source.js", () => ({ getJapaneseCc: async (options: any) => { transport.ccRequests.push(options); return transport.cc(options); } }));
vi.mock("../extension/study/native-source.js", () => ({ getNativeStudySource: async () => ({ status: "unavailable", reason: "ROOT_REVIEW" }), sameNativeBinding: () => false }));
vi.mock("../extension/study/bounded-asr.js", () => ({ createBoundedAsrController: (callbacks: any) => {
  transport.callbacks = callbacks;
  return { start: (options: any) => transport.sessions.push(options), stop() {}, seek() {}, updateTime() {} };
}, requestStudyAudioWindow: vi.fn() }));

const url = "https://www.bilibili.com/video/BV1ab411c7mD/", identity = "BV1ab411c7mD:111";
let root: ShadowRoot, disk: Map<string, any>, send: ReturnType<typeof vi.fn>, receive: any, events: any[], aiReply: any;
const $ = (id: string) => (root.getElementById(id) || document.getElementById("biliscript-study-controls")?.shadowRoot?.getElementById(id)) as HTMLElement;
async function flush() { for (let n = 0; n < 55; n++) await Promise.resolve(); }
const rows = () => [...$("rows").querySelectorAll("[data-study-text]")].map(node => node.textContent);
async function choose(language: string) { ($( "sourceLanguage") as HTMLSelectElement).value = language; $("sourceLanguage").dispatchEvent(new Event("change", { bubbles: true })); await flush(); }
async function emit(language: string, content: string) { transport.callbacks.onCues([{ from: 1, to: 5, content }], { resourceId: identity, bvid: "BV1ab411c7mD", cid: "111", language, model: "medium", windowStart: 0, duration: 30 }); await flush(); }
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); transport.callbacks = null; transport.sessions = []; transport.ccRequests = [];
  transport.cc = async () => ({ status: "no-source", bvid: "BV1ab411c7mD", cid: "111", title: "Root language review", tracks: [] });
  history.replaceState({}, "", url);
  document.body.innerHTML = '<div class="bpx-player-container"><video></video></div>';
  const video = document.querySelector("video")!;
  Object.defineProperties(video, { currentTime: { configurable: true, writable: true, value: 1.5 }, duration: { configurable: true, value: 300 }, paused: { configurable: true, value: true } });
  video.pause = vi.fn(); video.play = vi.fn(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  disk = new Map([["biliscriptJapaneseSettings", { sourceLanguage: "en", asrModel: "medium" }]]);
  aiReply = async () => ({ ok: true, text: "Root explanation" });
  send = vi.fn(async (message: any) => message.type === "study-settings-public" ? { ok: true, config: { sourceLanguage: "en", asrModel: "medium", configured: true } } : message.type === "study-ai" ? aiReply(message) : { ok: true, entries: [] });
  vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `chrome-extension://root-review/${path}`, sendMessage: send, onMessage: { addListener: (listener: any) => { receive = listener; } } }, storage: { local: createMemoryStorageArea(disk), onChanged: { addListener: vi.fn() } } });
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("kuromoji", { builder: vi.fn(() => ({ build: (done: Function) => done(null, { tokenize: (text: string) => [{ surface_form: text, basic_form: text, reading: text === "新しい字幕" ? "アタラシイジマク" : "", pos: "名詞" }] }) })) });
  vi.stubGlobal("JSTUDY", new Function(readFileSync("extension/study/core.js", "utf8") + "\nreturn JSTUDY;")());
  events = [];
  for (const target of [window, document]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation(((type: string, listener: any, options: any) => { events.push([target, type, listener, options]); original(type, listener, options); }) as any);
  }
  await import("../extension/study/content.js"); await flush();
  root = document.getElementById("biliscript-japanese-study")!.shadowRoot!;
});
afterEach(() => {
  for (const [target, type, listener, options] of events) target.removeEventListener(type, listener, options);
  vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  for (const id of ["biliscript-japanese-study", "biliscript-study-slot", "biliscript-study-controls", "biliscript-study-entry", "biliscript-study-overlay"]) document.getElementById(id)?.remove();
  document.body.replaceChildren();
});

it("opens the browser entry without submitting CC, audio or paid work and honors the saved English default on enable", async () => {
  receive({ type: "study-toggle" }, {}, () => {}); await flush();
  expect(transport.ccRequests).toHaveLength(0); expect(transport.sessions).toHaveLength(0);
  expect(send.mock.calls.some(([message]) => message.type === "study-ai")).toBe(false);
  expect(($("sourceLanguage") as HTMLSelectElement).value).toBe("en");
  $("enable").click(); await flush();
  expect(transport.ccRequests.at(-1).language).toBe("en");
  expect(transport.sessions.at(-1)).toMatchObject({ language: "en", model: "medium", bvid: "BV1ab411c7mD", cid: "111" });
});

it("uses English word boundaries and local English lookup without Japanese ruby or tokenizer initialization", async () => {
  $("enable").click(); await flush();
  await emit("en", "We are running a test.");
  expect(rows()).toEqual(["We are running a test."]);
  expect($("rows").querySelector("rt")).toBeNull();
  expect((globalThis as any).kuromoji.builder).not.toHaveBeenCalled();
  const running = [...$("rows").querySelectorAll<HTMLElement>(".token")].find(node => node.textContent === "running")!;
  running.click(); await flush();
  expect(send.mock.calls.some(([message]) => message.type === "study-dictionary-lookup" && message.language === "en" && message.queries.includes("running"))).toBe(true);
});

it("requires explicit enable again after changing source language and ignores an old language callback", async () => {
  $("enable").click(); await flush(); await emit("en", "Old English subtitle.");
  const previousCount = transport.sessions.length;
  await choose("ja");
  expect(transport.sessions).toHaveLength(previousCount);
  expect($("enable").textContent).toBe("开启字幕");
  expect(rows()).not.toContain("Old English subtitle.");
  await emit("en", "Late English result."); expect(rows()).not.toContain("Late English result.");
  $("enable").click(); await flush();
  expect(transport.sessions.at(-1).language).toBe("ja");
  await emit("en", "Old response after Japanese enable."); expect(rows()).not.toContain("Old response after Japanese enable.");
  await emit("ja", "日本語の字幕です。"); expect(rows()).toEqual(["日本語の字幕です。"]);
});

it("does not show a completed old English explanation after switching to Japanese", async () => {
  $("enable").click(); await flush(); await emit("en", "An English sentence.");
  let finish!: (value: any) => void;
  aiReply = () => new Promise(resolve => { finish = resolve; });
  $("explain").click(); await flush(); expect(finish).toBeTypeOf("function");
  expect(send.mock.calls.filter(([message]) => message.type === "study-ai").at(-1)![0].language).toBe("en");
  await choose("ja"); finish({ ok: true, text: "STALE ENGLISH EXPLANATION" }); await flush();
  expect($("detail").textContent).not.toContain("STALE ENGLISH EXPLANATION");
});

it("does not restore a legacy Japanese import into English and keeps it available after switching back", async () => {
  disk.set("biliscript-study-import:BV1ab411c7mD:p1", { identity, name: "legacy-ja.srt", offset: 0, cues: [{ start: 1, end: 5, text: "以前の日本語字幕。" }] });
  $("enable").click(); await flush();
  expect(transport.sessions.at(-1).language).toBe("en"); expect(rows()).not.toContain("以前の日本語字幕。");
  await choose("ja"); const previous = transport.ccRequests.length;
  $("enable").click(); await flush();
  expect(transport.ccRequests).toHaveLength(previous); expect(rows()).toEqual(["以前の日本語字幕。"]);
});

const clickCue = async (selector:string) => { ($("rows").querySelector(selector) as HTMLElement).click();await flush(); };
const editText = (text:string) => { ($("rows").querySelector('.cue-editor') as HTMLTextAreaElement).value=text; };
it("offers direct manual and AI actions, cancels without writes, saves English locally and restores", async()=>{
 $("enable").click();await flush();await emit("en","Original words.");
 expect($("rows").querySelector('.cue-manual')?.textContent).toBe('人工校对');
 expect($("rows").querySelector('.cue-proofread')?.textContent).toBe('AI 校对');
 await clickCue('.cue-manual');editText('Canceled draft.');await clickCue('.cue-edit-cancel');
 expect(rows()).toEqual(['Original words.']);
 expect([...disk.keys()].some(k=>k.startsWith('biliscript-study-corrections:'))).toBe(false);
 await clickCue('.cue-manual');editText('Corrected words.');await clickCue('.cue-edit-save');
 expect(rows()).toEqual(['Corrected words.']);expect($("rows").querySelector('rt')).toBeNull();
 expect(send.mock.calls.filter(([m])=>m.type==='study-ai')).toHaveLength(0);
 await emit('en','Different later hypothesis.');expect(rows()).toEqual(['Corrected words.']);
 $("enable").click();await flush();$("enable").click();await flush();await emit('en','Original words.');
 expect(rows()).toEqual(['Corrected words.']);
 await clickCue('.cue-manual');await clickCue('.cue-edit-restore');expect(rows()).toEqual(['Original words.']);
 $("enable").click();await flush();$("enable").click();await flush();await emit('en','Original words.');
 expect(rows()).toEqual(['Original words.']);
});
it("retokenizes corrected Japanese with fresh furigana and rejects late AI suggestions",async()=>{
 await choose('ja');$("enable").click();await flush();await emit('ja','古い字幕');
 let finish:any;aiReply=()=>new Promise(resolve=>{finish=resolve});
 await clickCue('.cue-proofread');expect(finish).toBeTypeOf('function');
 await clickCue('.cue-manual');editText('新しい字幕');await clickCue('.cue-edit-save');
 expect(rows()[0]).toContain('新しい字幕');expect($("rows").querySelector('rt')?.textContent).toBe('あたらしいじまく');
 finish({ok:true,text:JSON.stringify({status:'suggested',suggestedText:'STALE',reason:'old'})});await flush();
 expect($("detail").querySelector('.proof-apply')).toBeNull();expect(rows()[0]).not.toContain('STALE');
 expect(send.mock.calls.filter(([m])=>m.type==='study-ai')).toHaveLength(1);
});
it("clears old Chinese for edits without enabling bilingual translation",async()=>{
 transport.cc=async()=>({status:'ready',bvid:'BV1ab411c7mD',cid:'111',title:'CC',tracks:[],cues:[{from:1,to:5,content:'Original.'}],chineseCues:[{from:1,to:5,content:'旧译文'}]});
 $("enable").click();await flush();await clickCue('.cue-manual');editText('Changed.');await clickCue('.cue-edit-save');
 expect($("translate").getAttribute('aria-pressed')).toBe('false');expect($("rows").textContent).not.toContain('旧译文');
 expect(send.mock.calls.filter(([m])=>m.type==='study-ai')).toHaveLength(0);
});
