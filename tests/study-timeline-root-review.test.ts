import { expect, it } from "vitest";
import { createCueTimeline } from "../extension/study/cue-revisions.js";

const meta = (windowStart = 0, duration = 30) => ({ windowStart, duration, resourceId: "video-a:1", model: "medium", language: "ja" });

it("retains an adopted correction when an unrelated future audio window arrives", () => {
  const timeline = createCueTimeline();
  timeline.replaceWindow([{ start: 1, end: 3, text: "元の字幕。" }], meta());
  const cue = timeline.cues[0];
  expect(timeline.edit(cue.id, cue.revision, "修正した字幕。")).not.toBeNull();
  timeline.replaceWindow([{ start: 31, end: 33, text: "次の字幕。" }], meta(30));
  expect(timeline.cues.map(c => c.text)).toEqual(["修正した字幕。", "次の字幕。"]);
  expect(timeline.cues[0].originalText).toBe("元の字幕。");
});

it("does not accept a correction against an obsolete cue revision", () => {
  const timeline = createCueTimeline();
  timeline.load([{ start: 1, end: 3, text: "元の字幕。" }], "text-a");
  const cue = timeline.cues[0];
  const edited = timeline.edit(cue.id, cue.revision, "修正した字幕。")!;
  expect(timeline.edit(cue.id, cue.revision, "遅い返答。")).toBeNull();
  expect(timeline.cues[0]).toEqual(edited);
  expect(timeline.edit(edited.id, edited.revision, edited.originalText)?.text).toBe("元の字幕。");
});

it("does not duplicate a complete old utterance into multiple fragments when another window overlaps its middle", () => {
  const timeline = createCueTimeline();
  timeline.replaceWindow([{ start: 1, end: 12, text: "同じ原文を二回表示しないでください。" }], meta(0, 30));
  timeline.replaceWindow([{ start: 5, end: 8, text: "新しい結果。" }], meta(4, 5));
  expect(timeline.cues.filter(c => c.text === "同じ原文を二回表示しないでください。").length).toBeLessThanOrEqual(1);
});

it("preserves an adopted correction on an overlap survivor after later windows are rebuilt", () => {
  const timeline = createCueTimeline();
  timeline.replaceWindow([{ start: 1, end: 12, text: "元の長い字幕。" }], meta(0, 30));
  timeline.replaceWindow([{ start: 8, end: 10, text: "新しい字幕。" }], meta(7, 10));
  const survivor = timeline.cues.find(c => c.text === "元の長い字幕。")!;
  expect(survivor).toBeDefined();
  const edited = timeline.edit(survivor.id, survivor.revision, "採用した校正。")!;
  timeline.replaceWindow([{ start: 31, end: 33, text: "次の字幕。" }], meta(30));
  expect(timeline.cues.some(c => c.id === edited.id && c.text === "採用した校正。")).toBe(true);
});

it("does not erase an adopted correction when seeking re-delivers the identical cached ASR window", () => {
  const timeline = createCueTimeline();
  const original = [{ start: 1, end: 3, text: "元の認識字幕。" }];
  timeline.replaceWindow(original, meta());
  const cue = timeline.cues[0];
  timeline.edit(cue.id, cue.revision, "採用した校正。");
  // The bounded recognizer delivers the original cached hypothesis again on
  // a manual seek, even though no acoustic text or timing has changed.
  timeline.replaceWindow(original, meta());
  expect(timeline.cues[0].text).toBe("採用した校正。");
  expect(timeline.cues[0].originalText).toBe("元の認識字幕。");
});

it("preserves unchanged corrected segments while a genuinely changed segment receives a new identity", () => {
  const timeline=createCueTimeline();
  timeline.replaceWindow([{start:1,end:3,text:"原文一。"},{start:4,end:6,text:"原文二。"}],meta());
  const [a,b]=timeline.cues;
  const edited=timeline.edit(a.id,a.revision,"校正一。")!;
  timeline.edit(b.id,b.revision,"校正二。");
  timeline.replaceWindow([{start:1,end:3,text:"原文一。"},{start:4,end:6,text:"再認識二。"}],meta());
  expect(timeline.cues[0]).toEqual(edited);
  expect(timeline.cues[1].text).toBe("再認識二。");
  expect(timeline.cues[1].id).not.toBe(b.id);
});

it("does not promote a cached older window above a newer overlapping correction", () => {
  const timeline=createCueTimeline(),original=[{start:1,end:12,text:"元の長い字幕。"}];
  timeline.replaceWindow(original,meta());
  timeline.replaceWindow([{start:8,end:10,text:"新しい字幕。"}],meta(7,10));
  const before=timeline.cues.map(c=>({...c}));
  timeline.replaceWindow(original,meta());
  expect(timeline.cues).toEqual(before);
});
