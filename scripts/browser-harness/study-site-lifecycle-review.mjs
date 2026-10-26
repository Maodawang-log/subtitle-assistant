import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {REPO_ROOT,launchBrowser,attachPage,createWorkerSession,screenshot,teardown,waitFor,sleep,writeEvidence,artifactDir,log} from './harness.mjs';
const out=artifactDir('site-lifecycle-'+(process.argv[2]||'2.6.5.0-final')),distDir=path.join(REPO_ROOT,'dist-study'),temp=path.join(REPO_ROOT,'.scratch/browser-temp');
await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
const checks=[],evidence={scope:'isolated Edge; live native site components; local subtitle fixture only when learning enabled; no ASR/paid API',checks,states:[],exceptions:[],phase:'setup'};
let browser,page,worker;const cdps=[];
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});if(!ok)throw new Error(name+': '+JSON.stringify(detail));log('PASS '+name)};
const button=id=>`(document.getElementById('biliscript-japanese-study').shadowRoot.getElementById(${JSON.stringify(id)})||document.getElementById('biliscript-study-controls').shadowRoot.getElementById(${JSON.stringify(id)})||document.getElementById('biliscript-study-entry').shadowRoot.getElementById(${JSON.stringify(id)}))`;
async function click(id){await page.cdp.evaluate('window.scrollTo(0,0)');await sleep(300);if(id==='show'){await page.cdp.evaluate('window.scrollTo(0,0)');const v=await page.cdp.evaluate(`(()=>{const r=document.querySelector('video').getBoundingClientRect();return {x:r.x+r.width/2,y:r.bottom-25}})()`);await page.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...v});await sleep(200)}await page.cdp.evaluate(`(${button(id)}).scrollIntoView({block:'center',behavior:'instant'})`);await sleep(250);const p=await page.cdp.evaluate(`(()=>{const e=${button(id)},r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mousePressed','mouseReleased'])await page.cdp.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1})}
async function siteState(){return page.cdp.evaluate(`(()=>{
 const deep=(r,s)=>{let out=[...r.querySelectorAll(s)];for(const e of r.querySelectorAll('*'))if(e.shadowRoot)out.push(...deep(e.shadowRoot,s));return out};
 const images=[...document.querySelectorAll('.right-container img')],comments=deep(document,'bili-comment-renderer'),controls=document.getElementById('biliscript-study-controls');
 return {url:location.href,header:document.querySelector('.bili-header')?.textContent,hydrating:!!document.querySelector('#app[data-server-rendered]'),commentDefined:!!customElements.get('bili-comments'),commentRows:comments.length,commentShadowRows:comments.filter(x=>x.shadowRoot?.childElementCount).length,images:images.length,imagesLoaded:images.filter(i=>i.complete&&i.naturalWidth>0).length,visibleImages:images.filter(i=>i.getBoundingClientRect().width>0).length,enabled:controls?.hasAttribute('data-enabled'),entryBound:!!document.querySelector('.bpx-player-control-bottom-right #biliscript-study-entry:not([hidden])'),slotCount:document.querySelectorAll('#biliscript-study-slot').length};
})()`)}
async function assertSite(label,enabled=false){
 evidence.phase=label;
 await waitFor('native site ready '+label,async()=>{const s=await siteState();return s.header&&['消息','动态','收藏','历史'].every(x=>s.header.includes(x))&&!s.hydrating},{timeoutMs:30000});
 await page.cdp.evaluate("window.scrollTo({top:1400,behavior:'instant'})");
 await waitFor('comment rows '+label,async()=>{const s=await siteState();return s.commentDefined&&s.commentShadowRows>0},{timeoutMs:20000});
 const s=await siteState();evidence.states.push({label,...s});
 check(label+'-navigation-and-comment-feed',['消息','动态','收藏','历史'].every(x=>s.header.includes(x))&&s.commentShadowRows>0,s);
 check(label+'-learning-state',s.enabled===enabled&&s.slotCount===1);
 if(!enabled){check(label+'-recommendations-restored',s.imagesLoaded>=3&&s.visibleImages>=3);check(label+'-entry-mounted-in-native-controls',s.entryBound)}
 check(label+'-no-hydration-error',!evidence.exceptions.some(x=>JSON.stringify(x).includes('HierarchyRequestError')));
 await screenshot(page.cdp,path.join(out,label+'.png'));
}
try{
 browser=await launchBrowser({distDir,profilePrefix:'study-site-life-',muted:true,sync:false});page=await attachPage(browser);cdps.push(page.cdp);
 page.cdp.on('Runtime.exceptionThrown',e=>evidence.exceptions.push({phase:evidence.phase,text:e.exceptionDetails.text,value:e.exceptionDetails.exception?.value,url:e.exceptionDetails.url,description:e.exceptionDetails.exception?.description,stack:e.exceptionDetails.stackTrace}));
 worker=createWorkerSession({pageCdp:page.cdp,browser,distDir});if(!await worker.ensureAlive())throw new Error('No extension worker');cdps.push(worker.handle.cdp);
 await worker.evaluate("chrome.storage.local.set({biliscriptJapaneseSettings:{autoStart:false,autoTranslate:false,apiKey:''}})");
 await page.cdp.send('Page.navigate',{url:'https://www.bilibili.com/video/BV1wYAmeqEuV/'});await assertSite('01-cold-closed');
 const route=await page.cdp.evaluate("location.href.match(/BV[0-9A-Za-z]{10}/)[0]+':p'+(new URL(location.href).searchParams.get('p')||'1')");
 await worker.evaluate(`chrome.storage.local.set(${JSON.stringify({['biliscript-study-import:'+route]:{identity:route,name:'兼容性回归字幕.srt',offset:0,cues:[{start:0,end:120,text:'この文を読んでみましょう。'}]}})})`);
 const next=await page.cdp.evaluate("[...document.querySelectorAll('.right-container a[href*=\"/video/BV\"]')].map(a=>a.href).find(x=>!x.includes('BV1wYAmeqEuV'))");evidence.nextVideo=next;
 await click('show');await waitFor('learning enabled',()=>page.cdp.evaluate("document.getElementById('biliscript-study-controls').hasAttribute('data-enabled')"));await assertSite('02-enabled',true);
 await click('enable');await waitFor('caption close applied',()=>page.cdp.evaluate("!document.getElementById('biliscript-study-controls').hasAttribute('data-enabled')"));await assertSite('03-closed-again');
 await page.cdp.send('Page.reload');await sleep(1000);await assertSite('04-refreshed');
 check('next-video-url-present',!!next);await page.cdp.send('Page.navigate',{url:next});await sleep(1000);await assertSite('05-next-video');
 check('no-site-exceptions',evidence.exceptions.length===0,evidence.exceptions);
}catch(error){evidence.error=String(error.stack);log(error.message);process.exitCode=1}
finally{evidence.failed=checks.filter(x=>!x.ok);await writeEvidence(out,evidence);try{await page?.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause())")}catch{}await teardown({browser,cdps})}
