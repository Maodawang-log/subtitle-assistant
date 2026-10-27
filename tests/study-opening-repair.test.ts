import { expect,it,vi } from 'vitest';
import {readFileSync} from 'node:fs';
import {createCueTimeline} from '../extension/study/cue-revisions.js';
import {withCorrection} from '../extension/study/manual-corrections.js';
import {createBoundedAsrController,studyAudioCacheKey} from '../extension/study/bounded-asr.js';
import type {StudyAudioCacheEntry} from '../extension/study/study-audio-cache.js';
const turbo=JSON.parse(readFileSync('tests/fixtures/study-opening-turbo.json','utf8'));
const meta={windowStart:0,duration:30,resourceId:'fixture',model:'large-v3-turbo',language:'ja'};
it('does not manufacture full-sentence fragments when old corrections meet real Turbo boundaries',()=>{
 const edits=[{start:5.88,end:13.06,text:turbo[0].text,originalText:turbo[1].text},
 {start:6,end:12.62,text:turbo[1].text,originalText:turbo[1].text.replace('3足','3速')}];
 const timeline=createCueTimeline();timeline.setCorrections(edits);
 const cues=timeline.replaceWindow(turbo,meta);
 expect(cues.map(({start,end,text})=>({start,end,text}))).toEqual(turbo);
 expect(new Set(cues.map(c=>c.id)).size).toBe(3);
 expect(cues[0].edited).toBe(true);expect(cues[1].edited).toBe(true);
 const original=cues[1];expect(original.originalText).toBe(turbo[1].text);
 const restored=timeline.edit(original.id,original.revision,original.originalText)!;
 const stored=withCorrection({fixture:edits},'fixture',restored);
 expect(stored.fixture).toEqual([edits[0]]);
 const reopened=createCueTimeline();reopened.setCorrections(stored.fixture);
 expect(reopened.replaceWindow(turbo,meta).map(c=>c.text)).toEqual(turbo.map((c:any)=>c.text));
});
it('keeps genuinely repeated lines at different acoustic positions and does not force ambiguous edits',()=>{
 const timeline=createCueTimeline();timeline.setCorrections([{start:5.88,end:13.06,text:turbo[0].text,originalText:turbo[1].text}]);
 const repeated=[...turbo,{...turbo[0],start:22,end:27}];
 expect(timeline.replaceWindow(repeated,meta).filter(c=>c.text===turbo[0].text)).toHaveLength(2);
 timeline.clear();timeline.setCorrections([{start:4,end:9,text:'Stored custom correction',originalText:'Unrelated old hypothesis'}]);
 expect(timeline.replaceWindow([{start:1,end:5,text:'Different scene'},{start:8,end:12,text:'Another scene'}],meta)).toHaveLength(2);
 expect(timeline.unmatchedCorrections).toBe(1);
});
const source={url:'https://example.bilivideo.com/audio.m4s',backupUrls:[]};
const video={enabled:true,bvid:'BVfixture',cid:'111',language:'ja',model:'medium',currentTime:0,duration:30};
const result=(version?:number)=>({timestamp_origin:'absolute',segments:[{start:1,end:4,text:'Opening.'}],...(version?{opening_repair:{version,attempted:false,added:0}}:{})});
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve()};
it('rechecks old opening caches once and persists even a negative completed check',async()=>{
 const key=studyAudioCacheKey({...video,start:0,duration:30});
 let entries:StudyAudioCacheEntry[]=[{key,cues:[{from:6,to:10,content:'Old missing-opening cache'}]}];
 const store={read:async()=>entries,write:async(v:StudyAudioCacheEntry[])=>{entries=v}};
 const request=vi.fn(async()=>result(1)),onCues=vi.fn();
 const first=createBoundedAsrController({cacheStore:store,getAudioSource:async()=>source,requestWindow:request,onCues});
 first.start(video);await flush();first.stop();await flush();
 expect(request).toHaveBeenCalledTimes(1);expect(entries[0].openingRepairVersion).toBe(1);
 const next=createBoundedAsrController({cacheStore:store,getAudioSource:async()=>source,requestWindow:request,onCues});
 next.start(video);await flush();next.stop();expect(request).toHaveBeenCalledTimes(1);
 expect(onCues).toHaveBeenLastCalledWith(expect.any(Array),expect.objectContaining({cached:true}));
});
it('does not mark old services as checked or cache a result after cancellation',async()=>{
 let entries:StudyAudioCacheEntry[]=[];const store={read:async()=>entries,write:async(v:StudyAudioCacheEntry[])=>{entries=v}};
 const options={cacheStore:store,getAudioSource:async()=>source,onCues:vi.fn()};
 const legacy=createBoundedAsrController({...options,requestWindow:async()=>result()});legacy.start(video);await flush();legacy.stop();
 expect(entries[0].openingRepairVersion).toBeUndefined();entries=[];
 let finish!:(v:unknown)=>void;
 const pending=createBoundedAsrController({...options,requestWindow:()=>new Promise(resolve=>{finish=resolve})});
 pending.start(video);await flush();pending.stop();finish(result(1));await flush();expect(entries).toEqual([]);
});
