import path from 'node:path';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {REPO_ROOT,launchBrowser,attachPage,createWorkerSession,screenshot,teardown,waitFor,writeEvidence,artifactDir,log} from './harness.mjs';

const out=artifactDir(path.join('study-native-manager-2.6.5.2',String(Date.now())));
const distDir=path.join(out,'isolated-dist'),packageDir=path.join(out,'isolated-package'),installed=path.join(out,'temporary-connection');
const productHost='com.biliscript.local_models',testHost='com.biliscript.local_models_audit2652';
const registryRoots=['HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\','HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\'];
const productKeys=registryRoots.map(root=>root+productHost),testKeys=registryRoots.map(root=>root+testHost);
const checks=[],cdps=[],blockedAudioRequests=[],evidence={scope:'Real Edge, Launcher.exe, Native Messaging and ja/en UI against a private native home and test-only HKCU alias; production registrations and shared ASR unchanged',checks,
  allowedNativeActions:['status','setDefault','start'],forbiddenNativeActions:['download','delete','handover','restart','stop','setLegacyDefault','refreshCatalog'],
  instrumentation:'Copied host identifiers, a test-only Popen refusal hook, and browser Fetch guards for audio endpoints. These guards are unreachable in successful status/default/shared-reuse checks; they prevent accidental ASR work or cold start.'};
let browser,page,worker,cleanupArmed=false,productionBefore,sharedBefore;
const sha=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const psCommand=command=>execFileSync('powershell.exe',['-NoProfile','-Command',"[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);"+command],{encoding:'utf8',windowsHide:true,timeout:30000}).trim();
const ps=(file,args=[])=>execFileSync('powershell.exe',['-NoProfile','-File',file,...args],{encoding:'utf8',windowsHide:true,timeout:30000});
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});if(!ok)throw new Error(name+': '+JSON.stringify(detail));log('PASS '+name)};
function registrySnapshot(keys){
  return JSON.parse(psCommand(`$records=@(${keys.map(quote).join(',')} | ForEach-Object {$exists=Test-Path -LiteralPath $_;$value=if($exists){(Get-Item -LiteralPath $_).GetValue('')}else{$null};[pscustomobject]@{path=$_;existed=$exists;value=$value}});ConvertTo-Json -Depth 5 -Compress -InputObject $records`));
}
async function productionSnapshot(){
  const records=registrySnapshot(productKeys);
  for(const record of records){
    if(record.existed&&typeof record.value==='string'){
      const bytes=await readFile(record.value);record.manifestSha256=sha(bytes);
      const manifest=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));record.manifestHost=manifest.name;
    }
  }
  return records;
}
async function sharedSnapshot(){
  let health;
  try{const response=await fetch('http://127.0.0.1:18766/health',{signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error('health '+response.status);health=await response.json();}
  catch(error){return {available:false,error:String(error)}}
  const script=`function Identity([int]$processId){if(!$processId){return $null};$process=Get-Process -Id $processId -ErrorAction Stop;return @{pid=$processId;startTicks=$process.StartTime.ToUniversalTime().Ticks.ToString()}};$listeners=@(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 18766 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique);if($listeners.Count -ne 1){throw 'Ambiguous shared listener'};$result=@{listener=(Identity $listeners[0]);worker=(Identity ${Number(health.worker_pid)||0})};ConvertTo-Json -Depth 5 -Compress -InputObject $result`;
  return {available:true,health,identity:JSON.parse(psCommand(script))};
}
async function request(action,args={}){
  if(!evidence.allowedNativeActions.includes(action))throw new Error('Audit action is not allowed: '+action);
  return page.cdp.evaluate(`chrome.runtime.sendMessage(${JSON.stringify({type:'study-model-manager',action,args})})`);
}
async function guardAudio(cdp,sessionId){
  cdp.on('Fetch.requestPaused',async event=>{
    blockedAudioRequests.push({url:event.request.url,method:event.request.method});
    await cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'},sessionId);
  });
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'http://127.0.0.1:18766/v1/audio/*',requestStage:'Request'}]},sessionId);
}
async function clickButton(selector){
  await page.cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  const point=await page.cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,width:r.width,height:r.height,enabled:!e.disabled,hit:document.elementFromPoint(x,y)===e,text:e.textContent}})()`);
  check('button-can-receive-input-'+selector,point.width>0&&point.height>0&&point.enabled&&point.hit,point);
  await page.cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:point.x,y:point.y});
  await page.cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:point.x,y:point.y});
}
async function captureLanguage(language){
  await page.cdp.evaluate(`(()=>{const e=document.getElementById('defaultSourceLanguage');e.value=${JSON.stringify(language)};e.dispatchEvent(new Event('change',{bubbles:true}));const f=document.getElementById('modelFilter');f.value=${JSON.stringify(language)};f.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor('source language saved',()=>page.cdp.evaluate(`chrome.storage.local.get('biliscriptJapaneseSettings').then(x=>x.biliscriptJapaneseSettings.sourceLanguage===${JSON.stringify(language)})`));
  const status=await request('status');
  const rows=await page.cdp.evaluate("Array.from(document.querySelectorAll('#models [data-model]'),e=>e.dataset.model)");
  check(language+'-model-filter-matches-explicit-capabilities',status.ok&&rows.includes('small')&&rows.includes('medium')&&rows.every(id=>status.data.models.some(model=>model.id===id&&model[language==='en'?'englishSupported':'japaneseSupported']===true)),rows);
  await page.cdp.evaluate("document.getElementById('modelService').closest('section').scrollIntoView({block:'start',behavior:'instant'})");
  await screenshot(page.cdp,path.join(out,`settings-native-${language}.png`));
}

try{
  await mkdir(out,{recursive:true});
  productionBefore=await productionSnapshot();evidence.productionBefore=productionBefore;
  sharedBefore=await sharedSnapshot();evidence.sharedBefore=sharedBefore;
  check('test-only-registration-starts-absent',registrySnapshot(testKeys).every(item=>!item.existed));
  await cp(path.join(REPO_ROOT,'dist-study'),distDir,{recursive:true});
  await cp(path.join(REPO_ROOT,'.scratch/model-manager-package'),packageDir,{recursive:true});
  const extensionManifest=JSON.parse(await readFile(path.join(distDir,'manifest.json'),'utf8'));
  check('extension-is-2652',extensionManifest.version==='2.6.5.2',extensionManifest.version);
  for(const file of [path.join(distDir,'entry/study-background.js'),path.join(packageDir,'Install-Connection.ps1'),path.join(packageDir,'Uninstall-Connection.ps1')]){
    const source=await readFile(file,'utf8');check('test-host-rewrite-target-exists-'+path.basename(file),source.includes(productHost));
    await writeFile(file,source.replaceAll(productHost,testHost));
  }
  const managerPath=path.join(packageDir,'manager.py'),originalManager=await readFile(managerPath,'utf8');
  evidence.productManagerSha256=sha(originalManager);
  await writeFile(managerPath,originalManager+'\n\ndef _audit2652_forbid_process_start(*args, **kwargs):\n    raise RuntimeError("Browser audit cannot start a new ASR process")\nsubprocess.Popen = _audit2652_forbid_process_start\n');
  const packageHashes=JSON.parse(await readFile(path.join(packageDir,'package-hashes.json'),'utf8'));
  for(const name of Object.keys(packageHashes))packageHashes[name]=sha(await readFile(path.join(packageDir,name)));
  await writeFile(path.join(packageDir,'package-hashes.json'),JSON.stringify(packageHashes,null,2));evidence.testPackageHashes=packageHashes;
  const temp=path.join(REPO_ROOT,'.scratch/browser-temp');await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
  browser=await launchBrowser({distDir,profilePrefix:'study-native-2652-',muted:true,sync:false});
  page=await attachPage(browser);cdps.push(page.cdp);worker=createWorkerSession({pageCdp:page.cdp,browser,distDir});
  if(!await worker.ensureAlive())throw new Error('No extension worker');cdps.push(worker.handle.cdp);
  await guardAudio(page.cdp);await guardAudio(worker.handle.cdp,worker.handle.sessionId);
  const id=await worker.evaluate('chrome.runtime.id');evidence.extensionId=id;
  cleanupArmed=true;evidence.installOutput=ps(path.join(packageDir,'Install-Connection.ps1'),['-ExtensionId',id,'-InstallDirectory',installed]);
  const manifest=JSON.parse((await readFile(path.join(installed,'native-host.json'),'utf8')).replace(/^\uFEFF/,''));
  check('real-test-launcher-exact-origin',manifest.name===testHost&&manifest.allowed_origins.length===1&&manifest.allowed_origins[0]===`chrome-extension://${id}/`&&manifest.path===path.join(installed,'native-host.exe'),manifest);
  await worker.evaluate("chrome.storage.local.set({biliscriptJapaneseSettings:{asrModel:'medium',sourceLanguage:'ja',apiKey:''}})");
  await page.cdp.send('Page.navigate',{url:`chrome-extension://${id}/study/options.html`});
  await waitFor('real native manager connected',()=>page.cdp.evaluate("document.getElementById('connectionHelp')?.hidden===true"),{timeoutMs:30000});
  await page.cdp.evaluate("(()=>{const original=chrome.runtime.sendMessage.bind(chrome.runtime);window.__nativeAudit=[];chrome.runtime.sendMessage=(message,...rest)=>{if(message?.type==='study-model-manager')window.__nativeAudit.push(structuredClone(message));return original(message,...rest)}})()");
  const initial=await request('status');evidence.initialStatus=initial;
  check('real-native-protocol3-version120',initial.ok&&initial.data.protocolVersion===3&&initial.data.version==='1.2.0',initial);
  check('small-and-medium-reused-in-place',initial.data.models.filter(model=>model.installed&&!model.owned&&['small','medium'].includes(model.id)).length===2);
  check('saved-medium-not-reset',await page.cdp.evaluate("document.getElementById('asrModel').value==='medium'"));
  await captureLanguage('ja');
  await clickButton('#models [data-model="small"] button');
  await waitFor('Japanese small default saved',()=>page.cdp.evaluate("chrome.storage.local.get('biliscriptJapaneseSettings').then(x=>x.biliscriptJapaneseSettings.asrModel==='small')"));
  const jaDefault=await request('status');check('Japanese-default-written-to-private-home',jaDefault.ok&&jaDefault.data.defaultModel==='small');
  await captureLanguage('en');
  await clickButton('#models [data-model="medium"] button');
  await waitFor('English medium default saved',()=>page.cdp.evaluate("chrome.storage.local.get('biliscriptJapaneseSettings').then(x=>x.biliscriptJapaneseSettings.asrModel==='medium')"));
  const enDefault=await request('status');check('English-default-written-to-private-home',enDefault.ok&&enDefault.data.defaultModel==='medium');
  const state=JSON.parse(await readFile(path.join(installed,'manager-state.json'),'utf8'));
  check('default-state-is-private-and-medium',state.default_model==='medium',state);
  const rejected=await request('setDefault',{model:'small',language:'fr'});
  check('unsupported-language-rejected-without-state-change',rejected.ok===false&&(await request('status')).data.defaultModel==='medium',rejected);
  for(const language of ['ja','en']){
    const now=await sharedSnapshot();
    if(now.available&&sharedBefore.available&&JSON.stringify(now.identity)===JSON.stringify(sharedBefore.identity)){
      const reused=await request('start',{model:'medium',language});
      check(language+'-start-only-reuses-shared-worker',reused.ok&&reused.data.service.worker_pid===sharedBefore.health.worker_pid,reused);
    }else{evidence.startSkipped='Original service unavailable or identity changed; no start request sent';break}
  }
  const requests=await page.cdp.evaluate('window.__nativeAudit');evidence.nativeRequests=requests;
  check('both-UI-default-requests-carry-the-selected-language',['ja','en'].every(language=>requests.some(item=>item.action==='setDefault'&&item.args.language===language)));
  check('only-approved-native-actions-were-sent',requests.every(item=>evidence.allowedNativeActions.includes(item.action)),requests.map(item=>item.action));
  const outsider=await worker.evaluate("chrome.runtime.sendMessage({type:'study-model-manager',action:'status',args:{}}).catch(error=>({ok:false,error:error.message}))");
  check('worker-cannot-impersonate-options-page',outsider.ok===false,outsider);
  await captureLanguage('en');
  check('isolated-browser-attempted-no-audio-requests',blockedAudioRequests.length===0,blockedAudioRequests);
}catch(error){evidence.error=String(error.stack);log(error.message);process.exitCode=1}
finally{
  if(cleanupArmed){
    try{
      const registrations=registrySnapshot(testKeys);
      check('temporary-registrations-point-only-to-private-manifest',registrations.every(item=>!item.existed||item.value===path.join(installed,'native-host.json')),registrations);
      if(registrations.some(item=>item.existed))evidence.uninstallOutput=ps(path.join(installed,'Uninstall-Connection.ps1'));
      check('test-alias-removed',registrySnapshot(testKeys).every(item=>!item.existed));
    }catch(error){evidence.cleanupError=String(error.stack);process.exitCode=1}
  }
  try{await teardown({browser,cdps})}catch(error){evidence.browserCleanupError=String(error);process.exitCode=1}
  try{
    evidence.productionAfter=await productionSnapshot();
    check('production-Edge-and-Chrome-registrations-and-manifests-unchanged',JSON.stringify(evidence.productionAfter)===JSON.stringify(productionBefore));
    evidence.sharedAfter=await sharedSnapshot();
    if(sharedBefore?.available){
      check('original-listener-and-worker-same-start-stamps',evidence.sharedAfter.available&&JSON.stringify(evidence.sharedAfter.identity)===JSON.stringify(sharedBefore.identity),evidence.sharedAfter.identity);
      evidence.sharedJobCounterObservation={before:sharedBefore.health.jobs_started,after:evidence.sharedAfter.health.jobs_started,note:'Global counters can change through independent shared-service consumers; this browser separately blocks and records any audio endpoint request.'};
      check('shared-resident-model-unchanged',evidence.sharedAfter.health.backend?.model===sharedBefore.health.backend?.model);
    }
  }catch(error){evidence.preservationError=String(error.stack);process.exitCode=1}
  evidence.blockedAudioRequests=blockedAudioRequests;evidence.failed=checks.filter(item=>!item.ok);await writeEvidence(out,evidence);
}
