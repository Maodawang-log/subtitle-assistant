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

async function start(chinese=true){
 transport.cc=async()=>({status:'ready',bvid:'BV1ab411c7mD',cid:'111',title:'Listening fixture',tracks:[],cues:[{from:1,to:5,content:'First sentence.'},{from:5,to:9,content:'Second sentence.'}],chineseCues:chinese?[{from:1,to:5,content:'第一句中文'},{from:5,to:9,content:'第二句中文'}]:[]});
 $('enable').click();await flush();(root.querySelector('[data-pane=practice]') as HTMLElement).click();await flush();
}
const translationCalls=()=>send.mock.calls.filter(([m])=>m.type==='study-ai'&&m.kind==='translate');
it('shows the current card without recording and reveals paired Chinese under hidden original without enabling bilingual',async()=>{
 await start();expect($('practice').hidden).toBe(false);expect($('practiceCue').textContent).toBe('First sentence.');expect($('micAudio').hasAttribute('src')).toBe(false);
 $('listeningToggle').click();await flush();$('listenChinese').click();await flush();
 expect($('practiceChinese').textContent).toBe('第一句中文');expect($('practiceChinese').parentElement).toBe($('practiceCue').parentElement);expect(root.host.hasAttribute('data-reveal-original')).toBe(false);expect($('translate').getAttribute('aria-pressed')).toBe('false');expect(translationCalls()).toHaveLength(0);expect(document.getElementById('biliscript-study-overlay')).toBeNull();
});
it('requests just the current sentence with visible loading and error, independently of global bilingual',async()=>{
 await start(false);let finish:any;aiReply=()=>new Promise(resolve=>{finish=resolve});$('listeningToggle').click();await flush();$('listenChinese').click();await flush();
 expect($('practiceChineseStatus').textContent).toContain('正在翻译当前句');expect(translationCalls()).toHaveLength(1);expect(translationCalls()[0][0]).toMatchObject({text:'First sentence.',context:'',channel:'listening-translation'});
 finish({ok:false,error:'fixture failure'});await flush();expect($('practiceChineseStatus').textContent).toContain('fixture failure');expect(($('listenChinese') as HTMLButtonElement).disabled).toBe(false);
 aiReply=async()=>({ok:true,text:'按需译文'});$('listenChinese').click();await flush();expect($('practiceChinese').textContent).toBe('按需译文');expect($('translate').getAttribute('aria-pressed')).toBe('false');expect($('rows').textContent).not.toContain('按需译文');
});
it('can hide pending Chinese, ignore the late reply, then reveal and hide the cached result independently',async()=>{
 await start(false);let finish:any;aiReply=()=>new Promise(resolve=>{finish=resolve});$('listeningToggle').click();await flush();$('listenOriginal').click();$('listenChinese').click();await flush();
 expect(($('listenChinese') as HTMLButtonElement).disabled).toBe(false);expect($('listenChinese').textContent).toBe('隐藏中文');$('listenChinese').click();await flush();finish({ok:true,text:'STALE HIDDEN'});await flush();
 expect($('practiceChinese').hidden).toBe(true);expect($('practiceChineseStatus').hidden).toBe(true);expect($('listenOriginal').getAttribute('aria-pressed')).toBe('true');
 aiReply=async()=>({ok:true,text:'保留的译文'});$('listenChinese').click();await flush();const count=translationCalls().length;$('listenChinese').click();$('listenChinese').click();await flush();
 expect(translationCalls()).toHaveLength(count);expect($('practiceChinese').textContent).toBe('保留的译文');expect($('translate').getAttribute('aria-pressed')).toBe('false');
 const video=document.querySelector('video')!,time=video.currentTime;vi.mocked(video.play).mockClear();vi.mocked(video.pause).mockClear();$('listenOriginal').click();await flush();
 expect($('listenOriginal').textContent).toBe('揭示原文');expect($('practiceChinese').hidden).toBe(false);expect(video.currentTime).toBe(time);expect(video.play).not.toHaveBeenCalled();expect(video.pause).not.toHaveBeenCalled();
});
it.each(['next','exit','off'])('does not cache or reveal a late requested translation after %s',async action=>{
 await start(false);let finish:any;aiReply=()=>new Promise(resolve=>{finish=resolve});$('listeningToggle').click();await flush();$('listenChinese').click();await flush();
 if(action==='next')$('listenNext').click();else if(action==='exit')$('listeningToggle').click();else{$('translate').click();await flush();$('translate').click()}
 await flush();finish({ok:true,text:'STALE'});await flush();expect($('practiceChinese').textContent).not.toContain('STALE');expect($('rows').textContent).not.toContain('STALE');expect(document.getElementById('biliscript-study-overlay')?.shadowRoot?.textContent||'').not.toContain('STALE');
});
it('immediately clears global Chinese from overlay and every row, retracts a reveal and allows card-only reveal afterwards',async()=>{
 await start();$('translate').click();await flush();expect($('rows').textContent).toContain('第一句中文');expect(document.getElementById('biliscript-study-overlay')?.shadowRoot?.querySelector('.zh')?.textContent).toBe('第一句中文');
 $('listeningToggle').click();await flush();$('listenChinese').click();await flush();expect($('practiceChinese').textContent).toBe('第一句中文');$('translate').click();await flush();
 expect($('practiceChinese').hidden).toBe(true);expect($('rows').textContent).not.toContain('中文');expect(document.getElementById('biliscript-study-overlay')?.shadowRoot?.querySelector('.zh')?.textContent||'').toBe('');
 $('listenChinese').click();await flush();expect($('practiceChinese').textContent).toBe('第一句中文');expect($('translate').getAttribute('aria-pressed')).toBe('false');expect($('rows').textContent).not.toContain('中文');
 $('listenOriginal').click();await flush();expect(document.getElementById('biliscript-study-overlay')?.shadowRoot?.querySelector('.zh')?.textContent||'').toBe('');
});
it('stops global automatic translation and rejects its in-flight response after bilingual is closed',async()=>{
 await start(false);let finish:any;aiReply=()=>new Promise(resolve=>{finish=resolve});$('translate').click();await flush();expect(translationCalls()).toHaveLength(1);$('translate').click();await flush();finish({ok:true,text:'LATE GLOBAL'});await flush();vi.advanceTimersByTime(1000);await flush();
 expect(translationCalls()).toHaveLength(1);expect($('rows').textContent).not.toContain('LATE GLOBAL');expect(document.getElementById('biliscript-study-overlay')?.shadowRoot?.textContent||'').not.toContain('LATE GLOBAL');
});
it('clears intensive sentence-end pause on exit without changing time, playback or a saved recording',async()=>{
 await start();const video=document.querySelector('video')!;Object.defineProperty(video,'paused',{configurable:true,value:false});$('listeningToggle').click();await flush();const play=vi.mocked(video.play),pause=vi.mocked(video.pause);play.mockClear();pause.mockClear();
 ($('micAudio') as HTMLAudioElement).src='blob:fixture-recording';($('micSave') as HTMLButtonElement).disabled=false;const time=video.currentTime;$('listeningToggle').click();await flush();expect(video.currentTime).toBe(time);expect(play).not.toHaveBeenCalled();expect(pause).not.toHaveBeenCalled();
 video.currentTime=5.2;vi.advanceTimersByTime(500);await flush();expect(pause).not.toHaveBeenCalled();expect(($('micAudio') as HTMLAudioElement).src).toBe('blob:fixture-recording');expect(($('micSave') as HTMLButtonElement).disabled).toBe(false);
});
it('uses the requested transport and listening order and preserves reveal state on replay',async()=>{
 await start();const toolbar=$('prev').parentElement!;expect([...toolbar.querySelectorAll('button')].slice(0,4).map(b=>b.id)).toEqual(['prev','next','pause','replay']);
 expect($('listenPrev').nextElementSibling).toBe($('listenReplay'));expect($('listenReplay').nextElementSibling).toBe($('listenNext'));
 $('listenReplay').click();await flush();expect(root.host.hasAttribute('data-intensive')).toBe(false);$('listeningToggle').click();await flush();$('listenOriginal').click();$('listenChinese').click();await flush();$('listenReplay').click();await flush();expect(root.host.hasAttribute('data-reveal-original')).toBe(true);expect($('practiceChinese').hidden).toBe(false);
 $('listenNext').click();await flush();expect(root.host.hasAttribute('data-reveal-original')).toBe(false);expect($('practiceChinese').hidden).toBe(true);expect(($('listenNext') as HTMLButtonElement).disabled).toBe(true);
});
it('leaves an ordinary replay pause owned by the main toolbar intact when exiting listening',async()=>{
 await start();const video=document.querySelector('video')!;Object.defineProperty(video,'paused',{configurable:true,value:false});$('listeningToggle').click();await flush();$('replay').click();await flush();vi.mocked(video.pause).mockClear();$('listeningToggle').click();await flush();video.currentTime=5.2;vi.advanceTimersByTime(500);await flush();expect(video.pause).toHaveBeenCalled();
});

