import { validateMaterial, scheduleReview, materialKey, type VideoMaterial } from './learning-data.js';
import { withCorrection, type SavedCorrection } from './manual-corrections.js';

export const TEMP_KEY='biliscriptStudyTemporaryV2',LIBRARY_KEY='biliscriptStudyLibraryV1',CACHE_POLICY='biliscriptStudyCachePolicy';
export const LEGACY_AUDIO='biliscript_japanese_study_audio_cache_v1',LEGACY_AI='biliscriptJapaneseAiCache';
type Entry={at:number;value:any};
type Cache=Record<string,Entry>;
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
export const cacheLimit=(v:unknown)=>Math.max(1,Math.min(256,Number(v)||16))*1048576;
const videoKey=(b:any)=>materialKey(b.bvid+':p'+(b.page||1),b.language);
export const videoBookmarkId=(b:any)=>JSON.stringify(['video',b.bvid,b.page||1,b.language]);
const bookmarked=(saved:any,key:string)=>Object.values(saved.bookmarks).some((b:any)=>b.kind==='video'&&videoKey(b)===key);
function videoBookmark(b:any){
 if(!b||!/^BV[\da-zA-Z]{10}$/.test(b.bvid)||!['ja','en'].includes(b.language)||!Number.isInteger(b.page||1)||(b.page||1)<1)throw new Error('收藏资料无效');
 return {id:videoBookmarkId(b),kind:'video',bvid:b.bvid,page:b.page||1,language:b.language,cid:b.cid||'',title:b.title||b.bvid,route:b.route||b.bvid+':p'+(b.page||1),identity:b.identity||'',at:b.at||Date.now()};
}
export function trimCache(cache:Cache,limit:number):Cache{
 const next={...cache};let size=bytes(next);for(const [key,value] of Object.entries(next).sort((a,b)=>a[1].at-b[1].at)){if(size<=limit)break;size-=bytes({[key]:value})-1;delete next[key]}return next;
}
export function createLearningStore(storage:{get:Function;set:Function;remove:Function}){
 let queue=Promise.resolve();
 function run<T>(fn:()=>Promise<T>):Promise<T>{const next=queue.catch(()=>{}).then(fn);queue=next.then(()=>{},()=>{});return next}
 async function cacheState(){
  const data=await storage.get([TEMP_KEY,CACHE_POLICY,LEGACY_AUDIO,LEGACY_AI]),cache:Cache=structuredClone(data[TEMP_KEY]||{});
  if(Array.isArray(data[LEGACY_AUDIO]))for(const entry of data[LEGACY_AUDIO])if(entry?.key&&!cache['audio:'+entry.key])cache['audio:'+entry.key]={at:Date.now(),value:entry};
  for(const [key,entry] of Object.entries(data[LEGACY_AI]||{}) as [string,any][])if(!cache['ai:'+key])cache['ai:'+key]={at:entry.at||0,value:entry};
  if(data[LEGACY_AUDIO]||data[LEGACY_AI]){await storage.set({[TEMP_KEY]:trimCache(cache,cacheLimit(data[CACHE_POLICY]?.mib))});await storage.remove([LEGACY_AUDIO,LEGACY_AI])}
  return {cache,limit:cacheLimit(data[CACHE_POLICY]?.mib)};
 }
 async function library(){
  const saved=structuredClone((await storage.get(LIBRARY_KEY))[LIBRARY_KEY])||{version:1,documents:{},records:{},bookmarks:{},reviews:{},batches:{}};
  // Old separately pinned documents become visible as video bookmarks, without
  // moving or duplicating any transcript, conversation, sentence or word data.
  for(const m of Object.values(saved.documents) as VideoMaterial[]){const b=videoBookmark(m);if(!bookmarked(saved,m.key))saved.bookmarks[b.id]=b}
  return saved;
 }
 function promote(saved:any,cache:Cache,key:string,document?:VideoMaterial,record?:any){
  const m=document||saved.documents[key]||cache['document:'+key]?.value;
  if(m){saved.documents[key]=m;delete cache['document:'+key]}
  const r=record||saved.records[key]||cache['record:'+key]?.value;
  if(r){saved.records[key]=r;delete cache['record:'+key]}
 }
 function demote(saved:any,cache:Cache,key:string){
  for(const [prefix,table] of [['document',saved.documents],['record',saved.records]] as const){if(table[key]){cache[prefix+':'+key]={at:Date.now(),value:table[key]};delete table[key]}}
  for(const [id,b] of Object.entries(saved.bookmarks) as [string,any][])if(b.kind==='video'&&videoKey(b)===key)delete saved.bookmarks[id];
 }
 return {
  cacheGet(key:string){return run(async()=>{const {cache,limit}=await cacheState(),entry=cache[key];if(entry){entry.at=Date.now();await storage.set({[TEMP_KEY]:trimCache(cache,limit)})}return entry?.value})},
  cacheSet(key:string,value:any,canWrite=()=>true){return run(async()=>{const {cache,limit}=await cacheState();if(!canWrite())return false;cache[key]={at:Date.now(),value};await storage.set({[TEMP_KEY]:trimCache(cache,limit)});return true})},
  action(action:string,p:any={}):Promise<any>{return run(async()=>{
   if(action==='audioRead'){const {cache}=await cacheState();return Object.entries(cache).filter(([k])=>k.startsWith('audio:')).sort((a,b)=>a[1].at-b[1].at).map(([,e])=>e.value)}
   if(action==='audioWrite'){const {cache,limit}=await cacheState();for(const e of p.entries||[])cache['audio:'+e.key]={at:Date.now(),value:e};await storage.set({[TEMP_KEY]:trimCache(cache,limit)});return true}
   if(action==='cacheClear'){await storage.set({[TEMP_KEY]:{}});await storage.remove([LEGACY_AUDIO,LEGACY_AI]);return true}
   if(action==='cacheBudget'){const {cache}=await cacheState(),mib=cacheLimit(p.mib)/1048576;await storage.set({[CACHE_POLICY]:{mib},[TEMP_KEY]:trimCache(cache,mib*1048576)});return true}
   if(action==='stats'){const {cache,limit}=await cacheState(),saved=await library();return {temporaryBytes:bytes(cache),limitBytes:limit,permanentBytes:bytes(saved),documents:Object.values(saved.documents).map((m:any)=>({key:m.key,title:m.title,language:m.language,count:m.cues.length})),temporaryEntries:Object.keys(cache).length}}
   if(action==='vocabulary'){
    const storageKey='biliscriptStudyVocabulary',items=(await storage.get(storageKey))[storageKey]||[],item=p.item;
    if(!item||typeof item.term!=='string'||!['ja','en'].includes(item.language))throw new Error('词条格式无效');
    const next=items.filter((i:any)=>!(i.term===item.term&&(i.language||i.source?.language||'ja')===item.language));if(p.save)next.unshift(item);
    await storage.set({[storageKey]:next});return next;
   }
   const saved=await library();
   if(action==='get'){
    const {cache,limit}=await cacheState(),kept=bookmarked(saved,p.key)||!!saved.documents[p.key];
    if(kept){promote(saved,cache,p.key);await storage.set({[LIBRARY_KEY]:saved,[TEMP_KEY]:trimCache(cache,limit)})}
    return {document:saved.documents[p.key]||cache['document:'+p.key]?.value,record:saved.records[p.key]||cache['record:'+p.key]?.value,pinned:kept,bookmarked:kept,batches:saved.batches[p.key]||[]};
   }
   if(action==='list')return {bookmarks:Object.values(saved.bookmarks),reviews:saved.reviews,documents:Object.values(saved.documents).map((m:any)=>({key:m.key,title:m.title,language:m.language,bvid:m.bvid,page:m.page}))};
   if(action==='snapshot'||action==='pin'){
    const m=validateMaterial(p.document as VideoMaterial);const {cache,limit}=await cacheState();
    if(action==='pin'){const b=videoBookmark(m);saved.bookmarks[b.id]=b;promote(saved,cache,m.key,m,p.record)}
    else if(bookmarked(saved,m.key)||saved.documents[m.key])promote(saved,cache,m.key,m);else {const entry={at:Date.now(),value:m};if(bytes({['document:'+m.key]:entry})>limit)throw new Error('这份字幕超过临时缓存容量，请增大缓存或收藏视频');cache['document:'+m.key]=entry;}
    await storage.set({[LIBRARY_KEY]:saved,[TEMP_KEY]:trimCache(cache,limit)});return true;
   }
   if(action==='record'){const {cache,limit}=await cacheState();if(saved.documents[p.key]||bookmarked(saved,p.key))saved.records[p.key]=p.record;else {const entry={at:Date.now(),value:p.record};if(bytes({['record:'+p.key]:entry})>limit)throw new Error('这份对话超过临时缓存容量，本次仅在页面保留。可增大缓存或收藏视频');cache['record:'+p.key]=entry;}await storage.set({[LIBRARY_KEY]:saved,[TEMP_KEY]:trimCache(cache,limit)});return true}
   if(action==='videoBookmark'||action==='bookmark'&&p.bookmark?.kind==='video'){
    const b=videoBookmark(p.bookmark),key=videoKey(b),{cache,limit}=await cacheState();
    const m=p.document?validateMaterial(p.document):undefined;
    if(m&&(m.key!==key||m.bvid!==b.bvid||m.page!==b.page||m.language!==b.language))throw new Error('收藏视频与字幕资料不匹配');
    saved.bookmarks[b.id]=b;promote(saved,cache,key,m,p.record);
    await storage.set({[LIBRARY_KEY]:saved,[TEMP_KEY]:trimCache(cache,limit)});return true;
   }
   if(action==='unpin'||action==='removeBookmark'&&saved.bookmarks[p.id]?.kind==='video'){
    const key=action==='unpin'?p.key:videoKey(saved.bookmarks[p.id]),{cache,limit}=await cacheState();demote(saved,cache,key);
    await storage.set({[LIBRARY_KEY]:saved,[TEMP_KEY]:trimCache(cache,limit)});return true;
   }
   if(action==='bookmark'){const b=p.bookmark;if(!b?.id||b.kind!=='sentence'||!/^BV[\da-zA-Z]{10}$/.test(b.bvid)||!['ja','en'].includes(b.language))throw new Error('收藏资料无效');saved.bookmarks[b.id]={...b,at:Date.now()}}
   else if(action==='removeBookmark')delete saved.bookmarks[p.id];
   else if(action==='review'){if(typeof p.id!=='string')throw new Error('复习词条无效');saved.reviews[p.id]=scheduleReview(saved.reviews[p.id],!!p.remembered)}
   else if(action==='correctionWrite'){
    if(!String(p.storageKey).startsWith('biliscript-study-corrections:'))throw new Error('校对存储键无效');
    const current=(await storage.get(p.storageKey))[p.storageKey]||{};await storage.set({[p.storageKey]:withCorrection(current,p.resource,{...p.cue,batchId:undefined,editToken:crypto.randomUUID()})});return true;
   }
   else if(action==='batchCommit'||action==='batchUndo'){
    if(!String(p.storageKey).startsWith('biliscript-study-corrections:'))throw new Error('校对存储键无效');
    const all=(await storage.get(p.storageKey))[p.storageKey]||{},old=all[p.resource]||[];
    if(JSON.stringify(old)!==JSON.stringify(p.expected))throw new Error('校对记录已被其他操作修改，本次结果未采用');
    let next=all;
    if(action==='batchCommit'){
     for(const c of p.changes as SavedCorrection[])next=withCorrection(next,p.resource,{...c,batchId:p.id,editToken:p.id});
     (saved.batches[p.key]||=[]).push({id:p.id,at:Date.now(),before:old,after:next[p.resource]||[],changes:p.changes,range:p.range,undone:false});
    }else{
     const batch=(saved.batches[p.key]||[]).find((b:any)=>b.id===p.id&&!b.undone);if(!batch)throw new Error('未找到可撤销的校对');
     const changes=new Map(batch.changes.map((c:any)=>[JSON.stringify([c.start,c.end]),c]));
     // Revert only entries still matching this batch; later manual edits survive.
     let restored=old.filter((c:any)=>{const match:any=changes.get(JSON.stringify([c.start,c.end]));return !match||c.text!==match.text||c.batchId!==batch.id});
     for(const c of batch.before){const match:any=changes.get(JSON.stringify([c.start,c.end]));if(match&&old.some((o:any)=>o.start===c.start&&o.end===c.end&&o.text===match.text&&o.batchId===batch.id))restored.push(c)}
     next={...all,[p.resource]:restored};batch.undone=true;
    }
    await storage.set({[LIBRARY_KEY]:saved,[p.storageKey]:next});return {corrections:next[p.resource]||[]};
   }
   else throw new Error('未知资料操作');
   await storage.set({[LIBRARY_KEY]:saved});return true;
  })}
 };
}
export async function learningAction(action:string,payload:any={}){const r:any=await chrome.runtime.sendMessage({type:'study-learning-store',action,payload});if(!r?.ok)throw new Error(r?.error||'本地资料未保存');return r.data}
