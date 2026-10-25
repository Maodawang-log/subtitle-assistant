// This function is serialized into MAIN. All helpers must stay inside it.
// It reads only current-page video identity, audio candidates and resource timing;
// it never fetches, reads credentials, or returns unobserved backup URLs.
export function readNativeStudyPage(){
 const no=(reason:string,message="当前播放音轨尚未建立关联，请播放几秒后重试。")=>({status:"unavailable",reason,message});
 const w=globalThis as unknown as Record<string,any>;
 const marker=w.__BILISCRIPT_STUDY_ROUTE_V2__;
 if(!marker||marker.version!==2||typeof marker.sync!=="function")return no("NO_MARKER");
 const state={...marker.sync()};if(!state.active||state.timeOrigin!==performance.timeOrigin)return no("DOCUMENT");
 const u=new URL(location.href),bvid=u.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1]||u.searchParams.get("bvid"),page=Number(u.searchParams.get("p")||1);
 if(u.hostname!=="www.bilibili.com"||!/^BV[0-9A-Za-z]{10}$/.test(bvid||"")||!Number.isInteger(page)||page<1||state.routeKey!==bvid+":p"+page)return no("ROUTE");
 const vd=w.__INITIAL_STATE__?.videoData,info=w.__playinfo__?.data;
 if(!vd||vd.bvid!==bvid||!Array.isArray(vd.pages))return no("IDENTITY");
 const selected=vd.pages.find((p:any)=>Number(p.page)===page),cid=String(selected?.cid||"");
 if(!/^\d+$/.test(cid)||String(vd.cid)!==cid)return no("CID");
 const video=state.video as HTMLVideoElement|null,player=video?.closest(".bpx-player-container");
 const visibleVideos=[...document.querySelectorAll(".bpx-player-container video")].filter(v=>{const r=v.getBoundingClientRect();return r.width>50&&r.height>50&&getComputedStyle(v).visibility!=="hidden"&&getComputedStyle(v).display!=="none"});
 if(visibleVideos.length!==1)return no("PLAYER_AMBIGUOUS");
 if(!video?.isConnected||!player||video!==[...player.querySelectorAll("video")].filter(v=>{const r=v.getBoundingClientRect();return r.width>50&&r.height>50&&getComputedStyle(v).visibility!=="hidden"&&getComputedStyle(v).display!=="none"})[0]||video.readyState<1||!video.currentSrc.startsWith("blob:"+location.origin+"/"))return no("PLAYER");
 const duration=Number(video.duration),dashDuration=Number(info?.dash?.duration),pageDuration=Number(selected.duration||vd.duration);
 if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(dashDuration)||Math.abs(duration-dashDuration)>1.5||!Number.isFinite(pageDuration)||Math.abs(duration-pageDuration)>1.5)return no("DURATION");
 const tag=video.getAttribute("data-biliscript-study-binding");if(!tag||tag!==state.documentId+":"+state.videoGeneration||video.currentSrc!==state.mediaSrc)return no("VIDEO_GENERATION");
 const visible=(e:Element)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=="hidden"&&getComputedStyle(e).display!=="none"};
 const labels=[...player.querySelectorAll(".bpx-player-toast-confirm-login,.bpx-player-toast-confirm,.bpx-player-limit-wrap")].filter(visible).map(e=>e.textContent||"");
 const previewText=labels.join(" "),match=previewText.match(/试看\s*(\d+(?:\.\d+)?)\s*秒/);
 let previewSeconds:number|null=match?Number(match[1]):null;
 if(Number.isFinite(state.previewLimit)&&state.previewLimit>0)previewSeconds=previewSeconds===null?state.previewLimit:Math.min(previewSeconds,state.previewLimit);
 const restricted=!!(state.previewUnknown||vd.is_upower_exclusive||vd.is_upower_preview||info?.is_preview||info?.is_upower_preview)||/试看|登录.{0,8}(?:观看|继续)|付费|充电/.test(previewText);
 if(restricted&&previewSeconds===null){
  const ms=Number(info?.timelength);if(Number.isFinite(ms)&&ms>0&&ms/1000<duration-1)previewSeconds=ms/1000;
  else return no("PREVIEW_UNKNOWN","页面显示观看限制，但无法确认允许识别的时长。");
 }
 const fullLoginConfirmed=w.__INITIAL_STATE__?.isLogin===true;
 const playableDuration=Math.min(duration,previewSeconds===null?(fullLoginConfirmed?duration:30):previewSeconds);
 if(!Number.isFinite(playableDuration)||playableDuration<=0||video.currentTime>=playableDuration)return no("PREVIEW_END","当前时刻已超出页面允许识别的片段。");
 const validUrl=(value:unknown)=>{
  if(typeof value!=="string"||value.length>8192)return false;
  try{const x=new URL(value);return x.protocol==="https:"&&!x.username&&!x.password&&!x.port&&(x.hostname==="upos-hz-mirrorakam.akamaized.net"||["bilivideo.com","bilivideo.cn"].some(h=>x.hostname===h||x.hostname.endsWith("."+h)))&&new RegExp("^/upgcxcode/\\d+/\\d+/"+cid+"/"+cid+"-[^/]+\\.m4s$").test(x.pathname)}catch{return false}
 };
 const resources=performance.getEntriesByType("resource") as Array<PerformanceResourceTiming&{responseStatus?:number}>;
 const audio=info?.dash?.audio;if(!Array.isArray(audio))return no("NO_AUDIO");
 const candidates=audio.map((track:any)=>({bandwidth:Number(track.bandwidth)||Infinity,urls:[track.baseUrl,track.base_url,...(Array.isArray(track.backupUrl)?track.backupUrl:[]),...(Array.isArray(track.backup_url)?track.backup_url:[])].filter(validUrl)})).sort((a:any,b:any)=>a.bandwidth-b.bandwidth);
 for(const candidate of candidates)for(const url of [...new Set<string>(candidate.urls)]){
  const entry=resources.filter(e=>e.name===url&&e.responseStatus===206&&["xmlhttprequest","fetch","video","other"].includes(e.initiatorType)&&e.startTime>=state.epochStart&&e.startTime>=state.videoEpoch&&e.responseEnd>=e.startTime&&e.duration>0).sort((a,b)=>b.startTime-a.startTime)[0];
  if(!entry)continue;
  const now=marker.sync();if(now.routeEpoch!==state.routeEpoch||now.videoGeneration!==state.videoGeneration||now.routeKey!==bvid+":p"+page||video.currentSrc!==state.mediaSrc)return no("STALE");
  const list=vd.subtitle?.list,present=Array.isArray(list),ja=present?list.filter((t:any)=>/^(?:ai-)?(?:ja|jp)(?:[-_]|$)/i.test(String(t.lan||""))).length:0;
  return {status:"ready",bvid,cid,title:String(vd.title||"").slice(0,512),duration,playableDuration,subtitleListPresent:present,japaneseTrackCount:ja,
   source:{url,backupUrls:[]},binding:{documentId:state.documentId,timeOrigin:state.timeOrigin,routeKey:state.routeKey,routeEpoch:state.routeEpoch,videoGeneration:state.videoGeneration,videoTag:tag,mediaSrc:state.mediaSrc},
   audit:{exactUrlMatch:true,responseStatus:206,requestStart:entry.startTime,epochStart:state.epochStart,videoEpoch:state.videoEpoch,cidPathMatch:true,previewSeconds,accessScope:previewSeconds!==null?"preview":fullLoginConfirmed?"logged-in-current-player":"initial-window",host:new URL(url).hostname}};
 }
 return no("NO_PLAYED_AUDIO");
}
