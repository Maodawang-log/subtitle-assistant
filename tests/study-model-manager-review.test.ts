import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const id = "a".repeat(32);
const settings = { id, url: `chrome-extension://${id}/study/options.html`, frameId: 0 };
let handle: (message: any, sender: any, reply: (value: any) => void) => unknown;
let onNative: (value: any) => void;
let onDisconnect: () => void;
let post: ReturnType<typeof vi.fn>;
let connect: ReturnType<typeof vi.fn>;
let isSender: (value: any) => boolean;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("crypto", webcrypto);
  post = vi.fn();
  connect = vi.fn(() => ({ postMessage: post,
    onMessage: { addListener: (fn: typeof onNative) => { onNative = fn; } },
    onDisconnect: { addListener: (fn: typeof onDisconnect) => { onDisconnect = fn; } } }));
  vi.stubGlobal("chrome", { runtime: { id, getURL: (path: string) => `chrome-extension://${id}/${path}`,
    connectNative: connect, onMessage: { addListener: (fn: typeof handle) => { handle = fn; } } } });
  const module = await import("../extension/study/model-manager.bg.js");
  isSender = module.isManagerSettingsSender;
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function dispatch(action = "status", from: any = settings, args: any = {}) {
  const reply = vi.fn();
  const handled = handle({ type: "study-model-manager", action, args }, from, reply);
  return { reply, handled };
}

it("does not start a native app during module import", () => {
  expect(connect).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it("accepts only its own top-level settings page, excluding webpage and iframe callers", () => {
  expect(isSender(settings)).toBe(true);
  for (const from of [
    { ...settings, id: "b".repeat(32) }, { ...settings, url: "https://www.bilibili.com/video/BV1test" },
    { ...settings, url: `chrome-extension://${"b".repeat(32)}/study/options.html` },
    { ...settings, url: `chrome-extension://${id}/study/recording.html` },
    { ...settings, url: `https://${id}/study/options.html` }, { ...settings, frameId: 1 },
    { ...settings, url: undefined }
  ]) {
    expect(isSender(from)).toBe(false);
    expect(dispatch("start", from).reply).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  }
  expect(connect).not.toHaveBeenCalled();
});

it("rejects arbitrary management actions and non-object payloads before contacting native host", () => {
  expect(dispatch("exec").reply).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  expect(dispatch("download", settings, ["https://untrusted.invalid"]).reply)
    .toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  expect(connect).not.toHaveBeenCalled();
});

const content={id,url:'https://www.bilibili.com/video/BV1ab411c7mD/',frameId:0,tab:{id:12}};
it('lets a valid top-level study page start only with a model and source language',async()=>{
 const result=dispatch('start',content,{model:'large-v3-turbo',language:'ja'});expect(result.handled).toBe(true);
 const request=post.mock.calls[0][0];expect(request).toMatchObject({action:'start',args:{model:'large-v3-turbo',language:'ja'}});
 onNative({id:request.id,ok:true});await Promise.resolve();expect(result.reply).toHaveBeenCalledWith(expect.objectContaining({ok:true}));
});
it.each(['status','download','delete','prepareDelete','chooseDirectory','chooseImport','refreshCatalog','cancel','setDefault','setLegacyDefault','stop','handover','restart'])('rejects content action %s before opening native messaging',action=>{
 expect(dispatch(action,content,{model:'medium',language:'en'}).reply).toHaveBeenCalledWith(expect.objectContaining({ok:false}));expect(connect).not.toHaveBeenCalled();
});
it('rejects iframes, unrelated pages and extra start arguments',()=>{
 for(const sender of [{...content,frameId:1},{...content,id:'b'.repeat(32)},{...content,url:'https://evil.invalid/video/BV1ab411c7mD/'},{...content,url:'https://www.bilibili.com/'},{...content,url:'https://www.bilibili.com:444/video/BV1ab411c7mD/'},{...content,tab:{id:-1}}])expect(dispatch('start',sender,{model:'medium',language:'ja'}).reply).toHaveBeenCalledWith(expect.objectContaining({ok:false}));
 for(const args of [{model:'../model',language:'ja'},{model:'medium',language:'zh'},{model:'medium',language:'ja',confirm:'anything'},{language:'ja'}])expect(dispatch('start',content,args).reply).toHaveBeenCalledWith(expect.objectContaining({ok:false}));expect(connect).not.toHaveBeenCalled();
});

it("routes concurrent native responses by request id and ignores unrelated native output", async () => {
  const first = dispatch(), second = dispatch("start", settings, { model: "medium" });
  expect(first.handled).toBe(true);
  expect(connect).toHaveBeenCalledOnce();
  expect(connect).toHaveBeenCalledWith("com.biliscript.local_models");
  const [a, b] = post.mock.calls.map(call => call[0]);
  onNative({ id: "not-a-request", ok: true });
  expect(first.reply).not.toHaveBeenCalled();
  onNative({ id: b.id, ok: true, data: { starting: true } });
  onNative({ id: a.id, ok: true, data: { models: [] } });
  await Promise.resolve();
  expect(first.reply).toHaveBeenCalledWith({ id: a.id, ok: true, data: { models: [] } });
  expect(second.reply).toHaveBeenCalledWith({ id: b.id, ok: true, data: { starting: true } });
});

it("resolves pending work when native connection closes and reconnects on a later explicit action", async () => {
  const result = dispatch();
  onDisconnect();
  await Promise.resolve();
  expect(result.reply).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  dispatch();
  expect(connect).toHaveBeenCalledTimes(2);
});

it("returns a bounded error for a native operation which does not reply", async () => {
  const result = dispatch("start");
  await vi.advanceTimersByTimeAsync(45000);
  expect(result.reply).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});
