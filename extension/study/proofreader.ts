// @ts-nocheck
import { parseProofreading } from './proofreading-result.js';
export function createProofreader(ui,options){
 const {$}=ui;let epoch=0,view=null;
 const contextFor=(cues,index)=>{const local=cues.slice(Math.max(0,index-2),index+3);return {context:local.map(c=>c.text).join('\n'),contextStamp:JSON.stringify(local.map(c=>[c.id,c.revision,c.text]))}};
 const valid=s=>{const cues=options.cues(),index=cues.findIndex(c=>c.id===s.cue.id&&c.revision===s.cue.revision);return options.binding()===s.binding&&options.configuration()===s.configuration&&index>=0&&contextFor(cues,index).contextStamp===s.contextStamp};
 function label(text,value,cls){const section=document.createElement('section'),title=document.createElement('strong'),body=document.createElement('p');section.className='proof-section '+(cls||'');title.textContent=text;body.textContent=value;section.append(title,body);return section}
 function render(){
  if(!view||ui.pane!=='explanation'||$('detailTitle').textContent!=='按句校对')return;
  const target=$('detail');target.replaceChildren();const {snapshot,result}=view;
  target.append(label('原始字幕',snapshot.cue.originalText));if(snapshot.cue.text!==snapshot.cue.originalText)target.append(label('当前字幕',snapshot.cue.text));
  const notice=document.createElement('p');notice.className='hint';notice.textContent='这是基于字幕上下文的文字建议，尚未核对原声音频。';target.append(notice);
  if(view.stale||!valid(snapshot)){target.append(label('建议已失效','字幕来源、选句或接口设置已更新，请重新点击该句的“校对”。','error'));return}
  const actions=document.createElement('div');actions.className='proof-actions';
  if(view.loading)target.append(label('正在校对','只检查此句，时间戳保持不变。'));
  else if(view.error)target.append(label('校对未完成',view.error,'error'));
  else if(result){
   target.append(label(result.status==='suggested'?'建议修改':result.status==='unchanged'?'无需修改':'需要听原声确认',result.status==='suggested'?result.suggestedText:result.status==='unchanged'?'当前字幕可保留。':'仅凭上下文无法确认，不会自动补写字幕。'));
   target.append(label('修改理由',result.reason));
   if(result.status==='suggested'&&!view.applied){const apply=document.createElement('button');apply.className='proof-apply';apply.textContent='采用修改';apply.onclick=()=>change(result.suggestedText);actions.append(apply)}
  }
  if(snapshot.cue.text!==snapshot.cue.originalText){const restore=document.createElement('button');restore.className='proof-restore';restore.textContent='恢复原文';restore.onclick=()=>change(snapshot.cue.originalText);actions.append(restore)}
  const original=document.createElement('button');original.className='proof-listen';original.textContent='听原声';original.onclick=()=>options.listen(snapshot.cue);actions.append(original);
  if(!view.loading){const retry=document.createElement('button');retry.className='proof-retry';retry.textContent='重新校对';retry.onclick=()=>check(snapshot.cue.id);actions.append(retry)}
  target.append(actions);if(view.applied)target.append(label('已采用','原文已保留，可随时恢复。'));
 }
 function change(text){
  if(!view||!valid(view.snapshot)){invalidate();return}
  const updated=options.edit(view.snapshot.cue.id,view.snapshot.cue.revision,text);if(!updated){invalidate();return}
  view.snapshot.cue={...updated};Object.assign(view.snapshot,contextFor(options.cues(),options.cues().findIndex(c=>c.id===updated.id)));view.applied=text!==updated.originalText;view.result=null;view.error='';view.stale=false;render();
 }
 async function check(id){
  const cues=options.cues(),index=cues.findIndex(c=>c.id===id);if(index<0)return;
  const mine=++epoch;options.cancel();options.pause();ui.setPane('explanation');
  const snapshot={cue:{...cues[index]},...contextFor(cues,index),binding:options.binding(),configuration:options.configuration()};
  view={snapshot,loading:true};$('detailTitle').textContent='按句校对';$('explainScope').textContent='当前句与前后各两句作为上下文';render();
  try{const response=await options.request(snapshot);if(mine!==epoch||!valid(snapshot))return;view.loading=false;view.result=parseProofreading(response.text,snapshot.cue.text);render()}
  catch(error){if(mine!==epoch||!valid(snapshot))return;view.loading=false;view.error=error.message;render()}
 }
 function invalidate(){epoch++;options.cancel();if(view){view.loading=false;view.stale=true;render()}}
 return {check,invalidate,changed(){if(view&&!valid(view.snapshot))invalidate()},get active(){return !!view&&!view.stale}};
}
