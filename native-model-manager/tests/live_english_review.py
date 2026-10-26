"""Explicitly scheduled English audit; never stop/restart shared port 18766.

Run only with --run-live. The shared file request uses its already resident model
only after two idle samples. The private service uses CPU and existing small
weights read-only. Its window route uses real HTTP, decode and ASR, but replaces
CDN transport with a local JFK fixture; this is not live Bilibili CDN evidence.
"""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / 'native-model-manager'
sys.path.insert(0, str(NATIVE))
from manager import process_stamp

WRAPPER = r'''
import multiprocessing as mp
import os
from pathlib import Path
import sys
sys.path.insert(0, os.environ['REVIEW_SERVICE_SOURCE'])
import window_audio
def fixture_window(urls, start, duration):
    if urls != ['https://upos-sz-mirrorcos.bilivideo.com/private-review-jfk.flac']:
        raise ValueError('Unexpected test URL: no remote audio will be fetched')
    import server
    audio = server.bounded_decode(Path(os.environ['REVIEW_SAMPLE']))
    audio = audio[int(start * 16000):int((start + duration) * 16000)]
    if not len(audio): raise ValueError('Fixture window is empty')
    return audio, {'transport': 'local-JFK-fixture', 'real_bilibili_cdn': False, 'bytes': 0}
window_audio.decode_window = fixture_window
import server
if __name__ == '__main__':
    mp.freeze_support()
    import uvicorn
    uvicorn.run(server.app, host='127.0.0.1', port=int(os.environ['LOCAL_ASR_PORT']), access_log=False)
'''


class PrivateProcessJob:
    """A Windows job owns only the process assigned here and its descendants."""
    def __init__(self):
        class BASIC(ctypes.Structure):
            _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                        ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                        ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                        ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD), ('SchedulingClass', wintypes.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]
        class EXTENDED(ctypes.Structure):
            _fields_ = [('BasicLimitInformation', BASIC), ('IoInfo', IO), ('ProcessMemoryLimit', ctypes.c_size_t),
                        ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        if not self.handle: raise ctypes.WinError(ctypes.get_last_error())
        limits = EXTENDED(); limits.BasicLimitInformation.LimitFlags = 0x2000
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.kernel.CloseHandle(self.handle); self.handle = None
            raise ctypes.WinError(ctypes.get_last_error())
        self.assigned = False

    def assign(self, process):
        if not self.kernel.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(process._handle))):
            process.terminate(); process.wait(timeout=10)
            raise ctypes.WinError(ctypes.get_last_error())
        self.assigned = True

    def close(self):
        if self.handle:
            if self.assigned: self.kernel.TerminateJobObject(self.handle, 0)
            self.kernel.CloseHandle(self.handle); self.handle = None


def hashes(paths):
    values = {}
    for path in sorted(set(paths)):
        if not path.is_file(): continue
        with path.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        info = path.stat()
        values[str(path)] = {'sha256': digest, 'bytes': info.st_size, 'mtime_ns': info.st_mtime_ns}
    return values


