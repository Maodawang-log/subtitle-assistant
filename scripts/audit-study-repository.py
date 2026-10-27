"""Offline, value-redacting audit of reachable Git blobs and committable work files.

This is a targeted credential/size/path check, not a proof that every secret format
is detectable. Known invalid credentials are allowed only in specific tests.
"""
from pathlib import Path
import hashlib, json, re, subprocess, sys

ROOT=Path(__file__).resolve().parents[1]
PATTERNS={
    'private-key':rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    'github-token':rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})',
    'provider-key':rb'\bsk-[A-Za-z0-9_-]{24,}',
    'aws-key':rb'\bAKIA[0-9A-Z]{16}\b',
    'credential-url':rb"https?://[^\s/:@'\"]+:[^\s/@'\"]+@",
}
def allowed(path,value):
    return (path=='tests/e2e/asr-decode-chunk-merge.e2e.test.ts' and value==b'sk-'+b'biliscript-e2e-invalid-key') or (
        path in ('tests/study-cc-proxy-background.test.ts','tests/study-native-source.test.ts') and value==b'https://'+b'user:pass@')

def main():
    findings=[]; allowances=[]; large=[]; count=0
    def scan(path,data,scope):
        for kind,pattern in PATTERNS.items():
            for match in re.finditer(pattern,data):
                item=dict(scope=scope,path=path,kind=kind,line=data[:match.start()].count(b'\n')+1)
                (allowances if allowed(path,match[0]) else findings).append(item)
    objects=subprocess.check_output(['git','rev-list','--objects','--all'],cwd=ROOT,encoding='utf-8').splitlines()
    process=subprocess.Popen(['git','cat-file','--batch'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    for line in objects:
        oid,_,path=line.partition(' ');process.stdin.write((oid+'\n').encode());process.stdin.flush()
        header=process.stdout.readline().split();size=int(header[2]);data=process.stdout.read(size);process.stdout.read(1)
        if header[1]!=b'blob':continue
        count+=1
        if size>10*1024*1024:large.append(dict(path=path,object=oid,bytes=size))
        scan(path,data,'history')
    process.stdin.close();process.wait()
    files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).decode().split('\0')
    denied=[]
    for name in filter(None,files):
        path=ROOT/name
        if not path.is_file():continue
        scan(name,path.read_bytes(),'working')
        if re.search(r'(^|/)(node_modules|\.venv|models|profiles?|outputs|snapshots|\.scratch)(/|$)|(^|/)\.env($|\.)|\.(wav|mp3|m4a|mp4|webm|srt|vtt|sqlite|pfx|pem|key|zip|exe)$',name,re.I):denied.append(name)
    report=dict(historyBlobs=count,workingFiles=len(files)-1,findings=findings,testPlaceholders=allowances,largeBlobs=large,excludedPathViolations=denied,
                success=not(findings or denied or large),scope='All reachable refs and tracked/unignored files; values never printed. Committed public upstream fixtures and required IPADIC data retained.')
    output=ROOT/'.scratch/repository-audit.json';output.parent.mkdir(exist_ok=True);output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False));return 0 if report['success'] else 1

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8');sys.exit(main())
