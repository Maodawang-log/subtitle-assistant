import path from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {REPO_ROOT,launchBrowser,attachPage,createWorkerSession,screenshot,teardown,waitFor,writeEvidence,artifactDir,log} from './harness.mjs';
const out=artifactDir('study-native-manager-2.6.4.0'),distDir=path.join(REPO_ROOT,'dist-study'),packageDir=path.join(REPO_ROOT,'.scratch/model-manager-package'),installed=path.join(out,'temporary-connection'),temp=path.join(REPO_ROOT,'.scratch/browser-temp');
await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
const checks=[],evidence={scope:'real Edge Native Messaging launcher and temporary HKCU connection; existing shared ASR read-only; no model weights downloaded',checks},cdps=[];
let browser,page,worker,registered=false;
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});if(!ok)throw new Error(name+': '+JSON.stringify(detail));log('PASS '+name)};
const ps=(file,args=[])=>execFileSync('powershell.exe',['-NoProfile','-File',file,...args],{encoding:'utf8',windowsHide:true,timeout:30000});
try{
 const before=execFileSync('powershell.exe',['-NoProfile','-Command',"@('HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.biliscript.local_models','HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.biliscript.local_models') | ForEach-Object { Test-Path -LiteralPath $_ }"],{encoding:'utf8',windowsHide:true}).trim();
 check('test-host-registration-was-absent',!before.includes('True'));
 browser=await launchBrowser({distDir,profilePrefix:'study-native-manager-',muted:true,sync:false});page=await attachPage(browser);cdps.push(page.cdp);
 worker=createWorkerSession({pageCdp:page.cdp,browser,distDir});if(!await worker.ensureAlive())throw new Error('No extension worker');cdps.push(worker.handle.cdp);
 const id=await worker.evaluate('chrome.runtime.id');evidence.extensionId=id;
 evidence.installOutput=ps(path.join(packageDir,'Install-Connection.ps1'),['-ExtensionId',id,'-InstallDirectory',installed]);registered=true;
 const manifest=JSON.parse((await readFile(path.join(installed,'native-host.json'),'utf8')).replace(/^\uFEFF/,''));
 check('native-host-exact-isolated-extension-id',manifest.allowed_origins.length===1&&manifest.allowed_origins[0]===`chrome-extension://${id}/`,manifest);
 await worker.evaluate("chrome.storage.local.set({biliscriptJapaneseSettings:{asrModel:'medium',apiKey:''}})");
 await page.cdp.send('Page.navigate',{url:`chrome-extension://${id}/study/options.html`});
 await waitFor('native manager connected',()=>page.cdp.evaluate("document.getElementById('connectionHelp')?.hidden===true"),{timeoutMs:30000});
 const state=await page.cdp.evaluate("chrome.runtime.sendMessage({type:'study-model-manager',action:'status',args:{}})");
 check('real-native-roundtrip-status',state.ok===true&&state.data.models.length===3,state);
 check('reuse-existing-small-and-medium',state.data.models.filter(x=>x.installed&&!x.owned).map(x=>x.id).join(',')==='small,medium');
 check('medium-setting-not-reset',await page.cdp.evaluate("document.getElementById('asrModel').value==='medium'"));
 if(state.data.service&&!state.data.managedService){
  const reused=await page.cdp.evaluate("chrome.runtime.sendMessage({type:'study-model-manager',action:'start',args:{model:'medium'}})");
  check('native-start-reuses-existing-service',reused.ok&&reused.data.service.worker_pid===state.data.service.worker_pid);
  const refused=await page.cdp.evaluate("chrome.runtime.sendMessage({type:'study-model-manager',action:'stop',args:{}})");
  check('native-stop-protects-unmanaged-shared-service',refused.ok===false,refused);
 }
 const originalHealth=await worker.evaluate("fetch('http://127.0.0.1:18766/health',{headers:{'X-BiliScript-Consumer':'study-extension'}}).then(r=>({status:r.status,ok:r.ok}))");
 check('legacy-service-accepts-real-extension-fetch-with-consumer-header',originalHealth.ok,originalHealth);
 const bad=await page.cdp.evaluate("chrome.runtime.sendMessage({type:'study-model-manager',action:'download',args:{model:'large-v3-turbo',url:'https://example.com/weights'}})");
 check('native-rejects-arbitrary-download-url',bad.ok===false,bad);
 const notSettings=await worker.evaluate("chrome.runtime.sendMessage({type:'study-model-manager',action:'status',args:{}}).catch(e=>({ok:false,error:e.message}))");
 check('worker-cannot-impersonate-settings-page',notSettings.ok===false,notSettings);
 await page.cdp.evaluate("document.getElementById('modelService').closest('section').scrollIntoView({block:'start',behavior:'instant'})");
 await screenshot(page.cdp,path.join(out,'settings-bridge-connected.png'));
 await page.cdp.send('Page.navigate',{url:'https://www.bilibili.com/zh-Hans/video/BV1wYAmeqEuV/'});
 await waitFor('Bilibili test document',()=>page.cdp.evaluate("location.href.includes('/video/')&&document.readyState==='complete'"),{timeoutMs:30000});
 const rejected=await worker.evaluate("(async()=>{const tab=(await chrome.tabs.query({url:'https://www.bilibili.com/*'}))[0];const r=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async()=>await chrome.runtime.sendMessage({type:'study-model-manager',action:'status',args:{}})});return r[0].result})()");
 check('real-content-script-cannot-manage-models',rejected?.ok===false,rejected);
}catch(error){evidence.error=String(error.stack);log(error.message);process.exitCode=1}
finally{
 if(registered){try{evidence.uninstallOutput=ps(path.join(installed,'Uninstall-Connection.ps1'));const remaining=execFileSync('powershell.exe',['-NoProfile','-Command',"@('HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.biliscript.local_models','HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.biliscript.local_models') | ForEach-Object { Test-Path -LiteralPath $_ }"],{encoding:'utf8',windowsHide:true}).trim();check('temporary-registration-restored',!remaining.includes('True'));}catch(e){evidence.restoreError=String(e);process.exitCode=1}}
 await teardown({browser,cdps});evidence.failed=checks.filter(x=>!x.ok);await writeEvidence(out,evidence);
}
