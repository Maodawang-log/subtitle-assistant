import {webcrypto} from 'node:crypto';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createLearningStore,TEMP_KEY,LIBRARY_KEY,LEGACY_AUDIO,LEGACY_AI,trimCache} from '../extension/study/learning-store.js';
import {timeLabel,materialCoverage,materialKey,materialFingerprint,splitEvidence,evidenceCues,scheduleReview,type VideoMaterial} from '../extension/study/learning-data.js';
import {parseGrounded,parseBatch,createLearningAi} from '../extension/study/learning-ai.js';
import {scopeStillCurrent,boundedHistory} from '../extension/study/learning-guards.js';
import {createBoundedAsrController} from '../extension/study/bounded-asr.js';
import {createMemoryStorageArea} from './helpers/memory-storage-area.js';
import {createCueTimeline} from '../extension/study/cue-revisions.js';

const cue={id:'c1',revision:1,start:1,end:4,text:'The first sentence.',originalText:'The first sentence.'};
const material:VideoMaterial={version:1,key:materialKey('BV1ab411c7mD:p1','en'),route:'BV1ab411c7mD:p1',identity:'BV1ab411c7mD:111',bvid:'BV1ab411c7mD',page:1,cid:'111',language:'en',title:'fixture',duration:120,offset:0,source:'asr',ranges:[{start:0,end:30}],cues:[cue],at:1};
const evidence=evidenceCues([cue]);
const grounded={supported:true,blocks:[{text:'真实句子支持的回答',refs:['s1']}],chapters:[{text:'开头',refs:['s1']}],learning:[{text:'first表示第一',refs:['s1']}]};
const correctionKey='biliscript-study-corrections:en:'+material.route;
const deferred=<T>()=>{let resolve!:(value:T)=>void;return {promise:new Promise<T>(done=>resolve=done),resolve}};
const flush=async()=>{for(let n=0;n<100;n++)await Promise.resolve()};
beforeEach(()=>vi.stubGlobal('crypto',webcrypto));afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});

it('never calls a preview, disconnected windows, imports or unverified CC the whole video',()=>{
 expect(materialCoverage(material).complete).toBe(false);
 expect(materialCoverage({...material,source:'cc'}).complete).toBe(false);
 expect(materialCoverage({...material,source:'import',ranges:[{start:0,end:120}]}).complete).toBe(false);
 expect(materialCoverage({...material,ranges:[{start:0,end:30},{start:90,end:120}]}).complete).toBe(false);
 expect(materialCoverage({...material,ranges:[{start:0,end:60},{start:60,end:120}]}).complete).toBe(true);
});
it('counts processed silent windows as covered, independently of sentence gaps',()=>{expect(materialCoverage({...material,ranges:[{start:0,end:120}]}).complete).toBe(true)});
it('splits long evidence losslessly, rejects overlong individual cues instead of truncation',()=>{
 const items=Array.from({length:500},(_,i)=>({...evidence[0],id:'s'+i,text:'あ'.repeat(300)})),chunks=splitEvidence(items,5000);
 expect(chunks.length).toBeGreaterThan(30);expect(chunks.flat()).toEqual(items);expect(chunks.every(c=>c.reduce((n,s)=>n+JSON.stringify(s).length,0)<=5000)).toBe(true);
 expect(()=>splitEvidence([{text:'a'.repeat(11000)}])).toThrow('未截断');
});
it('bounds long multi-turn history without changing evidence',()=>{const turns=Array.from({length:20},()=>({question:'q'.repeat(2000),result:{blocks:[{text:'a'.repeat(10000)}]}}));expect(JSON.stringify(boundedHistory(turns)).length).toBeLessThan(4600);expect(evidence[0].text).toBe(cue.text)});
it('allows appended cues but rejects changed, deleted or retimed snapshot cues',()=>{expect(scopeStillCurrent([cue],[cue,{...cue,id:'new',start:30,end:32}])).toBe(true);for(const next of [[],[{...cue,revision:2}],[{...cue,text:'edited'}],[{...cue,end:5}]])expect(scopeStillCurrent([cue],next)).toBe(false)});
it('isolates material signatures by P, CID, language, range and correction',()=>{for(const patch of [{key:materialKey('BV1ab411c7mD:p2','en')},{identity:'BV1ab411c7mD:222'},{key:materialKey(material.route,'ja')},{ranges:[{start:30,end:60}]},{cues:[{...cue,text:'changed'}]}])expect(materialFingerprint({...material,...patch})).not.toBe(materialFingerprint(material))});

