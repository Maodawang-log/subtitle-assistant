export function createStudyShell(){
 const host=document.createElement("div");host.id="biliscript-japanese-study";
 const controls=document.createElement("div");controls.id="biliscript-study-controls";
 const slot=document.createElement("div");slot.id="biliscript-study-slot";
 const entry=document.createElement("div");entry.id="biliscript-study-entry";entry.hidden=true;
 // The player's inner node lives in a fixed-height wrapper on real Bilibili.
 // Reserve document flow outside that wrapper; never overlay native actions.
 slot.style.cssText="display:none!important;position:relative!important;float:none!important;clear:both!important;width:auto!important;max-width:100%!important;min-width:0!important;height:auto!important;min-height:0!important;max-height:none!important;margin:10px 0 16px!important;padding:0!important;border:0!important;flex:none!important;box-sizing:border-box!important;isolation:isolate";
 const roots=[host,controls,entry].map(node=>{const root=node.attachShadow({mode:"open"}),link=document.createElement("link");link.rel="stylesheet";link.href=chrome.runtime.getURL("study/ui.css");root.append(link);return root});
 const wrap=document.createElement("div");wrap.className="fold";
 wrap.innerHTML='<section class="panel"><header class="head"><button id="enable">开启字幕</button><p id="status" role="status" tabindex="0">字幕已关闭。</p><button id="settings" title="学习设置">⚙</button><button id="fold" title="收起阅读区">×</button></header><nav class="tabs" aria-label="学习内容"><button data-pane="subtitles" class="selected" aria-pressed="true">字幕</button><button data-pane="explanation" aria-pressed="false">讲解</button><button data-pane="vocabulary" aria-pressed="false">单词</button><button data-pane="book" aria-pressed="false">生词本</button><button data-pane="practice" aria-pressed="false">跟读</button></nav><section id="pane-subtitles" class="pane"><div class="subtitle-tools"><button id="reload">刷新字幕</button><button id="import">导入字幕</button><button id="export">导出</button><button id="follow">跟随当前句</button><select id="track" aria-label="日语字幕轨"><option value="">自动选择日语</option></select><label>偏移 <input id="offset" aria-label="字幕偏移秒数" type="number" step=".1" value="0"> 秒</label><p id="source" class="hint">日文 CC 优先；无日文轨时本地识别。</p></div><div id="rows" class="scroll"><div id="current">开启后显示日语字幕</div><div id="chinese"></div></div></section><section id="pane-explanation" class="pane" hidden><div class="reading-header"><strong id="detailTitle">本句讲解</strong><span id="explainScope" class="hint"></span></div><div id="detail" class="scroll markdown"><p class="empty">选中一句字幕，再点击「本句讲解」。</p></div></section><section id="pane-vocabulary" class="pane" hidden><div class="scroll"><div id="wordDetail" class="word-detail"><p class="empty">点击日文单词，查看读音、原形和词典释义。</p></div></div></section><section id="pane-book" class="pane" hidden><div class="scroll"><div class="reading-header"><strong>生词本</strong><button id="exportWords">导出</button></div><div id="wordList"></div><p class="hint">词典下载安装位于设置。社区 AI 译词仅作学习参考。</p></div></section><section id="pane-practice" class="pane" hidden><div id="practiceHome" class="scroll"></div></section><input id="subtitleFile" type="file" accept=".srt,.vtt"></section>';
 roots[0].append(wrap);
 const bar=document.createElement("div");bar.className="study-bar";
 bar.innerHTML='<section id="learningControls"><div class="toolbar"><span id="position">未载入</span><div class="transport"><button id="prev" title="上一句">← 上句</button><button id="pause">暂停</button><button id="replay">▶ 重播</button><button id="next" title="下一句">下句 →</button><button id="loop" aria-pressed="false">循环：关</button></div><div class="actions"><button id="translate" aria-pressed="false">双语字幕：关</button><button id="explain">本句讲解</button><button id="paragraph">邻近几句</button><button id="record">● 跟读</button></div><button id="readPanel">字幕 / 讲解</button><button id="stopStudy" title="关闭当前视频字幕">关闭</button></div><section id="practice" hidden><header><strong>跟读练习</strong><span id="practiceTime">00:00</span><button id="practiceClose" title="收起跟读">×</button></header><p class="practice-intro">跟读当前句，录音后与原声对照。</p><div class="practice-current"><span class="practice-cue-label">当前句</span><p id="practiceCue"></p></div><div class="mic-devices"><label for="micDevice">麦克风</label><select id="micDevice"><option value="">系统默认麦克风</option></select><button id="micDevices">授权并刷新</button></div><div class="practice-actions"><span class="practice-original-label">原声</span><span class="practice-recording-label">我的录音</span><button id="micStart">● 开始录音</button><button id="micStop" disabled>■ 停止</button><button id="micReplay" disabled>▶ 回放</button><button id="micSave" disabled>保存录音</button><button id="micOriginal">听原声</button><audio id="micAudio" controls hidden></audio></div><p id="practiceStatus" role="status">首次录音会请求本页的麦克风权限，录音保存在本机。最长90秒。</p></section></section>';
 roots[1].append(bar);
 roots[2].innerHTML='<style>:host{display:flex!important;flex:0 0 auto!important;align-items:center!important;height:100%!important;position:relative!important;float:none!important;clear:none!important;margin:0 5px!important;width:auto!important}:host([hidden]){display:none!important}button{font:13px system-ui;color:#fff;background:transparent;border:0;border-radius:4px;padding:0 7px;height:32px;white-space:nowrap;cursor:pointer}button:hover,button:focus-visible{background:#ffffff25;outline:1px solid #ffffff55}button[aria-pressed="true"]{color:#99e4b7}</style><button id="show" aria-pressed="false">开启字幕</button>';
 slot.append(controls);document.documentElement.append(host,slot,entry);
 const $=(id:string)=>roots[0].getElementById(id)||roots[1].getElementById(id)||roots[2].getElementById(id);
 let enabled=false,fullscreen=false,pane="subtitles",idleTimer=0,pinned=false;
 const practice=$("practice")!,notification=$("status")!;
 for(const button of roots[1].querySelectorAll<HTMLButtonElement>(".toolbar button")){button.title ||= button.textContent||"";button.setAttribute("aria-label",button.title)}
 const layoutChanged=()=>host.dispatchEvent(new Event("study-layout"));
 const hiddenSiblings=new Map<HTMLElement,{value:string;priority:string}>();
 function restore(){for(const [el,style]of hiddenSiblings){el.style.setProperty("display",style.value,style.priority)}hiddenSiblings.clear()}
 function setPane(next:string){
  pane=next;for(const el of roots[0].querySelectorAll<HTMLButtonElement>("[data-pane]")){const active=el.dataset.pane===next;el.classList.toggle("selected",active);el.setAttribute("aria-pressed",String(active))}
  for(const name of ["subtitles","explanation","vocabulary","book","practice"])$ ("pane-"+name)!.hidden=name!==next;
  wrap.classList.remove("fold");updateVisible();host.dispatchEvent(new CustomEvent("study-pane",{detail:next}));
 }
 function updateVisible(){
  host.hidden=!enabled||wrap.classList.contains("fold");
  controls.hidden=!enabled;
  entry.hidden=!entry.parentElement?.matches(".bpx-player-control-bottom-right,.bilibili-player-video-control-bottom-right")||fullscreen&&!enabled;
  $("learningControls")!.hidden=!enabled;$("show")!.setAttribute("aria-pressed",String(enabled));
  if(!fullscreen)slot.style.setProperty("display",enabled?"flow-root":"none","important");
  controls.toggleAttribute("data-enabled",enabled);
  layoutChanged();
 }
 function reveal(){
  if(!fullscreen)return;
  controls.classList.remove("idle");clearTimeout(idleTimer);
  idleTimer=window.setTimeout(()=>{if(!pinned&&!controls.matches(":hover")&&!roots[1].activeElement?.matches(":focus-visible"))controls.classList.add("idle");else reveal()},3200);
 }
 function mount(video:HTMLVideoElement|null){
  // Vue 2 production hydration walks the server DOM by position. Inserting
  // even a hidden sibling before that finishes can abort the site's mount.
  // Keep our hosts outside its root until Vue consumes the SSR marker; the
  // existing sync loop retries, without guessing a network/loading timeout.
  if(!video?.isConnected||document.querySelector("#app[data-server-rendered]"))return;
  const full=document.fullscreenElement,nowFull=!!full;
  if(nowFull!==fullscreen){fullscreen=nowFull;if(fullscreen)wrap.classList.add("fold");else if(enabled)wrap.classList.remove("fold");reveal()}
  host.toggleAttribute("data-fullscreen",fullscreen);controls.toggleAttribute("data-fullscreen",fullscreen);
  const practiceParent=fullscreen?$("learningControls")!:$("practiceHome")!;if(practice.parentNode!==practiceParent)practiceParent.append(practice);
  const statusParent=fullscreen?roots[1].querySelector(".toolbar")!:roots[0].querySelector(".head")!;if(notification.parentNode!==statusParent){if(fullscreen)statusParent.prepend(notification);else statusParent.insertBefore(notification,$("settings"))}
  const playerRoot=video.closest(".bpx-player-container,.bilibili-player,#bilibili-player")||video.parentElement;
  const nativeBar=playerRoot?.querySelector(".bpx-player-control-bottom-right,.bilibili-player-video-control-bottom-right");
  if(nativeBar&&entry.parentNode!==nativeBar){const anchor=nativeBar.querySelector(".bpx-player-ctrl-setting,.bpx-player-ctrl-playbackrate");nativeBar.insertBefore(entry,anchor)}
  if(full&&full.tagName!=="VIDEO"){
   slot.style.setProperty("display","none","important");
   restore();if(host.parentNode!==full)full.append(host);if(controls.parentNode!==full)full.append(controls);
   // Keep native login/trial toasts visible and reachable; never hide them.
   const area=full.getBoundingClientRect();let bottom=68;
   for(const notice of full.querySelectorAll<HTMLElement>(".bpx-player-toast-wrap")){
    const r=notice.getBoundingClientRect(),style=getComputedStyle(notice);
    if(r.width>0&&r.height>0&&style.visibility!=="hidden"&&style.opacity!=="0"&&r.top>=area.top+area.height*.55&&r.top<area.bottom)bottom=Math.max(bottom,Math.ceil(area.bottom-r.top+12));
   }
   controls.style.setProperty("bottom",bottom+"px","important");
  }else if(!full){
   controls.style.removeProperty("bottom");
   let player=video?.closest("#playerWrap,.player-wrap")||video?.closest("#bilibili-player,#bilibiliPlayer,.bilibili-player")||video?.closest(".bpx-player-container")||video?.parentElement;
   const column=video?.closest(".left-container");
   if(player&&column)while(player.parentElement&&player.parentElement!==column)player=player.parentElement;
   if(player){if(slot.previousElementSibling!==player)player.after(slot);slot.style.setProperty("display","flow-root","important")}
   if(controls.parentNode!==slot)slot.prepend(controls);
   const side=document.querySelector<HTMLElement>(".right-container-inner,.right-container");
   if(side&&side.getBoundingClientRect().width>=250&&!side.contains(video)){
    if(host.parentNode!==side){restore();side.prepend(host)}
    if(enabled&&!wrap.classList.contains("fold")){
     for(const el of [...side.children])if(el!==host&&el instanceof HTMLElement&&!hiddenSiblings.has(el)){hiddenSiblings.set(el,{value:el.style.getPropertyValue("display"),priority:el.style.getPropertyPriority("display")});el.style.setProperty("display","none","important")}
    }else restore();
    host.removeAttribute("data-below");host.style.setProperty("--study-panel-height",Math.max(340,innerHeight-(side.getBoundingClientRect().top+scrollY)-16)+"px");
   }else{restore();if(host.previousElementSibling!==controls)controls.after(host);host.setAttribute("data-below","")}
  }
  updateVisible();
 }
 roots[0].querySelectorAll<HTMLButtonElement>("[data-pane]").forEach(el=>el.onclick=()=>setPane(el.dataset.pane!));
 $("fold")!.onclick=()=>{wrap.classList.add("fold");restore();updateVisible()};
 $("readPanel")!.onclick=()=>{wrap.classList.toggle("fold");updateVisible();reveal()};
 document.addEventListener("pointermove",reveal,{passive:true});document.addEventListener("keydown",reveal);
 controls.addEventListener("pointerleave",reveal);
 return {host,controls,slot,entry,shadow:roots[0],wrap,$,setPane,mount,layoutChanged,
  destroy(){restore();clearTimeout(idleTimer);document.removeEventListener("pointermove",reveal);document.removeEventListener("keydown",reveal);controls.removeEventListener("pointerleave",reveal);host.remove();controls.remove();slot.remove();entry.remove()},
  setEnabled(value:boolean){enabled=value;if(!enabled){restore();wrap.classList.add("fold")}updateVisible();reveal()},
  pin(value:boolean){pinned=value;reveal()},reveal,get pane(){return pane}
 };
}
