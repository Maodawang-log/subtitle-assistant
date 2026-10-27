// @ts-nocheck
import { normalizeSourceLanguage, sourceLanguageName } from './source-language.js';
import { updateStudySettings } from './settings-store.js';

export function setupModelManager({deferConnection=false}={}) {
 const $=id=>document.getElementById(id),key='biliscriptJapaneseSettings';
 let state=null,busy=false,refreshing=false,connected=false,attempted=false,closed=false,active=!deferConnection;
 let selectedModel='small',pendingLegacy=null,cardStamp='',revision=0;
 const ready=chrome.storage.local.get(key).then(data=>selectedModel=data[key]?.asrModel||'small');
 const language=()=>normalizeSourceLanguage($('defaultSourceLanguage').value);
 const supports=(model,lang=language())=>model?.[lang==='en'?'englishSupported':'japaneseSupported']===true;
 const languageArgs=model=>({model,language:language()});
 const size=bytes=>((bytes||0)/1048576).toFixed(1)+' MiB';
 const note=(text,error=false)=>{$('managerNote').textContent=text;$('managerNote').classList.toggle('error',error)};
 function badge(id,text,tone='idle'){$(id).textContent=text;$(id).dataset.state=tone}
 function options(id,rows,selected){const select=$(id),stamp=JSON.stringify(rows);if(select.dataset.options!==stamp){select.replaceChildren(...rows.map(([value,label])=>new Option(label,value)));select.dataset.options=stamp}select.value=selected}
 async function request(action,args={}){
  if(['setDefault','start','restart','handover'].includes(action)&&!(state?.protocolVersion>=3)){
   if(args.language==='en')throw new Error('英语模型管理需要先升级配套至 1.2.0。');args={...args};delete args.language;
  }
  const result=await chrome.runtime.sendMessage({type:'study-model-manager',action,args});
  if(!result?.ok)throw new Error(result?.error||'本地管理器没有返回结果。');return result.data;
 }
 function renderCards(value,working){
  const filter=$('modelFilter').value;
  const models=value.models.filter(model=>filter==='installed'?model.installed:filter==='ja'?supports(model,'ja'):filter==='en'?supports(model,'en'):true);
  $('modelCount').textContent=value.models.filter(model=>model.installed).length+' 个已安装';
  $('modelEmpty').hidden=!!models.length;
  $('modelEmpty').textContent=filter==='installed'?'还没有已安装的模型。可导入已有目录，或切换上方筛选后下载。':'没有符合此筛选的模型，可更新可下载列表。';
  const stamp=JSON.stringify([models,working,selectedModel,value.protocolVersion]);
  if(stamp===cardStamp)return;cardStamp=stamp;
  // Keep expanded file details even when an operation changes a card's state.
  const expanded=new Set([...$('models').querySelectorAll('article')].filter(row=>row.querySelector('details')?.open).map(row=>row.dataset.model));
  const focused=document.activeElement?.closest('[data-model]');
  const focusedId=focused?.dataset.model,focusedAction=document.activeElement?.dataset.action;
  $('models').replaceChildren();
  for(const model of models){
   const row=document.createElement('article');row.className='model-card';row.dataset.model=model.id;row.dataset.selected=String(model.id===selectedModel);
   const header=document.createElement('header'),title=document.createElement('strong'),tag=document.createElement('span');
   title.textContent=model.name;tag.className='badge';tag.textContent=model.id===selectedModel?'识别默认':model.installed?'已安装':'可下载';tag.dataset.state=model.id===selectedModel?'ready':'idle';header.append(title,tag);
   const info=document.createElement('p');info.className='model-meta';info.textContent=size(model.bytes)+' · '+(model.language||'语言未确认');
   const description=document.createElement('p');description.className='model-description';description.textContent=model.positioning||'';
   row.append(header,info,description);
   if(model.path||model.source){const details=document.createElement('details'),summary=document.createElement('summary');details.className='model-details';details.open=expanded.has(model.id);summary.textContent='文件与来源';details.append(summary);
    if(model.path){const file=document.createElement('p');file.className='file-path';file.textContent=model.path;details.append(file)}
    if(model.source){const source=document.createElement('a');source.href=model.source;source.target='_blank';source.rel='noopener noreferrer';source.textContent='查看来源';source.className='model-source';details.append(source)}row.append(details);
   }
   const actions=document.createElement('div');actions.className='model-actions';
   const button=document.createElement('button');button.disabled=working;
   if(model.installed){button.textContent='删除模型文件';button.className='danger';button.dataset.action='delete';button.disabled=working||!(value.protocolVersion>=2)||model.id===selectedModel;button.title=model.id===selectedModel?'请先选择另一个识别模型':'';button.onclick=()=>void removeModel(model)}
   else{button.textContent='下载模型';button.dataset.action='download';button.onclick=()=>perform('download',{model:model.id})}
   actions.append(button);row.append(actions);$('models').append(row);
  }
  if(focusedId&&focusedAction){const next=[...$('models').querySelectorAll('[data-model]')].find(row=>row.dataset.model===focusedId)?.querySelector('[data-action="'+focusedAction+'"]');if(next&&!next.disabled)next.focus({preventScroll:true})}
 }
 function render(value){
  state=value;connected=true;const service=value.service,modern=value.protocolVersion>=2,working=busy||['download','catalog'].includes(value.job?.phase);
  badge('managerConnection','已连接','ready');$('managerConnectionDetail').textContent='可在此管理模型与识别服务。';$('connectionHelp').hidden=true;$('connectionError').textContent='';$('connectionVersion').textContent='管理器 '+(value.version||'1.0.0')+' · 扩展 '+(chrome.runtime.getManifest?.().version||'');
  $('managerRefresh').textContent='刷新状态';$('managerRefresh').disabled=busy;
  const available=value.models.find(model=>model.id===selectedModel&&model.installed&&supports(model));
  const languageReady=language()!=='en'||value.protocolVersion>=3;
  const canUse=!!available&&languageReady;
  $('modelDirectory').textContent=value.directory;
  badge('modelService',service?.foreign?'端口被占用':service?service.active||service.queue?'正在识别':'已就绪':value.starting?'正在启动':'未启动',service?.foreign?'error':service?service.active||service.queue?'busy':'ready':value.starting?'busy':'idle');
  const loaded=service?.backend?.model;
  $('serviceModel').textContent=service?.foreign?'其他程序占用了识别端口，无法在此控制。':service?'当前加载：'+(loaded||'准备中')+(service.queue?' · 排队 '+service.queue:''):value.starting?'正在加载模型，请稍候。':'启动后可在没有原文字幕时进行本地识别。';
  $('serviceSharing').textContent=!service||service.foreign?'':service.active||service.queue?'识别任务进行中，暂不能停止或重启。':service.other_consumer_recent?'其他应用近期使用过，暂不能停止或重启。':!value.managedService?'正在复用已有服务，无需接管即可识别。':value.stopReason||'空闲时可停止服务，释放模型占用的内存。';
  $('managerStart').hidden=!!service||!!value.starting;$('managerStart').disabled=working||!canUse||!!service||!!value.starting;
  $('managerStop').hidden=!service||!value.managedService||!!service.foreign;$('managerStop').disabled=working||!value.canStop;
  $('managerRestart').hidden=!service||!value.managedService||!!service.foreign;$('managerRestart').disabled=working||!value.canStop||!canUse;
  $('managerHandover').hidden=!service||!!value.managedService||!!service.foreign;$('managerHandover').disabled=working||!service||!!service.foreign||!!value.managedService||!!service.active||!!service.queue||!!service.other_consumer_recent||!canUse;
  for(const id of ['managerStop','managerRestart'])$(id).title=value.stopReason||'';
  $('managerUpgrade').hidden=value.protocolVersion>=3&&(!service||service.foreign||service.window_languages?.includes('en'));
  $('managerUpgrade').textContent=value.protocolVersion>=3?'当前运行的服务尚不支持英语识别。请在其他应用空闲时，手动接管或重启服务。':'英语识别需要配套 1.2.0。关闭设置页并重新加载扩展后，运行新版 Install-Connection.cmd。安装时运行中的识别服务保持不变。';
  for(const id of ['managerCatalog','managerImport'])$(id).disabled=working||!modern;
  $('managerDirectory').disabled=working;
  const catalog=value.catalog||{};$('catalogState').textContent=catalog.checkedAt?'上次联网检查：'+new Date(catalog.checkedAt*1000).toLocaleString()+(catalog.errors?.length?' · 部分来源未完成，保留已有安装':''):'显示随包目录，点击更新才联网检查。';
  const eligible=value.models.filter(model=>model.installed&&supports(model)),choices=eligible.map(model=>[model.id,model.name]);
  if(!eligible.some(model=>model.id===selectedModel))choices.unshift([selectedModel,'已保存：'+selectedModel+'（不可用于当前语言）']);
  options('asrModel',choices,selectedModel);$('asrModel').disabled=working||!eligible.length||!languageReady;
  $('modelSelectionHint').textContent='用于'+sourceLanguageName(language())+'识别，更改后自动保存。';
  $('modelAvailability').hidden=!service||!!service.foreign||!available||!Array.isArray(service.available_models)||service.available_models.includes(selectedModel);
  $('modelAvailability').textContent='当前服务尚未接入此模型。请在其他应用空闲时，点击上方“'+(value.managedService?'重新加载模型':'在此管理服务')+'”。';
  if(!canUse&&!busy){$('modelSelectionStatus').textContent=!languageReady?'升级管理器至 1.2.0 后可选择英语模型。':'已保存的模型尚未安装或不支持当前语言，请选择可用模型。';$('modelSelectionStatus').classList.add('error')}
  else if($('modelSelectionStatus').classList.contains('error')){$('modelSelectionStatus').textContent='';$('modelSelectionStatus').classList.remove('error')}
  renderCards(value,working);
  const legacy=value.legacyModels||[];if(pendingLegacy!==null&&!legacy.includes(pendingLegacy))pendingLegacy=null;
  $('legacyDefaultSection').hidden=!modern||!legacy.length;options('legacyDefault',legacy.map(model=>[model,model]),pendingLegacy??value.legacyDefault??'');$('legacyDefault').disabled=working;$('managerLegacyDefault').disabled=working||!modern||!legacy.length||$('legacyDefault').value===value.legacyDefault;
  const job=value.job,jobActive=['download','catalog'].includes(job?.phase);$('modelProgress').hidden=!jobActive;$('managerCancel').hidden=!jobActive;$('managerCancel').disabled=busy;$('managerCancel').textContent=job?.phase==='catalog'?'取消检查':'取消下载';
  $('downloadState').textContent=!job?'':job.phase==='catalog'?'正在检查可用模型 '+job.done+' / '+job.total+' · 只读元数据':job.phase==='download'?'正在下载 '+job.model+' · '+size(job.done)+' / '+size(job.total):job.message||(job.phase==='complete'?'模型已校验并安装。':'');
  $('modelProgress').value=job?.total?job.done/job.total*100:0;
 }
 function disconnected(error){
  connected=false;state=null;cardStamp='';badge('managerConnection','连接不可用','error');badge('modelService','状态未知');$('managerConnectionDetail').textContent='连接中断后不再自动重试。';$('serviceModel').textContent='未读取到服务状态；不代表识别服务已停止。';$('serviceSharing').textContent='';$('connectionHelp').hidden=false;$('connectionError').textContent=error;
  $('managerRefresh').textContent='重新连接';$('managerRefresh').disabled=false;$('managerUpgrade').hidden=true;
  for(const id of ['managerStart','managerStop','managerRestart','managerHandover','asrModel','managerCatalog','managerImport','managerDirectory','legacyDefault','managerLegacyDefault','managerCancel'])$(id).disabled=true;
  for(const id of ['managerStop','managerRestart','managerHandover','modelProgress','managerCancel','legacyDefaultSection','modelAvailability'])$(id).hidden=true;
  $('models').replaceChildren();$('modelCount').textContent='';$('modelEmpty').hidden=false;$('modelEmpty').textContent='重新连接后显示模型。';$('downloadState').textContent='';$('modelSelectionStatus').textContent='';$('catalogState').textContent='';$('modelDirectory').textContent='连接后显示';
 }
 async function refresh(silent=false){
  if(refreshing||busy||closed)return;refreshing=true;attempted=true;const observedRevision=revision;$('managerRefresh').disabled=true;
  try{await ready;const value=await request('status');if(!closed&&observedRevision===revision){render(value);if(!silent)note('状态已更新。')}}catch(e){if(!closed&&observedRevision===revision){disconnected(e.message);note('')}}finally{refreshing=false;if(!closed)$('managerRefresh').disabled=busy}
 }
 async function perform(action,args={},after){
  if(busy||!connected)return;busy=true;revision++;
  try{render(state);const value=await request(action,args);render(value);if(after)await after();else note(action==='chooseDirectory'?'保存位置已更新，已有模型保持原位。':action==='chooseImport'?'已导入并原位复用，没有复制权重。':action==='refreshCatalog'?'正在更新可下载列表，不会自动下载模型。':action==='start'?'已提交启动，请等待服务就绪。':action==='stop'?'服务已停止。':action==='restart'||action==='handover'?'正在重新加载，请等待服务就绪。':'操作已提交。')}
  catch(e){note(e.message,true)}finally{busy=false;if(state)render(state)}
 }
 async function selectModel(){
  if(busy||!connected)return;
  const model=$('asrModel').value;if(model===selectedModel)return;
  if(!state.models.some(item=>item.id===model&&item.installed&&supports(item))){render(state);return}
  $('modelSelectionStatus').textContent='正在保存…';
  await perform('setDefault',languageArgs(model),async()=>{await updateStudySettings({asrModel:model});selectedModel=model;$('modelSelectionStatus').textContent='已保存，下次识别使用 '+(state.models.find(item=>item.id===model)?.name||model)+'。';note('')});
  if(selectedModel!==model)$('modelSelectionStatus').textContent='未保存，请重试。';
 }
 async function removeModel(model){
  if(busy||!connected)return;busy=true;revision++;render(state);
  try{const saved=(await chrome.storage.local.get(key))[key]?.asrModel;if(model.id===saved||model.id===selectedModel)throw new Error('这是当前识别默认模型，请先选择另一个模型。');
   const preview=await request('prepareDelete',{model:model.id}),plan=preview.deletion;render(preview);if(!plan?.confirm)throw new Error('请升级本地管理器后再删除。');
   const preserved=plan.preservedFiles?.length?'\n同目录其他文件保留：'+plan.preservedFiles.slice(0,8).join('、'):'';
   if(!confirm('删除 '+model.name+' 的模型文件？\n准确路径：'+plan.path+'\n模型文件合计：'+size(plan.bytes)+'\n删除后需重新下载或导入。'+preserved))return;
   render(await request('delete',{model:model.id,confirm:plan.confirm}));note('已删除确认的模型文件，其他文件保留。');
  }catch(e){note(e.message,true);if(/原启动/.test(e.message)){$('legacyDefaultSection').closest('details').open=true;$('legacyDefault').focus()}}
  finally{busy=false;if(state)render(state)}
 }
 $('extensionId').textContent=chrome.runtime.id;
 $('copyExtensionId').onclick=()=>navigator.clipboard.writeText(chrome.runtime.id).then(()=>note('已复制扩展 ID。'),()=>note('请选中扩展 ID 手动复制。'));
 $('managerRefresh').onclick=()=>refresh();$('managerCatalog').onclick=()=>perform('refreshCatalog');$('managerImport').onclick=()=>perform('chooseImport');$('managerDirectory').onclick=()=>perform('chooseDirectory');$('managerCancel').onclick=()=>perform('cancel');
 $('managerStart').onclick=()=>perform('start',languageArgs(selectedModel));$('managerStop').onclick=()=>perform('stop');
 $('managerRestart').onclick=()=>{if(confirm('重新加载识别模型？\n服务会短暂重启，请确认其他应用暂不使用语音识别。'))void perform('restart',languageArgs(selectedModel))};
 $('managerHandover').onclick=()=>{if(confirm('改由本页管理现有识别服务？\n这会短暂重启服务。请先暂停其他使用者（如本地酒馆）的语音识别。'))void perform('handover',{...languageArgs(selectedModel),confirm:'other-consumers-paused'})};
 $('legacyDefault').onchange=()=>{pendingLegacy=$('legacyDefault').value;if(state)render(state)};
 $('managerLegacyDefault').onclick=()=>{const model=$('legacyDefault').value;if(confirm('将原启动方式的默认模型从 '+state.legacyDefault+' 改为 '+model+'？\n原设置先备份，不会重启服务。'))void perform('setLegacyDefault',{model,confirm:'change-original-default'},()=>{pendingLegacy=null;note('原启动脚本默认已保存，并已备份原设置。')})};
 $('defaultSourceLanguage').addEventListener('change',()=>{if(state)render(state)});$('asrModel').addEventListener('change',selectModel);$('modelFilter').onchange=()=>state&&render(state);
 const onPage=event=>{active=event.detail==='recognition';if(active&&!attempted)void refresh(true)};
 document.addEventListener('study-settings-page',onPage);
 if(!deferConnection)void refresh(true);
 const timer=window.setInterval(()=>{if(active&&connected&&!document.hidden&&!busy)void refresh(true)},1500);
 addEventListener('pagehide',()=>{closed=true;clearInterval(timer);document.removeEventListener('study-settings-page',onPage)},{once:true});
}
