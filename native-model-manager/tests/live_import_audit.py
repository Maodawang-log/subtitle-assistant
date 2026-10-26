"""Load a real imported Whisper model by dynamic ID on an isolated CPU service.

No registry operation, original-service restart, model copy or weight download.
The test catalog deliberately contains only medium so the existing small model
must travel through import_model instead of the bundled legacy-model shortcut.
"""
from pathlib import Path
import copy
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    root = Path(__file__).resolve().parents[2]
    package = root / '.scratch/model-manager-package'
    out = root / '.scratch/native-import-live-2650'
    out.mkdir(parents=True, exist_ok=True)
    home = out / ('managed-' + uuid.uuid4().hex)
    home.mkdir()
    legacy = root.parent.parent / 'local-asr'
    small = legacy / 'models/faster-whisper-small'
    checks, errors = [], []
    evidence = {
        'scope': 'real imported CTranslate2 Whisper small weights; dynamic model ID; private CPU process and loopback port; internal silent warm-up only, no user audio or recognition-quality claim',
        'testCatalogOverride': 'Only the bundled medium catalog entry is exposed. The existing original small directory is intentionally absent from this test catalog and must be registered by real import_model as local-<path digest>. Production catalog is not modified.',
        'privateHome': str(home), 'legacyBase': str(legacy), 'originalModelPath': str(small),
        'weightsDownloaded': False, 'weightsCopied': False, 'registrationPerformed': False,
        'checks': checks, 'errors': errors,
    }

    def read(path):
        return json.loads(path.read_text(encoding='utf-8-sig'))

    def digest(path):
        with path.open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest()

    def check(name, condition, detail=None, fatal=True):
        checks.append({'name': name, 'ok': bool(condition), 'detail': detail})
        print(json.dumps({'check': name, 'ok': bool(condition)}, ensure_ascii=False), flush=True)
        if not condition and fatal:
            raise AssertionError(name)

    def health(port):
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(f'http://127.0.0.1:{port}/health', timeout=3) as response:
            return json.load(response)

    # Capture the live original before creating any service process.
    original_before = health(18766)
    original_record = read(legacy / 'service.pid.json') if (legacy / 'service.pid.json').is_file() else {}
    original_hashes = {name: digest(legacy / name) if (legacy / name).is_file() else None for name in ['settings.json', 'service.pid.json', 'server.py', 'window_audio.py']}
    small_before = {file.name: {'bytes': file.stat().st_size, 'sha256': digest(file)} for file in small.iterdir() if file.is_file()}
    evidence['originalBefore'] = {'workerPid': original_before['worker_pid'], 'defaultModel': original_before['default_model'], 'backend': original_before['backend'], 'files': original_hashes}
    check('original-shared-service-is-healthy', original_before.get('status') == 'ok' and original_before.get('service') == 'local-japanese-asr')

    # Copy only the declared small runtime files, never model directories.
    expected = read(package / 'package-hashes.json')
    for name, expected_hash in expected.items():
        source = package / name
        assert source.resolve().is_relative_to(package.resolve()) and not source.is_symlink()
        assert source.stat().st_size < 5 * 1024 * 1024, 'Unexpected large file in runtime package'
        destination = home / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        assert digest(destination) == expected_hash, name
    shutil.copy2(package / 'package-hashes.json', home / 'package-hashes.json')
    evidence['runtimeHashes'] = expected
    sys.path.insert(0, str(home))
    from manager import Manager, atomic_json, process_stamp
    atomic_json(home / 'host-config.json', {'legacyBase': str(legacy)})
    catalog = read(home / 'model-catalog.json')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    assert port != 18766 and 1024 <= port <= 65535
    evidence['port'] = port
    manager = Manager(home, catalog={'medium': copy.deepcopy(catalog['medium'])}, port=port)
    previous_device = os.environ.get('LOCAL_ASR_DEVICE')
    os.environ['LOCAL_ASR_DEVICE'] = 'cpu'
    record = None

    def stop_private_only():
        record_path = home / 'managed-service.json'
        if not record_path.exists():
            return
        owned = read(record_path)
        # The fallback is only for a failed private warm-up. Verify the exact
        # record, creation stamp, dedicated server path and non-shared port.
        assert home.resolve().is_relative_to(out.resolve())
        assert Path(owned['server']).resolve() == (home / 'service/server.py').resolve()
        assert Path(owned['python']).resolve() == (legacy / '.venv/Scripts/python.exe').resolve()
        assert owned['port'] == port and port != 18766
        assert owned['pid'] not in [original_record.get('pid'), original_before['worker_pid']]
        if process_stamp(owned['pid']) != owned['stamp']:
            return
        live = manager.health()
        if live and live.get('manager_instance') == owned['instance']:
            manager.stop()
            return
        subprocess.run(['taskkill', '/PID', str(int(owned['pid'])), '/T', '/F'], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
        evidence['cleanupUsedVerifiedPrivateProcessFallback'] = True

    try:
        check('test-catalog-does-not-pre-register-small', set(manager.installed()) == {'medium'})
        imported = manager.import_model(str(small))
        entries = [item for item in imported['models'] if item['id'].startswith('local-')]
        check('real-import-registers-one-dynamic-id', len(entries) == 1 and entries[0]['installed'])
        imported_model = entries[0]
        model_id = imported_model['id']
        evidence['importedModel'] = imported_model
        check('import-reuses-original-physical-directory', Path(imported_model['path']).resolve() == small.resolve() and not imported_model['owned'])
        check('import-confirms-Japanese-format-metadata', imported_model['japaneseSupported'] is True)
        again = manager.import_model(str(small))
        check('repeated-import-reuses-same-dynamic-id', [item['id'] for item in again['models'] if item['id'].startswith('local-')] == [model_id])
        manager.set_default(model_id)
        check('private-default-is-the-imported-id', manager.status()['defaultModel'] == model_id)
        manager.start()
        record = read(home / 'managed-service.json')
        evidence['privateProcess'] = record
        check('private-process-and-port-are-distinct', record['port'] == port and record['pid'] not in [original_record.get('pid'), original_before['worker_pid']])
        deadline = time.monotonic() + 150
        ready = None
        while time.monotonic() < deadline:
            ready = manager.health()
            if ready and ready.get('status') == 'ok':
                break
            if process_stamp(record['pid']) != record['stamp']:
                raise RuntimeError('Private service exited before model warm-up completed')
            time.sleep(.5)
        else:
            raise TimeoutError('Imported model warm-up did not finish within 150 seconds')
        evidence['privateHealth'] = ready
        check('real-CPU-backend-loaded-dynamic-model-id', ready['backend']['device'] == 'cpu' and ready['backend']['model'] == model_id and ready['default_model'] == model_id, ready['backend'])
        check('loaded-model-path-is-original-small', Path(ready['model_path']).resolve() == small.resolve())
        check('no-audio-recognition-jobs-submitted', ready.get('jobs_started') == 0 and not ready.get('active') and not ready.get('queue'))
        refused = None
        try:
            manager.prepare_delete(model_id)
        except ValueError as exc:
            refused = str(exc)
        check('active-imported-default-cannot-be-prepared-for-deletion', bool(refused) and '默认模型' in refused, refused)
        check('deletion-protection-issued-no-confirmation-token', not manager.delete_tokens)
        manager.stop()
        check('private-service-stopped-through-owned-stop-path', manager.health() is None and process_stamp(record['pid']) != record['stamp'])
    except Exception as exc:
        errors.append(type(exc).__name__ + ': ' + str(exc))
    finally:
        try:
            stop_private_only()
        except Exception as exc:
            errors.append('private cleanup: ' + type(exc).__name__ + ': ' + str(exc))
        if previous_device is None:
            os.environ.pop('LOCAL_ASR_DEVICE', None)
        else:
            os.environ['LOCAL_ASR_DEVICE'] = previous_device
        try:
            original_after = health(18766)
            evidence['originalAfter'] = {'workerPid': original_after['worker_pid'], 'defaultModel': original_after['default_model'], 'backend': original_after['backend']}
            check('original-18766-worker-and-default-unchanged', original_after.get('status') == 'ok' and original_after['worker_pid'] == original_before['worker_pid'] and original_after['default_model'] == original_before['default_model'], fatal=False)
            after_hashes = {name: digest(legacy / name) if (legacy / name).is_file() else None for name in original_hashes}
            check('original-settings-pid-and-service-source-hashes-unchanged', after_hashes == original_hashes, after_hashes, fatal=False)
            small_after = {file.name: {'bytes': file.stat().st_size, 'sha256': digest(file)} for file in small.iterdir() if file.is_file()}
            check('original-small-model-files-and-hashes-unchanged', small_after == small_before, small_after, fatal=False)
            check('private-home-contains-no-model-weight-copy', not any(file.name == 'model.bin' for file in home.rglob('*')), fatal=False)
            if record:
                check('private-service-process-is-no-longer-running', process_stamp(record['pid']) != record['stamp'], fatal=False)
        except Exception as exc:
            errors.append('preservation verification: ' + type(exc).__name__ + ': ' + str(exc))
        evidence['failed'] = [item for item in checks if not item['ok']]
        atomic_json(out / 'evidence.json', evidence)
    print(json.dumps({'evidence': str(out / 'evidence.json'), 'checks': len(checks), 'failed': len(evidence['failed']), 'errors': errors}, ensure_ascii=False), flush=True)
    return 1 if errors or evidence['failed'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
