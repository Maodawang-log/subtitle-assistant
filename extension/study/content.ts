// @ts-nocheck
// Opt-in Japanese learning shell. Upstream automatic content entry is not loaded.
import { getJapaneseCc } from "./cc-source.js";
import { createBoundedAsrController, requestStudyAudioWindow } from "./bounded-asr.js";
import { getNativeStudySource, sameNativeBinding } from "./native-source.js";
import { createStudyShell } from "./ui-shell.js";
import { createInlineRecorder } from "./inline-recorder.js";
import { renderMarkdown } from "../ui/markdown.js";
(()=>{
 if(document.getElementById("biliscript-japanese-study"))return;
 const ui=createStudyShell(),{host,controls,shadow,wrap,$}=ui,send=m=>chrome.runtime.sendMessage(m);
 let enabled=false,generation=0,route="",identity="",clip=null,cues=[],chinese=[],selected=0,active=-1,offset=0,video=null,player=null,abort=null,settings={autoStart:false,autoTranslate:true,configured:false};
 let tokenizer=null,tokenPromise=null,words={},basic={},overlay=null,overlayRoot=null,overlaySignature="",panelText="",loading=false,aiBusy=false,automaticBusy=false,waiting=false,resumeAfter=false,asrMode=false,lookupId="";
 const translations=new Map(),attempted=new Set();
 let recognizedWindows=[],asrError=false,aiEpoch=0,automaticFailed=false,nativeMode=false,nativeSession=null,nativeSeekEpoch=0;
 let scopeWaiting=false,nativeRefreshPending=false,lastNativeCheck=0,vocabulary=[],lookupEpoch=0,followRows=true;
 const currentElement=$("current"),chineseElement=$("chinese");
 const recorder=createInlineRecorder(ui,async c=>{guard();loopOff();await player.play(c)},()=>{loopOff();video?.pause()});
 host.addEventListener("study-layout",()=>updateOverlay(video?JSTUDY.at(cues,video.currentTime-offset):-1));
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
 function startNative(n,preserve=false){
  asr.stop();nativeMode=true;nativeSession=n;nativeSeekEpoch++;clip={bvid:n.bvid,cid:n.cid,title:n.title};identity=n.bvid+":"+n.cid;
  if(!preserve){cues=[];chinese=[];selected=0;active=-1;recognizedWindows=[];}
  asrError=false;asrMode=true;scopeWaiting=false;
  $("source").textContent="当前播放器实际音轨 · "+n.title+(n.audit.previewSeconds!==null?" · 当前试看范围 "+n.playableDuration+" 秒":"");
  if((video?.currentTime||0)>=n.playableDuration){waitForCurrent();return}
  waitForCurrent();
  asr.start({enabled:true,bvid:n.bvid,cid:n.cid,currentTime:video?.currentTime||0,duration:n.duration,language:"ja",model:settings.asrModel||"small",resourceId:identity,validatedAudioSource:n.source,playableDuration:n.playableDuration});
 }
 async function nativeSeek(){
  const seekId=++nativeSeekEpoch,mine=generation;asr.stop();nativeSession=null;asrError=false;scopeWaiting=true;waiting=false;resumeAfter=false;
  const fresh=await getNativeStudySource();
  if(!enabled||!nativeMode||mine!==generation||seekId!==nativeSeekEpoch||currentRoute()!==route)return;
  if(fresh.status!=="ready"||fresh.bvid+":"+fresh.cid!==identity||!nativeLive(fresh)){status(fresh.message||"正在等待当前播放器重新关联音轨，可继续原视频播放。");return;}
  startNative(fresh,true);
 }
 async function refreshNativeScope(){
  if(nativeRefreshPending||Date.now()-lastNativeCheck<1500||!enabled||!nativeMode)return;
  nativeRefreshPending=true;lastNativeCheck=Date.now();const mine=generation,seekId=nativeSeekEpoch,old=nativeSession;
  try{
   const fresh=await getNativeStudySource();
   if(!enabled||!nativeMode||mine!==generation||seekId!==nativeSeekEpoch||currentRoute()!==route)return;
   if(fresh.status!=="ready"||fresh.bvid+":"+fresh.cid!==identity||!nativeLive(fresh))return;
   if(!old||!sameNativeBinding(fresh.binding,old.binding)||fresh.source.url!==old.source.url||fresh.playableDuration!==old.playableDuration||scopeWaiting&&video.currentTime<fresh.playableDuration){
    startNative(fresh,true);if(!scopeWaiting)status("已重新确认当前播放范围，继续准备后续字幕。");
   }
  }finally{nativeRefreshPending=false}
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
    waiting=false;status(JSTUDY.at(cues,video.currentTime-offset)<0?"当前片段字幕已就绪；此刻没有台词，可选择字幕句开始练习。":"当前片段日语字幕已就绪。");
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
  if(!video||video.ended||asrError||nativeMode&&!nativeSession)return;
  if(nativeMode&&nativeSession&&video.currentTime>=nativeSession.playableDuration){
   if(!scopeWaiting){asr.stop();clearOverlay();status("已到当前试看范围（"+nativeSession.playableDuration+"秒）。可继续原视频播放；范围解除后会自动恢复字幕。")}scopeWaiting=true;waiting=false;resumeAfter=false;return;
  }
  if(windowReady(video.currentTime))return;
  if(!waiting)resumeAfter=!video.paused;waiting=true;video.pause();
  $("current").textContent="当前时刻字幕准备中…";$("chinese").textContent="";clearOverlay();status("正在准备当前30秒片段。起播/跳转需要等待，不会把缓冲进度当成音频。");
 }
 function clearOverlay(){overlay?.remove();overlay=null;overlayRoot=null;overlaySignature=""}
 function stop(reason="学习已关闭。字幕、音频和后续翻译任务已停止。"){
  recorder.clear();ui.setEnabled(false);scopeWaiting=false;lookupEpoch++;
  enabled=false;generation++;aiEpoch++;nativeMode=false;nativeSession=null;nativeSeekEpoch++;abort?.abort();abort=null;asr.stop();send({type:"study-stop-ai"}).catch(()=>{});loopOff();waiting=false;resumeAfter=false;asrMode=false;recognizedWindows=[];asrError=false;automaticFailed=false;loading=false;aiBusy=false;automaticBusy=false;
  clearOverlay();$("enable").textContent="开启学习";$("show").textContent="开始日语学习";$("enable").classList.remove("on");status(reason);
 }
 function reset(next){
  stop("已换视频，学习默认关闭。");route=next;identity="";clip=null;cues=[];chinese=[];selected=0;active=-1;offset=0;$("offset").value="0";translations.clear();attempted.clear();panelText="";
  $("rows").replaceChildren(currentElement,chineseElement);currentElement.textContent="开启后显示日语字幕";chineseElement.textContent="";$("position").textContent="未载入";$("track").replaceChildren(new Option("自动选择日语",""));
  if(settings.autoStart&&next)safe(()=>start());
 }
 async function start(preferredTrackId=""){
  if(enabled&&loading)return;
  stop();enabled=true;const mine=++generation;abort=new AbortController();loading=true;
  $("enable").textContent="停止学习";$("enable").classList.add("on");$("show").textContent="学习中 · 展开";wrap.classList.remove("fold");bindVideo();ui.setEnabled(true);ui.mount(video);
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
  const rows=$("rows"),oldScroll=rows.scrollTop;rows.replaceChildren();
  cues.forEach((c,index)=>{
   const row=document.createElement("div");row.className="cue"+(index===selected?" active":"");row.dataset.index=index;
   const time=document.createElement("button");time.className="cue-time";time.textContent=fmt(c.start);time.title="选中并定位此句";
   time.onclick=()=>safe(async()=>{guard();loopOff();display(index);player.seekPause(shifted(c))});
   row.append(time);const text=document.createElement("div");text.className="cue-text";
   if(index===selected){text.append(currentElement,chineseElement);currentElement.textContent=c.text;chineseElement.textContent=chineseFor(c);renderTokens(c,currentElement)}
   else{const ja=document.createElement("div"),zh=document.createElement("div");ja.textContent=c.text;zh.className="cue-zh";zh.textContent=chineseFor(c);text.append(ja,zh);ja.onclick=()=>safe(async()=>{guard();loopOff();display(index);player.seekPause(shifted(c))})}
   row.append(text);rows.append(row);
  });
  rows.scrollTop=oldScroll;
  if(followRows){const row=rows.querySelector(".active");if(row&&row.offsetTop<rows.scrollTop||row&&row.offsetTop+row.offsetHeight>rows.scrollTop+rows.clientHeight)rows.scrollTop=Math.max(0,row.offsetTop-rows.clientHeight/3)}
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
 async function lookup(token){
  if(!enabled)return;video?.pause();ui.setPane("vocabulary");lookupId=token.surface_form;const mine=++lookupEpoch;
  const lemma=token.basic_form&&token.basic_form!=="*"?token.basic_form:token.surface_form,entry=words[lemma]||words[token.surface_form]||basic[lemma]||basic[token.surface_form];
  const target=$("wordDetail");target.replaceChildren();
  const title=document.createElement("h2");title.textContent=token.surface_form;
  const info=document.createElement("p");info.className="word-reading";info.textContent=[JSTUDY.hiragana(token.reading||entry?.reading||""),"原形："+lemma,token.pos,JSTUDY.conjugation(token)].filter(Boolean).join(" · ");
  const meaning=document.createElement("div");meaning.className="word-meaning";
  meaning.textContent=entry?(typeof entry==="string"?entry:entry.meaning)+"（"+(words[lemma]||words[token.surface_form]?"导入词典":"基础词表")+"）":"正在查本地词典…";
  const save=document.createElement("button");save.textContent="＋ 收藏生词";save.onclick=()=>safe(async()=>{const value={term:lemma,reading:JSTUDY.hiragana(token.reading),meaning:meaning.textContent,at:Date.now()};vocabulary=[value,...vocabulary.filter(x=>x.term!==lemma)].slice(0,1000);await chrome.storage.local.set({biliscriptStudyVocabulary:vocabulary});save.textContent="已收藏";renderVocabulary()});
  const button=document.createElement("button");button.textContent="AI 词义与变形";button.onclick=()=>safe(()=>ask("word",token.surface_form));
  target.append(title,info,meaning,save,button);
  try{
   const r=await send({type:"study-dictionary-lookup",queries:[lemma,token.surface_form,token.reading,JSTUDY.hiragana(token.reading)].filter(Boolean)});
   if(!enabled||mine!==lookupEpoch)return;
   if(r?.ok&&r.entries?.length){
    meaning.replaceChildren();
    for(const item of r.entries){const p=document.createElement("p"),label=document.createElement("strong");label.textContent=item.term+" · "+item.reading;const body=document.createElement("div");body.textContent=item.meaning;p.append(label,body);meaning.append(p)}
    const source=document.createElement("small");source.textContent="Jitendex 社区日中 · AI 译制 / 模型校订";meaning.append(source);
   }else if(!entry)meaning.textContent=r?.ok?"已安装的日中词典未命中，或尚未安装。可在设置中下载安装。":r?.error||"本地词典暂时不可用。";
  }catch{if(mine===lookupEpoch&&!entry)meaning.textContent="本地词典暂时不可用，请在设置中检查。"}
 }
 function renderVocabulary(){
  $("wordList").replaceChildren();
  for(const item of vocabulary){const card=document.createElement("div");card.className="saved-word";const title=document.createElement("strong");title.textContent=item.term+" "+item.reading;const meaning=document.createElement("p");meaning.textContent=item.meaning;const remove=document.createElement("button");remove.textContent="移除";remove.onclick=()=>safe(async()=>{vocabulary=vocabulary.filter(x=>x.term!==item.term);await chrome.storage.local.set({biliscriptStudyVocabulary:vocabulary});renderVocabulary()});card.append(title,remove,meaning);$("wordList").append(card)}
 }
 function updateOverlay(i){
  if(!enabled||i<0||!video){clearOverlay();return;}
  const c=cues[i],zh=chineseFor(c);
  const container=document.fullscreenElement&&document.fullscreenElement.tagName!=="VIDEO"?document.fullscreenElement:video.closest(".bpx-player-container,.bilibili-player,.html5-video-player")||video.parentElement;
  if(!container)return;
  const signature=cueKey(c)+"|"+zh+"|"+!!tokenizer;
  if(overlay?.parentElement!==container){clearOverlay();overlay=document.createElement("div");overlay.id="biliscript-study-overlay";Object.assign(overlay.style,{position:"absolute",left:"5%",right:"5%",bottom:"12%",zIndex:"2147483645",pointerEvents:"none"});overlayRoot=overlay.attachShadow({mode:"open"});container.append(overlay);}
  overlay.style.bottom=document.fullscreenElement?Math.min(innerHeight*.65,Math.max(innerHeight*.14,controls.getBoundingClientRect().height+95))+"px":"12%";
  overlay.style.right=document.fullscreenElement&&!host.hidden?Math.max(0,host.getBoundingClientRect().width+40)+"px":"5%";
  if(signature===overlaySignature)return;overlaySignature=signature;
  overlayRoot.replaceChildren();
  const style=document.createElement("style");style.textContent='*{box-sizing:border-box}.ja,.zh{text-align:center;line-height:1.65;color:white;text-shadow:1px 1px 3px #000,-1px -1px 3px #000,0 2px 8px #000;font-family:system-ui,"Meiryo",sans-serif;font-weight:600}.ja{font-size:clamp(20px,2.1vw,34px)}.zh{font-size:clamp(17px,1.5vw,26px)}.jp-word{display:inline;border:0;background:transparent;color:inherit;font:inherit;text-shadow:inherit;padding:0 2px;pointer-events:auto;cursor:pointer;border-radius:5px}.jp-word:hover{background:#174d35c9}rt{font-size:.4em;font-weight:400}';
  const ja=document.createElement("div");ja.className="ja";if(tokenizer)ja.append(...tokenizer.tokenize(c.text).map(token=>tokenElement(token,true)));else ja.textContent=c.text;
  const translation=document.createElement("div");translation.className="zh";translation.textContent=zh;overlayRoot.append(style,ja,translation);
 }
 async function requestAI(kind,text,index=selected,scope="sentence"){
  const c=cues[index];if(!enabled||!c)return null;const mine=generation,epoch=aiEpoch,resource=identity||route,context=JSTUDY.context(cues,index);
  const result=await send({type:"study-ai",kind,scope,text:text||c.text,context:scope==="context"?"":context,resource,requestId:crypto.randomUUID()});
  if(currentRoute()!==route){reset(currentRoute());return null;}if(!enabled||mine!==generation||epoch!==aiEpoch)return null;if(!result?.ok){if(result?.canceled)return null;throw new Error(result?.error||"文字接口未完成请求");}return result;
 }
 async function ask(kind,text,scope="sentence"){
  const c=guard();if(aiBusy)return;if(kind!=="translate")video.pause();aiBusy=true;const mine=generation,index=selected;status("正在请求 "+(kind==="translate"?"中文翻译":"中文讲解")+"…");
  if(kind==="explain"){ui.setPane("explanation");$("detailTitle").textContent=scope==="context"?"邻近几句讲解":"本句讲解";$("explainScope").textContent=scope==="context"?"当前句及前后各两句，最多五句":"只讲解当前选中句";$("detail").textContent="正在生成讲解…"}
  try{
   const r=await requestAI(kind,text,index,scope);if(!r)return;
   if(kind==="translate"){translations.set(cueKey(c),r.text);display(selected);overlaySignature=""}
   else if(selected===index&&(kind!=="word"||lookupId===text)){const target=kind==="word"?$("wordDetail"):$("detail");target.innerHTML=renderMarkdown(r.text);target.classList.add("markdown");if(r.warning){const warning=document.createElement("p");warning.className="error";warning.textContent=r.warning;target.prepend(warning)}if(kind==="explain")foldExplanation(target)}
   status(r.warning|| (r.fromCache?"已使用本地解释缓存。":"已取得接口结果。"),!!r.warning);
  }catch(e){if(kind==="explain"&&mine===generation)$("detail").textContent=e.message+" 点击讲解按钮可手动重试。";throw e}finally{if(mine===generation)aiBusy=false}
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
  if(nativeMode&&(!nativeSession||video.currentTime>=nativeSession.playableDuration)){clearOverlay();return}
  const i=JSTUDY.at(cues,video.currentTime-offset);
  if(i>=0&&(i!==active||force)){active=i;display(i,force);}
  else if(force&&i<0&&cues.length)display(selected,true);
  updateOverlay(i);if(i>=0)void autoTranslate(i);
 }
 function foldExplanation(target){
  // Keep translation and core grammar visible; details are explicitly expandable.
  for(const heading of [...target.querySelectorAll("h2,h3")]){
   if(!/词语|词汇|变形|上下文/.test(heading.textContent||""))continue;
   const details=document.createElement("details"),summary=document.createElement("summary");summary.textContent=heading.textContent;heading.before(details);details.append(summary);
   let next=heading.nextSibling;heading.remove();
   while(next&&!(next.nodeType===1&&/^H[123]$/.test(next.nodeName))){const following=next.nextSibling;details.append(next);next=following}
  }
 }
 function download(name,text,type="text/plain"){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}
 $("enable").onclick=()=>{if(enabled)stop();else safe(()=>start())};
 $("show").onclick=()=>{wrap.classList.remove("fold");if(!enabled)safe(()=>start())};
 $("stopStudy").onclick=()=>stop();
 $("follow").onclick=()=>{followRows=true;renderRows()};$("rows").addEventListener("wheel",()=>followRows=false,{passive:true});
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
 $("paragraph").onclick=()=>safe(()=>ask("explain",JSTUDY.context(cues,selected),"context"));
 $("record").onclick=()=>safe(async()=>{const c=guard();loopOff();video.pause();recorder.open(shifted(c))});
 $("import").onclick=()=>safe(async()=>{if(!enabled)throw new Error("请先开启学习");$("subtitleFile").click()});
 $("subtitleFile").onchange=()=>safe(async()=>{
  const f=$("subtitleFile").files[0];if(!f)return;if(f.size>5*1024*1024)throw new Error("字幕不能超过5MB");const mine=generation;
  const parsed=JSTUDY.parseSubtitle(await f.text());if(!enabled||mine!==generation)return;
  asr.stop();abort?.abort();asrMode=false;nativeMode=false;nativeSession=null;nativeSeekEpoch++;loopOff();cues=parsed;chinese=[];identity=identity||route;translations.clear();attempted.clear();
  await chrome.storage.local.set({["biliscript-study-import:"+route]:{identity,cues,name:f.name,offset}});
  $("source").textContent="手动导入："+f.name;display(0,true);status("已导入真实时间轴日文字幕。");$("subtitleFile").value="";
 });
 $("export").onclick=()=>safe(async()=>{guard();download(route.replace(":","-")+".txt",cues.map(c=>fmt(c.start)+" "+c.text+"\n"+chineseFor(c)).join("\n\n"))});
 $("exportWords").onclick=()=>download("日语生词.json",JSON.stringify(vocabulary,null,2),"application/json");
 chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m?.type==="study-toggle"){if(enabled){wrap.classList.remove("fold")}else safe(()=>start());reply({ok:true});return false;}
  if(m?.action!=="studyPlayReference")return;
  if(!enabled||m.resource!==(identity||route)){reply({success:false,error:"学习已关闭或原视频已切换"});return false}
  (async()=>{bindVideo();if(!video)throw new Error("找不到原视频");loopOff();if(m.command==="pause")video.pause();else await player.play(m.cue);return {success:true}})().then(reply).catch(e=>reply({success:false,error:e.message}));return true;
 });
 document.addEventListener("fullscreenchange",()=>{overlaySignature="";ui.mount(video);updateOverlay(video?JSTUDY.at(cues,video.currentTime-offset):-1)});
 addEventListener("pagehide",()=>stop("页面已离开，学习已停止。"));
 chrome.storage.local.get(["biliscriptStudyDictionary","biliscriptStudyVocabulary"]).then(x=>{words=x.biliscriptStudyDictionary||{};vocabulary=x.biliscriptStudyVocabulary||[];renderVocabulary()});
 chrome.storage.onChanged?.addListener((changes,area)=>{if(area==="local"&&changes.biliscriptStudyDictionary)words=changes.biliscriptStudyDictionary.newValue||{}});
 fetch(chrome.runtime.getURL("study/basic-dictionary.json")).then(r=>r.json()).then(x=>basic=x).catch(()=>{});
 send({type:"study-settings-public"}).then(r=>{settings={...settings,...r?.config};if(settings.autoStart&&route&&!enabled)safe(()=>start())}).catch(()=>{});
 function sync(){
  const next=currentRoute();if(next!==route)reset(next);bindVideo();ui.mount(video);if(!next){host.hidden=true;controls.hidden=true}
  if(enabled&&nativeMode&&nativeSession&&!nativeLive(nativeSession)){asr.stop();nativeSession=null;nativeSeekEpoch++;scopeWaiting=true;waiting=false;resumeAfter=false;clearOverlay();status("播放器已更新，正在重验当前音轨。")}
  if(enabled&&nativeMode&&(scopeWaiting||nativeSession&&nativeSession.playableDuration<nativeSession.duration))void refreshNativeScope();
  if(enabled){player?.tick();if(asrMode&&!scopeWaiting){asr.updateTime(video?.currentTime||0);if(!waiting&&!asrError)waitForCurrent()}updateAtTime();}
 }
 function frame(){if(enabled&&player?.mode)player.tick();requestAnimationFrame(frame)}
 setInterval(sync,250);requestAnimationFrame(frame);sync();
})();
