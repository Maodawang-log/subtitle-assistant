import { cueFingerprint, type LearningCue } from './learning-data.js';
// Later non-overlapping cues do not invalidate an explicit snapshot operation.
export function scopeStillCurrent(snapshot:LearningCue[],current:LearningCue[]){const map=new Map(current.map(c=>[c.id,cueFingerprint(c)]));return snapshot.every(c=>map.get(c.id)===cueFingerprint(c))}
export function boundedHistory(turns:any[],budget=4500){
 const result:Array<{question:string;answer:string}>=[];let size=0;
 for(const turn of turns.slice(-4).reverse()){
  const item={question:String(turn.question||''),answer:(turn.result?.blocks||[]).map((b:any)=>b.text).join('\n')};
  // History may be shortened; original subtitle evidence is never truncated.
  if(item.answer.length>1800)item.answer=item.answer.slice(0,1800)+'（历史回答节选）';
  const n=JSON.stringify(item).length;if(size+n>budget)break;size+=n;result.unshift(item);
 }return result;
}
