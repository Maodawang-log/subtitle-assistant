// @ts-nocheck
// Opt-in Japanese learning shell. Upstream automatic content entry is not loaded.
import { normalizeSourceLanguage, sourceLanguageName, isSourceTrack, tokenizeEnglish, importStorageKey } from "./source-language.js";
import { getJapaneseCc } from "./cc-source.js";
import { createBoundedAsrController, requestStudyAudioWindow } from "./bounded-asr.js";
import { getNativeStudySource, sameNativeBinding } from "./native-source.js";
import { exportSubtitles } from './learning-export.js';
import { createLearningWorkspace } from "./learning-workspace.js";
import { learningAction } from "./learning-store.js";
import { materialKey, materialCoverage, mergeRanges } from "./learning-data.js";
import { createStudyShell } from "./ui-shell.js";
import { createInlineRecorder } from "./inline-recorder.js";
import { createWordPanel } from "./word-panel.js";
import { createSubtitleSelection } from "./subtitle-selection.js";
import { correctionStorageKey, withCorrection, createCorrectionWriter } from "./manual-corrections.js";
import { createCueTimeline } from "./cue-revisions.js";
import { APPEARANCE_KEY,normalizeAppearance,appearanceCss } from "./appearance.js";
import { createProofreader } from "./proofreader.js";
import { renderMarkdown } from "../ui/markdown.js";
(()=>{
 if(document.getElementById("biliscript-japanese-study"))return;
 const ui=createStudyShell(),{host,controls,shadow,wrap,$}=ui,send=m=>chrome.runtime.sendMessage(m);
 let bilingual=false,translationEpoch=0,detailEpoch=0;
 let sourceLanguage="ja",languageOverride=false,videoSeeking=null;const languageName=()=>sourceLanguageName(sourceLanguage);
 let enabled=false,generation=0,route="",identity="",clip=null,cues=[],chinese=[],selected=0,active=-1,offset=0,video=null,player=null,abort=null,settings={autoStart:false,autoTranslate:false,configured:false};
 let tokenizer=null,tokenPromise=null,words={},basic={},overlay=null,overlayRoot=null,overlaySignature="",panelText="",loading=false,aiBusy=false,automaticBusy=false,waiting=false,resumeAfter=false,asrMode=false,lookupId="";
 const translations=new Map(),attempted=new Set();
 let corrections={},manualDraft=null;const writeCorrection=(storageKey,resource,cue)=>learningAction("correctionWrite",{storageKey,resource,cue});
 let listeningPlayback=null;
 let workspace=null,materialSource="asr",fullCollecting=false,batchApplying=false,restoredMaterial=null;
 const timeline=createCueTimeline(),invalidChinese=new Set();let appearance=normalizeAppearance(null),configurationEpoch=0;
 let recognizedWindows=[],asrError=false,aiEpoch=0,automaticFailed=false,nativeMode=false,nativeSession=null,nativeSeekEpoch=0;
 let scopeWaiting=false,nativeRefreshPending=false,lastNativeCheck=0,lookupEpoch=0,followRows=true;
 const currentElement=$("current"),chineseElement=$("chinese");
 const binding=()=>generation+"|"+sourceLanguage+"|"+(identity||route);
 const wordPanel=createWordPanel(ui,{binding,language:()=>sourceLanguage,lookup:(queries,language)=>send({type:"study-dictionary-lookup",language,queries}),fallback:(lemma,surface)=>words[lemma]||words[surface]||basic[lemma]||basic[surface],error:e=>status(e.message,true),explain:(token,source)=>safe(()=>{if(!source||source.resource!==(identity||route)||source.language!==sourceLanguage)return;const index=cues.findIndex(c=>c.text===source.sentence&&Math.abs(c.start+offset-source.time)<.01);if(index>=0)return explainSelection({text:token.surface_form,index,first:cueKey(cues[index])},binding(),"word")})});
 const selection=createSubtitleSelection({binding,onDrag:()=>video?.pause(),onSelect:(value,source)=>safe(()=>explainSelection(value,source))});
 selection.bind($("rows"));
 const sourceFor=c=>({...videoMeta(),language:sourceLanguage,sentence:c.text,url:location.href,time:Math.max(0,c.start+offset),resource:identity||route});
 const recorder=createInlineRecorder(ui,async c=>{guard();loopOff();await player.play(c)},()=>{loopOff();video?.pause()});
 const proofreader=createProofreader(ui,{cues:()=>cues,binding,configuration:()=>configurationEpoch,pause:()=>{loopOff();video?.pause()},cancel:()=>send({type:"study-stop-ai",channel:"proofread"}).catch(()=>{}),listen:c=>safe(async()=>{guard();loopOff();await player.play(shifted(c))}),
  request:async snapshot=>{const result=await requestAI("proofread",snapshot.cue.text,0,"sentence","proofread",{cue:snapshot.cue,context:snapshot.context,resource:route+"|"+identity});if(!result)throw new Error("校对已取消，字幕未修改。");return result},edit:editCue});
 host.addEventListener("study-pane",event=>{if(event.detail==="video"){void workspace?.load().catch(e=>status(e.message,true));workspace?.refresh();return}if(event.detail==="practice")safe(()=>{const c=guard();loopOff();video.pause();recorder.show(shifted(c));workspace?.selected();ui.mount(video)});else recorder.stop()});
 host.addEventListener("study-layout",()=>updateOverlay(video?JSTUDY.at(cues,video.currentTime-offset):-1));
 const windowReady=time=>recognizedWindows.some(w=>time>=w.start&&time<w.end);
 const status=(text,error=false)=>{$("status").textContent=(error?"⚠ ":"")+text;$("status").title=text;$("status").classList.toggle("error",error)};
 const currentRoute=()=>JSTUDY.keyOf(JSTUDY.resource(location.href));
 const cueKey=c=>(c.id||"")+":"+(c.revision||0)+":"+c.start.toFixed(2)+":"+c.end.toFixed(2)+":"+c.text;
 const safe=fn=>Promise.resolve().then(fn).catch(e=>{if(e.name!=="AbortError")status(e.message||String(e),true)});
 function loopOff(){listeningPlayback=null;player?.clear();$("loop").textContent="循环：关";$("loop").classList.remove("on");$("loop").setAttribute("aria-pressed","false")}
 function guard(){if(!enabled)throw new Error("请先开启当前视频的字幕");if(!cues.length)throw new Error("当前时刻字幕尚未就绪，请等待本地识别或导入字幕");if(!video)throw new Error("找不到视频播放器");return cues[selected]}
 const shifted=c=>({...c,start:Math.max(0,c.start+offset),end:Math.max(.01,c.end+offset)});
 function nativeLive(n){return enabled&&currentRoute()===route&&n&&n.binding.routeKey===route&&video?.isConnected&&video.getAttribute("data-biliscript-study-binding")===n.binding.videoTag&&video.currentSrc===n.binding.mediaSrc}
 async function verifyNativeWindow(payload,signal,expected){
  if(signal.aborted||!nativeLive(expected)||nativeSession!==expected)throw new DOMException("播放资源已更新","AbortError");
  const fresh=await getNativeStudySource();
  if(signal.aborted||!nativeLive(expected)||nativeSession!==expected)throw new DOMException("播放资源已更新","AbortError");
  if(fresh.status!=="ready"||!sameNativeBinding(fresh.binding,expected.binding)||fresh.bvid!==payload.bvid||fresh.cid!==payload.cid||fresh.source.url!==payload.audio_url||payload.start+payload.duration>fresh.playableDuration)throw new Error("当前音轨关联或可播放范围已改变，请重新开启字幕。");
 }
 function startNative(n,preserve=false){
  updateTrackChoices();materialSource="asr";
  asr.stop();nativeMode=true;nativeSession=n;nativeSeekEpoch++;clip={bvid:n.bvid,cid:n.cid,title:n.title,duration:n.duration};identity=n.bvid+":"+n.cid;
  if(!preserve){timeline.clear();cues=[];chinese=[];selected=0;active=-1;recognizedWindows=[];}
  asrError=false;asrMode=true;scopeWaiting=false;
  $("source").textContent="当前播放器实际音轨 · "+n.title+(n.audit.previewSeconds!==null?" · 当前试看范围 "+n.playableDuration+" 秒":"");
  if((video?.currentTime||0)>=n.playableDuration){waitForCurrent();return}
  waitForCurrent();
  asr.start({enabled:true,bvid:n.bvid,cid:n.cid,currentTime:video?.currentTime||0,duration:n.duration,language:sourceLanguage,model:settings.asrModel||"small",resourceId:identity,validatedAudioSource:n.source,playableDuration:n.playableDuration,completedWindows:preserve?recognizedWindows:[]});
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
   if(!enabled||meta.language!==sourceLanguage||meta.resourceId!==identity||nativeMode&&!nativeLive(nativeSession))return;
   recognizedWindows=recognizedWindows.filter(w=>w.start!==meta.windowStart);recognizedWindows.push({start:meta.windowStart,end:meta.windowStart+meta.duration});
   const previousCue=cues[selected]?{...cues[selected]}:null;timeline.setCorrections(corrections[identity]||[]);cues=timeline.replaceWindow(JSTUDY.normalize(items),meta);
   if(previousCue){const surviving=cues.find(c=>c.id===previousCue.id);if(!surviving||surviving.revision!==previousCue.revision||surviving.start!==previousCue.start||surviving.end!==previousCue.end)loopOff()}
   if(previousCue&&cues.length){const same=cues.findIndex(c=>c.id===previousCue.id);if(same>=0)selected=same;else{const time=video?video.currentTime-offset:previousCue.start,at=JSTUDY.at(cues,time);selected=at>=0?at:cues.reduce((best,c,index)=>Math.abs(c.start-previousCue.start)<Math.abs(cues[best].start-previousCue.start)?index:best,0);loopOff()}}
   invalidateCueWork();workspace?.changed({collection:fullCollecting});
   updateAtTime(true);
   if(waiting&&video&&windowReady(video.currentTime)){
    waiting=false;status(JSTUDY.at(cues,video.currentTime-offset)<0?"当前片段字幕已就绪；此刻没有台词，可选择字幕句开始练习。":"当前片段"+languageName()+"字幕已就绪。");
    if(resumeAfter){resumeAfter=false;video.play().catch(()=>status("字幕已就绪，请点视频播放。"))}
   }
   if(timeline.unmatchedCorrections)status("有 "+timeline.unmatchedCorrections+" 条校对与新时间轴无法可靠对应，原修改已保留。",true);
  },
  onStatus(event){if(currentRoute()!==route){reset(currentRoute());return;}if(!enabled)return;if(event.phase==="error"){if(nativeMode)asr.stop();asrError=true;waiting=false;resumeAfter=false;status(event.message,true)}else if(event.phase!=="disabled")status(event.message)}
 });
 function invalidateCueWork(notifyProof=true){
  aiEpoch++;detailEpoch++;translationEpoch++;selection.reset();automaticBusy=false;aiBusy=false;automaticFailed=false;attempted.clear();
  const keys=new Set(cues.map(cueKey));for(const key of translations.keys())if(!keys.has(key))translations.delete(key);
  for(const id of invalidChinese)if(!cues.some(c=>c.id===id))invalidChinese.delete(id);
  selected=Math.max(0,Math.min(selected,cues.length-1));active=-1;panelText="";overlaySignature="";for(const channel of ["translation","selection","explanation"])send({type:"study-stop-ai",channel}).catch(()=>{});
  if(notifyProof)proofreader.changed();
  if(!cues.length){$("rows").replaceChildren(currentElement,chineseElement);currentElement.removeAttribute("data-study-text");currentElement.textContent="当前片段没有识别到台词。";chineseElement.textContent="";$("position").textContent="暂无台词"}
 }
 function editCue(id,revision,text,persist=true){
  const before=cues.find(c=>c.id===id),updated=timeline.edit(id,revision,text);if(!updated)return null;
  corrections=withCorrection(corrections,identity,updated);
  if(persist)void writeCorrection(correctionStorageKey(route,sourceLanguage),identity,updated).catch(e=>status("字幕已修改，但本地保存失败："+e.message,true));
  translations.delete(cueKey(before));cues=timeline.cues;
  if(updated.edited)invalidChinese.add(id);else invalidChinese.delete(id);
  invalidateCueWork(false);workspace?.changed({batchOwn:batchApplying});display(selected,true);updateAtTime(true);status(updated.edited?"已采用校对；原文可恢复。":"已恢复原始字幕。");return updated;
 }
 function bindVideo(){
  const list=[...document.querySelectorAll("video")].map(v=>({v,r:v.getBoundingClientRect()})).filter(x=>x.r.width>50&&x.r.height>50).sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height);
  const v=list[0]?.v||document.querySelector("video");
  if(v===video)return;
  player?.clear();if(video&&videoSeeking)video.removeEventListener("seeking",videoSeeking);video=v;player=v?new JSTUDY.Player(v):null;
  videoSeeking=()=>{
   if(v!==video||!enabled)return;
   const owned=v.__biliscriptOwnedSeek;
   if(owned&&owned.until>=Date.now()&&Math.abs(v.currentTime-owned.time)<.4){updateAtTime(true);return;}
   aiEpoch++;detailEpoch++;proofreader.invalidate();attempted.clear();automaticBusy=false;send({type:"study-stop-ai"}).catch(()=>{});
   loopOff();active=-1;if(asrMode&&!fullCollecting){asrError=false;if(nativeMode)safe(nativeSeek);else asr.seek(v.currentTime);waitForCurrent()}updateAtTime(true);
  };if(v)v.addEventListener("seeking",videoSeeking);
 }
 function waitForCurrent(){
  if(!video||video.ended||asrError||nativeMode&&!nativeSession)return;
  if(nativeMode&&nativeSession&&video.currentTime>=nativeSession.playableDuration){
   if(!scopeWaiting){asr.stop();clearOverlay();status("已到当前试看范围（"+nativeSession.playableDuration+"秒）。可继续原视频播放；范围解除后会自动恢复字幕。")}scopeWaiting=true;waiting=false;resumeAfter=false;return;
  }
  if(windowReady(video.currentTime))return;
  if(!waiting)resumeAfter=!video.paused;waiting=true;video.pause();
  currentElement.textContent="当前时刻字幕准备中…";chineseElement.textContent="";clearOverlay();status("正在准备当前30秒片段。起播/跳转需要等待，不会把缓冲进度当成音频。");
 }
 function clearOverlay(){overlay?.remove();overlay=null;overlayRoot=null;overlaySignature=""}
 function stop(reason="字幕已关闭，识别和后续文字请求已停止。"){
  workspace?.reset();fullCollecting=false;restoredMaterial=null;manualDraft=null;$("track").hidden=true;
  proofreader.invalidate();
  bilingual=false;translationEpoch++;detailEpoch++;selection.reset();wordPanel.reset();$("translate").textContent="双语字幕：关";$("translate").setAttribute("aria-pressed","false");$("translate").classList.remove("on");
  recorder.clear();ui.setEnabled(false);scopeWaiting=false;lookupEpoch++;
  enabled=false;generation++;aiEpoch++;nativeMode=false;nativeSession=null;nativeSeekEpoch++;abort?.abort();abort=null;asr.stop();send({type:"study-stop-ai"}).catch(()=>{});loopOff();waiting=false;resumeAfter=false;asrMode=false;recognizedWindows=[];asrError=false;automaticFailed=false;loading=false;aiBusy=false;automaticBusy=false;
  clearOverlay();$("enable").textContent="开启字幕";$("enable").classList.remove("on");status(reason);
 }
 function updateTrackChoices(tracks=[],selectedId=""){
  const choices=new Map(tracks.filter(t=>isSourceTrack(t,sourceLanguage)).map(t=>[String(t.id||t.trackId||""),t]));choices.delete("");
  const select=$("track");select.setAttribute("aria-label",languageName()+"字幕轨");
  select.replaceChildren(new Option("自动选择字幕轨",""),...[...choices].map(([id,t])=>new Option(t.label||t.langLabel||t.lanDoc||t.lang||t.lan,id)));
  select.value=selectedId;select.hidden=choices.size<2;
 }
 function syncLanguageLabels(){
  $("sourceLanguage").value=sourceLanguage;updateTrackChoices();
  if(!enabled){currentElement.textContent="开启后显示"+languageName()+"字幕";$("source").textContent=languageName()+" CC 优先；无对应字幕轨时本地识别。"}
 }
 function reset(next,preserveLanguage=false){
  if(!preserveLanguage){languageOverride=false;sourceLanguage=normalizeSourceLanguage(settings.sourceLanguage)}
  stop("已换视频，字幕默认关闭。");timeline.clear();invalidChinese.clear();route=next;identity="";clip=null;cues=[];chinese=[];selected=0;active=-1;offset=0;$("offset").value="0";translations.clear();attempted.clear();panelText="";
  ui.setPane("subtitles");wordPanel.reset(true);$("detailTitle").textContent="本句讲解";$("explainScope").textContent="";$("detail").textContent="拖选字幕片段，或点击本句讲解。";
  $("rows").replaceChildren(currentElement,chineseElement);currentElement.textContent="开启后显示"+languageName()+"字幕";chineseElement.textContent="";$("position").textContent="未载入";syncLanguageLabels();

 }
 async function start(preferredTrackId="",refresh=false){
  await settingsReady;
  if(enabled&&loading)return;
  stop();updateTrackChoices();timeline.clear();invalidChinese.clear();cues=[];chinese=[];enabled=true;const mine=++generation;abort=new AbortController();loading=true;
  $("enable").textContent="关闭字幕";$("enable").classList.add("on");wrap.classList.remove("fold");bindVideo();ui.setEnabled(true);ui.mount(video);
  status("字幕已开启，正在获取当前视频的"+languageName()+"字幕…");
  let nativeFallback=null;
  try{
   const publicSettings=await send({type:"study-settings-public"});if(mine!==generation||!enabled)return;settings={...settings,...publicSettings?.config};
   const correctionKey=correctionStorageKey(route,sourceLanguage),savedCorrections=await chrome.storage.local.get(correctionKey);if(mine!==generation||!enabled)return;corrections=savedCorrections[correctionKey]||{};
   const savedKey=importStorageKey(route,sourceLanguage),legacyKey="biliscript-study-import:"+route;
   const savedData=await chrome.storage.local.get(sourceLanguage==="ja"?[savedKey,legacyKey]:savedKey);
   const saved=savedData[savedKey]||(sourceLanguage==="ja"?savedData[legacyKey]:undefined);if(mine!==generation||!enabled)return;
   const savedMaterial=refresh?{}:await workspace.restore(materialKey(route,sourceLanguage));if(mine!==generation||!enabled)return;
   if(saved&&!refresh&&!preferredTrackId&&!savedMaterial.document){materialSource="import";identity=saved.identity||route;cues=loadCorrected(JSTUDY.normalize(saved.cues),identity+"|"+sourceLanguage);offset=saved.offset||0;$("offset").value=offset;$("source").textContent="本视频手动导入："+saved.name;updateAtTime(true);status("已恢复本视频导入的"+languageName()+"字幕。");workspace?.changed();void workspace?.load().catch(e=>status(e.message,true));return;}
   if(!preferredTrackId&&savedMaterial.document?.source==="import"&&savedMaterial.document.identity===route){restoreMaterial(savedMaterial.document);void workspace.load().catch(e=>status(e.message,true));return;}
   const native=await getNativeStudySource();nativeFallback=native;
   if(mine!==generation||!enabled||currentRoute()!==route)return;
   if(!preferredTrackId&&savedMaterial.document&&native.status==="ready"&&savedMaterial.document.identity===native.bvid+":"+native.cid){restoreMaterial(savedMaterial.document);if(materialSource==="asr"&&!materialCoverage(savedMaterial.document).complete)startNative(native,true);void workspace.load().catch(e=>status(e.message,true));status("已恢复"+(savedMaterial.pinned?"长期保存":"临时缓存")+"字幕 · "+materialCoverage(savedMaterial.document).text);return;}
   if(!preferredTrackId&&native.status==="ready"&&native.subtitleListPresent&&(sourceLanguage==="ja"?native.japaneseTrackCount:native.englishTrackCount)===0&&nativeLive(native)){
    startNative(native);return;
   }
   const result=await getJapaneseCc({language:sourceLanguage,signal:abort.signal,preferredTrackId,includeChinese:true,onStatus:text=>{if(enabled&&mine===generation)status(text)}});
   if(mine!==generation||!enabled)return;
   clip=result;identity=result.bvid+":"+result.cid;
   if(!preferredTrackId&&savedMaterial.document&&savedMaterial.document.identity===identity){restoreMaterial(savedMaterial.document);if(materialSource==="asr"&&!materialCoverage(savedMaterial.document).complete){asrMode=true;asr.start({enabled:true,bvid:result.bvid,cid:result.cid,currentTime:video?.currentTime||0,duration:video?.duration,language:sourceLanguage,model:settings.asrModel||"small",resourceId:identity,completedWindows:recognizedWindows});}void workspace.load().catch(e=>status(e.message,true));status("已恢复"+(savedMaterial.pinned?"长期保存":"临时缓存")+"字幕 · "+materialCoverage(savedMaterial.document).text);return;}
   updateTrackChoices(result.status==="ready"?result.tracks:[],result.selectedTrackId||"");
   if(result.status==="ready"){
    materialSource="cc";cues=loadCorrected(JSTUDY.normalize(result.cues),identity+"|"+sourceLanguage);chinese=JSTUDY.normalize(result.chineseCues||[]);
    $("source").textContent="B站"+languageName()+"文本轨 · "+result.title;updateAtTime(true);status(languageName()+"字幕已就绪；可单独开启双语字幕。");
   }else{
    if(native.status==="ready"&&native.bvid===result.bvid&&native.cid===result.cid&&nativeLive(native)){startNative(native);return;}
    if(native.status==="unavailable"&&["PREVIEW_END","PREVIEW_UNKNOWN"].includes(native.reason))throw new Error(native.message);
    materialSource="asr";asrMode=true;$("source").textContent="本地 Whisper · "+result.title;waitForCurrent();
    asr.start({enabled:true,bvid:result.bvid,cid:result.cid,currentTime:video?.currentTime||0,duration:Number.isFinite(video?.duration)?Math.min(video.duration,result.duration||Infinity):result.duration,language:sourceLanguage,model:settings.asrModel||"small",resourceId:identity});
   }
  }catch(e){if(enabled&&mine===generation&&e.name!=="AbortError")status(nativeFallback?.reason==="NO_PLAYED_AUDIO"?"尚未关联当前音轨。请先正常播放几秒，再点“重新取字幕”。":nativeFallback?.reason==="NO_MARKER"?"请刷新视频页后重新开启字幕。":e.message,true)}
  finally{if(mine===generation){loading=false;workspace?.changed();void workspace?.load().catch(e=>status(e.message,true))}}
 }
 const fmt=t=>Math.floor(t/60)+":"+String(Math.floor(t%60)).padStart(2,"0");
 function availableChinese(c){return translations.get(cueKey(c))||(!c.edited&&!invalidChinese.has(c.id)&&JSTUDY.paired(c,chinese))||""}
 function chineseFor(c){return bilingual&&!workspace?.hideChinese()?availableChinese(c):""}
 function display(i,force=false){
  if(!cues.length||selection.active)return;const previous=selected;selected=Math.max(0,Math.min(cues.length-1,i));const c=cues[selected];if(previous!==selected){detailEpoch++;send({type:"study-stop-ai",channel:"selection"}).catch(()=>{});}
  workspace?.selected();
  $("position").textContent=(selected+1)+" / "+cues.length+" · "+fmt(c.start);chineseElement.textContent=chineseFor(c);
  if(force||panelText!==cueKey(c)){panelText=cueKey(c);currentElement.textContent=c.text;renderTokens(c,currentElement);renderRows();}
 }
 function loadCorrected(items,resource){timeline.setCorrections(corrections[identity]||[]);return timeline.load(items,resource)}
 function openManual(c){
  if(manualDraft)return;workspace?.manualStarted();loopOff();video?.pause();proofreader.invalidate();
  const index=cues.findIndex(item=>item.id===c.id);if(index<0)return;display(index,true);
  const target=$("rows").querySelector('.cue[data-index="'+index+'"] .cue-text');if(!target)return;
  const draft={id:c.id,revision:c.revision,binding:binding(),saving:false};manualDraft=draft;
  const input=document.createElement("textarea");input.className="cue-editor";input.setAttribute("aria-label","人工校对正文");input.value=c.text;input.rows=3;
  const actions=document.createElement("div");actions.className="cue-edit-actions";
  const save=document.createElement("button"),cancel=document.createElement("button"),error=document.createElement("p");
  save.textContent="保存";save.className="cue-edit-save";cancel.textContent="取消";cancel.className="cue-edit-cancel";error.className="error hint";error.setAttribute("role","alert");
  const close=()=>{manualDraft=null;display(selected,true);updateAtTime(true)};
  cancel.onclick=()=>{if(!draft.saving)close()};
  save.onclick=async()=>{
   if(draft.saving)return;const text=input.value.trim();if(!text){error.textContent="正文不能为空。";return}
   const valid=()=>manualDraft===draft&&binding()===draft.binding&&cues.some(item=>item.id===draft.id&&item.revision===draft.revision);
   if(!valid()){error.textContent="这句字幕已更新，请取消后重新编辑。";return}
   draft.saving=true;save.disabled=true;cancel.disabled=true;input.disabled=true;
   try{
    await writeCorrection(correctionStorageKey(route,sourceLanguage),identity,{...c,text});
    if(!valid()){error.textContent="修改已保存；字幕在保存时发生更新，请取消后重新载入字幕。";return}
    manualDraft=null;editCue(c.id,c.revision,text,false);proofreader.changed();status(text===c.originalText?"已恢复原文。":"人工校对已保存。");
   }catch(e){error.textContent="未能保存，请重试："+e.message}
   finally{draft.saving=false;save.disabled=false;cancel.disabled=false;input.disabled=false}
  };
  input.onkeydown=e=>{if(e.isComposing)return;if(e.key==="Escape"){e.preventDefault();cancel.click()}else if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();save.click()}};
  actions.append(save,cancel);
  if(c.edited){const restore=document.createElement("button");restore.className="cue-edit-restore";restore.textContent="恢复原文";restore.onclick=()=>{if(!draft.saving){input.value=c.originalText;save.click()}};actions.append(restore)}
  target.replaceChildren(input,actions,error);input.focus();input.setSelectionRange(input.value.length,input.value.length);
 }
 function renderRows(){
  if(manualDraft)return;
  const rows=$("rows"),oldScroll=rows.scrollTop;rows.replaceChildren();
  cues.forEach((c,index)=>{
   const row=document.createElement("div");row.className="cue"+(index===selected?" active":"");row.dataset.index=index;
   const time=document.createElement("button");time.className="cue-time";time.textContent=fmt(c.start);time.title="选中并定位此句";
   time.onclick=()=>safe(async()=>{guard();loopOff();display(index);player.seekPause(shifted(c))});
   const timing=document.createElement("div"),check=document.createElement("button");timing.className="cue-timing";check.className="cue-proofread";check.textContent="AI 校对";check.title="仅校对此句，先查看建议再采用";check.onclick=()=>void proofreader.check(c.id);const manual=document.createElement("button");manual.className="cue-manual";manual.textContent="人工校对";manual.onclick=()=>openManual(c);const favorite=workspace.sentenceButton(c);timing.append(time,manual,check,favorite);row.append(timing);const text=document.createElement("div");text.className="cue-text";
   if(index===selected){text.append(currentElement,chineseElement);currentElement.textContent=c.text;currentElement.dataset.studyText="";currentElement.dataset.cue=cueKey(c);currentElement.dataset.index=String(index);chineseElement.textContent=chineseFor(c);renderTokens(c,currentElement)}
   else{const ja=document.createElement("div"),zh=document.createElement("div");ja.textContent=c.text;ja.dataset.studyText="";ja.dataset.cue=cueKey(c);ja.dataset.index=String(index);zh.className="cue-zh";zh.textContent=chineseFor(c);text.append(ja,zh);renderTokens(c,ja,index)}
   row.append(text);rows.append(row);
  });
  rows.scrollTop=oldScroll;
  if(followRows){const row=rows.querySelector(".active");if(row&&row.offsetTop<rows.scrollTop||row&&row.offsetTop+row.offsetHeight>rows.scrollTop+rows.clientHeight)rows.scrollTop=Math.max(0,row.offsetTop-rows.clientHeight/3)}
 }
 async function getTokenizer(){
  if(sourceLanguage==="en")return {tokenize:tokenizeEnglish};
  if(tokenPromise)return tokenPromise;
  tokenPromise=new Promise((resolve,reject)=>kuromoji.builder({dicPath:chrome.runtime.getURL("study/dict/")}).build((error,t)=>{if(error){tokenPromise=null;reject(new Error("本地日语词典载入失败，请重新加载扩展"))}else{tokenizer=t;resolve(t)}}));return tokenPromise;
 }
 function tokenElement(token,overlayStyle=false){
  if(token.language==="en"&&token.pos==="記号")return document.createTextNode(token.surface_form);
  const b=document.createElement("span");b.setAttribute("role","button");b.tabIndex=0;b.className=overlayStyle?"jp-word":"token";const ruby=document.createElement("ruby");ruby.textContent=token.surface_form;
  const reading=sourceLanguage==="ja"?JSTUDY.hiragana(token.reading):"";if(reading&&reading!==token.surface_form){const rt=document.createElement("rt");rt.textContent=reading;ruby.append(rt)}b.append(ruby);b.onclick=e=>{e.stopPropagation();if(selection.suppressClick())return;lookup(token,b)};b.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();lookup(token,b)}};return b;
 }
 async function renderTokens(c,target,index=selected){
  const mine=generation;try{const t=await getTokenizer();if(!enabled||mine!==generation||cues[index]!==c||!target.isConnected||selection.active)return;target.dataset.studyText="";target.dataset.cue=cueKey(c);target.dataset.index=String(index);target.replaceChildren(...t.tokenize(c.text).map(token=>tokenElement(token)));overlaySignature="";}
  catch(e){if(enabled&&mine===generation)status(e.message,true)}
 }
 async function lookup(token,element){
  if(!enabled)return;video?.pause();ui.setPane("vocabulary");const index=Number(element?.closest("[data-study-text]")?.dataset.index??selected);await wordPanel.show([token],cues[index]?sourceFor(cues[index]):undefined);
 }
 function setupMessage(target,message){target.replaceChildren();const p=document.createElement("p"),button=document.createElement("button");p.textContent=message;button.textContent="去设置";button.className="setup-link";button.onclick=()=>send({type:"study-open-options"});target.append(p,button)}
 async function explainSelection(value,source,kind="explain"){
  if(!enabled||source!==binding())return;
  const index=value.index,c=cues[index];if(!c||cueKey(c)!==value.first)return;
  const snapshot={cue:{...c},context:JSTUDY.context(cues,index),resource:identity||route};
  proofreader.invalidate();
  video?.pause();const mine=++detailEpoch;aiBusy=false;send({type:"study-stop-ai",channel:"selection"}).catch(()=>{});send({type:"study-stop-ai",channel:"explanation"}).catch(()=>{});
  ui.setPane("explanation");$("detailTitle").textContent=kind==="word"?"词义与变形":"选段讲解";$("explainScope").textContent=value.text;$("detail").textContent="正在讲解选中片段…";
  void getTokenizer().then(t=>{if(mine===detailEpoch&&source===binding())return wordPanel.show(t.tokenize(value.text),{...sourceFor(c),selection:value.text})}).catch(e=>status(e.message,true));
  const latest=await send({type:"study-settings-public"});if(mine!==detailEpoch||source!==binding())return;settings={...settings,...latest?.config};
  if(!settings.configured){setupMessage($("detail"),"尚未配置文字接口。单词释义已在本地准备。");status("请先在设置中配置文字接口。",true);return;}
  try{const result=await requestAI(kind,value.text,index,"selection","selection",snapshot);if(!result||mine!==detailEpoch||source!==binding())return;$("detail").innerHTML=renderMarkdown(result.text);if(result.warning){const p=document.createElement("p");p.className="error";p.textContent=result.warning;$("detail").prepend(p)}status(result.warning||(result.fromCache?"已使用讲解缓存。":"讲解已完成。"),!!result.warning)}
  catch(e){if(mine===detailEpoch&&source===binding()){setupMessage($("detail"),e.message);status(e.message,true)}}
 }
 function updateOverlay(i){
  if(selection.active)return;
  if(workspace?.hideOriginal()){clearOverlay();return;}
  if(!enabled||i<0||!video||document.querySelector("#app[data-server-rendered]")){clearOverlay();return;}
  const c=cues[i],zh=chineseFor(c);
  const container=document.fullscreenElement&&document.fullscreenElement.tagName!=="VIDEO"?document.fullscreenElement:video.closest(".bpx-player-container,.bilibili-player,.html5-video-player")||video.parentElement;
  if(!container)return;
  const signature=sourceLanguage+"|"+cueKey(c)+"|"+zh+"|"+!!tokenizer;
  if(overlay?.parentElement!==container){clearOverlay();overlay=document.createElement("div");overlay.id="biliscript-study-overlay";Object.assign(overlay.style,{position:"absolute",left:"5%",right:"5%",bottom:"12%",zIndex:"2147483645",pointerEvents:"none"});overlayRoot=overlay.attachShadow({mode:"open"});container.append(overlay);}
  overlay.style.bottom=document.fullscreenElement?Math.min(innerHeight*.65,Math.max(innerHeight*.14,container.getBoundingClientRect().bottom-controls.getBoundingClientRect().top+22))+"px":"12%";
  overlay.style.right=document.fullscreenElement&&!host.hidden?Math.max(0,host.getBoundingClientRect().width+40)+"px":"5%";
  refreshAppearance();
  if(signature===overlaySignature)return;overlaySignature=signature;
  overlayRoot.replaceChildren();
  const style=document.createElement("style");style.textContent='*{box-sizing:border-box}.ja,.zh{text-align:center;line-height:1.65;color:white;text-shadow:1px 1px 3px #000,-1px -1px 3px #000,0 2px 8px #000;font-family:system-ui,"Meiryo",sans-serif;font-weight:600}.ja{font-size:clamp(20px,2.1vw,34px)}.zh{font-size:clamp(17px,1.5vw,26px)}.ja,.jp-word,.jp-word ruby{user-select:text!important;-webkit-user-select:text!important;pointer-events:auto}.jp-word{display:inline;border:0;background:transparent;color:inherit;font:inherit;text-shadow:inherit;padding:0 2px;pointer-events:auto;cursor:pointer;border-radius:5px}.jp-word:hover{background:#174d35c9}rt{font-size:.4em;font-weight:400;user-select:none;-webkit-user-select:none}';
  const ja=document.createElement("div");ja.className="ja";ja.dataset.studyText="";ja.dataset.cue=cueKey(c);ja.dataset.index=String(i);selection.bind(ja);if(sourceLanguage==="en"||tokenizer)ja.append(...(sourceLanguage==="en"?tokenizeEnglish(c.text):tokenizer.tokenize(c.text)).map(token=>tokenElement(token,true)));else ja.textContent=c.text;
  const translation=document.createElement("div");translation.className="zh";translation.textContent=zh;const look=document.createElement("style");look.id="appearance";look.textContent=appearanceCss(appearance,container.getBoundingClientRect());overlayRoot.append(style,look,ja,translation);
 }
 async function requestAI(kind,text,index=selected,scope="sentence",channel=kind==="translate"?"translation":"explanation",snapshot=null){
  const c=snapshot?.cue||cues[index];if(!enabled||!c)return null;const mine=generation,epoch=aiEpoch,resource=snapshot?.resource||identity||route,context=snapshot?.context??JSTUDY.context(cues,index);
  const result=await send({type:"study-ai",language:sourceLanguage,kind,scope,channel,text:text||c.text,context:scope==="context"?"":context,resource,...(kind==="proofread"?{cueRevisionKey:c.id+":"+c.revision}:{}),requestId:crypto.randomUUID()});
  if(currentRoute()!==route){reset(currentRoute());return null;}if(!enabled||mine!==generation||channel!=="proofread"&&epoch!==aiEpoch)return null;if(!result?.ok){if(result?.canceled)return null;throw new Error(result?.error||"文字接口未完成请求");}return result;
 }
 async function ask(kind,text,scope="sentence"){
  proofreader.invalidate();
  const c=guard();if(aiBusy)return;if(kind!=="translate")video.pause();aiBusy=true;const detail=++detailEpoch;send({type:"study-stop-ai",channel:"selection"}).catch(()=>{});const mine=generation,index=selected;status("正在请求 "+(kind==="translate"?"中文翻译":"中文讲解")+"…");
  if(kind==="explain"){ui.setPane("explanation");$("detailTitle").textContent=scope==="context"?"邻近几句讲解":"本句讲解";$("explainScope").textContent=scope==="context"?"当前句及前后各两句，最多五句":"只讲解当前选中句";$("detail").textContent="正在生成讲解…"}
  try{
   const r=await requestAI(kind,text,index,scope);if(!r||detail!==detailEpoch)return;
   if(kind==="translate"){translations.set(cueKey(c),r.text);display(selected);overlaySignature=""}
   else if(selected===index&&(kind!=="word"||lookupId===text)){const target=kind==="word"?$("wordDetail"):$("detail");target.innerHTML=renderMarkdown(r.text);target.classList.add("markdown");if(r.warning){const warning=document.createElement("p");warning.className="error";warning.textContent=r.warning;target.prepend(warning)}if(kind==="explain")foldExplanation(target)}
   status(r.warning|| (r.fromCache?"已使用本地解释缓存。":"已取得接口结果。"),!!r.warning);
  }catch(e){if(kind==="explain"&&mine===generation&&detail===detailEpoch)$("detail").textContent=e.message+" 点击讲解按钮可手动重试。";throw e}finally{if(mine===generation&&detail===detailEpoch)aiBusy=false}
 }
 async function autoTranslate(i){
  if(!enabled||automaticBusy||automaticFailed||!bilingual||!settings.configured||i<0)return;
  const candidates=[i,i+1].filter(x=>cues[x]&&!availableChinese(cues[x])&&!attempted.has(cueKey(cues[x])));
  if(!candidates.length)return;automaticBusy=true;const mine=generation,epoch=aiEpoch,translation=translationEpoch;
  try{for(const index of candidates){
   if(!enabled||!bilingual||mine!==generation||epoch!==aiEpoch||translation!==translationEpoch||currentRoute()!==route)break;
   const nowIndex=JSTUDY.at(cues,video.currentTime-offset);if(nowIndex<0||index<nowIndex||index>nowIndex+1)break;
   const c=cues[index],key=cueKey(c);attempted.add(key);
   try{const r=await requestAI("translate",undefined,index);if(r&&bilingual&&translation===translationEpoch){translations.set(key,r.text);display(selected);overlaySignature=""}}
   catch(e){if(enabled&&bilingual&&translation===translationEpoch&&mine===generation&&epoch===aiEpoch){automaticFailed=true;status(e.message,true);}break;}
  }}finally{if(mine===generation&&epoch===aiEpoch&&translation===translationEpoch)automaticBusy=false}
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
 function openPanel(){bindVideo();ui.openPanel();ui.mount(video);if(!enabled)status("先选择原语言，再开启字幕。")}
 $("sourceLanguage").onchange=()=>{sourceLanguage=normalizeSourceLanguage($("sourceLanguage").value);languageOverride=true;reset(route,true);openPanel();status("已切换为"+languageName()+"，点击开启字幕后应用。")};
 $("stopStudy").onclick=()=>stop();
 $("follow").onclick=()=>{followRows=true;renderRows()};$("rows").addEventListener("wheel",()=>followRows=false,{passive:true});
 $("settings").onclick=()=>send({type:"study-open-options"});
 $("reload").onclick=()=>{if(enabled)safe(()=>start($("track").value,true));else openPanel()};
 $("track").onchange=()=>{if(enabled)safe(()=>start($("track").value,true))};
 $("offset").onchange=()=>safe(async()=>{guard();const n=Number($("offset").value);if(!Number.isFinite(n)||Math.abs(n)>3600)throw new Error("偏移请在±3600秒内");offset=n;loopOff();active=-1;updateAtTime(true)});
 $("prev").onclick=()=>safe(async()=>{guard();loopOff();display(selected-1);player.seekPause(shifted(cues[selected]))});
 $("next").onclick=()=>safe(async()=>{guard();loopOff();display(selected+1);player.seekPause(shifted(cues[selected]))});
 $("pause").onclick=()=>safe(async()=>{guard();video.pause()});
 $("replay").onclick=()=>safe(async()=>{const c=guard();loopOff();await player.play(shifted(c));status("播放到本句结束后暂停。")});
 $("loop").onclick=()=>safe(async()=>{const c=guard();if(player.mode==="loop"){loopOff();return;}await player.play(shifted(c),true);$("loop").classList.add("on");$("loop").textContent="循环：开";$("loop").setAttribute("aria-pressed","true")});
 $("translate").onclick=()=>safe(async()=>{
  guard();bilingual=!bilingual;const revision=++translationEpoch,mine=generation;automaticBusy=false;automaticFailed=false;attempted.clear();
  $("translate").textContent=bilingual?"双语字幕：开":"双语字幕：关";$("translate").setAttribute("aria-pressed",String(bilingual));$("translate").classList.toggle("on",bilingual);
  if(!bilingual){
   workspace?.bilingualDisabled();chineseElement.textContent="";for(const node of $("rows").querySelectorAll("#chinese,.cue-zh"))node.textContent="";overlayRoot?.querySelector(".zh")?.remove();
   send({type:"study-stop-ai",channel:"translation"}).catch(()=>{});
  }
  else{const r=await send({type:"study-settings-public"});if(!enabled||mine!==generation||revision!==translationEpoch)return;settings={...settings,...r?.config};if(!settings.configured&&!cues.every(c=>availableChinese(c)))status("双语已开启；已有中文照常显示，新翻译请先配置文字接口。",true)}
  overlaySignature="";display(selected,true);updateAtTime();
 });
 $("explain").onclick=()=>safe(()=>ask("explain"));
 $("paragraph").onclick=()=>safe(()=>ask("explain",JSTUDY.context(cues,selected),"context"));
 $("record").onclick=()=>safe(async()=>{const c=guard();loopOff();video.pause();if(document.fullscreenElement&&ui.pane==="practice")ui.openPanel();recorder.open(shifted(c));ui.mount(video)});
 $("import").onclick=()=>safe(async()=>{if(!enabled)throw new Error("请先开启字幕");$("subtitleFile").click()});
 $("subtitleFile").onchange=()=>safe(async()=>{
  const f=$("subtitleFile").files[0];if(!f)return;if(f.size>5*1024*1024)throw new Error("字幕不能超过5MB");const mine=generation;
  const parsed=JSTUDY.parseSubtitle(await f.text());if(!enabled||mine!==generation)return;
  workspace?.manualStarted();materialSource="import";asr.stop();abort?.abort();asrMode=false;nativeMode=false;nativeSession=null;nativeSeekEpoch++;aiEpoch++;detailEpoch++;translationEpoch++;selection.reset();wordPanel.reset(true);automaticBusy=false;automaticFailed=false;send({type:"study-stop-ai"}).catch(()=>{});loopOff();identity=identity||route;cues=loadCorrected(parsed,identity+"|"+sourceLanguage);invalidChinese.clear();chinese=[];translations.clear();attempted.clear();
  // New imports are temporary until the user explicitly pins the material.
  workspace?.changed();
  if(!enabled||mine!==generation)return;
  updateTrackChoices();$("source").textContent="手动导入："+f.name;display(0,true);status("已导入"+languageName()+"时间轴字幕；可在视频面板长期保存。");$("subtitleFile").value="";workspace?.changed();void workspace?.load().catch(e=>status(e.message,true));
 });
 $("export").onclick=()=>safe(async()=>{guard();const m=getMaterial(),file=exportSubtitles(m,$("subtitleFormat").value,Object.fromEntries(m.cues.map(c=>[c.id,availableChinese(c)])));download(file.name,file.text,file.type)});

 chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m?.type==="study-toggle"){openPanel();reply({ok:true});return false;}
  if(m?.action!=="studyPlayReference")return;
  if(!enabled||m.resource!==(identity||route)){reply({success:false,error:"学习已关闭或原视频已切换"});return false}
  (async()=>{bindVideo();if(!video)throw new Error("找不到原视频");loopOff();if(m.command==="pause")video.pause();else await player.play(m.cue);return {success:true}})().then(reply).catch(e=>reply({success:false,error:e.message}));return true;
 });
 void send({type:"study-content-ready"}).catch(()=>{});
 document.addEventListener("fullscreenchange",()=>{overlaySignature="";ui.mount(video);updateOverlay(video?JSTUDY.at(cues,video.currentTime-offset):-1)});
 addEventListener("pagehide",()=>{stop("页面已离开，学习已停止。");clearInterval(syncTimer);cancelAnimationFrame(frameId);video?.removeEventListener("seeking",videoSeeking);chrome.storage.onChanged?.removeListener(onStorageChange)});
 addEventListener("pageshow",event=>{if(!event.persisted)return;chrome.storage.onChanged?.addListener(onStorageChange);void workspace?.refreshFavorites().catch(e=>status(e.message,true));video?.addEventListener("seeking",videoSeeking);chrome.storage.local.get(APPEARANCE_KEY).then(data=>applyAppearance(data[APPEARANCE_KEY]));void send({type:"study-settings-public"}).then(applySettings);syncTimer=setInterval(sync,250);frameId=requestAnimationFrame(frame);sync()});
 chrome.storage.local.get("biliscriptStudyDictionary").then(x=>{words=x.biliscriptStudyDictionary||{}});
 // Reuse the existing player sync lifecycle; no per-video observers or extra
 // timers accumulate when Bilibili replaces a video or changes player mode.
 function refreshAppearance(){const style=overlayRoot?.getElementById("appearance"),container=overlay?.parentElement;if(style&&container){const css=appearanceCss(appearance,container.getBoundingClientRect());if(style.textContent!==css)style.textContent=css}}
 const applyAppearance=value=>{appearance=normalizeAppearance(value);refreshAppearance()};
 chrome.storage.local.get(APPEARANCE_KEY).then(data=>applyAppearance(data[APPEARANCE_KEY]));
 const onStorageChange=(changes,area)=>{if(area!=="local")return;workspace?.storageChanged(changes,area);if(changes.biliscriptStudyDictionary)words=changes.biliscriptStudyDictionary.newValue||{};if(changes[APPEARANCE_KEY])applyAppearance(changes[APPEARANCE_KEY].newValue);if(changes[correctionStorageKey(route,sourceLanguage)]&&!batchApplying){workspace?.manualStarted();corrections=changes[correctionStorageKey(route,sourceLanguage)].newValue||{};if(enabled&&cues.length&&!manualDraft?.saving)safe(()=>applyStoredCorrections(corrections[identity]||[]));}if(changes.biliscriptJapaneseSettings){workspace?.configurationChanged();configurationEpoch++;proofreader.invalidate();aiEpoch++;detailEpoch++;automaticBusy=false;automaticFailed=false;attempted.clear();send({type:"study-stop-ai"}).catch(()=>{});send({type:"study-settings-public"}).then(applySettings).catch(()=>{})}};
 chrome.storage.onChanged?.addListener(onStorageChange);
 function applySettings(r){settings={...settings,...r?.config};const next=normalizeSourceLanguage(settings.sourceLanguage);if(!languageOverride&&next!==sourceLanguage){sourceLanguage=next;reset(route,true)}}
 function videoMeta(){const r=JSTUDY.resource(location.href);return {bvid:clip?.bvid||r?.bvid||"",page:r?.page||1,cid:String(clip?.cid||""),language:sourceLanguage,title:clip?.title||document.title,route,identity:identity||route}}
 function getMaterial(){if(!route)return null;const meta=videoMeta(),duration=Number(nativeSession?.duration||clip?.duration||restoredMaterial?.duration||video?.duration)||0;return {version:1,key:materialKey(route,sourceLanguage),...meta,offset,duration:Number.isFinite(duration)?duration:0,durationVerified:!!(nativeSession?.duration||clip?.duration||restoredMaterial?.durationVerified),source:materialSource,ranges:materialSource==="asr"?mergeRanges(recognizedWindows):mergeRanges(cues.map(c=>({start:c.start,end:c.end}))),cues:cues.map(c=>({...c})),at:Date.now()}}
 function restoreMaterial(m){restoredMaterial=m;materialSource=m.source;identity=m.identity;clip={bvid:m.bvid,cid:m.cid,title:m.title};offset=m.offset||0;$("offset").value=offset;recognizedWindows=m.source==="asr"?m.ranges:[];const raw=m.cues.map(c=>({...c,text:c.originalText||c.text}));if(m.source==="asr"){timeline.clear();timeline.setCorrections(corrections[identity]||[]);for(const r of m.ranges)for(let start=r.start;start<r.end;start+=30){const duration=Math.min(30,r.end-start);cues=timeline.replaceWindow(raw.filter(c=>c.end>start&&c.start<start+duration),{windowStart:start,duration,resourceId:identity,language:sourceLanguage,model:settings.asrModel||"small"})}}else cues=loadCorrected(raw,identity+"|"+sourceLanguage);$("source").textContent="恢复资料 · "+m.title;updateAtTime(true);workspace.refresh()}
 async function applyStoredCorrections(items){corrections={...corrections,[identity]:items};timeline.setCorrections(items);cues=timeline.reapplyCorrections();for(const c of cues)if(c.edited)invalidChinese.add(c.id);invalidateCueWork();display(selected,true);updateAtTime(true);workspace.changed({batchOwn:true})}
 workspace=createLearningWorkspace(ui,{
  material:getMaterial,meta:videoMeta,download,current:()=>cues[selected],binding,configuration:()=>JSON.stringify([settings.baseUrl,settings.model,settings.compatibility]),manualEditing:()=>!!manualDraft,
  correctionSnapshot:async()=>{const data=await chrome.storage.local.get(correctionStorageKey(route,sourceLanguage));return data[correctionStorageKey(route,sourceLanguage)]?.[identity]||[]},
  async commitBatch(batch){const owner=binding(),storageKey=correctionStorageKey(route,sourceLanguage),resource=identity,key=materialKey(route,sourceLanguage);batchApplying=true;try{const r=await learningAction("batchCommit",{...batch,storageKey,resource,key});if(owner===binding())await applyStoredCorrections(r.corrections)}finally{batchApplying=false}},
  async undoBatch(batch){const owner=binding(),storageKey=correctionStorageKey(route,sourceLanguage),resource=identity,key=materialKey(route,sourceLanguage);const data=await chrome.storage.local.get(storageKey);batchApplying=true;try{const r=await learningAction("batchUndo",{id:batch.id,key,storageKey,resource,expected:data[storageKey]?.[resource]||[]});if(owner===binding())await applyStoredCorrections(r.corrections)}finally{batchApplying=false}},
  async collectFull(){guard();loopOff();video.pause();fullCollecting=true;try{if(!asrMode){const n=await getNativeStudySource();if(n.status!=="ready"||!nativeLive(n))throw new Error("无法确认当前完整音轨，可导入完整字幕后总结");startNative(n)}await asr.collectAll()}finally{fullCollecting=false;workspace.changed({collection:true})}},
  cancelCollection(){if(fullCollecting){asr.cancelCollection();fullCollecting=false}},
  async jump(start,end){bindVideo();if(!video)throw new Error("找不到播放器");loopOff();await player.play({start:Math.max(0,start),end:Math.max(start+.01,end)})},
  async words(c){const index=cues.findIndex(x=>x.start===c.start&&x.end===c.end&&x.text===c.text);if(index<0)throw new Error("原句已更新，请重新生成学习清单");ui.setPane("vocabulary");const t=await getTokenizer();await wordPanel.show(t.tokenize(c.text),sourceFor(c))},
  selectRelative(delta){guard();display(selected+delta,true)},
  async replay(intensive=false){const c=guard();loopOff();const segment=shifted(c);if(intensive)listeningPlayback={player,cue:segment};await player.play(segment)},
  clearListeningPlayback(){if(listeningPlayback?.player===player&&player?.cue===listeningPlayback.cue)player.clear();listeningPlayback=null},
  updatePracticeCue(c){if(c)recorder.setCurrent(shifted(c))},availableChinese,
  cancelChinese(){send({type:"study-stop-ai",channel:"listening-translation"}).catch(()=>{})},
  redraw(){overlaySignature="";if(enabled){display(selected,true);updateOverlay(video?JSTUDY.at(cues,video.currentTime-offset):-1)}},
  async translateCurrent(c,valid){
   guard();const owner=binding(),config=configurationEpoch,key=cueKey(c),index=cues.findIndex(x=>cueKey(x)===key);
   const live=()=>valid()&&owner===binding()&&config===configurationEpoch&&cueKey(cues[selected])===key;
   const known=availableChinese(c);if(known)return known;
   const latest=await send({type:"study-settings-public"});if(!live())return null;settings={...settings,...latest?.config};
   if(!settings.configured)throw new Error("尚未配置文字接口，请在设置中配置后重试。");
   const result=await requestAI("translate",c.text,index,"sentence","listening-translation",{cue:{...c},context:"",resource:identity||route});
   if(!live()||!result)return null;translations.set(key,result.text);return result.text;
  },
  record:()=>safe(async()=>{const c=guard();loopOff();video.pause();if(document.fullscreenElement&&ui.pane==="practice")ui.openPanel();recorder.open(shifted(c));ui.mount(video)})
 });
 const settingsReady=send({type:"study-settings-public"}).then(applySettings).catch(()=>{});
 fetch(chrome.runtime.getURL("study/basic-dictionary.json")).then(r=>r.json()).then(x=>basic=x).catch(()=>{});
 send({type:"study-settings-public"}).then(r=>{settings={...settings,...r?.config};}).catch(()=>{});
 function sync(){
  const next=currentRoute();if(next!==route)reset(next);bindVideo();ui.mount(video);if(!next){host.hidden=true;controls.hidden=true}
  if(enabled&&nativeMode&&nativeSession&&!nativeLive(nativeSession)){asr.stop();nativeSession=null;nativeSeekEpoch++;scopeWaiting=true;waiting=false;resumeAfter=false;clearOverlay();status("播放器已更新，正在重验当前音轨。")}
  if(enabled&&nativeMode&&(scopeWaiting||nativeSession&&nativeSession.playableDuration<nativeSession.duration))void refreshNativeScope();
  if(enabled){player?.tick();if(asrMode&&!scopeWaiting&&!fullCollecting){asr.updateTime(video?.currentTime||0);if(!waiting&&!asrError)waitForCurrent()}updateAtTime();}
 }
 function frame(){if(enabled&&player?.mode)player.tick();frameId=requestAnimationFrame(frame)}
 let syncTimer=setInterval(sync,250),frameId=requestAnimationFrame(frame);sync();
})();