it.each(['s999',undefined,null])('rejects invented or absent citations: %s',ref=>{expect(()=>parseGrounded(JSON.stringify({...grounded,blocks:[{text:'claim',refs:ref?[ref]:[]}]}),evidence)).toThrow('出处')});
it('validates grounded structures, unsupported answers and incomplete JSON',()=>{expect(parseGrounded(JSON.stringify(grounded),evidence)).toEqual({supported:grounded.supported,blocks:grounded.blocks,chapters:grounded.chapters});expect(parseGrounded(JSON.stringify({supported:false,blocks:[]}),evidence).supported).toBe(false);expect(()=>parseGrounded('{"supported":true',evidence)).toThrow('结构化')});
it.each([
 {items:[]},{items:[{id:'s9',text:'x',status:'suggested'}]},
 {items:[{id:'s1',text:'x',status:'suggested',start:99}]},
 {items:[{id:'s1',text:'x',status:'suggested'},{id:'s1',text:'x',status:'suggested'}]}
])('rejects batch sentence count/id/time changes %#',raw=>expect(()=>parseBatch(JSON.stringify(raw),evidence)).toThrow());
it('keeps uncertain and unchanged text exactly as obtained',()=>{for(const status of ['uncertain','unchanged'])expect(parseBatch(JSON.stringify({items:[{id:'s1',text:'hallucinated',status}]}),evidence)[0].text).toBe(cue.text)});

it('migrates only legacy temporary caches, without touching keys, words, dictionary or edits',async()=>{
 const disk=new Map<string,any>([[LEGACY_AUDIO,[{key:'old',cues:[]}]], [LEGACY_AI,{legacy:{text:'old explanation',at:2}}],['biliscriptJapaneseSettings',{apiKey:'fixture-only'}],['biliscriptStudyVocabulary',[{term:'old'}]],[correctionKey,{old:'preserved'}]]),store=createLearningStore(createMemoryStorageArea(disk));
 expect(await store.cacheGet('ai:legacy')).toEqual({text:'old explanation',at:2});expect((await store.action('audioRead')).length).toBe(1);expect(disk.has(LEGACY_AI)).toBe(false);expect(disk.get('biliscriptJapaneseSettings').apiKey).toBe('fixture-only');expect(disk.get(correctionKey)).toEqual({old:'preserved'});
});
it('defaults to temporary material and moves full study records to permanent storage only after pin',async()=>{
 const disk=new Map(),store=createLearningStore(createMemoryStorageArea(disk));await store.action('snapshot',{document:material});await store.action('record',{key:material.key,record:{conversation:['old']}});
 expect((await store.action('get',{key:material.key})).pinned).toBe(false);await store.action('pin',{document:material});await store.action('cacheClear');const r=await store.action('get',{key:material.key});expect(r.pinned).toBe(true);expect(r.document).toEqual(material);expect(r.record.conversation).toEqual(['old']);
});
it('enforces byte LRU for unicode and preserves bookmarks, reviews and correction records on clear',async()=>{
 const disk=new Map(),store=createLearningStore(createMemoryStorageArea(disk));await store.action('cacheBudget',{mib:1});await store.action('pin',{document:material});await store.action('bookmark',{bookmark:{id:'one',kind:'video',bvid:material.bvid,language:'en',page:1}});await store.action('review',{id:'word',remembered:true});
 await store.cacheSet('first','あ'.repeat(200000));await store.cacheSet('second','あ'.repeat(200000));expect(await store.cacheGet('first')).toBeUndefined();expect(await store.cacheGet('second')).toBeDefined();expect((await store.action('stats')).temporaryBytes).toBeLessThanOrEqual(1048576);
 const stable=JSON.stringify(disk.get(LIBRARY_KEY));await store.action('cacheClear');expect(JSON.stringify(disk.get(LIBRARY_KEY))).toBe(stable);expect((await store.action('stats')).temporaryBytes).toBe(2);
});
it('serializes cross-tab vocabulary mutations, keeping legacy language and old entries',async()=>{const disk=new Map<string,any>([['biliscriptStudyVocabulary',[{term:'same',meaning:'legacy ja'}]]]),store=createLearningStore(createMemoryStorageArea(disk));await Promise.all([store.action('vocabulary',{item:{term:'same',language:'en'},save:true}),store.action('vocabulary',{item:{term:'other',language:'ja'},save:true})]);expect(disk.get('biliscriptStudyVocabulary')).toHaveLength(3)});
it('refuses stale batch persistence after a different tab manually edits',async()=>{
 const disk=new Map(),store=createLearningStore(createMemoryStorageArea(disk));await store.action('correctionWrite',{storageKey:correctionKey,resource:material.identity,cue:{...cue,text:'manual'}});
 await expect(store.action('batchCommit',{storageKey:correctionKey,resource:material.identity,key:material.key,expected:[],id:'batch',changes:[{...cue,text:'AI'}]})).rejects.toThrow('其他操作');expect(JSON.stringify(disk.get(correctionKey))).not.toContain('AI');
});
it('persists batch undo and preserves a later manual edit even when its text matches the AI text',async()=>{
 const disk=new Map(),store=createLearningStore(createMemoryStorageArea(disk)),second={...cue,start:5,end:8,text:'second',originalText:'second'},context={storageKey:correctionKey,resource:material.identity,key:material.key};
 await store.action('batchCommit',{...context,expected:[],id:'batch',changes:[{...cue,text:'AI'},{...second,text:'AI2'}],range:'1-8'});
 await store.action('correctionWrite',{...context,cue:{...cue,text:'AI'}});
 const expected=disk.get(correctionKey)[material.identity];await store.action('cacheClear');const result=await store.action('batchUndo',{...context,id:'batch',expected});expect(result.corrections).toHaveLength(1);expect(result.corrections[0].text).toBe('AI');expect((await store.action('get',{key:material.key})).batches[0].undone).toBe(true);
});
it('does not poison later storage operations after a failed write',async()=>{const disk=new Map(),area=createMemoryStorageArea(disk),store=createLearningStore(area);area.set.mockRejectedValueOnce(new Error('full'));await expect(store.action('pin',{document:material})).rejects.toThrow('full');expect(disk.has(LIBRARY_KEY)).toBe(false);await store.action('pin',{document:material});expect((await store.action('get',{key:material.key})).pinned).toBe(true)});
it('does not write an aborted result after waiting for serialized storage',async()=>{const disk=new Map(),area=createMemoryStorageArea(disk),store=createLearningStore(area),hold=deferred<any>();area.get.mockReturnValueOnce(hold.promise);let live=true;const save=store.cacheSet('late','must-not-store',()=>live);live=false;hold.resolve({});await save;expect(disk.has(TEMP_KEY)).toBe(false)});
it('schedules remember/forget independently from favorite metadata',()=>{const first=scheduleReview(undefined,true,1000),second=scheduleReview(first,true,2000),forgot=scheduleReview(second,false,3000);expect(first.due).toBe(86401000);expect(second.interval).toBe(3);expect(forgot.due).toBe(603000);expect(forgot.streak).toBe(0);expect(forgot.lapses).toBe(1)});

