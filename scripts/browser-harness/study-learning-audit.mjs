import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, readdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { REPO_ROOT, launchBrowser, attachPage, createWorkerSession, screenshot, teardown, waitFor, sleep, writeEvidence, artifactDir, log } from './harness.mjs';

const fixture = JSON.parse(await readFile(path.join(REPO_ROOT, 'tests/fixtures/study-language-audit.json'), 'utf8'));
const actionBundle=(await build({entryPoints:[path.join(REPO_ROOT,'extension/study/action-entry.bg.ts')],bundle:true,write:false,format:'iife',globalName:'StudyActionAudit'})).outputFiles[0].text;
const out = artifactDir(process.argv[2]||'study-learning-workspace');
const distDir = path.join(REPO_ROOT, 'dist-study'), temp = artifactDir('language-private-temp');
await mkdir(temp, { recursive: true }); process.env.TEMP = temp; process.env.TMP = temp;
let browser, page, worker, mode = 'english-cc';
let asrControl={mode:'none',requests:[],stopped:false,release:null};
const cdps = [], checks = [], pending = new Set();
const downloads=path.join(out,'downloads');await mkdir(downloads,{recursive:true});
const traffic = { cc: [], asr: [], cancel: [], nativeAudio: [], blocked: [] };
const evidence = { scope: 'Isolated headless Edge, real built extension/MV3/native observer/DOM/pointer gestures. Synthetic Bilibili HTML, CC and media metadata, silent Blob media, CDP-replayed 206 audio probe, ASR responses and local dictionary fixture; AI fetch returns a fixture without network. No live Bilibili content, microphone, model loading, paid API or production native registration.', checks, traffic, exceptions: [] };
evidence.buildHashes=Object.fromEntries(await Promise.all(['study/options.html','study/options.css','study/options.js','study/options.js.map','study/ui.css','entry/study.js','entry/study.js.map','entry/study-background.js','entry/study-background.js.map'].map(async name=>[name,createHash('sha256').update(await readFile(path.join(distDir,name))).digest('hex')])));
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); log('PASS ' + name); };
const host = `document.getElementById('biliscript-japanese-study').shadowRoot`, bar = `document.getElementById('biliscript-study-controls').shadowRoot`, overlay = `document.getElementById('biliscript-study-overlay').shadowRoot`;
const el = id => `(${host}.getElementById(${JSON.stringify(id)})||${bar}.getElementById(${JSON.stringify(id)}))`;
const openFromToolbar = () => worker.evaluate(`(async()=>{const tab=(await chrome.tabs.query({url:'https://www.bilibili.com/video/*'}))[0];return globalThis.__clickStudyIcon(tab)})()`);
const nativeControls = () => page.cdp.evaluate(`(()=>{const bar=document.querySelector('.bpx-player-control-bottom-right'),player=document.querySelector('.bpx-player-container').getBoundingClientRect();return {html:bar.innerHTML,rects:[...bar.children].map(el=>{const r=el.getBoundingClientRect();return [r.x-player.x,r.y-player.y,r.width,r.height]})}})()`);
const pane = () => page.cdp.evaluate(`${host}.querySelector('[data-pane].selected')?.dataset.pane`);
const audit = () => worker.evaluate('globalThis.__languageAudit');
const enabled = () => page.cdp.evaluate(`document.getElementById('biliscript-study-controls').hasAttribute('data-enabled')`);
const sourceLanguage = () => page.cdp.evaluate(`${el('sourceLanguage')}.value`);
const activity = async () => ({ cc: traffic.cc.length, asr: traffic.asr.length, ai: (await audit()).ai.length });
const sameActivity = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const urlFor = video => 'https://www.bilibili.com/video/' + video.bvid + '/';
const audioFor = video => `https://audit.bilivideo.com/upgcxcode/1/1/${video.cid}/${video.cid}-1-30280.m4s`;
const tracks = () => mode === 'english-cc' ? [{ id: 71, lan: 'en-US', lan_doc: 'English', subtitle_url: 'https://audit.hdslb.com/bfs/subtitle/language-en.json' }] : [];

function htmlFor(video) {
  const config = JSON.stringify({ video, tracks: tracks(), audio: audioFor(video) });
  return `<!doctype html><html><meta charset="utf-8"><title>Isolated language audit</title><style>body{margin:0;background:#f6f7f8;font:16px system-ui}header{padding:20px 36px;background:white}main{display:flex;align-items:flex-start;gap:22px;max-width:1510px;margin:24px auto}.left-container{width:1040px}.right-container{width:420px}#playerWrap{height:625px}.bpx-player-container{position:relative;width:1040px;height:585px;background:#1b2924}video{display:block;width:100%;height:100%;object-fit:contain}.bpx-player-control-bottom-right{height:40px;display:flex;justify-content:flex-end;background:#18251d}.bpx-player-ctrl-setting{width:40px}#native-actions{padding:16px}</style><header>字幕助手语言审计 · 合成页面</header><main id="app"><section class="left-container"><div id="playerWrap"><div class="bpx-player-container"><video muted preload="metadata"></video><div class="bpx-player-control-bottom-right"><button id="native-cc" class="bpx-player-ctrl-subtitle">CC</button><button class="bpx-player-ctrl-setting">⚙</button></div></div></div><div id="native-actions">原生布局占位</div></section><aside class="right-container"><div>推荐列表占位</div></aside></main><script>
  const cfg=${config},v=document.querySelector('video');
  window.__INITIAL_STATE__={videoData:{bvid:cfg.video.bvid,cid:cfg.video.cid,title:cfg.video.title,duration:cfg.video.duration,pages:[{page:1,cid:cfg.video.cid,duration:cfg.video.duration,part:'fixture'}],subtitle:{list:cfg.tracks}}};
  window.__playinfo__={data:{dash:{duration:cfg.video.duration,audio:[{bandwidth:64000,baseUrl:cfg.audio}]}}};
  const rate=8000,n=cfg.video.duration*rate,b=new ArrayBuffer(44+n*2),d=new DataView(b),s=(at,t)=>[...t].forEach((c,i)=>d.setUint8(at+i,c.charCodeAt(0)));
  s(0,'RIFF');d.setUint32(4,36+n*2,true);s(8,'WAVE');s(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,rate,true);d.setUint32(28,rate*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);s(36,'data');d.setUint32(40,n*2,true);
  v.addEventListener('loadedmetadata',async()=>{v.pause();await new Promise(r=>setTimeout(r,150));window.__BILISCRIPT_STUDY_ROUTE_V2__?.sync();await (await fetch(cfg.audio,{headers:{Range:'bytes=0-15'}})).arrayBuffer();window.__fixtureReady=true},{once:true});
  v.src=URL.createObjectURL(new Blob([b],{type:'audio/wav'}));
  </script></html>`;
}

