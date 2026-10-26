export interface RevisionCue { start:number; end:number; text:string; id:string; revision:number; originalText:string; edited?:boolean }
type PlainCue={start:number;end:number;text:string};
type WindowMeta={windowStart:number;duration:number;resourceId?:string|number;model:string;language:string};
// Repair duplicate hypotheses at the same acoustic interval, never repeated
// speech at distinct times. Latest hypothesis wins within one saved window.
export function repairAsrSegments<T extends {from:number;to:number;content:string}>(items:T[]):T[]{
 const result:T[]=[];
 for(const cue of items){
  const duplicate=result.findIndex(old=>Math.abs(old.from-cue.from)<.12&&Math.min(old.to,cue.to)-Math.max(old.from,cue.from)>.9*Math.max(old.to-old.from,cue.to-cue.from));
  if(duplicate>=0)result.splice(duplicate,1);
  result.push(cue);
 }
 return result.sort((a,b)=>a.from-b.from||a.to-b.to);
}
export function createCueTimeline(){
 let sequence=0,scope='',current:RevisionCue[]=[];
 const windows=new Map<number,{start:number;end:number;order:number;cues:RevisionCue[]}>();
 const make=(c:PlainCue,source:string):RevisionCue=>({...c,originalText:c.text,id:source+':'+(++sequence),revision:sequence});
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
    if(survivor){const [start,end]=survivor,previous=current.find(c=>c.id===cue.id);
     if(previous&&(previous.start!==start||previous.end!==end)){cue.revision=++sequence}
     next.push(start===cue.start&&end===cue.end?cue:{...cue,start,end});
    }
   }
   // Empty new results also supersede the previous acoustic interval.
   covered.push([window.start,window.end]);
  }
  current=next.sort((a,b)=>a.start-b.start||a.end-b.end);return current;
 }
 return {
  load(items:PlainCue[],resource:string){windows.clear();scope='text:'+resource;current=items.map(c=>make(c,scope));return current},
  replaceWindow(items:PlainCue[],meta:WindowMeta){
   const source=[meta.resourceId,meta.language,meta.model].join('|');
   if(scope!==source){windows.clear();scope=source}
   const start=meta.windowStart,end=start+meta.duration;
   const clean=repairAsrSegments(items.map(c=>({from:Math.max(start,c.start),to:Math.min(end,c.end),content:c.text})).filter(c=>c.to>c.from&&c.content));
   windows.set(start,{start,end,order:++sequence,cues:clean.map(c=>make({start:c.from,end:c.to,text:c.content},scope+':'+start))});
   return rebuild();
  },
  edit(id:string,revision:number,text:string){
   const cue=current.find(c=>c.id===id);if(!cue||cue.revision!==revision)return null;
   const update={...cue,text,edited:text!==cue.originalText,revision:++sequence};
   current=current.map(c=>c===cue?update:c);
   for(const window of windows.values())window.cues=window.cues.map(c=>c.id===id?{...c,text,edited:update.edited,revision:update.revision}:c);
   return update;
  },
  clear(){windows.clear();scope='';current=[];sequence++},
  get cues(){return current}
 };
}