it('full collection reuses completed/inflight windows, includes silence and never queues twice',async()=>{
 const pending=deferred<any>(),calls:number[]=[],emitted:number[]=[];const controller=createBoundedAsrController({cacheStore:null,getAudioSource:async()=>({url:'https://example.com/audio',backupUrls:[]}),requestWindow:async p=>{calls.push(p.start);return p.start===0?pending.promise:{timestamp_origin:'absolute',segments:[]}},onCues:(_,m)=>emitted.push(m.windowStart)});
 controller.start({enabled:true,bvid:material.bvid,cid:material.cid,duration:90,currentTime:0});await flush();const all=controller.collectAll();pending.resolve({timestamp_origin:'absolute',segments:[]});await all;expect(calls).toEqual([0,30,60]);expect(emitted).toEqual([0,30,60]);controller.stop();
});
it('full collection respects preview and seed windows',async()=>{const calls:number[]=[],controller=createBoundedAsrController({cacheStore:null,getAudioSource:async()=>({url:'x',backupUrls:[]}),requestWindow:async p=>{calls.push(p.start);return {timestamp_origin:'absolute',segments:[]}},onCues:()=>{}});controller.start({enabled:true,bvid:material.bvid,cid:material.cid,duration:300,playableDuration:60,currentTime:0,completedWindows:[{start:0,end:30}]});await controller.collectAll();expect(calls).toEqual([30]);controller.stop()});
it('stopping during collection aborts only its own window and suppresses a late reply',async()=>{const hold=deferred<any>(),got=vi.fn();let signal!:AbortSignal;const controller=createBoundedAsrController({cacheStore:null,getAudioSource:async()=>({url:'x',backupUrls:[]}),requestWindow:async(_,s)=>{signal=s;return hold.promise},onCues:got});controller.start({enabled:true,bvid:material.bvid,cid:material.cid,duration:90,currentTime:0});await flush();const all=controller.collectAll().catch(e=>e.name);controller.stop();hold.resolve({timestamp_origin:'absolute',segments:[]});expect(await all).toBe('AbortError');expect(signal.aborted).toBe(true);expect(got).not.toHaveBeenCalled()});
it('reapplying stored edits retains window history and undo restores true originals',()=>{const t=createCueTimeline(),meta={resourceId:'v',model:'m',language:'en',duration:30};t.replaceWindow([{start:1,end:4,text:'first'}],{...meta,windowStart:0});const c=t.cues[0];t.edit(c.id,c.revision,'edited');t.setCorrections([]);expect(t.reapplyCorrections()[0].text).toBe('first');t.replaceWindow([{start:31,end:33,text:'second'}],{...meta,windowStart:30});expect(t.cues.map(c=>c.text)).toEqual(['first','second'])});

