"""Fixed-action, local-user model manager. No browser key, arbitrary URL or command API."""
from __future__ import annotations
import ctypes, hashlib, ipaddress, json, os, re, shutil, socket, stat, subprocess, threading, time, urllib.request, uuid
from pathlib import Path


def read_json(path, fallback=None):
    return json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else fallback


def atomic_json(path, value):
    temp = path.with_name(path.name + '.tmp-' + uuid.uuid4().hex)
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temp, path)


def safe_path(value, within=None):
    path = Path(value)
    if not path.is_absolute() or '..' in path.parts or str(path).startswith(('\\\\', '//')):
        raise ValueError('请选择本机绝对目录，不使用网络路径或上级跳转。')
    for parent in (path, *path.parents):
        try:
            info = parent.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise ValueError('路径包含链接或重解析目录，未进行修改。')
    resolved = path.resolve()
    if str(resolved).startswith(('\\\\', '//')):
        raise ValueError('不使用网络目录。')
    if within is not None and not resolved.is_relative_to(Path(within).resolve()):
        raise ValueError('目标超出已选择的模型目录。')
    if resolved == Path(resolved.anchor):
        raise ValueError('请选一个专用文件夹，不要选择磁盘根目录。')
    return resolved


def model_files_valid(path, release):
    try:
        safe_path(path)
        return all(safe_path(path / name, path).is_file() and (path / name).stat().st_size == info['bytes'] for name, info in release['files'].items())
    except (ValueError, OSError):
        return False


def allowed_download(url):
    from urllib.parse import urlsplit
    parsed = urlsplit(url)
    host = parsed.hostname or ''
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('模型下载只允许可信 HTTPS 来源。')
    if not any(host == domain or host.endswith('.' + domain) for domain in ('huggingface.co', 'hf.co', 'xethub.hf.co')):
        raise ValueError('模型下载跳转到了未允许的站点。')
    if any(not ipaddress.ip_address(item[4][0]).is_global for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)):
        raise ValueError('拒绝模型来源的非公网地址。')


class TrustedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        allowed_download(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_open(url):
    allowed_download(url)
    return urllib.request.build_opener(TrustedRedirect()).open(urllib.request.Request(url, headers={'User-Agent': 'BiliScriptLocalModels/1.0'}), timeout=12)


def process_stamp(pid):
    if os.name != 'nt':
        return None
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, int(pid))
    if not handle:
        return None
    try:
        values = [wintypes.FILETIME() for _ in range(4)]
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(x) for x in values)):
            return None
        return (values[0].dwHighDateTime << 32) | values[0].dwLowDateTime
    finally:
        kernel.CloseHandle(handle)


