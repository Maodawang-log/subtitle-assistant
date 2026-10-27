"""Independent 1.2 language contracts, with private files and no inference.

All state lives below the repository's E-drive .scratch. Server functions run
in-process without ASGI lifespan/startup, sockets, GPU, weights or a real worker.
Official small.en tokenizer layout is represented by tiny synthetic metadata;
these are capability/dispatch tests, not an accuracy claim for English audio.
"""
import asyncio
import copy
from contextlib import asynccontextmanager
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import struct
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch
import uuid
import numpy as np  # Import once, outside temporary sys.modules substitutions.

NATIVE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(NATIVE))
sys.path.insert(0, str(NATIVE / "service"))
import catalog
from manager import Manager, safe_path
from model_files import inspect_model


def encode(value):
    return json.dumps(value, ensure_ascii=False).encode('utf-8')


def payloads(english_only=False):
    # small.en uses GPT-2 offsets, despite config containing many lang_ids.
    shift = -1 if english_only else 0
    vocab = {'<|endoftext|>': 50257 + shift, '<|startoftranscript|>': 50258 + shift,
             '<|en|>': 50259 + shift, '<|ja|>': 50266 + shift}
    return {
        'model.bin': struct.pack('<IH', 6, 12) + b'WhisperSpec\0' + struct.pack('<II', 3, 1) + b'private-fixture',
        'config.json': encode({'lang_ids': list(range(50259, 50357 if english_only else 50358)), 'suppress_ids': [], 'suppress_ids_begin': []}),
        'tokenizer.json': encode({'model': {'type': 'BPE', 'vocab': vocab, 'merges': []}, 'added_tokens': []}),
        'vocabulary.json': encode(list(vocab)),
    }


