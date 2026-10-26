"""Verify real Windows junction rejection without registering or starting anything."""
from pathlib import Path
import json, os, subprocess, sys, uuid

source = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(source))
from manager import safe_path

root = source.parent / '.scratch' / ('path-guard-' + uuid.uuid4().hex)
root.mkdir(parents=True)
target = root / 'target';target.mkdir()
junction = root / 'junction'
checks = []
def check(name, condition):
    checks.append({'name': name, 'ok': bool(condition)})
    if not condition: raise AssertionError(name)
def quote(value):
    return "'" + str(value).replace("'", "''") + "'"
def rejected_by_manager():
    try: safe_path(junction / 'future-models')
    except ValueError: return True
    return False
def installer(args):
    return subprocess.run(['powershell.exe', '-NoProfile', '-File', str(source / 'Install-Connection.ps1'), '-ExtensionId', 'a'*32, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)

try:
    subprocess.run(['powershell.exe', '-NoProfile', '-Command', 'New-Item -ItemType Junction -Path '+quote(junction)+' -Target '+quote(target)+' | Out-Null'], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    check('manager-rejects-live-junction-parent', rejected_by_manager())
    check('installer-rejects-live-junction-parent', installer(['-WhatIf', '-InstallDirectory', str(junction / 'connection')]).returncode != 0)
    assert target.resolve().is_relative_to(root.resolve()) and not target.is_symlink()
    target.rmdir()  # Empty test directory, deliberately leaving the junction broken.
    check('manager-rejects-broken-junction-parent', rejected_by_manager())
    check('installer-rejects-broken-junction-parent', installer(['-WhatIf', '-InstallDirectory', str(junction / 'connection')]).returncode != 0)
    unrelated = root / 'unrelated';unrelated.mkdir();marker=unrelated/'keep.txt';marker.write_text('preserve', encoding='utf-8')
    check('installer-preserves-unrelated-directory', installer(['-InstallDirectory', str(unrelated)]).returncode != 0 and marker.read_text(encoding='utf-8') == 'preserve' and len(list(unrelated.iterdir())) == 1)
finally:
    if junction.lstat().st_file_attributes & 0x400:
        assert junction.parent.resolve() == root.resolve()
        os.rmdir(junction)  # Remove only the verified test junction, never its target.
    report=source.parent/'.scratch/path-guard-evidence.json'
    report.write_text(json.dumps({'scope': 'real Windows filesystem and installer guard; no registration, service or model download', 'checks': checks}, indent=2), encoding='utf-8')
print(json.dumps({'passed':len(checks),'failed':[x for x in checks if not x['ok']]}))