class Manager:
    def __init__(self, home, *, opener=download_open, catalog=None, health_reader=None, port=18766):
        self.home = safe_path(home)
        self.install = read_json(self.home / 'host-config.json')
        self.legacy = safe_path(self.install['legacyBase'])
        self.catalog = catalog or read_json(self.home / 'model-catalog.json')
        self.state_file = self.home / 'manager-state.json'
        self.state = read_json(self.state_file, None) or {'owner': uuid.uuid4().hex, 'directory': str(self.legacy / 'managed-models'), 'models': {}}
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        self.job = None
        self.thread = None
        self.opener = opener
        self.health_reader = health_reader
        self.response = None
        self.port = port
        directory = safe_path(self.state['directory'])
        if directory.exists():
            for stage in directory.glob('.staging-*'):
                marker = read_json(safe_path(stage / '.study-owned.json', directory), {})
                if marker.get('owner') == self.state['owner'] and marker.get('model') in self.catalog:
                    self.clean_stage(stage, self.catalog[marker['model']])

    def save(self):
        safe_path(self.state_file, self.home)
        atomic_json(self.state_file, self.state)

    def health(self):
        if self.health_reader:
            return self.health_reader()
        try:
            request = urllib.request.Request(f'http://127.0.0.1:{self.port}/health')
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=1) as r:
                value = json.load(r)
            return value if value.get('service') == 'local-japanese-asr' else {'foreign': True}
        except Exception:
            return None

    def installed(self):
        result = {}
        for model, release in self.catalog.items():
            legacy = self.legacy / 'models' / ('faster-whisper-' + model)
            managed = self.state['models'].get(model)
            if managed and model_files_valid(Path(managed), release):
                result[model] = {'path': managed, 'owned': self.owns(Path(managed), model)}
            elif model_files_valid(legacy, release):
                result[model] = {'path': str(legacy), 'owned': False}
        return result

    def owns(self, path, model):
        try:
            safe_path(path)
            marker = read_json(safe_path(path / '.study-owned.json', path), {})
            return marker.get('owner') == self.state['owner'] and marker.get('model') == model and marker.get('revision') == self.catalog[model]['revision']
        except (ValueError, OSError, KeyError):
            return False

    def status(self):
        with self.lock:
            installed = self.installed()
            legacy = read_json(self.legacy / 'settings.json', {})
            health = self.health()
            service = read_json(self.home / 'managed-service.json', {})
            starting = bool(not health and service.get('pid') and process_stamp(service['pid']) == service.get('stamp'))
            owned = bool(health and health.get('manager_instance') == service.get('instance') and service.get('instance') and process_stamp(service.get('pid', 0)) == service.get('stamp'))
            busy = bool(health and (health.get('active') or health.get('queue')))
            other = bool(health and health.get('other_consumer_recent'))
            stopping = owned and not busy and not other
            return {'version': '1.0.0', 'directory': self.state['directory'], 'defaultModel': self.state.get('default_model', legacy.get('default_model', 'small')),
                    'models': [{'id': model, 'name': release['name'], 'bytes': sum(f['bytes'] for f in release['files'].values()), 'revision': release['revision'], 'source': 'https://huggingface.co/' + release['repo'], **installed.get(model, {}), 'installed': model in installed} for model, release in self.catalog.items()],
                    'service': health, 'managedService': owned, 'canStop': stopping, 'starting': starting,
                    'stopReason': '服务正在识别或排队，暂不能停止。' if busy else '最近有其他客户端使用，暂不能停止共享服务。' if other else '当前服务可继续复用；如需在此启停，请先使用“首次接管现有服务”。' if health and not owned else '',
                    'job': dict(self.job) if self.job else None}

    def idle(self):
        if self.thread and self.thread.is_alive():
            raise ValueError('请先完成或取消当前任务。')

    def select_directory(self, value):
        with self.lock:
            self.idle()
            parent = safe_path(value)
            if not parent.is_dir():
                raise ValueError('请选择已存在的文件夹。')
            directory = safe_path(parent / 'BiliScriptModels', parent)
            if directory.exists() and any(directory.iterdir()):
                marker = read_json(directory / '.study-root.json', {})
                if marker.get('owner') != self.state['owner']:
                    raise ValueError('目标已有其他文件，请选择不同文件夹。')
            self.state['directory'] = str(directory)
            self.save()
            return self.status()

    def choose_directory(self):
        from tkinter import Tk, filedialog
        window = Tk();window.withdraw();window.attributes('-topmost', True)
        try:
            selected = filedialog.askdirectory(parent=window, title='选择今后模型的保存位置（已有模型保持原位）', mustexist=True)
        finally:
            window.destroy()
        return self.select_directory(selected) if selected else self.status()

    def set_default(self, model):
        with self.lock:
            self.idle()
            if model not in self.installed():
                raise ValueError('请先安装所选模型。')
            self.state['default_model'] = model; self.save()
            return self.status()

    def root_directory(self):
        directory = safe_path(self.state['directory'])
        if not directory.exists():
            directory.mkdir(parents=True)
        marker = read_json(safe_path(directory / '.study-root.json', directory), {})
        if marker and marker.get('owner') != self.state['owner']:
            raise ValueError('目录属于其他管理器，未修改。')
        if not marker:
            if any(directory.iterdir()):
                raise ValueError('模型目录已有未归属的内容，未修改。')
            atomic_json(directory / '.study-root.json', {'owner': self.state['owner']})
        return directory

    def clean_stage(self, stage, release):
        safe_path(stage, self.state['directory'])
        allowed = set(release['files']) | {'.study-owned.json'}
        contents = list(stage.iterdir())
        if any(p.name not in allowed or not safe_path(p, stage).is_file() for p in contents):
            raise ValueError('暂存目录出现其他文件，未进行清理。')
        for p in contents:
            p.unlink()
        stage.rmdir()

    def download(self, model):
        with self.lock:
            self.idle()
            if model not in self.catalog:
                raise ValueError('未知模型。')
            if model in self.installed():
                return self.status()
            directory = self.root_directory();self.save()
            release = self.catalog[model]
            stage = safe_path(directory / ('.staging-' + uuid.uuid4().hex), directory)
            stage.mkdir()
            atomic_json(stage / '.study-owned.json', {'owner': self.state['owner'], 'model': model, 'revision': release['revision'], 'staging': True})
            destination = safe_path(directory / (model + '-' + release['revision'][:12]), directory)
            if destination.exists():
                self.clean_stage(stage, release);raise ValueError('目标版本目录已存在，未覆盖。')
            self.cancel.clear()
            self.job = {'kind': 'download', 'model': model, 'phase': 'download', 'done': 0, 'total': sum(f['bytes'] for f in release['files'].values())}
            def work():
                try:
                    for name, expected in release['files'].items():
                        if not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
                            raise ValueError('模型清单文件名不合法。')
                        url = f"https://huggingface.co/{release['repo']}/resolve/{release['revision']}/{name}"
                        digest = hashlib.sha256();size = 0
                        if self.cancel.is_set(): raise InterruptedError()
                        with self.opener(url) as response, safe_path(stage / name, stage).open('xb') as target:
                            self.response = response
                            while True:
                                if self.cancel.is_set(): raise InterruptedError()
                                chunk = response.read(262144)
                                if not chunk: break
                                size += len(chunk)
                                if size > expected['bytes']: raise ValueError('模型文件超过固定清单大小。')
                                target.write(chunk);digest.update(chunk);self.job['done'] += len(chunk)
                        self.response = None
                        if size != expected['bytes'] or digest.hexdigest() != expected['sha256']:
                            raise ValueError('模型完整性校验失败，原安装保持不变。')
                    if self.cancel.is_set(): raise InterruptedError()
                    with self.lock:
                        if self.cancel.is_set(): raise InterruptedError()
                        safe_path(stage, directory);safe_path(destination, directory)
                        atomic_json(stage / '.study-owned.json', {'owner': self.state['owner'], 'model': model, 'revision': release['revision']})
                        stage.rename(destination)
                        self.state['models'][model] = str(destination);self.save();self.job['phase'] = 'complete'
                except Exception as exc:
                    self.job['phase'] = 'cancelled' if self.cancel.is_set() or isinstance(exc, InterruptedError) else 'error'
                    self.job['message'] = '已取消，原安装保持不变。' if self.job['phase'] == 'cancelled' else str(exc)
                finally:
                    self.response = None
                    if stage.exists():
                        try: self.clean_stage(stage, release)
                        except Exception as exc: self.job['cleanupMessage'] = str(exc)
            self.thread = threading.Thread(target=work, daemon=True);self.thread.start()
            return self.status()

    def cancel_download(self):
        self.cancel.set()
        if self.response:
            try: self.response.close()
            except Exception: pass
        return self.status()

    def delete(self, model, confirm):
        with self.lock:
            self.idle()
            if model not in self.catalog or confirm != model:
                raise ValueError('删除前需要明确确认所选模型。')
            path = Path(self.state['models'].get(model, ''))
            if not path.is_absolute() or not self.owns(path, model):
                raise ValueError('只允许删除管理器安装的模型，已有 small/medium 不会删除。')
            health = self.health()
            if health and (health.get('active') or health.get('queue') or model in (health.get('default_model'), (health.get('backend') or {}).get('model'))):
                raise ValueError('服务正在使用该模型，请先切换并安全停止服务。')
            if self.state.get('default_model') == model:
                raise ValueError('请先选择另一个默认模型。')
            safe_path(path)
            expected = set(self.catalog[model]['files']) | {'.study-owned.json'}
            contents = list(path.iterdir())
            if {p.name for p in contents} != expected or any(not safe_path(p, path).is_file() for p in contents):
                raise ValueError('模型目录包含额外或不安全的文件，未删除。')
            for p in contents: p.unlink()
            path.rmdir();self.state['models'].pop(model);self.save()
            return self.status()

    def start(self, model=None):
        with self.lock:
            self.idle()
            health = self.health()
            if health:
                if health.get('foreign'): raise ValueError('本地端口已由其他服务占用。')
                return self.status()
            service = read_json(self.home / 'managed-service.json', {})
            if service.get('pid') and process_stamp(service['pid']) == service.get('stamp'):
                return {**self.status(), 'starting': True}
            try:
                with socket.create_connection(('127.0.0.1', self.port), timeout=.3):
                    raise ValueError('本地端口已被占用，未重复启动服务。')
            except (ConnectionRefusedError, TimeoutError):
                pass
            installed = self.installed();legacy = read_json(self.legacy / 'settings.json', {})
            model = model or self.state.get('default_model', legacy.get('default_model', 'small'))
            if model not in installed: raise ValueError('默认模型尚未安装。')
            python = safe_path(self.legacy / '.venv/Scripts/python.exe', self.legacy)
            server = safe_path(self.home / 'service/server.py', self.home)
            if not python.is_file() or not server.is_file(): raise ValueError('配套 Python 环境或服务文件不完整。')
            instance = uuid.uuid4().hex
            cfg = {'default_model': model, 'compute_types': legacy.get('compute_types', {}), 'model_dirs': {key: entry['path'] for key, entry in installed.items()}}
            atomic_json(self.home / 'service-settings.json', cfg)
            env = dict(os.environ, LOCAL_ASR_BASE=str(self.legacy), LOCAL_ASR_MANAGER_CONFIG=str(self.home / 'service-settings.json'), LOCAL_ASR_MANAGER_INSTANCE=instance, LOCAL_ASR_PORT=str(self.port))
            with (self.home / 'service-stdout.log').open('ab') as stdout, (self.home / 'service-stderr.log').open('ab') as stderr:
                proc = subprocess.Popen([str(python), str(server)], cwd=str(server.parent), env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
            stamp = process_stamp(proc.pid)
            atomic_json(self.home / 'managed-service.json', {'pid': proc.pid, 'stamp': stamp, 'instance': instance, 'python': str(python), 'server': str(server), 'port': self.port})
            self.state['default_model'] = model;self.save()
            return {**self.status(), 'starting': True}

    def stop(self):
        with self.lock:
            self.idle()
            status = self.status()
            if not status['service']: return status
            if not status['canStop']: raise ValueError(status['stopReason'] or '当前服务不可安全停止。')
            record = read_json(self.home / 'managed-service.json', {})
            # A fixed script revalidates process creation time and executable path,
            # then terminates only this service and its Python descendants.
            command = [str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'), '-NoProfile', '-File', str(self.home / 'stop-owned-service.ps1')]
            atomic_json(self.home / 'stop-intent.json', {'instance': record['instance'], 'at': time.time()})
            try:
                result = subprocess.run(command, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=20)
                if result.returncode: raise ValueError('服务身份或活动状态发生变化，未停止；请稍后刷新状态。')
            finally:
                (self.home / 'stop-intent.json').unlink(missing_ok=True)
            return self.status()

    def handover(self, model, confirm):
        with self.lock:
            self.idle()
            if confirm != 'other-consumers-paused':
                raise ValueError('首次接管前，请确认其他使用本地识别的应用已暂停。')
            health = self.health()
            if not health: return self.start(model)
            if health.get('manager_instance'): return self.status()
            if health.get('base_path', '').casefold() != str(self.legacy).casefold() or health.get('active') or health.get('queue'):
                raise ValueError('无法确认旧服务身份，或服务仍在工作；未接管。')
            if model not in self.installed(): raise ValueError('所选模型尚未安装。')
            # The fixed takeover script checks the legacy PID, creation time,
            # executable and script, and two idle samples before any stop.
            command = [str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'), '-NoProfile', '-File', str(self.home / 'takeover-legacy.ps1')]
            result = subprocess.run(command, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=25)
            if result.returncode: raise ValueError('旧服务未满足身份或空闲检查，未接管。请暂停其他识别后重试。')
            for _ in range(20):
                if not self.health(): break
                time.sleep(.1)
            return self.start(model)

    def dispatch(self, action, args):
        allowed = {'status': set(), 'chooseDirectory': set(), 'download': {'model'}, 'cancel': set(), 'setDefault': {'model'}, 'delete': {'model', 'confirm'}, 'start': {'model'}, 'stop': set(), 'handover': {'model', 'confirm'}, 'restart': {'model'}}
        if action not in allowed or not isinstance(args, dict) or set(args) - allowed[action]:
            raise ValueError('不支持的管理操作或参数。')
        if 'model' in args and args['model'] not in self.catalog: raise ValueError('未知模型。')
        return {'status': lambda: self.status(), 'chooseDirectory': lambda: self.choose_directory(), 'download': lambda: self.download(args['model']), 'cancel': lambda: self.cancel_download(), 'setDefault': lambda: self.set_default(args['model']), 'delete': lambda: self.delete(args['model'], args.get('confirm')), 'start': lambda: self.start(args.get('model')), 'stop': lambda: self.stop(), 'handover': lambda: self.handover(args.get('model'), args.get('confirm')), 'restart': lambda: self.restart(args['model'])}[action]()

    def restart(self, model):
        with self.lock:
            if model not in self.installed(): raise ValueError('所选模型尚未安装。')
            self.stop()
            return self.start(model)
