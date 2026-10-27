// @ts-nocheck
import { learningAction } from './learning-store.js';
import { cueFingerprint, materialFingerprint, materialCoverage, evidenceCues, splitEvidence, digest, timeLabel } from './learning-data.js';
import { boundedHistory, scopeStillCurrent } from './learning-guards.js';
import { createLearningFavorites } from './learning-favorites.js';
import { createListening } from './listening.js';

const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const button=(text,fn,cls='')=>{const b=node('button',text,cls);b.onclick=()=>Promise.resolve().then(fn).catch(e=>{if(e.name!=='AbortError')b.dispatchEvent(new CustomEvent('learning-error',{bubbles:true,detail:e.message}))});return b};
export function createLearningWorkspace(ui,adapter){
 const {$}=ui;let epoch=0,job=null,record={conversation:[]},pinned=false,loadedKey='',saveTimer=0,restoring=false;
 const listening=createListening(ui,adapter);
 const status=(text)=>{$('learningStatus').textContent=text};
 ui.shadow.addEventListener('learning-error',e=>status(e.detail));
 const material=()=>adapter.material();
 const current=()=>adapter.current();
 const favorites=createLearningFavorites(ui,{
  meta:adapter.meta,jump:adapter.jump,
  notify(text,error){status(text);const visible=$('status');visible.textContent=text;visible.title=text;visible.classList.toggle('error',!!error);visible.setAttribute('role','status');visible.setAttribute('aria-live','polite')},
  onLibrary(data){const m=material();if(m){pinned=data.documents.some(d=>d.key===m.key)||data.bookmarks.some(b=>b.kind==='video'&&b.bvid===m.bvid&&(b.page||1)===(m.page||1)&&b.language===m.language);refresh()}}
 });
 const capture=()=>{const m=material();if(!m?.cues.length)throw new Error('请先开启字幕并取得字幕资料');return structuredClone(m)};
 const valid=(token)=>job===token&&epoch===token.epoch&&adapter.binding()===token.binding;
 function cancel(reason='已停止；已取得的字幕和成功分段缓存保留。'){
  if(job){if(job.phase==='committing')reason='校对已进入统一保存阶段；完成后可在校对记录整批撤销。';job=null;epoch++;void chrome.runtime.sendMessage({type:'study-learning-stop'});adapter.cancelCollection();status(reason)}renderBusy();
 }
 function renderBusy(){const busy=!!job;for(const b of ui.shadow.querySelectorAll('.cue-manual,.cue-proofread'))b.disabled=job?.phase==='committing';$('learningStop').hidden=!busy;$('batchStop').hidden=!busy;$('learningStop').disabled=job?.phase==='committing';$('batchStop').disabled=job?.phase==='committing';for(const id of ['summaryGenerate','collectFull','chatSend','batchAll'])$(id).disabled=busy;}
 async function begin(label,fn){if(job)return;const token={epoch:++epoch,binding:adapter.binding()};job=token;renderBusy();status(label);try{await fn(token)}catch(e){if(valid(token))status(e.name==='AbortError'?'已停止。':e.message)}finally{if(job===token){job=null;renderBusy()}}}
 const checked=token=>{if(!valid(token))throw new DOMException('资料已更新，任务已停止','AbortError')};
 async function request(kind,evidence,m,token,extra={}){checked(token);const r=await chrome.runtime.sendMessage({type:'study-learning-ai',kind,evidence,language:m.language,resource:m.key+'|'+m.identity,revision:await digest(materialFingerprint(m)),coverage:materialCoverage(m).text,requestId:crypto.randomUUID(),...extra});checked(token);if(!r?.ok)throw new Error(r?.error||'文字任务未完成');return r}
 function cite(c,m){
  const line=node('div',undefined,'evidence-line');const go=button(timeLabel(c.start+m.offset),()=>adapter.jump(c.start+m.offset,c.end+m.offset));go.title='播放这句原声';line.append(go,node('span',c.text));
  line.append(favorites.sentenceButton(c,m));return line;
 }
 async function saveSentence(c,m=material()){
  await favorites.toggle(c,m);
 }
 function renderResult(target,result,m,evidence){
  target.replaceChildren();if(!result?.supported){target.append(node('p','现有字幕未提供足够依据，无法回答。'));return}
  const map=new Map(evidence.map(c=>[c.id,c]));
  for(const [label,items] of [['概述与要点',result.blocks],['章节跳转',result.chapters],['视频学习清单',result.learning]]){
   if(!items?.length)continue;const section=node('section',undefined,'learning-section');section.append(node('h3',label));
   for(const block of items){const card=node('article',undefined,'grounded-card');card.append(node('p',block.text));const refs=block.refs.map(id=>map.get(id)).filter(Boolean);
    if(label==='章节跳转'&&refs[0])card.prepend(button(timeLabel(refs[0].start+m.offset)+' 播放',()=>adapter.jump(refs[0].start+m.offset,refs[0].end+m.offset)));
    const details=node('details'),summary=node('summary','原句与出处');details.append(summary);for(const c of refs)details.append(cite(c,m));card.append(details);
    if(label==='视频学习清单'&&refs[0]){card.append(favorites.sentenceButton(refs[0],m,false,'收藏例句'));card.append(button('查看词语',()=>adapter.words(refs[0])))}section.append(card);
   }target.append(section);
  }
 }
 async function renderRecord(){
  const m=material();if(!m)return;const owner=adapter.binding(),fingerprint=record.summary||record.conversation?.length?await digest(materialFingerprint(m)):"";if(owner!==adapter.binding())return;
  $('summaryStale').hidden=!record.summary||record.summary.fingerprint===fingerprint&&record.summary.configuration===adapter.configuration();
  if(record.summary)renderResult($('videoSummary'),record.summary.result,record.summary.material,record.summary.evidence);else $('videoSummary').replaceChildren(node('p','点击“总结已取得字幕”生成概述、要点和章节。','empty'));
  const target=$('videoConversation');target.replaceChildren();
  for(const turn of record.conversation||[]){const item=node('article',undefined,'chat-turn');item.append(node('h3',turn.question));if(turn.fingerprint!==fingerprint)item.append(node('p','基于先前字幕；当前资料已更新。','hint'));renderResult(item.appendChild(node('div')),turn.result,turn.material,turn.evidence);target.append(item)}
 }
 async function saveRecord(){const m=material();if(m)await learningAction('record',{key:m.key,record})}
 async function analyze(m,token,question=''){
  token.scope=m.cues.map(c=>({...c}));
  const evidence=evidenceCues(m.cues),chunks=splitEvidence(evidence),results=[];let model='',provider='';
  const history=boundedHistory((record.conversation||[]).filter(t=>t.material?.identity===m.identity));
  for(let i=0;i<chunks.length;i++){checked(token);status(`${question?'问答':'总结'}：${i+1} / ${chunks.length} 段`);const r=await request(question?'question':'summary',chunks[i],m,token,{question,history});results.push(r.data);model=r.model;provider=r.provider}
  let supported=results.filter(r=>r.supported);
  const notesOf=r=>[...r.blocks.map(b=>({...b,kind:'point'})),...r.chapters.map(b=>({...b,kind:'chapter'})),...r.learning.map(b=>({...b,kind:'learning'}))];
  // Bounded hierarchy. Every reduce receives the original cited sentences too.
  for(let level=0;supported.length>1;level++){
   if(level>12)throw new Error('分段汇总未能收敛；已保留分段缓存，请缩小资料范围');
   const groups=[];let group=[],size=0;
   for(const r of supported){const ids=new Set(notesOf(r).flatMap(b=>b.refs)),refs=evidence.filter(c=>ids.has(c.id)),cost=JSON.stringify({notes:notesOf(r),evidence:refs}).length;if(cost>24000)throw new Error('单段引用过长，无法安全汇总；未截断内容');if(group.length&&(size+cost>24000||group.length>=4)){groups.push(group);group=[];size=0}group.push(r);size+=cost}if(group.length)groups.push(group);
   if(groups.length===supported.length)throw new Error('分段结果引用过多，无法继续安全汇总；已保留缓存');
   const next=[];for(let i=0;i<groups.length;i++){checked(token);if(groups[i].length===1){next.push(groups[i][0]);continue}status(`正在汇总第 ${level+1} 层：${i+1} / ${groups.length}`);const notes=groups[i].flatMap(notesOf),ids=new Set(notes.flatMap(b=>b.refs));const r=await request(question?'reduce-question':'reduce-summary',evidence.filter(c=>ids.has(c.id)),m,token,{question,history,notes});next.push(r.data)}supported=next;
  }
  const result=supported.length?{...supported[0],chapters:question?[]:supported[0].chapters.slice(0,6),learning:question?[]:supported[0].learning.slice(0,5)}:{supported:false,blocks:[],chapters:[],learning:[]};
  const cited=new Set([...result.blocks,...result.chapters,...result.learning].flatMap(b=>b.refs));
  return {result,evidence:evidence.filter(c=>cited.has(c.id)),material:{...m,cues:[]},model,provider,fingerprint:await digest(materialFingerprint(m)),configuration:adapter.configuration(),at:Date.now()};
 }
 $('summaryGenerate').onclick=()=>begin('准备总结…',async token=>{const m=capture();const result=await analyze(m,token);checked(token);record.summary=result;await renderRecord();await saveRecord();checked(token);status('总结完成。点击出处可回听原句。')});
 $('collectFull').onclick=()=>begin('正在收集全片字幕…',async token=>{await adapter.collectFull();checked(token);const m=capture();status(materialCoverage(m).text);const result=await analyze(m,token);checked(token);record.summary=result;await renderRecord();await saveRecord();status('收集与总结完成。需要长期保留时收藏视频。')});
 $('chatSend').onclick=()=>begin('准备回答…',async token=>{const question=$('chatQuestion').value.trim();if(!question)throw new Error('请输入围绕本视频的问题');const m=capture(),result=await analyze(m,token,question);checked(token);(record.conversation||=[]).push({...result,question});await renderRecord();await saveRecord();checked(token);$('chatQuestion').value='';renderRecord();status('回答已保存到本视频记录。')});
 $('chatQuestion').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();$('chatSend').click()}};
 $('learningStop').onclick=()=>cancel();$('batchStop').onclick=()=>cancel('已停止全部校对，字幕未改动。');
 $('bookmarkVideo').onclick=async()=>{
  const owner=adapter.binding(),wasSaved=pinned,m=material(),b={...adapter.meta(),kind:'video'},control=$('bookmarkVideo');control.disabled=true;
  try{
   if(wasSaved)await learningAction('unpin',{key:m.key});
   else await learningAction('videoBookmark',{bookmark:b,document:m?.cues.length?structuredClone(m):undefined,record:record.summary||record.conversation?.length?record:undefined});
   if(owner!==adapter.binding())return;
   pinned=!wasSaved;refresh();status(pinned?'已收藏视频，已取得的字幕和学习记录会长期保留。':'已取消视频收藏；资料转为临时缓存，句子和单词收藏保留。');await renderLibrary();
  }catch(e){if(owner===adapter.binding())status(e.message)}finally{control.disabled=false}
 };
 const renderLibrary=()=>favorites.refresh();
 $('refreshSaved').onclick=()=>renderLibrary().catch(e=>status(e.message));
 function refresh(){const m=material();$('materialRange').textContent=m?.cues.length?materialCoverage(m).text:'尚未取得字幕';$('bookmarkVideo').textContent=pinned?'已收藏':'收藏视频';$('bookmarkVideo').setAttribute('aria-pressed',String(pinned));$('bookmarkVideo').title=pinned?'取消收藏，字幕和学习记录转为临时缓存':'收藏视频并长期保留已取得的字幕和学习记录';$('materialStorage').textContent=pinned?'已收藏 · 字幕和学习记录长期保留':'未收藏 · 使用临时缓存';$('collectFull').hidden=!!(m&&materialCoverage(m).complete);$('batchScope').textContent=m?.cues.length?`全部校对仅处理当前 ${m.cues.length} 句，保留已修改句；完成后统一采用，可整批撤销。`:'';if(record.summary){const stamp=materialFingerprint(m);void digest(stamp).then(hash=>{if(record.summary&&material()&&materialFingerprint(material())===stamp)$('summaryStale').hidden=record.summary.fingerprint===hash&&record.summary.configuration===adapter.configuration()})}}
 async function load(){const m=material();if(!m||loadedKey===m.key)return;const key=m.key,b=adapter.binding();loadedKey=key;record={conversation:[]};pinned=false;const data=await learningAction('get',{key});if(b!==adapter.binding()||key!==material()?.key)return;record=data.record||{conversation:[]};pinned=data.pinned;refresh();await renderRecord();void renderLibrary().catch(e=>status(e.message));await renderBatches(data.batches)}
 async function renderBatches(batches){const target=$('batchHistory');target.replaceChildren();for(const batch of (batches||[]).filter(b=>!b.undone).reverse()){const row=node('div',undefined,'batch-history');row.append(node('span',`${new Date(batch.at).toLocaleString()} · ${batch.changes.length} 句`));row.append(button('撤销这批',async()=>{cancel();await adapter.undoBatch(batch);await loadBatches();changed();status('已撤销仍与这批结果一致的修改；之后的人工修改保留。')}));target.append(row)}}
 async function loadBatches(){const m=material();if(m){const data=await learningAction('get',{key:m.key});await renderBatches(data.batches)}}
 $('batchAll').onclick=()=>begin('准备全部校对…',async token=>{
  const m=capture();if(adapter.manualEditing())throw new Error('请先保存或取消正在编辑的句子');
  token.scope=m.cues.map(c=>({...c}));const eligible=m.cues.filter(c=>!c.edited),evidence=evidenceCues(eligible),chunks=splitEvidence(evidence,5500,24),results=[];
  if(!eligible.length)throw new Error('当前字幕都已修改，未请求批量校对');
  const expected=await adapter.correctionSnapshot();
  for(let i=0;i<chunks.length;i++){checked(token);status(`全部校对 ${i+1} / ${chunks.length} 批 · ${eligible.length} 句，跳过 ${m.cues.length-eligible.length} 条已修改句`);$('batchProgress').textContent=$('learningStatus').textContent;const r=await request('batch',chunks[i],m,token);results.push(...r.data)}
  checked(token);if(!scopeStillCurrent(m.cues,material().cues)||adapter.manualEditing())throw new Error('字幕在请求期间更新，本次结果未采用');
  const byId=new Map(results.map(r=>[r.id,r])),changes=eligible.flatMap((c,i)=>{const r=byId.get('s'+(i+1));return r?.status==='suggested'&&r.text!==c.text?[{...c,text:r.text}]:[]});
  if(changes.length){token.phase='committing';renderBusy();$('batchProgress').textContent='正在统一保存校对；此阶段完成后可整批撤销。';status($('batchProgress').textContent);await adapter.commitBatch({id:crypto.randomUUID(),changes,expected,range:materialCoverage(m).text});checked(token)}
  $('batchProgress').textContent=`已完成：采用 ${changes.length} 句；保留 ${m.cues.length-eligible.length} 条已修改句。`;status($('batchProgress').textContent);await loadBatches();renderRecord();
 });
 function changed(options={}){
  if(job&&!options.collection&&!options.batchOwn&&(!job.scope||!scopeStillCurrent(job.scope,material()?.cues||[])))cancel('字幕资料或设置已更新，旧任务已停止；需要时手动重试。');
  listening.sync();refresh();clearTimeout(saveTimer);const m=material();if(m?.cues.length&&!restoring){const snapshot=structuredClone(m);void learningAction('snapshot',{document:snapshot}).catch(e=>status('字幕仍在本页，但缓存保存失败：'+e.message))}
 }
 return {load,changed,refresh,saveSentence,
  sentenceButton:(c,m=material())=>favorites.sentenceButton(c,m,true),
  storageChanged:favorites.storageChanged,refreshFavorites:favorites.refresh,
  selected:listening.sync,bilingualDisabled:listening.clearChinese,
  hideOriginal:listening.hideOriginal,hideChinese:listening.hideChinese,
  get busy(){return !!job},
  async restore(key){restoring=true;try{return await learningAction('get',{key})}finally{restoring=false}},
  reset(){cancel();clearTimeout(saveTimer);loadedKey='';record={conversation:[]};pinned=false;listening.reset();$('videoSummary').replaceChildren();$('videoConversation').replaceChildren();$('batchHistory').replaceChildren();refresh()},
  manualStarted(){cancel('已开始人工编辑，批量任务停止。')},
  configurationChanged(){listening.configurationChanged();cancel('文字接口已更改，旧结果保留并标记过期。');refresh()}
 };
}
