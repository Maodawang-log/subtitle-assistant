"""Offline behavioral checks: tiny fixture weights, no live ASR or user models."""
import hashlib
import io
import json
from pathlib import Path
import sys
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch
from types import SimpleNamespace

NATIVE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(NATIVE))
from manager import Manager, safe_path


class ManagerReview(unittest.TestCase):
    def setUp(self):
        self.scratch = (NATIVE.parent / '.scratch').resolve()
        self.scratch.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='manager-review-', dir=self.scratch)
        self.root = Path(self.temp.name).resolve()
        assert self.root.is_relative_to(self.scratch)
        self.home, self.legacy = self.root / 'host', self.root / 'legacy'
        self.home.mkdir(); self.legacy.mkdir()
        (self.home / 'host-config.json').write_text(json.dumps({'legacyBase': str(self.legacy)}))
        self.files = {'model.bin': b'fixture-model-data', 'config.json': b'{}'}
        self.catalog = {'small': {'repo': 'Systran/fixture', 'revision': 'f' * 40, 'name': 'Offline fixture', 'files': {
            name: {'bytes': len(value), 'sha256': hashlib.sha256(value).hexdigest()}
            for name, value in self.files.items()
        }}}
        self.opens = []
        self.manager = self.create()

    def opener(self, url):
        self.opens.append(url)
        return io.BytesIO(self.files[url.rsplit('/', 1)[1]])

    def create(self, opener=None):
        return Manager(self.home, opener=opener or self.opener, catalog=self.catalog, health_reader=lambda: None)

    def finish(self):
        self.manager.thread.join(timeout=3)
        self.assertFalse(self.manager.thread.is_alive(), 'Fixture operation did not finish')

    def tearDown(self):
        self.manager.cancel_download()
        if self.manager.thread:
            self.manager.thread.join(timeout=3)
        # The only recursive cleanup is this test's own generated directory.
        assert self.root.is_relative_to(self.scratch) and not self.root.is_symlink()
        self.temp.cleanup()

    def test_installs_only_after_integrity_check_and_reuses_existing_install(self):
        self.manager.download('small'); self.finish()
        state = self.manager.status()
        self.assertEqual(state['job']['phase'], 'complete')
        entry = state['models'][0]
        self.assertTrue(entry['installed']); self.assertTrue(entry['owned'])
        path = Path(entry['path'])
        for name, value in self.files.items():
            self.assertEqual((path / name).read_bytes(), value)
        self.assertEqual(list(path.parent.glob('.staging-*')), [])
        count = len(self.opens)
        self.manager.download('small')
        self.assertEqual(len(self.opens), count)
        restored = self.create().status()['models'][0]
        self.assertEqual(restored['path'], str(path)); self.assertTrue(restored['owned'])

    def test_same_size_corruption_never_becomes_an_installed_model(self):
        sentinel = self.legacy / 'unrelated.txt'; sentinel.write_text('keep')
        self.manager = self.create(lambda url: io.BytesIO(b'x' * len(self.files[url.rsplit('/', 1)[1]])))
        self.manager.download('small'); self.finish()
        state = self.manager.status()
        self.assertEqual(state['job']['phase'], 'error')
        self.assertFalse(state['models'][0]['installed'])
        self.assertEqual(list(Path(state['directory']).glob('.staging-*')), [])
        self.assertEqual(sentinel.read_text(), 'keep')

    def test_cancellation_cleans_its_staging_files_and_leaves_other_files_alone(self):
        entered, released = threading.Event(), threading.Event()
        class Blocked(io.BytesIO):
            def read(self, size=-1):
                entered.set(); released.wait(timeout=2)
                return b'' if self.closed else super().read(size)
            def close(self):
                released.set(); super().close()
        self.manager = self.create(lambda _: Blocked(b'fixture-model-data'))
        sentinel = self.legacy / 'unrelated.txt'; sentinel.write_text('keep')
        self.manager.download('small')
        self.assertTrue(entered.wait(timeout=1))
        self.manager.cancel_download(); self.finish()
        state = self.manager.status()
        self.assertEqual(state['job']['phase'], 'cancelled')
        self.assertFalse(state['models'][0]['installed'])
        self.assertEqual(list(Path(state['directory']).glob('.staging-*')), [])
        self.assertEqual(sentinel.read_text(), 'keep')

    def test_discovers_legacy_models_without_copying_or_allowing_their_deletion(self):
        path = self.legacy / 'models' / 'faster-whisper-small'; path.mkdir(parents=True)
        for name, value in self.files.items(): (path / name).write_bytes(value)
        entry = self.manager.status()['models'][0]
        self.assertTrue(entry['installed']); self.assertFalse(entry['owned'])
        self.assertEqual(entry['path'], str(path))
        self.manager.download('small'); self.assertEqual(self.opens, [])
        with self.assertRaises(ValueError): self.manager.delete('small', 'small')
        self.assertEqual((path / 'model.bin').read_bytes(), self.files['model.bin'])

    def test_directory_changes_do_not_move_installed_weights(self):
        self.manager.download('small'); self.finish()
        original = Path(self.manager.status()['models'][0]['path'])
        future = self.root / 'future'; future.mkdir()
        result = self.manager.select_directory(str(future))
        self.assertEqual(result['models'][0]['path'], str(original))
        self.assertTrue(original.exists())
        self.assertFalse((future / 'model.bin').exists())

    def test_refuses_unsupported_commands_urls_and_directory_escape(self):
        for action, args in [('run', {'command': 'anything'}), ('download', {'model': 'small', 'url': 'https://invalid.example'}), ('download', {'model': '../other'}), ('delete', {'model': 'small', 'confirm': 'different'})]:
            with self.assertRaises(ValueError): self.manager.dispatch(action, args)
        with self.assertRaises(ValueError): safe_path(self.root / '..' / 'outside')
        with self.assertRaises(ValueError): safe_path(self.root / 'outside', self.home)
        self.assertEqual(self.opens, [])

    def test_starting_model_is_reported_until_ready_and_repeated_start_spawns_once(self):
        with socket.socket() as free:
            free.bind(('127.0.0.1', 0)); self.manager.port = free.getsockname()[1]
        weights = self.legacy / 'models' / 'faster-whisper-small'; weights.mkdir(parents=True)
        for name, value in self.files.items(): (weights / name).write_bytes(value)
        python = self.legacy / '.venv' / 'Scripts' / 'python.exe'
        python.parent.mkdir(parents=True); python.write_bytes(b'not executed')
        server = self.home / 'service' / 'server.py'
        server.parent.mkdir(); server.write_text('# not executed')
        with patch('manager.subprocess.Popen', return_value=SimpleNamespace(pid=12345)) as launch, patch('manager.process_stamp', side_effect=lambda pid: 98765 if pid == 12345 else None):
            first = self.manager.start('small')
            self.assertTrue(first['starting'])
            self.assertTrue(self.manager.status()['starting'])
            second = self.manager.start('small')
            self.assertTrue(second['starting'])
            launch.assert_called_once()


if __name__ == '__main__': unittest.main()
