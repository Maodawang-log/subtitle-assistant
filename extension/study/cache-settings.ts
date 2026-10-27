import { learningAction } from './learning-store.js';
export function setupCacheSettings(){
 const $=(id:string)=>document.getElementById(id)!;
 const note=(text:string)=>{$('cacheFeedback').textContent=text};
 async function refresh(){
  const data=await learningAction('stats');($('cacheBudget') as HTMLInputElement).value=String(data.limitBytes/1048576);
  $('cacheUsage').textContent=`临时资料 ${(data.temporaryBytes/1048576).toFixed(2)} / ${(data.limitBytes/1048576).toFixed(0)} MiB · ${data.temporaryEntries} 项`;
  $('savedUsage').textContent=`已收藏视频资料 ${(data.permanentBytes/1048576).toFixed(2)} MiB · ${data.documents.length} 份字幕`;
  $('savedDocuments').replaceChildren();for(const doc of data.documents){const row=document.createElement('div'),label=document.createElement('p'),remove=document.createElement('button');row.className='saved-document';label.textContent=`${doc.title} · ${doc.language==='en'?'英语':'日语'} · ${doc.count}句`;remove.textContent='取消视频收藏…';remove.onclick=async()=>{if(!confirm('取消这个视频的收藏，并将字幕与学习记录转为临时缓存？句子、单词、校对和复习状态仍保留。'))return;try{await learningAction('unpin',{key:doc.key});await refresh();note('已取消视频收藏，资料已转为临时缓存。')}catch(e){note((e as Error).message)}};row.append(label,remove);$('savedDocuments').append(row)}
 }
 $('saveCacheBudget').onclick=async()=>{try{const mib=Number(($('cacheBudget') as HTMLInputElement).value);if(!Number.isFinite(mib)||mib<1||mib>256)throw new Error('容量请填写1–256 MiB');await learningAction('cacheBudget',{mib});await refresh();note('已保存；超过限额的临时资料按最近使用时间淘汰。')}catch(e){note((e as Error).message)}};
 $('clearTemporary').onclick=async()=>{try{await learningAction('cacheClear');await refresh();note('临时缓存已清理；长期资料、收藏、校对和复习状态保留。')}catch(e){note((e as Error).message)}};
 $('refreshCache').onclick=()=>void refresh().catch(e=>note(e.message));
 document.addEventListener('study-settings-page',event=>{if((event as CustomEvent).detail==='storage')void refresh().catch(e=>note(e.message))});
 if(location.hash==='#storage')void refresh().catch(e=>note(e.message));
}
