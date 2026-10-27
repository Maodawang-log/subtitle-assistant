import { learningAction } from "./learning-store.js";
import type { StudyAudioCue } from "./bounded-asr.js";
import { repairAsrSegments } from "./cue-revisions.js";

// Text only: no audio, model binaries, source URLs or signed CDN tokens. Entries
// are ordered least-to-most recently used and capped again when read from disk.
export const STUDY_AUDIO_CACHE_STORAGE_KEY = "biliscript_japanese_study_audio_cache_v1";

export interface StudyAudioCacheEntry {
  key: string;
  cues: StudyAudioCue[];
  openingRepairVersion?: number;
}

export interface StudyAudioCacheStore {
  read(): Promise<StudyAudioCacheEntry[]>;
  write(entries: StudyAudioCacheEntry[]): Promise<void>;
}

function validatedEntry(raw: unknown): StudyAudioCacheEntry | undefined {
  const value = raw as { key?: unknown; cues?: unknown } | null;
  if (typeof value?.key !== "string" || value.key.length > 1000 || !Array.isArray(value.cues)) return;
  let identity: unknown;
  try { identity = JSON.parse(value.key); } catch { return; }
  if (!Array.isArray(identity) || identity.length !== 6) return;
  const [bvid, cid, language, model, start, duration] = identity;
  if (![bvid, cid, language, model].every((part) => typeof part === "string" && part.length > 0)
    || !Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0 || duration > 30) return;
  if (value.cues.length > 300) return;
  const cues: StudyAudioCue[] = [];
  for (const rawCue of value.cues) {
    const cue = rawCue as Partial<StudyAudioCue> | null;
    if (!cue || typeof cue.from !== "number" || typeof cue.to !== "number"
      || !Number.isFinite(cue.from) || !Number.isFinite(cue.to)
      || cue.from < start || cue.to > start + duration || cue.to <= cue.from
      || typeof cue.content !== "string" || !cue.content.trim() || cue.content.length > 4000) return;
    cues.push({ from: cue.from, to: cue.to, content: cue.content });
  }
  return { key: value.key, cues:repairAsrSegments(cues), ...((raw as StudyAudioCacheEntry).openingRepairVersion === 1 ? {openingRepairVersion:1} : {}) };
}

export function compactStudyAudioCache(entries:unknown[]):StudyAudioCacheEntry[]{
  const windows=new Map<string,StudyAudioCacheEntry>();
  for(const entry of entries){const valid=validatedEntry(entry);if(!valid)continue;const identity=JSON.parse(valid.key);const window=JSON.stringify(identity.slice(0,5));windows.delete(window);windows.set(window,valid)}
  return [...windows.values()];
}

export function createChromeStudyAudioCache(limit = 64): StudyAudioCacheStore {
  const maxEntries = Math.max(2, Math.min(128, Math.floor(limit)));
  return {
    async read() {
      const entries = await learningAction("audioRead");
      if (!Array.isArray(entries)) return [];
      return compactStudyAudioCache(entries).slice(-maxEntries);
    },
    async write(entries) {
      await learningAction("audioWrite",{entries:compactStudyAudioCache(entries).slice(-maxEntries)});
    }
  };
}
