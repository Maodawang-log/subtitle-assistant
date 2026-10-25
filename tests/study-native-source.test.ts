import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {readNativeStudyPage} from "../extension/study/native-page.js";
import {readNativeSourceResult,sameNativeBinding} from "../extension/study/native-source.js";
const bv="BV1wYAmeqEuV",cid="28532081689",source="https://upos-hz-mirrorakam.akamaized.net/upgcxcode/89/16/28532081689/28532081689-1-30216.m4s?synthetic=one";
let video:HTMLVideoElement,vd:any,info:any,state:any,entries:any[],time:number,sourceUrl:string,ready:number;
const rect={x:0,y:0,left:0,top:0,right:800,bottom:450,width:800,height:450,toJSON(){}};
function visible(el:Element){el.getBoundingClientRect=()=>rect;}
function addVideo(){
 const v=document.createElement("video");visible(v);document.querySelector(".bpx-player-container")!.append(v);
 Object.defineProperties(v,{currentSrc:{get:()=>sourceUrl,configurable:true},duration:{get:()=>128,configurable:true},currentTime:{get:()=>time,configurable:true},readyState:{get:()=>ready,configurable:true}});
 v.setAttribute("data-biliscript-study-binding","doc:1");return v;
}
beforeEach(()=>{
 history.replaceState({},"","https://www.bilibili.com/video/"+bv+"/");
 document.body.innerHTML='<div class="bpx-player-container"><span class="bpx-player-toast-confirm-login">试看30秒</span></div>';
 visible(document.querySelector("span")!);time=2;ready=4;sourceUrl="blob:https://www.bilibili.com/current";
 video=addVideo();
 vd={bvid:bv,cid,title:"actual fixture",duration:128,pages:[{page:1,cid,duration:128}],subtitle:{list:[]}};
 info={timelength:127848,dash:{duration:128,audio:[{bandwidth:37102,baseUrl:source,backupUrl:[]}]},is_preview:false};
 entries=[{name:source,startTime:1000,responseEnd:1010,duration:10,responseStatus:206,initiatorType:"xmlhttprequest"}];
 state={version:2,documentId:"doc",timeOrigin:123,routeKey:bv+":p1",routeEpoch:0,epochStart:0,videoGeneration:1,videoEpoch:900,video,mediaSrc:sourceUrl,active:true,sync:()=>state};
 vi.stubGlobal("__BILISCRIPT_STUDY_ROUTE_V2__",state);vi.stubGlobal("__INITIAL_STATE__",{videoData:vd});vi.stubGlobal("__playinfo__",{data:info});
 vi.stubGlobal("performance",{timeOrigin:123,getEntriesByType:()=>entries});
});
afterEach(()=>{vi.unstubAllGlobals();document.body.replaceChildren()});
describe("current-player audio association",()=>{
 it("accepts exact observed 206 URL with current CID and conservative preview cap",()=>{
  const result=readNativeStudyPage();expect(result.status).toBe("ready");
  expect(result).toMatchObject({bvid:bv,cid,playableDuration:30,subtitleListPresent:true,japaneseTrackCount:0,source:{url:source,backupUrls:[]},audit:{exactUrlMatch:true,responseStatus:206,cidPathMatch:true}});
  expect(readNativeSourceResult(result)).toEqual(result);
 });
 it("rejects old request completed after a later A→B→A route epoch",()=>{
  state.routeEpoch=2;state.epochStart=1050;entries[0].responseEnd=1100;expect(readNativeStudyPage()).toMatchObject({status:"unavailable",reason:"NO_PLAYED_AUDIO"});
 });
 it("rejects old request from before video loadstart/emptied generation",()=>{
  state.videoEpoch=1001;expect(readNativeStudyPage().status).toBe("unavailable");
 });
 it("rejects a previous playinfo at the same duration after same-BV P switch",()=>{
  history.replaceState({},"","/video/"+bv+"/?p=2");state.routeKey=bv+":p2";vd.pages.push({page:2,cid:"999",duration:128});
  expect(readNativeStudyPage()).toMatchObject({reason:"CID"});vd.cid="999";
  expect(readNativeStudyPage()).toMatchObject({reason:"NO_PLAYED_AUDIO"});
 });
 it("rejects stale videoData BV despite matching duration",()=>{
  vd.bvid="BV1Qtnt6JEy8";expect(readNativeStudyPage()).toMatchObject({reason:"IDENTITY"});
 });
 it.each([
 "https://upos-hz-mirrorakam.akamaized.net.evil.example/upgcxcode/89/16/28532081689/28532081689-1-30216.m4s",
 "https://child.upos-hz-mirrorakam.akamaized.net/upgcxcode/89/16/28532081689/28532081689-1-30216.m4s",
 "https://user:pass@upos-hz-mirrorakam.akamaized.net/upgcxcode/89/16/28532081689/28532081689-1-30216.m4s",
 "https://upos-hz-mirrorakam.akamaized.net:444/upgcxcode/89/16/28532081689/28532081689-1-30216.m4s",
 "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/89/16/128532081689/128532081689-1-30216.m4s",
 "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/89/16/28532081689/999-1-30216.m4s",
 "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/89/16/%3228532081689/28532081689-1-30216.m4s",
 "http://upos-hz-mirrorakam.akamaized.net/upgcxcode/89/16/28532081689/28532081689-1-30216.m4s"
 ])("rejects spoofed host/path %s",url=>{
  info.dash.audio[0].baseUrl=url;entries[0].name=url;expect(readNativeStudyPage().status).toBe("unavailable");
 });
 it("does not carry an unobserved or old-CID backup through a valid primary",()=>{
  info.dash.audio[0].backupUrl=[source.replace("synthetic=one","synthetic=unseen"),source.replaceAll(cid,"777")];
  const result=readNativeStudyPage();expect(result).toMatchObject({status:"ready",source:{url:source,backupUrls:[]}});
 });
 it("rejects pathname-only match when the signed query differs",()=>{
  entries[0].name=source.replace("synthetic=one","synthetic=other");expect(readNativeStudyPage()).toMatchObject({reason:"NO_PLAYED_AUDIO"});
 });
 it.each([200,0,403])("requires actual 206 status, rejects %s",status=>{
  entries[0].responseStatus=status;expect(readNativeStudyPage().status).toBe("unavailable");
 });
 it("rejects hidden/disconnected/ambiguous video and non-current blob origin",()=>{
  video.style.display="none";expect(readNativeStudyPage().status).toBe("unavailable");video.style.display="";
  const extra=addVideo();expect(readNativeStudyPage()).toMatchObject({reason:"PLAYER_AMBIGUOUS"});extra.remove();
  sourceUrl="blob:https://other.example/old";expect(readNativeStudyPage()).toMatchObject({reason:"PLAYER"});
  video.remove();expect(readNativeStudyPage().status).toBe("unavailable");
 });
 it("rejects changed lifecycle binding and missing metadata",()=>{
  video.setAttribute("data-biliscript-study-binding","doc:2");expect(readNativeStudyPage()).toMatchObject({reason:"VIDEO_GENERATION"});
  video.setAttribute("data-biliscript-study-binding","doc:1");ready=0;expect(readNativeStudyPage()).toMatchObject({reason:"PLAYER"});
 });
 it("rejects inconsistent duration and unknown preview bounds",()=>{
  info.dash.duration=127;expect(readNativeStudyPage().status).toBe("ready");info.dash.duration=124;expect(readNativeStudyPage()).toMatchObject({reason:"DURATION"});
  info.dash.duration=128;document.querySelector("span")!.textContent="试看";expect(readNativeStudyPage()).toMatchObject({reason:"PREVIEW_UNKNOWN"});
 });
 it("returns the explicit cap for rechecking at its end; seekable does not expand it",()=>{
  Object.defineProperty(video,"seekable",{value:{length:1,start:()=>0,end:()=>128}});time=30;expect(readNativeStudyPage()).toMatchObject({status:"ready",playableDuration:30});
 });
 it("distinguishes an absent subtitle list from a known empty one",()=>{
  delete vd.subtitle;expect(readNativeStudyPage()).toMatchObject({status:"ready",subtitleListPresent:false});
 });
 it("rejects document marker mismatch and stale return after sync",()=>{
  state.timeOrigin=122;expect(readNativeStudyPage()).toMatchObject({reason:"DOCUMENT"});state.timeOrigin=123;
  let calls=0;state.sync=()=>{if(++calls===2)state.routeEpoch++;return state};expect(readNativeStudyPage()).toMatchObject({reason:"STALE"});
 });
 it("keeps a latched shorter preview even after its toast is closed",()=>{
  state.previewLimit=10;document.querySelector("span")!.remove();expect(readNativeStudyPage()).toMatchObject({status:"ready",playableDuration:10,audit:{previewSeconds:10}});
 });
 it("does not invent a 30-second cap from missing login metadata",()=>{
  document.querySelector("span")!.remove();expect(readNativeStudyPage()).toMatchObject({status:"ready",playableDuration:128,audit:{accessScope:"current-player"}});
  (globalThis as any).__INITIAL_STATE__.isLogin=true;expect(readNativeStudyPage()).toMatchObject({status:"ready",playableDuration:128,audit:{accessScope:"current-player"}});
  vd.is_upower_exclusive=true;expect(readNativeStudyPage()).toMatchObject({reason:"PREVIEW_UNKNOWN"});
 });
 it("validates response shape and compares every binding component",()=>{
  const result:any=readNativeStudyPage();expect(readNativeSourceResult({...result,playableDuration:Infinity}).status).toBe("unavailable");
  expect(sameNativeBinding(result.binding,{...result.binding})).toBe(true);
  for(const key of ["documentId","routeKey","routeEpoch","videoGeneration","videoTag","mediaSrc","timeOrigin"])expect(sameNativeBinding(result.binding,{...result.binding,[key]:typeof result.binding[key]==="number"?result.binding[key]+1:"changed"})).toBe(false);
 });
});
