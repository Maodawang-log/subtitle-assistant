// Records only on a user click; blobs remain in this page and never upload.
export function createInlineRecorder(ui:any,reference:(cue:any)=>Promise<void>,pause:()=>void){
 const $=ui.$;let epoch=0,stream:MediaStream|null=null,recorder:MediaRecorder|null=null,timer=0,started=0,url="",cue:any=null,recordedCue:any=null,requesting=false,stopping=false,extension="webm";
 const message=(text:string)=>$("practiceStatus").textContent=text;
 const audio=$("micAudio") as HTMLAudioElement;
 const device=$("micDevice") as HTMLSelectElement|null,refreshButton=$("micDevices") as HTMLButtonElement|null;
 const preference='biliscriptStudyRecorder';let deviceId='',devicesKnown=false,stopNotice='';
 const storage=typeof chrome==='undefined'?undefined:chrome.storage?.local;
 const ready=storage?storage.get(preference).then(data=>{const saved=data[preference] as {deviceId?:unknown}|undefined;deviceId=typeof saved?.deviceId==='string'?saved.deviceId:''}).catch(()=>{}):Promise.resolve();
 const remember=()=>storage?.set({[preference]:{deviceId}}).catch(()=>message('设备选择暂未保存。'));
 const pauseAudio=()=>{if(audio.src)audio.pause()};
 const state=(active:boolean)=>{$("micStart").disabled=active||requesting||stopping;$("micStop").disabled=!active;if(device)device.disabled=active||requesting||stopping;if(refreshButton)refreshButton.disabled=active||requesting||stopping;ui.pin(active||requesting||stopping)};
 function release(){stream?.getTracks().forEach(t=>{t.onended=null;t.stop()});stream=null;clearInterval(timer)}
 async function enumerate(){
  if(!device||!navigator.mediaDevices?.enumerateDevices)return;
  const inputs=(await navigator.mediaDevices.enumerateDevices()).filter(item=>item.kind==='audioinput');
  device.replaceChildren(new Option('系统默认麦克风',''),...inputs.filter(item=>item.deviceId&&item.deviceId!=='default').map((item,index)=>new Option(item.label||'麦克风 '+(index+1),item.deviceId)));
  // Browsers may hide all devices before permission; do not erase a saved
  // choice until enumeration is informative or permission was just granted.
  if(deviceId&&!inputs.some(item=>item.deviceId===deviceId)&&(devicesKnown||inputs.some(item=>item.label))){deviceId='';remember();message('之前选择的麦克风已不可用，已改为系统默认；下次录音时使用。')}
  if(deviceId&&![...device.options].some(option=>option.value===deviceId))device.add(new Option('已保存的麦克风 · 授权后确认',deviceId));
  device.value=deviceId;
 }
 async function authorizeDevices(){
  if(requesting||stopping||recorder?.state==='recording')return;
  const mine=++epoch;requesting=true;state(false);let acquired:MediaStream|null=null;
  try{await ready;if(mine!==epoch||$("practice").hidden)return;acquired=await navigator.mediaDevices.getUserMedia({audio:true,video:false});if(mine!==epoch)return;devicesKnown=true;await enumerate();message('麦克风已授权。请选择设备，再点击开始录音。')}
  catch(e){if(mine===epoch)message((e as Error).name==='NotAllowedError'?'麦克风未获允许，可在网站权限中允许后重试。':'无法读取麦克风，请检查设备后重试。')}
  finally{acquired?.getTracks().forEach(track=>track.stop());if(mine===epoch){requesting=false;state(false)}}
 }
 if(device)device.onchange=()=>{deviceId=device.value;remember();message('已选择麦克风；点击开始录音才会录制。')};
 if(refreshButton)refreshButton.onclick=()=>void authorizeDevices();
 const devicesChanged=()=>{if(device)void enumerate().catch(()=>{})};navigator.mediaDevices?.addEventListener?.('devicechange',devicesChanged);
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
   await ready;if(mine!==epoch||$("practice").hidden)return;let fallback=false,acquired:MediaStream;
   try{acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,...(deviceId?{deviceId:{exact:deviceId}}:{})},video:false})}
   catch(e){if(mine!==epoch||$("practice").hidden)return;if(!deviceId||!['NotFoundError','OverconstrainedError'].includes((e as Error).name))throw e;deviceId='';remember();fallback=true;acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false})}
   if(mine!==epoch||$("practice").hidden){acquired.getTracks().forEach(t=>t.stop());return}
   stream=acquired;requesting=false;
   devicesKnown=true;void enumerate().catch(()=>{});
   const mime=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":"";
   const current=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks:BlobPart[]=[],captureCue={...cue};
   recorder=current;
   current.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
   current.onstop=()=>{
    if(recorder!==current)return;release();stopping=false;state(false);
    const blob=new Blob(chunks,{type:current.mimeType||"audio/webm"});chunks.length=0;
    if(!blob.size){message("没有录到声音数据，请重新录音。");return}
    if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);audio.src=url;audio.hidden=false;recordedCue=captureCue;extension=blob.type.includes("mp4")?"m4a":blob.type.includes("ogg")?"ogg":"webm";
    $("micReplay").disabled=$("micSave").disabled=false;message(stopNotice||"录音已就绪。可回放、保存，或听原声对照。");
    ui.layoutChanged?.();
   };
   current.onerror=()=>{stop();message("录音中断，请检查麦克风是否被占用后重试。")};
   stopNotice='';for(const track of stream.getTracks())track.onended=()=>{stopNotice='麦克风已断开，本段录音已保留；下次使用系统默认麦克风。';stop();deviceId='';remember();void enumerate().catch(()=>{});message(stopNotice)};
   current.start(200);started=Date.now();$("practiceTime").textContent="00:00";state(true);message((fallback?'所选设备不可用，已改用系统默认。':'')+"正在录音 · 最长90秒");
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
  void ready.then(enumerate).catch(()=>{});
 },
 setCurrent(c:any){if(c){cue={...c};$("practiceCue").textContent=c.text}},
 show(c:any){cue={...c};$("practiceCue").textContent=c.text;$("practice").hidden=false;ui.reveal();ui.layoutChanged?.();void ready.then(enumerate).catch(()=>{})},
 clear,stop};
}
