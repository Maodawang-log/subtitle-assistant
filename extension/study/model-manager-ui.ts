// @ts-nocheck
export function setupModelManager(){
 const $=id=>document.getElementById(id),key='biliscriptJapaneseSettings';let state=null,busy=false,timer=0,selectedModel='small',pendingLegacy=null;
 const ready=chrome.storage.local.get(key).then(data=>selectedModel=data[key]?.asrModel||'small');
 $('extensionId').textContent=chrome.runtime.id;
 $('copyExtensionId').onclick=()=>navigator.clipboard.writeText(chrome.runtime.id).then(()=>note('已复制扩展 ID。'),()=>note('请选中上方扩展 ID 复制。'));
 function note(text,error=false){$('managerNote').textContent=text;$('managerNote').classList.toggle('error',error)}
 async function request(action,args={}){const result=await chrome.runtime.sendMessage({type:'study-model-manager',action,args});if(!result?.ok)throw new Error(result?.error||'本地管理器没有返回结果。');return result.data}
 const size=bytes=>(bytes/1048576).toFixed(1)+' MiB';
 function options(id,rows,selected){const select=$(id),stamp=JSON.stringify(rows);if(select.dataset.options!==stamp){select.replaceChildren(...rows.map(([value,label])=>new Option(label,value)));select.dataset.options=stamp}if(select.value!==selected)select.value=selected}
 function render(value){
  state=value;$('connectionHelp').hidden=true;$('modelDirectory').textContent=value.directory;
  const modern=value.protocolVersion>=2,working=busy||['download','catalog'].includes(value.job?.phase),service=value.service,backend=service?.backend?.model;
  $('managerUpgrade').hidden=modern;$('managerUpgrade').textContent=modern?'':'当前配套 '+(value.version||'1.0.0')+'。新功能需要升级至 1.1.0：先关闭设置页，在扩展管理页重新加载扩展，暂不打开设置；运行新版 Install-Connection.cmd，再打开设置刷新。自动备份并更新原目录，无需停止识别服务。';
  $('modelService').textContent=service?.foreign?'18766 已由其他服务占用。':service?'服务已启动 · 当前驻留 '+(backend||'准备中')+(service.active?' · 正在识别':service.queue?' · 有任务排队':' · 空闲')+(value.managedService?' · 管理器启动':' · 现有共享服务'):value.starting?'正在启动并加载模型…':'服务未启动';
  $('managerStop').disabled=working||!value.canStop;$('managerStart').disabled=working||!!service||!!value.starting;
  $('managerHandover').hidden=!service||!!value.managedService||!!service.foreign;$('managerHandover').disabled=working||!!service?.active||!!service?.queue;
  $('managerRestart').hidden=!value.managedService;$('managerRestart').disabled=working||!value.canStop;
  $('managerStop').title=value.stopReason||'停止空闲的共享服务';$('serviceSharing').textContent=value.stopReason||'服务被其他应用使用后，15 分钟内保护共享服务；识别或排队期间也不会停止。';
  for(const id of ['managerCatalog','managerImport'])$(id).disabled=!modern||working;
  $('managerDirectory').disabled=working;
  const catalog=value.catalog||{};$('catalogState').textContent=catalog.checkedAt?'上次联网检查：'+new Date(catalog.checkedAt*1000).toLocaleString()+' · '+value.models.filter(m=>m.source).length+' 个目录条目'+(catalog.errors?.length?' · '+catalog.errors.length+' 个来源未完成，保留已有安装':''):'随包基础目录 · 尚未联网检查';
  const eligible=value.models.filter(model=>model.installed&&model.japaneseSupported!==false),choices=eligible.map(model=>[model.id,model.name]);
  if(!eligible.some(model=>model.id===selectedModel))choices.push([selectedModel,'已保存：'+selectedModel+' · 待确认安装']);options('asrModel',choices,selectedModel);
  $('models').replaceChildren();
  for(const model of value.models){
   const filter=$('modelFilter').value;if(filter==='ja'&&model.japaneseSupported===false||filter==='installed'&&!model.installed)continue;
   const row=document.createElement('article');row.className='model-card';row.dataset.model=model.id;
   const title=document.createElement('strong'),info=document.createElement('p'),description=document.createElement('p'),actions=document.createElement('div');title.textContent=model.name;
   info.className='note';info.textContent=(model.installed?'已安装 · '+(model.owned?'管理器安装':'原位复用'):'可下载')+' · '+size(model.bytes)+' · '+(model.language||'多语言（含日语）')+(model.path?'\n'+model.path:'');
   description.className='note';description.textContent=model.positioning||'';
   if(model.installed){const choose=document.createElement('button');choose.textContent=selectedModel===model.id?'当前默认':'设为默认';choose.disabled=working||selectedModel===model.id||model.japaneseSupported===false;choose.onclick=()=>perform('setDefault',{model:model.id},async()=>{const data=await chrome.storage.local.get(key);selectedModel=model.id;await chrome.storage.local.set({[key]:{...data[key],asrModel:model.id}});$('asrModel').value=model.id;note('已设为下次识别使用的模型；新目录需接管或重启服务后生效。');render(state)});actions.append(choose);
    const remove=document.createElement('button');remove.textContent='删除模型文件';remove.disabled=working||!modern;remove.onclick=()=>void removeModel(model);actions.append(remove);
   }else{const download=document.createElement('button');download.textContent='下载';download.disabled=working;download.onclick=()=>perform('download',{model:model.id});actions.append(download)}
   if(model.source){const source=document.createElement('a');source.href=model.source;source.target='_blank';source.rel='noopener noreferrer';source.textContent='来源';source.className='model-source';actions.append(source)}
   row.append(title,info,description,actions);$('models').append(row);
  }
  const legacy=value.legacyModels||[];if(pendingLegacy!==null&&!legacy.includes(pendingLegacy))pendingLegacy=null;
  $('legacyDefaultSection').hidden=!modern;options('legacyDefault',legacy.map(model=>[model,model]),pendingLegacy??value.legacyDefault??'');$('managerLegacyDefault').disabled=working||!modern||!legacy.length;
  const job=value.job,active=['download','catalog'].includes(job?.phase);$('modelProgress').hidden=!active;$('managerCancel').hidden=!active;
  if(job){$('modelProgress').value=job.total?job.done/job.total*100:0;$('downloadState').textContent=job.phase==='catalog'?'正在联网检查可用模型 '+job.done+' / '+job.total+' · 只读元数据':job.phase==='download'?'正在下载 '+job.model+' · '+size(job.done)+' / '+size(job.total):job.message||(job.phase==='complete'?'模型已校验并安装。':'')}
 }
 async function removeModel(model){
  busy=true;render(state);try{
   const saved=(await chrome.storage.local.get(key))[key]?.asrModel;if(model.id===saved||model.id===selectedModel)throw new Error('这是当前日语字幕默认模型，请先明确选择另一个默认模型。');
   const preview=await request('prepareDelete',{model:model.id}),plan=preview.deletion;render(preview);
   if(!plan?.confirm)throw new Error('请升级本地管理器后再删除。');
   const preserved=plan.preservedFiles?.length?'\n同目录其他文件保留：'+plan.preservedFiles.slice(0,8).join('、'):'';
   if(!confirm('删除 '+model.name+' 的模型文件？\n准确路径：'+plan.path+'\n模型文件合计：'+size(plan.bytes)+'\n删除后重新使用需重新下载或导入。'+preserved))return;
   render(await request('delete',{model:model.id,confirm:plan.confirm}));note('已删除确认的模型文件，其他文件保留。');
  }catch(e){note(e.message,true)}finally{busy=false;if(state)render(state)}
 }
 async function refresh(silent=false){try{await ready;const value=await request('status');render(value);if(!silent)note('已连接本机管理器。打开此页只读取本地状态。')}catch(e){$('connectionHelp').hidden=false;if(!silent||!state)note(e.message,true)}}
 async function perform(action,args={},after){busy=true;try{if(state)render(state);const value=await request(action,args);render(value);if(after)await after();else note(action==='chooseDirectory'?'以后下载到新目录；已有模型保持原位。':action==='chooseImport'?'已有模型已原位检查并复用，没有复制权重。':action==='refreshCatalog'?'正在检查官方兼容目录，未下载权重。':action==='setLegacyDefault'?'原启动方式默认已更新并备份；运行中的服务保持不变。':'操作已提交，请查看状态。')}catch(e){note(e.message,true)}finally{busy=false;if(state)render(state)}}
 $('managerRefresh').onclick=()=>refresh();$('managerCatalog').onclick=()=>perform('refreshCatalog');$('managerImport').onclick=()=>perform('chooseImport');$('managerDirectory').onclick=()=>perform('chooseDirectory');$('managerCancel').onclick=()=>perform('cancel');
 $('managerStart').onclick=()=>perform('start',{model:$('asrModel').value});$('managerStop').onclick=()=>perform('stop');$('managerRestart').onclick=()=>perform('restart',{model:$('asrModel').value});
 $('managerHandover').onclick=()=>{if(confirm('首次接管会短暂重启原本地识别服务。\n请先暂停本地酒馆和其他应用的识别任务。\n已确认暂停其他使用者，现在接管？'))perform('handover',{model:$('asrModel').value,confirm:'other-consumers-paused'})};
 $('legacyDefault').onchange=()=>{pendingLegacy=$('legacyDefault').value};
 $('managerLegacyDefault').onclick=()=>{const model=$('legacyDefault').value;if(confirm('将原启动方式的默认模型从 '+state.legacyDefault+' 改为 '+model+'？\n原设置文件会先备份，其他设置不变；不会重启服务。'))perform('setLegacyDefault',{model,confirm:'change-original-default'},()=>{pendingLegacy=null;note('原启动方式默认已更新并备份；运行中的服务保持不变。')})};
 $('asrModel').addEventListener('change',()=>{selectedModel=$('asrModel').value;if(state)render(state)});$('modelFilter').onchange=()=>state&&render(state);
 void refresh();timer=window.setInterval(()=>{if(!document.hidden&&!busy)void refresh(true)},1500);addEventListener('pagehide',()=>clearInterval(timer));
}
