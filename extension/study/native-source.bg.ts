import { readNativeSourceResult } from "./native-source.js";
import { readNativeStudyPage } from "./native-page.js";
interface NativeScripting {executeScript(options:{target:{tabId:number};world:"MAIN";func:()=>unknown}):Promise<Array<{result?:unknown}>>}
export function installNativeStudySource(){
 chrome.runtime.onMessage.addListener((message:any,sender:any,reply:(r:unknown)=>void)=>{
  if(message?.type!=="study-native-source")return;
  if(sender.id!==(chrome.runtime as typeof chrome.runtime & {id:string}).id||!Number.isInteger(sender.tab?.id)){reply({status:"unavailable",reason:"SENDER",message:"需要当前视频标签页。"});return false}
  const scripting=chrome.scripting as unknown as NativeScripting;
  scripting.executeScript({target:{tabId:sender.tab.id},world:"MAIN",func:readNativeStudyPage}).then(results=>reply(readNativeSourceResult(results[0]?.result)),()=>reply({status:"unavailable",reason:"PAGE",message:"当前播放音轨尚未建立关联，请播放几秒后重试。"}));
  return true;
 });
}
installNativeStudySource();
