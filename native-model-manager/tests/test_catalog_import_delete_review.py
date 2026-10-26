"""Independent offline review of online-catalog parsing and destructive-file guards.

Only tiny private files under the repository's E-drive .scratch are created.
No user models, registry, ASR service, paid API, or remote weight file is used.
The WhisperSpec payload exercises format inspection, not successful inference.
"""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

NATIVE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(NATIVE))
import catalog as catalog_module
from manager import Manager, safe_path
from model_files import inspect_model


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')


def git_blob_digest(value):
    return hashlib.sha1(b'blob ' + str(len(value)).encode() + b'\0' + value).hexdigest()


class CatalogImportDeleteReview(unittest.TestCase):
    def setUp(self):
        self.scratch = (NATIVE.parent / '.scratch').resolve()
        self.scratch.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='catalog-import-delete-review-', dir=self.scratch)
        self.root = Path(self.temp.name).resolve()
        assert self.root.is_relative_to(self.scratch)
        self.home = self.root / 'host'; self.home.mkdir()
        self.legacy = self.root / 'legacy'; self.legacy.mkdir()
        (self.home / 'host-config.json').write_bytes(json_bytes({'legacyBase': str(self.legacy)}))
        self.original_settings = {'default_model': 'small', 'compute_types': {'small': 'int8_float16'}, 'retained': {'label': '保留原配置', 'value': 17}}
        (self.legacy / 'settings.json').write_bytes(json_bytes(self.original_settings))
        self.payloads = {
            'model.bin': struct.pack('<IH', 6, 12) + b'WhisperSpec\0' + struct.pack('<II', 3, 1) + b'tiny-private-test-payload',
            'config.json': json_bytes({'lang_ids': [50259, 50266], 'suppress_ids': [], 'suppress_ids_begin': []}),
            'tokenizer.json': json_bytes({'model': {'type': 'BPE', 'vocab': {'<|en|>': 50259, '<|ja|>': 50266}, 'merges': []}, 'added_tokens': [{'id': 50266, 'content': '<|ja|>'}]}),
            'vocabulary.json': json_bytes(['<|en|>', '<|ja|>', 'fixture']),
        }
        self.initial_catalog = {name: self.release(name) for name in ('small', 'medium')}
        self.health = None
        self.opened = []
        self.managers = []
        self.junctions = []
        with socket.socket() as available:
            available.bind(('127.0.0.1', 0)); self.port = available.getsockname()[1]
        self.network_guard = patch('urllib.request.urlopen', side_effect=AssertionError('Network access is forbidden in this fixture suite'))
        self.network_guard.start()
        self.manager = self.create_manager()

    def tearDown(self):
        for manager in self.managers:
            manager.cancel_download()
            if manager.thread:
                manager.thread.join(timeout=5)
                self.assertFalse(manager.thread.is_alive(), 'A private worker failed to stop')
        self.network_guard.stop()
        for junction in reversed(self.junctions):
            try:
                attributes = junction.lstat().st_file_attributes
            except FileNotFoundError:
                continue
            assert junction.parent.resolve().is_relative_to(self.root)
            if attributes & 0x400:
                os.rmdir(junction)  # Only the verified junction itself; never its target.
        assert self.root.is_relative_to(self.scratch) and not self.root.is_symlink()
        for child in self.root.rglob('*'):
            info = child.lstat()
            assert not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400)
        self.temp.cleanup()

    def release(self, name, revision='a' * 40):
        return {'repo': 'Systran/review-' + name, 'revision': revision, 'name': 'Review ' + name, 'japaneseSupported': True,
                'files': {key: {'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()} for key, value in self.payloads.items()}}

    def opener(self, url):
        self.opened.append(url)
        return io.BytesIO(self.payloads[url.rsplit('/', 1)[1]])

    def create_manager(self):
        manager = Manager(self.home, opener=self.opener, catalog=copy.deepcopy(self.initial_catalog), health_reader=lambda: self.health, port=self.port)
        self.managers.append(manager)
        return manager

    def make_model(self, name='importable', parent=None):
        directory = (parent or self.root) / name
        directory.mkdir(parents=True)
        for filename, value in self.payloads.items():
            (directory / filename).write_bytes(value)
        return directory

    def legacy_model(self, name):
        return self.make_model('faster-whisper-' + name, self.legacy / 'models')

    def import_fixture(self, name='importable'):
        path = self.make_model(name)
        result = self.manager.import_model(str(path))
        model = next(item['id'] for item in result['models'] if item.get('path') == str(path))
        return model, path

    def finish(self):
        self.manager.thread.join(timeout=5)
        self.assertFalse(self.manager.thread.is_alive())

    def metadata(self, revision='b' * 40, language=None):
        siblings = []
        for name, value in self.payloads.items():
            entry = {'rfilename': name, 'size': len(value), 'blobId': git_blob_digest(value)}
            if name == 'model.bin':
                entry['lfs'] = {'sha256': hashlib.sha256(value).hexdigest(), 'size': len(value)}
            siblings.append(entry)
        return {'sha': revision, 'siblings': siblings, 'cardData': {'language': ['en', 'ja'] if language is None else language}}

    def refresh(self, result):
        with patch.object(catalog_module, 'fetch_catalog', return_value=copy.deepcopy(result)):
            self.manager.refresh_catalog(); self.finish()

    def test_mapping_parses_literals_without_running_other_python_and_groups_aliases(self):
        source = "__import__('os').system('MUST NOT EXECUTE')\n_MODELS={'large':'Systran/review-large','large-v3':'Systran/review-large','tiny':'Systran/review-tiny'}"
        with patch('os.system') as execute:
            self.assertEqual(catalog_module.parse_mapping(source), {'Systran/review-large': ['large', 'large-v3'], 'Systran/review-tiny': ['tiny']})
            execute.assert_not_called()
        with self.assertRaises((ValueError, SyntaxError)):
            catalog_module.parse_mapping("_MODELS=__import__('os').system('MUST NOT EXECUTE')")
        for source in ["_MODELS={'bad/name':'Systran/model'}", "_MODELS={'tiny':'../../other'}", "_MODELS={}"]:
            with self.subTest(source=source), self.assertRaises(ValueError):
                catalog_module.parse_mapping(source)

    def test_remote_metadata_distinguishes_weight_sha256_and_git_blob_sha1(self):
        model, release = catalog_module.release_from_metadata('Systran/review-large', ['large', 'large-v3'], self.metadata())
        self.assertEqual(model, 'large-v3')
        self.assertEqual(release['files']['model.bin']['sha256'], hashlib.sha256(self.payloads['model.bin']).hexdigest())
        self.assertEqual(release['files']['config.json']['gitSha1'], git_blob_digest(self.payloads['config.json']))
        self.assertNotIn('sha256', release['files']['config.json'])
        bad = self.metadata(); bad['siblings'][0].pop('lfs')
        with self.assertRaises(ValueError):
            catalog_module.release_from_metadata('Systran/review-small', ['small'], bad)

    def test_explicit_online_languages_do_not_fabricate_japanese_support(self):
        cases = [(['small-fr'], ['fr'], False), (['distil-japanese'], ['ja'], True), (['brand-new'], [], False), (['small.en'], ['en'], False)]
        for aliases, languages, expected in cases:
            with self.subTest(aliases=aliases, languages=languages):
                _, release = catalog_module.release_from_metadata('Systran/review-language', aliases, self.metadata(language=languages))
                self.assertEqual(release['japaneseSupported'], expected)

    def test_catalog_refresh_uses_metadata_only_then_preserves_previous_catalog_on_failure(self):
        requests = []
        def reader(url, *args, **kwargs):
            requests.append(url)
            self.assertFalse(url.endswith('/model.bin'), 'Catalog refresh attempted a weight download')
            if url == catalog_module.MAPPING_URL:
                return b"_MODELS={'tiny':'Systran/review-tiny','large':'Systran/review-large','large-v3':'Systran/review-large'}"
            if '/api/models/' in url:
                return json_bytes(self.metadata())
            if '/resolve/' in url:
                return self.payloads[url.rsplit('/', 1)[1]]
            self.fail('Unexpected metadata request: ' + url)
        real_fetch = catalog_module.fetch_catalog
        with patch.object(catalog_module, 'fetch_catalog', side_effect=lambda **kwargs: real_fetch(reader=reader, **kwargs)):
            self.manager.refresh_catalog(); self.finish()
        self.assertEqual(self.manager.job['phase'], 'complete')
        self.assertEqual(len([url for url in requests if '/api/models/' in url]), 2)
        self.assertTrue({'tiny', 'large-v3'}.issubset(self.manager.catalog))
        before = (self.home / 'online-catalog.json').read_bytes()
        previous = copy.deepcopy(self.manager.catalog)
        with patch.object(catalog_module, 'fetch_catalog', side_effect=ValueError('offline fixture')):
            self.manager.refresh_catalog(); self.finish()
        self.assertEqual(self.manager.job['phase'], 'error')
        self.assertEqual((self.home / 'online-catalog.json').read_bytes(), before)
        self.assertEqual(self.manager.catalog, previous)
        self.assertEqual(self.opened, [])

    def test_mixed_remote_digests_are_checked_before_tiny_fixture_activation(self):
        _, release = catalog_module.release_from_metadata('Systran/review-tiny', ['tiny'], self.metadata())
        self.manager.catalog['tiny'] = release
        self.manager.download('tiny'); self.finish()
        self.assertEqual(self.manager.job['phase'], 'complete')
        installed = self.manager.installed()['tiny']
        self.assertEqual((Path(installed['path']) / 'model.bin').read_bytes(), self.payloads['model.bin'])
        self.assertTrue(all('/resolve/' + release['revision'] + '/' in url for url in self.opened))
        corrupt = copy.deepcopy(release); corrupt['files']['config.json']['gitSha1'] = '0' * 40
        self.manager.catalog['corrupt'] = corrupt
        self.manager.download('corrupt'); self.finish()
        self.assertEqual(self.manager.job['phase'], 'error')
        self.assertNotIn('corrupt', self.manager.installed())
        self.assertEqual((Path(installed['path']) / 'model.bin').read_bytes(), self.payloads['model.bin'])

    def test_import_reuses_same_directory_without_copy_download_or_source_mutation(self):
        path = self.make_model()
        before = {p.name: (p.stat().st_ino, p.read_bytes()) for p in path.iterdir()}
        first = self.manager.import_model(str(path))
        again = self.manager.import_model(str(path))
        first_ids = [m['id'] for m in first['models'] if m['installed']]
        self.assertEqual([m['id'] for m in again['models'] if m['installed']], first_ids)
        self.assertEqual(len(first_ids), 1)
        self.assertEqual({p.name: (p.stat().st_ino, p.read_bytes()) for p in path.iterdir()}, before)
        self.assertFalse(Path(again['directory']).exists())
        self.assertEqual(self.opened, [])
        restored = self.create_manager()
        self.assertEqual(restored.installed()[first_ids[0]]['path'], str(path))

    def test_local_language_requires_an_actual_japanese_token_and_valid_lang_ids(self):
        path = self.make_model()
        self.assertTrue(inspect_model(path, safe_path)['japaneseSupported'])
        (path / 'config.json').write_bytes(json_bytes({'lang_ids': [50265], 'suppress_ids': [], 'suppress_ids_begin': []}))
        (path / 'tokenizer.json').write_bytes(json_bytes({'model': {'type': 'BPE', 'vocab': {'<|fr|>': 50265}, 'merges': []}}))
        self.assertFalse(inspect_model(path, safe_path)['japaneseSupported'])
        (path / 'config.json').write_bytes(json_bytes({'suppress_ids': [], 'suppress_ids_begin': []}))
        self.assertFalse(inspect_model(path, safe_path)['japaneseSupported'])
        imported = self.manager.import_model(str(path))
        model = next(item['id'] for item in imported['models'] if item.get('path') == str(path))
        with self.assertRaisesRegex(ValueError, '日语'):
            self.manager.set_default(model)
        with self.assertRaisesRegex(ValueError, '日语'):
            self.manager.start(model)
        (path / 'config.json').write_bytes(json_bytes({'lang_ids': 'not-a-list', 'suppress_ids': [], 'suppress_ids_begin': []}))
        with self.assertRaises(ValueError):
            inspect_model(path, safe_path)

    def test_import_rejects_incomplete_and_non_whisper_data_without_fetching(self):
        path = self.make_model()
        (path / 'tokenizer.json').unlink()
        with self.assertRaises(ValueError):
            self.manager.import_model(str(path))
        (path / 'tokenizer.json').write_bytes(self.payloads['tokenizer.json'])
        for weight in [b'truncated', self.payloads['model.bin'].replace(b'WhisperSpec', b'OtherxxSpec'), struct.pack('<I', 999) + self.payloads['model.bin'][4:]]:
            with self.subTest(weight=weight[:22]):
                (path / 'model.bin').write_bytes(weight)
                with self.assertRaises(ValueError):
                    self.manager.import_model(str(path))
        self.assertEqual(self.opened, [])

    def test_import_and_future_download_directory_reject_parent_child_overlap(self):
        _, path = self.import_fixture()
        nested = self.make_model('nested', path)
        with self.assertRaises(ValueError):
            self.manager.import_model(str(nested))
        with self.assertRaises(ValueError):
            self.manager.import_model(str(self.root))
        with self.assertRaises(ValueError):
            self.manager.select_directory(str(path))
        self.assertTrue((path / 'model.bin').is_file())

    @unittest.skipUnless(os.name == 'nt', 'Windows junction boundary')
    def test_live_and_broken_junctions_are_rejected_by_import_and_directory_selection(self):
        target = self.root / 'junction-target'; target.mkdir()
        self.make_model('model', target)
        junction = self.root / 'junction'
        def quote(value):
            return "'" + str(value).replace("'", "''") + "'"
        subprocess.run(['powershell.exe', '-NoProfile', '-Command', 'New-Item -ItemType Junction -Path ' + quote(junction) + ' -Target ' + quote(target) + ' | Out-Null'], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
        self.junctions.append(junction)
        for operation in [lambda: self.manager.import_model(str(junction / 'model')), lambda: self.manager.select_directory(str(junction))]:
            with self.assertRaises(ValueError):
                operation()
        # Rename only our verified private target to leave a genuinely broken junction.
        moved = self.root / 'junction-target-moved'
        assert target.resolve().is_relative_to(self.root) and moved.parent.resolve() == self.root
        target.rename(moved)
        for operation in [lambda: self.manager.import_model(str(junction / 'model')), lambda: self.manager.select_directory(str(junction))]:
            with self.assertRaises(ValueError):
                operation()
        self.assertEqual((moved / 'model' / 'model.bin').read_bytes(), self.payloads['model.bin'])

    def test_delete_protects_default_active_queue_backend_alias_and_available_model(self):
        model, path = self.import_fixture()
        self.manager.set_default(model)
        with self.assertRaises(ValueError):
            self.manager.prepare_delete(model)
        self.manager.state['default_model'] = 'another-model'
        for health in [{'active': True}, {'queue': 1}, {'backend': {'model': model}}, {'available_models': [model]}, {'model_path': str(path)}, {'foreign': True}]:
            with self.subTest(health=health):
                self.health = health
                with self.assertRaises(ValueError):
                    self.manager.prepare_delete(model)
        self.health = None
        self.assertEqual((path / 'model.bin').read_bytes(), self.payloads['model.bin'])

    def test_health_failure_with_real_occupied_private_port_prevents_delete(self):
        model, path = self.import_fixture()
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); listener.listen(1)
            self.manager.port = listener.getsockname()[1]
            with self.assertRaisesRegex(ValueError, '端口'):
                self.manager.prepare_delete(model)
        self.assertTrue((path / 'model.bin').is_file())

    def test_live_stamped_process_without_health_prevents_delete(self):
        model, path = self.import_fixture()
        (self.home / 'managed-service.json').write_bytes(json_bytes({'pid': 777777, 'stamp': 123456}))
        with patch('manager.process_stamp', return_value=123456):
            with self.assertRaisesRegex(ValueError, '进程'):
                self.manager.prepare_delete(model)
        self.assertTrue((path / 'model.bin').is_file())

    def test_delete_token_detects_same_size_weight_change_and_cannot_be_replayed(self):
        model, path = self.import_fixture()
        token = self.manager.prepare_delete(model)['deletion']['confirm']
        weight = path / 'model.bin'; before = weight.stat()
        weight.write_bytes(self.payloads['model.bin'][:-1] + b'!')
        os.utime(weight, ns=(before.st_atime_ns, before.st_mtime_ns + 2_000_000_000))
        with self.assertRaises(ValueError):
            self.manager.delete(model, token)
        with self.assertRaises(ValueError):
            self.manager.delete(model, token)
        self.assertTrue(weight.is_file())

    def test_delete_token_expiry_and_successful_replay_are_rejected(self):
        model, path = self.import_fixture()
        token = self.manager.prepare_delete(model)['deletion']['confirm']
        self.manager.delete_tokens[token]['until'] = 0
        with self.assertRaises(ValueError):
            self.manager.delete(model, token)
        fresh = self.manager.prepare_delete(model)['deletion']['confirm']
        self.manager.delete(model, fresh)
        self.assertFalse(path.exists())
        with self.assertRaises(ValueError):
            self.manager.delete(model, fresh)

    def test_delete_preview_is_bound_to_directory_identity(self):
        model, path = self.import_fixture()
        token = self.manager.prepare_delete(model)['deletion']['confirm']
        moved = self.root / 'original-retained'
        assert path.resolve().is_relative_to(self.root) and moved.parent.resolve() == self.root
        path.rename(moved)
        self.make_model(path.name)
        with self.assertRaises(ValueError):
            self.manager.delete(model, token)
        self.assertEqual((path / 'model.bin').read_bytes(), self.payloads['model.bin'])
        self.assertEqual((moved / 'model.bin').read_bytes(), self.payloads['model.bin'])

    def test_legacy_delete_requires_explicit_old_default_change_and_preserves_extras(self):
        small = self.legacy_model('small'); medium = self.legacy_model('medium')
        extra = small / 'personal-notes.txt'; extra.write_text('keep original notes', encoding='utf-8')
        self.manager.set_default('medium')
        with self.assertRaisesRegex(ValueError, '原启动'):
            self.manager.prepare_delete('small')
        before = (self.legacy / 'settings.json').read_bytes()
        with self.assertRaises(ValueError):
            self.manager.set_legacy_default('medium', 'not-confirmed')
        self.assertEqual((self.legacy / 'settings.json').read_bytes(), before)
        self.assertEqual(list(self.home.glob('legacy-settings-backup-*.json')), [])
        self.manager.set_legacy_default('medium', 'change-original-default')
        backups = list(self.home.glob('legacy-settings-backup-*.json'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text(encoding='utf-8-sig')), self.original_settings)
        expected = {**self.original_settings, 'default_model': 'medium'}
        self.assertEqual(json.loads((self.legacy / 'settings.json').read_text(encoding='utf-8-sig')), expected)
        preview = self.manager.prepare_delete('small')['deletion']
        self.assertEqual(preview['path'], str(small))
        self.assertEqual(preview['bytes'], sum(len(value) for value in self.payloads.values()))
        self.assertIn(extra.name, preview['preservedFiles'])
        self.manager.delete('small', preview['confirm'])
        self.assertEqual(extra.read_text(encoding='utf-8'), 'keep original notes')
        self.assertEqual(list(small.iterdir()), [extra])
        self.assertEqual((medium / 'model.bin').read_bytes(), self.payloads['model.bin'])

    def test_frozen_installed_manifest_survives_new_remote_revision_and_restart(self):
        self.manager.download('small'); self.finish()
        original = copy.deepcopy(self.manager.installed()['small'])
        updated = self.release('small', 'c' * 40)
        updated['files']['model.bin']['bytes'] += 42
        self.refresh({'checkedAt': 123, 'models': {'small': updated}, 'errors': []})
        self.assertEqual(self.manager.job['phase'], 'complete')
        self.assertEqual(self.manager.installed()['small'], original)
        entry = next(model for model in self.manager.status()['models'] if model['id'] == 'small')
        self.assertEqual(entry['revision'], 'a' * 40)
        self.assertEqual(entry['availableRevision'], 'c' * 40)
        self.assertEqual(self.create_manager().installed()['small'], original)

    def test_refresh_omission_does_not_hide_already_installed_online_model(self):
        self.manager.catalog['tiny'] = self.release('tiny')
        self.manager.download('tiny'); self.finish()
        original = copy.deepcopy(self.manager.installed()['tiny'])
        self.refresh({'checkedAt': 456, 'models': {'base': self.release('base', 'd' * 40)}, 'errors': [{'repo': 'Systran/review-tiny', 'message': 'HTTPError'}]})
        self.assertEqual(self.manager.installed().get('tiny'), original)


if __name__ == '__main__':
    unittest.main()
