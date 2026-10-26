"""Actual Windows native EXE framing with isolated homes; no registry or ASR work."""
from pathlib import Path
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import queue
import unittest

NATIVE = Path(__file__).resolve().parents[1]
ORIGIN = 'chrome-extension://' + 'a' * 32 + '/'


@unittest.skipUnless(os.name == 'nt', 'Windows native launcher')
class NativeHostReview(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scratch = NATIVE.parent / '.scratch'
        scratch.mkdir(exist_ok=True)
        cls.build = tempfile.TemporaryDirectory(prefix='native-exe-review-', dir=scratch)
        cls.exe = Path(cls.build.name) / 'native-host.exe'
        subprocess.run([r'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
                        '/nologo', '/target:exe', '/out:' + str(cls.exe), str(NATIVE / 'Launcher.cs')],
                       check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='native-host-review-', dir=NATIVE.parent / '.scratch')
        self.root = Path(self.temp.name)
        self.home = self.root / 'connection'
        self.home.mkdir()
        self.legacy = self.root / 'asr'
        self.legacy.mkdir()
        shutil.copy2(self.exe, self.home / 'native-host.exe')
        for name in ['manager.py', 'host.py']:
            shutil.copy2(NATIVE / name, self.home / name)
        (self.home / 'python-path.txt').write_text(sys.executable, encoding='utf-8')
        (self.home / 'host-config.json').write_text(json.dumps({'legacyBase': str(self.legacy)}))
        (self.home / 'native-host.json').write_text(json.dumps({'allowed_origins': [ORIGIN]}))
        (self.home / 'model-catalog.json').write_text('{}')
        self.processes = []

    def launch(self, origin=ORIGIN):
        process = subprocess.Popen([str(self.home / 'native-host.exe'), origin], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        self.processes.append(process)
        return process

    def tearDown(self):
        for process in self.processes:
            if process.stdin.closed:
                process.stdin = None
            if process.poll() is None:
                process.communicate(timeout=8)
            for stream in [process.stdin, process.stdout, process.stderr]:
                if stream:
                    stream.close()
        self.temp.cleanup()

    @staticmethod
    def frame(value):
        data = json.dumps(value, ensure_ascii=False).encode('utf-8')
        return struct.pack('<I', len(data)) + data

    @staticmethod
    def response(process):
        result = queue.Queue()
        def read():
            header = process.stdout.read(4)
            if len(header) == 4:
                result.put(json.loads(process.stdout.read(struct.unpack('<I', header)[0])))
            else:
                result.put(None)
        thread = threading.Thread(target=read, daemon=True)
        thread.start()
        try:
            value = result.get(timeout=6)
        except queue.Empty:
            process.stdin.close()
            thread.join(timeout=5)
            raise AssertionError('Native launcher did not reply while browser input connection remained open')
        if value is None:
            raise AssertionError('Native launcher did not emit a length-prefixed response')
        return value

    def test_real_exe_roundtrip_has_no_console_noise_or_automatic_asr_work(self):
        process = self.launch()
        stdout, stderr = process.communicate(self.frame({'id': '状态-1', 'action': 'status', 'args': {}}), timeout=10)
        self.assertEqual(process.returncode, 0, stderr.decode(errors='replace'))
        length = struct.unpack('<I', stdout[:4])[0]
        self.assertEqual(len(stdout), length + 4)
        result = json.loads(stdout[4:])
        self.assertTrue(result['ok'])
        self.assertEqual(result['id'], '状态-1')
        self.assertEqual(result['data']['models'], [])
        self.assertIsNone(result['data']['job'])
        self.assertFalse((self.home / 'managed-service.json').exists())
        self.assertFalse((self.legacy / 'managed-models').exists())

    def test_unregistered_extension_origin_is_rejected(self):
        process = self.launch('chrome-extension://' + 'b' * 32 + '/')
        stdout, _ = process.communicate(timeout=8)
        self.assertEqual(process.returncode, 2)
        self.assertEqual(stdout, b'')

    def test_arbitrary_action_is_a_framed_error_without_command_execution(self):
        process = self.launch()
        stdout, _ = process.communicate(self.frame({'id': 'bad', 'action': 'exec', 'args': {'cmd': 'whoami'}}), timeout=8)
        result = json.loads(stdout[4:])
        self.assertFalse(result['ok'])
        self.assertEqual(result['id'], 'bad')
        self.assertEqual(process.returncode, 0)

    def test_second_host_is_rejected_while_first_connection_is_open(self):
        first = self.launch()
        first.stdin.write(self.frame({'id': 'one', 'action': 'status', 'args': {}}))
        first.stdin.flush()
        self.assertTrue(self.response(first)['ok'])
        second = self.launch()
        stdout, _ = second.communicate(timeout=8)
        self.assertEqual(second.returncode, 3)
        self.assertEqual(stdout, b'')
        first.stdin.write(self.frame({'id': 'two', 'action': 'status', 'args': {}}))
        first.stdin.flush()
        self.assertEqual(self.response(first)['id'], 'two')
