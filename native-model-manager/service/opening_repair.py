"""One conservative prefix retry inside the existing resident-model job."""
from __future__ import annotations
from difflib import SequenceMatcher
import math
import re
import time
import unicodedata

OPENING_REPAIR_VERSION = 1
SAMPLE_RATE = 16000
PREFIX_SECONDS = 8
TRANSCRIBE_OPTIONS = dict(task="transcribe", beam_size=5, temperature=0,
                         vad_filter=True, vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 200},
                         word_timestamps=True, condition_on_previous_text=False)


def normalized(text):
    return "".join(c for c in unicodedata.normalize("NFKC", text).casefold() if c.isalnum())


def speech_regions(audio):
    from faster_whisper.vad import get_speech_timestamps, VadOptions
    return [(r["start"] / SAMPLE_RATE, r["end"] / SAMPLE_RATE) for r in get_speech_timestamps(
        audio, VadOptions(threshold=.65, min_speech_duration_ms=300,
                          min_silence_duration_ms=300, speech_pad_ms=100))]


def coverage(start, end, regions):
    return sum(max(0, min(end, b) - max(start, a)) for a, b in regions)


def repair_opening(model, audio, language, original, split, *, window_start, detect_speech=speech_regions):
    """Never change originals. Fail closed on uncertain/truncated/overlapping additions.

    A status is returned even for negative checks, so the client can cache the
    algorithm version. Cancellation remains owned by the enclosing worker job.
    """
    report = {"version": OPENING_REPAIR_VERSION, "attempted": False, "added": 0, "reason": "ineligible"}
    started = time.perf_counter()
    def finish(reason, cues=original):
        report.update(reason=reason, seconds=round(time.perf_counter()-started, 3))
        return cues, report
    if window_start != 0 or language not in {"ja", "en"} or len(audio) < PREFIX_SECONDS*SAMPLE_RATE or not original:
        return finish("ineligible")
    first = min(c["start"] for c in original)
    if not 3 <= first <= 8:
        return finish("opening-present-or-gap-out-of-range")
    prefix = audio[:PREFIX_SECONDS*SAMPLE_RATE]
    try:
        regions = detect_speech(prefix)
        if not regions or regions[0][0] > 2.5 or coverage(0, first-.2, regions) < 1:
            return finish("no-early-speech-evidence")
        report["attempted"] = True
        chunks, _ = model.transcribe(prefix, language=language, **TRANSCRIBE_OPTIONS)
        candidates = []
        for chunk in chunks:
            logprob = getattr(chunk, "avg_logprob", float("-inf"))
            no_speech = getattr(chunk, "no_speech_prob", 1)
            if not math.isfinite(logprob) or logprob < -.6 or no_speech > .95 or (no_speech > .6 and logprob < -.35) or chunk.compression_ratio > 2.4:
                continue
            candidates.extend(split(chunk, PREFIX_SECONDS))
        accepted = []
        for cue in sorted(candidates, key=lambda c: c["start"]):
            a, b = cue["start"], cue["end"]
            words = cue.get("words") or []
            if a < 0 or b-a < .5 or a > 2.5 or b > first+.08 or not words:
                continue
            if not re.search(r"[。！？.!?][\s」』）)\"']*$", cue["text"]):
                continue
            if sum(w.get("probability", 0) for w in words)/len(words) < .65 or coverage(a, b, regions) < .65*(b-a):
                continue
            text = normalized(cue["text"])
            # Only compare the small adjoining acoustic region; repeated speech
            # at a later point in the video is never globally deduplicated.
            neighbors = [c for c in original if c["start"] < PREFIX_SECONDS+2] + accepted
            if len(text) < 4 or any(text == normalized(c["text"]) or SequenceMatcher(None, text, normalized(c["text"])).ratio() >= .8 for c in neighbors):
                continue
            if accepted and a < accepted[-1]["end"]:
                continue
            end = min(b, first)
            words = [{**w, "end": min(w["end"], end)} for w in words if w["start"] < end]
            if any(w["end"] < w["start"] for w in words):
                continue
            accepted.append({**cue, "end": end, "words": words})
        report["added"] = len(accepted)
        return finish("added" if accepted else "no-safe-addition", accepted + original)
    except Exception as exc:
        # A supplementary check cannot discard successful primary recognition.
        # Exceptions contain no CDN URLs or user text in this status.
        report["error_type"] = type(exc).__name__
        return finish("supplement-failed")
