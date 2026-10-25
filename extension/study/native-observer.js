// MAIN-world passive identity marker. No fetch, audio access, or model task.
(()=>{
 const key="__BILISCRIPT_STUDY_ROUTE_V2__";if(globalThis[key])return;
 const route=()=>{try{const u=new URL(location.href),bv=u.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1]||u.searchParams.get("bvid"),p=u.searchParams.get("p")||"1";return u.hostname==="www.bilibili.com"&&/^BV[0-9A-Za-z]{10}$/.test(bv||"")&&/^[1-9]\d*$/.test(p)?bv+":p"+p:""}catch{return ""}};
 const state={version:2,documentId:crypto.randomUUID(),timeOrigin:performance.timeOrigin,routeKey:route(),routeEpoch:0,epochStart:0,videoGeneration:0,videoEpoch:0,video:null,mediaSrc:"",previewLimit:null,previewUnknown:false,active:true};
 const visibleVideo=()=>[...document.querySelectorAll(".bpx-player-container video")].filter(v=>{const r=v.getBoundingClientRect();return v.isConnected&&r.width>50&&r.height>50&&getComputedStyle(v).visibility!=="hidden"&&getComputedStyle(v).display!=="none"}).sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height})[0]||null;
 function renew(){state.videoGeneration++;state.videoEpoch=performance.now();if(state.video)state.video.setAttribute("data-biliscript-study-binding",state.documentId+":"+state.videoGeneration)}
 function sync(){
  const next=route();if(next!==state.routeKey){state.routeKey=next;state.routeEpoch++;state.previewLimit=null;state.previewUnknown=false;state.epochStart=performance.now();state.videoEpoch=state.epochStart;state.videoGeneration++;if(state.video)state.video.setAttribute("data-biliscript-study-binding",state.documentId+":"+state.videoGeneration)}
  const v=visibleVideo();if(v!==state.video){state.video=v;state.mediaSrc=v?.currentSrc||"";renew()}
  else if(v&&state.mediaSrc!==v.currentSrc){state.mediaSrc=v.currentSrc;renew()}
  const player=state.video?.closest(".bpx-player-container");
  if(player)for(const label of player.querySelectorAll(".bpx-player-toast-confirm-login,.bpx-player-toast-confirm,.bpx-player-limit-wrap")){
   const r=label.getBoundingClientRect();if(!r.width||!r.height||getComputedStyle(label).display==="none"||getComputedStyle(label).visibility==="hidden")continue;
   const text=label.textContent||"",m=text.match(/试看\s*(\d+(?:\.\d+)?)\s*秒/);
   if(m&&Number(m[1])>0)state.previewLimit=state.previewLimit===null?Number(m[1]):Math.min(state.previewLimit,Number(m[1]));
   else if(/试看|登录.{0,8}(?:观看|继续)|付费|充电/.test(text))state.previewUnknown=true;
  }
  return state;
 }
 state.sync=sync;globalThis[key]=state;
 for(const name of ["pushState","replaceState"]){const original=history[name];history[name]=function(...args){const result=original.apply(this,args);sync();return result}}
 addEventListener("pageshow",e=>{if(e.persisted){state.active=true;state.routeEpoch++;state.epochStart=performance.now();state.videoEpoch=state.epochStart;renew();sync()}});
 addEventListener("popstate",sync);addEventListener("hashchange",sync);addEventListener("pagehide",()=>{state.active=false;state.routeEpoch++;state.epochStart=performance.now()});
 for(const event of ["loadstart","emptied"])document.addEventListener(event,e=>{sync();if(e.target===state.video){state.mediaSrc=state.video.currentSrc;renew()}},true);
 new MutationObserver(sync).observe(document,{childList:true,subtree:true});
 setInterval(sync,125);sync();
})();
