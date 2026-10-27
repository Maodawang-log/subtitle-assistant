import './helpers/study-learning-store-host.js';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createMemoryStorageArea} from './helpers/memory-storage-area.js';
const transport=vi.hoisted(()=>({lookup:null as any,ai:null as any}));
vi.mock('../extension/study/cc-source.js',()=>({getJapaneseCc:async()=>({status:'ready',bvid:'BV1ab411c7mD',cid:'111',title:'Merged view fixture',duration:120,tracks:[],cues:[{from:0,to:5,content:'We are running a test.'},{from:10,to:15,content:'Another sentence.'}]})}));
vi.mock('../extension/study/native-source.js',()=>({getNativeStudySource:async()=>({status:'unavailable',reason:'FIXTURE'}),sameNativeBinding:()=>false}));
const deferred=()=>{let resolve!:(v:any)=>void;return {promise:new Promise(r=>resolve=r),resolve}};
let root:ShadowRoot,send:any,events:any[],disk:Map<string,any>;
const $=(id:string)=>(root?.getElementById(id)||document.getElementById('biliscript-study-controls')?.shadowRoot?.getElementById(id)) as any;
const aiCalls=()=>send.mock.calls.map(([r]:any)=>r).filter((r:any)=>r.type==='study-ai');
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve()};
const word=(term:string)=>[...$('rows').querySelectorAll('.token')].find((n:any)=>n.textContent===term) as HTMLElement;
function pointer(target:EventTarget,type:string,x=0){const event=new MouseEvent(type,{bubbles:true,composed:true,button:0,clientX:x,clientY:10});Object.defineProperty(event,'pointerId',{value:1});target.dispatchEvent(event)}
function drag(first:string,last:string){const a=word(first).querySelector('ruby')!.firstChild!,b=word(last).querySelector('ruby')!.firstChild!,range=document.createRange();range.setStart(a,0);range.setEnd(b,b.textContent!.length);(root as any).getSelection=()=>({isCollapsed:false,rangeCount:1,getRangeAt:()=>range});pointer(word(first),'pointerdown');pointer(document,'pointermove',25);pointer(document,'pointerup',25)}
beforeEach(async()=>{
 vi.resetModules();vi.useFakeTimers();history.replaceState({},'','https://www.bilibili.com/video/BV1ab411c7mD/');document.body.innerHTML='<div class="bpx-player-container"><video></video></div>';
 const video=document.querySelector('video')!;Object.defineProperties(video,{currentTime:{configurable:true,writable:true,value:1},duration:{configurable:true,value:120},paused:{configurable:true,value:true}});video.pause=vi.fn();video.play=vi.fn(async()=>{});
 disk=new Map([['biliscriptJapaneseSettings',{sourceLanguage:'en'}]]);transport.lookup=async()=>({ok:true,entries:[{term:'running',reading:'',meaning:'本地释义',source:'fixture dictionary'}]});transport.ai=async()=>({ok:true,text:'## 解释\n\n**AI 释义**\n\n- 示例'});
 send=vi.fn(async(r:any)=>r.type==='study-settings-public'?{ok:true,config:{sourceLanguage:'en',configured:true}}:r.type==='study-dictionary-lookup'?transport.lookup(r):r.type==='study-ai'?transport.ai(r):{ok:true});
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('chrome',{runtime:{getURL:(p:string)=>p,sendMessage:send,onMessage:{addListener:vi.fn()}},storage:{local:createMemoryStorageArea(disk),onChanged:{addListener:vi.fn()}}});vi.stubGlobal('fetch',vi.fn(async()=>({json:async()=>({})})));vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('JSTUDY',new Function(readFileSync('extension/study/core.js','utf8')+'\nreturn JSTUDY;')());
 events=[];for(const target of [window,document]){const original=target.addEventListener.bind(target);vi.spyOn(target,'addEventListener').mockImplementation(((type:any,listener:any,options:any)=>{events.push([target,type,listener,options]);original(type,listener,options)}) as any)}
 await import('../extension/study/content.js');await flush();root=document.getElementById('biliscript-japanese-study')!.shadowRoot!;$('enable').click();await flush();
});
afterEach(async()=>{if($('enable')?.textContent==='关闭字幕')$('enable').click();await flush();for(const [target,type,fn,opts] of events)target.removeEventListener(type,fn,opts);vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();for(const id of ['biliscript-japanese-study','biliscript-study-controls','biliscript-study-slot','biliscript-study-overlay'])document.getElementById(id)?.remove()});
it('uses six tabs and opening the merged explanation or chat tab does not request AI',async()=>{
 expect([...root.querySelectorAll('[data-pane]')].map(n=>n.textContent)).toEqual(['字幕','视频','讲解','AI 对话','生词本','跟读']);
 expect($('pane-vocabulary')).toBeNull();for(const pane of ['explanation','chat']){(root.querySelector(`[data-pane=${pane}]`) as HTMLElement).click();await flush()}
 expect(aiCalls()).toHaveLength(0);
});
it('shows a local hit in the merged view with no AI, original text, star and folding preserved',async()=>{
 word('running').click();await vi.waitFor(()=>expect($('wordDetail').textContent).toContain('本地释义'));
 expect(root.querySelector('[data-pane=explanation]')!.getAttribute('aria-pressed')).toBe('true');expect($('explainOriginal').textContent).toBe('running');expect(aiCalls()).toHaveLength(0);
 $('wordDetail').querySelector('.word-toggle').click();expect($('wordDetail').querySelector('.word-body').hidden).toBe(true);$('wordDetail').querySelector('.word-star').click();await flush();expect(disk.get('biliscriptStudyVocabulary')[0].source.sentence).toBe('We are running a test.');
});
it('sends exactly one contextual word explanation for an explicit local miss',async()=>{
 transport.lookup=async()=>({ok:true,entries:[]});word('running').click();await vi.waitFor(()=>expect(aiCalls()).toHaveLength(1));await flush();
 expect(aiCalls()[0]).toMatchObject({kind:'word',text:'running',scope:'selection'});expect(aiCalls()[0].context).toContain('We are running a test.');expect($('wordDetail').querySelector('strong')?.textContent).toBe('AI 释义');
});
it('does not interpret a dictionary error as a miss',async()=>{
 transport.lookup=async()=>({ok:false,error:'词典读取失败'});word('running').click();await flush();expect(aiCalls()).toHaveLength(0);expect($('wordDetail').textContent).toContain('词典读取失败');
});
it.each([['running','test'],['running','running']])('dragging %s through %s sends one selection explanation and no per-word AI',async(first,last)=>{
 transport.lookup=async()=>({ok:true,entries:[]});drag(first,last);await vi.waitFor(()=>expect(aiCalls()).toHaveLength(1));await flush();
 expect(aiCalls()[0].kind).toBe('explain');expect($('explainOriginal').textContent).toContain('running');expect($('detail').textContent).toContain('AI 释义');expect($('wordDetail').querySelectorAll('.word-card').length).toBeGreaterThan(0);expect(aiCalls()).toHaveLength(1);
});
it('ignores an old dictionary miss after a different word is selected',async()=>{
 const hold=deferred();transport.lookup=vi.fn().mockImplementationOnce(()=>hold.promise).mockResolvedValue({ok:true,entries:[{term:'test',reading:'',meaning:'新词本地释义',source:'dictionary'}]});word('running').click();await flush();word('test').click();await flush();hold.resolve({ok:true,entries:[]});await flush();
 expect($('explainOriginal').textContent).toBe('test');expect($('wordDetail').textContent).toContain('新词本地释义');expect(aiCalls()).toHaveLength(0);
});
it('ignores an old AI answer after a different word is selected',async()=>{
 const hold=deferred();transport.lookup=async(r:any)=>r.queries.includes('running')?{ok:true,entries:[]}:{ok:true,entries:[{term:'test',reading:'',meaning:'新词本地释义',source:'dictionary'}]};transport.ai=()=>hold.promise;
 word('running').click();await vi.waitFor(()=>expect(aiCalls()).toHaveLength(1));word('test').click();await flush();hold.resolve({ok:true,text:'STALE OLD ANSWER'});await flush();expect($('explainOriginal').textContent).toBe('test');expect($('wordDetail').textContent).not.toContain('STALE OLD ANSWER');
});
it.each(['explain','paragraph'])('%s keeps the existing request and renders in the shared explanation view',async id=>{
 $(id).click();await vi.waitFor(()=>expect(aiCalls()).toHaveLength(1));await flush();expect($('detail').querySelector('strong')?.textContent).toBe('AI 释义');expect($('explainOriginal').textContent).toContain('We are running a test.');expect($('wordDetail').hidden).toBe(true);
});
