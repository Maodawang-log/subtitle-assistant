export type SourceLanguage = "ja" | "en";
export const normalizeSourceLanguage = (value: unknown): SourceLanguage => value === "en" ? "en" : "ja";
export const sourceLanguageName = (value: unknown): string => normalizeSourceLanguage(value) === "en" ? "英语" : "日语";
export function isSourceTrack(track: { lan?: string; lang?: string }, language: SourceLanguage = "ja"): boolean {
  const code = track.lan || track.lang || "";
  return language === "en" ? /^(?:ai-)?en(?:[-_]|$)/i.test(code) : /^(?:ai-)?(?:ja|jp)(?:[-_]|$)/i.test(code);
}
export const importStorageKey = (route: string, language: SourceLanguage): string => `biliscript-study-import:${route}:${language}`;

// Keep punctuation/spacing as separate non-interactive text, preserving the
// exact subtitle for browser selection. Lowercasing is not lemmatization.
export function tokenizeEnglish(text: string) {
  return (text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu) || []).map(surface_form => ({
    surface_form, basic_form: surface_form.toLowerCase(), reading: "",
    pos: /[\p{L}\p{N}]/u.test(surface_form) ? "" : "記号", language: "en" as const
  }));
}
