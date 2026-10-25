// Real complete resources and a private, same-path unpacked-extension upgrade.
import path from "node:path";
import {cp,mkdir,readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {REPO_ROOT,launchBrowser,attachPage,createWorkerSession,screenshot,teardown,waitFor,sleep,writeEvidence,artifactDir,log} from "./harness.mjs";
const out=artifactDir("study-multidictionary-2.6.3.4"),distDir=path.join(out,"private-upgrade-dist"),candidate=path.join(REPO_ROOT,"dist-study");
const temp=path.join(REPO_ROOT,".scratch","browser-temp");await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
await cp(path.resolve(REPO_ROOT,"../../outputs/biliscript-japanese-study-2.6.3.3"),distDir,{recursive:true,force:true});
const checks=[],evidence={version:"2.6.3.4",scope:"isolated Edge; same-path upgrade of private copy; real complete dictionaries; no user secrets or paid API",checks};
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});log((ok?"PASS ":"FAIL ")+name);if(!ok)throw new Error(name+": "+JSON.stringify(detail))};
let browser,page,worker;const cdps=[];
const text=id=>page.cdp.evaluate(`document.getElementById(${JSON.stringify(id)})?.textContent||''`);
async function click(selector){
 const point=await page.cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,w:r.width,h:r.height,hit:document.elementFromPoint(x,y)===e}})()`);
 if(!point?.hit||point.w<1||point.h<1)throw new Error("Not clickable "+selector);
 for(const type of ["mousePressed","mouseReleased"])await page.cdp.send("Input.dispatchMouseEvent",{type,x:point.x,y:point.y,button:"left",clickCount:1});
}
const choose=async(id,value)=>{await page.cdp.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(180)};
const database=()=>page.cdp.evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('biliscript-study-dictionaries');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('meta').objectStore('meta').getAll();q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)}})`);
const snap=name=>screenshot(page.cdp,path.join(out,name+".png"));
async function install(rows){
 await click("#dictInstall");
 await waitFor("complete dictionary "+rows,async()=>{const state=await text("dictState"),error=await page.cdp.evaluate("document.getElementById('dictStatus').classList.contains('error')");if(error)throw new Error(await text("dictStatus"));return state.includes(rows.toLocaleString('en-US'))},{timeoutMs:300000,intervalMs:1200});
 check("installed-"+rows,true,await text("dictState"));
}
async function query(term,contains,source){
 await page.cdp.evaluate(`document.getElementById('lookupText').value=${JSON.stringify(term)};document.getElementById('lookupResult').replaceChildren()`);await click("#lookup");
 await waitFor("offline query "+term,async()=>!!await text("lookupResult"));const value=await text("lookupResult");
 check("query-"+term+"-"+source,value.toLowerCase().includes(contains.toLowerCase())&&value.includes(source),value.slice(0,600));return value;
}
try{
 browser=await launchBrowser({distDir,profilePrefix:"study-multidict-",muted:true,sync:false});page=await attachPage(browser);cdps.push(page.cdp);
 worker=createWorkerSession({pageCdp:page.cdp,browser,distDir});if(!await worker.ensureAlive())throw new Error("No initial worker");cdps.push(worker.handle.cdp);
 const before=await worker.evaluate("({id:chrome.runtime.id,version:chrome.runtime.getManifest().version,name:chrome.runtime.getManifest().name})");check("initial-private-copy-is-2.6.3.3",before.version==="2.6.3.3",before);
 await worker.evaluate("chrome.storage.local.set({biliscriptJapaneseSettings:{autoStart:false,autoTranslate:false,apiKey:'synthetic-upgrade-fixture-only',baseUrl:'https://compatible.example/v1',model:'fixture-model'}})");
 await page.cdp.send("Page.navigate",{url:"chrome-extension://"+before.id+"/study/options.html"});
 await waitFor("old settings ready",()=>page.cdp.evaluate("!!document.getElementById('dictInstall')&&!document.getElementById('dictInstall').disabled"));
 await install(435448);const oldMeta=(await database()).find(x=>x.id==="jitendex-zh");
 await cp(candidate,distDir,{recursive:true,force:true});
 evidence.candidateBackgroundSha256=createHash('sha256').update(await readFile(path.join(distDir,'entry/study-background.js'))).digest('hex');
 await worker.evaluate("setTimeout(()=>chrome.runtime.reload(),100)");await sleep(1000);
 worker=createWorkerSession({pageCdp:page.cdp,browser,distDir});if(!await worker.ensureAlive())throw new Error("No updated worker");cdps.push(worker.handle.cdp);
 const after=await worker.evaluate("chrome.storage.local.get('biliscriptJapaneseSettings').then(x=>({id:chrome.runtime.id,version:chrome.runtime.getManifest().version,name:chrome.runtime.getManifest().name,keyPreserved:x.biliscriptJapaneseSettings.apiKey==='synthetic-upgrade-fixture-only',modelPreserved:x.biliscriptJapaneseSettings.model==='fixture-model'}))");
 check("rename-keeps-extension-id-and-synthetic-settings",after.id===before.id&&after.version==="2.6.3.4"&&after.name==="语言学习助手"&&after.keyPreserved&&after.modelPreserved,after);
 await page.cdp.send("Page.navigate",{url:"chrome-extension://"+after.id+"/study/options.html"});
 await waitFor("new settings ready",()=>page.cdp.evaluate("document.querySelectorAll('#dictionaryList button').length===2&&!document.getElementById('dictLanguage').disabled"));
 const retained=(await database()).find(x=>x.id==="jitendex-zh");check("old-full-japanese-dictionary-kept-without-reimport",retained?.generation===oldMeta.generation&&retained.rows===435448);
 await click('[data-dictionary-id="jitendex-en"]');await install(436555);
 check("adding-japanese-english-preserves-old-japanese-default",await page.cdp.evaluate("document.getElementById('dictDefault').value==='jitendex-zh'"));
 await choose('dictLanguage','en');await install(770611);
 const all=await database();evidence.installed=all.filter(x=>!x.id.startsWith('pending:')&&!x.id.startsWith('default:'));
 check("three-complete-dictionaries-coexist",evidence.installed.length===3&&evidence.installed.reduce((n,x)=>n+x.rows,0)===1642614,evidence.installed.map(x=>({id:x.id,rows:x.rows,sourceLanguage:x.sourceLanguage||'legacy-ja'})));
 await page.cdp.send("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await query('language','语言','ECDICT');await query('HELLO','喂','ECDICT');await snap('01-english-offline-all-installed');
 await choose('dictLanguage','ja');await query('食べる','吃','社区日中');
 await choose('dictDefault','jitendex-en');await query('食べる','eat','官方日英');await snap('02-japanese-default-switched');
 await choose('dictLanguage','en');check('english-default-unaffected',await page.cdp.evaluate("document.getElementById('dictDefault').value==='ecdict-en-zh'"));
 await page.cdp.evaluate("document.getElementById('lookupText').value='食べる'");await click('#lookup');await sleep(300);check('english-query-does-not-use-japanese-index',(await text('lookupResult')).includes('未命中'));
 await choose('dictLanguage','ko');check('korean-is-explicitly-unavailable',await page.cdp.evaluate("!document.getElementById('unsupportedLanguage').hidden&&document.getElementById('dictionaryCard').hidden&&document.getElementById('lookup').disabled&&document.querySelectorAll('#dictionaryList button').length===0"));await snap('03-korean-unavailable');
 await page.cdp.send("Network.emulateNetworkConditions",{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await choose('dictLanguage','ja');await click('[data-dictionary-id="jitendex-en"]');await click('#dictUpdate');await waitFor('update check',()=>page.cdp.evaluate("!document.getElementById('dictUpdate').disabled"));check('verified-japanese-update-check',(await text('dictStatus')).includes('已是最新版本'),await text('dictStatus'));
 const release={id:'jitendex-en',version:'fixture-update',url:'https://github.com/stephenmk/stephenmk.github.io/releases/download/2026.10.03.0/jitendex-yomitan.zip',sha256:'e914c76596220dffc6ee0c069cd05992f03adb2988c12c3cebe817a3ac271356',bytes:38831822,expectedRows:436555};
 for(const mode of ['hash-failure','cancel','terminate']){
  const job={...release,...(mode==='hash-failure'?{sha256:'0'.repeat(64)}:{})};
  await page.cdp.evaluate(`(()=>{window.__dictAudit={stage:'start'};const w=new Worker(chrome.runtime.getURL('study/dictionary-worker.js'));window.__dictAuditWorker=w;w.onmessage=({data})=>{window.__dictAudit=data;if(data.stage==='import'&&data.done===1){if(${JSON.stringify(mode)}==='cancel')w.postMessage({action:'cancel'});if(${JSON.stringify(mode)}==='terminate'){w.terminate();window.__dictAudit={stage:'terminated'}}}};w.postMessage({action:'install',release:${JSON.stringify(job)}})})()`);
  await waitFor('fault '+mode,()=>page.cdp.evaluate("['error','canceled','terminated'].includes(window.__dictAudit.stage)"),{timeoutMs:90000});
  if(mode==='terminate'){await page.cdp.send('Page.reload');await waitFor('recovery',()=>page.cdp.evaluate("document.querySelectorAll('#dictionaryList button').length===2&&!document.getElementById('dictLanguage').disabled"))}
  else await page.cdp.evaluate('window.__dictAuditWorker.terminate()');
  const next=await database();check('all-dictionaries-preserved-after-'+mode,evidence.installed.every(a=>next.some(b=>b.id===a.id&&b.generation===a.generation))&&!next.some(x=>x.id.startsWith('pending:')));
 }
 await choose('dictLanguage','ja');await click('[data-dictionary-id="jitendex-en"]');await click('#dictDelete');await waitFor('selected dictionary removed',async()=>!(await database()).some(x=>x.id==='jitendex-en')&&await page.cdp.evaluate("!document.getElementById('dictLanguage').disabled"),{timeoutMs:180000,intervalMs:1200});
 const remaining=await database();check('delete-only-selected-dictionary',remaining.some(x=>x.id==='jitendex-zh'&&x.generation===oldMeta.generation)&&remaining.some(x=>x.id==='ecdict-en-zh')&&!remaining.some(x=>x.id==='jitendex-en'));
 check('deleted-default-falls-back-within-japanese',await page.cdp.evaluate("document.getElementById('dictDefault').value==='jitendex-zh'"));
 await page.cdp.send("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await query('食べる','吃','社区日中');await choose('dictLanguage','en');await query('earthquake','地震','ECDICT');await snap('04-after-selective-deletion');
}catch(error){evidence.error=String(error.stack);console.error(error.message);try{await snap('failure')}catch{}process.exitCode=1}
finally{evidence.failed=checks.filter(x=>!x.ok);await writeEvidence(out,evidence);await teardown({browser,cdps})}
