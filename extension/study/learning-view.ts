import type { Evidence, GroundedBlock, GroundedResult } from './learning-ai.js';
import type { VideoMaterial } from './learning-data.js';

export interface LearningSnapshot {
 result: GroundedResult;
 evidence: Evidence[];
 material: VideoMaterial & { cueCount?: number };
 fingerprint?: string;
 configuration?: string;
 question?: string;
 at?: number;
}
export interface CitedBlock { text: string; title?: string; cues: Evidence[] }
const citationIdentity = (block:CitedBlock) => JSON.stringify(block.cues.map(c=>[c.id,c.start,c.end]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));

// Read old records without rewriting storage or inventing evidence for them.
export function learningView(snapshot: LearningSnapshot) {
 const evidence = new Map<string, Evidence>(), duplicates = new Set<string>();
 for (const cue of snapshot.evidence || []) {
  if (!cue || typeof cue.id !== 'string' || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || typeof cue.text !== 'string' || !cue.text.trim()) continue;
  if (evidence.has(cue.id)) duplicates.add(cue.id);
  evidence.set(cue.id, cue);
 }
 for (const id of duplicates) evidence.delete(id);
 const read = (items: GroundedBlock[] = []): CitedBlock[] => {
  const result: CitedBlock[] = [];
  for (const item of items) {
   if (!item || typeof item.text !== 'string' || !item.text.trim() || !Array.isArray(item.refs) || !item.refs.length || item.refs.some(id => !evidence.has(id))) continue;
   const cues = [...new Set(item.refs)].map(id => evidence.get(id)!).sort((a,b) => a.start-b.start);
   const same = result.find(block => block.text.trim() === item.text.trim() && citationIdentity(block) === citationIdentity({text:item.text,cues}));
   if (same) { same.cues = [...new Map([...same.cues,...cues].map(c => [c.id,c])).values()].sort((a,b) => a.start-b.start); continue; }
   result.push({text:item.text, ...(item.title ? {title:item.title} : {}), cues});
  }
  return result;
 };
 const supported = snapshot.result?.supported === true;
 const chapters = supported ? read(snapshot.result.chapters).sort((a,b) => a.cues[0].start-b.cues[0].start) : [];
 const blocks = supported ? read(snapshot.result.blocks) : [];
 return {
  supported, blocks,
  overview: blocks.filter(b => !chapters.some(c => c.text.trim() === b.text.trim() && citationIdentity(c) === citationIdentity(b))),
  chapters: chapters.map((c,i) => ({...c, title:c.title || `章节 ${i+1}`})),
  learning: supported ? read(snapshot.result.learning) : []
 };
}

export function snapshotStale(snapshot: LearningSnapshot, fingerprint: string, configuration: string) {
 return snapshot.fingerprint !== fingerprint || snapshot.configuration !== configuration;
}
