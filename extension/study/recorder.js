/* MIT — microphone-only local practice. No network or automatic grading. */
const $=id=>document.getElementById(id), id=new URL(location.href).searchParams.get("session");
let recorder=null,stream=null,blob=null,url=null,timer=null,started=0,loading=false;
const state=text=>{$("status").textContent=text};
const release=()=>{stream?.getTracks().forEach(t=>t.stop());stream=null;clearTimeout(timer)};
async function reference(command="play"){
  const r=await chrome.runtime.sendMessage({action:"studyReference",id,command});
  if(!r?.success)throw new Error(r?.error||"原视频已关闭或切换，请重新打开练习");
}
chrome.runtime.sendMessage({action:"studyRecorderSession",id}).then(r=>{
  if(!r?.session)throw new Error("练习会话已失效，请回到 B站重新点跟读");
  $("reference").textContent=r.session.cue.text;
}).catch(e=>{state(e.message);$("start").disabled=true;$("original").disabled=true});
$("original").onclick=async()=>{try{if(recorder?.state==="recording")return state("请先停止录音再播放原声");await reference();state("原声正在原 B站页播放，句尾会暂停。")}catch(e){state(e.message)}};
$("start").onclick=async()=>{
 if(loading||recorder?.state==="recording")return;loading=true;$("start").disabled=true;
 try{
  // Pause the original before microphone acquisition to avoid recording speaker playback.
  const paused=await chrome.runtime.sendMessage({action:"studyReference",id,command:"pause"});if(!paused?.success)throw new Error(paused?.error||"原视频已切换，请重新打开练习");
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
  if(!window.MediaRecorder)throw new Error("此浏览器不支持 MediaRecorder");
  const mime=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":"";
  recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});
  const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  recorder.onerror=e=>{state("录音出错："+(e.error?.message||"设备异常"));release();$("start").disabled=false;$("stop").disabled=true};
  recorder.onstop=()=>{
    const type=recorder.mimeType||"audio/webm";
    blob=new Blob(chunks,{type});if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);
    $("audio").src=url;$("audio").hidden=false;$("save").disabled=!blob.size;
    release();$("start").disabled=false;$("stop").disabled=true;
    state(blob.size?"已录制 "+Math.round((Date.now()-started)/1000)+" 秒。可回放，与原声对照；未进行发音评分。":"没有收到音频数据，请检查麦克风后重录。");
  };
  recorder.start(250);started=Date.now();$("stop").disabled=false;state("正在录音…最长 90 秒。");timer=setTimeout(()=>recorder?.state==="recording"&&recorder.stop(),90000);
 }catch(e){release();$("start").disabled=false;state(e.name==="NotAllowedError"?"麦克风权限未获允许。请在此扩展页面允许麦克风后重试；字幕功能不受影响。":"无法录音："+e.message)}
 finally{loading=false}
};
$("stop").onclick=()=>{if(recorder?.state==="recording")recorder.stop()};
$("save").onclick=async()=>{
 if(!blob)return;const name="日语跟读-"+new Date().toISOString().replace(/[:.]/g,"-")+".webm";
 try{
  if(window.showSaveFilePicker){const handle=await showSaveFilePicker({suggestedName:name,types:[{description:"WebM 录音",accept:{"audio/webm":[".webm"]}}]});const w=await handle.createWritable();await w.write(blob);await w.close();state("录音已保存。")}
  else{const a=document.createElement("a");a.href=url;a.download=name;a.click();state("录音已交给浏览器下载，请按浏览器设置选择 E 盘保存位置。")}
 }catch(e){if(e.name!=="AbortError")state("保存失败："+e.message)}
};
addEventListener("pagehide",()=>{if(recorder?.state==="recording")recorder.stop();release();if(url)URL.revokeObjectURL(url)});
