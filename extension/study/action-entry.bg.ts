// @ts-nocheck
export function isStudyVideoUrl(value) {
 try {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='www.bilibili.com'||url.port||url.username||url.password)return false;
  if(/^\/(?:[^/]+\/)?video\/(?:BV[0-9A-Za-z]{10}|av[1-9]\d*)(?:\/)?$/.test(url.pathname))return true;
  return /^\/list\/watchlater\/?$/.test(url.pathname)&&/^BV[0-9A-Za-z]{10}$/.test(url.searchParams.get('bvid')||'');
 }catch{return false}
}

// One user click may arrive before the document_idle content listener exists.
// Keep that intent for this URL; absence of a receiver never makes it a non-video page.
export function installStudyActionEntry(api=chrome){
 const pending=new Map();
 const urlKey=value=>{try{const u=new URL(value);u.hash='';return u.href}catch{return ''}};
 const badge=(id,text,title)=>{void api.action.setBadgeText?.({tabId:id,text})?.catch?.(()=>{});void api.action.setTitle?.({tabId:id,title})?.catch?.(()=>{})};
 function clear(id){const task=pending.get(id);if(task)clearTimeout(task.timer);pending.delete(id)}
 async function attempt(id,task){
  if(pending.get(id)!==task||task.inFlight)return;
  task.inFlight=true;
  try{
   const tab=await api.tabs.get(id);
   if(pending.get(id)!==task)return;
   const destination=tab.pendingUrl||tab.url;
   if(urlKey(destination)!==task.url){clear(id);badge(id,'','打开字幕助手');return}
   // Do not deliver to the previous document while navigation is pending.
   if(!tab.pendingUrl||urlKey(tab.url)===task.url){
    const reply=await api.tabs.sendMessage(id,{type:'study-toggle'},{frameId:0});
    if(reply?.ok&&pending.get(id)===task){clear(id);badge(id,'','打开字幕助手');return}
   }
  }catch{/* receiver not ready, or the tab was closed */}
  finally{task.inFlight=false}
  if(pending.get(id)!==task)return;
  if(Date.now()-task.started>=20000){clear(id);badge(id,'!','视频页尚未就绪，请刷新视频后再次点击');return}
  badge(id,'…','页面准备中，稍后打开字幕助手');
  clearTimeout(task.timer);task.timer=setTimeout(()=>void attempt(id,task),500);
 }
 const onClick=tab=>{
  const id=tab.id,url=tab.pendingUrl||tab.url;
  if(!isStudyVideoUrl(url)||id===undefined){if(id!==undefined){clear(id);badge(id,'','打开字幕助手')}return api.runtime.openOptionsPage()}
  clear(id);const task={url:urlKey(url),started:Date.now(),inFlight:false,timer:0};pending.set(id,task);return attempt(id,task);
 };
 const onUpdated=(id,change)=>{const task=pending.get(id);if(task&&(change.status==='complete'||change.url))void attempt(id,task)};
 const onRemoved=id=>clear(id);
 const onReady=(message,sender,reply)=>{
  if(message?.type!=='study-content-ready'||sender.id!==api.runtime.id||sender.frameId!==undefined&&sender.frameId!==0)return false;
  const task=pending.get(sender.tab?.id);if(task)void attempt(sender.tab.id,task);reply({ok:true});return false;
 };
 api.action.onClicked.addListener(onClick);api.tabs.onUpdated?.addListener(onUpdated);api.tabs.onRemoved.addListener(onRemoved);api.runtime.onMessage.addListener(onReady);
 return {dispose(){for(const id of pending.keys())clear(id);api.action.onClicked.removeListener?.(onClick);api.tabs.onUpdated?.removeListener(onUpdated);api.tabs.onRemoved.removeListener?.(onRemoved);api.runtime.onMessage.removeListener?.(onReady)}};
}
