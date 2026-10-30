export interface RevisionCue { start:number; end:number; text:string; id:string; revision:number; originalText:string; edited?:boolean; correctionAnchor?:string; mergedFrom?:PlainCue[] }
type PlainCue={start:number;end:number;text:string};
type CorrectionCue=PlainCue & {originalText:string;mergedFrom?:PlainCue[]};
type WindowMeta={windowStart:number;duration:number;resourceId?:string|number;model:string;language:string};
// Repair duplicate hypotheses at the same acoustic interval, never repeated
// speech at distinct times. Latest hypothesis wins within one saved window.
export function repairAsrSegments<T extends {from:number;to:number;content:string}>(items:T[],language?:string):T[]{
 const result:T[]=[];
 for(const cue of items){
  const duplicate=result.findIndex(old=>Math.abs(old.from-cue.from)<.12&&Math.min(old.to,cue.to)-Math.max(old.from,cue.from)>.9*Math.max(old.to-old.from,cue.to-cue.from));
  if(duplicate>=0)result.splice(duplicate,1);
  result.push(cue);
 }
 result.sort((a,b)=>a.from-b.from||a.to-b.to);
 if(language!=='ja')return result;
 // Only a sub-200ms, single katakana syllable touching another katakana
 // fragment is stitched. Short answers and unknown/English text stay separate.
 const tiny=(c:T)=>/^[ァ-ヺー]$/.test(c.content.trim())&&c.to-c.from<=.2;
 const stitched:T[]=[];
 for(const cue of result){
  const previous=stitched[stitched.length-1],gap=previous?cue.from-previous.to:Infinity;
  if(previous&&gap>=0&&gap<=.08&&((tiny(previous)&&/^[ァ-ヺー]{2}/.test(cue.content))||(tiny(cue)&&/[ァ-ヺー]{2}$/.test(previous.content)))){
   stitched[stitched.length-1]={...previous,to:cue.to,content:previous.content+cue.content};
  }else stitched.push(cue);
 }
 return stitched;
}
export function createCueTimeline(){
 let sequence=0,scope='',current:RevisionCue[]=[],textSource:RevisionCue[]=[],unmatched=0;
 let corrections:CorrectionCue[]=[];
 const windows=new Map<number,{start:number;end:number;order:number;cues:RevisionCue[]}>();
 const make=(c:PlainCue,source:string):RevisionCue=>({...c,originalText:c.text,id:source+':'+(++sequence),revision:sequence});
 const anchor=(c:PlainCue)=>JSON.stringify([c.start,c.end]);
 const join=(a:string,b:string)=>a.trim()+(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(a.trim().slice(-2)+b.trim().slice(0,2))?'':' ')+b.trim();
 function prepareMergeNext(id:string,revision?:number,text?:string){
  const index=current.findIndex(c=>c.id===id);
  if(index<0||index>=current.length-1)return null;
  const first=current[index],second=current[index+1];
  if(revision!==undefined&&first.revision!==revision)return null;
  const mergedFrom=[...(first.mergedFrom||[{start:first.start,end:first.end,text:first.originalText}]),...(second.mergedFrom||[{start:second.start,end:second.end,text:second.originalText}])];
  const end=Math.max(first.end,second.end);
  return {merged:{...first,end,text:join(text??first.text,second.text),originalText:mergedFrom.map(c=>c.text).reduce(join),mergedFrom,replaceAnchors:[first.correctionAnchor,second.correctionAnchor].filter((value):value is string=>!!value),edited:true,correctionAnchor:JSON.stringify([first.start,end]),revision:sequence+1},removedId:second.id,removedRevision:second.revision};
 }
 const normalized=(text:string)=>text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 function corrected(items:RevisionCue[]){
  unmatched=0;const claimed=new Set<string>();
  for(const saved of corrections){
   // A new model can align a previously corrected sentence differently. Attach
   // its text to a unique nearby whole-sentence match rather than retaining a
   // full-text sliver plus a second pinned copy at the old boundary.
   const nearby=items.filter(c=>!claimed.has(c.id)&&Math.max(c.start,saved.start)-Math.min(c.end,saved.end)<=.75);
   const exact=nearby.filter(c=>normalized(c.originalText)===normalized(saved.text));
   const source=nearby.filter(c=>normalized(c.originalText)===normalized(saved.originalText));
   const target=saved.mergedFrom?null:exact.length===1&&normalized(saved.text).length>=8?exact[0]:source.length===1?source[0]:null;
   if(target){
    const previous=current.find(c=>c.correctionAnchor===anchor(saved)&&c.start===target.start&&c.end===target.end&&c.text===saved.text);
    const pin=previous||{...target,text:saved.text,originalText:target.originalText,edited:true,correctionAnchor:anchor(saved),revision:++sequence};
    claimed.add(pin.id);items=items.map(c=>c===target?pin:c);continue;
   }
   if(!items.some(c=>c.end>saved.start&&c.start<saved.end)&&![...windows.values()].some(w=>w.end>saved.start&&w.start<saved.end))continue;
   const previous=current.find(c=>c.start===saved.start&&c.end===saved.end&&c.originalText===saved.originalText);
   const pin=previous&&previous.text===saved.text?previous:{...make(saved,scope),originalText:saved.originalText,edited:true,correctionAnchor:anchor(saved)};
   const overlapping=items.filter(c=>c.end>saved.start&&c.start<saved.end);
   if(overlapping.some(c=>claimed.has(c.id)||(Math.min(c.end,saved.end)-Math.max(c.start,saved.start))<.65*Math.min(c.end-c.start,saved.end-saved.start))){unmatched++;continue}
   // No word alignment exists for a remainder: never put a complete sentence
   // in a tiny leftover interval. Ambiguous edits stay saved for their source.
   items=items.filter(c=>!overlapping.includes(c));
   claimed.add(pin.id);
   items.push(pin);
  }
  return items.sort((a,b)=>a.start-b.start||a.end-b.end);
 }
 function rebuild(){
  const covered:Array<[number,number]>=[],next:RevisionCue[]=[];
  for(const window of [...windows.values()].sort((a,b)=>b.order-a.order)){
   for(const cue of window.cues){
    let fragments:Array<[number,number]>=[[cue.start,cue.end]];
    for(const [start,end] of covered)fragments=fragments.flatMap(([a,b])=>end<=a||start>=b?[[a,b]]:[...(a<start?[[a,start]]:[]),...(b>end?[[end,b]]:[])] as Array<[number,number]>);
    // A full utterance cannot be copied into both uncovered pieces: we have
    // no word-level alignment. Keep one longest surviving interval and the
    // original source identity so an explicit correction survives rebuilds.
    const survivor=fragments.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]))[0];
    if(survivor&&survivor[1]-survivor[0]>=Math.min(.5,cue.end-cue.start)&&survivor[1]-survivor[0]>=(cue.end-cue.start)*.5){const [start,end]=survivor,previous=current.find(c=>c.id===cue.id);
     if(previous&&(previous.start!==start||previous.end!==end)){cue.revision=++sequence}
     next.push(start===cue.start&&end===cue.end?cue:{...cue,start,end});
    }
   }
   // Empty new results also supersede the previous acoustic interval.
   covered.push([window.start,window.end]);
  }
  current=corrected(next);return current;
 }
 return {
  setCorrections(items:CorrectionCue[]){corrections=items.filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>c.start&&typeof c.text==="string"&&typeof c.originalText==="string"&&(c.text!==c.originalText||Array.isArray(c.mergedFrom)&&c.mergedFrom.length>1));},
  reapplyCorrections(){
   const reset=(c:RevisionCue)=>({...c,text:c.originalText,edited:false,correctionAnchor:undefined,revision:c.text===c.originalText?c.revision:++sequence});
   if(windows.size){for(const window of windows.values())window.cues=window.cues.map(reset);return rebuild()}
   current=corrected(textSource.map(reset));return current;
  },
  load(items:PlainCue[],resource:string){windows.clear();scope='text:'+resource;textSource=items.map(c=>make(c,scope));current=corrected(textSource);return current},
  replaceWindow(items:PlainCue[],meta:WindowMeta){
   const source=[meta.resourceId,meta.language,meta.model].join('|');
   if(scope!==source){windows.clear();scope=source}
   const start=meta.windowStart,end=start+meta.duration;
   const clean=repairAsrSegments(items.map(c=>({from:Math.max(start,c.start),to:Math.min(end,c.end),content:c.text})).filter(c=>c.to>c.from&&c.content),meta.language);
   const previous=windows.get(start),matches=(old:RevisionCue,c:{from:number;to:number;content:string})=>old.start===c.from&&old.end===c.to&&old.originalText===c.content;
   // Seeking can re-deliver the untouched acoustic cache. It is not a new
   // revision and must neither undo explicit edits nor reorder overlaps.
   if(previous?.end===end&&previous.cues.length===clean.length&&clean.every((c,i)=>matches(previous.cues[i],c)))return current;
   windows.set(start,{start,end,order:++sequence,cues:clean.map(c=>previous?.cues.find(old=>matches(old,c))||make({start:c.from,end:c.to,text:c.content},scope+':'+start))});
   return rebuild();
  },
  prepareMergeNext,
  mergeNext(id:string,revision?:number,text?:string){
   const index=current.findIndex(c=>c.id===id);
   const plan=prepareMergeNext(id,revision,text);if(!plan)return null;
   const first=current[index],second=current[index+1];
   const update={...plan.merged,revision:++sequence};
   corrections=corrections.filter(c=>anchor(c)!==first.correctionAnchor&&anchor(c)!==second.correctionAnchor&&anchor(c)!==anchor(first)&&anchor(c)!==anchor(second));
   corrections.push(update);
   // Raw windows remain intact for cache redelivery and restoring both cues.
   current=current.filter(c=>c.id!==second.id).map(c=>c.id===first.id?update:c);
   if(windows.size)rebuild();else current=corrected(textSource);
   return {...plan,merged:current.find(c=>c.id===update.id)||update};
  },
  edit(id:string,revision:number,text:string,restoreMerged=false){
   const cue=current.find(c=>c.id===id);if(!cue||cue.revision!==revision)return null;
   if(restoreMerged&&cue.mergedFrom){
    corrections=corrections.filter(c=>anchor(c)!==cue.correctionAnchor&&anchor(c)!==anchor(cue));
    const restore=(items:RevisionCue[],start=-Infinity,end=Infinity)=>items.flatMap(c=>c.originalText===cue.originalText&&c.start>=cue.start&&c.end<=cue.end?cue.mergedFrom!.filter(part=>part.end>start&&part.start<end).map(part=>make({...part,start:Math.max(part.start,start),end:Math.min(part.end,end)},scope)): c.end>cue.start&&c.start<cue.end?[{...c,text:c.originalText,edited:false,correctionAnchor:undefined,mergedFrom:undefined,revision:++sequence}]:[c]);
    if(windows.size){for(const window of windows.values())window.cues=restore(window.cues,window.start,window.end);rebuild()}else{textSource=restore(textSource);current=corrected(textSource)}
    return current.find(c=>c.start===cue.mergedFrom![0].start)||null;
   }
   const update={...cue,correctionAnchor:cue.correctionAnchor||anchor(cue),text,edited:text!==cue.originalText||!!cue.mergedFrom,revision:++sequence};
   corrections=corrections.filter(c=>anchor(c)!==cue.correctionAnchor&&(c.start!==cue.start||c.end!==cue.end));if(update.edited)corrections.push(update);
   current=current.map(c=>c===cue?update:c);
   if(!cue.mergedFrom)for(const window of windows.values())window.cues=window.cues.map(c=>c.id===id?{...c,text,edited:update.edited,revision:update.revision}:c);
   return update;
  },
  clear(){windows.clear();corrections=[];unmatched=0;scope='';current=[];textSource=[];sequence++},
  get unmatchedCorrections(){return unmatched},
  get cues(){return current}
 };
}
