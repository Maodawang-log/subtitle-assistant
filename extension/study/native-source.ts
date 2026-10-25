// Only called after the user enables learning. Signed URLs remain in memory.
export interface NativeBinding {
 documentId:string;timeOrigin:number;routeKey:string;routeEpoch:number;videoGeneration:number;videoTag:string;mediaSrc:string;
}
export interface NativeAudioSource {
 status:"ready";bvid:string;cid:string;title:string;duration:number;playableDuration:number;
 subtitleListPresent:boolean;japaneseTrackCount:number;
 source:{url:string;backupUrls:string[]};binding:NativeBinding;
 audit:{exactUrlMatch:true;responseStatus:206;requestStart:number;epochStart:number;videoEpoch:number;cidPathMatch:true;previewSeconds:number|null;accessScope?:"preview"|"current-player"|"continued-playback";host:string};
}
export interface NativeUnavailable { status:"unavailable";reason:string;message:string }
export type NativeSourceResult=NativeAudioSource|NativeUnavailable;
const record=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==="object"&&!Array.isArray(x);
export function readNativeSourceResult(raw:unknown):NativeSourceResult {
 const no:NativeUnavailable={status:"unavailable",reason:"RESPONSE",message:"当前播放音轨尚未建立关联，请播放几秒后重试。"};
 if(!record(raw))return no;
 if(raw.status==="unavailable")return {status:"unavailable",reason:typeof raw.reason==="string"?raw.reason:"UNAVAILABLE",message:typeof raw.message==="string"?raw.message:no.message};
 if(raw.status!=="ready"||typeof raw.bvid!=="string"||!/^BV[0-9A-Za-z]{10}$/.test(raw.bvid)||typeof raw.cid!=="string"||!/^\d+$/.test(raw.cid)||typeof raw.title!=="string"
 ||typeof raw.duration!=="number"||!Number.isFinite(raw.duration)||raw.duration<=0||typeof raw.playableDuration!=="number"||!Number.isFinite(raw.playableDuration)||raw.playableDuration<=0||raw.playableDuration>raw.duration
 ||typeof raw.subtitleListPresent!=="boolean"||typeof raw.japaneseTrackCount!=="number"||!Number.isInteger(raw.japaneseTrackCount)||raw.japaneseTrackCount<0||!record(raw.source)||typeof raw.source.url!=="string"
 ||!Array.isArray(raw.source.backupUrls)||!raw.source.backupUrls.every(u=>typeof u==="string")||!record(raw.binding)||!record(raw.audit))return no;
 const b=raw.binding,a=raw.audit;
 if(!["documentId","routeKey","videoTag","mediaSrc"].every(k=>typeof b[k]==="string")||!["timeOrigin","routeEpoch","videoGeneration"].every(k=>typeof b[k]==="number"&&Number.isFinite(b[k]))
 ||a.exactUrlMatch!==true||a.responseStatus!==206||a.cidPathMatch!==true||typeof a.host!=="string"||!["requestStart","epochStart","videoEpoch"].every(k=>typeof a[k]==="number"&&Number.isFinite(a[k]))
 ||!(a.previewSeconds===null||typeof a.previewSeconds==="number"&&Number.isFinite(a.previewSeconds)))return no;
 return raw as unknown as NativeAudioSource;
}
export async function getNativeStudySource():Promise<NativeSourceResult>{
 try{const raw:unknown=await chrome.runtime.sendMessage({type:"study-native-source"});return readNativeSourceResult(raw)}
 catch{return {status:"unavailable",reason:"CONNECTION",message:"当前播放音轨尚未建立关联，请播放几秒后重试。"}}
}
export function sameNativeBinding(a:NativeBinding,b:NativeBinding):boolean{
 return a.documentId===b.documentId&&a.timeOrigin===b.timeOrigin&&a.routeKey===b.routeKey&&a.routeEpoch===b.routeEpoch&&a.videoGeneration===b.videoGeneration&&a.videoTag===b.videoTag&&a.mediaSrc===b.mediaSrc;
}
