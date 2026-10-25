// @ts-nocheck
// Opt-in Japanese learning shell. Upstream automatic content entry is not loaded.
import { getJapaneseCc } from "./cc-source.js";
import { createBoundedAsrController, requestStudyAudioWindow } from "./bounded-asr.js";
import { getNativeStudySource, sameNativeBinding } from "./native-source.js";
(()=>{
 if(document.getElementById("biliscript-japanese-study"))return;
 const host=document.createElement("div");host.id="biliscript-japanese-study";
 const shadow=host.attachShadow({mode:"open"}),css=document.createElement("link");
 css.rel="stylesheet";css.href=chrome.runtime.getURL("study/ui.css");shadow.append(css);
 const wrap=document.createElement("div");wrap.className="fold";
 wrap.innerHTML='<button id="show">开始日语学习</button><section class="panel"><header class="head"><strong>BiliScript 日语</strong><button id="enable">开启学习</button><button id="settings" title="设置">⚙</button><button id="fold" title="收起">－</button></header><div id="body"><p id="status" role="status">学习已关闭。不抓字幕、音频或调用翻译。</p><div class="tools"><button id="reload">重新取字幕</button><button id="import">导入 SRT/VTT</button><button id="export">导出</button></div><select id="track" aria-label="日语字幕轨"><option value="">自动选择日语</option></select><p id="source" class="hint">日文 CC 优先；无日文轨时按30秒片本地识别，最多提前约60秒。</p><div class="topline"><span id="position">未载入</span><label>偏移 <input id="offset" type="number" step=".1" value="0" style="width:65px"> 秒</label></div><div class="card"><div id="current">开启后显示日语字幕</div><div id="chinese"></div><div class="tools"><button id="prev">← 上句</button><button id="pause">暂停</button><button id="replay">▶ 重播</button><button id="next">下句 →</button><button id="loop" aria-pressed="false">循环：关</button></div><div class="tools"><button id="translate">译这一句</button><button id="explain">本句讲解</button><button id="paragraph">这段讲解</button><button id="record">● 跟读</button></div></div><div class="tools"><button id="dictImport">导入中文词典 JSON</button><button id="dictExample">格式示例</button></div><div id="detail" class="hint">本地日语分词提供读音与原形。中文词义来自40词基础词表、导入词典或按需AI；本版没有发音评分。</div><div id="rows"></div><input id="subtitleFile" type="file" accept=".srt,.vtt"><input id="dictFile" type="file" accept=".json"></div></section>';
 shadow.append(wrap);document.documentElement.append(host);
 const $=id=>shadow.getElementById(id),send=m=>chrome.runtime.sendMessage(m);
 let enabled=false,generation=0,route="",identity="",clip=null,cues=[],chinese=[],selected=0,active=-1,offset=0,video=null,player=null,abort=null,settings={autoStart:false,autoTranslate:true,configured:false};
 let tokenizer=null,tokenPromise=null,words={},basic={},overlay=null,overlayRoot=null,overlaySignature="",panelText="",loading=false,aiBusy=false,automaticBusy=false,waiting=false,resumeAfter=false,asrMode=false,lookupId="";
 const translations=new Map(),attempted=new Set();
 let recognizedWindows=[],asrError=false,aiEpoch=0,automaticFailed=false,nativeMode=false,nativeSession=null,nativeSeekEpoch=0;
 const windowReady=time=>recognizedWindows.some(w=>time>=w.start&&time<w.end);
 const status=(text,error=false)=>{$("status").textContent=text;$("status").classList.toggle("error",error)};
 const currentRoute=()=>JSTUDY.keyOf(JSTUDY.resource(location.href));
 const cueKey=c=>c.start.toFixed(2)+":"+c.end.toFixed(2)+":"+c.text;
 const safe=fn=>Promise.resolve().then(fn).catch(e=>{if(e.name!=="AbortError")status(e.message||String(e),true)});
 function loopOff(){player?.clear();$("loop").textContent="循环：关";$("loop").classList.remove("on");$("loop").setAttribute("aria-pressed","false")}
 function guard(){if(!enabled)throw new Error("请先开启当前视频的学习");if(!cues.length)throw new Error("当前时刻字幕尚未就绪，请等待本地识别或导入字幕");if(!video)throw new Error("找不到视频播放器");return cues[selected]}
 const shifted=c=>({...c,start:Math.max(0,c.start+offset),end:Math.max(.01,c.end+offset)});
 function nativeLive(n){return enabled&&currentRoute()===route&&n&&n.binding.routeKey===route&&video?.isConnected&&video.getAttribute("data-biliscript-study-binding")===n.binding.videoTag&&video.currentSrc===n.binding.mediaSrc}
 async function verifyNativeWindow(payload,signal,expected){
  if(signal.aborted||!nativeLive(expected)||nativeSession!==expected)throw new DOMException("播放资源已更新","AbortError");
  const fresh=await getNativeStudySource();
  if(signal.aborted||!nativeLive(expected)||nativeSession!==expected)throw new DOMException("播放资源已更新","AbortError");
  if(fresh.status!=="ready"||!sameNativeBinding(fresh.binding,expected.binding)||fresh.bvid!==payload.bvid||fresh.cid!==payload.cid||fresh.source.url!==payload.audio_url||payload.start+payload.duration>fresh.playableDuration)throw new Error("当前音轨关联或可播放范围已改变，请重新开启学习。");
 }
 function startNative(n){
  nativeMode=true;nativeSession=n;nativeSeekEpoch++;clip={bvid:n.bvid,cid:n.cid,title:n.title};identity=n.bvid+":"+n.cid;cues=[];chinese=[];selected=0;active=-1;recognizedWindows=[];asrError=false;asrMode=true;
  $("source").textContent="当前播放器实际音轨 · "+n.title+(n.audit.previewSeconds!==null?" · 仅页面试看"+n.playableDuration+"秒":n.audit.accessScope==="initial-window"?" · 未确认整片可播，仅识别前"+n.playableDuration+"秒":"");
  waitForCurrent();
  asr.start({enabled:true,bvid:n.bvid,cid:n.cid,currentTime:video?.currentTime||0,duration:n.duration,language:"ja",model:settings.asrModel||"small",resourceId:identity,validatedAudioSource:n.source,playableDuration:n.playableDuration});
 }
 async function nativeSeek(){
  const seekId=++nativeSeekEpoch,mine=generation;asr.stop();nativeSession=null;recognizedWindows=[];asrError=false;waitForCurrent();
  const fresh=await getNativeStudySource();
  if(!enabled||!nativeMode||mine!==generation||seekId!==nativeSeekEpoch||currentRoute()!==route)return;
  if(fresh.status!=="ready"||fresh.bvid+":"+fresh.cid!==identity||!nativeLive(fresh)){waiting=false;resumeAfter=false;asrError=true;status(fresh.message||"跳转后音轨尚未重新关联，请播放几秒后重新开启学习。",true);return;}
  startNative(fresh);
 }
 const asr=createBoundedAsrController({
  async requestWindow(payload,signal){
   const expected=nativeSession;
   if(nativeMode){if(!expected)throw new DOMException("正在重验音轨","AbortError");await verifyNativeWindow(payload,signal,expected);}
   const result=await requestStudyAudioWindow(payload,signal);
   if(expected)await verifyNativeWindow(payload,signal,expected);
   return result;
  },
  onCues(items,meta){
   if(currentRoute()!==route){reset(currentRoute());return;}
   if(!enabled||meta.resourceId!==identity||nativeMode&&!nativeLive(nativeSession))return;
   recognizedWindows.push({start:meta.windowStart,end:meta.windowStart+meta.duration});
   const combined=[...cues,...JSTUDY.normalize(items)],unique=new Map();
   combined.forEach(c=>unique.set(cueKey(c),c));cues=[...unique.values()].sort((a,b)=>a.start-b.start);
   updateAtTime(true);
   if(waiting&&video&&windowReady(video.currentTime)){
    waiting=false;if(JSTUDY.at(cues,video.currentTime-offset)<0)$("current").textContent="当前时刻没有识别到台词。";status("当前片段日语字幕已就绪。");
    if(resumeAfter){resumeAfter=false;video.play().catch(()=>status("字幕已就绪，请点视频播放。"))}
   }
  },
  onStatus(event){if(currentRoute()!==route){reset(currentRoute());return;}if(!enabled)return;if(event.phase==="error"){if(nativeMode)asr.stop();asrError=true;waiting=false;resumeAfter=false;status(event.message,true)}else if(event.phase!=="disabled")status(event.message)}
 });
 function bindVideo(){
  const list=[...document.querySelectorAll("video")].map(v=>({v,r:v.getBoundingClientRect()})).filter(x=>x.r.width>50&&x.r.height>50).sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height);
  const v=list[0]?.v||document.querySelector("video");
  if(v===video)return;
  player?.clear();video=v;player=v?new JSTUDY.Player(v):null;
  if(v)v.addEventListener("seeking",()=>{
   if(v!==video||!enabled)return;
   const owned=v.__biliscriptOwnedSeek;
   if(owned&&owned.until>=Date.now()&&Math.abs(v.currentTime-owned.time)<.4){updateAtTime(true);return;}
   aiEpoch++;automaticBusy=false;send({type:"study-stop-ai"}).catch(()=>{});
   loopOff();active=-1;if(asrMode){asrError=false;if(nativeMode)safe(nativeSeek);else asr.seek(v.currentTime);waitForCurrent()}updateAtTime(true);
  });
 }
 function waitForCurrent(){
  if(!video||video.ended||asrError)return;
  if(nativeMode&&nativeSession&&video.currentTime>=nativeSession.playableDuration){
   waiting=false;resumeAfter=false;asrError=true;asr.stop();clearOverlay();status("已到当前页面允许的识别范围（前"+nativeSession.playableDuration+"秒）。可继续原视频播放，跳回允许范围后重新练习。");return;
  }
  if(windowReady(video.currentTime))return;
  if(!waiting)resumeAfter=!video.paused;waiting=true;video.pause();
  $("current").textContent="当前时刻字幕准备中…";$("chinese").textContent="";clearOverlay();status("正在准备当前30秒片段。起播/跳转需要等待，不会把缓冲进度当成音频。");
 }
 function clearOverlay(){overlay?.remove();overlay=null;overlayRoot=null;overlaySignature=""}
 function stop(reason="学习已关闭。字幕、音频和后续翻译任务已停止。"){
  enabled=false;generation++;aiEpoch++;nativeMode=false;nativeSession=null;nativeSeekEpoch++;abort?.abort();abort=null;asr.stop();send({type:"study-stop-ai"}).catch(()=>{});loopOff();waiting=false;resumeAfter=false;asrMode=false;recognizedWindows=[];asrError=false;automaticFailed=false;loading=false;aiBusy=false;automaticBusy=false;
  clearOverlay();$("enable").textContent="开启学习";$("show").textContent="开始日语学习";$("enable").classList.remove("on");status(reason);
 }
 function reset(next){
  stop("已换视频，学习默认关闭。");route=next;identity="";clip=null;cues=[];chinese=[];selected=0;active=-1;offset=0;$("offset").value="0";translations.clear();attempted.clear();panelText="";
  $("rows").replaceChildren();$("current").textContent="开启后显示日语字幕";$("chinese").textContent="";$("position").textContent="未载入";$("track").replaceChildren(new Option("自动选择日语",""));
  if(settings.autoStart&&next)safe(()=>start());
 }
 async function start(preferredTrackId=""){
  if(enabled&&loading)return;
  stop();enabled=true;const mine=++generation;abort=new AbortController();loading=true;
  $("enable").textContent="停止学习";$("enable").classList.add("on");$("show").textContent="学习中 · 展开";wrap.classList.remove("fold");bindVideo();
  status("学习已开启，正在获取当前视频的日文字幕…");
  let nativeFallback=null;
  try{
   const publicSettings=await send({type:"study-settings-public"});if(mine!==generation||!enabled)return;settings={...settings,...publicSettings?.config};
   const savedKey="biliscript-study-import:"+route;
   const saved=(await chrome.storage.local.get(savedKey))[savedKey];if(mine!==generation||!enabled)return;
   if(saved&&!preferredTrackId){identity=saved.identity||route;cues=JSTUDY.normalize(saved.cues);offset=saved.offset||0;$("offset").value=offset;$("source").textContent="本视频手动导入："+saved.name;updateAtTime(true);status("已恢复本视频导入的日文字幕。");return;}
   const native=await getNativeStudySource();nativeFallback=native;
   if(mine!==generation||!enabled||currentRoute()!==route)return;
   if(!preferredTrackId&&native.status==="ready"&&native.subtitleListPresent&&native.japaneseTrackCount===0&&nativeLive(native)){
    startNative(native);return;
   }
   const result=await getJapaneseCc({signal:abort.signal,preferredTrackId,includeChinese:true,onStatus:text=>{if(enabled&&mine===generation)status(text)}});
   if(mine!==generation||!enabled)return;
   clip=result;identity=result.bvid+":"+result.cid;
   $("track").replaceChildren(new Option("自动选择日语",""),...result.tracks.filter(t=>/^(?:ai-)?(?:ja|jp)(?:-|$)/i.test(t.lang||t.lan||"")).map(t=>new Option(t.label||t.langLabel||t.lanDoc||t.lang||t.lan,String(t.id||t.trackId||""))));
   $("track").value=result.selectedTrackId||"";
   if(result.status==="ready"){
    cues=JSTUDY.normalize(result.cues);chinese=JSTUDY.normalize(result.chineseCues||[]);
    $("source").textContent="B站日文文本轨 · "+result.title;updateAtTime(true);status("日文字幕已就绪，播放器内显示原文及已有中文/按需译文。");
   }else{
    if(native.status==="ready"&&native.bvid===result.bvid&&native.cid===result.cid&&nativeLive(native)){startNative(native);return;}
    if(native.status==="unavailable"&&["PREVIEW_END","PREVIEW_UNKNOWN"].includes(native.reason))throw new Error(native.message);
    asrMode=true;$("source").textContent="本地 Whisper · "+result.title;waitForCurrent();
    asr.start({enabled:true,bvid:result.bvid,cid:result.cid,currentTime:video?.currentTime||0,duration:Number.isFinite(video?.duration)?video.duration:undefined,language:"ja",model:settings.asrModel||"small",resourceId:identity});
   }
  }catch(e){if(enabled&&mine===generation&&e.name!=="AbortError")status(nativeFallback?.reason==="NO_PLAYED_AUDIO"?"尚未关联当前音轨。请先正常播放几秒，再点“重新取字幕”。":nativeFallback?.reason==="NO_MARKER"?"请刷新视频页后重新开启学习。":e.message,true)}
  finally{if(mine===generation)loading=false}
 }
 const fmt=t=>Math.floor(t/60)+":"+String(Math.floor(t%60)).padStart(2,"0");
 function chineseFor(c){return translations.get(cueKey(c))||JSTUDY.paired(c,chinese)||""}
 function display(i,force=false){
  if(!cues.length)return;selected=Math.max(0,Math.min(cues.length-1,i));const c=cues[selected];
  $("position").textContent=(selected+1)+" / "+cues.length+" · "+fmt(c.start);$("chinese").textContent=chineseFor(c);
  if(force||panelText!==cueKey(c)){panelText=cueKey(c);$("current").textContent=c.text;renderTokens(c,$("current"));renderRows();}
 }
 function renderRows(){
  const from=Math.max(0,selected-6);$("rows").replaceChildren();
  cues.slice(from,from+16).forEach((c,j)=>{const b=document.createElement("button");b.className="cue"+(from+j===selected?" active":"");b.textContent=fmt(c.start)+" "+c.text;b.onclick=()=>safe(async()=>{guard();loopOff();display(from+j);player.seekPause(shifted(c))});$("rows").append(b)});
 }
 async function getTokenizer(){
  if(tokenPromise)return tokenPromise;
  tokenPromise=new Promise((resolve,reject)=>kuromoji.builder({dicPath:chrome.runtime.getURL("study/dict/")}).build((error,t)=>{if(error){tokenPromise=null;reject(new Error("本地日语词典载入失败，请重新加载扩展"))}else{tokenizer=t;resolve(t)}}));return tokenPromise;
 }
 function tokenElement(token,overlayStyle=false){
  const b=document.createElement("button");b.className=overlayStyle?"jp-word":"token";const ruby=document.createElement("ruby");ruby.textContent=token.surface_form;
  const reading=JSTUDY.hiragana(token.reading);if(reading&&reading!==token.surface_form){const rt=document.createElement("rt");rt.textContent=reading;ruby.append(rt)}b.append(ruby);b.onclick=e=>{e.stopPropagation();lookup(token)};return b;
 }
 async function renderTokens(c,target){
  const mine=generation;try{const t=await getTokenizer();if(!enabled||mine!==generation||cues[selected]?.text!==c.text)return;target.replaceChildren(...t.tokenize(c.text).map(token=>tokenElement(token)));overlaySignature="";}
  catch(e){if(enabled&&mine===generation)status(e.message,true)}
 }
 function lookup(token){
  if(!enabled)return;video?.pause();wrap.classList.remove("fold");lookupId=token.surface_form;
  const lemma=token.basic_form&&token.basic_form!=="*"?token.basic_form:token.surface_form,entry=words[lemma]||words[token.surface_form]||basic[lemma]||basic[token.surface_form];
  $("detail").replaceChildren();
  const div=document.createElement("div");div.textContent=[token.surface_form+" "+JSTUDY.hiragana(token.reading||entry?.reading||""),"原形："+lemma+" · "+token.pos,JSTUDY.conjugation(token),entry?"中文："+(typeof entry==="string"?entry:entry.meaning)+" ["+(words[lemma]||words[token.surface_form]?"导入词典":"基础词表")+"]":"本地中文词典未命中；读音与原形来自 IPADIC。"].filter(Boolean).join("\n");$("detail").append(div);
  const button=document.createElement("button");button.textContent="AI 词义与变形（按需）";button.onclick=()=>safe(()=>ask("word",token.surface_form));$("detail").append(button);
 }
 function updateOverlay(i){
  if(!enabled||i<0||!video){clearOverlay();return;}
  const c=cues[i],zh=chineseFor(c);
  const container=document.fullscreenElement&&document.fullscreenElement.tagName!=="VIDEO"?document.fullscreenElement:video.closest(".bpx-player-container,.bilibili-player,.html5-video-player")||video.parentElement;
  if(!container)return;
  const signature=cueKey(c)+"|"+zh+"|"+!!tokenizer;
  if(overlay?.parentElement!==container){clearOverlay();overlay=document.createElement("div");overlay.id="biliscript-study-overlay";Object.assign(overlay.style,{position:"absolute",left:"5%",right:"5%",bottom:"12%",zIndex:"2147483645",pointerEvents:"none"});overlayRoot=overlay.attachShadow({mode:"open"});container.append(overlay);}
  if(signature===overlaySignature)return;overlaySignature=signature;
  overlayRoot.replaceChildren();
  const style=document.createElement("style");style.textContent='*{box-sizing:border-box}.ja,.zh{text-align:center;line-height:1.65;color:white;text-shadow:1px 1px 3px #000,-1px -1px 3px #000,0 2px 8px #000;font-family:system-ui,"Meiryo",sans-serif;font-weight:600}.ja{font-size:clamp(20px,2.1vw,34px)}.zh{font-size:clamp(17px,1.5vw,26px)}.jp-word{display:inline;border:0;background:transparent;color:inherit;font:inherit;text-shadow:inherit;padding:0 2px;pointer-events:auto;cursor:pointer;border-radius:5px}.jp-word:hover{background:#174d35c9}rt{font-size:.4em;font-weight:400}';
  const ja=document.createElement("div");ja.className="ja";if(tokenizer)ja.append(...tokenizer.tokenize(c.text).map(token=>tokenElement(token,true)));else ja.textContent=c.text;
  const translation=document.createElement("div");translation.className="zh";translation.textContent=zh;overlayRoot.append(style,ja,translation);
 }
 async function requestAI(kind,text,index=selected){
  const c=cues[index];if(!enabled||!c)return null;const mine=generation,epoch=aiEpoch,resource=identity||route,context=JSTUDY.context(cues,index);
  const result=await send({type:"study-ai",kind,text:text||c.text,context,resource,requestId:crypto.randomUUID()});
  if(currentRoute()!==route){reset(currentRoute());return null;}if(!enabled||mine!==generation||epoch!==aiEpoch)return null;if(!result?.ok){if(result?.canceled)return null;throw new Error(result?.error||"文字接口未完成请求");}return result;
 }
 async function ask(kind,text){
  const c=guard();if(aiBusy)return;aiBusy=true;const mine=generation,index=selected;status("正在请求 "+(kind==="translate"?"中文翻译":"中文讲解")+"…");
  try{
   const r=await requestAI(kind,text,index);if(!r)return;
   if(kind==="translate"){translations.set(cueKey(c),r.text);display(selected);overlaySignature=""}
   else if(selected===index&&(kind!=="word"||lookupId===text))$("detail").textContent=(kind==="word"?"AI 词义参考\n":"AI 句段讲解\n")+r.text;
   status(r.fromCache?"已使用本地解释缓存。":"已取得接口结果。");
  }finally{if(mine===generation)aiBusy=false}
 }
 async function autoTranslate(i){
  if(!enabled||automaticBusy||automaticFailed||!settings.autoTranslate||!settings.configured||i<0)return;
  const candidates=[i,i+1].filter(x=>cues[x]&&!chineseFor(cues[x])&&!attempted.has(cueKey(cues[x])));
  if(!candidates.length)return;automaticBusy=true;const mine=generation,epoch=aiEpoch;
  try{for(const index of candidates){
   if(!enabled||mine!==generation||epoch!==aiEpoch||currentRoute()!==route)break;
   const nowIndex=JSTUDY.at(cues,video.currentTime-offset);if(nowIndex<0||index<nowIndex||index>nowIndex+1)break;
   const c=cues[index],key=cueKey(c);attempted.add(key);
   try{const r=await requestAI("translate",undefined,index);if(r){translations.set(key,r.text);display(selected);overlaySignature=""}}
   catch(e){if(enabled&&mine===generation&&epoch===aiEpoch){automaticFailed=true;status(e.message,true);}break;}
  }}finally{if(mine===generation&&epoch===aiEpoch)automaticBusy=false}
 }
 function updateAtTime(force=false){
  if(!enabled||!video)return;
  const i=JSTUDY.at(cues,video.currentTime-offset);
  if(i>=0&&(i!==active||force)){active=i;display(i,force);}
  updateOverlay(i);if(i>=0)void autoTranslate(i);
 }
 function download(name,text,type="text/plain"){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
 $("enable").onclick=()=>{if(enabled)stop();else safe(()=>start())};
 $("show").onclick=()=>{wrap.classList.remove("fold");if(!enabled)safe(()=>start())};
 $("fold").onclick=()=>wrap.classList.add("fold");
 $("settings").onclick=()=>send({type:"study-open-options"});
 $("reload").onclick=()=>safe(()=>start($("track").value));
 $("track").onchange=()=>safe(()=>start($("track").value));
 $("offset").onchange=()=>safe(async()=>{guard();const n=Number($("offset").value);if(!Number.isFinite(n)||Math.abs(n)>3600)throw new Error("偏移请在±3600秒内");offset=n;loopOff();active=-1;updateAtTime(true)});
 $("prev").onclick=()=>safe(async()=>{guard();loopOff();display(selected-1);player.seekPause(shifted(cues[selected]))});
 $("next").onclick=()=>safe(async()=>{guard();loopOff();display(selected+1);player.seekPause(shifted(cues[selected]))});
 $("pause").onclick=()=>safe(async()=>{guard();video.pause()});
 $("replay").onclick=()=>safe(async()=>{const c=guard();loopOff();await player.play(shifted(c));status("播放到本句结束后暂停。")});
 $("loop").onclick=()=>safe(async()=>{const c=guard();if(player.mode==="loop"){loopOff();return;}await player.play(shifted(c),true);$("loop").classList.add("on");$("loop").textContent="循环：开";$("loop").setAttribute("aria-pressed","true")});
 $("translate").onclick=()=>safe(()=>ask("translate"));
 $("explain").onclick=()=>safe(()=>ask("explain"));
 $("paragraph").onclick=()=>safe(()=>ask("explain",JSTUDY.context(cues,selected)));
 $("record").onclick=()=>safe(async()=>{const c=guard();loopOff();video.pause();const r=await send({action:"studyOpenRecorder",resource:identity||route,cue:shifted(c)});if(!r?.success)throw new Error(r?.error||"无法打开录音页")});
 $("import").onclick=()=>safe(async()=>{if(!enabled)throw new Error("请先开启学习");$("subtitleFile").click()});
 $("subtitleFile").onchange=()=>safe(async()=>{
  const f=$("subtitleFile").files[0];if(!f)return;if(f.size>5*1024*1024)throw new Error("字幕不能超过5MB");const mine=generation;
  const parsed=JSTUDY.parseSubtitle(await f.text());if(!enabled||mine!==generation)return;
  asr.stop();abort?.abort();asrMode=false;nativeMode=false;nativeSession=null;nativeSeekEpoch++;loopOff();cues=parsed;chinese=[];identity=identity||route;translations.clear();attempted.clear();
  await chrome.storage.local.set({["biliscript-study-import:"+route]:{identity,cues,name:f.name,offset}});
  $("source").textContent="手动导入："+f.name;display(0,true);status("已导入真实时间轴日文字幕。");$("subtitleFile").value="";
 });
 $("export").onclick=()=>safe(async()=>{guard();download(route.replace(":","-")+".txt",cues.map(c=>fmt(c.start)+" "+c.text+"\n"+chineseFor(c)).join("\n\n"))});
 $("dictImport").onclick=()=>$("dictFile").click();
 $("dictExample").onclick=()=>download("日中词典格式示例.json",JSON.stringify({"食べる":{reading:"たべる",meaning:"吃"}},null,2),"application/json");
 $("dictFile").onchange=()=>safe(async()=>{
  const f=$("dictFile").files[0];if(!f)return;if(f.size>4*1024*1024)throw new Error("词典不能超过4MB");const d=JSON.parse(await f.text());
  if(!d||Array.isArray(d)||typeof d!=="object")throw new Error("请导入以原形为键的JSON对象");
  const valid=Object.fromEntries(Object.entries(d).filter(([k,v])=>k.length<100&&(typeof v==="string"&&v.length<3000||v&&typeof v.meaning==="string"&&v.meaning.length<3000)));
  if(!Object.keys(valid).length)throw new Error("没有有效词条");await chrome.storage.local.set({biliscriptStudyDictionary:valid});words=valid;status("已导入 "+Object.keys(valid).length+" 条中文词义。");$("dictFile").value="";
 });
 chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m?.type==="study-toggle"){if(enabled){wrap.classList.remove("fold")}else safe(()=>start());reply({ok:true});return false;}
  if(m?.action!=="studyPlayReference")return;
  if(!enabled||m.resource!==(identity||route)){reply({success:false,error:"学习已关闭或原视频已切换"});return false}
  (async()=>{bindVideo();if(!video)throw new Error("找不到原视频");loopOff();if(m.command==="pause")video.pause();else await player.play(m.cue);return {success:true}})().then(reply).catch(e=>reply({success:false,error:e.message}));return true;
 });
 document.addEventListener("fullscreenchange",()=>{overlaySignature="";const e=document.fullscreenElement;if(e&&e.tagName!=="VIDEO")e.append(host);else document.documentElement.append(host);updateAtTime(true)});
 addEventListener("pagehide",()=>stop("页面已离开，学习已停止。"));
 chrome.storage.local.get("biliscriptStudyDictionary").then(x=>words=x.biliscriptStudyDictionary||{});
 fetch(chrome.runtime.getURL("study/basic-dictionary.json")).then(r=>r.json()).then(x=>basic=x).catch(()=>{});
 send({type:"study-settings-public"}).then(r=>{settings={...settings,...r?.config};if(settings.autoStart&&route&&!enabled)safe(()=>start())}).catch(()=>{});
 function sync(){
  const next=currentRoute();if(next!==route)reset(next);host.style.display=next?"block":"none";bindVideo();
  if(enabled&&nativeMode&&nativeSession&&!nativeLive(nativeSession)){stop("播放器资源已更新，已停止旧音轨任务。请重新开启学习。");return;}
  if(enabled){player?.tick();if(asrMode){asr.updateTime(video?.currentTime||0);if(!waiting&&!asrError)waitForCurrent()}updateAtTime();}
 }
 function frame(){if(enabled&&player?.mode)player.tick();requestAnimationFrame(frame)}
 setInterval(sync,250);requestAnimationFrame(frame);sync();
})();
