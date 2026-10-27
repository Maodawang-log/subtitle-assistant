import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {REPO_ROOT,launchBrowser,attachPage,createWorkerSession,waitFor,screenshot,writeEvidence,teardown,artifactDir} from './harness.mjs';

const out=artifactDir('study-settings-redesign');
const distDir=path.join(REPO_ROOT,'dist-study');
const fixture=JSON.parse(await readFile(path.join(REPO_ROOT,'tests/fixtures/study-settings-redesign.json'),'utf8'));
const evidence={fixture:true,scope:'Actual built options page in isolated Edge; synthetic native statuses and provider credentials. No production registration or service operations.',checks:[],screenshots:[],pageErrors:[]};
let browser,cdp,worker;
const cdps=[];
function check(name,ok,detail){evidence.checks.push({name,ok:!!ok,...(detail===undefined?{}:{detail})});if(!ok)throw Error(name+' failed: '+JSON.stringify(detail));}
async function click(selector){
 const hit=await cdp.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),disabled:!!el.disabled}})()`);
 check('clickable '+selector,hit?.hit&&hit.width>0&&hit.height>0&&!hit.disabled,hit);
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:hit.x,y:hit.y,button:'left',clickCount:1});
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:hit.x,y:hit.y,button:'left',clickCount:1});
}
async function page(id){await click(`[data-settings-page="${id}"]`);await waitFor(id+' page',()=>cdp.evaluate(`document.getElementById(${JSON.stringify(id)}).hidden===false`));}
async function shot(name){const file=path.join(out,name+'.png');await cdp.evaluate('window.scrollTo(0,0)');await screenshot(cdp,file);evidence.screenshots.push(file);}
async function select(id,value){await cdp.evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`);}
async function geometry(name){
 const result=await cdp.evaluate(`(()=>{const active=document.querySelector('.settings-page:not([hidden])');const visible=el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().height;const cards=[...document.querySelectorAll('#models>.model-card')].filter(visible).map(el=>{const r=el.getBoundingClientRect();return {w:r.width,h:r.height,x:r.x,y:r.y,overflow:el.scrollWidth>el.clientWidth}});return {width:innerWidth,page:active.id,overflow:document.documentElement.scrollWidth>innerWidth,cards,duplicateIds:[...document.querySelectorAll('[id]')].map(el=>el.id).filter((id,i,all)=>all.indexOf(id)!==i),badControls:[...active.querySelectorAll('button,input,select')].filter(visible).filter(el=>el.getBoundingClientRect().right>innerWidth+1||el.getBoundingClientRect().left<0).map(el=>el.id)}})()`);
 check(name+' no horizontal overflow',!result.overflow&&!result.badControls.length,result);
 check(name+' unique IDs',!result.duplicateIds.length);
 if(result.cards.length){check(name+' equal model widths',result.cards.every(c=>Math.abs(c.w-result.cards[0].w)<1));check(name+' equal model heights',result.cards.every(c=>Math.abs(c.h-result.cards[0].h)<1));check(name+' no card overflow',result.cards.every(c=>!c.overflow));}
}
try{
 await mkdir(out,{recursive:true});const temp=path.join(out,'profiles');await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
 const viewport={width:1500,height:1100,deviceScaleFactor:1,mobile:false};
 browser=await launchBrowser({distDir,viewport,profilePrefix:'settings-redesign-',muted:true});
 check('private profile contained in evidence directory',path.resolve(browser.profileDir).startsWith(path.resolve(temp)+path.sep));
 ({cdp}=await attachPage(browser,{viewport}));cdps.push(cdp);
 worker=createWorkerSession({pageCdp:cdp,browser,distDir});if(!await worker.ensureAlive())throw Error('Extension worker unavailable');cdps.push(worker.handle.cdp);
 const id=await worker.evaluate('chrome.runtime.id');evidence.extensionId=id;
 await worker.evaluate(`chrome.storage.local.set({biliscriptJapaneseSettings:${JSON.stringify(fixture.settings)}})`);
 await cdp.send('Network.setBlockedURLs',{urls:['https://*','http://*']});
 cdp.on('Runtime.exceptionThrown',event=>evidence.pageErrors.push(event.exceptionDetails?.text));
 await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
 window.__nativeState=${JSON.stringify(fixture.status)};window.__nativeCalls=[];window.__disconnected=false;window.__permissionCalls=[];window.__confirmCalls=[];window.__confirmResult=false;
 window.confirm=text=>{window.__confirmCalls.push(text);return window.__confirmResult};
 chrome.permissions.request=async args=>{window.__permissionCalls.push(args);return true};
 chrome.runtime.sendMessage=async message=>{window.__nativeCalls.push(message);if(message.type!=='study-model-manager')throw Error('Unexpected runtime request');if(window.__disconnected)return {ok:false,error:'Synthetic connection loss'};
 if(message.action==='setDefault')window.__nativeState.defaultModel=message.args.model;
 else if(message.action!=='status')throw Error('Forbidden service/download operation in page audit: '+message.action);
 return {ok:true,data:structuredClone(window.__nativeState)}};
 `});
 await cdp.send('Page.navigate',{url:`chrome-extension://${id}/study/options.html`});
 await waitFor('settings initialized',()=>cdp.evaluate("document.getElementById('providerState')?.textContent==='已配置'&&document.getElementById('dictName')?.textContent.length>0"));
 await cdp.evaluate(`new Promise((resolve,reject)=>{const req=indexedDB.open('biliscript-study-dictionaries',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['meta','terms'],'readwrite');tx.objectStore('meta').put({id:'jitendex-zh',generation:'settings-fixture-ja',version:'v2026.08.11-zh.4',name:'Jitendex 社区日中词典',rows:1,bytes:120,at:1,attribution:'Synthetic test entry; not downloaded dictionary contents.',source:'fixture',sha256:'fixture'});tx.objectStore('meta').put({id:'default:ja',dictionaryId:'jitendex-zh'});tx.objectStore('terms').put({generation:'settings-fixture-ja',row:0,term:'食べる',reading:'たべる',meaning:'吃（隔离测试词条）',sequence:0});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)};req.onerror=()=>reject(req.error)})`);
 await cdp.send('Page.reload');
 await waitFor('local dictionary recovered',()=>cdp.evaluate("document.getElementById('dictState')?.textContent.includes('已安装')&&document.getElementById('providerState')?.textContent==='已配置'"));
 check('opening subtitles does not connect or write settings',await cdp.evaluate("window.__nativeCalls.length===0&&document.getElementById('apiKey').value===''"));
 await geometry('desktop subtitles');await shot('01-subtitles-desktop');
 await page('recognition');await waitFor('synthetic manager connected',()=>cdp.evaluate("document.getElementById('managerConnection').textContent==='已连接'"));
 check('connection and service independently labeled',await cdp.evaluate("document.getElementById('modelService').textContent==='已就绪'&&document.getElementById('managerHandover').hidden===false&&document.getElementById('managerStop').hidden===true"));
 await geometry('desktop recognition');await shot('02-recognition-desktop');
 await select('asrModel','small');
 await waitFor('model stored independently',()=>cdp.evaluate("chrome.storage.local.get('biliscriptJapaneseSettings').then(x=>x.biliscriptJapaneseSettings.asrModel==='small')"));
 check('single model selector preserves provider',await cdp.evaluate(`chrome.storage.local.get('biliscriptJapaneseSettings').then(x=>x.biliscriptJapaneseSettings.apiKey===${JSON.stringify(fixture.settings.apiKey)}&&x.biliscriptJapaneseSettings.retainedPreference&&!document.getElementById('models').textContent.includes('设为默认'))`));
 await select('modelFilter','all');await geometry('desktop all models');await shot('03-model-library-desktop');
 await page('translation');await geometry('desktop translation');await shot('04-translation-desktop');
 await cdp.evaluate("document.getElementById('model').value='saved-fixture-model';document.getElementById('model').dispatchEvent(new Event('input',{bubbles:true}))");
 await click('#save');await waitFor('provider saved',()=>cdp.evaluate("document.getElementById('status').textContent.includes('接口已保存')"));
 check('provider save preserves independent model and blank saved key',await cdp.evaluate(`chrome.storage.local.get('biliscriptJapaneseSettings').then(x=>x.biliscriptJapaneseSettings.asrModel==='small'&&x.biliscriptJapaneseSettings.apiKey===${JSON.stringify(fixture.settings.apiKey)}&&x.biliscriptJapaneseSettings.model==='saved-fixture-model'&&x.biliscriptJapaneseSettings.autoStart===false&&x.biliscriptJapaneseSettings.autoTranslate===false)`));
 await click('#showApiKey');check('show does not expose stored key',await cdp.evaluate("document.getElementById('apiKey').value===''"));
 await page('dictionaries');await geometry('desktop dictionaries');await shot('05-dictionaries-desktop');
 await cdp.evaluate("document.getElementById('lookupText').value='食べる';document.getElementById('lookupText').focus()");
 await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await waitFor('keyboard dictionary lookup',()=>cdp.evaluate("document.getElementById('lookupResult').textContent.includes('隔离测试词条')"));check('real keyboard submits local lookup',true);
 await click('#dictDelete');check('cancelling dictionary deletion preserves selected dictionary',await cdp.evaluate("window.__confirmCalls.at(-1).includes('删除')&&document.getElementById('dictState').textContent.includes('已安装')"));
 await page('subtitles');await select('subtitleSizeMode','manual');await cdp.evaluate("document.getElementById('subtitleSizeNumber').value='40';document.getElementById('subtitleSizeNumber').dispatchEvent(new Event('input',{bubbles:true}))");
 await waitFor('manual appearance saved',()=>cdp.evaluate("chrome.storage.local.get('biliscriptStudyAppearance').then(x=>x.biliscriptStudyAppearance?.size===40)"));
 check('manual controls visible and live preview',await cdp.evaluate("!document.getElementById('manualSizeControls').hidden&&document.getElementById('appearancePreview').style.fontSize==='40px'"));
 await select('subtitleSizeMode','auto');
 check('automatic mode hides manual controls and retains manual size',await cdp.evaluate("document.getElementById('manualSizeControls').hidden&&document.getElementById('subtitleSizeNumber').value==='40'"));
 await select('defaultSourceLanguage','en');await waitFor('language stored',()=>cdp.evaluate("chrome.storage.local.get('biliscriptJapaneseSettings').then(x=>x.biliscriptJapaneseSettings.sourceLanguage==='en')"));
 check('English setting updates sample without ruby',await cdp.evaluate("document.getElementById('appearancePreview').textContent.includes('listen')&&!document.getElementById('appearancePreview').querySelector('ruby')"));
 await cdp.evaluate("document.querySelector('[data-settings-page=translation]').focus()");await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 check('keyboard navigation selects the intended category',await cdp.evaluate("!document.getElementById('translation').hidden"));
 await page('recognition');check('English-only model selectable in English',await cdp.evaluate("[...document.getElementById('asrModel').options].some(x=>x.value==='base.en')"));
 await cdp.evaluate("window.__nativeState.managedService=true;window.__nativeState.canStop=false;window.__nativeState.service.active=true");await click('#managerRefresh');
 check('busy prevents stop/restart',await cdp.evaluate("document.getElementById('modelService').textContent==='正在识别'&&document.getElementById('managerStop').disabled&&document.getElementById('managerRestart').disabled"));await shot('06-service-busy');
 await cdp.evaluate('window.__disconnected=true');await click('#managerRefresh');await waitFor('disconnected',()=>cdp.evaluate("document.getElementById('managerConnection').textContent==='连接不可用'"));
 check('disconnection does not claim stopped service',await cdp.evaluate("document.getElementById('modelService').textContent==='状态未知'&&document.getElementById('managerStart').disabled"));await shot('07-disconnected-desktop');
 const calls=await cdp.evaluate('window.__nativeCalls.length');await new Promise(resolve=>setTimeout(resolve,3200));check('no automatic reconnect after failure',(await cdp.evaluate('window.__nativeCalls.length'))===calls);
 await cdp.evaluate('window.__disconnected=false;window.__nativeState.service.active=false;window.__nativeState.canStop=true');await click('#managerRefresh');
 check('explicit reconnect restores status',await cdp.evaluate("document.getElementById('managerConnection').textContent==='已连接'"));
 for(const width of [1000,760,540,375]){
  await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
  for(const id of ['subtitles','recognition','translation','dictionaries']){await page(id);await geometry(width+' '+id);if(width===375)await shot('mobile-'+id);}
 }
 check('no unintended native actions',await cdp.evaluate("window.__nativeCalls.every(m=>['status','setDefault'].includes(m.action))"));
 check('no uncaught page errors',!evidence.pageErrors.length,evidence.pageErrors);
 evidence.buildHashes={};for(const name of ['manifest.json','study/options.html','study/options.css','study/options.js'])evidence.buildHashes[name]=createHash('sha256').update(await readFile(path.join(distDir,name))).digest('hex');
 evidence.success=true;
}catch(error){evidence.error=error.stack;process.exitCode=1;}
finally{await writeEvidence(out,evidence);await teardown({browser,cdps});}
console.log(JSON.stringify({success:evidence.success,checks:evidence.checks.length,out,error:evidence.error}));
