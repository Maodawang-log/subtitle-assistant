// @ts-nocheck
import { learningAction } from './learning-store.js';
export const reviewId=(item)=>JSON.stringify([item.language||item.source?.language||'ja',item.term]);
export function createVocabularyReview(ui,options){
 const {$}=ui;let reviews={},queue=[],index=0,busy=false;
 const eligible=()=>options.items().filter(item=>(item.language||item.source?.language||'ja')===options.language());
 const button=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=fn;return b};
 function render(){
  const target=$('reviewCard');target.replaceChildren();target.hidden=false;
  const item=queue[index];if(!item){target.textContent='本轮到期词已复习完。';void refresh();return}
  if(!eligible().some(i=>reviewId(i)===reviewId(item))){index++;render();return}
  const heading=document.createElement('h3');heading.textContent=item.term;target.append(heading);
  const progress=document.createElement('p');progress.className='hint';progress.textContent=`${index+1} / ${queue.length} · 先回想释义`;target.append(progress);
  const answer=document.createElement('div');answer.hidden=true;const text=document.createElement('p');text.textContent=[item.reading,item.meaning,item.source?.sentence].filter(Boolean).join('\n');answer.append(text);
  const show=button('显示答案',()=>{answer.hidden=false;show.hidden=true});target.append(show,answer);
  for(const [label,remembered] of [['忘了 · 10分钟后',false],['记得',true]])answer.append(button(label,async()=>{if(busy)return;busy=true;for(const b of answer.querySelectorAll('button'))b.disabled=true;try{await learningAction('review',{id:reviewId(item),remembered});index++;await refresh(false);render()}catch(e){options.error(e);for(const b of answer.querySelectorAll('button'))b.disabled=false}finally{busy=false}}));
 }
 async function refresh(update=true){const data=await learningAction('list');reviews=data.reviews||{};if(update){const due=eligible().filter(i=>!reviews[reviewId(i)]||reviews[reviewId(i)].due<=Date.now());$('reviewDue').textContent=`到期 ${due.length} / 收藏 ${eligible().length}`;const next=eligible().map(i=>reviews[reviewId(i)]?.due).filter(t=>t>Date.now()).sort((a,b)=>a-b)[0];if(next)$('reviewDue').title='下次复习：'+new Date(next).toLocaleString()}}
 $('startReview').onclick=async()=>{try{await refresh();queue=eligible().filter(i=>!reviews[reviewId(i)]||reviews[reviewId(i)].due<=Date.now());index=0;render()}catch(e){options.error(e)}};
 return {refresh:()=>refresh().catch(options.error),reset(){queue=[];index=0;$('reviewCard').hidden=true;void refresh().catch(options.error)}};
}
