"""No service, GPU, download or user state: exercise the real supplement policy."""
import copy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'service'))
from opening_repair import repair_opening


class OpeningRepairTest(unittest.TestCase):
    def setUp(self):
        self.audio = np.zeros(30*16000, dtype=np.float32)
        self.original = [{'start': 5.9, 'end': 13, 'text': 'Original next sentence.', 'words': []}]
        self.cue = {'start': 1, 'end': 5.85, 'text': 'A recovered complete sentence.',
                    'words': [{'start': 1, 'end': 5.85, 'word': 'A recovered complete sentence.', 'probability': .95}]}
        self.chunk = SimpleNamespace(avg_logprob=-.2, no_speech_prob=.74, compression_ratio=1)
        self.model = SimpleNamespace(transcribe=Mock(return_value=(iter([self.chunk]), None)))
        self.vad = Mock(return_value=[(.8, 5.7), (6, 8)])
    def run_repair(self, **kwargs):
        return repair_opening(self.model, self.audio, kwargs.pop('language', 'ja'), self.original,
                              lambda c, d: [copy.deepcopy(self.cue)], window_start=kwargs.pop('window_start', 0), detect_speech=self.vad, **kwargs)
    def test_uses_same_model_once_and_preserves_original_cues(self):
        before=copy.deepcopy(self.original)
        out, report=self.run_repair()
        self.assertEqual(out[1:],before);self.assertEqual(self.original,before)
        self.assertEqual(report['added'],1);self.assertTrue(report['attempted'])
        args=self.model.transcribe.call_args
        self.assertEqual(len(args.args[0]),8*16000);self.assertTrue(np.shares_memory(args.args[0],self.audio))
        self.assertEqual(args.kwargs['language'],'ja');self.model.transcribe.assert_called_once()
    def test_english_uses_transcription_without_language_switch(self):
        out, report=self.run_repair(language='en');self.assertEqual(report['added'],1)
        self.assertEqual(self.model.transcribe.call_args.kwargs['language'],'en')
    def test_noninitial_normal_short_empty_and_long_silent_openings_skip_retry(self):
        for start, first, length in [(30,5.9,30),(0,.7,30),(0,18,30),(0,5.9,6)]:
            with self.subTest(start=start,first=first,length=length):
                self.original[0]['start']=first;self.audio=np.zeros(length*16000,dtype=np.float32)
                _,report=self.run_repair(window_start=start);self.assertFalse(report['attempted'])
        self.model.transcribe.assert_not_called()
    def test_silence_music_without_speech_and_late_speech_do_not_trigger(self):
        for regions in [[],[(5.4,8)],[(0, .3)]]:
            self.vad.return_value=regions
            _,report=self.run_repair();self.assertEqual(report['reason'],'no-early-speech-evidence')
        self.model.transcribe.assert_not_called()
    def test_overlapping_truncated_duplicate_and_low_confidence_candidates_are_rejected(self):
        for patch in [{'end':6.5},{'text':'unfinished fragment'},{'text':self.original[0]['text']},
                      {'words':[{'start':1,'end':5.85,'word':'uncertain','probability':.2}]}]:
            self.model.transcribe.return_value=(iter([self.chunk]),None)
            old=copy.deepcopy(self.cue);self.cue.update(patch)
            out,report=self.run_repair();self.assertEqual(out,self.original);self.assertEqual(report['reason'],'no-safe-addition')
            self.cue=old
    def test_failed_supplement_retains_primary_result_and_returns_cacheable_version(self):
        self.model.transcribe.side_effect=RuntimeError('fixture failure')
        out,report=self.run_repair();self.assertEqual(out,self.original)
        self.assertEqual(report['reason'],'supplement-failed');self.assertEqual(report['version'],1)
    def test_near_boundary_rounding_never_overlaps_original(self):
        self.cue['end']=5.95
        out,report=self.run_repair();self.assertEqual(report['added'],1)
        self.assertEqual(out[0]['end'],5.9);self.assertGreaterEqual(out[1]['start'],out[0]['end'])


if __name__ == '__main__':
    unittest.main()
