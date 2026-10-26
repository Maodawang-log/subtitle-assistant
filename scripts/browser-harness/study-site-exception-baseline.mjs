import path from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {REPO_ROOT,launchBrowser,attachPage,teardown,waitFor,sleep,writeEvidence,artifactDir} from './harness.mjs';
const out=artifactDir('study-site-exception-baseline-2.6.5.0'),temp=path.join(REPO_ROOT,'.scratch/browser-temp');
await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
const final=JSON.parse(await readFile(path.join(REPO_ROOT,'.scratch/browser-harness/site-lifecycle-2.6.5.0-final/evidence.json'),'utf8'));
const evidence={scope:'same public Bilibili pages in isolated Edge with all extensions disabled; capture full native page errors',phase:'setup',checks:[],exceptions:[],earlierObservation:{capture:'console output from earlier lifecycle run before detailed stack capture was added',count:22,text:'Uncaught (in promise)',source:'unknown; original generic text is insufficient for attribution',uiChecksPassed:24,finalInstrumentedLifecycleExceptions:final.exceptions.length}};
let browser,page;const cdps=[];
const check=(name,ok)=>{evidence.checks.push({name,ok:!!ok});if(!ok)throw new Error(name)};
try{
 browser=await launchBrowser({loadExtension:false,profilePrefix:'study-site-baseline-',muted:true,sync:false});page=await attachPage(browser);cdps.push(page.cdp);
 page.cdp.on('Runtime.exceptionThrown',e=>{const d=e.exceptionDetails;evidence.exceptions.push({phase:evidence.phase,text:d.text,url:d.url,description:d.exception?.description,value:d.exception?.value,stack:d.stackTrace})});
 for(const [phase,url]of [['cold','https://www.bilibili.com/video/BV1wYAmeqEuV/'],['refresh',null],['next',final.nextVideo]]){
  evidence.phase=phase;if(url)await page.cdp.send('Page.navigate',{url});else await page.cdp.send('Page.reload');
  await waitFor('native page hydrated',()=>page.cdp.evaluate("!!document.querySelector('video')&&!document.querySelector('#app[data-server-rendered]')"),{timeoutMs:30000});
  await page.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause());scrollTo(0,1400)");await sleep(2500);
  check(phase+'-without-study-host',await page.cdp.evaluate("!document.getElementById('biliscript-japanese-study')"));
 }
 evidence.result=evidence.exceptions.length?'Detailed baseline errors retained for comparison; no automatic classification of earlier generic errors.':'No exceptions reproduced in no-extension baseline or final instrumented lifecycle; earlier generic errors remain unattributed.';
}catch(error){evidence.error=String(error.stack);process.exitCode=1}
finally{await writeEvidence(out,evidence);await teardown({browser,cdps})}