class PrivateFiles(unittest.TestCase):
    def setUp(self):
        self.scratch = (NATIVE.parent / '.scratch').resolve()
        self.scratch.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='language-review-', dir=self.scratch)
        self.root = Path(self.temp.name).resolve()
        assert self.root.is_relative_to(self.scratch)
        self.home = self.root / 'host'; self.home.mkdir()
        self.legacy = self.root / 'legacy'; self.legacy.mkdir()
        (self.home / 'host-config.json').write_bytes(encode({'legacyBase': str(self.legacy)}))
        (self.legacy / 'settings.json').write_bytes(encode({'default_model': 'small'}))
        self.original_settings = (self.legacy / 'settings.json').read_bytes()
        self.files = payloads()
        self.catalog = {}
        for name, japanese, english in [('small', True, True), ('medium', True, True), ('small.en', False, True), ('ja-only', True, False), ('unknown', False, False)]:
            files = payloads(name == 'small.en')
            self.catalog[name] = {'name': 'Review ' + name, 'repo': 'Systran/faster-whisper-' + name,
                                  'revision': 'a' * 40, 'japaneseSupported': japanese, 'englishSupported': english,
                                  'files': {key: {'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()} for key, value in files.items()}}
            path = self.legacy / 'models' / ('faster-whisper-' + name)
            path.mkdir(parents=True)
            for key, value in files.items(): (path / key).write_bytes(value)
        python = self.legacy / '.venv/Scripts/python.exe'
        python.parent.mkdir(parents=True); python.write_bytes(b'never executed')
        server = self.home / 'service/server.py'
        server.parent.mkdir(); server.write_text('# never executed', encoding='utf-8')
        with socket.socket() as available:
            available.bind(('127.0.0.1', 0)); self.port = available.getsockname()[1]
        self.health = None
        self.manager = Manager(self.home, catalog=copy.deepcopy(self.catalog), health_reader=lambda: self.health,
                               opener=lambda *_: self.fail('No download is allowed'), port=self.port)

    def tearDown(self):
        self.manager.cancel_download()
        if self.manager.thread: self.manager.thread.join(timeout=3)
        self.assertEqual((self.legacy / 'settings.json').read_bytes(), self.original_settings)
        assert self.root.is_relative_to(self.scratch) and not self.root.is_symlink()
        self.temp.cleanup()

    def metadata(self, languages):
        siblings = []
        for name, value in self.files.items():
            siblings.append({'rfilename': name, 'size': len(value), 'lfs': {'sha256': hashlib.sha256(value).hexdigest()}})
        return {'sha': 'b' * 40, 'siblings': siblings, 'cardData': {'language': languages}}


class CatalogLanguagesReview(PrivateFiles):
    def test_online_capabilities_are_separate_and_do_not_infer_from_untrusted_alias(self):
        cases = [
            ('review/custom', ['custom'], ['ja', 'en'], True, True),
            ('review/custom', ['custom'], ['ja'], True, False),
            ('review/custom', ['custom'], ['en'], False, True),
            ('review/custom', ['custom'], ['fr'], False, False),
            ('Systran/faster-whisper-small', ['small'], [], True, True),
            ('Systran/faster-whisper-small', ['small'], ['fr'], False, False),
            ('Systran/faster-whisper-small.en', ['small.en'], [], False, True),
            ('review/unknown', ['small.en'], [], False, False),
            ('review/unknown', ['distil-en'], [], False, False),
        ]
        for repo, aliases, languages, japanese, english in cases:
            with self.subTest(repo=repo, languages=languages):
                _, release = catalog.release_from_metadata(repo, aliases, self.metadata(languages))
                self.assertIs(release['japaneseSupported'], japanese)
                self.assertIs(release.get('englishSupported'), english)

    def test_import_recognizes_real_english_only_offsets_without_false_japanese(self):
        path = self.legacy / 'models/faster-whisper-small.en'
        result = inspect_model(path, safe_path)
        self.assertIs(result['japaneseSupported'], False)
        self.assertIs(result.get('englishSupported'), True)

    def test_multilingual_import_requires_actual_language_evidence(self):
        path = self.legacy / 'models/faster-whisper-small'
        result = inspect_model(path, safe_path)
        self.assertIs(result['japaneseSupported'], True)
        self.assertIs(result.get('englishSupported'), True)
        config = json.loads((path / 'config.json').read_bytes())
        config['lang_ids'] = [50266]
        (path / 'config.json').write_bytes(encode(config))
        result = inspect_model(path, safe_path)
        self.assertIs(result['japaneseSupported'], True)
        self.assertIs(result.get('englishSupported'), False)
        config.pop('lang_ids')
        (path / 'config.json').write_bytes(encode(config))
        result = inspect_model(path, safe_path)
        self.assertIs(result['japaneseSupported'], False)
        self.assertIs(result.get('englishSupported'), False)
        config['lang_ids'] = '50259'
        (path / 'config.json').write_bytes(encode(config))
        with self.assertRaises(ValueError): inspect_model(path, safe_path)

    def test_legacy_small_medium_are_reused_and_old_frozen_metadata_gets_capabilities(self):
        for name in ('small', 'medium'):
            self.manager.base_catalog[name].pop('englishSupported')
            self.manager.catalog[name].pop('englishSupported')
            self.manager.state['models'][name] = str(self.legacy / 'models' / ('faster-whisper-' + name))
            self.manager.state['installations'][name] = copy.deepcopy(self.manager.base_catalog[name])
        before = copy.deepcopy(self.manager.state['installations'])
        for name in ('small', 'medium'):
            status = self.manager.download(name)
            item = next(row for row in status['models'] if row['id'] == name)
            self.assertTrue(item['installed']); self.assertFalse(item['owned'])
            self.assertEqual(item['path'], str(self.legacy / 'models' / ('faster-whisper-' + name)))
            self.assertIs(item['japaneseSupported'], True)
            self.assertIs(item.get('englishSupported'), True)
            self.manager.set_default(name, language='en')
        self.assertEqual(self.manager.state['installations'], before, 'Capability compatibility must not rewrite frozen file manifests')
        self.assertFalse((self.legacy / 'managed-models').exists())


class ManagerLanguageReview(PrivateFiles):
    def test_default_language_is_japanese_and_explicit_english_allows_english_model(self):
        with self.assertRaises(ValueError): self.manager.set_default('small.en')
        with self.assertRaises(ValueError): self.manager.set_default('small.en', language='ja')
        result = self.manager.set_default('small.en', language='en')
        self.assertEqual(result['defaultModel'], 'small.en')
        self.assertIs(next(item for item in result['models'] if item['id'] == 'small.en').get('englishSupported'), True)
        with self.assertRaises(ValueError): self.manager.set_default('ja-only', language='en')
        with self.assertRaises(ValueError): self.manager.set_default('unknown', language='en')

    def test_invalid_language_cannot_change_state_or_launch(self):
        before = copy.deepcopy(self.manager.state)
        with patch('manager.subprocess.Popen') as launch:
            for language in ('fr', 'auto', '', None, ['en']):
                with self.subTest(language=language):
                    with self.assertRaises(ValueError): self.manager.set_default('small', language=language)
                    with self.assertRaises(ValueError): self.manager.start('small', language=language)
            launch.assert_not_called()
        self.assertEqual(self.manager.state, before)

    def test_start_english_launches_once_and_japanese_request_is_rejected(self):
        with patch('manager.subprocess.Popen', return_value=SimpleNamespace(pid=1900000000)) as launch, patch('manager.process_stamp', return_value=1717):
            with self.assertRaises(ValueError): self.manager.start('small.en')
            launch.assert_not_called()
            result = self.manager.start('small.en', language='en')
            self.assertTrue(result['starting']); launch.assert_called_once()
            args = launch.call_args.kwargs
            self.assertEqual(args['env']['LOCAL_ASR_PORT'], str(self.port))
            cfg = json.loads((self.home / 'service-settings.json').read_bytes())
            self.assertEqual(cfg['default_model'], 'small.en')
            self.assertEqual(cfg['model_dirs']['small.en'], str(self.legacy / 'models/faster-whisper-small.en'))

    def test_existing_service_does_not_bypass_language_validation(self):
        self.health = {'service': 'local-japanese-asr', 'default_model': 'small.en', 'model': 'small.en', 'active': False, 'queue': 0}
        with patch('manager.subprocess.Popen') as launch:
            with self.assertRaises(ValueError): self.manager.start('small.en', language='ja')
            self.assertIsNotNone(self.manager.start('small.en', language='en')['service'])
            launch.assert_not_called()

    def test_restart_handover_validate_language_before_any_stop(self):
        self.health = {'service': 'local-japanese-asr', 'base_path': str(self.legacy), 'active': False, 'queue': 0}
        with patch.object(self.manager, 'stop') as stop, patch('manager.subprocess.run') as takeover:
            with self.assertRaises(ValueError): self.manager.restart('small.en', language='ja')
            with self.assertRaises(ValueError): self.manager.handover('small.en', 'other-consumers-paused', language='ja')
            stop.assert_not_called(); takeover.assert_not_called()

    def test_dispatch_accepts_language_only_on_language_sensitive_operations(self):
        operations = [('setDefault', 'set_default', {'model': 'small.en'}), ('start', 'start', {'model': 'small.en'}),
                      ('restart', 'restart', {'model': 'small.en'}), ('handover', 'handover', {'model': 'small.en', 'confirm': 'other-consumers-paused'})]
        for action, method, args in operations:
            with self.subTest(action=action), patch.object(self.manager, method, return_value={'fixture': True}) as called:
                self.assertEqual(self.manager.dispatch(action, {**args, 'language': 'en'}), {'fixture': True})
                positional, named = called.call_args
                self.assertTrue(named.get('language') == 'en' or 'en' in positional, 'Dispatch dropped the requested language')
        for action in ('status', 'download', 'stop'):
            with self.subTest(action=action), self.assertRaises(ValueError):
                self.manager.dispatch(action, {'language': 'en'})


class ServiceLanguageReview(PrivateFiles):
    def setUp(self):
        super().setUp()
        self.original_tempdir = tempfile.tempdir
        self.environment = patch.dict(os.environ, {'LOCAL_ASR_BASE': str(self.legacy), 'LOCAL_ASR_MANAGER_CONFIG': '',
                                                   'LOCAL_ASR_MANAGER_INSTANCE': 'private-review', 'LOCAL_ASR_PORT': str(self.port)})
        self.environment.start()
        self.module_name = 'private_language_service_' + uuid.uuid4().hex
        spec = importlib.util.spec_from_file_location(self.module_name, NATIVE / 'service/server.py')
        self.server = importlib.util.module_from_spec(spec)
        sys.modules[self.module_name] = self.server
        with patch('logging.basicConfig'), patch('logging.FileHandler'):
            spec.loader.exec_module(self.server)
        self.window_module = ModuleType('window_audio')
        self.window_module.validate_audio_url = Mock(return_value=None)
        self.window_module.RemoteAudioError = ValueError
        self.window_patch = patch.dict(sys.modules, {'window_audio': self.window_module})
        self.window_patch.start()
        self.engine = SimpleNamespace(queue=0, transcribe=AsyncMock(return_value={'task': 'transcribe', 'language': 'en', 'text': 'Ask not.', 'segments': []}))
        self.server.engine = self.engine

    def tearDown(self):
        self.window_patch.stop()
        sys.modules.pop(self.module_name, None)
        tempfile.tempdir = self.original_tempdir
        self.environment.stop()
        super().tearDown()

    def window_request(self, language='en', omit=False):
        data = {'request_id': 'private:english', 'audio_url': 'https://example.com/private-unused', 'start': 12, 'duration': 1, 'model': 'small'}
        if not omit: data['language'] = language
        return SimpleNamespace(body=AsyncMock(return_value=encode(data)))

    async def read_window(self, request):
        response = await self.server.window(request)
        return json.loads(b''.join([part async for part in response.body_iterator]))

    def test_window_english_reaches_engine_and_omitted_language_remains_japanese(self):
        for language in ('en', 'ja'):
            with self.subTest(language=language):
                result = asyncio.run(self.read_window(self.window_request(language, omit=language == 'ja')))
                self.assertEqual(result['task'], 'transcribe')
                args = self.engine.transcribe.call_args
                self.assertEqual(args.args[1], language)
                self.assertEqual(args.kwargs['window']['start'], 12)
                self.assertEqual(args.kwargs['model_id'], 'small')

    def test_window_rejects_unknown_languages_before_dispatch(self):
        for language in ('fr', 'auto', '', None, ['en']):
            with self.subTest(language=language), self.assertRaises(self.server.EngineError):
                asyncio.run(self.read_window(self.window_request(language)))
        self.engine.transcribe.assert_not_called()

    def test_file_endpoint_keeps_explicit_en_and_existing_default_ja(self):
        for language in ('en', None):
            upload = self.server.UploadFile(io.BytesIO(b'private-not-decoded'), filename='private.wav')
            form = {'file': upload, 'model': 'small'}
            if language: form['language'] = language
            @asynccontextmanager
            async def body(**kwargs):
                yield form
            request = SimpleNamespace(form=body, query_params={})
            asyncio.run(self.server.transcriptions(request))
            self.assertEqual(self.engine.transcribe.call_args.args[1], language or 'ja')
            path = self.engine.transcribe.call_args.args[0]
            self.assertTrue(path.is_relative_to(self.root)); self.assertFalse(path.exists())

    def fake_model(self, languages=('ja', 'en')):
        words = [SimpleNamespace(start=.0, end=.4, word='Ask not.', probability=.9)]
        chunks = [SimpleNamespace(start=.0, end=.4, text='Ask not.', words=words),
                  SimpleNamespace(start=.5, end=.9, text='What now?', words=[SimpleNamespace(start=.5, end=.9, word=' What now?', probability=.9)])]
        return SimpleNamespace(supported_languages=list(languages), model=SimpleNamespace(is_multilingual='ja' in languages),
                               transcribe=Mock(side_effect=lambda audio, **kwargs: (iter(copy.deepcopy(chunks)), SimpleNamespace(language=kwargs['language']))))

    def run_worker(self, jobs, model):
        self.window_module.decode_window = Mock(return_value=(np.zeros(16000, dtype=np.float32), {'fixture': True}))
        sent = []
        pipe = SimpleNamespace(recv=Mock(side_effect=[*jobs, None]), send=sent.append, close=Mock())
        with patch.object(self.server, 'load_model', return_value=(model, 'int8')), patch.object(self.server, 'dll_paths', return_value=[]), patch.object(self.server, 'bounded_decode', return_value=np.zeros(16000, dtype=np.float32)):
            self.server.gpu_worker(pipe, 'cpu', 'small')
        pipe.close.assert_called_once()
        return sent

    def test_worker_file_and_window_use_transcribe_and_keep_absolute_english_timestamps(self):
        model = self.fake_model()
        jobs = [{'path': str(self.root / 'unused.wav'), 'language': 'en'},
                {'window': True, 'urls': ['never fetched'], 'start': 12, 'duration': 1, 'request_id': 'private:english', 'language': 'en'}]
        sent = self.run_worker(jobs, model)
        results = [item['result'] for item in sent if item['kind'] == 'result']
        self.assertEqual(len(results), 2, sent)
        for call in model.transcribe.call_args_list:
            self.assertEqual(call.kwargs['language'], 'en'); self.assertEqual(call.kwargs['task'], 'transcribe')
        for result in results:
            self.assertEqual(result['language'], 'en'); self.assertEqual(result['task'], 'transcribe')
            self.assertEqual(result['text'], 'Ask not. What now?')
        self.assertEqual(results[1]['timestamp_origin'], 'absolute')
        self.assertEqual(results[1]['segments'][0]['start'], 12)
        self.assertEqual(results[1]['segments'][0]['words'][0]['end'], 12.4)

    def test_worker_rejects_unsupported_language_instead_of_silent_english_fallback(self):
        model = self.fake_model(('en',))
        sent = self.run_worker([{'path': str(self.root / 'unused.wav'), 'language': 'ja'}], model)
        model.transcribe.assert_not_called()
        self.assertTrue(any(item.get('kind') == 'error' and item.get('status') == 400 for item in sent), sent)

    def test_english_only_warmup_uses_supported_language_and_transcription_task(self):
        model = self.fake_model(('en',))
        fake_whisper = ModuleType('faster_whisper')
        fake_whisper.WhisperModel = Mock(return_value=model)
        with patch.dict(sys.modules, {'faster_whisper': fake_whisper}):
            loaded, _ = self.server.load_model('cpu', 'small')
        self.assertIs(loaded, model)
        self.assertEqual(model.transcribe.call_args.kwargs['language'], 'en')
        self.assertEqual(model.transcribe.call_args.kwargs.get('task'), 'transcribe')


if __name__ == '__main__':
    unittest.main()
