import {expect,it} from 'vitest';
import {exportLearningNotes,exportSubtitles,exportFilename,coverageText,videoLink} from '../extension/study/learning-export.js';
import {learningView,type LearningSnapshot} from '../extension/study/learning-view.js';
import {parseGrounded} from '../extension/study/learning-ai.js';
import type {VideoMaterial} from '../extension/study/learning-data.js';

const m:VideoMaterial={version:1,key:'key',route:'route',identity:'cid',bvid:'BV1ab411c7mD',page:3,cid:'3',language:'ja',title:'日本語 / English [中文] <script>',duration:180,durationVerified:true,source:'asr',offset:2.5,ranges:[{start:0,end:30},{start:60,end:90}],cues:[{id:'c1',revision:1,start:1.25,end:4.75,text:'こんにちは。Hello 中文。'},{id:'c2',revision:1,start:60,end:65,text:'Second <b> & --> line\n\nthird'}],at:1};
const snapshot:LearningSnapshot={result:{supported:true,blocks:[{text:'整体概述',refs:['s1']},{text:'重复的章节内容',refs:['s2']}],chapters:[{text:'重复的章节内容',refs:['s2']},{text:'开头总结',refs:['s1']}],learning:[{text:'学ぶ',refs:['s1']}]},material:{...m,cues:[]},evidence:[{id:'s1',start:1.25,end:4.75,text:'当时的原句'},{id:'s2',start:60,end:65,text:'当时后面的原句'}],fingerprint:'old',configuration:'old',at:1};

it('adapts legacy records without mutating them, deduplicates overview and orders chapters by real evidence',()=>{
 const before=JSON.stringify(snapshot),view=learningView(snapshot);
 expect(view.overview.map(b=>b.text)).toEqual(['整体概述']);
 expect(view.chapters.map(b=>b.cues[0].start)).toEqual([1.25,60]);
 expect(view.chapters.map(b=>b.title)).toEqual(['章节 1','章节 2']);
 expect(JSON.stringify(snapshot)).toBe(before);
});
it('preserves new chapter titles while rejecting invented references and ambiguous stored evidence',()=>{
 const parsed=parseGrounded(JSON.stringify({...snapshot.result,chapters:[{title:'开场',text:'分段总结',refs:['s1']}]}),snapshot.evidence);
 expect(learningView({...snapshot,result:parsed}).chapters[0]).toMatchObject({title:'开场',text:'分段总结'});
 const broken=structuredClone(snapshot);broken.result.blocks.push({text:'伪造事实',refs:['s1','invented']});broken.evidence.push({...broken.evidence[0],text:'不同原句'});
 const view=learningView(broken);expect(view.blocks.map(b=>b.text)).not.toContain('伪造事实');expect(view.chapters).toHaveLength(1);
});
it('retains repeated wording at distinct chapter times and distinct learning citations',()=>{
 const repeated=[{text:'再次强调同一观点',refs:['s1']},{text:'再次强调同一观点',refs:['s2']},{text:'再次强调同一观点',refs:['s1']}];
 const view=learningView({...snapshot,result:{...snapshot.result,chapters:repeated,learning:repeated}});
 expect(view.chapters.map(c=>c.cues[0].start)).toEqual([1.25,60]);expect(snapshot.result.learning).toHaveLength(1);
});
it.each(['srt','vtt','txt'] as const)('exports %s with applied offset, multilingual text and only supplied Chinese',format=>{
 const file=exportSubtitles(m,format,{c1:'已有中文'});
 expect(file.name).toContain('-P3-已取得字幕.'+format);expect(file.name).not.toMatch(/[<>:"/\\|?*]/);
 expect(file.text).toContain('こんにちは。Hello 中文。');expect(file.text).toContain('已有中文');
 if(format==='srt')expect(file.text).toContain('00:00:03,750 --> 00:00:07,250');
 if(format==='vtt'){expect(file.text.startsWith('WEBVTT\n\n')).toBe(true);expect(file.text).toContain('00:00:03.750 --> 00:00:07.250');expect(file.text).toContain('&lt;b&gt; &amp; --&gt; line\nthird')}
 if(format==='txt'){expect(file.text).toContain('0:03 こんにちは');expect(file.text).toContain('部分字幕');expect(file.text).toContain('1:02–1:32')}
});
it('clamps negative shifted starts, discards cues ending before zero and preserves hour boundaries',()=>{
 const input={...m,offset:-3,cues:[{...m.cues[0],start:0,end:1},{...m.cues[0],start:2,end:4},{...m.cues[1],start:3602,end:3604}]};
 const file=exportSubtitles(input,'srt');expect(file.text).toContain('1\n00:00:00,000 --> 00:00:01,000');expect(file.text).toContain('2\n00:59:59,000 --> 01:00:01,000');expect(file.text).not.toContain('3\n');
 expect(()=>exportSubtitles({...m,cues:[]},'vtt')).toThrow('尚未取得');
});
it('exports stale source snapshots, valid P/time links and optional current subtitles without mixing old evidence with current text',()=>{
 const record={summary:snapshot,conversation:[{...snapshot,question:'为什么 [跳转](javascript:bad)?',result:{...snapshot.result,chapters:[],learning:[]}}]};
 const before=JSON.stringify(record),file=exportLearningNotes(m,record,{fingerprint:'new',configuration:'new',includeSubtitles:true,chinese:{c1:'已有中文'}});
 expect(file.text).toContain('先前结果');expect(file.text).toContain('当时覆盖：部分字幕');expect(file.text).not.toContain('0 句');
 expect(file.text).toContain('?p=3&t=3.75');expect(file.text).not.toContain('t=6.25');
 expect(file.text).toContain('当时的原句');expect(file.text).toContain('こんにちは。Hello 中文。');expect(file.text).toContain('中文：已有中文');
 expect(file.text).not.toContain('## 视频学习清单');expect(file.text).toContain('历史／局部总结');expect(file.text).toContain('## 视频问答');expect(file.text).not.toContain('概述与要点');
 expect(file.text).toContain('\\[跳转\\]\\(javascript:bad\\)');expect(file.text).toContain('&lt;script&gt;');
 expect(JSON.stringify(record)).toBe(before);
});
it('omits ungenerated sections and subtitles, handles unsupported answers and reports honest unverified coverage',()=>{
 const notes=exportLearningNotes({...m,source:'cc'},{},{fingerprint:'',configuration:''});
 expect(notes.text).not.toContain('## ');expect(notes.text).toContain('完整性未核实');expect(notes.text).not.toContain(m.cues[0].text);
 const file=exportLearningNotes(m,{conversation:[{...snapshot,question:'画面内容？',result:{supported:false,blocks:[],chapters:[],learning:[]}}]},{fingerprint:'old',configuration:'old'});
 expect(file.text).toContain('无法回答');expect(file.text).not.toContain('先前结果');
 expect(coverageText({...m,source:'import',ranges:[{start:0,end:180}]})).toContain('覆盖范围未核实');
 expect(videoLink({...m,bvid:'javascript:bad'},10)).toBe('');expect(exportFilename('CON','笔记','md')).toBe('_CON-笔记.md');
});
