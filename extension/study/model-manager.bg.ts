import { isStudyRecord } from "./messaging.js";
const HOST = "com.biliscript.local_models";
interface NativePort {postMessage(value:unknown):void;onMessage:{addListener(fn:(message:unknown)=>void):void};onDisconnect:{addListener(fn:()=>void):void}}
const runtime=chrome.runtime as typeof chrome.runtime & {id:string;connectNative(name:string):NativePort};
let port: NativePort | null = null;
const pending = new Map<string,{resolve:(value:unknown)=>void;timer:ReturnType<typeof setTimeout>}>();
const actions = new Set(["status","chooseDirectory","refreshCatalog","chooseImport","prepareDelete","setLegacyDefault","download","cancel","setDefault","delete","start","stop","handover","restart"]);
export function isManagerSettingsSender(sender: chrome.runtime.MessageSender & {frameId?:number}) {
 if(sender.id!==runtime.id||!sender.url||sender.frameId!==undefined&&sender.frameId!==0)return false;
 try {const url=new URL(sender.url),expected=new URL(chrome.runtime.getURL("study/options.html"));return url.origin===expected.origin&&url.host===expected.host&&url.pathname===expected.pathname&&url.protocol===expected.protocol;}catch{return false}
}
function nativeRequest(action:string,args:Record<string,unknown>){
 return new Promise(resolve=>{
  try{
   if(!port){
    port=runtime.connectNative(HOST);
    port.onMessage.addListener(message=>{if(!isStudyRecord(message)||typeof message.id!=="string")return;const item=pending.get(message.id);if(!item)return;clearTimeout(item.timer);pending.delete(message.id);item.resolve(message)});
    port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;port=null;for(const item of pending.values()){clearTimeout(item.timer);item.resolve({ok:false,error:"尚未连接本地模型管理器。请先安装配套连接，再刷新状态。"})}pending.clear()});
   }
   const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);resolve({ok:false,error:"本地管理操作未完成，请刷新状态后重试。"})},["chooseDirectory","chooseImport"].includes(action)?300000:45000);
   pending.set(id,{resolve,timer});port.postMessage({id,action,args});
  }catch{resolve({ok:false,error:"无法连接本地模型管理器，请检查配套连接。"})}
 });
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(!isStudyRecord(message)||message.type!=="study-model-manager")return;
 if(!isManagerSettingsSender(sender)){reply({ok:false,error:"模型管理仅允许从本扩展设置页操作。"});return false}
 if(typeof message.action!=="string"||!actions.has(message.action)||!isStudyRecord(message.args)){reply({ok:false,error:"不支持的模型管理操作。"});return false}
 nativeRequest(message.action,message.args).then(reply);return true;
});
