import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {REPO_ROOT,launchBrowser,attachPage,createWorkerSession,screenshot,teardown,waitFor,sleep,writeEvidence,artifactDir} from './harness.mjs';
const distDir=path.resolve(process.argv[2]||'dist-study'),label=process.argv[3]||'candidate',diagnose=process.argv.includes('--diagnose');
const out=artifactDir('study-toolbar-fit-'+label),temp=path.join(REPO_ROOT,'.scratch/browser-temp');await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
const checks=[],evidence={scope:'real public Bilibili page in isolated Edge, explicit CSS viewport 1700 and DPR 1.5 for the 2560px/150% environment; desktop tab zoom via chrome.tabs.setZoom, never pinch scaling; synthetic local subtitle fixture only',checks,states:[]};
const b="document.getElementById('biliscript-study-controls').shadowRoot";
let browser,page,worker;const cdps=[];
function check(name,ok,detail){checks.push({name,ok:!!ok,detail});if(!ok)throw new Error(name+': '+JSON.stringify(detail))}
async function measure(){return page.cdp.evaluate(`(()=>{
 const root=${b},box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},native=Object.fromEntries(Object.entries({player:'#playerWrap',inner:'#bilibili-player',video:'video',controls:'.bpx-player-control-bottom',danmaku:'.bpx-player-sending-area',left:'.left-container',right:'.right-container'}).map(([key,selector])=>{const e=document.querySelector(selector);return [key,{box:box(e),style:e?.getAttribute('style')||''}]}));
 const toolbar=root.querySelector('.toolbar'),buttons=[...toolbar.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({id:e.id,text:e.textContent,box:box(e),font:parseFloat(getComputedStyle(e).fontSize),padding:getComputedStyle(e).padding,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}));
 return {innerWidth,innerHeight,dpr:devicePixelRatio,viewportScale:visualViewport.scale,native,toolbar:box(toolbar),bar:box(root.querySelector('.study-bar')),position:box(root.getElementById('position')),groups:[...toolbar.children].filter(e=>e.getBoundingClientRect().width>0).map(e=>({id:e.id||e.className,box:box(e),gap:getComputedStyle(e).gap})),buttons,scrollWidth:toolbar.scrollWidth,clientWidth:toolbar.clientWidth,fullscreen:!!document.fullscreenElement};})()`)}
