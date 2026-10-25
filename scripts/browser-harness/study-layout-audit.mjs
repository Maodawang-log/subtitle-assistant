// Real public Bilibili DOM, isolated browser, locally supplied subtitle fixture.
import path from "node:path";
import {mkdir} from "node:fs/promises";
import {REPO_ROOT,launchBrowser,attachPage,createWorkerSession,screenshot,teardown,waitFor,sleep,writeEvidence,artifactDir} from "./harness.mjs";
const distDir=path.resolve(process.argv[2]||"dist-study"),label=process.argv[3]||"candidate";
const out=artifactDir("study-layout-"+label),temp=path.join(REPO_ROOT,".scratch","browser-temp");
await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
const bv="BV1wYAmeqEuV",route=bv+":p1",checks=[],evidence={label,distDir,scope:"real public page; local subtitle fixture; no cloud AI; isolated profile",checks};
let browser,page,worker;const cdps=[];
const expression=id=>`(document.getElementById('biliscript-study-controls')?.shadowRoot?.getElementById(${JSON.stringify(id)})||document.getElementById('biliscript-japanese-study')?.shadowRoot?.getElementById(${JSON.stringify(id)}))`;
async function click(id){
 const point=await page.cdp.evaluate(`(()=>{const e=${expression(id)};e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,w:r.width,h:r.height,hit:e.getRootNode().elementFromPoint(x,y)===e}})()`);
 if(!point.hit||point.w<1||point.h<1)throw new Error("Button is not reachable: "+id+" "+JSON.stringify(point));
 await page.cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:point.x,y:point.y,button:"left",clickCount:1});
 await page.cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:point.x,y:point.y,button:"left",clickCount:1});
}
async function measure(){return page.cdp.evaluate(`(()=>{
 const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,id:e.id,cls:typeof e.className==='string'?e.className:'',x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,display:s.display,position:s.position,overflow:s.overflow,margin:s.margin}};
 const controls=document.getElementById('biliscript-study-controls'),root=controls.shadowRoot,v=document.querySelector('video'),slot=document.getElementById('biliscript-study-slot'),fixed=v?.closest('#playerWrap,.player-wrap');
 const chain=e=>{const out=[];for(let n=e;n&&out.length<8;n=n.parentElement)out.push(rect(n));return out};
 const actions=[...document.querySelectorAll('.video-toolbar-container [title],.video-toolbar-left [title],.video-like,.video-coin,.video-fav')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {...rect(e),title:e.getAttribute('title'),centerHit:[...document.elementsFromPoint(x,y)].slice(0,3).map(n=>n.id||n.className)}});
 return {viewport:{width:innerWidth,height:innerHeight},controls:rect(controls),slot:rect(slot),card:rect(root.getElementById('learningControls')),toolbar:rect(root.querySelector('.toolbar')),status:rect(root.getElementById('status')),statusText:root.getElementById('status').textContent,actionsGroup:rect(root.querySelector('.actions')),buttons:[...root.querySelectorAll('.toolbar button')].map(rect),controlAncestors:chain(controls),videoAncestors:chain(v),nativeActions:actions,duplicateHosts:document.querySelectorAll('#biliscript-study-controls').length,slotCount:document.querySelectorAll('#biliscript-study-slot').length,slotOutsideFixedWrapper:!!slot&&!!fixed&&!fixed.contains(slot)&&slot.previousElementSibling===fixed};
})()`)}
function check(name,ok,detail){checks.push({name,ok:!!ok,detail});if(!ok)throw new Error(name+': '+JSON.stringify(detail))}
async function nativeActions(label){
 for(const selector of ['.video-like','.video-coin','.video-fav']){
  const result=await page.cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,width:r.width,height:r.height,reachable:!!hit&&(hit===e||e.contains(hit)),hit:hit?.id||hit?.className}})()`);
  check(label+'-native-hit-'+selector,result?.reachable,result);
 }
}
async function full(enabled){
 if(enabled)await page.cdp.send('Runtime.evaluate',{expression:"document.querySelector('video').closest('.bpx-player-container').requestFullscreen()",userGesture:true,awaitPromise:true,returnByValue:true});
 else await page.cdp.evaluate('document.exitFullscreen()');
 await waitFor('fullscreen '+enabled,()=>page.cdp.evaluate(`!!document.fullscreenElement===${enabled}`));await sleep(400);
}
try{
 browser=await launchBrowser({distDir,profilePrefix:"study-layout-",muted:true,sync:false});
 page=await attachPage(browser,{viewport:{width:2048,height:1000,deviceScaleFactor:1,mobile:false}});cdps.push(page.cdp);
 worker=createWorkerSession({pageCdp:page.cdp,browser,distDir});if(!await worker.ensureAlive())throw new Error("Extension worker unavailable");cdps.push(worker.handle.cdp);
 await worker.evaluate(`chrome.storage.local.set(${JSON.stringify({biliscriptJapaneseSettings:{autoStart:false,autoTranslate:false,apiKey:""},["biliscript-study-import:"+route]:{identity:route,name:"布局验收字幕.srt",offset:0,cues:[{start:0,end:90,text:"この文を読んでみましょう。"}]}})})`);
 await page.cdp.send("Page.navigate",{url:"https://www.bilibili.com/video/"+bv+"/"});
 await waitFor("public Bilibili player and study shell",()=>page.cdp.evaluate("!!document.querySelector('video')&&!!document.getElementById('biliscript-study-controls')"),{timeoutMs:45000});
 await page.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause())");await sleep(1500);
 const actualRoute=await page.cdp.evaluate("({href:location.href,bvid:location.href.match(/BV[0-9A-Za-z]{10}/)?.[0],page:new URL(location.href).searchParams.get('p')||'1'})");evidence.actualRoute=actualRoute;
 await worker.evaluate(`chrome.storage.local.set(${JSON.stringify({["biliscript-study-import:"+actualRoute.bvid+":p"+actualRoute.page]:{identity:actualRoute.bvid+":fixture",name:"布局验收字幕.srt",offset:0,cues:[{start:0,end:90,text:"この文を読んでみましょう。"}]}})})`);
 await page.cdp.evaluate("document.getElementById('biliscript-study-controls').scrollIntoView({block:'center',behavior:'instant'})");
 evidence.closed=await measure();await screenshot(page.cdp,path.join(out,"01-closed.png"));
 if(label!=='before'){
  check('closed-slot-outside-player',evidence.closed.slotOutsideFixedWrapper);await nativeActions('closed');
  await full(true);check('fullscreen-closed-hides-learning-ui',await page.cdp.evaluate("document.getElementById('biliscript-study-controls').hidden&&document.getElementById('biliscript-japanese-study').hidden"));await full(false);
 }
 await click("show");await waitFor("learning controls",()=>page.cdp.evaluate("document.getElementById('biliscript-study-controls').hasAttribute('data-enabled')"));await sleep(1000);
 await page.cdp.evaluate(expression("status")+".textContent='当前播放窗口字幕已准备，等待播放推进。当前播放窗口字幕已准备，等待播放推进。当前播放窗口字幕已准备，等待播放推进。'");
 evidence.sizes=[];
 for(const width of [2048,1440,1141,900,800,700]){
  await page.cdp.send("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:false});await sleep(800);
  await page.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause());document.getElementById('biliscript-study-controls').scrollIntoView({block:'center',behavior:'instant'})");
  const m=await measure();evidence.sizes.push(m);
  checks.push({name:"status-contained-"+width,ok:m.status.y>=m.controls.y&&m.status.bottom<=m.controls.bottom+.5,detail:{controlBottom:m.controls.bottom,statusBottom:m.status.bottom}});
  checks.push({name:"compact-toolbar-"+width,ok:m.toolbar.height<160,detail:m.toolbar.height});
  if(label!=='before'){
   check('flow-slot-'+width,m.slotOutsideFixedWrapper&&m.slot.height>=m.controls.height&&m.slotCount===1&&m.duplicateHosts===1,m.slot);
   check('status-inside-card-'+width,m.status.y>=m.card.y&&m.status.bottom<=m.card.bottom+.5);
   check('buttons-inside-card-'+width,m.buttons.every(b=>b.x>=m.card.x&&b.right<=m.card.right+.5));
  }
  await screenshot(page.cdp,path.join(out,"enabled-"+width+".png"));
  if(label!=='before')await nativeActions('enabled-'+width);
 }
 if(label!=='before'){
  await page.cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await sleep(500);
  for(let i=0;i<3;i++){await click('stopStudy');await waitFor('closed',()=>page.cdp.evaluate("!document.getElementById('biliscript-study-controls').hasAttribute('data-enabled')"));await click('show');await waitFor('enabled',()=>page.cdp.evaluate("document.getElementById('biliscript-study-controls').hasAttribute('data-enabled')"))}
  check('repeated-toggle-keeps-one-host-and-slot',await page.cdp.evaluate("document.querySelectorAll('#biliscript-study-slot').length===1&&document.querySelectorAll('#biliscript-study-controls').length===1&&document.querySelectorAll('#biliscript-japanese-study').length===1"));
  await full(true);await page.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:200,y:200});
  check('fullscreen-uses-same-host',await page.cdp.evaluate("document.fullscreenElement.contains(document.getElementById('biliscript-study-controls'))&&!document.getElementById('biliscript-study-controls').hidden&&document.getElementById('biliscript-study-slot').getBoundingClientRect().height===0"));
  await click('readPanel');
  evidence.fullscreenNative=await page.cdp.evaluate(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};return {viewport:{width:innerWidth,height:innerHeight},controls:rect(document.getElementById('biliscript-study-controls')),notices:[...document.fullscreenElement.querySelectorAll('[class]')].filter(e=>{const r=e.getBoundingClientRect(),t=e.textContent;return r.width>0&&r.height>0&&t.length<100&&/免费享高清|试看30秒/.test(t)}).map(e=>({tag:e.tagName,cls:typeof e.className==='string'?e.className:'',text:e.textContent,rect:rect(e)}))}})()`);
  await waitFor('native fullscreen toast clearance',()=>page.cdp.evaluate(`(()=>{const bar=document.getElementById('biliscript-study-controls').getBoundingClientRect(),notice=document.fullscreenElement.querySelector('.bpx-player-toast-wrap')?.getBoundingClientRect();return !!notice&&notice.height>0&&bar.bottom+10<=notice.top})()`));
  evidence.fullscreenClearance=await page.cdp.evaluate(`(()=>{const box=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};const controls=document.getElementById('biliscript-study-controls'),toast=document.fullscreenElement.querySelector('.bpx-player-toast-wrap'),overlay=document.getElementById('biliscript-study-overlay');return {controls:box(controls),toast:box(toast),overlay:box(overlay),nativeButtons:[...toast.querySelectorAll('.bpx-player-toast-text,.bpx-player-toast-confirm')].map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {text:e.textContent,reachable:hit===e||e.contains(hit)}})}})()`);
  const clearance=evidence.fullscreenClearance;
  check('fullscreen-native-toast-keeps-visible-and-reachable',clearance.controls.bottom+10<=clearance.toast.top&&clearance.nativeButtons.length>=2&&clearance.nativeButtons.every(x=>x.reachable),clearance);
  check('fullscreen-subtitles-stay-above-relocated-toolbar',clearance.overlay.bottom<=clearance.controls.top-10,clearance);
  await screenshot(page.cdp,path.join(out,'fullscreen-enabled.png'));
  // Close only this private page's native toast to verify automatic restoration.
  const closePoint=await page.cdp.evaluate(`(()=>{const e=document.fullscreenElement.querySelector('.bpx-player-toast-wrap [class*=close]');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  if(closePoint){for(const type of ['mousePressed','mouseReleased'])await page.cdp.send('Input.dispatchMouseEvent',{type,x:closePoint.x,y:closePoint.y,button:'left',clickCount:1});await waitFor('native toast dismissed',()=>page.cdp.evaluate("!document.fullscreenElement.querySelector('.bpx-player-toast-wrap')?.getBoundingClientRect().height"));await waitFor('toolbar returns to base position',()=>page.cdp.evaluate("document.getElementById('biliscript-study-controls').style.bottom==='68px'"));check('fullscreen-native-toast-dismissal-restores-toolbar',true);await screenshot(page.cdp,path.join(out,'fullscreen-toast-dismissed.png'))}
  await full(false);
  const restored=await measure();check('fullscreen-exit-restores-document-flow',restored.slotOutsideFixedWrapper&&restored.controlAncestors[1].id==='biliscript-study-slot');await nativeActions('fullscreen-exit');
  await click('stopStudy');await nativeActions('final-closed');
 }
 console.log(JSON.stringify({out,checkCount:checks.length,failed:checks.filter(x=>!x.ok)},null,2));
}catch(error){evidence.error=String(error.stack);console.error(error.message);process.exitCode=1}
finally{
 evidence.failed=checks.filter(x=>!x.ok);await writeEvidence(out,evidence);
 if(evidence.failed.length)process.exitCode=1;
 try{await page?.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause())")}catch{}
 await teardown({browser,cdps});
}
