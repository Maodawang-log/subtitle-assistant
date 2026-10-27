"""Execute the real installer against private files and an in-memory registry.

The PowerShell child removes its HKCU/HKLM drives before invoking the installer.
Registry cmdlets are intercepted, while ordinary file operations remain real.
No actual registry values, user service, installed code, or model weights change.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

NATIVE = Path(__file__).resolve().parents[1]
RUNTIME_FILES = ['manager.py', 'catalog.py', 'model_files.py', 'host.py', 'Launcher.cs', 'model-catalog.json', 'service-provenance.json',
                 'Install-Connection.ps1', 'Uninstall-Connection.ps1', 'stop-owned-service.ps1', 'takeover-legacy.ps1', 'README.md',
                 'service/server.py', 'service/window_audio.py', 'service/opening_repair.py', 'native-host.exe', 'Install-Connection.cmd', 'Uninstall-Connection.cmd']
REGISTRY_PATHS = [r'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.biliscript.local_models',
                  r'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.biliscript.local_models']

WRAPPER = r'''
param([string]$Configuration)
$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath $Configuration -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($drive in @('HKCU','HKLM')) {if(Get-PSDrive -Name $drive -ErrorAction SilentlyContinue) {Remove-PSDrive -Name $drive -Force}}
if(Get-PSDrive -Name HKCU,HKLM -ErrorAction SilentlyContinue) {throw 'Real registry drives were not detached'}
$script:registry=@{}
foreach($entry in $config.registry) {$script:registry[$entry.path]=$entry.value}
$script:writes=New-Object System.Collections.Generic.List[object]
$script:injected=$false
function Is-TestRegistry([string]$value) {return $value -like 'HKCU:\*'}
function Assert-RegistryTarget([string]$value) {if($value -notin @($config.registry.path)) {throw 'Unapproved registry target in isolated test'}}
function Test-Path {
 [CmdletBinding()]param([string]$LiteralPath,[string]$Path,[string]$PathType)
 $candidate=if($LiteralPath) {$LiteralPath} else {$Path}
 if(Is-TestRegistry $candidate) {Assert-RegistryTarget $candidate;return $script:registry.ContainsKey($candidate)}
 Microsoft.PowerShell.Management\Test-Path @PSBoundParameters
}
function Get-Item {
 [CmdletBinding()]param([string]$LiteralPath,[string]$Path,[switch]$Force)
 $candidate=if($LiteralPath) {$LiteralPath} else {$Path}
 if(Is-TestRegistry $candidate) {
  Assert-RegistryTarget $candidate
  if(!$script:registry.ContainsKey($candidate)) {throw 'Missing isolated registry value'}
  $value=[pscustomobject]@{RegistryValue=$script:registry[$candidate]}
  $value | Add-Member -MemberType ScriptMethod -Name GetValue -Value {param($name);if($name -ne '') {throw 'Unsupported isolated registry member'};return $this.RegistryValue}
  return $value
 }
 Microsoft.PowerShell.Management\Get-Item @PSBoundParameters
}
function New-Item {
 [CmdletBinding()]param([string]$Path,[string]$ItemType,[switch]$Force)
 if(Is-TestRegistry $Path) {Assert-RegistryTarget $Path;if(!$script:registry.ContainsKey($Path)) {$script:registry[$Path]=''};$script:writes.Add(@{action='create';path=$Path});return}
 Microsoft.PowerShell.Management\New-Item @PSBoundParameters
}
function Set-Item {
 [CmdletBinding()]param([string]$LiteralPath,[string]$Path,[object]$Value,[switch]$Force)
 $candidate=if($LiteralPath) {$LiteralPath} else {$Path}
 if(Is-TestRegistry $candidate) {Assert-RegistryTarget $candidate;$script:registry[$candidate]=$Value;$script:writes.Add(@{action='set';path=$candidate;value=$Value});return}
 Microsoft.PowerShell.Management\Set-Item @PSBoundParameters
}
function Remove-Item {
 [CmdletBinding()]param([string]$LiteralPath,[string]$Path,[switch]$Force,[switch]$Recurse)
 $candidate=if($LiteralPath) {$LiteralPath} else {$Path}
 if(Is-TestRegistry $candidate) {Assert-RegistryTarget $candidate;$script:registry.Remove($candidate);$script:writes.Add(@{action='remove';path=$candidate});return}
 Microsoft.PowerShell.Management\Remove-Item @PSBoundParameters
}
function Copy-Item {
 [CmdletBinding()]param([string]$LiteralPath,[string]$Path,[string]$Destination,[switch]$Force,[switch]$Recurse,[switch]$PassThru)
 $source=if($LiteralPath) {$LiteralPath} else {$Path}
 $isPackage=$source.StartsWith($config.package+'\',[StringComparison]::OrdinalIgnoreCase)
 $isBackup=$Destination -match '[\\/]code-backup-'
 if(!$script:injected -and $config.injection -eq 'failInstallCopy' -and $isPackage -and (Split-Path $source -Leaf) -eq 'host.py') {$script:injected=$true;throw 'Injected private fixture copy failure'}
 Microsoft.PowerShell.Management\Copy-Item @PSBoundParameters
 if(!$script:injected -and $config.injection -eq 'corruptBackup' -and $isBackup -and (Split-Path $source -Leaf) -eq 'manager.py') {$script:injected=$true;[IO.File]::WriteAllText($Destination,'corrupted private backup')}
 if(!$script:injected -and $config.injection -eq 'corruptInstallCopy' -and $isPackage -and (Split-Path $source -Leaf) -eq 'manager.py') {$script:injected=$true;[IO.File]::WriteAllText($Destination,'corrupted private installation')}
}
$success=$false;$errorText=''
try {
 $parameters=@{ExtensionId=@($config.extensionId)}
 if($config.installDirectory) {$parameters.InstallDirectory=$config.installDirectory}
 if($config.legacyBase) {$parameters.LegacyBase=$config.legacyBase}
 & $config.installer @parameters
 $success=$true
} catch {$errorText=$_.Exception.Message+' | '+$_.InvocationInfo.PositionMessage+' | '+$_.ScriptStackTrace}
$record=@{success=$success;error=$errorText;injectionApplied=$script:injected;registryWrites=@($script:writes.ToArray());registry=$script:registry;registryDrivesDetached=!(Get-PSDrive -Name HKCU,HKLM -ErrorAction SilentlyContinue)}
$json=$record | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($config.result,$json,(New-Object Text.UTF8Encoding($false)))
'''
# An invoked script has its own PowerShell script scope. Unique globals keep the
# interceptors bound to this private child, regardless of installer local names.
WRAPPER = (WRAPPER.replace('$config', '$global:isolatedInstallerConfig')
           .replace('$script:registry', '$global:isolatedInstallerRegistry')
           .replace('$script:writes', '$global:isolatedInstallerWrites')
           .replace('$script:injected', '$global:isolatedInstallerInjected'))


@unittest.skipUnless(os.name == 'nt', 'Windows installer and file-lock behavior')
class InstallerUpgradeReview(unittest.TestCase):
    def setUp(self):
        self.scratch = (NATIVE.parent / '.scratch').resolve()
        self.scratch.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='installer-upgrade-review-', dir=self.scratch)
        self.root = Path(self.temp.name).resolve()
        assert self.root.is_relative_to(self.scratch)
        self.package = self.root / 'package'; self.package.mkdir()
        self.home = self.root / 'original-parent' / 'manager-1.0.0'; self.home.mkdir(parents=True)
        self.legacy = self.root / 'private-asr'; self.legacy.mkdir()
        self.junctions = []
        python = self.legacy / '.venv' / 'Scripts' / 'python.exe'; python.parent.mkdir(parents=True); python.write_bytes(b'not executed')
        (self.legacy / 'settings.json').write_bytes(b'{"default_model":"small","preserve":true}')
        installer = (NATIVE / 'Install-Connection.ps1').read_text(encoding='utf-8-sig')
        for forbidden in ['Registry::', 'Microsoft.Win32.Registry', 'Start-Process', 'Stop-Process']:
            self.assertNotIn(forbidden, installer, 'Installer must remain within this test registry/process isolation boundary')
        self.new_files = {}
        self.old_files = {}
        for name in RUNTIME_FILES:
            self.new_files[name] = (b'\xef\xbb\xbf' + installer.encode('utf-8')) if name == 'Install-Connection.ps1' else ('new private 1.1 file ' + name).encode('utf-8')
            file = self.package / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(self.new_files[name])
            if name not in ('catalog.py', 'model_files.py'):
                self.old_files[name] = ('old private 1.0 file ' + name).encode('utf-8')
                old = self.home / name; old.parent.mkdir(parents=True, exist_ok=True); old.write_bytes(self.old_files[name])
        self.manifest_path = self.home / 'native-host.json'
        self.original_manifest = {'name': 'com.biliscript.local_models', 'path': str(self.home / 'native-host.exe'), 'type': 'stdio', 'allowed_origins': ['chrome-extension://' + 'a' * 32 + '/']}
        self.write_json(self.manifest_path, self.original_manifest)
        self.write_json(self.home / 'host-config.json', {'legacyBase': str(self.legacy)})
        (self.home / 'python-path.txt').write_text(str(python), encoding='utf-8')
        (self.home / 'manager.lock').write_bytes(b'0')
        self.write_json(self.home / 'manager-state.json', {'owner': 'private-original-owner', 'models': {'small': str(self.legacy / 'models' / 'faster-whisper-small')}, 'default_model': 'small'})
        self.write_json(self.home / 'managed-service.json', {'pid': 1900000000, 'stamp': 123, 'instance': 'private-existing-instance', 'python': str(python), 'server': str(self.home / 'service' / 'server.py')})
        self.write_json(self.home / 'registration-backup.json', [{'path': key, 'existed': False, 'value': None} for key in REGISTRY_PATHS])
        self.original_state = {name: (self.home / name).read_bytes() for name in ['manager-state.json', 'managed-service.json', 'registration-backup.json']}
        self.original_config = {name: (self.home / name).read_bytes() for name in ['host-config.json', 'python-path.txt', 'native-host.json']}
        self.wrapper = self.root / 'isolated-installer.ps1'; self.wrapper.write_text(WRAPPER, encoding='utf-8-sig')
        self.hash_package()

    @staticmethod
    def write_json(path, value):
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')

    def hash_package(self, extra=None):
        hashes = {name: hashlib.sha256((self.package / name).read_bytes()).hexdigest() for name in RUNTIME_FILES}
        hashes.update(extra or {})
        self.write_json(self.package / 'package-hashes.json', hashes)

    def invoke(self, injection='', install_directory='', registry=None, extension_id='b'*32):
        config = {'registry': registry or [{'path': key, 'value': str(self.manifest_path)} for key in REGISTRY_PATHS], 'extensionId': extension_id,
                  'installer': str(self.package / 'Install-Connection.ps1'), 'package': str(self.package), 'result': str(self.root / 'result.json'),
                  'installDirectory': str(install_directory), 'injection': injection}
        self.write_json(self.root / 'configuration.json', config)
        process = subprocess.run(['powershell.exe', '-NoProfile', '-File', str(self.wrapper), '-Configuration', str(self.root / 'configuration.json')],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
        self.assertEqual(process.returncode, 0, process.stderr.decode(errors='replace'))
        result = json.loads((self.root / 'result.json').read_text(encoding='utf-8-sig'))
        self.assertTrue(result['registryDrivesDetached'])
        self.assertTrue(all(item['path'] in REGISTRY_PATHS for item in result['registryWrites']))
        return result

    def assert_original_preserved(self):
        for name, expected in {**self.old_files, **self.original_config, **self.original_state}.items():
            self.assertEqual((self.home / name).read_bytes(), expected, name)
        for name in ('catalog.py', 'model_files.py'):
            self.assertFalse((self.home / name).exists(), 'Failed upgrade left a new runtime file: ' + name)

    def create_junction(self, path, target):
        assert path.parent.resolve().is_relative_to(self.root) and target.resolve().is_relative_to(self.root)
        def quote(value): return "'" + str(value).replace("'", "''") + "'"
        subprocess.run(['powershell.exe', '-NoProfile', '-Command', 'New-Item -ItemType Junction -Path ' + quote(path) + ' -Target ' + quote(target) + ' | Out-Null'],
                       check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
        self.junctions.append(path)

    def tearDown(self):
        for path in reversed(self.junctions):
            try: attributes = path.lstat().st_file_attributes
            except FileNotFoundError: continue
            assert path.parent.resolve().is_relative_to(self.root)
            if attributes & 0x400: os.rmdir(path)
        assert self.root.is_relative_to(self.scratch) and not self.root.is_symlink()
        for child in self.root.rglob('*'):
            info = child.lstat()
            assert not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400)
        self.temp.cleanup()

    def test_upgrade_reuses_registered_extension_ids_without_prompt(self):
        result=self.invoke(extension_id=[])
        self.assertTrue(result['success'], result['error'])
        manifest=json.loads((self.home/'native-host.json').read_text(encoding='utf-8-sig'))
        self.assertEqual(manifest['allowed_origins'], ['chrome-extension://'+'a'*32+'/'])

    def test_live_managed_service_rejects_upgrade_without_stopping_it(self):
        self.write_json(self.home / 'managed-service.json', {'pid': os.getpid(), 'instance': 'private-live-test'})
        before = {name: (self.home / name).read_bytes() for name in self.old_files}
        result = self.invoke()
        self.assertFalse(result['success']); self.assertEqual(result['registryWrites'], [])
        self.assertIn('服务仍在运行', result['error'])
        for name, data in before.items(): self.assertEqual((self.home / name).read_bytes(), data)

    def test_upgrade_adopts_registered_home_preserves_owner_state_pid_and_verifiable_old_code(self):
        result = self.invoke()
        self.assertTrue(result['success'], result['error'])
        for name, value in self.new_files.items():
            self.assertEqual((self.home / name).read_bytes(), value, name)
        for name, value in self.original_state.items():
            self.assertEqual((self.home / name).read_bytes(), value, name)
        self.assertEqual(json.loads((self.home / 'host-config.json').read_text(encoding='utf-8-sig'))['legacyBase'], str(self.legacy))
        self.assertEqual(result['registry'], {key: str(self.manifest_path) for key in REGISTRY_PATHS})
        manifest = json.loads(self.manifest_path.read_text(encoding='utf-8-sig'))
        self.assertEqual(set(manifest['allowed_origins']), {'chrome-extension://' + 'a' * 32 + '/', 'chrome-extension://' + 'b' * 32 + '/'})
        backups = list(self.home.glob('code-backup-*')); self.assertEqual(len(backups), 1)
        for name, value in {**self.old_files, **self.original_config}.items():
            self.assertEqual((backups[0] / name).read_bytes(), value, 'Backup ' + name)

    def test_held_real_native_style_lock_refuses_upgrade_without_touching_old_files(self):
        import msvcrt
        with (self.home / 'manager.lock').open('a+b') as lock:
            lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            try: result = self.invoke()
            finally: lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        self.assertFalse(result['success'])
        self.assertEqual(result['registryWrites'], [])
        self.assertEqual(list(self.home.glob('code-backup-*')), [])
        self.assert_original_preserved()

    def test_copy_failure_restores_old_code_and_removes_new_runtime_files(self):
        result = self.invoke('failInstallCopy')
        self.assertTrue(result['injectionApplied'])
        self.assertFalse(result['success'])
        self.assert_original_preserved()
        self.assertEqual(result['registry'], {key: str(self.manifest_path) for key in REGISTRY_PATHS})

    def test_backup_corruption_is_detected_before_original_code_is_overwritten(self):
        result = self.invoke('corruptBackup')
        self.assertTrue(result['injectionApplied'])
        self.assertFalse(result['success'], 'Installer accepted a silently corrupted code backup')
        self.assertEqual(result['registryWrites'], [])
        self.assert_original_preserved()

    def test_installed_copy_corruption_is_detected_and_rolled_back(self):
        result = self.invoke('corruptInstallCopy')
        self.assertTrue(result['injectionApplied'])
        self.assertFalse(result['success'], 'Installer accepted a corrupted installed runtime')
        self.assert_original_preserved()

    def test_package_relative_escape_cannot_overwrite_sibling_files(self):
        source = self.root / 'outside-sentinel.txt'; source.write_bytes(b'outside package payload')
        target = self.home.parent / 'outside-sentinel.txt'; target.write_bytes(b'KEEP PRIVATE SIBLING')
        self.hash_package({'../outside-sentinel.txt': hashlib.sha256(source.read_bytes()).hexdigest()})
        result = self.invoke()
        self.assertFalse(result['success'])
        self.assertEqual(target.read_bytes(), b'KEEP PRIVATE SIBLING')
        self.assertEqual(result['registryWrites'], [])
        self.assert_original_preserved()

    def test_existing_live_and_broken_child_junctions_refuse_upgrade(self):
        target = self.root / 'extra-target'; target.mkdir(); (target / 'keep.txt').write_bytes(b'keep')
        junction = self.home / 'linked-extra'; self.create_junction(junction, target)
        live = self.invoke()
        self.assertFalse(live['success']); self.assertEqual(live['registryWrites'], [])
        self.assert_original_preserved()
        moved = self.root / 'moved-extra-target'
        assert target.resolve().is_relative_to(self.root) and moved.parent.resolve() == self.root
        target.rename(moved)
        broken = self.invoke()
        self.assertFalse(broken['success']); self.assertEqual(broken['registryWrites'], [])
        self.assert_original_preserved()
        self.assertEqual((moved / 'keep.txt').read_bytes(), b'keep')

    def test_source_package_junction_is_rejected_even_when_file_hashes_match(self):
        source_directory = self.package / 'service'; moved = self.root / 'external-source-service'
        assert source_directory.resolve().is_relative_to(self.root) and moved.parent.resolve() == self.root
        source_directory.rename(moved)
        self.create_junction(source_directory, moved)
        result = self.invoke()
        self.assertFalse(result['success'], 'Package source junction was followed')
        self.assertEqual(result['registryWrites'], [])
        self.assert_original_preserved()

    def test_changing_registered_home_or_conflicting_browser_homes_is_refused(self):
        attempted = self.root / 'unexpected-new-home'
        result = self.invoke(install_directory=attempted)
        self.assertFalse(result['success']); self.assertFalse(attempted.exists())
        conflict = [{'path': REGISTRY_PATHS[0], 'value': str(self.manifest_path)}, {'path': REGISTRY_PATHS[1], 'value': str(self.root / 'other-home' / 'native-host.json')}]
        result = self.invoke(registry=conflict)
        self.assertFalse(result['success']); self.assertEqual(result['registryWrites'], [])
        self.assert_original_preserved()


if __name__ == '__main__':
    unittest.main()
