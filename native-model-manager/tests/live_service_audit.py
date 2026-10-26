"""Real independent loopback service start/switch/stop; reuse original weights read-only."""
from pathlib import Path
import hashlib, json, os, shutil, socket, subprocess, sys, time
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'native-model-manager'))
from manager import Manager, atomic_json, process_stamp
out=root/'.scratch/native-service-live';out.mkdir(parents=True,exist_ok=True)
home=out/('managed-'+str(int(time.time())));shutil.copytree(root/'.scratch/model-manager-package',home)
legacy=root.parent.parent/'local-asr';atomic_json(home/'host-config.json',{'legacyBase':str(legacy)})
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
checks=[];evidence={'scope':'real separate CPU ASR process on a free loopback port; original GPU service and models retained; model warm-up only, no video/audio jobs','port':port,'checks':checks}
manager=Manager(home,port=port)
def check(name,value,detail=None):
    checks.append({'name':name,'ok':bool(value),'detail':detail});print(name, bool(value),flush=True)
    if not value:raise AssertionError(name)
def ready():
    limit=time.monotonic()+150
    while time.monotonic()<limit:
        value=manager.health()
        if value and value.get('status')=='ok':return value
        time.sleep(.5)
    raise TimeoutError('Independent model warm-up did not finish')
before=hashlib.sha256((legacy/'settings.json').read_bytes()).hexdigest()
old_device=os.environ.get('LOCAL_ASR_DEVICE');os.environ['LOCAL_ASR_DEVICE']='cpu'
try:
    first=manager.start('small');record=json.loads((home/'managed-service.json').read_text(encoding='utf-8'))
    second=manager.start('small');check('start-during-warmup-reuses-one-process',json.loads((home/'managed-service.json').read_text(encoding='utf-8'))['pid']==record['pid'] and second['starting'])
    small=ready();check('real-small-model-ready',small['backend']['model']=='small' and small['backend']['device']=='cpu',small['backend'])
    check('no-ASR-jobs-started',small['jobs_started']==0)
    manager.stop();check('owned-service-stopped',manager.health() is None)
    manager.set_default('medium');manager.start();medium=ready();check('real-medium-default-and-model-ready',medium['default_model']=='medium' and medium['backend']['model']=='medium',medium['backend'])
    check('model-paths-reuse-original-files',Path(medium['model_path'])==legacy/'models/faster-whisper-medium')
    import urllib.request
    request=urllib.request.Request(f'http://127.0.0.1:{port}/v1/audio/window',method='OPTIONS',headers={'Origin':'chrome-extension://'+'a'*32,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-biliscript-consumer'})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=3) as response:
        check('new-service-CORS-consumer-header',response.status==200 and 'x-biliscript-consumer' in response.headers.get('Access-Control-Allow-Headers','').lower())
    manager.stop();check('medium-service-stopped-safely',manager.health() is None)
    check('legacy-default-settings-unchanged',hashlib.sha256((legacy/'settings.json').read_bytes()).hexdigest()==before)
except Exception as exc:
    evidence['error']=str(exc);raise
finally:
    if old_device is None:os.environ.pop('LOCAL_ASR_DEVICE',None)
    else:os.environ['LOCAL_ASR_DEVICE']=old_device
    record_path=home/'managed-service.json'
    if record_path.exists():
        record=json.loads(record_path.read_text(encoding='utf-8'))
        if process_stamp(record['pid'])==record['stamp']:
            # Test cleanup targets only the freshly spawned, stamped private process.
            subprocess.run(['taskkill','/PID',str(record['pid']),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    atomic_json(out/'evidence.json',evidence)
