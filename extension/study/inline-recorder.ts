// Records only on a user click; blobs remain in this page and never upload.
export function createInlineRecorder(ui:any,reference:(cue:any)=>Promise<void>,pause:()=>void){
 const $=ui.$;let epoch=0,stream:MediaStream|null=null,recorder:MediaRecorder|null=null,timer=0,started=0,url="",cue:any=null,recordedCue:any=null,requesting=false,stopping=false,extension="webm";
 const message=(text:string)=>$("practiceStatus").textContent=text;
 const audio=$("micAudio") as HTMLAudioElement;
 const pauseAudio=()=>{if(audio.src)audio.pause()};
 const state=(active:boolean)=>{$("micStart").disabled=active||requesting||stopping;$("micStop").disabled=!active;ui.pin(active||requesting||stopping)};
 function release(){stream?.getTracks().forEach(t=>t.stop());stream=null;clearInterval(timer)}
 function stop(){
  epoch++;requesting=false;
  if(recorder&&recorder.state!=="inactive"){stopping=true;recorder.stop()}
  release();state(false);
 }
 function clear(){
  stop();if(recorder){recorder.ondataavailable=null;recorder.onstop=null;recorder.onerror=null;recorder=null}
  stopping=false;recordedCue=null;pauseAudio();audio.removeAttribute("src");audio.hidden=true;
  if(url)URL.revokeObjectURL(url);url="";$("micReplay").disabled=$("micSave").disabled=true;$("practice").hidden=true;state(false);
 }
 async function start(){
  if(requesting||stopping||recorder?.state==="recording")return;
  pause();pauseAudio();const mine=++epoch;requesting=true;state(false);message("请在浏览器提示中允许麦克风…");
  try{
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined")throw new Error("当前浏览器不支持录音，请使用新版 Chrome / Edge。");
   const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
   if(mine!==epoch||$("practice").hidden){acquired.getTracks().forEach(t=>t.stop());return}
   stream=acquired;requesting=false;
   const mime=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":"";
   const current=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks:BlobPart[]=[],captureCue={...cue};
   recorder=current;
   current.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
   current.onstop=()=>{
    if(recorder!==current)return;release();stopping=false;state(false);
    const blob=new Blob(chunks,{type:current.mimeType||"audio/webm"});chunks.length=0;
    if(!blob.size){message("没有录到声音数据，请重新录音。");return}
    if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);audio.src=url;audio.hidden=false;recordedCue=captureCue;extension=blob.type.includes("mp4")?"m4a":blob.type.includes("ogg")?"ogg":"webm";
    $("micReplay").disabled=$("micSave").disabled=false;message("录音已就绪。可回放、保存，或听原声对照。");
    ui.layoutChanged?.();
   };
   current.onerror=()=>{stop();message("录音中断，请检查麦克风是否被占用后重试。")};
   current.start(200);started=Date.now();$("practiceTime").textContent="00:00";state(true);message("正在录音 · 最长90秒");
   timer=window.setInterval(()=>{const sec=Math.floor((Date.now()-started)/1000);$("practiceTime").textContent=String(Math.floor(sec/60)).padStart(2,"0")+":"+String(sec%60).padStart(2,"0");if(sec>=90)stop()},200);
  }catch(e){
   if(mine!==epoch)return;requesting=false;release();state(false);
   const name=(e as Error).name;message(name==="NotAllowedError"?"麦克风未获允许。请在地址栏的网站权限中允许麦克风，然后重试。":name==="NotFoundError"?"没有检测到麦克风。":name==="NotReadableError"?"无法使用麦克风，可能被其他程序占用。":(e as Error).message);
  }
 }
 $("micStart").onclick=()=>void start();$("micStop").onclick=stop;
 $("micReplay").onclick=()=>{pause();audio.currentTime=0;void audio.play().catch(()=>message("请使用录音播放器的播放按钮。"))};
 $("micOriginal").onclick=()=>{stop();pauseAudio();void reference(recordedCue||cue).catch((e:Error)=>message(e.message))};
 $("micSave").onclick=()=>{if(!url)return;const a=document.createElement("a");a.href=url;a.download="日语跟读-"+Math.floor(recordedCue?.start||0)+"s."+extension;a.click()};
 $("practiceClose").onclick=()=>{stop();pauseAudio();$("practice").hidden=true;ui.layoutChanged?.()};
 return {open(c:any){
  if(cue&&(cue.start!==c.start||cue.end!==c.end||cue.text!==c.text))clear();
  cue={...c};$("practiceCue").textContent=c.text;$("practice").hidden=false;ui.reveal();ui.layoutChanged?.();
 },clear,stop};
}
