import { learningAction, LIBRARY_KEY } from './learning-store.js';
import { timeLabel, type LearningCue, type VideoMaterial } from './learning-data.js';

// Keep the existing identifier so saved sentences and summary citations share records.
export function sentenceBookmark(c: LearningCue, m: VideoMaterial) {
 return {id:JSON.stringify(['sentence',m.key,m.identity,c.start,c.end,c.text]),kind:'sentence',
  bvid:m.bvid,page:m.page,cid:m.cid,language:m.language,title:m.title,route:m.route,identity:m.identity,
  start:c.start,end:c.end,offset:m.offset,text:c.text,originalText:c.originalText||c.text};
}
const element=(tag:string,text?:string,cls?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};

export function createLearningFavorites(ui:any,adapter:any) {
 let bookmarks=new Map<string,any>(),documents:any[]=[],ready=false,revision=0,loading:Promise<void>|null=null;
 const controls=new WeakMap<HTMLButtonElement,{bookmark:any;star:boolean;label:string}>();
 const pending=new Map<string,boolean>();
 function paintButton(b:HTMLButtonElement) {
  const ref=controls.get(b);if(!ref)return;
  const id=ref.bookmark.id,busy=pending.has(id),saved=busy?pending.get(id):bookmarks.has(id);
  b.textContent=ref.star?(saved?'★':'☆'):(saved?'已收藏':ref.label);
  b.classList.toggle('is-saved',!!saved);b.disabled=busy;
  b.setAttribute('aria-pressed',String(!!saved));b.setAttribute('aria-busy',String(busy));
  b.title=saved?'取消收藏此句':'收藏此句';b.setAttribute('aria-label',b.title);
 }
 function paint(){for(const b of ui.shadow.querySelectorAll('.sentence-favorite'))paintButton(b);}
 function publish(){paint();render();adapter.onLibrary({bookmarks:[...bookmarks.values()],documents});}
 function accept(data:any){bookmarks=new Map(data.bookmarks.map((b:any)=>[b.id,b]));documents=data.documents||[];ready=true;publish();}
 async function refresh() {
  if(loading)return loading;
  loading=(async()=>{
   // A write or storage event can overtake a list request, including its documents.
   // Retry that read so callers awaiting a post-write refresh receive current data.
   for(;;){const before=revision,data=await learningAction('list');if(before===revision){accept(data);return}}
  })().finally(()=>{loading=null});
  return loading;
 }
 const failed=(e:any)=>adapter.notify('收藏操作失败：'+(e?.message||'请重试'),true);
 async function change(b:any,removeOnly=false) {
  if(pending.has(b.id))return;
  pending.set(b.id,bookmarks.has(b.id));paint();
  try {
   if(!ready)await refresh();
   const remove=removeOnly||bookmarks.has(b.id);
   pending.set(b.id,bookmarks.has(b.id));paint();
   const before=revision;
   await learningAction(remove?'removeBookmark':'bookmark',remove?{id:b.id}:{bookmark:b});
   // No optimistic success: acknowledge only after the background store has persisted.
   // A newer storage event may already include another page's opposite action.
   if(before===revision){revision++;if(remove)bookmarks.delete(b.id);else bookmarks.set(b.id,{...b,at:Date.now()})}
   const saved=bookmarks.has(b.id);
   adapter.notify(saved===!remove?(remove?'已取消句子收藏。':'已收藏句子。'):(saved?'收藏状态已同步：此句已收藏。':'收藏状态已同步：此句未收藏。'),false);
  } catch(e){failed(e)} finally {pending.delete(b.id);publish()}
 }
 function sentenceButton(c:LearningCue,m:VideoMaterial,star=false,label='收藏句子') {
  const b=document.createElement('button'),bookmark=sentenceBookmark(c,m);b.type='button';
  b.className='sentence-favorite '+(star?'cue-favorite':'save-sentence');controls.set(b,{bookmark,star,label});
  b.onclick=()=>void change(bookmark);paintButton(b);
  if(!ready)void refresh().catch(failed);
  return b;
 }
 function render() {
  const target=ui.$('savedLearning');target.replaceChildren();
  for(const kind of ['video','sentence']) {
   const items=[...bookmarks.values()].filter(b=>b.kind===kind).sort((a,b)=>(b.at||0)-(a.at||0));
   const group=element('section',undefined,'favorite-group');group.dataset.kind=kind;
   group.append(element('h3',(kind==='video'?'视频收藏':'句子收藏')+'（'+items.length+'）'));
   if(!items.length)group.append(element('p',kind==='video'?'暂无视频收藏。':'暂无句子收藏。','hint'));
   for(const item of items) {
    const card=element('article',undefined,'favorite-card favorite-'+kind);card.dataset.bookmarkId=item.id;
    const start=Math.max(0,(item.start||0)+(item.offset||0)),end=Math.max(start,(item.end||0)+(item.offset||0));
    const meta=`P${item.page||1} · ${item.language==='en'?'英语':'日语'}`;
    if(kind==='video')card.append(element('strong',item.title||item.bvid),element('p',item.bvid+' · '+meta,'hint'));
    else card.append(element('p',timeLabel(start)+' – '+timeLabel(end),'favorite-time'),element('blockquote',item.text),element('p',(item.title||item.bvid)+' · '+meta,'favorite-source hint'));
    const actions=element('div',undefined,'favorite-actions'),url=new URL('https://www.bilibili.com/video/'+item.bvid+'/');
    url.searchParams.set('p',String(item.page||1));if(kind==='sentence')url.searchParams.set('t',String(start));
    const link=document.createElement('a');link.textContent=kind==='video'?'打开视频':'回看 / 重听';link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
    const current=adapter.meta();
    if(kind==='sentence'&&item.bvid===current.bvid&&(item.page||1)===(current.page||1)&&(!item.cid||!current.cid||item.cid===current.cid)) {
     const replay=document.createElement('button');replay.textContent='在此重听';replay.onclick=()=>Promise.resolve(adapter.jump(start,end)).catch(e=>adapter.notify(e.message,true));actions.append(replay);
    }
    const remove=document.createElement('button');remove.className='remove-favorite';remove.textContent=kind==='video'?'取消视频收藏':'移除收藏';remove.disabled=pending.has(item.id);
    remove.onclick=async()=>{
     if(kind==='sentence'){await change(item,true);return}
     if(pending.has(item.id))return;pending.set(item.id,true);remove.disabled=true;
     try{
      const before=revision;await learningAction('removeBookmark',{id:item.id});if(before===revision){revision++;bookmarks.delete(item.id)}
      await refresh();const kept=[...bookmarks.values()].some(b=>b.kind==='video'&&b.bvid===item.bvid&&(b.page||1)===(item.page||1)&&b.language===item.language);
      adapter.notify(kept?'视频收藏状态已同步。':'已取消视频收藏；资料转为临时缓存。',false);
     }catch(e){failed(e)}finally{pending.delete(item.id);publish()}
    };
    actions.append(remove);card.append(actions);group.append(card);
   }target.append(group);
  }
 }
 return {sentenceButton,toggle:(c:LearningCue,m:VideoMaterial)=>change(sentenceBookmark(c,m)),refresh,
  storageChanged(changes:any,area:string){
   if(area!=='local'||!changes[LIBRARY_KEY])return;
   const value=changes[LIBRARY_KEY].newValue;revision++;
   accept({bookmarks:Object.values(value?.bookmarks||{}),documents:Object.values(value?.documents||{})});
  }
 };
}
