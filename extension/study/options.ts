// @ts-nocheck
import { setupCacheSettings } from "./cache-settings.js";
import { setupModelManager } from "./model-manager-ui.js";
import { setupAppearance } from "./appearance.js";
import { setupSettingsNavigation } from "./settings-navigation.js";
import { updateStudySettings } from "./settings-store.js";
import { ZH_DICTIONARY,DICTIONARIES,DICTIONARY_ORIGINS,checkDictionaryUpdate } from "./dictionary-catalog.js";
import { dictionaryInventory,setDefaultDictionary,lookupDictionary } from "./dictionary-db.js";
const key="biliscriptJapaneseSettings",$=id=>document.getElementById(id);let previous={},release=ZH_DICTIONARY,installed,busy=true,operation="recover",inventory={installed:[],defaults:{}},lookupEpoch=0;
const languageNames={ja:"日语",en:"英语",ko:"韩语",zh:"中文"},releases=new Map(DICTIONARIES.map(item=>[item.id,item]));
const note=(id,text,error=false)=>{$(id).textContent=text;$(id).classList.toggle("error",error)};
const download=(name,value,type="application/json")=>{const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)};
function providerState(data){const configured=!!data.apiKey;$("providerState").textContent=configured?"已配置":"未配置 Key";$("providerState").dataset.state=configured?"ready":"idle";$("apiKey").placeholder=configured?"已保存；留空保留原 Key":"填入 API Key";$("keyHint").textContent=configured?"已保存的 Key 不会显示在页面中；需要更换时直接填写。":"Key 仅保存在当前浏览器。";$("removeApiKey").hidden=!configured}
const settingsReady=chrome.storage.local.get(key).then(x=>{previous=x[key]||{};$("defaultSourceLanguage").value=previous.sourceLanguage==="en"?"en":"ja";$("asrModel").value=previous.asrModel||"small";$("baseUrl").value=previous.baseUrl||"https://api.deepseek.com";$("model").value=previous.model||"deepseek-v4-flash";$("compatibility").value=previous.compatibility||"auto";providerState(previous)});
$("defaultSourceLanguage").onchange=async()=>{const value=$("defaultSourceLanguage").value;$("defaultSourceLanguage").disabled=true;try{await updateStudySettings({sourceLanguage:value});note("languageStatus","已保存，新打开的视频使用"+(value==="en"?"英语":"日语")+"。")}catch(e){note("languageStatus","保存失败，请重新选择。",true)}finally{$("defaultSourceLanguage").disabled=false}};
for(const id of ["baseUrl","model","apiKey","compatibility"])$(id).addEventListener("input",()=>{note("status","有未保存的修改。");$("providerState").textContent="尚未保存";$("providerState").dataset.state="busy"});
$("showApiKey").onclick=()=>{const show=$("apiKey").type==="password";$("apiKey").type=show?"text":"password";$("showApiKey").textContent=show?"隐藏":"显示";$("showApiKey").setAttribute("aria-pressed",String(show))};
$("save").onclick=async()=>{
 for(const id of ["save","baseUrl","model","apiKey","compatibility","showApiKey","removeApiKey"])$(id).disabled=true;
 try{
  const latest=(await chrome.storage.local.get(key))[key]||{};
  const baseUrl=$("baseUrl").value.trim(),model=$("model").value.trim(),typedKey=$("apiKey").value.trim();
  const data={autoStart:false,autoTranslate:false};
   let u;try{u=new URL(baseUrl)}catch{throw new Error("请填写完整的服务地址。仅使用本地功能时，无需保存此接口。")}
   if(u.username||u.password||u.search||u.hash||u.protocol!=="https:"&&!(u.protocol==="http:"&&["localhost","127.0.0.1"].includes(u.hostname)))throw new Error("请输入不含凭据或查询参数的HTTPS或本机HTTP地址");
   if(!model)throw new Error("请填写服务提供的模型名称。");
   const apiKey=typedKey||latest.apiKey||"";
   if(apiKey){const granted=await chrome.permissions.request({origins:[u.origin+"/*"]});if(!granted)throw new Error("未允许访问该接口域名，未保存")}
   Object.assign(data,{baseUrl:u.href.replace(/\/+$/,""),model,compatibility:$("compatibility").value,apiKey});
  previous=await updateStudySettings(data);$("apiKey").value="";$("apiKey").type="password";$("showApiKey").textContent="显示";$("showApiKey").setAttribute("aria-pressed","false");providerState(previous);note("status","接口已保存。关闭字幕再开启后生效。");
 }catch(e){note("status",e.message,true)}finally{for(const id of ["save","baseUrl","model","apiKey","compatibility","showApiKey","removeApiKey"])$(id).disabled=false}
};
$("removeApiKey").onclick=async()=>{if(!confirm("移除当前浏览器保存的 API Key？\n本地识别、词典和录音仍可使用。"))return;try{previous=await updateStudySettings({apiKey:""});$("apiKey").value="";providerState(previous);note("status","已移除保存的 Key。")}catch(e){note("status",e.message,true)}};
$("diagnostics").onclick=async()=>{const data=(await chrome.storage.local.get("biliscriptJapaneseAiDiagnostics")).biliscriptJapaneseAiDiagnostics||[];download("讲解安全诊断.json",JSON.stringify({version:1,entries:data},null,2));note("status","已导出最近20次请求的类型、结束原因和计数；不含 Key、地址、字幕或原始响应。")};
const worker=new Worker(chrome.runtime.getURL("study/dictionary-worker.js"));
function buttons(){
 $("dictLanguage").disabled=busy;$("dictDefault").disabled=busy||!inventory.installed.some(item=>DICTIONARIES.find(d=>d.id===item.id)?.sourceLanguage===$("dictLanguage").value);
 $("dictInstall").disabled=busy||!release||installed?.version===release?.version;$("dictUpdate").disabled=busy||!release;$("dictDelete").disabled=busy||!installed;$("dictCancel").hidden=!busy||operation!=="install";
 for(const button of $("dictionaryList").querySelectorAll("button"))button.disabled=busy;
 $("dictInstall").textContent=installed?"安装所选版本":"下载安装";
 $("dictState").textContent=installed?"已安装 · "+installed.rows.toLocaleString()+" 条":"未安装";
}
function renderCatalog(){
 const language=$("dictLanguage").value,available=DICTIONARIES.filter(item=>item.sourceLanguage===language);
 if(!available.some(item=>item.id===release?.id))release=available.length?releases.get(available[0].id):undefined;
 installed=inventory.installed.find(item=>item.id===release?.id);$("dictionaryList").replaceChildren();
 for(const item of available){const button=document.createElement("button"),has=inventory.installed.some(x=>x.id===item.id);button.textContent=item.name+" · "+(has?"已安装":"可下载");button.dataset.dictionaryId=item.id;button.setAttribute("aria-pressed",String(item.id===release?.id));button.onclick=()=>{release=releases.get(item.id);renderCatalog();note("dictStatus","")};$("dictionaryList").append(button)}
 $("dictionaryCard").hidden=!release;$("unsupportedLanguage").hidden=!!available.length;
 if(release){$("dictName").textContent=release.name;$("dictLanguagePair").textContent=languageNames[release.sourceLanguage]+" → "+languageNames[release.targetLanguage];$("dictSize").textContent=(release.expectedRows?release.expectedRows.toLocaleString()+" 条记录 · ":"")+"下载 "+(release.bytes/1048576).toFixed(1)+" MiB";$("dictQuality").textContent=release.quality;$("dictVersion").textContent="目录版本："+release.version;$("dictSource").href=release.source;$("dictLicense").href=release.licenseUrl;$("dictLicense").textContent=release.license;$("dictAttribution").textContent=installed?.attribution||release.attribution}
 const defaults=inventory.installed.filter(item=>available.some(d=>d.id===item.id));$("dictDefault").replaceChildren(...(defaults.length?defaults.map(item=>new Option(item.name,item.id)):[new Option("尚未安装","")]));$("dictDefault").value=inventory.defaults[language]||"";$("defaultLabel").textContent=languageNames[language]+"默认词典";
 $("installedDictionaries").replaceChildren();for(const item of inventory.installed){const p=document.createElement("p"),lang=DICTIONARIES.find(d=>d.id===item.id).sourceLanguage;p.textContent=item.name+" · "+item.rows.toLocaleString()+" 条"+(inventory.defaults[lang]===item.id?" · "+languageNames[lang]+"默认":"");$("installedDictionaries").append(p)}if(!inventory.installed.length)$("installedDictionaries").textContent="尚未安装离线词典。";
 $("lookup").disabled=!available.length;buttons();
}
async function refresh(){inventory=await dictionaryInventory();renderCatalog()}
$("dictLanguage").onchange=()=>{lookupEpoch++;$("lookupResult").replaceChildren();$("lookupText").value="";$("lookupText").placeholder=$("dictLanguage").value==="en"?"英语单词，如 language":"日语原形或读音，如 食べる";renderCatalog();note("dictStatus","")};
$("dictDefault").onchange=async()=>{try{await setDefaultDictionary($("dictLanguage").value,$("dictDefault").value);await refresh();lookupEpoch++;$("lookupResult").replaceChildren();note("dictStatus","已设置默认词典；其他语言的默认词典保持不变。")}catch(e){note("dictStatus",e.message,true)}};
worker.onmessage=async({data})=>{
 const stage=data.stage;
 if(stage==="download"){note("dictStatus","正在下载："+(data.done/1048576).toFixed(1)+" / "+(data.total/1048576).toFixed(1)+" MB");$("dictProgress").hidden=false;$("dictProgress").value=data.done/data.total*100}
 else if(stage==="verify")note("dictStatus","正在核对 SHA256 与词典格式…");
 else if(stage==="import"){note("dictStatus","正在安装 "+data.done+" / "+data.total+" "+(data.unit||"分片")+" · "+data.rows.toLocaleString()+" 条");$("dictProgress").hidden=false;$("dictProgress").value=data.done/data.total*100}
 else {busy=false;operation="";$("dictProgress").hidden=true;await refresh();if(stage==="installed")note("dictStatus","已安装 "+data.meta.name+"，可离线查询。版本："+data.meta.version);else if(stage==="deleted")note("dictStatus","已删除所选词典，其他词典不受影响。");else if(stage!=="ready")note("dictStatus",data.message,stage==="error")}
};
worker.onerror=()=>{busy=false;buttons();note("dictStatus","词典任务中断。重新打开设置页会清理未完成安装，原版本仍可用。",true)};
worker.postMessage({action:"recover"});
$("dictInstall").onclick=async()=>{
 try{
  const granted=await chrome.permissions.request({origins:DICTIONARY_ORIGINS});
  if(!granted)throw new Error("未允许访问词典发布站点，下载未开始");
  busy=true;operation="install";buttons();worker.postMessage({action:"install",release});
 }catch(e){note("dictStatus",e.message,true)}
};
$("dictUpdate").onclick=async()=>{
 try{const granted=await chrome.permissions.request({origins:DICTIONARY_ORIGINS});if(!granted)throw new Error("未允许检查词典发布站点");busy=true;operation="update";buttons();release=await checkDictionaryUpdate(AbortSignal.timeout(30000),release.id);releases.set(release.id,release);renderCatalog();note("dictStatus",release.format==="ecdict-csv"?"当前目录固定为已核验版本 "+release.version+"；新版资源随目录更新。":installed?.version===release.version?"已是最新版本："+release.version:"可安装版本："+release.version+"；点击安装。")}
 catch(e){note("dictStatus",e.name==="TimeoutError"?"检查更新超时；原词典仍可使用。":e.message,true)}
 finally{busy=false;buttons()}
};
$("dictCancel").onclick=()=>{worker.postMessage({action:"cancel"});note("dictStatus","正在取消并清理未完成安装…")};
$("dictDelete").onclick=()=>{if(!installed||!confirm("删除“"+release.name+"”？\n以后需要重新下载，其他词典与生词本保留。"))return;busy=true;operation="delete";buttons();note("dictStatus","正在删除 "+release.name+"…");worker.postMessage({action:"delete",id:release.id})};
$("dictImport").onclick=()=>$("dictFile").click();
$("dictExample").onclick=()=>download("日中词典格式示例.json",JSON.stringify({"食べる":{reading:"たべる",meaning:"吃"}},null,2));
$("dictFile").onchange=async()=>{
 try{
  const f=$("dictFile").files[0];if(!f)return;if(f.size>4*1024*1024)throw new Error("自定义词表不能超过4MB");
  const d=JSON.parse(await f.text());if(!d||Array.isArray(d)||typeof d!=="object")throw new Error("请导入以词语原形为键的JSON对象");
  const valid=Object.fromEntries(Object.entries(d).filter(([k,v])=>k.length<100&&(typeof v==="string"&&v.length<3000||v&&typeof v.meaning==="string"&&v.meaning.length<3000)).map(([k,v])=>[k,typeof v==="string"?v:{reading:typeof v.reading==="string"?v.reading.slice(0,100):"",meaning:v.meaning}]));
  if(!Object.keys(valid).length)throw new Error("没有有效词条");await chrome.storage.local.set({biliscriptStudyDictionary:valid});note("manualStatus","已导入 "+Object.keys(valid).length+" 条中文词义。");
 }catch(e){note("manualStatus",e.message,true)}
 finally{$("dictFile").value=""}
};
$("lookup").onclick=async()=>{
 const text=$("lookupText").value.trim(),language=$("dictLanguage").value,mine=++lookupEpoch;if(!text||text.length>100)return;
 try{const entries=await lookupDictionary([text],language);if(mine!==lookupEpoch)return;$("lookupResult").replaceChildren();if(!entries.length){$("lookupResult").textContent="当前语言的默认词典未命中；请先安装词典，或改用词典原形。";return}for(const item of entries){const p=document.createElement("p");p.textContent=item.term+" · "+item.reading+"\n"+item.meaning+"\n来源："+item.source;$("lookupResult").append(p)}}catch{if(mine===lookupEpoch)note("lookupResult","词典查询失败，请重新打开设置检查安装状态。",true)}
};

void settingsReady.then(()=>{setupAppearance();setupModelManager({deferConnection:true});setupSettingsNavigation();setupCacheSettings()});
$("lookupText").addEventListener("keydown",event=>{if(event.key==="Enter")$("lookup").click()});
