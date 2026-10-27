import { buildSrt, buildTxt } from '../notes/render.js';
import { formatTimestamp } from '../shared/string-utils.js';
import { materialCoverage, mergeRanges, timeLabel, type VideoMaterial } from './learning-data.js';
import { summaryScopeLabel } from './overall-summary.js';
import { learningView, snapshotStale, type LearningSnapshot, type CitedBlock } from './learning-view.js';

export type SubtitleFormat = 'srt' | 'vtt' | 'txt';
export const markdownText = (value: unknown) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]()#+.!|~=-]/g,'\\$&').replace(/\r\n?/g,'\n');
const oneLine = (value: unknown) => markdownText(String(value ?? '').replace(/\s+/g,' ').trim());
export function exportFilename(title: string, suffix: string, extension: string) {
 let name = (title || '视频').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/g,'').trim();
 name = Array.from(name).slice(0,80).join('') || '视频';
 if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_'+name;
 return `${name}-${suffix}.${extension}`;
}
export function videoLink(m: Pick<VideoMaterial,'bvid'|'page'>, seconds?: number) {
 if (!/^BV[\da-zA-Z]{10}$/.test(m.bvid)) return '';
 const url = new URL(`https://www.bilibili.com/video/${m.bvid}/`);
 url.searchParams.set('p',String(Number.isInteger(m.page) && m.page>0 ? m.page : 1));
 if (seconds !== undefined && Number.isFinite(seconds)) url.searchParams.set('t',String(Math.round(Math.max(0,seconds)*1000)/1000));
 return url.href;
}
const offsetOf = (m: VideoMaterial) => Number.isFinite(m.offset) ? m.offset : 0;
const shifted = (start: number, end: number, offset: number) => ({start:Math.max(0,start+offset), end:Math.max(0,end+offset)});
export function coverageText(m: VideoMaterial & {cueCount?:number}) {
 const {complete} = materialCoverage(m), offset = offsetOf(m);
 const label = materialCoverage(m).text.split(' · ')[0];
 const ranges = mergeRanges(m.ranges || []).map(r => shifted(r.start,r.end,offset)).filter(r => r.end>r.start);
 const count = m.cues?.length || m.cueCount;
 return `${label}${count !== undefined ? ` · ${count} 句` : ''} · ${ranges.length ? ranges.map(r=>`${timeLabel(r.start)}–${timeLabel(r.end)}`).join('、') : '未记录覆盖范围'}`;
}
function captionRows(m: VideoMaterial, chinese: Record<string,string>) {
 const offset = offsetOf(m);
 return m.cues.filter(c => Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.start>=0&&c.end>c.start&&c.text?.trim())
  .map(c => ({...shifted(c.start,c.end,offset),text:c.text, chinese:chinese[c.id] || ''}))
  .filter(c => c.end>c.start).sort((a,b)=>a.start-b.start);
}
const subtitleText = (text:string) => text.replace(/\r\n?/g,'\n').replace(/\n\s*\n/g,'\n').trim();
const vttText = (text:string) => subtitleText(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export function exportSubtitles(m: VideoMaterial, format: SubtitleFormat, chinese: Record<string,string> = {}) {
 if (!['srt','vtt','txt'].includes(format)) throw new Error('请选择 SRT、VTT 或 TXT');
 const rows = captionRows(m,chinese);
 if (!rows.length) throw new Error('尚未取得可导出的字幕');
 const body = rows.map(c => ({from:c.start,to:c.end,content:subtitleText(c.text),chinese:subtitleText(c.chinese)}));
 const secondary = (item: unknown) => (item as typeof body[number]).chinese;
 const text = format==='srt' ? buildSrt(body,secondary)+'\n' : format==='txt' ? coverageText(m)+'\n\n'+buildTxt(body,{includeTimestampInBody:true},secondary)+'\n' : 'WEBVTT\n\n'+body.map(c=>`${formatTimestamp(c.from)} --> ${formatTimestamp(c.to)}\n${vttText(c.content)}${c.chinese?'\n'+vttText(c.chinese):''}`).join('\n\n')+'\n';
 return {name:exportFilename(m.title,`P${m.page}-${materialCoverage(m).complete?'字幕':'已取得字幕'}`,format),text,type:format==='vtt'?'text/vtt;charset=utf-8':'text/plain;charset=utf-8'};
}
function timeLink(m: VideoMaterial, start:number) {
 const time = Math.max(0,start+offsetOf(m)), url = videoLink(m,time);
 return url ? `[${timeLabel(time)}](${url})` : timeLabel(time);
}
function citations(block:CitedBlock,m:VideoMaterial) {
 return block.cues.map(c=>`> ${timeLink(m,c.start)} ${oneLine(c.text)}`).join('\n>\n');
}
function provenance(s:LearningSnapshot,fingerprint:string,configuration:string) {
 const old = snapshotStale(s,fingerprint,configuration), m=s.material;
 return [old ? '> 先前结果：字幕或接口设置已更新。以下内容与引用保留生成时的来源快照。' : '> 以下内容依据生成时保存的字幕快照。',
  `> 来源：${videoLink(m) || oneLine(m.bvid)} · P${m.page} · ${oneLine(({ja:'日语',en:'英语',zh:'中文'} as Record<string,string>)[m.language] || m.language)}`,
  `> 当时覆盖：${oneLine(coverageText(m))}`,
  ...(s.at && Number.isFinite(s.at) ? [`> 生成时间：${new Date(s.at).toISOString()}`] : []), ''].join('\n');
}
export function exportLearningNotes(m:VideoMaterial,record:{summary?:LearningSnapshot;conversation?:LearningSnapshot[]},options:{fingerprint:string;configuration:string;includeSubtitles?:boolean;chinese?:Record<string,string>}) {
 const lines=[`# ${oneLine(m.title || '视频学习笔记')}`,'',`- BV：${oneLine(m.bvid)}`,`- 分P：P${m.page}`,`- 原语言：${oneLine(({ja:'日语',en:'英语',zh:'中文'} as Record<string,string>)[m.language] || m.language)}`,`- 来源：${videoLink(m) || '未记录有效 BV'}`,`- 当前字幕覆盖：${oneLine(coverageText(m))}`,`- 字幕偏移：${offsetOf(m)} 秒（本文时间已应用偏移）`,''];
 const s=record.summary;
 if(s?.material){
  const view=learningView(s);
  if(view.overview.length||view.chapters.length){
   lines.push('## 总结与章节','',`> ${oneLine(summaryScopeLabel(s))}`,'',provenance(s,options.fingerprint,options.configuration));
   for(const b of view.overview) lines.push(markdownText(b.text),'',citations(b,s.material),'');
   for(const c of view.chapters) lines.push(`### ${timeLink(s.material,c.cues[0].start)} ${oneLine(c.title)}`,'',markdownText(c.text),'',citations(c,s.material),'');
  }

 }
 const turns=(record.conversation||[]).filter(t=>t.material&&typeof t.question==='string');
 if(turns.length) lines.push('## 视频问答','');
 for(const turn of turns){
  const view=learningView(turn);
  lines.push(`### ${oneLine(turn.question)}`,'',provenance(turn,options.fingerprint,options.configuration));
  if(!view.supported) lines.push('现有字幕未提供足够依据，无法回答。','');
  else if(!view.blocks.length) lines.push('保存的回答缺少有效原句出处，未导出其正文。','');
  for(const b of view.blocks) lines.push(markdownText(b.text),'',citations(b,turn.material),'');
 }
 if(options.includeSubtitles){
  lines.push('## 已取得字幕','',oneLine(coverageText(m)),'');
  for(const c of captionRows(m,options.chinese||{})) {
   // Rows are already shifted; do not apply offset a second time.
   lines.push(`- ${timeLink({...m,offset:0},c.start)} ${oneLine(c.text)}`);
   if(c.chinese) lines.push(`  - 中文：${oneLine(c.chinese)}`);
  }
  lines.push('');
 }
 return {name:exportFilename(m.title,`P${m.page}-学习笔记`,'md'),text:lines.join('\n'),type:'text/markdown;charset=utf-8'};
}
