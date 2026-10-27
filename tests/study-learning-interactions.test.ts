import './helpers/study-learning-store-host.js';
import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createStudyShell} from '../extension/study/ui-shell.js';
import {createLearningWorkspace} from '../extension/study/learning-workspace.js';
import {createMemoryStorageArea} from './helpers/memory-storage-area.js';
import {materialKey} from '../extension/study/learning-data.js';
import {learningAction} from '../extension/study/learning-store.js';
const deferred=<T>()=>{let resolve!:(v:T)=>void;return {promise:new Promise<T>(done=>resolve=done),resolve}};
let ui:any,workspace:any,m:any,adapter:any,disk:Map<string,any>,reply:(request:any)=>Promise<any>,send:any,binding:string;
const flush=async()=>{for(let n=0;n<100;n++)await Promise.resolve()};
const result=(e:any[])=>({ok:true,data:{supported:true,blocks:[{text:'summary',refs:[e[0].id]}],chapters:[{text:'global chapter',refs:[e[0].id]}],learning:[{text:'expression',refs:[e[0].id]}]},model:'fixture',provider:'https://fixture'});
beforeEach(()=>{
 disk=new Map();binding='video-1';m={version:1,key:materialKey('BV1ab411c7mD:p1','en'),route:'BV1ab411c7mD:p1',identity:'BV1ab411c7mD:111',bvid:'BV1ab411c7mD',page:1,cid:'111',language:'en',title:'video',duration:90,offset:0,source:'asr',ranges:[{start:0,end:30}],cues:[{id:'one',revision:1,start:1,end:3,text:'sentence',originalText:'sentence'}],at:1};
 reply=async r=>r.kind==='batch'?{ok:true,data:r.evidence.map((c:any)=>({id:c.id,status:'suggested',text:'changed '+c.text}))}:result(r.evidence);
 send=vi.fn(async r=>r.type==='study-learning-ai'?reply(r):{ok:true});
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('chrome',{runtime:{sendMessage:send,getURL:(p:string)=>p},storage:{local:createMemoryStorageArea(disk)}});
 ui=createStudyShell();adapter={material:()=>structuredClone(m),meta:()=>({...m}),current:()=>m.cues[0],binding:()=>binding,configuration:()=>"fixture",manualEditing:()=>false,correctionSnapshot:async()=>[],commitBatch:vi.fn(async()=>{}),undoBatch:vi.fn(async()=>{}),cancelCollection:vi.fn(),prepareOverall:vi.fn(async()=>{m.durationVerified=true;m.ranges=[{start:0,end:m.duration}];return structuredClone(m)}),redraw:()=>{},selectRelative:()=>{},replay:async()=>{},translateCurrent:async()=>{},record:()=>{},jump:async()=>{}};
 workspace=createLearningWorkspace(ui,adapter);ui.setEnabled(true);ui.setPane('video');
});
afterEach(async()=>{workspace.reset();await flush();ui.destroy();vi.unstubAllGlobals();vi.restoreAllMocks()});
it('loads old results into four peer groups and exports stored answers without invoking AI or collecting audio',async()=>{
 const saved={...result([{id:'s1'}]),evidence:[{id:'s1',start:1,end:3,text:'old source'}],material:{...m,cues:[]},fingerprint:'old',configuration:'old',at:1};
 const summary={...saved,result:saved.data},turn={...summary,question:'Saved question'};
 await learningAction('record',{key:m.key,record:{summary,conversation:[turn]}});
 adapter.download=vi.fn();adapter.availableChinese=()=> '已有中文';
 const loading=workspace.load();ui.$('notesSubtitles').checked=true;ui.$('exportNotes').click();await loading;
 await vi.waitFor(()=>expect(adapter.download).toHaveBeenCalledOnce());
 expect([...ui.$('pane-video').firstElementChild.children].filter((s:any)=>s.tagName==='DETAILS').map((s:any)=>s.firstElementChild.textContent)).toEqual(['总结与章节','视频问答','校对记录','视频与句子收藏']);
 expect(ui.$('videoSummary').textContent).not.toContain('expression');expect(ui.$('videoLearning')).toBeNull();
 expect(ui.$('videoConversation').textContent).toContain('Saved question');expect(ui.$('videoConversation').textContent).not.toContain('概述与要点');
 expect(ui.$('summaryStale').hidden).toBe(false);expect(ui.$('summaryScope').textContent).toContain('历史／局部总结');
 const [name,text]=adapter.download.mock.calls[0];expect(name).toMatch(/\.md$/);expect(text).toContain('先前结果');expect(text).toContain('Saved question');expect(text).toContain('old source');expect(text).toContain('已有中文');
 expect(send.mock.calls.filter(([r]:any)=>r.type==='study-learning-ai')).toHaveLength(0);expect(adapter.prepareOverall).not.toHaveBeenCalled();
});
it('cancels overall analysis if any new subtitles arrive after full preparation',async()=>{
 const hold=deferred<any>();reply=()=>hold.promise;ui.$('summaryGenerate').click();await vi.waitFor(()=>expect(send.mock.calls.some(([r]:any)=>r.type==='study-learning-ai')).toBe(true));
 m.cues.push({...m.cues[0],id:'next',start:31,end:33});workspace.changed();expect(workspace.busy).toBe(false);hold.resolve(result([{id:'s1'}]));await flush();expect(ui.$('videoSummary').textContent).not.toContain('global chapter');
});
it('archives legacy learning data when replacing a historical partial summary, without generating new learning',async()=>{
 const previous={result:{...result([{id:'s1'}]).data},material:{...m,cues:[]},evidence:[{id:'s1',start:1,end:3,text:'old original'}],at:1};
 await learningAction('record',{key:m.key,record:{summary:previous,conversation:[]}});
 ui.$('summaryGenerate').click();await vi.waitFor(()=>expect(workspace.busy).toBe(false));
 const saved=(await learningAction('get',{key:m.key})).record;
 expect(saved.legacySummaries[0]).toEqual(previous);expect(saved.summary.result.learning).toBeUndefined();expect(saved.summary.overall.kind).toBe('overall');
 expect(send.mock.calls.filter(([r]:any)=>r.type==='study-learning-ai').every(([r]:any)=>!r.notes?.some((n:any)=>n.kind==='learning'))).toBe(true);
});
it.each(['stop','route','language','model','subtitles'])('does not submit AI after pending full preparation is invalidated by %s',async reason=>{
 const pending=deferred<any>();adapter.prepareOverall=vi.fn(()=>pending.promise);
 ui.$('summaryGenerate').click();await vi.waitFor(()=>expect(adapter.prepareOverall).toHaveBeenCalledOnce());
 const signal=adapter.prepareOverall.mock.calls[0][0].signal;
 if(reason==='stop')ui.$('learningStop').click();
 else if(reason==='model')workspace.configurationChanged();
 else if(reason==='subtitles'){m.cues[0].text='changed';workspace.changed()}
 else {binding='new';workspace.reset()}
 expect(signal.aborted).toBe(true);pending.resolve({...m,durationVerified:true,ranges:[{start:0,end:m.duration}]});await flush();
 expect(send.mock.calls.some(([r]:any)=>r.type==='study-learning-ai')).toBe(false);
});
it.each(['edit','language','close'])('does not apply a late batch after %s',async reason=>{
 const hold=deferred<any>();reply=()=>hold.promise;ui.$('batchAll').click();await vi.waitFor(()=>expect(send.mock.calls.some(([r]:any)=>r.kind==='batch')).toBe(true));
 if(reason==='edit'){m.cues[0].revision++;workspace.changed()}else{binding='new';workspace.reset()}
 hold.resolve({ok:true,data:[{id:'s1',status:'suggested',text:'late'}]});await flush();expect(adapter.commitBatch).not.toHaveBeenCalled();
});
it('applies only snapshot sentences while keeping newly appended sentences outside the batch',async()=>{
 const hold=deferred<any>();reply=()=>hold.promise;ui.$('batchAll').click();await vi.waitFor(()=>expect(send.mock.calls.some(([r]:any)=>r.kind==='batch')).toBe(true));m.cues.push({...m.cues[0],id:'future',start:31,end:33});workspace.changed();hold.resolve({ok:true,data:[{id:'s1',status:'suggested',text:'edited first'}]});await vi.waitFor(()=>expect(adapter.commitBatch).toHaveBeenCalledOnce());expect(adapter.commitBatch.mock.calls[0][0].changes.map((c:any)=>c.id)).toEqual(['one']);
});
it('makes final batch save explicit and non-cancelable, without claiming captions unchanged',async()=>{
 const hold=deferred<void>();adapter.commitBatch.mockImplementation(()=>hold.promise);ui.$('batchAll').click();await vi.waitFor(()=>expect(adapter.commitBatch).toHaveBeenCalledOnce());expect(ui.$('batchStop').disabled).toBe(true);expect(ui.$('learningStop').disabled).toBe(true);expect(ui.$('batchProgress').textContent).toContain('统一保存');workspace.manualStarted();expect(ui.$('learningStatus').textContent).toContain('统一保存');expect(ui.$('learningStatus').textContent).not.toContain('未改动');hold.resolve();await flush();
});
it('reduces a long video to concise global chapters and saves cited snapshots instead of repeating full input',async()=>{
 m.cues=Array.from({length:850},(_,i)=>({id:'cue'+i,revision:1,start:i*2,end:i*2+1,text:'sentence '+i+' '+('x'.repeat(80)),originalText:'sentence '+i}));m.duration=1700;m.ranges=[{start:0,end:1700}];
 ui.$('summaryGenerate').click();await vi.waitFor(()=>expect(workspace.busy).toBe(false),{timeout:10000});
 const calls=send.mock.calls.map(([r]:any)=>r).filter((r:any)=>r.type==='study-learning-ai');expect(calls.some((r:any)=>r.kind==='reduce-summary')).toBe(true);expect(calls.every((r:any)=>JSON.stringify(r.evidence).length<25000)).toBe(true);
 const cache=disk.get('biliscriptStudyTemporaryV2'),record=cache['record:'+m.key].value;expect(record.summary.result.chapters).toHaveLength(1);expect(record.summary.evidence).toHaveLength(1);expect(record.summary.material.cues).toEqual([]);expect(record.summary.fingerprint).toHaveLength(64);expect(JSON.stringify(record).length).toBeLessThan(5000);
});

it('has one video bookmark control, saves acquired material and toggles back to temporary storage',async()=>{
 expect(ui.$('pinMaterial')).toBeNull();expect(ui.$('bookmarkCue')).toBeNull();
 ui.$('bookmarkVideo').click();await vi.waitFor(()=>expect(ui.$('bookmarkVideo').textContent).toBe('已收藏'));
 expect(disk.get('biliscriptStudyLibraryV1').documents[m.key].cues).toEqual(m.cues);
 expect(send.mock.calls.some(([r]:any)=>r.type==='study-learning-ai')).toBe(false);expect(adapter.prepareOverall).not.toHaveBeenCalled();
 ui.$('bookmarkVideo').click();await vi.waitFor(()=>expect(ui.$('bookmarkVideo').textContent).toBe('收藏视频'));
 expect(disk.get('biliscriptStudyLibraryV1').documents[m.key]).toBeUndefined();expect(disk.get('biliscriptStudyTemporaryV2')['document:'+m.key].value.cues).toEqual(m.cues);
});
