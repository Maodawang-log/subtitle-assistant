"""Native Messaging framing; stdout is exclusively little-endian framed UTF-8."""
import json, os, struct, sys
from pathlib import Path
from manager import Manager, read_json, safe_path


def read_exact(stream, size):
    chunks = bytearray()
    while len(chunks) < size:
        value = stream.read(size - len(chunks))
        if not value:
            if not chunks: return None
            raise ValueError('Incomplete native message')
        chunks.extend(value)
    return bytes(chunks)


def reply(value):
    data = json.dumps(value, ensure_ascii=False).encode('utf-8')
    if len(data) > 900000: raise ValueError('Native response too large')
    sys.stdout.buffer.write(struct.pack('<I', len(data)) + data);sys.stdout.buffer.flush()


def main():
    home = safe_path(Path(__file__).resolve().parent)
    manifest = read_json(home / 'native-host.json', {})
    origin = sys.argv[1] if len(sys.argv) > 1 else ''
    if origin not in manifest.get('allowed_origins', []): return 2
    if os.name == 'nt':
        import msvcrt
        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY);msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    lock = safe_path(home / 'manager.lock', home).open('a+b')
    try:
        if os.name == 'nt':
            lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0);msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        lock.close();return 3
    manager = Manager(home)
    try:
        while header := read_exact(sys.stdin.buffer, 4):
            size = struct.unpack('<I', header)[0]
            if not 0 < size <= 65536: return 4
            raw = read_exact(sys.stdin.buffer, size)
            if raw is None: return 4
            request = json.loads(raw)
            if not isinstance(request, dict) or set(request) - {'id', 'action', 'args'}: return 4
            ident = request.get('id')
            if not isinstance(ident, str) or not 0 < len(ident) <= 80: return 4
            try: reply({'id': ident, 'ok': True, 'data': manager.dispatch(request.get('action'), request.get('args', {}))})
            except Exception as exc: reply({'id': ident, 'ok': False, 'error': str(exc)[:500]})
    finally:
        manager.cancel_download()
        if manager.thread: manager.thread.join(timeout=15)
        lock.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