it('separate learning AI sends structured evidence, isolates model/revision, and performs no startup request',async()=>{
 const disk=new Map(),store=createLearningStore(createMemoryStorageArea(disk));let model='fixture';const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(grounded)},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
 const ai=createLearningAi(async()=>({apiKey:'fixture-secret',baseUrl:'https://compatible.example/v1',model}),store);expect(fetcher).not.toHaveBeenCalled();const m={overall:{version:1,kind:'overall',basis:'asr-complete'},kind:'summary',language:'en',resource:'v',revision:'r1',requestId:'1',evidence};
 expect((await ai.request(m,1)).fromCache).toBe(false);expect((await ai.request(m,1)).fromCache).toBe(true);model='other';await ai.request(m,1);await ai.request({...m,revision:'r2'},1);expect(fetcher).toHaveBeenCalledTimes(3);expect(JSON.stringify(disk.get(TEMP_KEY))).not.toContain('fixture-secret');
 const body=JSON.parse((fetcher.mock.calls[0] as any)[1].body);expect(JSON.parse(body.messages[1].content).evidence).toEqual(evidence);expect(body.messages[0].content).toContain('没有观看画面');
});
it('rejects a partial-summary request before any provider call and never requests or consumes a learning list',async()=>{
 const store=createLearningStore(createMemoryStorageArea());const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(grounded)},finish_reason:'stop'}]})));vi.stubGlobal('fetch',fetcher);
 const ai=createLearningAi(async()=>({apiKey:'fixture',baseUrl:'https://fixture.example',model:'m'}),store),request={kind:'summary',language:'en',resource:'v',revision:'r',requestId:'1',evidence};
 await expect(ai.request(request,7)).rejects.toThrow('全片资料');expect(fetcher).not.toHaveBeenCalled();
 const answer=await ai.request({...request,overall:{version:1,kind:'overall',basis:'cc-track'}},7);
 expect(answer.data.learning).toBeUndefined();expect(JSON.parse((fetcher.mock.calls[0] as any)[1].body).messages[0].content).not.toContain('learning');
});
it('cancels learning AI without caching late provider success',async()=>{const store=createLearningStore(createMemoryStorageArea()),hold=deferred<Response>();vi.stubGlobal('fetch',vi.fn(()=>hold.promise));const ai=createLearningAi(async()=>({apiKey:'test',baseUrl:'https://fixture.example',model:'m'}),store);const result=ai.request({overall:{version:1,kind:'overall',basis:'asr-complete'},kind:'summary',language:'ja',resource:'v',revision:'r',requestId:'1',evidence},7);await vi.waitFor(()=>expect(fetch).toHaveBeenCalled());ai.stop(7);hold.resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(grounded)},finish_reason:'stop'}]})));await expect(result).rejects.toMatchObject({name:'AbortError'});expect((await store.action('stats')).temporaryEntries).toBe(0)});

it('clamps negative citation offsets to video zero',()=>{expect(timeLabel(-123)).toBe('0:00');expect(timeLabel(3601)).toBe('1:00:01')});
it('reports an over-budget conversation instead of falsely claiming it was cached',async()=>{const store=createLearningStore(createMemoryStorageArea());await store.action('cacheBudget',{mib:1});await expect(store.action('record',{key:material.key,record:{conversation:['x'.repeat(1100000)]}})).rejects.toThrow('仅在页面保留');expect((await store.action('get',{key:material.key})).record).toBeUndefined()});

it("does not call a player-only preview duration verified full coverage",()=>expect(materialCoverage({...material,duration:30,durationVerified:false,ranges:[{start:0,end:30}]}).complete).toBe(false));
