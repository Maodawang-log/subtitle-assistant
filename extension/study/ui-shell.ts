export function createStudyShell(){
 const host=document.createElement("div");host.id="biliscript-japanese-study";
 const controls=document.createElement("div");controls.id="biliscript-study-controls";
 const slot=document.createElement("div");slot.id="biliscript-study-slot";
 // The player's inner node lives in a fixed-height wrapper on real Bilibili.
 // Reserve document flow outside that wrapper; never overlay native actions.
 slot.style.cssText="display:none!important;position:relative!important;float:none!important;clear:both!important;width:auto!important;max-width:100%!important;min-width:0!important;height:auto!important;min-height:0!important;max-height:none!important;margin:10px 0 16px!important;padding:0!important;border:0!important;flex:none!important;box-sizing:border-box!important;isolation:isolate";
 const roots=[host,controls].map(node=>{const root=node.attachShadow({mode:"open"}),link=document.createElement("link");link.rel="stylesheet";link.href=chrome.runtime.getURL("study/ui.css");root.append(link);return root});
 const wrap=document.createElement("div");wrap.className="fold";
 wrap.innerHTML='<section class="panel"><header class="head"><button id="enable">开启字幕</button><p id="status" role="status" tabindex="0">字幕已关闭。</p><button id="settings" title="设置">⚙</button><button id="fold" title="收起侧边栏">×</button></header><nav class="tabs" aria-label="学习内容"><button data-pane="subtitles" class="selected" aria-pressed="true">字幕</button><button data-pane="video" aria-pressed="false">视频</button><button data-pane="explanation" aria-pressed="false">讲解</button><button data-pane="chat" aria-pressed="false">AI 对话</button><button data-pane="book" aria-pressed="false">生词本</button><button data-pane="practice" aria-pressed="false">跟读</button></nav><section id="pane-subtitles" class="pane"><div class="subtitle-tools"><button id="reload">刷新字幕</button><button id="import">导入字幕</button><span class="subtitle-export"><select id="subtitleFormat" aria-label="字幕导出格式"><option value="srt">SRT</option><option value="vtt">VTT</option><option value="txt">TXT</option></select><button id="export">导出字幕</button></span><button id="follow">跟随当前句</button><button id="batchAll">全部校对</button><button id="batchStop" hidden>停止</button><label>原语言 <select id="sourceLanguage" aria-label="当前视频原语言"><option value="ja">日语</option><option value="en">英语</option></select></label><select id="track" aria-label="日语字幕轨" hidden><option value="">自动选择日语</option></select><label>偏移 <input id="offset" aria-label="字幕偏移秒数" type="number" step=".1" value="0"> 秒</label><p id="source" class="hint">日文 CC 优先；无日文轨时本地识别。</p></div><p id="batchProgress" class="hint batch-progress" role="status"></p><div id="rows" class="scroll"><div id="current">开启后显示日语字幕</div><div id="chinese"></div></div></section><section id="pane-explanation" class="pane" hidden><div class="reading-header"><strong id="detailTitle">讲解</strong><span id="explainScope" class="source-badge"></span></div><div id="explanationResults" class="scroll"><p id="explainOriginal" class="explanation-original" hidden></p><div id="detail" class="markdown"><p class="empty">点击单词、拖选片段，或使用本句讲解。</p></div><h3 id="wordListTitle" hidden>逐词释义</h3><div id="wordDetail" class="word-detail" hidden></div></div></section><section id="pane-chat" class="pane study-chat" hidden><div id="videoConversation" class="scroll chat-messages" role="log" aria-live="polite"></div><div class="chat-footer"><label class="chat-input-label" for="chatQuestion">围绕本视频提问</label><div class="chat-input-card"><textarea id="chatQuestion" rows="3" maxlength="2000" placeholder="围绕本视频提问，继续追问…"></textarea><div class="chat-input-bar"><span class="hint">依据已取得字幕回答</span><button id="chatStop" hidden>停止</button><button id="chatSend">发送</button></div></div></div></section><section id="pane-book" class="pane" hidden><div class="scroll"><div class="reading-header"><strong>生词本</strong><button id="exportWords">导出</button></div><div class="review-tools"><button id="startReview">开始复习</button><span id="reviewDue" class="hint"></span></div><div id="reviewCard" hidden></div><div id="wordList"></div><p class="hint">词典下载安装位于设置。社区 AI 译词仅作学习参考。</p></div></section><section id="pane-video" class="pane" hidden><div class="scroll"><div class="material-header"><p id="materialRange"></p><p id="materialStorage" class="hint"></p><div class="learning-actions"><button id="bookmarkVideo" aria-pressed="false">收藏视频</button><button id="exportNotes">导出学习笔记</button></div><label class="notes-option"><input id="notesSubtitles" type="checkbox"> 附已取得字幕与已有中文</label></div><p id="learningStatus" role="status" class="hint"></p><button id="learningStop" hidden>停止任务</button><details open class="learning-section"><summary>总结与章节</summary><div class="learning-actions"><button id="summaryGenerate">生成整体总结</button></div><p id="summaryStale" class="notice" hidden>字幕或接口已更新，以下是先前结果；需要时点击总结重新生成。</p><p id="summaryScope" class="hint"></p><div id="videoSummary"></div></details><details class="learning-section"><summary>校对记录</summary><p id="batchScope" class="hint"></p><div id="batchHistory"></div></details><details class="learning-section"><summary>视频与句子收藏</summary><button id="refreshSaved">刷新收藏</button><div id="savedLearning"></div></details></div></section><section id="pane-practice" class="pane" hidden><div id="practiceHome" class="scroll"><section class="listening-section"><h3>精听</h3><div class="learning-actions"><button id="listeningToggle">开始精听</button><div class="listening-transport"><button id="listenPrev">听上一句</button><button id="listenReplay">重听本句</button><button id="listenNext">听下一句</button></div><button id="listenOriginal" disabled>揭示原文</button><button id="listenChinese" disabled>揭示中文</button><button id="listenRecord">跟读本句</button></div><p id="listeningStatus" class="hint">隐藏助手字幕，听完一句自动暂停。视频画面自带的字幕仍会显示。</p></section></div></section><dialog id="importScopeDialog" aria-labelledby="importScopeTitle"><h3 id="importScopeTitle">确认导入字幕范围</h3><p id="importScopeRange"></p><p>这份文件是否包含当前分P从头到尾的台词？停顿和片尾静默可以没有字幕。确认后按整份文件总结；选择片段字幕将改用全片音频识别。</p><div class="learning-actions"><button id="importScopeFull">完整字幕，继续总结</button><button id="importScopeAudio">片段字幕，改用全片识别</button><button id="importScopeCancel">取消</button></div></dialog><input id="subtitleFile" type="file" accept=".srt,.vtt"></section>';
 roots[0].append(wrap);
 const bar=document.createElement("div");bar.className="study-bar";
 bar.innerHTML='<section id="learningControls"><div class="toolbar"><span id="position">未载入</span><div class="transport"><button id="prev" title="上一句">← 上句</button><button id="next" title="下一句">下句 →</button><button id="pause">暂停</button><button id="replay">▶ 重播</button><button id="loop" aria-pressed="false">循环：关</button></div><div class="actions"><button id="translate" aria-pressed="false">双语字幕：关</button><button id="explain">本句讲解</button><button id="paragraph">邻近几句</button><button id="record">● 跟读</button></div><button id="readPanel" aria-expanded="false">展开侧边栏</button><button id="stopStudy" title="关闭当前视频字幕">关闭</button></div><section id="practice" hidden><header><strong>跟读练习</strong><span id="practiceTime">00:00</span><button id="practiceClose" title="收起跟读">×</button></header><p class="practice-intro">跟读当前句，录音后与原声对照。</p><div class="practice-current"><span class="practice-cue-label">当前句</span><p id="practiceCue"></p><p id="practiceChinese" hidden></p><p id="practiceChineseStatus" role="status" hidden></p></div><div class="mic-devices"><label for="micDevice">麦克风</label><select id="micDevice"><option value="">系统默认麦克风</option></select><button id="micDevices">授权并刷新</button></div><div class="practice-actions"><span class="practice-original-label">原声</span><span class="practice-recording-label">我的录音</span><button id="micStart">● 开始录音</button><button id="micStop" disabled>■ 停止</button><button id="micReplay" disabled>▶ 回放</button><button id="micSave" disabled>保存录音</button><button id="micOriginal">听原声</button><audio id="micAudio" controls hidden></audio></div><p id="practiceStatus" role="status">首次录音会请求本页的麦克风权限，录音保存在本机。最长90秒。</p></section></section>';
 roots[1].append(bar);
 slot.append(controls);document.documentElement.append(host,slot);
 const $=(id:string)=>roots[0].getElementById(id)||roots[1].getElementById(id);
 let enabled=false,preview=false,fullscreen=false,pane="subtitles",idleTimer=0,pinned=false;
 const practice=$("practice")!,notification=$("status")!;
 for(const button of roots[1].querySelectorAll<HTMLButtonElement>(".toolbar button")){button.title ||= button.textContent||"";button.setAttribute("aria-label",button.title)}
 const layoutChanged=()=>host.dispatchEvent(new Event("study-layout"));
 const hiddenSiblings=new Map<HTMLElement,{value:string;priority:string}>();
 const panelScroll=new Map<HTMLElement,{top:number;left:number}>();
 let scrollRestoreEpoch=0;
 function rememberScroll(){if(host.hidden)return;for(const el of $("pane-"+pane)!.querySelectorAll<HTMLElement>('.scroll'))panelScroll.set(el,{top:el.scrollTop,left:el.scrollLeft})}
 function restoreScroll(){for(const el of $("pane-"+pane)!.querySelectorAll<HTMLElement>('.scroll')){const saved=panelScroll.get(el);if(saved){el.scrollTop=saved.top;el.scrollLeft=saved.left}}}
 function restore(){for(const [el,style]of hiddenSiblings){el.style.setProperty("display",style.value,style.priority)}hiddenSiblings.clear()}
 function setPane(next:string){
  rememberScroll();
  pane=next;for(const el of roots[0].querySelectorAll<HTMLButtonElement>("[data-pane]")){const active=el.dataset.pane===next;el.classList.toggle("selected",active);el.setAttribute("aria-pressed",String(active))}
  for(const name of ["subtitles","video","explanation","chat","book","practice"])$ ("pane-"+name)!.hidden=name!==next;
  wrap.classList.remove("fold");updateVisible();restoreScroll();host.dispatchEvent(new CustomEvent("study-pane",{detail:next}));
 }
 function updateVisible(){
  const hide=(!enabled&&!preview)||wrap.classList.contains("fold"),reopening=host.hidden&&!hide;
  if(!host.hidden&&hide){rememberScroll();scrollRestoreEpoch++}
  host.hidden=hide;
  if(reopening){restoreScroll();const owner=++scrollRestoreEpoch;requestAnimationFrame(()=>{if(owner===scrollRestoreEpoch&&!host.hidden)restoreScroll()})}
  const panelLabel=host.hidden?"展开侧边栏":"收起侧边栏",panelButton=$("readPanel")!;
  panelButton.textContent=panelLabel;panelButton.title=panelLabel;panelButton.setAttribute("aria-label",panelLabel);panelButton.setAttribute("aria-expanded",String(!host.hidden));
  if(host.hidden)restore();
  controls.hidden=!enabled;
  $("learningControls")!.hidden=!enabled;
  if(!fullscreen)slot.style.setProperty("display",(enabled||preview)?"flow-root":"none","important");
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
  const full=document.fullscreenElement,nowFull=!!full,modeChanged=nowFull!==fullscreen;
  if(modeChanged){rememberScroll();fullscreen=nowFull;reveal()}
  host.toggleAttribute("data-fullscreen",fullscreen);controls.toggleAttribute("data-fullscreen",fullscreen);
  const practiceParent=fullscreen&&pane!=="practice"?$("learningControls")!:$("practiceHome")!;if(practice.parentNode!==practiceParent)practiceParent.append(practice);
  const statusParent=fullscreen?roots[1].querySelector(".toolbar")!:roots[0].querySelector(".head")!;if(notification.parentNode!==statusParent){if(fullscreen)statusParent.prepend(notification);else statusParent.insertBefore(notification,$("settings"))}
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
    if((enabled||preview)&&!wrap.classList.contains("fold")){
     for(const el of [...side.children])if(el!==host&&el instanceof HTMLElement&&!hiddenSiblings.has(el)){hiddenSiblings.set(el,{value:el.style.getPropertyValue("display"),priority:el.style.getPropertyPriority("display")});el.style.setProperty("display","none","important")}
    }else restore();
    host.removeAttribute("data-below");host.style.setProperty("--study-panel-height",Math.max(340,innerHeight-(side.getBoundingClientRect().top+scrollY)-16)+"px");
   }else{restore();if(host.previousElementSibling!==controls)controls.after(host);host.setAttribute("data-below","")}
  }
  updateVisible();
  if(modeChanged&&!host.hidden)restoreScroll();
 }
 roots[0].querySelectorAll<HTMLButtonElement>("[data-pane]").forEach(el=>el.onclick=()=>setPane(el.dataset.pane!));
 $("fold")!.onclick=()=>{wrap.classList.add("fold");restore();updateVisible()};
 $("readPanel")!.onclick=()=>{wrap.classList.toggle("fold");updateVisible();reveal()};
 document.addEventListener("pointermove",reveal,{passive:true});document.addEventListener("keydown",reveal);
 controls.addEventListener("pointerleave",reveal);
 updateVisible();
 return {host,controls,slot,shadow:roots[0],wrap,$,setPane,mount,layoutChanged,
  destroy(){scrollRestoreEpoch++;panelScroll.clear();restore();clearTimeout(idleTimer);document.removeEventListener("pointermove",reveal);document.removeEventListener("keydown",reveal);controls.removeEventListener("pointerleave",reveal);host.remove();controls.remove();slot.remove()},
  openPanel(){preview=!enabled;wrap.classList.remove("fold");updateVisible()},
  setEnabled(value:boolean){preview=false;enabled=value;if(!enabled){restore();wrap.classList.add("fold")}updateVisible();reveal()},
  pin(value:boolean){pinned=value;reveal()},reveal,get pane(){return pane}
 };
}
