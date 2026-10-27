"""Exercise the Windows release updater in isolated disposable directories only."""
from pathlib import Path
import argparse, hashlib, json, shutil, subprocess, sys, tempfile

ROOT = Path(__file__).resolve().parents[1]

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def snapshot(p): return {f.relative_to(p).as_posix(): digest(f) for f in p.rglob('*') if f.is_file()}

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--package', type=Path)
    args=parser.parse_args()
    version=json.loads((ROOT/'package.json').read_text('utf-8-sig'))['version']
    package=(args.package or ROOT/'release'/f'subtitle-assistant-{version}').resolve()
    work=ROOT/'.scratch/release-upgrade-tests'; work.mkdir(parents=True,exist_ok=True)
    area=Path(tempfile.mkdtemp(prefix='case-',dir=work)); target=area/'original'; backups=area/'backups'
    checks=[]
    def check(name, condition):
        checks.append(dict(name=name,ok=bool(condition)))
        if not condition: raise AssertionError(name)
    def run(*extra, ok=True):
        cp=subprocess.run(['powershell.exe','-NoProfile','-File',str(package/'Update-Extension.ps1'),*map(str,extra)],capture_output=True)
        if (cp.returncode==0)!=ok:
            raise AssertionError(f'Unexpected updater exit {cp.returncode}: '+cp.stdout.decode('utf-8','replace')+cp.stderr.decode('utf-8','replace'))
        return cp
    def update(*extra,ok=True): return run('-ExistingDirectory',target,'-PackageDirectory',package,'-BackupDirectory',backups,*extra,ok=ok)
    shutil.copytree(package/'extension',target)
    m=json.loads((target/'manifest.json').read_text('utf-8')); m['version']='2.6.5.2'
    (target/'manifest.json').write_text(json.dumps(m,ensure_ascii=False),encoding='utf-8')
    (target/'entry/study.js').write_text('// original fixture\n',encoding='utf-8')
    (target/'retained-user-file.txt').write_text('Keep this unrelated file',encoding='utf-8')
    (target/'NOTICE.md').unlink()
    before=snapshot(target)
    try:
        update('-WhatIf'); check('preview leaves exact target bytes and creates no backup',snapshot(target)==before and not backups.exists())
        update(); folders=list(backups.iterdir()); backup=folders[0]
        check('one complete backup',len(folders)==1 and snapshot(backup/'files')==before)
        descriptor=json.loads((package/'release.json').read_text('utf-8'))
        check('all published files match including manifest',all(digest(target/name)==sha for name,sha in descriptor['files'].items()))
        check('unrelated file retained',digest(target/'retained-user-file.txt')==before['retained-user-file.txt'])
        check('original path preserved',target.is_dir() and json.loads((target/'manifest.json').read_text('utf-8'))['version']==version)
        after=snapshot(target); update(); check('identical update is a no-op',snapshot(target)==after and len(list(backups.iterdir()))==1)
        run('-RestoreBackup',backup,'-WhatIf'); check('rollback preview is a no-op',snapshot(target)==after)
        run('-RestoreBackup',backup); check('rollback restores every original byte and removes added files',snapshot(target)==before)
        update(); backup=sorted(backups.iterdir())[-1]; (target/'entry/study.js').write_text('// later version\n',encoding='utf-8')
        changed=snapshot(target); run('-RestoreBackup',backup,ok=False); check('later edits block rollback without any writes',snapshot(target)==changed)
        # Restore only this fixture to its before state for independent rejection checks.
        shutil.copy2(backup/'files/entry/study.js',target/'entry/study.js')
        m['version']='9.0.0'; (target/'manifest.json').write_text(json.dumps(m),encoding='utf-8'); changed=snapshot(target)
        update(ok=False); check('newer target rejected without mutation',snapshot(target)==changed)
        m['version']='2.6.5.2';m['key']='fixture-identity';(target/'manifest.json').write_text(json.dumps(m),encoding='utf-8');changed=snapshot(target)
        update(ok=False);check('identity key mismatch rejected',snapshot(target)==changed)
        m.pop('key');(target/'manifest.json').write_text(json.dumps(m),encoding='utf-8')
        broken=area/'corrupt-package';shutil.copytree(package,broken);(broken/'extension/entry/study.js').write_text('// corrupt',encoding='utf-8')
        changed=snapshot(target);run('-ExistingDirectory',target,'-PackageDirectory',broken,ok=False);check('corrupt payload rejected before backup or mutation',snapshot(target)==changed)
        # A junction is checked without traversing it. No recursive deletion is used.
        outside=area/'outside';outside.mkdir();(outside/'sentinel.txt').write_text('protected',encoding='utf-8');link=target/'linked'
        ps="New-Item -ItemType Junction -Path '"+str(link).replace("'","''")+"' -Target '"+str(outside).replace("'","''")+"' | Out-Null"
        subprocess.run(['powershell.exe','-NoProfile','-Command',ps],check=True,capture_output=True)
        try:
            update(ok=False);check('target junction rejected and outside remains unchanged',(outside/'sentinel.txt').read_text('utf-8')=='protected')
        finally:
            # Only remove the exact junction entry, never its target.
            subprocess.run(['powershell.exe','-NoProfile','-Command',"[IO.Directory]::Delete('"+str(link).replace("'","''")+"')"],check=True,capture_output=True)
        check('package unchanged by all updater checks',all(digest(package/'extension'/name)==sha for name,sha in descriptor['files'].items()))
    finally:
        report=dict(success=all(c['ok'] for c in checks),checks=checks,fixture=str(area),package=str(package),realInstallationModified=False)
        (work/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8');main()
