import type { RevisionCue } from './cue-revisions.js';

export const correctionStorageKey = (route:string, language:string) => 'biliscript-study-corrections:'+language+':'+route;
export type SavedCorrection = Pick<RevisionCue,'start'|'end'|'text'|'originalText'|'correctionAnchor'> & {editToken?:string;batchId?:string};
export type Corrections = Record<string,SavedCorrection[]>;
export function withCorrection(all:Corrections, resource:string, cue:SavedCorrection):Corrections {
 const items=(all[resource]||[]).filter(c=>JSON.stringify([c.start,c.end])!==cue.correctionAnchor&&(c.start!==cue.start||c.end!==cue.end));
 if(cue.text!==cue.originalText)items.push({start:cue.start,end:cue.end,text:cue.text,originalText:cue.originalText,...(cue.editToken?{editToken:cue.editToken}:{}),...(cue.batchId?{batchId:cue.batchId}:{})});
 return {...all,[resource]:items};
}
// Each write merges the latest stored resource so another video's edits survive.
export function createCorrectionWriter(storage:{get:Function;set:Function}) {
 let pending=Promise.resolve();
 return (key:string, resource:string, cue:SavedCorrection) => {
  const next=pending.catch(()=>{}).then(async()=>{
   const data=await storage.get(key);
   await storage.set({[key]:withCorrection(data[key]||{},resource,cue)});
  });
  pending=next;return next;
 };
}
