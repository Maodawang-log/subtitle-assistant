// @ts-nocheck
import { normalizeSourceLanguage } from "./source-language.js";
import { renderDictionaryResults } from "./dictionary-view.js";
export function createWordPanel(ui, options) {
 const {$}=ui, key="biliscriptStudyVocabulary";let vocabulary=[],epoch=0,write=Promise.resolve(),expanded=true;
 const stars=new Set();
 const languageOf=item=>normalizeSourceLanguage(item.language??item.source?.language);
 const currentLanguage=()=>normalizeSourceLanguage(options.language?.());
 const sameWord=(item,term,language)=>item.term===term&&languageOf(item)===language;
 const persist=()=>{const snapshot=vocabulary.slice();write=write.catch(()=>{}).then(()=>chrome.storage.local.set({[key]:snapshot}));return write};
 function updateStars(){for(const item of stars){if(!item.button.isConnected){stars.delete(item);continue}const saved=vocabulary.some(x=>sameWord(x,item.term,item.language));item.button.textContent=saved?"★":"☆";item.button.setAttribute("aria-pressed",String(saved));item.button.setAttribute("aria-label",(saved?"取消收藏 ":"收藏 ")+item.term);item.button.title=saved?"取消收藏":"收藏到生词本"}}
 function renderBook(){
  const target=$("wordList");target.replaceChildren();
  const visible=vocabulary.filter(item=>languageOf(item)===currentLanguage());
  if(!visible.length){const p=document.createElement("p");p.className="empty";p.textContent="点击单词右侧的星标，收藏到这里。";target.append(p)}
  for(const item of visible){
   const card=document.createElement("article");card.className="saved-word";
   const title=document.createElement("strong"),meaning=document.createElement("p"),remove=document.createElement("button"),details=document.createElement("details"),summary=document.createElement("summary"),preview=document.createElement("span");
   title.textContent=item.term+" "+(item.reading||"");meaning.textContent=item.meaning||"";remove.textContent="移除";
   remove.onclick=()=>{vocabulary=vocabulary.filter(x=>!sameWord(x,item.term,languageOf(item)));void persist().catch(options.error);renderBook();updateStars()};
   preview.className="saved-preview";preview.textContent=item.meaning||"暂无释义";summary.append(title,preview);details.append(summary,meaning);card.append(remove,details);
   if(item.source?.sentence){const p=document.createElement("p");p.className="source-sentence";p.textContent=item.source.sentence;details.append(p)}
   if(item.source?.url&&Number.isFinite(item.source.time)){
    try{const url=new URL(item.source.url);if(url.protocol==="https:"&&url.hostname==="www.bilibili.com"&&/\/video\//.test(url.pathname)){
     url.searchParams.set("t",String(Math.max(0,Math.floor(item.source.time))));const a=document.createElement("a");a.className="source-link";a.href=url.href;a.target="_blank";a.rel="noopener noreferrer";a.textContent="回看原视频 · "+Math.floor(item.source.time/60)+":"+String(Math.floor(item.source.time%60)).padStart(2,"0");details.append(a);
    }}catch{}
   }
   target.append(card);
  }
 }
 async function show(tokens,source:any=undefined){
  const mine=++epoch,binding=options.binding(),language=currentLanguage();$("wordDetail").replaceChildren();stars.clear();expanded=true;
  const tools=document.createElement("div");tools.className="word-collapse-tools";
  const setExpanded=(value)=>{expanded=value;for(const card of $("wordDetail").querySelectorAll(".word-card")){card.querySelector(".word-toggle").setAttribute("aria-expanded",String(value));card.querySelector(".word-body").hidden=!value}};
  for(const [label,value,cls] of [["全部展开",true,"word-expand-all"],["全部折叠",false,"word-collapse-all"]]){const button=document.createElement("button");button.className=cls;button.textContent=label;button.onclick=()=>setExpanded(value);tools.append(button)}$("wordDetail").append(tools);
  const unique=new Map();for(const token of tokens){if(token.pos==="記号"||!/[\p{L}\p{N}]/u.test(token.surface_form))continue;const term=token.basic_form&&token.basic_form!=="*"?token.basic_form:token.surface_form;if(!unique.has(term))unique.set(term,token)}
  for(const [lemma,token] of unique){
   if(mine!==epoch||binding!==options.binding())return;
   const entry=language==="ja"?options.fallback(lemma,token.surface_form):undefined,card=document.createElement("article"),head=document.createElement("div"),title=document.createElement("h2"),star=document.createElement("button"),info=document.createElement("p"),meaning=document.createElement("div");
   card.className="word-card";head.className="word-heading";title.textContent=token.surface_form;star.className="word-star";star.disabled=true;stars.add({term:lemma,language,button:star});
   info.className="word-reading";info.textContent=language==="ja"?[JSTUDY.hiragana(token.reading||entry?.reading||""),"原形："+lemma,token.pos,JSTUDY.conjugation(token)].filter(Boolean).join(" · "):"查词："+lemma;
   meaning.className="word-meaning";meaning.textContent=entry?(typeof entry==="string"?entry:entry.meaning):"正在查本地词典…";
   const toggle=document.createElement("button"),body=document.createElement("div");toggle.className="word-toggle";toggle.setAttribute("aria-expanded",String(expanded));toggle.append(title);body.className="word-body";body.hidden=!expanded;
   toggle.onclick=()=>{body.hidden=!body.hidden;toggle.setAttribute("aria-expanded",String(!body.hidden))};
   head.append(toggle,star);body.append(info,meaning);card.append(head,body);
   if(options.explain){const explain=document.createElement("button");explain.className="word-explain";explain.textContent="AI 词义与变形";explain.onclick=()=>options.explain(token,source);body.append(explain)}
   $("wordDetail").append(card);updateStars();
   star.onclick=()=>{
    if(vocabulary.some(x=>sameWord(x,lemma,language)))vocabulary=vocabulary.filter(x=>!sameWord(x,lemma,language));
    else vocabulary=[{term:lemma,language,reading:language==="ja"?JSTUDY.hiragana(token.reading):"",meaning:meaning.textContent,at:Date.now(),...(source?{source:{...source}}:{})},...vocabulary].slice(0,1000);
    updateStars();renderBook();void persist().catch(options.error);
   };
   try{const r=await options.lookup((language==="ja"?[lemma,token.surface_form,token.reading,JSTUDY.hiragana(token.reading)]:[lemma,token.surface_form]).filter(Boolean),language);if(mine!==epoch||binding!==options.binding())return;
    if(r?.ok&&r.entries?.length)renderDictionaryResults(meaning,r.entries);
    else if(!entry)meaning.textContent=r?.ok?"当前词典未命中，可在设置中选择或安装词典。":r?.error||"本地词典暂不可用。";
   }catch{if(mine===epoch&&!entry)meaning.textContent="词典查询未完成，请在设置中检查。"}
   finally{star.disabled=false}
  }
 }
 chrome.storage.local.get(key).then(data=>{vocabulary=Array.isArray(data[key])?data[key].filter(x=>x&&typeof x.term==="string"):[];renderBook();updateStars()});
 chrome.storage.onChanged?.addListener((changes,area)=>{if(area==="local"&&changes[key]){vocabulary=Array.isArray(changes[key].newValue)?changes[key].newValue:[];renderBook();updateStars()}});
 $("exportWords").onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(vocabulary,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="生词.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)};
 return {show,reset(clear=false){epoch++;renderBook();if(clear){$("wordDetail").replaceChildren();const p=document.createElement("p");p.className="empty";p.textContent="点击字幕单词，或拖选片段查看释义。";$("wordDetail").append(p);stars.clear()}},get items(){return vocabulary}};
}
