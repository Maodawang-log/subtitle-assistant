// Unmodified shipping dist, isolated muted Edge. Synthetic AI never forwarded.
import path from "node:path";
import {mkdir,readFile} from "node:fs/promises";
import {REPO_ROOT,launchBrowser,attachPage,createWorkerSession,screenshot,teardown,waitFor,sleep,writeEvidence,artifactDir,log} from "./harness.mjs";
const out=artifactDir(process.argv.includes("--ui-only")?"japanese-study-ui-final-2.6.3.3":"japanese-study-2.6.3.3"),distDir=path.join(REPO_ROOT,"dist-study");
const temp=path.join(REPO_ROOT,".scratch","browser-temp");await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
const checks=[],evidence={version:"2.6.3.3",checks,scope:"isolated Edge; full real dictionary; synthetic lesson and AI; fake microphone only"};
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});log((ok?"PASS ":"FAIL ")+name+" "+JSON.stringify(detail??"").slice(0,300))};
const wav=path.resolve(REPO_ROOT,"..","..","local-asr","tests","jsut-000.wav");
const $expr=id=>"(document.getElementById('biliscript-japanese-study')?.shadowRoot?.getElementById("+JSON.stringify(id)+")||document.getElementById('biliscript-study-controls')?.shadowRoot?.getElementById("+JSON.stringify(id)+")||document.getElementById("+JSON.stringify(id)+"))";
let browser,page,worker;const cdps=[];
const snap=name=>screenshot(page.cdp,path.join(out,name+".png"));
async function click(id){
 const point=await page.cdp.evaluate("(()=>{const e="+$expr(id)+";if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,w:r.width,h:r.height,hit:e.getRootNode().elementFromPoint(x,y)===e}})()");
 if(!point?.hit||point.w<=0||point.h<=0)throw new Error("No clickable geometry: "+id+" "+JSON.stringify(point));
 await page.cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:point.x,y:point.y,button:"left",clickCount:1});
 await page.cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:point.x,y:point.y,button:"left",clickCount:1});
}
async function text(id){return page.cdp.evaluate($expr(id)+".textContent")}
const aiMarkdown="## 自然译文\n先试着读一遍这个句子吧。\n\n## 核心语法\n**〜てみる** 表示尝试做某事。\n\n- 「読む」变为「読んで」，接「みる」。\n- 「ましょう」表示邀请或提议。\n\n## 词语与变形\n「読む」是五段动词；「この」修饰后面的名词。\n\n## 上下文\n这一句承接前文，邀请对方开始练习。仅依据给出的字幕。";
try{
 browser=await launchBrowser({distDir,profilePrefix:"study-iteration-",muted:true,sync:false,viewport:{width:1440,height:1000},extraArgs:["--use-fake-device-for-media-stream","--use-file-for-fake-audio-capture="+wav]});
 page=await attachPage(browser);cdps.push(page.cdp);
 worker=createWorkerSession({pageCdp:page.cdp,browser,distDir});if(!await worker.ensureAlive())throw new Error("No extension worker");cdps.push(worker.handle.cdp);
 const ext=await worker.evaluate("({id:chrome.runtime.id,version:chrome.runtime.getManifest().version})");check("shipping-build-loaded",ext.version==="2.6.3.3",ext);
 await page.cdp.send("Page.navigate",{url:"chrome-extension://"+ext.id+"/study/options.html"});
 await waitFor("dictionary settings ready",async()=>await page.cdp.evaluate("!!document.getElementById('dictInstall')&&!document.getElementById('dictInstall').disabled"));
 await snap("01-settings");
 if(!process.argv.includes("--ui-only")){
  await click("dictInstall");await sleep(1200);
  log("dictionary start: "+await text("dictStatus"));let last=0;
  await waitFor("full dictionary install",async()=>{
   const status=await text("dictStatus");
   if(Date.now()-last>15000){log(status);last=Date.now();await writeEvidence(out,{...evidence,dictionaryProgress:status})}
   if(/失败|未允许|无效|中断|不一致|不完整|超过/.test(status))throw new Error(status);
   return /安装完成/.test(status);
  },{timeoutMs:300000,intervalMs:1200});
  const state=await text("dictState");check("full-dictionary-installed",state.includes("435,448"),state);
  await page.cdp.send("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  const matches={};
  for(const term of ["食べる","続ける","地震","曖昧","たべる"]){
   await page.cdp.evaluate("document.getElementById('lookupText').value="+JSON.stringify(term)+";document.getElementById('lookupResult').replaceChildren()");await click("lookup");
   await waitFor("offline lookup",()=>page.cdp.evaluate("document.getElementById('lookupResult').querySelector('p')?.textContent"));
   matches[term]=(await text("lookupResult")).slice(0,550);
   check("offline-lookup-"+term,!matches[term].includes("未命中")&&matches[term].length>10,matches[term].slice(0,200));
  }
  evidence.dictionary={installedRows:435448,downloadBytes:36703585,sha256:"9872fc32d05e3f7ea9b5b70a253610e49d99b6eef7db519b96faad1bbec2b678",matches,offline:true};
  await snap("02-dictionary-offline");
  await page.cdp.send("Network.emulateNetworkConditions",{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await click("dictUpdate");await waitFor("dictionary update check",async()=>/已是最新版本|可安装版本|检查更新失败/.test(await text("dictStatus")),{timeoutMs:40000});
  check("dictionary-update-path",(await text("dictStatus")).includes("已是最新版本"),await text("dictStatus"));await writeEvidence(out,evidence);
  const release={id:"jitendex-zh",version:"synthetic-update-test",url:"https://github.com/greyindex/jitendex-yomitan-zh/releases/download/v2026.08.11-zh.4/jitendex-yomitan-zh-full-review-dedup-20260927.zip",sha256:"9872fc32d05e3f7ea9b5b70a253610e49d99b6eef7db519b96faad1bbec2b678",bytes:36703585,expectedRows:435448};
  const meta=()=>page.cdp.evaluate("new Promise((resolve,reject)=>{const r=indexedDB.open('biliscript-study-dictionaries');r.onsuccess=()=>{const q=r.result.transaction('meta').objectStore('meta').getAll();q.onsuccess=()=>{const all=q.result;resolve({active:all.find(x=>x.id==='jitendex-zh')?.generation,pending:all.filter(x=>x.id.startsWith('pending:')).length});r.result.close()};q.onerror=()=>reject(q.error)}})");
  const activeBefore=await meta();
  for(const mode of ["hash-failure","cancel","terminate"]){
   const job={...release,version:release.version+mode,...(mode==="hash-failure"?{sha256:"0".repeat(64)}:{})};
   await page.cdp.evaluate("(()=>{window.__dictTest={stage:'starting'};const w=new Worker(chrome.runtime.getURL('study/dictionary-worker.js'));window.__dictTestWorker=w;w.onmessage=({data})=>{window.__dictTest=data;if(data.stage==='import'&&data.done===2){if("+JSON.stringify(mode)+"==='cancel')w.postMessage({action:'cancel'});if("+JSON.stringify(mode)+"==='terminate'){w.terminate();window.__dictTest={stage:'terminated'}}}};w.postMessage({action:'install',release:"+JSON.stringify(job)+"})})()");
   await waitFor("staged update "+mode,()=>page.cdp.evaluate("['error','canceled','terminated'].includes(window.__dictTest?.stage)"),{timeoutMs:45000});
   const terminal=await page.cdp.evaluate("window.__dictTest");
   if(mode==="terminate"){
    check("interrupted-install-leaves-recoverable-staging",(await meta()).pending===1);
    await page.cdp.send("Page.reload");await waitFor("staging recovery",()=>page.cdp.evaluate("!!document.getElementById('dictUpdate')&&!document.getElementById('dictUpdate').disabled"));
   }else await page.cdp.evaluate("window.__dictTestWorker.terminate()");
   const after=await meta();check("dictionary-atomic-"+mode,after.active===activeBefore.active&&after.pending===0,{stage:terminal.stage,message:terminal.message,oldVersionPreserved:after.active===activeBefore.active,pending:after.pending});
  }
  await writeEvidence(out,evidence,{filename:"dictionary-acceptance.json"});
 }
 const bv="BV1mAam6tEL8",identity=bv+":42393338874",route=bv+":p1";
 const cues=[{start:0,end:2.5,text:"この文を読んでみましょう。"},{start:2.5,end:5.5,text:"毎日少しずつ続けることが大切です。"},{start:5.5,end:8,text:"分からない言葉を調べてください。"}];
 const state={biliscriptJapaneseSettings:{autoStart:false,autoTranslate:false,baseUrl:"https://api.deepseek.com",model:"synthetic-fixture",apiKey:"synthetic-not-real"},["biliscript-study-import:"+route]:{identity,cues,name:"合成验收字幕.srt",offset:0}};
 await worker.evaluate("chrome.storage.local.set("+JSON.stringify(state)+")");
 const audio=await readFile(wav);
 const html='<!doctype html><meta charset="utf-8"><title>日语学习 · 合成验收页面</title><style>body{margin:0;background:#f8faf7;font:16px system-ui;color:#55695a}.site-head{height:64px;border-bottom:1px solid #e1e7df;background:white;padding:18px 40px}main{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:26px;max-width:1360px;margin:24px auto;padding:0 24px}.bpx-player-container{position:relative;width:100%;height:500px;background:linear-gradient(135deg,#122d29,#3c5a48);border-radius:8px}.bpx-player-container:fullscreen{width:100vw;height:100vh;border-radius:0}video{width:100%;height:100%;object-fit:contain}.fixture-label{position:absolute;top:35%;text-align:center;left:10%;right:10%;color:#d1e1ce;font-size:23px;pointer-events:none}.fixture-label small{font-size:13px;display:block;color:#91b09d;margin-top:14px}#full{position:absolute;top:15px;left:15px;border:1px solid #fff6;background:#fff2;color:white;padding:8px;border-radius:6px}.right-container{min-width:0}.native-card{padding:30px;background:white;border:1px solid #dce5dc;border-radius:12px}@media(max-width:1100px){main{display:block}.right-container{display:none}}</style><div class="site-head">BiliScript · 日本語 / 日语学习界面验收</div><main><div class="left-container"><div class="bpx-player-container"><video preload="auto" src="data:audio/wav;base64,'+audio.toString("base64")+'"></video><div class="fixture-label">日语学习界面 · 合成验收<small>用于布局和交互测试；不是实际视频截图</small></div><button id="full" onclick="this.parentElement.requestFullscreen()">全屏</button></div><h3>当前句的阅读、讲解与跟读</h3></div><aside class="right-container"><div class="native-card">页面原有侧栏<br>关闭学习后恢复。</div></aside></main>';
 page.cdp.on("Fetch.requestPaused",async e=>{try{
  if(e.request.url.startsWith("https://www.bilibili.com/video/"+bv+"/"))await page.cdp.send("Fetch.fulfillRequest",{requestId:e.requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"text/html;charset=utf-8"}],body:Buffer.from(html).toString("base64")});
  else await page.cdp.send("Fetch.continueRequest",{requestId:e.requestId});
 }catch(error){evidence.interceptError=String(error.message).slice(0,200)}});
 await page.cdp.send("Fetch.enable",{patterns:[{urlPattern:"https://www.bilibili.com/video/"+bv+"/*"}]});
 const handle=worker.handle;let requests=0,contextRequests=0;
 handle.cdp.on("Fetch.requestPaused",async(e,sid)=>{if((sid||null)!==(handle.sessionId||null))return;requests++;try{
  const body=JSON.parse(e.request.postData||"{}"),context=body.max_tokens===6144;if(context)contextRequests++;
  const result=context&&contextRequests===1?{choices:[{finish_reason:"length",message:{content:"",reasoning_content:"synthetic private reasoning"}}],usage:{completion_tokens:1500}}:{choices:[{finish_reason:"stop",message:{content:[{type:"text",text:aiMarkdown}]}}]};
  await handle.cdp.send("Fetch.fulfillRequest",{requestId:e.requestId,responseCode:200,responseHeaders:[{name:"Content-Type",value:"application/json"}],body:Buffer.from(JSON.stringify(result)).toString("base64")},handle.sessionId);
 }catch(error){evidence.aiInterceptError=error.message}});
 await handle.cdp.send("Fetch.enable",{patterns:[{urlPattern:"https://api.deepseek.com/*"}]},handle.sessionId);
 await page.cdp.send("Page.navigate",{url:"https://www.bilibili.com/video/"+bv+"/"});
 await waitFor("study shell",()=>page.cdp.evaluate("!!document.getElementById('biliscript-study-controls')"));
 await page.cdp.evaluate("document.querySelector('video').pause()");
 await click("full");await sleep(300);
 check("fullscreen-off-all-hidden",await page.cdp.evaluate("!!document.fullscreenElement&&document.getElementById('biliscript-study-controls').hidden&&document.getElementById('biliscript-japanese-study').hidden&&!document.getElementById('biliscript-study-overlay')"));
 check("fullscreen-does-not-request-ai",requests===0);await snap("03-fullscreen-learning-off");
 await page.cdp.evaluate("document.exitFullscreen()");await sleep(300);await click("show");
 await waitFor("import restored",async()=>(await text("status")).includes("已恢复"));
 await page.cdp.evaluate("document.querySelector('video').currentTime=1;document.querySelector('video').pause()");await sleep(600);
 const geometry=await page.cdp.evaluate("(()=>{const v=document.querySelector('.bpx-player-container').getBoundingClientRect(),b=document.getElementById('biliscript-study-controls').getBoundingClientRect(),p=document.getElementById('biliscript-japanese-study').getBoundingClientRect();return {video:{left:v.left,right:v.right,bottom:v.bottom},bar:{top:b.top,left:b.left,right:b.right},panel:{left:p.left,right:p.right,top:p.top,width:p.width},viewport:innerWidth}})()");
 check("ordinary-toolbar-below-video",geometry.bar.top>=geometry.video.bottom,geometry);
 check("ordinary-reading-separate-right",geometry.panel.left>=geometry.video.right&&geometry.panel.right<=geometry.viewport,geometry.panel);
 await click("explain");await waitFor("formatted explanation",()=>page.cdp.evaluate($expr("detail")+".querySelector('strong')?.textContent"));
 check("explanation-markdown-and-collapsed-details",await page.cdp.evaluate("!!"+$expr("detail")+".querySelector('strong')&&!!"+$expr("detail")+".querySelector('details')"));await snap("04-ordinary-explanation");
 await click("paragraph");await waitFor("empty response diagnosis",async()=>(await text("detail")).includes("输出额度耗尽"));
 check("context-empty-reason-explained",contextRequests===1,await text("detail"));await sleep(500);check("no-automatic-failure-retry",contextRequests===1);
 await click("paragraph");await waitFor("context manual retry",()=>page.cdp.evaluate($expr("detail")+".querySelector('strong')?.textContent"));check("context-manual-retry",contextRequests===2);
 await click("record");
 await page.cdp.send("Browser.setPermission",{permission:{name:"microphone"},setting:"denied",origin:"https://www.bilibili.com"});
 await click("micStart");await waitFor("denied microphone",async()=>(await text("practiceStatus")).includes("未获允许"));
 check("real-microphone-denial-recoverable",await page.cdp.evaluate("!"+$expr("micStart")+".disabled"));
 await page.cdp.send("Browser.setPermission",{permission:{name:"microphone"},setting:"granted",origin:"https://www.bilibili.com"});
 await click("micStart");await waitFor("inline mic started",()=>page.cdp.evaluate("!"+$expr("micStop")+".disabled"));
 await sleep(1100);await click("micStop");await waitFor("inline blob ready",()=>page.cdp.evaluate("!"+$expr("micReplay")+".disabled"));
 const recorded=await page.cdp.evaluate("({src:"+$expr("micAudio")+".src,cue:"+$expr("practiceCue")+".textContent,status:"+$expr("practiceStatus")+".textContent})");
 check("inline-real-mediarecorder-fake-mic",recorded.src.startsWith("blob:"),{...recorded,src:"blob:[local]"});
 await click("micReplay");await sleep(300);
 check("inline-recording-replay",await page.cdp.evaluate("!"+$expr("micAudio")+".paused&&"+$expr("micAudio")+".currentTime>0"));
 await page.cdp.evaluate($expr("micAudio")+".pause()");await snap("05-inline-practice");
 const tabs=await worker.evaluate("chrome.tabs.query({}).then(t=>t.map(x=>({id:x.id,url:x.url?.split('?')[0]})))");check("no-separate-recorder-tab",!tabs.some(x=>x.url?.includes("recorder.html")),{count:tabs.length});
 await click("practiceClose");await click("full");await sleep(400);
 check("fullscreen-learning-continues",await page.cdp.evaluate("!!document.fullscreenElement&&!document.getElementById('biliscript-study-controls').hidden&&"+$expr("enable")+".textContent==='停止学习'"));
 await page.cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:80,y:80});await sleep(3800);
 check("fullscreen-controls-idle-hide",await page.cdp.evaluate("document.getElementById('biliscript-study-controls').classList.contains('idle')"));
 await page.cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:85,y:90});await sleep(100);
 check("fullscreen-controls-reveal",await page.cdp.evaluate("!document.getElementById('biliscript-study-controls').classList.contains('idle')"));
 const subtitleGeometry=()=>page.cdp.evaluate("(()=>{const o=document.getElementById('biliscript-study-overlay').getBoundingClientRect(),c=document.getElementById('biliscript-study-controls').getBoundingClientRect(),p=document.getElementById('biliscript-japanese-study');return {top:o.top,bottom:o.bottom,controlsTop:c.top,height:innerHeight,readingOpen:!p.hidden}})()");
 let sg=await subtitleGeometry();check("fullscreen-subtitle-near-bottom-without-practice",sg.top>sg.height*.6&&sg.bottom<=sg.controlsTop,sg);
 await click("record");await click("micStart");await sleep(1000);await click("micStop");
 await waitFor("fullscreen recording ready",()=>page.cdp.evaluate("!"+$expr("micReplay")+".disabled"));sg=await subtitleGeometry();check("fullscreen-practice-does-not-cover-subtitle",sg.bottom<=sg.controlsTop,sg);await snap("06-fullscreen-practice");
 await click("readPanel");sg=await subtitleGeometry();check("fullscreen-practice-and-reading-subtitle-clear",sg.bottom<=sg.controlsTop&&sg.readingOpen,sg);
 await click("practiceClose");sg=await subtitleGeometry();check("fullscreen-close-practice-restores-lower-subtitle",sg.top>sg.height*.6&&sg.bottom<=sg.controlsTop&&sg.readingOpen,sg);await snap("07-fullscreen-explanation");
 await page.cdp.evaluate("document.exitFullscreen()");await sleep(300);
 check("exit-fullscreen-preserves-state",(await text("enable"))==="停止学习");
 await click("stopStudy");await sleep(300);
 check("ordinary-native-sidebar-restored",await page.cdp.evaluate("getComputedStyle(document.querySelector('.native-card')).display!=='none'"));
 await page.cdp.evaluate("history.pushState({},'','?p=2')");await sleep(350);
 check("P-switch-default-off",(await text("enable"))==="开启学习");
 evidence.syntheticAi={requests,contextRequests,paidCallsForwarded:0};
 const diagnostics=await worker.evaluate("chrome.storage.local.get('biliscriptJapaneseAiDiagnostics').then(x=>x.biliscriptJapaneseAiDiagnostics)");
 check("diagnostic-no-private-content",!JSON.stringify(diagnostics).includes("synthetic private reasoning")&&!JSON.stringify(diagnostics).includes("synthetic-not-real")&&!JSON.stringify(diagnostics).includes("この文"));
 if(!process.argv.includes("--ui-only")){
  await page.cdp.send("Page.navigate",{url:"chrome-extension://"+ext.id+"/study/options.html"});await waitFor("installed reopened",async()=>(await text("dictState")).includes("435,448"));
  await click("dictDelete");await waitFor("dictionary deleted",async()=>(await text("dictState")).includes("未安装"),{timeoutMs:90000});
  check("dictionary-delete-real-db",(await text("dictStatus")).includes("已删除"));await snap("08-dictionary-deleted");
 }
}catch(error){evidence.error=String(error.stack||error).slice(0,2500);log("ERROR "+evidence.error);process.exitCode=1}
finally{
 evidence.failed=checks.filter(x=>!x.ok).map(x=>x.name);if(evidence.failed.length)process.exitCode=1;
 await writeEvidence(out,evidence);
 await page?.cdp.evaluate("document.querySelectorAll('video,audio').forEach(m=>{m.pause();m.removeAttribute('src');m.load()})",{timeoutMs:3000}).catch(()=>{});
 await teardown({browser,cdps}).catch(error=>{log("teardown: "+error.message);process.exitCode=1});
 log("EVIDENCE "+out);
}
