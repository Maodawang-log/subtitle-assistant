"""Independent import/delete regressions, entirely inside generated fixtures."""
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import struct
import sys
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(NATIVE))
from manager import Manager


class RootManagerReview(unittest.TestCase):
    def setUp(self):
        self.scratch = NATIVE.parent / '.scratch'
        self.temp = tempfile.TemporaryDirectory(prefix='root-model-review-', dir=self.scratch)
        self.root = Path(self.temp.name).resolve()
        self.assertTrue(self.root.is_relative_to(self.scratch.resolve()))
        self.home, self.legacy = self.root / 'host', self.root / 'legacy'
        self.home.mkdir(); self.legacy.mkdir()
        (self.home / 'host-config.json').write_text(json.dumps({'legacyBase': str(self.legacy)}))
        (self.legacy / 'settings.json').write_text(json.dumps({'default_model': 'medium'}))
        self.files = {
            'model.bin': struct.pack('<I', 6) + b'\x0c\x00WhisperSpec\x00' + struct.pack('<I', 3) + b'fixture-data',
            'config.json': json.dumps({'suppress_ids': [], 'suppress_ids_begin': [], 'lang_ids': [50266]}).encode(),
            'tokenizer.json': b'{"model":{"type":"BPE","vocab":{"<|ja|>":50266}},"added_tokens":[]}',
            'vocabulary.txt': b'fixture-vocabulary'
        }
        self.release = {'repo': 'Systran/fixture', 'revision': 'a' * 40, 'name': 'Fixture', 'files': {
            name: {'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()} for name, value in self.files.items()
        }}
        self.model(self.legacy / 'models' / 'faster-whisper-medium')
        self.health = None
        self.manager = Manager(self.home, catalog={'small': self.release.copy(), 'medium': self.release.copy()},
                               opener=lambda url: io.BytesIO(self.files[url.rsplit('/', 1)[-1]]), health_reader=lambda: self.health)
        with socket.socket() as free:
            free.bind(('127.0.0.1', 0)); self.manager.port = free.getsockname()[1]

    def tearDown(self):
        self.manager.cancel_download()
        if self.manager.thread: self.manager.thread.join(timeout=3)
        self.assertTrue(self.root.is_relative_to(self.scratch.resolve()))
        self.temp.cleanup()

    def model(self, path):
        path.mkdir(parents=True)
        for name, value in self.files.items(): (path / name).write_bytes(value)
        return path

    def imported(self):
        path = self.model(self.root / 'external-model')
        state = self.manager.import_model(str(path))
        return path, next(m['id'] for m in state['models'] if m.get('path') == str(path))

    def test_import_reuses_files_and_deletes_only_explicit_model_files(self):
        path, model = self.imported()
        sentinel = path / 'my-notes.txt'; sentinel.write_text('must remain')
        nested = path / 'other-data'; nested.mkdir(); (nested / 'keep.txt').write_text('keep')
        before = {name: (path / name).read_bytes() for name in self.files}
        self.assertEqual(before, self.files)
        with self.assertRaises(ValueError): self.manager.delete(model, model)
        self.assertTrue((path / 'model.bin').exists())
        preview = self.manager.prepare_delete(model)['deletion']
        self.assertEqual(Path(preview['path']), path)
        self.assertEqual(preview['bytes'], sum(map(len, self.files.values())))
        self.manager.delete(model, preview['confirm'])
        self.assertTrue(all(not (path / name).exists() for name in self.files))
        self.assertEqual(sentinel.read_text(), 'must remain')
        self.assertEqual((nested / 'keep.txt').read_text(), 'keep')

    def test_a_file_change_after_preview_invalidates_the_delete_confirmation(self):
        path, model = self.imported(); preview = self.manager.prepare_delete(model)['deletion']
        weight = path / 'model.bin'; data = weight.read_bytes(); weight.write_bytes(data[:-1] + b'X')
        stamp = weight.stat().st_mtime_ns; os.utime(weight, ns=(stamp, stamp + 1_000_000_000))
        with self.assertRaises(ValueError): self.manager.delete(model, preview['confirm'])
        self.assertTrue(all((path / name).exists() for name in self.files))

    def test_default_and_service_available_models_are_protected(self):
        path, model = self.imported(); self.manager.set_default(model)
        with self.assertRaises(ValueError): self.manager.prepare_delete(model)
        self.manager.set_default('medium')
        self.health = {'available_models': [model], 'active': False, 'queue': 0}
        with self.assertRaises(ValueError): self.manager.prepare_delete(model)
        self.assertTrue((path / 'model.bin').exists())

    def test_catalog_revision_changes_do_not_hide_an_existing_pinned_installation(self):
        self.manager.download('small'); self.manager.thread.join(timeout=3)
        self.assertEqual(self.manager.status()['job']['phase'], 'complete')
        original = next(m for m in self.manager.status()['models'] if m['id'] == 'small')
        self.manager.catalog['small'] = {**self.release, 'revision': 'b' * 40, 'files': {**self.release['files'], 'model.bin': {'bytes': 1234567, 'sha256': 'f' * 64}}}
        updated = next(m for m in self.manager.status()['models'] if m['id'] == 'small')
        self.assertTrue(updated['installed']); self.assertTrue(updated['owned'])
        self.assertEqual(updated['path'], original['path'])
        self.assertEqual(updated['revision'], 'a' * 40)
        self.assertEqual(updated['availableRevision'], 'b' * 40)

    def test_import_rejects_overlapping_existing_model_directories(self):
        path, _ = self.imported(); nested = self.model(path / 'nested-model')
        with self.assertRaises(ValueError): self.manager.import_model(str(nested))
        self.assertTrue((path / 'model.bin').exists()); self.assertTrue((nested / 'model.bin').exists())


if __name__ == '__main__': unittest.main()
