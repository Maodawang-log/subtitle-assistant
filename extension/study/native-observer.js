// MAIN-world passive identity and playback marker. Never fetches or reads credentials.
(()=>{
 const key="__BILISCRIPT_STUDY_ROUTE_V2__";if(globalThis[key])return;
 const route=()=>{try{const u=new URL(location.href),bv=u.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1]||u.searchParams.get("bvid"),p=u.searchParams.get("p")||"1";return u.hostname==="www.bilibili.com"&&/^BV[0-9A-Za-z]{10}$/.test(bv||"")&&/^[1-9]\d*$/.test(p)?bv+":p"+p:""}catch{return ""}};
 const state={version:2,documentId:crypto.randomUUID(),timeOrigin:performance.timeOrigin,routeKey:route(),routeEpoch:0,epochStart:0,videoGeneration:0,videoEpoch:0,video:null,mediaSrc:"",previewLimit:null,previewUnknown:false,releasedLimit:null,active:true};
 let sample=null,continued=0,login=null,loginGeneration=null;
 const visible=e=>{const r=e.getBoundingClientRect();return e.isConnected&&r.width>0&&r.height>0&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none"};
 const visibleVideo=()=>[...document.querySelectorAll(".bpx-player-container video")].filter(v=>visible(v)&&v.getBoundingClientRect().width>50&&v.getBoundingClientRect().height>50).sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height})[0]||null;
 function renew(){state.videoGeneration++;state.videoEpoch=performance.now();sample=null;continued=0;if(state.video)state.video.setAttribute("data-biliscript-study-binding",state.documentId+":"+state.videoGeneration)}
 function sync(){
  const next=route();if(next!==state.routeKey){state.routeKey=next;state.routeEpoch++;state.previewLimit=null;state.previewUnknown=false;state.releasedLimit=null;login=null;loginGeneration=null;state.epochStart=performance.now();renew()}
  const v=visibleVideo();if(v!==state.video){state.video=v;state.mediaSrc=v?.currentSrc||"";renew()}
  else if(v&&state.mediaSrc!==v.currentSrc){state.mediaSrc=v.currentSrc;renew()}
  const now=performance.now(),limit=state.previewLimit;
  // Only sustained natural playback proves that an old numeric preview has lifted.
  // Seeking, buffered ranges, the login field alone, or a disappearing toast do not.
  if(v&&limit!==null&&sample&&!v.paused&&!v.seeking&&v.readyState>=2){
   const dt=(now-sample.wall)/1000,delta=v.currentTime-sample.time;
   const natural=dt>.03&&dt<2&&delta>0&&delta<=dt*Math.max(.1,v.playbackRate||1)+.35;
   continued=natural&&sample.time>limit+.1?continued+delta:0;
   if(continued>=1.2){state.releasedLimit=Math.max(state.releasedLimit||0,limit);state.previewLimit=null;state.previewUnknown=false;continued=0}
  }else continued=0;
  if(!sample||now-sample.wall>30)sample=v?{wall:now,time:v.currentTime}:null;
  const player=v?.closest(".bpx-player-container");
  const labels=player?[...player.querySelectorAll(".bpx-player-toast-confirm-login,.bpx-player-toast-confirm,.bpx-player-limit-wrap")].filter(visible):[];
  let visibleRestriction=false;
  for(const label of labels){
   const text=label.textContent||"",m=text.match(/试看\s*(\d+(?:\.\d+)?)\s*秒/);
   if(m&&Number(m[1])>0){
    const n=Number(m[1]);if(state.releasedLimit!==null&&n<=state.releasedLimit)continue;
    visibleRestriction=true;state.previewLimit=state.previewLimit===null?n:Math.min(state.previewLimit,n);
   }else if(/试看|登录.{0,8}(?:观看|继续)|付费|充电/.test(text)){visibleRestriction=true;state.previewUnknown=true}
  }
  const initial=globalThis.__INITIAL_STATE__,info=globalThis.__playinfo__?.data;
  const logged=typeof initial?.isLogin==="boolean"?initial.isLogin:null;
  if(logged===true&&login===false)loginGeneration=state.videoGeneration;
  // A later authenticated media load with all explicit restrictions cleared is
  // independent evidence. A stale true value on the initial page isn't evidence.
  if(logged===true&&loginGeneration!==null&&state.videoGeneration>loginGeneration&&!visibleRestriction&&!info?.is_preview&&!info?.is_upower_preview&&!initial?.videoData?.is_upower_preview&&!initial?.videoData?.is_upower_exclusive){
   state.releasedLimit=Math.max(state.releasedLimit||0,state.previewLimit||0);state.previewLimit=null;state.previewUnknown=false;
  }
  login=logged;
  return state;
 }
 state.sync=sync;globalThis[key]=state;
 for(const name of ["pushState","replaceState"]){const original=history[name];history[name]=function(...args){const result=original.apply(this,args);sync();return result}}
 addEventListener("pageshow",e=>{if(e.persisted){state.active=true;state.routeEpoch++;state.epochStart=performance.now();renew();sync()}});
 addEventListener("popstate",sync);addEventListener("hashchange",sync);addEventListener("pagehide",()=>{state.active=false;state.routeEpoch++;state.epochStart=performance.now()});
 for(const event of ["loadstart","emptied"])document.addEventListener(event,e=>{sync();if(e.target===state.video){state.mediaSrc=state.video.currentSrc;renew()}},true);
 document.addEventListener("seeking",e=>{if(e.target===state.video){sample=null;continued=0}},true);
 new MutationObserver(sync).observe(document,{childList:true,subtree:true});
 setInterval(sync,125);sync();
})();
