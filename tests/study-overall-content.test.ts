import './helpers/study-learning-store-host.js';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createMemoryStorageArea} from './helpers/memory-storage-area.js';
import {learningAction} from '../extension/study/learning-store.js';
import {materialKey} from '../extension/study/learning-data.js';

const transport=vi.hoisted(()=>({mode:'cc',native:null as any,requests:[] as number[],events:[] as string[],hold:null as any,holdStart:60,fail:false,nativeCalls:0}));
vi.mock('../extension/study/cc-source.js',async original=>({...await original<any>(),getJapaneseCc:async()=>transport.mode==='cc'?{status:'ready',bvid:'BV1ab411c7mD',cid:'111',title:'whole track',duration:90,tracks:[{id:'71',lan:'en'}],selectedTrackId:'71',wholeTrack:true,cues:[{from:2,to:4,content:'Repeated real words.'},{from:15,to:17,content:'Repeated real words.'}]}:{status:'no-source',bvid:'BV1ab411c7mD',cid:'111',title:'audio',duration:90,tracks:[],cues:[]}}));
vi.mock('../extension/study/native-source.js',async original=>({...await original<any>(),getNativeStudySource:async()=>{transport.nativeCalls++;return transport.native}}));
const deferred=<T>()=>{let resolve!:(v:T)=>void;return {promise:new Promise<T>(r=>resolve=r),resolve}};
const route='BV1ab411c7mD:p1',key=materialKey(route,'en');
let disk:Map<string,any>,send:any,root:ShadowRoot,video:HTMLVideoElement,listeners:any[];
const $=(id:string)=>root?.getElementById(id)||document.getElementById('biliscript-study-controls')?.shadowRoot?.getElementById(id) as any;
const flush=async()=>{for(let n=0;n<160;n++)await Promise.resolve()};
const response=(start:number)=>({ok:true,data:{timestamp_origin:'absolute',opening_repair:{version:1},segments:[{start:start+1,end:start+3,text:'Repeated real words.'}]}});
const aiCalls=()=>send.mock.calls.map(([r]:any)=>r).filter((r:any)=>r.type==='study-learning-ai');
async function enable(){($('enable') as HTMLElement).click();await vi.waitFor(()=>expect(($('enable') as HTMLElement).textContent).toBe('关闭字幕'));await flush()}
async function importFile(){Object.defineProperty($('subtitleFile'),'files',{configurable:true,value:[{name:'fixture.srt',size:100,text:async()=> '1\n00:00:01,000 --> 00:00:03,000\nImported sentence.'}]});($('subtitleFile') as HTMLElement).dispatchEvent(new Event('change'));await flush()}
beforeEach(async()=>{
 vi.resetModules();vi.useFakeTimers();transport.mode='cc';transport.requests=[];transport.events=[];transport.fail=false;transport.hold=null;transport.holdStart=60;transport.nativeCalls=0;
 history.replaceState({},'', 'https://www.bilibili.com/video/BV1ab411c7mD/');
 document.body.innerHTML='<div class="bpx-player-container"><video data-biliscript-study-binding="fixture"></video></div>';
 video=document.querySelector('video')!;Object.defineProperties(video,{currentTime:{configurable:true,writable:true,value:0},duration:{configurable:true,value:90},paused:{configurable:true,value:true},currentSrc:{configurable:true,value:'https://audit.bilivideo.com/audio'},ended:{configurable:true,value:false}});video.pause=vi.fn();video.play=vi.fn(async()=>{});
 transport.native={status:'ready',bvid:'BV1ab411c7mD',cid:'111',title:'audio',duration:90,playableDuration:90,subtitleListPresent:true,japaneseTrackCount:0,englishTrackCount:1,source:{url:'https://audit.bilivideo.com/audio',backupUrls:[]},binding:{routeKey:route,videoTag:'fixture',mediaSrc:video.currentSrc},audit:{previewSeconds:null}};
 disk=new Map([['biliscriptJapaneseSettings',{sourceLanguage:'en',asrModel:'small'}]]);
 const receive=async(r:any)=>{
  if(r.type==='study-settings-public')return {ok:true,config:{sourceLanguage:'en',asrModel:'small',configured:true}};
  if(r.type==='study-local-asr'&&r.action==='window'){transport.requests.push(r.payload.start);transport.events.push('asr:'+r.payload.start);if(r.payload.start===transport.holdStart&&transport.hold)return transport.hold.promise;if(r.payload.start===60&&transport.fail)return {ok:false,error:{code:'FIXTURE',message:'fixture failed'}};return response(r.payload.start)}
  if(r.type==='study-learning-ai'){transport.events.push('ai:'+r.kind);return {ok:true,data:{supported:true,blocks:[{text:'overall answer',refs:[r.evidence[0].id]}],chapters:[{title:'chapter',text:'chapter summary',refs:[r.evidence[0].id]}]},model:'fixture',provider:'fixture'}}
  if(r.type==='study-local-asr'&&r.action==='cancel')return {ok:true,data:{cancelled:true}};
  return {ok:true,entries:[]};
 };send=vi.fn((r:any,callback?:Function)=>{const pending=receive(r);if(callback)void pending.then(v=>callback(v));return pending});
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('chrome',{runtime:{getURL:(p:string)=>p,sendMessage:send,onMessage:{addListener:vi.fn()}},storage:{local:createMemoryStorageArea(disk),onChanged:{addListener:vi.fn()}}});
 vi.stubGlobal('fetch',vi.fn(async()=>({json:async()=>({})})));vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('kuromoji',{builder:()=>({build:(done:any)=>done(null,{tokenize:()=>[]})})});vi.stubGlobal('JSTUDY',new Function(readFileSync('extension/study/core.js','utf8')+'\nreturn JSTUDY;')());
 listeners=[];for(const target of [window,document]){const original=target.addEventListener.bind(target);vi.spyOn(target,'addEventListener').mockImplementation(((t:any,fn:any,options:any)=>{listeners.push([target,t,fn,options]);original(t,fn,options)}) as any)}
 await import('../extension/study/content.js');await flush();root=document.getElementById('biliscript-japanese-study')!.shadowRoot!;
});
afterEach(async()=>{
 ($('enable')?.textContent==='关闭字幕')&&($('enable') as HTMLElement).click();await flush();
 for(const [target,t,fn,options] of listeners)target.removeEventListener(t,fn,options);vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();
 for(const id of ['biliscript-japanese-study','biliscript-study-controls','biliscript-study-slot','biliscript-study-overlay'])document.getElementById(id)?.remove();
});
it('summarizes a whole CC track with long silent gaps, ASR zero and one overall entry',async()=>{
 await enable();expect(transport.requests).toEqual([]);expect(aiCalls()).toHaveLength(0);expect($('collectFull')).toBeNull();expect($('videoLearning')).toBeNull();
 ($('summaryGenerate') as HTMLElement).click();await vi.waitFor(()=>expect(aiCalls()).toHaveLength(1));await flush();
 expect(transport.requests).toEqual([]);expect(aiCalls()[0].overall.basis).toBe('cc-track');expect(transport.nativeCalls).toBe(1);expect($('summaryGenerate')!.textContent).toBe('重新生成整体总结');
 expect($('summaryScope')!.textContent).toContain('整轨 CC');
});
it('uses import confirmation once, with no audio transcribing for a user-confirmed complete file',async()=>{
 await enable();await importFile();($('summaryGenerate') as HTMLElement).click();await vi.waitFor(()=>expect(($('importScopeDialog') as HTMLDialogElement).open).toBe(true));
 expect(aiCalls()).toHaveLength(0);($('importScopeFull') as HTMLElement).click();await vi.waitFor(()=>expect(aiCalls()).toHaveLength(1));await flush();
 expect(transport.requests).toEqual([]);expect(aiCalls()[0].overall.basis).toBe('confirmed-import');
 ($('summaryGenerate') as HTMLElement).click();await vi.waitFor(()=>expect(aiCalls()).toHaveLength(2));expect(($('importScopeDialog') as HTMLDialogElement).open).toBe(false);
});
it('dismisses pending import confirmation on stop without calling AI or ASR',async()=>{
 await enable();await importFile();($('summaryGenerate') as HTMLElement).click();await vi.waitFor(()=>expect(($('importScopeDialog') as HTMLDialogElement).open).toBe(true));
 ($('learningStop') as HTMLElement).click();await flush();expect(($('importScopeDialog') as HTMLDialogElement).open).toBe(false);($('importScopeFull') as HTMLElement).click();await flush();expect(aiCalls()).toHaveLength(0);expect(transport.requests).toEqual([]);
});
it('refreshes a legacy cached CC track before overall summary instead of switching to ASR',async()=>{
 await learningAction('snapshot',{document:{version:1,key,route,identity:'BV1ab411c7mD:111',bvid:'BV1ab411c7mD',cid:'111',page:1,language:'en',title:'legacy',source:'cc',duration:90,durationVerified:true,offset:0,ranges:[{start:1,end:3}],cues:[{id:'old',revision:1,start:1,end:3,text:'cached words'}],at:1}});
 await enable();expect($('rows')!.textContent).toContain('cached words');($('summaryGenerate') as HTMLElement).click();await vi.waitFor(()=>expect(aiCalls()).toHaveLength(1));expect(transport.requests).toEqual([]);expect(aiCalls()[0].evidence.map((e:any)=>e.text)).toEqual(['Repeated real words.','Repeated real words.']);
});
it('completes missing ASR windows before AI and preserves repeated speech instead of globally deduplicating',async()=>{
 transport.mode='asr';transport.native.englishTrackCount=0;await enable();await vi.waitFor(()=>expect(transport.requests).toEqual([0,30]));expect(aiCalls()).toHaveLength(0);
 const hold=deferred<any>();transport.hold=hold;($('summaryGenerate') as HTMLElement).click();await vi.waitFor(()=>expect(transport.requests).toContain(60));expect(aiCalls()).toHaveLength(0);
 hold.resolve(response(60));await vi.waitFor(()=>expect(aiCalls()).toHaveLength(1));expect(transport.requests).toEqual([0,30,60]);expect(transport.events.indexOf('asr:60')).toBeLessThan(transport.events.indexOf('ai:summary'));expect(aiCalls()[0].evidence).toHaveLength(3);
});
it('reuses a current in-flight recognition window when switching from ordinary watching to overall preparation',async()=>{
 transport.mode='asr';transport.native.englishTrackCount=0;const hold=deferred<any>();transport.hold=hold;transport.holdStart=30;
 await enable();await vi.waitFor(()=>expect(transport.requests).toEqual([0,30]));($('summaryGenerate') as HTMLElement).click();await flush();
 expect(transport.requests).toEqual([0,30]);expect(aiCalls()).toHaveLength(0);hold.resolve(response(30));
 await vi.waitFor(()=>expect(aiCalls()).toHaveLength(1));expect(transport.requests).toEqual([0,30,60]);
});
it.each(['failure','stop'])('keeps old partial/learning data and submits no AI on collection %s',async reason=>{
 transport.mode='asr';transport.native.englishTrackCount=0;await enable();await vi.waitFor(()=>expect(transport.requests).toEqual([0,30]));
 const old={result:{supported:true,blocks:[{text:'old partial',refs:['s1']}],chapters:[],learning:[{text:'legacy expression',refs:['s1']}]},material:{version:1,key,route,identity:'BV1ab411c7mD:111',bvid:'BV1ab411c7mD',cid:'111',page:1,language:'en',title:'old',source:'asr',duration:90,offset:0,ranges:[{start:0,end:30}],cues:[]},evidence:[{id:'s1',start:1,end:3,text:'old evidence'}]};
 await learningAction('record',{key,record:{summary:old,conversation:[]}});
 const hold=deferred<any>();if(reason==='failure')transport.fail=true;else transport.hold=hold;
 ($('summaryGenerate') as HTMLElement).click();await vi.waitFor(()=>expect(transport.requests).toContain(60));
 if(reason==='stop'){($('learningStop') as HTMLElement).click();hold.resolve(response(60))}
 await vi.waitFor(()=>expect(($('learningStop') as HTMLElement).hidden).toBe(true));await flush();expect(aiCalls()).toHaveLength(0);expect((await learningAction('get',{key})).record.summary).toEqual(old);if(reason==='failure')expect($('learningStatus')!.textContent).toContain('全片字幕准备失败');
});
it('rejects a preview before starting full collection or AI',async()=>{
 transport.mode='asr';transport.native.englishTrackCount=0;transport.native.playableDuration=30;transport.native.audit.previewSeconds=30;await enable();await vi.waitFor(()=>expect(transport.requests).toEqual([0]));
 ($('summaryGenerate') as HTMLElement).click();await vi.waitFor(()=>expect($('learningStatus')!.textContent).toContain('仅可播放部分'));expect(aiCalls()).toHaveLength(0);expect(transport.requests).toEqual([0]);
});
it('starts overall collection from the beginning even when playback is already at the end',async()=>{
 transport.mode='asr';transport.native.englishTrackCount=0;video.currentTime=90;Object.defineProperty(video,'ended',{configurable:true,value:true});await enable();expect(transport.requests).toEqual([]);
 ($('summaryGenerate') as HTMLElement).click();await vi.waitFor(()=>expect(aiCalls()).toHaveLength(1));expect(transport.requests).toEqual([0,30,60]);expect(video.currentTime).toBe(90);expect(aiCalls()[0].overall.basis).toBe('asr-complete');
});
