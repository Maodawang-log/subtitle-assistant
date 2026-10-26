"""Build a reviewable native package; never install/register or start services."""
from pathlib import Path
import hashlib, json, shutil, subprocess, sys

root = Path(__file__).resolve().parents[1]
source = root / 'native-model-manager'
target = root / '.scratch/model-manager-package'
target.mkdir(parents=True, exist_ok=True)
assert target.resolve().is_relative_to((root / '.scratch').resolve())
names = ['manager.py', 'host.py', 'Launcher.cs', 'model-catalog.json', 'service-provenance.json', 'Install-Connection.ps1', 'Uninstall-Connection.ps1', 'stop-owned-service.ps1', 'takeover-legacy.ps1', 'README.md', 'service/server.py', 'service/window_audio.py']
for name in names:
    dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True)
    if name.endswith('.ps1'):
        dest.write_text((source/name).read_text(encoding='utf-8-sig'),encoding='utf-8-sig')
    else:
        shutil.copy2(source/name,dest)
compiler=Path(r'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe')
subprocess.run([str(compiler),'/nologo','/target:exe','/out:'+str(target/'native-host.exe'),str(source/'Launcher.cs')],check=True,creationflags=subprocess.CREATE_NO_WINDOW)
(target/'Install-Connection.cmd').write_bytes(b'@echo off\r\npowershell.exe -NoProfile -File "%~dp0Install-Connection.ps1"\r\npause\r\n')
(target/'Uninstall-Connection.cmd').write_bytes(b'@echo off\r\npowershell.exe -NoProfile -File "%~dp0Uninstall-Connection.ps1"\r\npause\r\n')
names+=['native-host.exe','Install-Connection.cmd','Uninstall-Connection.cmd']
hashes={name:hashlib.sha256((target/name).read_bytes()).hexdigest() for name in names}
(target/'package-hashes.json').write_text(json.dumps(hashes,indent=2),encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
print(json.dumps({'package':str(target),'files':len(hashes),'registered':False,'serviceStarted':False},ensure_ascii=False))
