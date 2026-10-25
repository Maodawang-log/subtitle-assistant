import {beforeEach,afterEach,it,expect,vi} from "vitest";
const db=vi.hoisted(()=>({cleanupStaging:vi.fn(async()=>{}),deleteDictionary:vi.fn(async()=>{})}));
vi.mock("../extension/study/dictionary-db.js",()=>({...db,dictionaryState:vi.fn(),putDictionaryMeta:vi.fn(),putDictionaryBatch:vi.fn(),removeDictionaryGeneration:vi.fn(),activateDictionary:vi.fn()}));
let posted:any[],release:any,handler:any;
beforeEach(async()=>{
 vi.resetModules();posted=[];db.cleanupStaging.mockClear();db.deleteDictionary.mockClear();
 vi.stubGlobal("postMessage",(x:any)=>posted.push(x));
 Object.defineProperty(navigator,"locks",{configurable:true,value:{request:async(_name:string,_options:any,fn:any)=>{const value=await fn({});await new Promise<void>(resolve=>release=resolve);return value}}});
 await import("../extension/study/dictionary-worker.js");handler=(globalThis as any).onmessage;
});
afterEach(()=>{(globalThis as any).onmessage=null;vi.unstubAllGlobals()});
it("signals readiness only after releasing the lock, so an immediate next operation is accepted",async()=>{
 const ready=handler({data:{action:"recover"}});for(let i=0;i<15;i++)await Promise.resolve();
 expect(posted).toHaveLength(0);release();await ready;expect(posted).toEqual([{stage:"ready"}]);
 const deleted=handler({data:{action:"delete"}});for(let i=0;i<15;i++)await Promise.resolve();
 expect(db.deleteDictionary).toHaveBeenCalledTimes(1);expect(posted).toHaveLength(1);
 release();await deleted;expect(posted.at(-1)).toEqual({stage:"deleted"});
});
