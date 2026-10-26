// @ts-nocheck
export function setupModelManager(){
 const $=id=>document.getElementById(id);let state=null,busy=false,timer=0;
 $("extensionId").textContent=chrome.runtime.id;
 $("copyExtensionId").onclick=()=>navigator.clipboard.writeText(chrome.runtime.id).then(()=>note("已复制扩展 ID。"),()=>note("请选中上方扩展 ID 复制。"));
 function note(text,error=false){$("managerNote").textContent=text;$("managerNote").classList.toggle("error",error)}
 async function request(action,args={}){const result=await chrome.runtime.sendMessage({type:"study-model-manager",action,args});if(!result?.ok)throw new Error(result?.error||"本地管理器没有返回结果。");return result.data}
 function render(value){
  state=value;$("connectionHelp").hidden=true;$("modelDirectory").textContent=value.directory;
  const service=value.service,backend=service?.backend?.model;
  $("modelService").textContent=service?.foreign?"18766 已由其他服务占用。":service?"服务已启动 · 当前驻留 "+(backend||"准备中")+(service.active?" · 正在识别":service.queue?" · 有任务排队":" · 空闲")+(value.managedService?" · 管理器启动":" · 现有共享服务"):value.starting?"正在启动并加载模型…":"服务未启动";
  $("managerStop").disabled=busy||!value.canStop;$("managerStart").disabled=busy||!!service||!!value.starting;
  $("managerHandover").hidden=!service||!!value.managedService||!!service.foreign;
  $("managerHandover").disabled=busy||!!service?.active||!!service?.queue;
  $("managerRestart").hidden=!value.managedService;$("managerRestart").disabled=busy||!value.canStop;
  $("managerStop").title=value.stopReason||"停止空闲的共享服务";$("serviceSharing").textContent=value.stopReason||"服务被其他应用使用后，15 分钟内保护共享服务；识别或排队期间也不会停止。";
  $("models").replaceChildren();
  for(const model of value.models){
   const row=document.createElement("article");row.className="model-card";const title=document.createElement("strong"),info=document.createElement("p"),actions=document.createElement("div");title.textContent=model.name;
   info.className="note";info.textContent=(model.installed?"已安装 · "+(model.owned?"管理器安装":"复用已有模型"):"未安装 · 下载 "+(model.bytes/1048576).toFixed(0)+" MiB")+(model.path?"\n"+model.path:"");
   if(model.installed){const choose=document.createElement("button");choose.textContent=$("asrModel").value===model.id?"当前默认":"设为默认";choose.disabled=busy||$("asrModel").value===model.id;choose.onclick=()=>perform("setDefault",{model:model.id},async()=>{const key="biliscriptJapaneseSettings",data=await chrome.storage.local.get(key);await chrome.storage.local.set({[key]:{...data[key],asrModel:model.id}});$("asrModel").value=model.id;note("已设为下次识别使用的模型；当前驻留模型见服务状态。");if(!value.service?.available_models?.includes(model.id)&&value.service)note("默认模型已保存；请先接管或重启服务，应用新模型目录。");render(state)});actions.append(choose)}
   else{const download=document.createElement("button");download.textContent="下载";download.disabled=busy||["download"].includes(value.job?.phase);download.onclick=()=>perform("download",{model:model.id});actions.append(download)}
   if(model.owned){const remove=document.createElement("button");remove.textContent="删除";remove.disabled=busy;remove.onclick=()=>{if(confirm("删除管理器安装的 "+model.name+"？\n"+model.path+"\n原有模型、词典和浏览器设置保持不变。"))perform("delete",{model:model.id,confirm:model.id})};actions.append(remove)}
   row.append(title,info,actions);$("models").append(row);
   const option=[...$("asrModel").options].find(o=>o.value===model.id);if(option)option.disabled=!model.installed;
  }
  const job=value.job,downloading=job?.phase==="download";$("modelProgress").hidden=!downloading;$("managerCancel").hidden=!downloading;
  if(job){$("modelProgress").value=job.total?job.done/job.total*100:0;$("downloadState").textContent=downloading?"正在下载 "+job.model+" · "+(job.done/1048576).toFixed(1)+" / "+(job.total/1048576).toFixed(1)+" MiB":job.phase==="complete"?"模型已校验并安装。":job.message||""}
 }
 async function refresh(silent=false){try{const value=await request("status");render(value);if(!silent)note("已连接本机管理器。打开此页只检查状态，不会开始识别或下载。")}catch(e){$("connectionHelp").hidden=false;if(!silent||!state)note(e.message,true)}}
 async function perform(action,args={},after){busy=true;try{if(state)render(state);const value=await request(action,args);render(value);if(after)await after();else if(action==="chooseDirectory")note("以后下载到新目录；已有模型保持原位。");else if(action==="handover")note("已接管，正在启动管理器服务；原启动脚本保留。");else note(action==="setDefault"?"默认模型已保存。":"操作已提交，请查看状态。")}catch(e){note(e.message,true)}finally{busy=false;if(state)render(state)}}
 $("managerRefresh").onclick=()=>refresh();$("managerDirectory").onclick=()=>perform("chooseDirectory");$("managerCancel").onclick=()=>perform("cancel");
 $("managerStart").onclick=()=>perform("start",{model:$("asrModel").value});$("managerStop").onclick=()=>perform("stop");$("managerRestart").onclick=()=>perform("restart",{model:$("asrModel").value});
 $("managerHandover").onclick=()=>{if(confirm("首次接管会短暂重启原本地识别服务。\n请先暂停本地酒馆和其他应用的识别任务。\n已确认暂停其他使用者，现在接管？"))perform("handover",{model:$("asrModel").value,confirm:"other-consumers-paused"})};
 $("asrModel").addEventListener("change",()=>{if(state)render(state)});
 void refresh();timer=window.setInterval(()=>{if(!document.hidden&&!busy)void refresh(true)},1500);addEventListener("pagehide",()=>clearInterval(timer));
}
