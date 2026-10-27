"""Build a portable release. Never install it or register/start the native companion."""
from pathlib import Path
import argparse, hashlib, json, os, re, shutil, subprocess, sys, zipfile

ROOT = Path(__file__).resolve().parents[1]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--skip-native', action='store_true')
    parser.add_argument('--output-root', type=Path, default=ROOT / 'release')
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text('utf-8-sig'))['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:\.\d+)?', version):
        raise ValueError('Invalid release version')
    output = args.output_root.resolve()
    package = output / f'subtitle-assistant-{version}'
    archive = output / (package.name + '.zip')
    if package.exists() or archive.exists():
        raise FileExistsError('Output already exists; use a fresh --output-root. Releases are not overwritten.')
    subprocess.run(['node', 'scripts/build-study.cjs'], cwd=ROOT, check=True)
    dist = ROOT / 'dist-study'
    manifest = json.loads((dist / 'manifest.json').read_text('utf-8'))
    assert manifest['version'] == version
    native = not args.skip_native
    native_version = re.search(r"return \{'version': '([^']+)'", (ROOT / 'native-model-manager/manager.py').read_text('utf-8')).group(1)
    if native:
        if os.name != 'nt':
            raise RuntimeError('Native launcher needs Windows. Use --skip-native for an extension-only package.')
        subprocess.run([sys.executable, 'scripts/build-model-manager.py'], cwd=ROOT, check=True)
    package.mkdir(parents=True)
    shutil.copytree(dist, package / 'extension')
    if native:
        src = ROOT / '.scratch/model-manager-package'
        hashes = json.loads((src / 'package-hashes.json').read_text('utf-8'))
        for name, digest in hashes.items():
            assert sha(src / name) == digest
            dest = package / 'native-model-manager' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src / name, dest)
        shutil.copy2(src / 'package-hashes.json', package / 'native-model-manager/package-hashes.json')
        shutil.copy2(ROOT / 'native-model-manager/requirements-windows.lock.txt', package / 'native-model-manager/requirements-windows.lock.txt')
    for name in ['README.md', 'PRIVACY.md', 'LICENSE', 'NOTICE.md', 'CHANGELOG.md']:
        shutil.copy2(ROOT / name, package / name)
    (package / 'docs').mkdir()
    shutil.copy2(ROOT / 'docs/release.md', package / 'docs/release.md')
    shutil.copytree(ROOT / 'docs/upstream', package / 'docs/upstream')
    if not native:
        (package / 'native-model-manager').mkdir()
        for name in ['README.md', 'requirements-windows.lock.txt']:
            shutil.copy2(ROOT / 'native-model-manager' / name, package / 'native-model-manager' / name)
    script = (ROOT / 'scripts/update-study-release.ps1').read_text('utf-8-sig')
    (package / 'Update-Extension.ps1').write_text(script, encoding='utf-8-sig')
    (package / 'Update-Extension.cmd').write_bytes(b'@echo off\r\npowershell.exe -NoProfile -File "%~dp0Update-Extension.ps1" %*\r\nset "result=%errorlevel%"\r\npause\r\nexit /b %result%\r\n')
    descriptor = dict(schema=1, product='subtitle-assistant', version=version,
                      nativeVersion=native_version if native else None,
                      sourceCommit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                      sourceDirty=bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT)),
                      files={p.relative_to(dist).as_posix(): sha(p) for p in sorted(dist.rglob('*')) if p.is_file()})
    (package / 'release.json').write_text(json.dumps(descriptor, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    hashes = {p.relative_to(package).as_posix(): sha(p) for p in sorted(package.rglob('*')) if p.is_file()}
    (package / 'package-hashes.json').write_text(json.dumps(hashes, indent=2)+'\n', encoding='utf-8')
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as z:
        for p in sorted(package.rglob('*')):
            if p.is_file():
                z.write(p, package.name+'/'+p.relative_to(package).as_posix())
    result = dict(package=str(package), zip=str(archive), sha256=sha(archive), bytes=archive.stat().st_size,
                  version=version, nativeVersion=descriptor['nativeVersion'], files=len(hashes)+1,
                  sourceCommit=descriptor['sourceCommit'], sourceDirty=descriptor['sourceDirty'], installed=False)
    (output / (package.name+'-verification.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