async function toggle(){await worker.evaluate("(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.sendMessage(tab.id,{type:'study-toggle'})})()");await sleep(500)}
async function zoom(value){await worker.evaluate(`(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});await chrome.tabs.setZoom(tab.id,${value});return chrome.tabs.getZoom(tab.id)})()`);await sleep(650)}
const same=(a,c,keys=['x','y','width','height'])=>a&&c&&keys.every(key=>Math.abs(a[key]-c[key])<=1);
function fit(name,s){
 const last=s.buttons.find(x=>x.id==='readPanel');
 check(name+'-all-buttons-same-row',!!last&&s.buttons.every(button=>Math.abs(button.box.y-last.box.y)<=1),s);
 check(name+'-no-overflow-or-clipping',s.scrollWidth<=s.clientWidth+1&&s.buttons.every(button=>button.box.x>=s.toolbar.x-1&&button.box.right<=s.toolbar.right+1&&button.scrollWidth<=button.clientWidth+1),s);
 check(name+'-readable-labels-and-height',s.buttons.every(button=>button.font>=13&&button.font<=14&&button.box.height>=36&&button.box.height<=39),s.buttons);
}
try{
 browser=await launchBrowser({distDir,profilePrefix:'study-toolbar-fit-',muted:true,sync:false});page=await attachPage(browser,{viewport:{width:1700,height:950,deviceScaleFactor:1.5,mobile:false}});cdps.push(page.cdp);
 worker=createWorkerSession({pageCdp:page.cdp,browser,distDir});if(!await worker.ensureAlive())throw new Error('No worker');cdps.push(worker.handle.cdp);
 const bv='BV1wYAmeqEuV',cues=Array.from({length:12},(_,i)=>({start:i*2.5,end:(i+1)*2.5,text:'私たちの暮らしに広がる変化です。'}));
 await worker.evaluate(`chrome.storage.local.set(${JSON.stringify({biliscriptJapaneseSettings:{autoStart:false,autoTranslate:false,apiKey:''},['biliscript-study-import:'+bv+':p1']:{identity:bv+':fixture',name:'toolbar-width.srt',cues}})})`);
 await page.cdp.send('Page.navigate',{url:'https://www.bilibili.com/video/'+bv+'/'});await waitFor('native hydrated',()=>page.cdp.evaluate("!!document.querySelector('video')&&!document.querySelector('#app[data-server-rendered]')&&!!document.getElementById('biliscript-japanese-study')"),{timeoutMs:45000});
 await page.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause());document.querySelector('video').currentTime=5.1;scrollTo(0,0)");await zoom(1);
 const before=await measure();await toggle();await page.cdp.evaluate("document.getElementById('biliscript-japanese-study').shadowRoot.getElementById('enable').click()");await waitFor('fixture loaded',()=>page.cdp.evaluate(`${b}.getElementById('position').textContent.includes('/ 12')`));await sleep(400);
 const actual=await measure();evidence.before=before;evidence.actual100=actual;
 check('explicit-100percent-user-environment',actual.innerWidth===1700&&actual.dpr===1.5&&actual.viewportScale===1,actual);
 for(const name of Object.keys(before.native)){const a=before.native[name],c=actual.native[name];check('native-'+name+'-unchanged',same(a.box,c.box,['left','right'].includes(name)?['x','y','width']:undefined)&&a.style===c.style,{before:a,after:c})}
 if(!diagnose)fit('actual-100percent',actual);
 await screenshot(page.cdp,path.join(out,'100percent-1700css-dpr1.5.png'));
 // The user-reported 1270px physical toolbar corresponds to about 846.7 CSS
 // pixels. Constrain only our own bar to test exact 846 and 850px boundaries.
 for(const width of [846,850]){
  await page.cdp.evaluate(`${b}.querySelector('.study-bar').style.width='${width}px'`);await sleep(100);const s=await measure();evidence.states.push({label:'bar-'+width,...s});
  if(!diagnose)fit('bar-'+width,s);
 }
 await page.cdp.evaluate(`${b}.querySelector('.study-bar').style.removeProperty('width')`);
 await zoom(.9);const z=await measure();evidence.actual90=z;
 check('desktop-90percent-zoom-recorded',await worker.evaluate("(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.getZoom(tab.id)})()")===.9&&z.viewportScale===1&&z.innerWidth>actual.innerWidth,z);
 if(!diagnose)fit('actual-90percent',z);await screenshot(page.cdp,path.join(out,'90percent-desktop-zoom.png'));
 await zoom(1);await page.cdp.send('Runtime.evaluate',{expression:"document.querySelector('video').closest('.bpx-player-container').requestFullscreen()",userGesture:true,awaitPromise:true,returnByValue:true});await sleep(500);
 const full=await measure();evidence.fullscreen=full;check('fullscreen-keeps-existing-button-size',full.buttons.every(x=>x.font===13&&Math.abs(x.box.height-36.8)<=.5),full.buttons);
 check('fullscreen-normal-container-query-inactive',await page.cdp.evaluate(`getComputedStyle(${b}.querySelector('#learningControls')).containerType==='normal'`));
 await screenshot(page.cdp,path.join(out,'fullscreen.png'));await page.cdp.evaluate('document.exitFullscreen()');await sleep(400);
 const restored=await measure();check('exit-fullscreen-native-geometry-restored',same(restored.native.player.box,actual.native.player.box)&&same(restored.native.video.box,actual.native.video.box));
}catch(error){evidence.error=String(error.stack);process.exitCode=1;try{await screenshot(page.cdp,path.join(out,'failure.png'))}catch{}}
finally{evidence.failed=checks.filter(x=>!x.ok);await writeEvidence(out,evidence);await teardown({browser,cdps})}
