import {expect,it} from 'vitest';
import {createCueTimeline,repairAsrSegments} from '../extension/study/cue-revisions.js';
import {createCorrectionWriter,withCorrection} from '../extension/study/manual-corrections.js';
import {createMemoryStorageArea} from './helpers/memory-storage-area.js';
const raw=[{start:1,end:3,text:'First sentence.'},{start:3.1,end:5,text:'Second sentence.'}];
const meta={windowStart:0,duration:30,resourceId:'video',model:'medium',language:'en'};
it.each(['cc','asr'])('persists %s structural merges, preserves draft and original cues, removes old edits, and restores both after reload',async kind=>{
 const disk=new Map(),writer=createCorrectionWriter(createMemoryStorageArea(disk)),timeline=createCueTimeline();
 const load=(t:ReturnType<typeof createCueTimeline>)=>kind==='cc'?t.load(raw,'video'):t.replaceWindow(raw,meta);load(timeline);
 let [first,second]=timeline.cues;const changed=timeline.edit(second.id,second.revision,'Edited second.')!;await writer('edits','video',changed);
 const plan=timeline.prepareMergeNext(first.id,first.revision,'Draft first.')!;expect(timeline.cues).toHaveLength(2);
 await writer('edits','video',plan.merged);timeline.mergeNext(first.id,first.revision,'Draft first.');
 expect(disk.get('edits').video).toHaveLength(1);expect(timeline.cues[0]).toMatchObject({text:'Draft first. Edited second.',originalText:'First sentence. Second sentence.',mergedFrom:raw});
 if(kind==='asr'){timeline.replaceWindow(raw,meta);expect(timeline.cues).toHaveLength(1);timeline.replaceWindow([{start:31,end:33,text:'Future.'}],{...meta,windowStart:30});expect(timeline.cues[0].text).toBe('Draft first. Edited second.')}
 const reopened=createCueTimeline();reopened.setCorrections(disk.get('edits').video);load(reopened);expect(reopened.cues).toHaveLength(1);
 const merged=reopened.cues[0];await writer('edits','video',{...merged,restoreMerged:true});reopened.edit(merged.id,merged.revision,merged.originalText,true);
 expect(reopened.cues.map(c=>({start:c.start,end:c.end,text:c.text}))).toEqual(raw);expect(disk.get('edits').video).toEqual([]);
});
it('persists a merge even when its text equals the concatenated originals and restores a saved merged snapshot',()=>{
 const timeline=createCueTimeline();timeline.load(raw,'video');const merged=timeline.mergeNext(timeline.cues[0].id)!.merged;
 expect(merged.text).toBe(merged.originalText);const saved=withCorrection({},'video',merged).video;expect(saved).toHaveLength(1);
 const restored=createCueTimeline();restored.setCorrections(saved);restored.load([{start:merged.start,end:merged.end,text:merged.originalText}],'video');expect(restored.cues).toHaveLength(1);
 const cue=restored.cues[0];restored.edit(cue.id,cue.revision,cue.originalText,true);expect(restored.cues.map(c=>c.text)).toEqual(raw.map(c=>c.text));
});
it('joins Japanese text without inserted spaces and rejects an obsolete merge revision',()=>{
 const timeline=createCueTimeline();timeline.load([{start:1,end:2,text:'建'},{start:2,end:4,text:'物です。'}],'ja');const cue=timeline.cues[0];expect(timeline.prepareMergeNext(cue.id,cue.revision-1)).toBeNull();expect(timeline.mergeNext(cue.id)!.merged.text).toBe('建物です。');
});
it('replaces the old saved correction anchor after timing migration when merging',()=>{
 const saved={start:1.2,end:2.8,text:'First edited.',originalText:'First sentence.'},timeline=createCueTimeline();timeline.setCorrections([saved]);timeline.load(raw,'video');
 const plan=timeline.prepareMergeNext(timeline.cues[0].id)!;const next=withCorrection({video:[saved]},'video',plan.merged).video;expect(next).toHaveLength(1);expect(next[0].start).toBe(1);expect(next[0].end).toBe(5);
});
it.each([['ja','はい'],['ja','うん'],['en','No'],['en','OK'],[undefined,'ロ']])('preserves a normal/unknown-language short answer %s %s',(language,text)=>{
 const input=[{from:0,to:.1,content:text!},{from:.12,to:2,content:language==='en'?'Next sentence.':'コレです。'}],before=JSON.stringify(input);
 expect(repairAsrSegments(input,language)).toEqual(input);expect(JSON.stringify(input)).toBe(before);
});
it('only stitches a tightly touching Japanese katakana fragment, preserving punctuation and longer gaps',()=>{
 expect(repairAsrSegments([{from:0,to:.1,content:'プ'},{from:.12,to:2,content:'ロジェクトです。'}],'ja')).toEqual([{from:0,to:2,content:'プロジェクトです。'}]);
 for(const item of [{from:0,to:.1,content:'プ。'},{from:0,to:.5,content:'プ'}])expect(repairAsrSegments([item,{from:.7,to:2,content:'ロジェクトです。'}],'ja')).toHaveLength(2);
});
