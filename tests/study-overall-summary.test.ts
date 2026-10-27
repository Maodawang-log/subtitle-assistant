import {expect,it} from 'vitest';
import {overallBasis,materialCoverage,type VideoMaterial} from '../extension/study/learning-data.js';
import {overallSourcePlan,overallScope,summaryScopeLabel,summaryScopeText} from '../extension/study/overall-summary.js';
import {exportLearningNotes} from '../extension/study/learning-export.js';

const m:VideoMaterial={version:1,key:'key',route:'BV1ab411c7mD:p2',identity:'BV1ab411c7mD:2',bvid:'BV1ab411c7mD',cid:'2',page:2,language:'en',title:'source',duration:120,durationVerified:true,offset:0,source:'cc',ranges:[{start:4,end:7},{start:20,end:23}],cues:[{id:'c',revision:1,start:4,end:7,text:'real words'}],at:1};
const proof={kind:'cc-track' as const,identity:m.identity,bvid:m.bvid,page:2,language:'en' as const,trackId:'71'};
it('uses a fetched whole CC track despite pauses and trailing silence, without claiming all speech was verified',()=>{
 const full={...m,wholeSource:proof};expect(overallSourcePlan(full)).toEqual({action:'ready',basis:'cc-track'});expect(overallScope(full).basis).toBe('cc-track');expect(materialCoverage(full).text).toContain('未验证全部语音');
 expect(overallSourcePlan(m).action).toBe('refresh-cc');
});
it.each([{page:1},{language:'ja'},{identity:'other'},{bvid:'BV1wYAmeqEuV'},{kind:'confirmed-import'},{trackId:''}])('rejects mismatched source proof %#',patch=>{
 expect(overallBasis({...m,wholeSource:{...proof,...patch} as any})).toBeUndefined();
});
it('does not infer import completeness from number of cues, final timestamp or matching duration',()=>{
 const imported={...m,source:'import' as const,ranges:[{start:0,end:120}],cues:[{...m.cues[0],start:0,end:120}]};
 expect(overallSourcePlan(imported).action).toBe('confirm-import');
 const complete={...imported,wholeSource:{...proof,kind:'confirmed-import' as const,confirmedAt:1}};
 expect(overallSourcePlan(complete).action).toBe('ready');expect(overallBasis({...complete,wholeSource:{...complete.wholeSource,confirmedAt:undefined}})).toBeUndefined();
});
it.each([
 {ranges:[{start:0,end:30}]},
 {ranges:[{start:0,end:30},{start:60,end:120}]},
 {durationVerified:false,ranges:[{start:0,end:120}]},
 {duration:Infinity,ranges:[{start:0,end:120}]},
])('requires processed full ASR ranges and verified duration %#',patch=>{
 const material={...m,source:'asr' as const,...patch};expect(overallSourcePlan(material).action).toBe('collect-asr');expect(()=>overallScope(material)).toThrow('全片资料');
});
it('reuses complete ASR only for the selected model and rejects a silent/no-sentence result',()=>{
 const full={...m,source:'asr' as const,asrModel:'medium',ranges:[{start:0,end:60},{start:60,end:120}]};
 expect(overallSourcePlan(full,'medium').action).toBe('ready');expect(overallSourcePlan(full,'small').action).toBe('collect-asr');expect(()=>overallScope({...full,cues:[]})).toThrow('全片资料');
});
it('labels old full-looking snapshots as historical unless the overall process marker and source agree',()=>{
 const full={...m,source:'asr' as const,ranges:[{start:0,end:120}]};
 expect(summaryScopeLabel({material:full})).toContain('历史／局部');
 expect(summaryScopeLabel({material:full,overall:overallScope(full)})).toContain('整体总结');
 expect(summaryScopeLabel({material:m,overall:overallScope(full)})).toContain('历史／局部');
});
it('shows the source once in the summary scope line, followed by its actual coverage',()=>{
 const cc={...m,wholeSource:proof},audio={...m,source:'asr' as const,ranges:[{start:0,end:120}]};
 const ccText=summaryScopeText({material:cc,overall:overallScope(cc)}),audioText=summaryScopeText({material:audio,overall:overallScope(audio)});
 expect(ccText.match(/整轨 CC/g)).toHaveLength(1);expect(ccText).toContain('0:04–0:07、0:20–0:23');
 expect(audioText.match(/已处理全片音频/g)).toHaveLength(1);expect(audioText).toContain('0:00–2:00');
 expect(summaryScopeText({material:audio})).toContain('历史／局部总结');
});
it('omits old learning by default without mutating it, and exports the actual historical or overall basis',()=>{
 const old={result:{supported:true,blocks:[{text:'overview',refs:['s1']}],chapters:[],learning:[{text:'legacy learning',refs:['s1']}]},material:{...m,cues:[],cueCount:1},evidence:[{id:'s1',start:4,end:7,text:'old evidence'}],fingerprint:'old',configuration:'old'};
 const before=JSON.stringify(old),options={fingerprint:'new',configuration:'new'};
 const text=exportLearningNotes(m,{summary:old},options).text;
 expect(text).toContain('历史／局部总结');expect(text).toContain('0:04');expect(text).not.toContain('legacy learning');expect(JSON.stringify(old)).toBe(before);
 const full={...m,wholeSource:proof};const notes=exportLearningNotes(full,{summary:{...old,material:{...full,cues:[],cueCount:1},overall:overallScope(full)}},options).text;
 expect(notes).toContain('整体总结');expect(notes).toContain('整轨 CC');expect(notes).toContain('未验证全部语音');
});
