import {readFileSync} from "node:fs";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
let v:HTMLVideoElement,s:any,time=0,wall=1000,paused=false,src="",oldPush:any,oldReplace:any;
const rect={width:800,height:450};
beforeEach(()=>{
 vi.useFakeTimers();oldPush=history.pushState;oldReplace=history.replaceState;history.replaceState({},"","https://www.bilibili.com/video/BV1wYAmeqEuV/");
 document.body.innerHTML='<div class="bpx-player-container"><video></video><span class="bpx-player-toast-confirm-login">试看30秒</span></div>';
 for(const e of document.querySelectorAll("video,span"))e.getBoundingClientRect=()=>rect as DOMRect;
 time=0;wall=1000;paused=false;src="blob:https://www.bilibili.com/one";v=document.querySelector("video")!;
 Object.defineProperties(v,{currentTime:{get:()=>time},paused:{get:()=>paused},currentSrc:{get:()=>src},readyState:{get:()=>4},seeking:{get:()=>false}});
 vi.stubGlobal("performance",{now:()=>wall,timeOrigin:1000});
 vi.stubGlobal("MutationObserver",class{observe(){}});
 vi.stubGlobal("__INITIAL_STATE__",{isLogin:false,videoData:{}});
 vi.stubGlobal("__playinfo__",{data:{is_preview:false}});
 vi.stubGlobal("__BILISCRIPT_STUDY_ROUTE_V2__",undefined);
 new Function(readFileSync("extension/study/native-observer.js","utf8"))();s=(globalThis as any).__BILISCRIPT_STUDY_ROUTE_V2__;
});
afterEach(()=>{history.pushState=oldPush;history.replaceState=oldReplace;vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();document.body.replaceChildren()});
function tick(delta:number){time+=delta;wall+=250;s.sync()}
it("keeps a preview after a disappearing toast or a seek alone",()=>{
 expect(s.previewLimit).toBe(30);document.querySelector("span")!.remove();s.sync();expect(s.previewLimit).toBe(30);
 paused=true;time=60;v.dispatchEvent(new Event("seeking",{bubbles:true}));for(let i=0;i<8;i++)tick(0);expect(s.previewLimit).toBe(30);
});
it("releases a stale numeric limit only after sustained playback beyond it and ignores the stale same toast",()=>{
 time=30.5;v.dispatchEvent(new Event("seeking",{bubbles:true}));s.sync();
 for(let i=0;i<8;i++)tick(.25);
 expect(s.previewLimit).toBeNull();expect(s.releasedLimit).toBe(30);s.sync();expect(s.previewLimit).toBeNull();
});
it("allows a later authenticated fresh player generation to clear a vanished preview",()=>{
 (globalThis as any).__INITIAL_STATE__.isLogin=true;s.sync();expect(s.previewLimit).toBe(30);
 document.querySelector("span")!.remove();src="blob:https://www.bilibili.com/fresh";wall+=100;s.sync();expect(s.previewLimit).toBeNull();
});
it("does not treat an initially true login flag plus media recreation as a new login",()=>{
 (globalThis as any).__INITIAL_STATE__.isLogin=true;
 (globalThis as any).__BILISCRIPT_STUDY_ROUTE_V2__=undefined;
 new Function(readFileSync("extension/study/native-observer.js","utf8"))();s=(globalThis as any).__BILISCRIPT_STUDY_ROUTE_V2__;
 document.querySelector("span")!.remove();src="blob:https://www.bilibili.com/recreated";wall+=200;s.sync();
 expect(s.previewLimit).toBe(30);
});