async function intercept(cdp, sessionId) {
  cdp.on('Fetch.requestPaused', (event, eventSession) => {
    if ((eventSession ?? null) !== (sessionId ?? null)) return;
    const promise = (async () => {
      const request = event.request, u = new URL(request.url), id = event.requestId;
      const fulfill = (body, status = 200, type = 'application/json') => cdp.send('Fetch.fulfillRequest', { requestId: id, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: 'https://www.bilibili.com' }, { name: 'Access-Control-Allow-Credentials', value: 'true' }, { name: 'Timing-Allow-Origin', value: '*' }, { name: 'Cache-Control', value: 'no-store' }, ...(status === 206 ? [{ name: 'Content-Range', value: 'bytes 0-15/16' }] : [])], body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64') }, sessionId);
      if (u.hostname === 'www.bilibili.com' && event.resourceType === 'Document') {
        const video = fixture.videos.find(x => u.pathname.includes(x.bvid)); if (video) return fulfill(htmlFor(video), 200, 'text/html');
      }
      if (u.hostname === 'www.bilibili.com' && u.pathname === '/favicon.ico') return fulfill('', 200, 'image/x-icon');
      if (u.hostname === 'audit.bilivideo.com') { traffic.nativeAudio.push({ url: request.url, range: request.headers.Range || request.headers.range }); return fulfill('0123456789abcdef', 206, 'audio/mp4'); }
      if (u.hostname === 'api.bilibili.com') {
        traffic.cc.push({ path: u.pathname, query: u.search });
        const video = fixture.videos.find(x => x.bvid === u.searchParams.get('bvid')) || fixture.videos[0];
        if (u.pathname === '/x/web-interface/view') return fulfill({ code: 0, data: { bvid: video.bvid, aid: 123, cid: video.cid, title: video.title, pages: [{ page: 1, cid: video.cid, duration: video.duration }] } });
        if (/\/x\/player\/(wbi\/)?v2$/.test(u.pathname)) return fulfill({ code: 0, data: { subtitle: { subtitles: tracks() } } });
        if (u.pathname === '/x/player/playurl') return fulfill({ code: 0, data: { dash: { duration: video.duration, audio: [{ id: 30280, bandwidth: 64000, baseUrl: audioFor(video) }] } } });
      }
      if (u.hostname === 'audit.hdslb.com') { traffic.cc.push({ path: u.pathname }); return fulfill({ body: [{ from: 0, to: 30, content: fixture.englishText }, { from: 30, to: 60, content: 'We can learn another sentence.' }] }); }
      if (u.origin === 'http://127.0.0.1:18766') {
        const body = request.postData ? JSON.parse(request.postData) : {};
        if (u.pathname === '/v1/audio/window') { traffic.asr.push(body);
          const control=asrControl;
          if(control.mode!=='none'&&body.start===60){
            control.requests.push(body);
            if(control.mode==='fail')return fulfill({detail:'isolated full-collection failure'},503);
            await new Promise(resolve=>{control.release=resolve});
            if(control.stopped){try{return await fulfill({timestamp_origin:'absolute',segments:[{start:60,end:72,text:'late held fixture'}]})}catch{return}}
          }
          return fulfill({ timestamp_origin: 'absolute', opening_repair:{version:1}, language: body.language, segments: [{ start: body.start, end: body.start + Math.min(body.duration, 12), text: 'English recognition window ' + body.start + '.' }] }); }
        if (u.pathname === '/v1/audio/cancel') { traffic.cancel.push(body); return fulfill({ cancelled: true }); }
        if (u.pathname === '/health') return fulfill({ status: 'ok', service: 'fixture-only' });
      }
      traffic.blocked.push({ origin: u.origin, path: u.pathname });
      await cdp.send('Fetch.failRequest', { requestId: id, errorReason: 'BlockedByClient' }, sessionId);
    })().catch(error => evidence.exceptions.push('fixture interception: ' + error.message));
    pending.add(promise); promise.finally(() => pending.delete(promise));
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*/*' }, { urlPattern: 'https://*/*' }] }, sessionId);
}

async function installWorkerFixtures(handle) {
  if (!cdps.includes(handle.cdp)) cdps.push(handle.cdp);
  await intercept(handle.cdp, handle.sessionId);
  // Headless Edge has no clickable toolbar. Capture only the event registration
  // of the actual routing module; tabs, messages and openOptionsPage remain real.
  await handle.cdp.evaluate(actionBundle+`;globalThis.__entryAuditController?.dispose();globalThis.__entryAuditController=StudyActionAudit.installStudyActionEntry({runtime:chrome.runtime,tabs:chrome.tabs,action:{onClicked:{addListener:fn=>globalThis.__clickStudyIcon=fn,removeListener:()=>{}},setBadgeText:args=>chrome.action.setBadgeText(args),setTitle:args=>chrome.action.setTitle(args)}});`,{sessionId:handle.sessionId});
  await handle.cdp.evaluate(`(()=>{
    if(globalThis.__languageAudit)return;const audit=globalThis.__languageAudit={ai:[],native:[],nativeBlocked:0,holdNext:0};
    chrome.runtime.connectNative=()=>{audit.nativeBlocked++;throw new Error('Native management blocked by isolated audit')};
    const scripting=chrome.scripting.executeScript.bind(chrome.scripting);chrome.scripting.executeScript=async options=>{const result=await scripting(options);if(String(options.func).includes('NO_MARKER'))audit.native.push(result[0]?.result);return result};
    const original=fetch;globalThis.fetch=async(url,init)=>{
     if(String(url).startsWith('https://api.deepseek.com/')){const body=JSON.parse(init.body),input=JSON.parse(body.messages.at(-1).content),item={text:input.text,input,system:body.messages[0].content,finished:false};audit.ai.push(item);const hold=audit.holdNext;audit.holdNext=0;if(hold)await new Promise(r=>setTimeout(r,hold));item.finished=true;if(audit.failNextTranslation&&body.messages[0].content.includes('只返回译文')){audit.failNextTranslation=false;return new Response(JSON.stringify({error:{message:'fixture translation failure'}}),{status:400,headers:{'Content-Type':'application/json'}})}return new Response(JSON.stringify({choices:[{message:{content:input.evidence?JSON.stringify(body.messages[0].content.includes('items:')?{items:input.evidence.map(c=>({id:c.id,status:'suggested',text:'Corrected: '+c.text}))}:{supported:!input.question?.includes('画面'),blocks:input.question?.includes('画面')?[]:[{text:'夹具中文概述与回答',refs:[input.evidence[0].id]}],chapters:input.question?[]:[{text:'夹具章节',refs:[input.evidence[0].id]}],learning:input.question?[]:[{text:'夹具表达与语法',refs:[input.evidence[0].id]}]}):body.messages[0].content.includes('只返回译文')?'夹具中文译文：'+input.text:'## Fixture explanation\\nSelected: '+input.text},finish_reason:'stop'}],usage:{completion_tokens:20}}),{headers:{'Content-Type':'application/json'}})}return original(url,init)};
    return {nativeBlocked:typeof chrome.runtime.connectNative==='function'};
  })()`, { sessionId: handle.sessionId });
}

async function click(expression) {
  await page.cdp.evaluate(`(${expression}).scrollIntoView({block:'center',behavior:'instant'})`); await sleep(80);
  const point = await page.cdp.evaluate(`(()=>{const e=${expression},r=e.getBoundingClientRect();let hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);while(hit?.shadowRoot){const nested=hit.shadowRoot.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!nested||nested===hit)break;hit=nested}return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,hit:hit===e||e.contains(hit),disabled:!!e.disabled}})()`);
  if (!(point.width > 0 && point.height > 0 && point.hit && !point.disabled)) throw new Error('Click target unavailable: ' + expression + ' ' + JSON.stringify(point));
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  for (const type of ['mousePressed', 'mouseReleased']) await page.cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(130);
}
async function choose(expression, value) {
  await click(expression);
  const index = await page.cdp.evaluate(`[...(${expression}).options].findIndex(x=>x.value===${JSON.stringify(value)})`);
  if (index < 0) throw new Error('No select option ' + value);
  for (const key of ['Home', ...Array(index).fill('ArrowDown'), 'Enter']) for (const type of ['keyDown', 'keyUp']) await page.cdp.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: { Home: 36, ArrowDown: 40, Enter: 13 }[key] });
  await waitFor('language select ' + value, () => page.cdp.evaluate(`(${expression}).value===${JSON.stringify(value)}`));
  await sleep(180);
}
async function drag(root, first, last) {
  await page.cdp.evaluate(`(${root}).scrollIntoView({block:'center',behavior:'instant'})`); await sleep(100);
  const points = await page.cdp.evaluate(`(()=>{const root=${root},words=[...root.querySelectorAll('[role=button]')],a=words.find(x=>x.querySelector('ruby')?.firstChild.textContent===${JSON.stringify(first)}),b=words.find(x=>x.querySelector('ruby')?.firstChild.textContent===${JSON.stringify(last)});if(!a||!b)return null;const point=(e,end)=>{const r=document.createRange();r.selectNodeContents(e.querySelector('ruby').firstChild);const b=r.getBoundingClientRect();return {x:end?b.right-.3:b.left+.3,y:b.y+b.height*.65}};return {a:point(a,false),b:point(b,true)}})()`);
  if (!points) throw new Error('Missing English drag endpoints');
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.a });
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.a, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 16; i++) { await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points.a.x + (points.b.x - points.a.x) * i / 16, y: points.a.y + (points.b.y - points.a.y) * i / 16, buttons: 1 }); await sleep(15); }
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.b, button: 'left', clickCount: 1 }); await sleep(180);
}
async function downloadClick(id,extension){
 const folder=path.join(downloads,String((evidence.downloads?.length||0)+1));await mkdir(folder,{recursive:true});
 await page.cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:folder});await click(el(id));
 const name=await waitFor('download '+extension,async()=> (await readdir(folder)).find(n=>n.endsWith('.'+extension)));
 const data=await readFile(path.join(folder,name));
 (evidence.downloads||=[]).push({name:path.relative(out,path.join(folder,name)),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});return data.toString('utf8');
}
async function sidebarCheck(mode){
 const before=await activity(),state=await page.cdp.evaluate(`(()=>{const scroll=${host}.querySelector('.pane:not([hidden]) .scroll');scroll.scrollTop=110;const video=document.querySelector('video');return {scroll:scroll.scrollTop,height:scroll.clientHeight,contentHeight:scroll.scrollHeight,full:document.getElementById('biliscript-japanese-study').hasAttribute('data-fullscreen'),pane:${host}.querySelector('[data-pane].selected').dataset.pane,time:video.currentTime,paused:video.paused,bilingual:${el('translate')}.getAttribute('aria-pressed')}})()`);
 check(mode+'-sidebar-label-visible',await page.cdp.evaluate(`${el('readPanel')}.textContent==='收起侧边栏'&&${el('readPanel')}.getAttribute('aria-expanded')==='true'`));
 await click(el('readPanel'));
 check(mode+'-sidebar-label-hidden',await page.cdp.evaluate(`document.getElementById('biliscript-japanese-study').hidden&&${el('readPanel')}.textContent==='展开侧边栏'&&${el('readPanel')}.title==='展开侧边栏'&&${el('readPanel')}.getAttribute('aria-expanded')==='false'`));
 await click(el('readPanel'));
 const after=await page.cdp.evaluate(`(()=>{const scroll=${host}.querySelector('.pane:not([hidden]) .scroll'),video=document.querySelector('video');return {scroll:scroll.scrollTop,height:scroll.clientHeight,contentHeight:scroll.scrollHeight,full:document.getElementById('biliscript-japanese-study').hasAttribute('data-fullscreen'),pane:${host}.querySelector('[data-pane].selected').dataset.pane,time:video.currentTime,paused:video.paused,bilingual:${el('translate')}.getAttribute('aria-pressed')}})()`);
 check(mode+'-sidebar-preserves-reading-and-playback',JSON.stringify(state)===JSON.stringify(after)&&sameActivity(before,await activity()),{before:state,after});
 const moved=await page.cdp.evaluate(`(()=>{const scroll=${host}.querySelector('.pane:not([hidden]) .scroll');scroll.scrollTop=Math.max(0,scroll.scrollTop-40);return scroll.scrollTop})()`);await sleep(550);
 check(mode+'-manual-scroll-after-reopen-does-not-snap-back',await page.cdp.evaluate(`${host}.querySelector('.pane:not([hidden]) .scroll').scrollTop===${moved}`));
}
async function importFixture(){
 const file=path.join(out,'study-overall-import.srt');await copyFile(path.join(REPO_ROOT,'tests/fixtures/study-overall-import.txt'),file);
 const remote=await page.cdp.send('Runtime.evaluate',{expression:el('subtitleFile')});
 await page.cdp.send('DOM.setFileInputFiles',{files:[file],objectId:remote.result.objectId});
 await waitFor('imported subtitle file',()=>page.cdp.evaluate(`${el('rows')}.textContent.includes('Imported complete document')`));
}
async function resetOverallFixture(){
 const video=fixture.videos[1],key=JSON.stringify([video.bvid+':p1','en']);
 const old={result:{supported:true,blocks:[{text:'历史片段概述',refs:['s1']}],chapters:[],learning:[{text:'旧学习数据保留',refs:['s1']}]},material:{version:1,key,route:video.bvid+':p1',identity:video.bvid+':'+video.cid,bvid:video.bvid,cid:video.cid,page:1,language:'en',title:video.title,source:'asr',duration:video.duration,offset:0,ranges:[{start:0,end:30}],cues:[]},evidence:[{id:'s1',start:1,end:3,text:'历史原句'}],at:1};
 await worker.evaluate(`(async()=>{const saved=(await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1;delete saved.documents[${JSON.stringify(key)}];saved.bookmarks[${JSON.stringify(JSON.stringify(['video',video.bvid,1,'en']))}]=${JSON.stringify({id:JSON.stringify(['video',video.bvid,1,'en']),kind:'video',bvid:video.bvid,cid:video.cid,page:1,language:'en',title:video.title})};saved.records[${JSON.stringify(key)}]={summary:${JSON.stringify(old)},conversation:[]};await chrome.storage.local.set({biliscriptStudyTemporaryV2:{},biliscriptStudyLibraryV1:saved});await chrome.storage.local.remove('biliscript_japanese_study_audio_cache_v1');})()`);
 asrControl={mode:'none',requests:[],stopped:false,release:null};await navigateVideo(video);await openFromToolbar();await choose(el('sourceLanguage'),'en');
 return {old,key};
}
async function shot(name) { await screenshot(page.cdp, path.join(out, name + '.png')); }
async function navigateVideo(video) {
  await page.cdp.send('Page.navigate', { url: urlFor(video) });
  await waitFor('fixture media and assistant shell', () => page.cdp.evaluate(`!!window.__fixtureReady&&!!document.getElementById('biliscript-japanese-study')`), { timeoutMs: 30000 });
  await page.cdp.evaluate("document.querySelector('video').pause()"); await sleep(350);
}