def listener_identity(port):
    command = "$pids=@(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort " + str(int(port)) + " -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique);ConvertTo-Json -Compress -InputObject $pids"
    result = subprocess.run(['powershell.exe', '-NoProfile', '-Command', command], check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    pids = json.loads(result.stdout.decode('utf-8-sig'))
    if not isinstance(pids, list): pids = [pids]
    if len(pids) != 1: raise RuntimeError('Shared listener identity is ambiguous')
    return {'pid': pids[0], 'stamp': process_stamp(pids[0])}


def validate_english(value, *, offset=0, duration=60):
    if value.get('task') != 'transcribe' or value.get('language') != 'en':
        raise AssertionError('Expected English transcription, not translation or another language')
    text = value.get('text', '')
    if 'country' not in text.lower() or len(text.strip()) < 25:
        raise AssertionError('JFK English words were not recognized: ' + text)
    segments = value.get('segments')
    if not segments: raise AssertionError('No timestamped English segments')
    for segment in segments:
        if not offset <= segment['start'] < segment['end'] <= offset + duration + .1:
            raise AssertionError('Segment timestamp is outside the requested audio')
        for word in segment.get('words', []):
            if not offset <= word['start'] <= word['end'] <= offset + duration + .1:
                raise AssertionError('Word timestamp is outside the requested audio')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-live', action='store_true')
    parser.add_argument('--sample', type=Path, default=ROOT / '.scratch/english-review/jfk.flac')
    parser.add_argument('--legacy', type=Path, default=Path(r'E:\Work\日语视频学习插件\local-asr'))
    parser.add_argument('--service-source', type=Path, default=ROOT / '.scratch/model-manager-package/service')
    args = parser.parse_args()
    if not args.run_live: parser.error('This audit requires explicitly scheduled --run-live')
    if os.name != 'nt': parser.error('This process-identity audit requires Windows')
    import httpx
    sample = args.sample.resolve(strict=True); legacy = args.legacy.resolve(strict=True)
    service_source = args.service_source.resolve(strict=True)
    if not service_source.is_relative_to(ROOT): raise ValueError('Private service source must be inside this checkout')
    run = (ROOT / '.scratch/english-review' / ('live-' + time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6])).resolve()
    assert run.is_relative_to(ROOT / '.scratch')
    run.mkdir(parents=True)
    evidence = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'scope': 'Shared resident-model file inference; private CPU file/window inference with test-only local audio transport',
                'window_transport': 'local JFK decoded inside a real private worker; no live Bilibili CDN validation', 'checks': [], 'sample': str(sample), 'service_source': str(service_source)}
    proc = job = None
    shared_before = shared_identity = protected_before = None
    def check(name, ok, detail=None):
        evidence['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail})
        print(name + ': ' + ('PASS' if ok else 'FAIL'), flush=True)
        if not ok: raise AssertionError(name)
    protected = [legacy / name for name in ('server.py', 'window_audio.py', 'settings.json')]
    for name in ('small', 'medium'):
        directory = legacy / 'models' / ('faster-whisper-' + name)
        protected.extend(directory / filename for filename in ('model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt', 'vocabulary.json'))
    try:
        with httpx.Client(base_url='http://127.0.0.1:18766', timeout=240, trust_env=False) as shared:
            shared_before = shared.get('/health').raise_for_status().json()
            shared_identity = listener_identity(18766)
            evidence['shared_before'] = shared_before; evidence['shared_identity_before'] = shared_identity
            protected_before = hashes(protected); evidence['protected_files_before'] = protected_before
            evidence['sample_sha256'] = hashes([sample])[str(sample)]['sha256']
            window = {'audio_url': 'https://upos-sz-mirrorcos.bilivideo.com/private-review-jfk.flac', 'language': 'en', 'start': 0, 'duration': 1, 'request_id': 'english-old-' + uuid.uuid4().hex}
            rejected = shared.post('/v1/audio/window', json=window)
            after_rejected = shared.get('/health').raise_for_status().json()
            evidence['old_window_response'] = {'status': rejected.status_code, 'body': rejected.json()}
            check('old-window-en-rejected-before-ASR', rejected.status_code == 400 and 'language' in rejected.text.lower()
                  and after_rejected['jobs_started'] == shared_before['jobs_started'] and after_rejected['worker_pid'] == shared_before['worker_pid'])
            time.sleep(.3)
            idle = shared.get('/health').raise_for_status().json()
            resident = (idle.get('backend') or {}).get('model')
            safe = all(not state.get('active') and state.get('queue') == 0 and state.get('model_ready') for state in (after_rejected, idle))
            safe = safe and idle.get('worker_pid') == shared_before.get('worker_pid') and resident == (shared_before.get('backend') or {}).get('model')
            if safe and resident:
                with sample.open('rb') as audio:
                    response = shared.post('/v1/audio/transcriptions', data={'model': resident, 'language': 'en', 'response_format': 'verbose_json'}, files={'file': ('jfk.flac', audio, 'audio/flac')})
                response.raise_for_status(); result = response.json(); validate_english(result)
                evidence['shared_file_en'] = result
                post_file = shared.get('/health').raise_for_status().json(); evidence['shared_after_file'] = post_file
                check('shared-English-file-reuses-resident-worker', post_file['worker_pid'] == shared_before['worker_pid'] and (post_file.get('backend') or {}).get('model') == resident)
            else:
                evidence['shared_file_en_skipped'] = 'Shared service is not stably idle with the same resident worker/model'
                print('shared file request skipped: shared service not stably idle', flush=True)

        private_base = run / 'private-base'; private_base.mkdir()
        settings = {'default_model': 'small', 'model_dirs': {'small': str(legacy / 'models/faster-whisper-small')}, 'compute_types': {'small': 'int8'}}
        (private_base / 'settings.json').write_text(json.dumps(settings), encoding='utf-8')
        wrapper = run / 'private_cpu_service.py'; wrapper.write_text(WRAPPER, encoding='utf-8')
        with socket.socket() as available:
            available.bind(('127.0.0.1', 0)); port = available.getsockname()[1]
        assert port != 18766
        evidence['private_port'] = port
        environment = dict(os.environ, LOCAL_ASR_BASE=str(private_base), LOCAL_ASR_MANAGER_CONFIG='', LOCAL_ASR_MANAGER_INSTANCE='english-review-' + run.name,
                           LOCAL_ASR_DEVICE='cpu', LOCAL_ASR_PORT=str(port), REVIEW_SERVICE_SOURCE=str(service_source), REVIEW_SAMPLE=str(sample))
        job = PrivateProcessJob()
        with (run / 'service-stdout.log').open('wb') as stdout, (run / 'service-stderr.log').open('wb') as stderr:
            proc = subprocess.Popen([sys.executable, str(wrapper)], cwd=run, env=environment, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                    creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
        job.assign(proc)
        evidence['private_process'] = {'pid': proc.pid, 'stamp': process_stamp(proc.pid), 'wrapper': str(wrapper)}
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=240, trust_env=False) as private:
            deadline = time.monotonic() + 180; ready = None; notice = 0
            while time.monotonic() < deadline:
                if proc.poll() is not None: raise RuntimeError('Private service exited; inspect private stderr')
                try:
                    candidate = private.get('/health', timeout=2).raise_for_status().json()
                    if candidate.get('model_ready'): ready = candidate; break
                except httpx.HTTPError: pass
                if time.monotonic() >= notice:
                    print('Waiting for private CPU model warm-up...', flush=True); notice = time.monotonic() + 15
                time.sleep(.5)
            if ready is None: raise TimeoutError('Private CPU model did not become ready')
            evidence['private_ready'] = ready
            check('private-service-is-CPU-with-original-small-path', ready['backend']['device'] == 'cpu' and Path(ready['model_path']).resolve() == legacy / 'models/faster-whisper-small')
            with sample.open('rb') as audio:
                response = private.post('/v1/audio/transcriptions', data={'model': 'small', 'language': 'en', 'response_format': 'verbose_json'}, files={'file': ('jfk.flac', audio, 'audio/flac')})
            response.raise_for_status(); result = response.json(); validate_english(result)
            evidence['private_file_en'] = result; check('private-file-real-English-transcription', True)
            window.update(start=1, duration=10, request_id='english-private-' + uuid.uuid4().hex, model='small')
            response = private.post('/v1/audio/window', json=window); response.raise_for_status()
            result = response.json(); validate_english(result, offset=1, duration=10)
            evidence['private_window_en'] = result
            check('private-window-real-ASR-with-test-audio-transport', result.get('timestamp_origin') == 'absolute' and result.get('request_id') == window['request_id']
                  and result.get('download', {}).get('real_bilibili_cdn') is False)
            evidence['private_final'] = private.get('/health').raise_for_status().json()
    except Exception as error:
        evidence['error'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        if job: job.close()
        if proc:
            try: proc.wait(timeout=15)
            except subprocess.TimeoutExpired: evidence['private_cleanup_error'] = 'Private process did not exit after its own job closed'
            evidence['private_stopped'] = proc.poll() is not None
        try:
            if shared_before:
                with httpx.Client(base_url='http://127.0.0.1:18766', timeout=5, trust_env=False) as shared:
                    final_health = shared.get('/health').raise_for_status().json()
                final_identity = listener_identity(18766)
                evidence['shared_final'] = final_health; evidence['shared_identity_final'] = final_identity
                check('original-shared-service-and-worker-identities-preserved', final_identity == shared_identity and final_health.get('worker_pid') == shared_before.get('worker_pid')
                      and (final_health.get('backend') or {}).get('model') == (shared_before.get('backend') or {}).get('model'))
            if protected_before:
                evidence['protected_files_after'] = hashes(protected)
                check('original-service-settings-and-model-files-unchanged', evidence['protected_files_after'] == protected_before)
        except Exception as error:
            evidence['preservation_error'] = type(error).__name__ + ': ' + str(error)
        (run / 'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
        print('Evidence: ' + str(run / 'evidence.json'), flush=True)
    if evidence.get('error') or evidence.get('preservation_error') or evidence.get('private_cleanup_error'):
        return 1
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