try {
  check('fixture-contract', fixture.videos.length === 2 && fixture.englishWords.join('').replaceAll("'", '').length > 20 && fixture.videos.every(v => /^BV[\da-zA-Z]{10}$/.test(v.bvid) && /^\d+$/.test(v.cid)));
  browser = await launchBrowser({ distDir, profilePrefix: 'study-learning-', muted: true, sync: false }); page = await attachPage(browser); cdps.push(page.cdp);
  page.cdp.on('Runtime.exceptionThrown', event => evidence.exceptions.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
  await intercept(page.cdp);
  worker = createWorkerSession({ pageCdp: page.cdp, browser, distDir, onReconnect: installWorkerFixtures });
  if (!await worker.ensureAlive()) throw new Error('No extension worker');
  evidence.build = await worker.evaluate('chrome.runtime.getManifest()');
  await worker.evaluate(`chrome.storage.local.set(${JSON.stringify({ biliscriptJapaneseSettings: { autoStart: true, autoTranslate: true, asrModel: 'small', baseUrl: 'https://api.deepseek.com', model: 'fixture-no-network', apiKey: 'isolated-fixture-key' }, biliscriptStudyVocabulary: [fixture.legacyWord] })})`);
  await worker.evaluate(`new Promise((resolve,reject)=>{const req=indexedDB.open('biliscript-study-dictionaries',1);req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('meta',{keyPath:'id'});const terms=db.createObjectStore('terms',{keyPath:['generation','row']});terms.createIndex('term',['generation','term']);terms.createIndex('reading',['generation','reading'])};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['meta','terms'],'readwrite');tx.objectStore('meta').put({id:'ecdict-en-zh',generation:'audit-en',name:'Fixture English dictionary',version:'1',rows:3,bytes:1,at:1});tx.objectStore('meta').put({id:'default:en',dictionaryId:'ecdict-en-zh'});${JSON.stringify(fixture.dictionaryTerms)}.forEach((x,row)=>tx.objectStore('terms').put({...x,generation:'audit-en',row,sequence:row}));tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`);

  await navigateVideo(fixture.videos[0]);
  check('starts-passively-without-AI-or-ASR',!await enabled()&&(await activity()).ai===0&&traffic.asr.length===0);
  await openFromToolbar();await choose(el('sourceLanguage'),'en');await click(el('enable'));
  await waitFor('CC subtitle rows',()=>page.cdp.evaluate(`${el('rows')}.querySelectorAll('.cue').length===2`));
  const widths=await page.cdp.evaluate(`(()=>{const a=${el('rows')}.querySelector('.cue-manual').getBoundingClientRect(),b=${el('rows')}.querySelector('.cue-proofread').getBoundingClientRect();return [a.width,b.width]})()`);
  check('manual-and-AI-buttons-equal-width',widths[0]===widths[1]&&widths[0]>=60,widths);
  check('top-buttons-use-complete-labels-and-batch-follows-follow',await page.cdp.evaluate(`${el('import')}.textContent==='导入字幕'&&${el('export')}.textContent==='导出字幕'&&${el('follow')}.nextElementSibling.id==='batchAll'`));
  await shot('01-subtitle-controls');
  const firstStar=()=>`${el('rows')}.querySelector('.cue-favorite')`;
  await worker.evaluate(`(()=>{const set=chrome.storage.local.set.bind(chrome.storage.local);let failOnce=true;chrome.storage.local.set=async value=>{if(failOnce&&Object.values(value.biliscriptStudyLibraryV1?.bookmarks||{}).some(b=>b.kind==='sentence')){failOnce=false;throw new Error('fixture storage failure')}return set(value)}})()`);
  await click(firstStar());await waitFor('visible save error',()=>page.cdp.evaluate(`${el('status')}.textContent.includes('fixture storage failure')&&!${firstStar()}.disabled`));
  check('failed-save-keeps-hollow-star-and-visible-error',await page.cdp.evaluate(`${firstStar()}.textContent==='☆'&&${firstStar()}.getAttribute('aria-pressed')==='false'&&${el('status')}.classList.contains('error')`));
  await shot('favorites-00-save-failure');
  await click(firstStar());await waitFor('saved sentence star',()=>page.cdp.evaluate(`${firstStar()}.textContent==='★'&&!${firstStar()}.disabled`));
  const sentenceOnly=await worker.evaluate(`(async()=> (await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1)()`);
  check('sentence-star-saves-only-one-sentence-with-visible-feedback',Object.values(sentenceOnly.bookmarks).length===1&&Object.values(sentenceOnly.bookmarks)[0].kind==='sentence'&&Object.keys(sentenceOnly.documents).length===0&&traffic.asr.length===0&&(await activity()).ai===0&&await page.cdp.evaluate(`${el('status')}.textContent==='已收藏句子。'&&${firstStar()}.getAttribute('aria-pressed')==='true'&&${firstStar()}.classList.contains('is-saved')`));
  await shot('favorites-01-saved-star');
  await click(firstStar());await waitFor('cancelled star',()=>page.cdp.evaluate(`${firstStar()}.textContent==='☆'&&!${firstStar()}.disabled`));
  check('second-star-click-removes-persisted-sentence',await worker.evaluate(`(async()=>Object.keys((await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1.bookmarks).length===0)()`));
  await click(firstStar());await waitFor('resaved star',()=>page.cdp.evaluate(`${firstStar()}.textContent==='★'`));
  await navigateVideo(fixture.videos[0]);await openFromToolbar();await choose(el('sourceLanguage'),'en');await click(el('enable'));
  await waitFor('star restored after reload',()=>page.cdp.evaluate(`${firstStar()}?.textContent==='★'`));
  check('sentence-star-restored-after-page-reload',await page.cdp.evaluate(`${firstStar()}.getAttribute('aria-pressed')==='true'`));
  await click(`${host}.querySelector('[data-pane=video]')`);
  await waitFor('range label',()=>page.cdp.evaluate(`${el('materialRange')}.textContent.includes('2 句')`));
  check('CC-does-not-claim-proven-whole-video',await page.cdp.evaluate(`${el('materialRange')}.textContent.includes('整轨 CC')&&${el('materialRange')}.textContent.includes('未验证全部语音')`));
  check('one-video-bookmark-entry-without-duplicate-save-or-sentence-controls',await page.cdp.evaluate(`!!${el('bookmarkVideo')}&&!${el('bookmarkCue')}&&!${el('pinMaterial')}`));
  await click(el('bookmarkVideo'));await waitFor('saved bookmark label',()=>page.cdp.evaluate(`${el('bookmarkVideo')}.textContent==='已收藏'`));
  const savedSection=`${el('savedLearning')}.closest('details')`;
  if(!await page.cdp.evaluate(`${savedSection}.open`))await click(`${savedSection}.querySelector('summary')`);
  check('favorites-have-two-counted-groups-and-source-time-replay',await page.cdp.evaluate(`(()=>{const list=${el('savedLearning')};return list.querySelector('[data-kind=video] h3').textContent==='视频收藏（1）'&&list.querySelector('[data-kind=sentence] h3').textContent==='句子收藏（1）'&&!!list.querySelector('.favorite-sentence .favorite-time')&&list.querySelector('.favorite-source').textContent.includes(${JSON.stringify(fixture.videos[0].title)})&&list.querySelector('.favorite-video a').textContent==='打开视频'&&list.querySelector('.favorite-sentence a').textContent==='回看 / 重听'})()`));
  await page.cdp.evaluate(`${el('savedLearning')}.scrollIntoView({block:'center'})`);await shot('favorites-02-grouped-list');
  await page.cdp.evaluate("document.querySelector('.right-container').style.width='320px';document.querySelector('.right-container').style.flex='0 0 320px'");
  const favoritesLayout=await page.cdp.evaluate(`(()=>{const list=${el('savedLearning')};return {width:list.clientWidth,scroll:list.scrollWidth,groups:list.querySelectorAll('.favorite-group').length}})()`);
  check('favorite-groups-fit-narrow-sidebar',favoritesLayout.groups===2&&favoritesLayout.scroll<=favoritesLayout.width,favoritesLayout);
  await page.cdp.evaluate(`${el('savedLearning')}.scrollIntoView({block:'center'})`);await shot('favorites-03-narrow-groups');
  await page.cdp.evaluate("document.querySelector('.right-container').style.width='';document.querySelector('.right-container').style.flex=''");
  await click(`${el('savedLearning')}.querySelector('.favorite-sentence .remove-favorite')`);await waitFor('star sync after list removal',()=>page.cdp.evaluate(`${firstStar()}.textContent==='☆'`));
  check('saved-list-removal-updates-subtitle-star',await page.cdp.evaluate(`${firstStar()}.getAttribute('aria-pressed')==='false'`));
  await click(`${host}.querySelector('[data-pane=subtitles]')`);await click(firstStar());await waitFor('star resaved for summary',()=>page.cdp.evaluate(`${firstStar()}.textContent==='★'`));await click(`${host}.querySelector('[data-pane=video]')`);
  const key=JSON.stringify([fixture.videos[0].bvid+':p1','en']);
  await waitFor('long term save',async()=>!!(await worker.evaluate(`(async()=> (await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1)()`))?.documents[key]);
  let library=await worker.evaluate(`(async()=> (await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1)()`);
  check('video-bookmark-keeps-current-material-and-sentence-star-without-full-transcription',Object.values(library.bookmarks).length===2&&Object.values(library.bookmarks).every(b=>b.bvid===fixture.videos[0].bvid&&b.page===1&&b.language==='en')&&traffic.asr.length===0);
  const ccSummaryAsr=traffic.asr.length;await click(el('summaryGenerate'));await waitFor('grounded summary',()=>page.cdp.evaluate(`${el('videoSummary')}.textContent.includes('夹具中文概述')&&${el('learningStop')}.hidden`));
  check('overall-summary-chapters-grounded-without-learning',await page.cdp.evaluate(`!${el('videoSummary')}.textContent.includes('视频学习清单')&&${el('videoSummary')}.querySelectorAll('.evidence-line').length===2&&!${el('videoLearning')}&&${el('summaryScope')}.textContent.includes('整体总结')&&${el('videoSummary')}.querySelector('.chapter-card h3').textContent==='章节 1'`));
  check('whole-CC-overall-summary-does-not-start-ASR',traffic.asr.length===ccSummaryAsr&&(await audit()).ai.at(-1).input.overall.basis==='cc-track');
  check('summary-citations-share-existing-sentence-state',await page.cdp.evaluate(`[...${el('videoSummary')}.querySelectorAll('.save-sentence')].some(b=>b.getAttribute('aria-pressed')==='true')`));
  await click(`${el('videoSummary')}.querySelector('summary')`);await shot('02-summary-and-evidence');
  await click(`${el('videoSummary')}.querySelector('.save-sentence')`);await waitFor('summary cancel sync',()=>page.cdp.evaluate(`${firstStar()}.textContent==='☆'`));
  await click(`${el('videoSummary')}.querySelector('.save-sentence')`);await waitFor('summary save sync',()=>page.cdp.evaluate(`${firstStar()}.textContent==='★'`));
  check('summary-toggle-updates-star-without-duplicate-records',await worker.evaluate(`(async()=>Object.values((await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1.bookmarks).filter(b=>b.kind==='sentence').length===1)()`));
  await click(`${el('videoSummary')}.querySelector('.evidence-line button')`);
  check('citation-plays-real-video-timestamp',await page.cdp.evaluate('document.querySelector("video").currentTime<2&&!document.querySelector("video").paused'));
  await page.cdp.evaluate('document.querySelector("video").pause()');
  await click(el('chatQuestion'));await page.cdp.send('Input.insertText',{text:'作者的要点是什么？'});await click(el('chatSend'));
  await waitFor('chat saved',()=>page.cdp.evaluate(`${el('videoConversation')}.querySelectorAll('.chat-turn').length===1&&${el('learningStop')}.hidden`));
  await click(el('chatQuestion'));await page.cdp.send('Input.insertText',{text:'画面里是什么颜色？'});await click(el('chatSend'));
  await waitFor('unsupported chat',()=>page.cdp.evaluate(`${el('videoConversation')}.textContent.includes('未提供足够依据')`));
  check('unsupported-question-is-not-invented',await page.cdp.evaluate(`${el('videoConversation')}.querySelectorAll('.chat-turn').length===2`));
  library=await worker.evaluate(`(async()=> (await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1)()`);
  check('conversation-records-do-not-duplicate-full-subtitles',library.records[key].conversation.every(t=>t.material.cues.length===0&&t.fingerprint.length===64&&t.evidence.length<=2));
  const peerGroups=await page.cdp.evaluate(`[...${el('pane-video')}.firstElementChild.children].filter(x=>x.tagName==='DETAILS').map(x=>({title:x.firstElementChild.textContent,border:getComputedStyle(x).borderTopWidth,radius:getComputedStyle(x).borderRadius,open:x.open}))`);
  check('four-peer-card-groups',JSON.stringify(peerGroups.map(g=>g.title))===JSON.stringify(['总结与章节','视频问答','校对记录','视频与句子收藏'])&&peerGroups.every(g=>parseFloat(g.border)>0&&parseFloat(g.radius)>0),peerGroups);
  await page.cdp.evaluate(`${el('pane-video')}.querySelector('.scroll').scrollTop=0`);await shot('video-groups-normal');
  for(const g of peerGroups.filter(g=>g.open))await click(`[...${el('pane-video')}.firstElementChild.children].find(x=>x.tagName==='DETAILS'&&x.firstElementChild.textContent===${JSON.stringify(g.title)}).firstElementChild`);
  await page.cdp.evaluate(`${el('pane-video')}.querySelector('.scroll').scrollTop=0`);await shot('video-four-groups-collapsed');
  for(const g of peerGroups.filter(g=>g.open))await click(`[...${el('pane-video')}.firstElementChild.children].find(x=>x.tagName==='DETAILS'&&x.firstElementChild.textContent===${JSON.stringify(g.title)}).firstElementChild`);
  check('answers-have-no-summary-wrapper',await page.cdp.evaluate(`!${el('videoConversation')}.textContent.includes('概述与要点')`));
  await page.cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  const beforeExports=await activity();await click(el('notesSubtitles'));const markdown=await downloadClick('exportNotes','md');
  check('actual-markdown-download-with-existing-results-and-subtitles',!markdown.includes('## 视频学习清单')&&markdown.includes('整体总结')&&markdown.includes('## 视频问答')&&markdown.includes('作者的要点是什么')&&markdown.includes('## 已取得字幕')&&markdown.includes('?p=1&t=0')&&markdown.includes('未验证全部语音'));
  await sidebarCheck('normal');
  await click(`${host}.querySelector('[data-pane=subtitles]')`);
  for(const format of ['srt','vtt','txt']){await choose(el('subtitleFormat'),format);const text=await downloadClick('export',format);check('actual-'+format+'-subtitle-download',text.includes(fixture.englishText)&&(format!=='vtt'||text.startsWith('WEBVTT'))&&(format!=='srt'||text.includes('00:00:00,000 --> 00:00:30,000')))}
  check('all-exports-use-existing-data-without-AI-or-ASR',sameActivity(beforeExports,await activity()));
  await click(`${host}.querySelector('[data-pane=video]')`);
  await shot('03-video-chat');
  await click(`${host}.querySelector('[data-pane=subtitles]')`);
  await click(`${el('rows')}.querySelector('.cue-manual')`);await click(`${el('rows')}.querySelector('.cue-editor')`);
  await page.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await page.cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await page.cdp.send('Input.insertText',{text:'Manual sentence must survive.'});await click(`${el('rows')}.querySelector('.cue-edit-save')`);
  await waitFor('manual saved',()=>page.cdp.evaluate(`${el('current')}.textContent==='Manual sentence must survive.'`));
  await click(el('batchAll'));await waitFor('batch adopted',()=>page.cdp.evaluate(`${el('batchProgress')}.textContent.includes('采用 1 句')`));
  check('batch-automatic-adoption-protects-manual-edit',await page.cdp.evaluate(`${el('rows')}.textContent.includes('Manual sentence must survive.')&&${el('rows')}.textContent.includes('Corrected: We can learn another sentence.')`));
  await shot('04-batch-proofreading');
  await click(`${host}.querySelector('[data-pane=video]')`);
  check('changed-material-marks-summary-stale-without-request',await page.cdp.evaluate(`!${el('summaryStale')}.hidden`));
  const staleExportActivity=await activity(),staleMarkdown=await downloadClick('exportNotes','md');check('stale-markdown-keeps-original-evidence-and-new-subtitles-separate',staleMarkdown.includes('先前结果')&&staleMarkdown.includes(fixture.englishText.slice(0,-1))&&staleMarkdown.includes('Manual sentence must survive')&&sameActivity(staleExportActivity,await activity()));
  await click(`[...${host}.querySelectorAll('.learning-section>summary')].find(x=>x.textContent==='校对记录')`);await click(`${el('batchHistory')}.querySelector('button')`);
  await waitFor('batch undo',()=>page.cdp.evaluate(`!${el('rows')}.textContent.includes('Corrected:')`));
  check('batch-undo-keeps-manual-and-timestamps',await page.cdp.evaluate(`${el('rows')}.textContent.includes('Manual sentence must survive.')&&${el('rows')}.querySelectorAll('.cue-time')[1].textContent==='0:30'`));
  check('main-transport-order-in-normal-window',await page.cdp.evaluate(`JSON.stringify([...${el('prev')}.parentElement.querySelectorAll('button')].slice(0,4).map(b=>b.id))===JSON.stringify(['prev','next','pause','replay'])`));
  await click(`${host}.querySelector('[data-pane=practice]')`);
  check('current-card-visible-without-recording',await page.cdp.evaluate(`!${el('practice')}.hidden&&${el('practiceCue')}.textContent==='Manual sentence must survive.'&&!${el('micAudio')}.src&&${el('micStop')}.disabled`));
  await click(el('listenReplay'));check('ordinary-replay-does-not-enter-listening',await page.cdp.evaluate(`!document.getElementById('biliscript-japanese-study').hasAttribute('data-intensive')`));
  await click(el('listeningToggle'));
  check('intensive-hides-original-overlay-and-sidebar',await page.cdp.evaluate(`!document.getElementById('biliscript-study-overlay')&&getComputedStyle(${el('current')}).visibility==='hidden'`));
  await waitFor('real sentence playback pauses naturally',()=>page.cdp.evaluate('document.querySelector("video").paused'),{timeoutMs:32000});
  check('intensive-pauses-at-sentence-end',await page.cdp.evaluate('document.querySelector("video").paused'));
  await worker.evaluate('__languageAudit.failNextTranslation=true;__languageAudit.holdNext=800');
  await click(el('listenChinese'));
  check('single-translation-loading-keeps-hide-control-enabled',await page.cdp.evaluate(`!${el('listenChinese')}.disabled&&${el('listenChinese')}.textContent==='隐藏中文'&&${el('listenChinese')}.getAttribute('aria-pressed')==='true'&&${el('practiceChineseStatus')}.textContent.includes('正在翻译当前句')`));
  await waitFor('visible translation error',()=>page.cdp.evaluate(`${el('practiceChineseStatus')}.classList.contains('error')&&!${el('listenChinese')}.disabled`));await shot('listening-01-visible-error');
  check('translation-failure-resets-toggle-for-one-click-retry',await page.cdp.evaluate(`${el('listenChinese')}.textContent==='揭示中文'&&${el('listenChinese')}.getAttribute('aria-pressed')==='false'&&${el('practiceChineseStatus')}.textContent.includes('重试')`));
  await click(el('listenChinese'));await waitFor('Chinese in current card',()=>page.cdp.evaluate(`${el('practiceChinese')}.textContent.includes('夹具中文译文')`));
  check('Chinese-reveals-in-current-card-while-original-stays-hidden',await page.cdp.evaluate(`${el('practiceChinese')}.parentElement===${el('practiceCue')}.parentElement&&!${el('practiceChinese')}.hidden&&getComputedStyle(${el('practiceCue')}).visibility==='hidden'&&${el('translate')}.getAttribute('aria-pressed')==='false'&&!document.getElementById('biliscript-study-overlay')&&!${el('rows')}.textContent.includes('夹具中文译文')`));
  await shot('listening-02-Chinese-only-card');
  await click(el('listenOriginal'));
  check('intensive-reveal-original',await page.cdp.evaluate(`getComputedStyle(${el('current')}).visibility==='visible'`));
  await click(el('listenReplay'));check('replay-preserves-both-reveals',await page.cdp.evaluate(`getComputedStyle(${el('practiceCue')}).visibility==='visible'&&!${el('practiceChinese')}.hidden`));
  await click(el('listenNext'));check('next-resets-reveals-and-disables-last-boundary',await page.cdp.evaluate(`${el('listenNext')}.disabled&&!${el('listenPrev')}.disabled&&${el('practiceChinese')}.hidden&&getComputedStyle(${el('practiceCue')}).visibility==='hidden'`));
  await worker.evaluate('__languageAudit.holdNext=1600');await click(el('listenChinese'));await click(el('listenChinese'));
  await waitFor('hidden pending translation finished',async()=>!(await audit()).ai.some(item=>!item.finished));
  check('hide-pending-translation-cancels-and-suppresses-late-result',await page.cdp.evaluate(`${el('practiceChinese')}.hidden&&${el('practiceChineseStatus')}.hidden&&${el('listenChinese')}.textContent==='揭示中文'&&${el('listenChinese')}.getAttribute('aria-busy')==='false'`));
  await worker.evaluate('__languageAudit.holdNext=1600');await click(el('listenChinese'));await click(el('listenPrev'));
  await waitFor('late translation fixture finished',async()=>!(await audit()).ai.some(item=>!item.finished));
  check('late-next-sentence-translation-does-not-fill-previous-card',await page.cdp.evaluate(`${el('listenPrev')}.disabled&&${el('practiceChinese')}.hidden&&!${el('practiceChinese')}.textContent&&${el('practiceCue')}.textContent==='Manual sentence must survive.'`));
  await click(el('listenChinese'));await click(el('listenOriginal'));await page.cdp.evaluate('document.querySelector("video").pause()');
  const toggleAI=(await audit()).ai.length,toggleTime=await page.cdp.evaluate('document.querySelector("video").currentTime');
  await click(el('listenOriginal'));
  check('hide-original-keeps-Chinese-visible',await page.cdp.evaluate(`${el('listenOriginal')}.textContent==='揭示原文'&&${el('listenOriginal')}.getAttribute('aria-pressed')==='false'&&getComputedStyle(${el('practiceCue')}).visibility==='hidden'&&!${el('practiceChinese')}.hidden`));
  await click(el('listenChinese'));await click(el('listenChinese'));
  check('Chinese-toggle-reuses-cache-and-keeps-original-hidden',toggleAI===(await audit()).ai.length&&await page.cdp.evaluate(`!${el('practiceChinese')}.hidden&&${el('listenChinese')}.textContent==='隐藏中文'&&getComputedStyle(${el('practiceCue')}).visibility==='hidden'&&${el('translate')}.getAttribute('aria-pressed')==='false'`));
  await click(el('listenOriginal'));
  check('reveal-toggles-do-not-seek-play-or-exit-listening',await page.cdp.evaluate(`document.querySelector('video').currentTime===${toggleTime}&&document.querySelector('video').paused&&document.getElementById('biliscript-japanese-study').hasAttribute('data-intensive')&&${el('listenOriginal')}.classList.contains('on')&&${el('listenChinese')}.classList.contains('on')`));
  await shot('toggle-01-normal-revealed');
  await shot('05-intensive-listening');
  await page.cdp.send('Runtime.evaluate',{expression:"document.querySelector('.bpx-player-container').requestFullscreen()",userGesture:true,awaitPromise:true});
  await waitFor('full screen shell mounted',()=>page.cdp.evaluate(`!!document.fullscreenElement&&document.getElementById('biliscript-japanese-study').hasAttribute('data-fullscreen')&&${el('practice')}.parentElement===${el('practiceHome')}`));
  await sleep(300);
  await sidebarCheck('fullscreen');
  check('fullscreen-keeps-native-CC-and-study-sidebar',await page.cdp.evaluate(`!!document.getElementById('native-cc')&&!document.getElementById('biliscript-japanese-study').hidden`));
  check('fullscreen-transport-order-and-right-current-card',await page.cdp.evaluate(`JSON.stringify([...${el('prev')}.parentElement.querySelectorAll('button')].slice(0,4).map(b=>b.id))===JSON.stringify(['prev','next','pause','replay'])&&${el('practice')}.parentElement===${el('practiceHome')}&&!${el('practiceChinese')}.hidden&&${el('listenPrev')}.nextElementSibling===${el('listenReplay')}&&${el('listenReplay')}.nextElementSibling===${el('listenNext')}`));
  check('fullscreen-listening-navigation-stays-on-one-line',await page.cdp.evaluate(`new Set(['listenPrev','listenReplay','listenNext'].map(id=>${host}.getElementById(id).getBoundingClientRect().top)).size===1`));
  await click(el('listenChinese'));await click(el('listenOriginal'));
  check('fullscreen-toggles-hide-both-independently',await page.cdp.evaluate(`${el('practiceChinese')}.hidden&&getComputedStyle(${el('practiceCue')}).visibility==='hidden'&&${el('listenChinese')}.getAttribute('aria-pressed')==='false'&&${el('listenOriginal')}.getAttribute('aria-pressed')==='false'`));
  await shot('toggle-02-fullscreen-hidden');await click(el('listenChinese'));await click(el('listenOriginal'));
  check('fullscreen-toggles-restore-cached-displays',toggleAI===(await audit()).ai.length&&await page.cdp.evaluate(`!${el('practiceChinese')}.hidden&&getComputedStyle(${el('practiceCue')}).visibility==='visible'`));
  await click(`${host}.querySelector('[data-pane=subtitles]')`);await waitFor('fullscreen original recorder layout',()=>page.cdp.evaluate(`${el('practice')}.parentElement===${el('learningControls')}`));
  check('fullscreen-outside-practice-keeps-original-recorder-position',await page.cdp.evaluate(`${el('practice')}.parentElement===${el('learningControls')}`));
  await click(`${host}.querySelector('[data-pane=video]')`);await page.cdp.evaluate(`${el('pane-video')}.querySelector('.scroll').scrollTop=0`);await shot('video-groups-fullscreen');
  await click(`${host}.querySelector('[data-pane=practice]')`);
  await shot('06-fullscreen-learning');await page.cdp.evaluate('document.exitFullscreen()');await sleep(350);
  await click(el('listenReplay'));await page.cdp.evaluate('document.querySelector("video").playbackRate=16');
  await click(el('listeningToggle'));
  await waitFor('exited playback passes old sentence end',()=>page.cdp.evaluate('document.querySelector("video").currentTime>31'),{timeoutMs:7000});
  check('exit-clears-intensive-end-pause-without-pausing-or-seeking',await page.cdp.evaluate('!document.querySelector("video").paused'));
  await page.cdp.evaluate('document.querySelector("video").pause();document.querySelector("video").playbackRate=1');await click(el('prev'));
  await click(el('translate'));await waitFor('global Chinese overlay',()=>page.cdp.evaluate(`document.getElementById('biliscript-study-overlay')?.shadowRoot?.querySelector('.zh')?.textContent.includes('夹具中文译文')`));
  await shot('listening-03-global-bilingual-on');await click(el('translate'));
  check('bilingual-off-removes-plugin-Chinese-immediately',await page.cdp.evaluate(`!document.getElementById('biliscript-study-overlay')?.shadowRoot?.querySelector('.zh')?.textContent&&!${el('rows')}.textContent.includes('夹具中文译文')&&${el('practiceChinese')}.hidden&&${el('translate')}.getAttribute('aria-pressed')==='false'`));await shot('listening-04-global-bilingual-off');
  await click(el('listeningToggle'));await click(el('listenChinese'));
  check('explicit-reveal-after-global-off-only-fills-current-card',await page.cdp.evaluate(`!${el('practiceChinese')}.hidden&&!${el('rows')}.textContent.includes('夹具中文译文')&&${el('translate')}.getAttribute('aria-pressed')==='false'&&!document.getElementById('biliscript-study-overlay')`));
  await click(el('listeningToggle'));await page.cdp.evaluate('document.querySelector("video").pause()');
  // Reuse the existing word favorite; do not invent a second vocabulary entry.
  await click(`${host}.querySelector('[data-pane=subtitles]')`);await click(el('next'));
  await click(`${el('rows')}.querySelector('.cue.active .token')`);
  await waitFor('word star',()=>page.cdp.evaluate(`!!${host}.querySelector('.word-star:not(:disabled)')`));await click(`${host}.querySelector('.word-star')`);
  await click(`${host}.querySelector('[data-pane=book]')`);await click(el('startReview'));
  check('review-hides-answer-until-reveal',await page.cdp.evaluate(`${el('reviewCard')}.querySelector('div').hidden`));await click(`${el('reviewCard')}.querySelector('button')`);
  await click(`[...${el('reviewCard')}.querySelectorAll('button')].find(x=>x.textContent==='记得')`);
  library=await worker.evaluate(`(async()=> (await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1)()`);
  check('review-next-due-persisted',Object.values(library.reviews).some(r=>r.due>Date.now()+23*3600000));await shot('07-vocabulary-review');
  const beforeReload=(await audit()).ai.length;await navigateVideo(fixture.videos[0]);await openFromToolbar();await choose(el('sourceLanguage'),'en');await click(el('enable'));await click(`${host}.querySelector('[data-pane=video]')`);
  await waitFor('reloaded conversation',()=>page.cdp.evaluate(`${el('videoConversation')}.querySelectorAll('.chat-turn').length===2`));
  check('long-term-material-and-chat-restore-without-AI',beforeReload===(await audit()).ai.length&&await page.cdp.evaluate(`${el('current')}.textContent==='Manual sentence must survive.'`));
  await page.cdp.evaluate("document.querySelector('.right-container').style.width='320px';document.querySelector('.right-container').style.flex='0 0 320px'");
  const layout=await page.cdp.evaluate(`(()=>{const root=${host},panel=root.querySelector('.panel'),tabs=[...root.querySelectorAll('.tabs button')];return {width:panel.clientWidth,scroll:panel.scrollWidth,fonts:tabs.map(b=>parseFloat(getComputedStyle(b).fontSize)),rows:[...new Set(tabs.map(b=>b.getBoundingClientRect().top))].length}})()`);
  check('narrow-sidebar-tabs-readable-and-no-horizontal-overflow',layout.scroll<=layout.width&&layout.fonts.every(x=>x>=14)&&layout.rows===2,layout);await shot('08-narrow-sidebar');
  // New video with no CC: explicitly collect the remaining windows on one queue.
  mode='no-cc';await navigateVideo(fixture.videos[1]);await openFromToolbar();await choose(el('sourceLanguage'),'en');await click(el('enable'));
  await waitFor('playback window ready',()=>page.cdp.evaluate(`${el('rows')}.textContent.includes('recognition window')`));await click(`${host}.querySelector('[data-pane=video]')`);const asrBefore=traffic.asr.filter(x=>x.bvid===fixture.videos[1].bvid).length;
  await click(el('summaryGenerate'));await waitFor('full explicit collection and summary',()=>page.cdp.evaluate(`${el('learningStatus')}.textContent.includes('整体总结完成')`),{timeoutMs:30000});
  const windows=traffic.asr.filter(x=>x.bvid===fixture.videos[1].bvid);check('full-collection-no-duplicate-playback-windows',new Set(windows.map(w=>w.start)).size===windows.length&&windows.length>=asrBefore&&windows.every(w=>w.start+w.duration<=fixture.videos[1].duration),windows.map(w=>w.start));
  check('full-coverage-label-after-processing-all-windows',await page.cdp.evaluate(`${el('materialRange')}.textContent.includes('已处理全片音频')`));
  await shot('09-complete-collection');
  check('no-learning-generation-task-in-overall-prompt',(await audit()).ai.filter(x=>x.input.overall).every(x=>!x.system.includes('learning')&&!x.input.notes?.some(n=>n.kind==='learning')));
  const importBefore=await activity();await importFixture();await click(el('summaryGenerate'));
  await waitFor('transient full import confirmation',()=>page.cdp.evaluate(`${el('importScopeDialog')}.open`));
  check('unconfirmed-import-does-not-call-AI-or-ASR',sameActivity(importBefore,await activity()));await shot('overall-import-confirmation');
  await click(el('importScopeFull'));await waitFor('complete import summarized',()=>page.cdp.evaluate(`${el('learningStatus')}.textContent.includes('整体总结完成')`));
  check('confirmed-complete-import-does-not-transcribe',traffic.asr.length===importBefore.asr&&(await audit()).ai.at(-1).input.overall.basis==='confirmed-import');await shot('overall-import-result');
  for(const action of ['fail','hold']){
   const fixtureState=await resetOverallFixture(),prefixBefore=traffic.asr.length;
   await click(el('enable'));await waitFor('ordinary bounded prefix',()=>traffic.asr.length>=prefixBefore+2);await click(`${host}.querySelector('[data-pane=video]')`);
   const beforeAI=(await audit()).ai.length;
   asrControl={mode:action,requests:[],stopped:false,release:null};await click(el('summaryGenerate'));
   await waitFor('controlled full collection window',()=>asrControl.requests.length===1);
   if(action==='hold'){await click(el('learningStop'));asrControl.stopped=true;asrControl.release?.()}
   await waitFor('failed or stopped collection ended',()=>page.cdp.evaluate(`${el('learningStop')}.hidden`));await sleep(200);
   const stored=await worker.evaluate(`(async()=> (await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1.records[${JSON.stringify(fixtureState.key)}])()`);
   check('full-collection-'+action+'-submits-no-AI-and-keeps-history',beforeAI===(await audit()).ai.length&&isDeepStrictEqual(stored.summary,fixtureState.old)&&await page.cdp.evaluate(`${el('summaryScope')}.textContent.includes('历史／局部总结')`),{beforeAI,afterAI:(await audit()).ai.length,historyEqual:isDeepStrictEqual(stored.summary,fixtureState.old),scope:await page.cdp.evaluate(`${el('summaryScope')}.textContent`)});
   await shot('overall-'+action+'-keeps-history');
  }
  const endFixture=await resetOverallFixture(),endedAsr=traffic.asr.length;
  await page.cdp.evaluate('document.querySelector("video").currentTime=90;document.querySelector("video").pause()');await sleep(200);await click(el('enable'));await sleep(350);
  check('playback-end-does-not-automatically-collect-full-video',traffic.asr.length===endedAsr);
  await click(`${host}.querySelector('[data-pane=video]')`);const endAI=(await audit()).ai.length;await click(el('summaryGenerate'));
  await waitFor('overall summary from playback end',()=>page.cdp.evaluate(`${el('learningStatus')}.textContent.includes('整体总结完成')`),{timeoutMs:30000});
  const endWindows=traffic.asr.slice(endedAsr).map(w=>w.start);
  check('unique-overall-button-at-playback-end-collects-from-start',[0,30,60].every(t=>endWindows.includes(t))&&(await audit()).ai.length===endAI+1, endWindows);
  const endSaved=await worker.evaluate(`(async()=> (await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1.records[${JSON.stringify(endFixture.key)}])()`);
  check('legacy-partial-and-learning-archived-not-erased-on-success',isDeepStrictEqual(endSaved.legacySummaries[0],endFixture.old)&&!endSaved.summary.result.learning&&endSaved.summary.overall.kind==='overall');
  await shot('overall-from-playback-end');

  const optionsUrl=await worker.evaluate("chrome.runtime.getURL('study/options.html')");await page.cdp.send('Page.navigate',{url:optionsUrl+'#storage'});
  await waitFor('cache settings',()=>page.cdp.evaluate("document.getElementById('cacheUsage')?.textContent.includes('MiB')"));const protectedBefore=await worker.evaluate("(async()=>JSON.stringify((await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1))()");
  await click("document.getElementById('clearTemporary')");await waitFor('cache cleared',()=>page.cdp.evaluate("document.getElementById('cacheFeedback').textContent.includes('已清理')"));
  check('clear-cache-preserves-long-term-bookmarks-corrections-review',protectedBefore===await worker.evaluate("(async()=>JSON.stringify((await chrome.storage.local.get('biliscriptStudyLibraryV1')).biliscriptStudyLibraryV1))()"));
  await shot('10-storage-settings');check('no-page-errors',evidence.exceptions.length===0,evidence.exceptions);check('no-native-manager-service-actions',(await audit()).nativeBlocked===0);
} catch(error){evidence.error=error.stack||String(error);process.exitCode=1;console.error(evidence.error);try{await shot('failure')}catch{}}
finally{evidence.passed=checks.filter(c=>c.ok).length;evidence.failed=checks.filter(c=>!c.ok);await Promise.allSettled([...pending]);await writeEvidence(out,evidence);await teardown({browser,cdps})}
