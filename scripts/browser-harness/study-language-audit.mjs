import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { REPO_ROOT, launchBrowser, attachPage, createWorkerSession, screenshot, teardown, waitFor, sleep, writeEvidence, artifactDir, log } from './harness.mjs';

const fixture = JSON.parse(await readFile(path.join(REPO_ROOT, 'tests/fixtures/study-language-audit.json'), 'utf8'));
const actionBundle=(await build({entryPoints:[path.join(REPO_ROOT,'extension/study/action-entry.bg.ts')],bundle:true,write:false,format:'iife',globalName:'StudyActionAudit'})).outputFiles[0].text;
const out = artifactDir('study-language-' + (process.argv[2] || 'review'));
const distDir = path.join(REPO_ROOT, 'dist-study'), temp = artifactDir('language-private-temp');
await mkdir(temp, { recursive: true }); process.env.TEMP = temp; process.env.TMP = temp;
let browser, page, worker, mode = 'english-cc';
const cdps = [], checks = [], pending = new Set();
const traffic = { cc: [], asr: [], cancel: [], nativeAudio: [], blocked: [] };
const evidence = { scope: 'Isolated headless Edge, real built extension/MV3/native observer/DOM/pointer gestures. Synthetic Bilibili HTML, CC and media metadata, silent Blob media, CDP-replayed 206 audio probe, ASR responses and local dictionary fixture; AI fetch returns a fixture without network. No live Bilibili content, microphone, model loading, paid API or production native registration.', checks, traffic, exceptions: [] };
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
        if (u.pathname === '/v1/audio/window') { traffic.asr.push(body); return fulfill({ timestamp_origin: 'absolute', language: body.language, segments: [{ start: body.start, end: body.start + Math.min(body.duration, 12), text: 'English recognition window ' + body.start + '.' }] }); }
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
    const original=fetch;globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://api.deepseek.com/')){const body=JSON.parse(init.body),input=JSON.parse(body.messages.at(-1).content),item={text:input.text,system:body.messages[0].content,finished:false};audit.ai.push(item);const hold=audit.holdNext;audit.holdNext=0;if(hold)await new Promise(r=>setTimeout(r,hold));item.finished=true;return new Response(JSON.stringify({choices:[{message:{content:'## Fixture explanation\\nSelected: '+input.text},finish_reason:'stop'}],usage:{completion_tokens:20}}),{headers:{'Content-Type':'application/json'}})}return original(url,init)};
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
async function shot(name) { await screenshot(page.cdp, path.join(out, name + '.png')); }
async function navigateVideo(video) {
  await page.cdp.send('Page.navigate', { url: urlFor(video) });
  await waitFor('fixture media and assistant shell', () => page.cdp.evaluate(`!!window.__fixtureReady&&!!document.getElementById('biliscript-japanese-study')`), { timeoutMs: 30000 });
  await page.cdp.evaluate("document.querySelector('video').pause()"); await sleep(350);
}

try {
  check('fixture-contract', fixture.videos.length === 2 && fixture.englishWords.join('').replaceAll("'", '').length > 20 && fixture.videos.every(v => /^BV[\da-zA-Z]{10}$/.test(v.bvid) && /^\d+$/.test(v.cid)));
  browser = await launchBrowser({ distDir, profilePrefix: 'study-language-', muted: true, sync: false }); page = await attachPage(browser); cdps.push(page.cdp);
  page.cdp.on('Runtime.exceptionThrown', event => evidence.exceptions.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
  await intercept(page.cdp);
  worker = createWorkerSession({ pageCdp: page.cdp, browser, distDir, onReconnect: installWorkerFixtures });
  if (!await worker.ensureAlive()) throw new Error('No extension worker');
  evidence.build = await worker.evaluate('chrome.runtime.getManifest()');
  await worker.evaluate(`chrome.storage.local.set(${JSON.stringify({ biliscriptJapaneseSettings: { autoStart: true, autoTranslate: true, asrModel: 'small', baseUrl: 'https://api.deepseek.com', model: 'fixture-no-network', apiKey: 'isolated-fixture-key' }, biliscriptStudyVocabulary: [fixture.legacyWord] })})`);
  await worker.evaluate(`new Promise((resolve,reject)=>{const req=indexedDB.open('biliscript-study-dictionaries',1);req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('meta',{keyPath:'id'});const terms=db.createObjectStore('terms',{keyPath:['generation','row']});terms.createIndex('term',['generation','term']);terms.createIndex('reading',['generation','reading'])};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['meta','terms'],'readwrite');tx.objectStore('meta').put({id:'ecdict-en-zh',generation:'audit-en',name:'Fixture English dictionary',version:'1',rows:3,bytes:1,at:1});tx.objectStore('meta').put({id:'default:en',dictionaryId:'ecdict-en-zh'});${JSON.stringify(fixture.dictionaryTerms)}.forEach((x,row)=>tx.objectStore('terms').put({...x,generation:'audit-en',row,sequence:row}));tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`);

  await navigateVideo(fixture.videos[0]);
  check('initial-default-is-Japanese-and-disabled', await sourceLanguage() === 'ja' && !await enabled());
  const zero = await activity(); check('closed-page-has-no-CC-ASR-AI-request', zero.cc === 0 && zero.asr === 0 && zero.ai === 0, zero);
  const nativeBefore=await nativeControls();
  check('closed-player-has-no-injected-entry-or-visible-slot',await page.cdp.evaluate("!document.getElementById('biliscript-study-entry')&&document.getElementById('biliscript-study-slot').getBoundingClientRect().height===0&&!!document.getElementById('native-cc')"));
  await shot('00-player-without-injected-switch');
  await openFromToolbar();
  check('toolbar-opens-language-preview-only', await page.cdp.evaluate(`!document.getElementById('biliscript-japanese-study').hidden&&${el('sourceLanguage')}.options.length===2`) && !await enabled() && sameActivity(zero, await activity()));
  check('native-control-dom-and-geometry-preserved-on-open',JSON.stringify(nativeBefore)===JSON.stringify(await nativeControls()));
  await choose(el('sourceLanguage'), 'en');
  check('English-choice-before-enable-is-passive', await sourceLanguage() === 'en' && !await enabled() && sameActivity(zero, await activity()));
  await click(el('fold'));
  await worker.evaluate(`(async()=>{const tab=(await chrome.tabs.query({url:'https://www.bilibili.com/video/*'}))[0];return chrome.tabs.sendMessage(tab.id,{type:'study-toggle'})})()`);
  check('toolbar-action-message-opens-preview-without-starting', await page.cdp.evaluate(`!document.getElementById('biliscript-japanese-study').hidden`) && !await enabled() && sameActivity(zero, await activity()));
  await shot('01-English-preview-no-requests');
  await click(el('enable'));
  await waitFor('English CC and tokens', () => page.cdp.evaluate(`document.getElementById('biliscript-study-overlay')?.shadowRoot.querySelectorAll('.jp-word').length===${fixture.englishWords.length}`));
  const state = await audit(), native = state.native.find(x => x?.status === 'ready');
  check('native-observer-confirms-English-track-with-zero-Japanese-tracks', native?.japaneseTrackCount === 0 && native?.englishTrackCount === 1 && native?.audit.responseStatus === 206, native);
  check('English-CC-does-not-trigger-Japanese-zero-track-ASR', traffic.cc.length > 0 && traffic.asr.length === 0, await activity());
  const tokens = await page.cdp.evaluate(`({text:${overlay}.querySelector('.ja').textContent,words:[...${overlay}.querySelectorAll('.jp-word')].map(x=>x.textContent),ruby:${overlay}.querySelectorAll('rt').length,sidebar:${el('current')}.textContent})`);
  check('English-tokenization-preserves-spaces-punctuation-and-contraction', tokens.text === fixture.englishText && tokens.sidebar === fixture.englishText && JSON.stringify(tokens.words) === JSON.stringify(fixture.englishWords) && tokens.ruby === 0, tokens);
  check('English-CC-still-has-no-automatic-AI', state.ai.length === 0);
  check('native-control-dom-and-geometry-preserved-on-enable',JSON.stringify(nativeBefore)===JSON.stringify(await nativeControls()));
  await shot('02-English-CC-tokenization');
  const manualButton=`${el('rows')}.querySelector('.cue-manual')`,editor=`${el('rows')}.querySelector('.cue-editor')`;
  const saveEdit=`${el('rows')}.querySelector('.cue-edit-save')`,cancelEdit=`${el('rows')}.querySelector('.cue-edit-cancel')`;
  const typeEdit=async text=>{await click(editor);await page.cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await page.cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await page.cdp.send('Input.insertText',{text})};
  check('two-direct-readable-correction-buttons',await page.cdp.evaluate(`${manualButton}.textContent==='人工校对'&&${el('rows')}.querySelector('.cue-proofread').textContent==='AI 校对'&&${manualButton}.getBoundingClientRect().width>40`));
  await click(manualButton);await typeEdit('Canceled manual draft.');await click(cancelEdit);
  check('manual-cancel-preserves-original',await page.cdp.evaluate(`${el('current')}.textContent===${JSON.stringify(fixture.englishText)}`));
  await click(manualButton);await typeEdit('Corrected English sentence.');await shot('02a-manual-inline-editor');await click(saveEdit);
  await waitFor('manual English overlay update',()=>page.cdp.evaluate(`${overlay}.querySelector('.ja').textContent==='Corrected English sentence.'`));
  check('manual-English-save-retokenizes-without-AI-or-ruby',await page.cdp.evaluate(`${el('current')}.textContent==='Corrected English sentence.'&&!${el('current')}.querySelector('rt')&&${el('current')}.querySelectorAll('.token').length===3`)&&!(await audit()).ai.length);
  await navigateVideo(fixture.videos[0]);await openFromToolbar();await choose(el('sourceLanguage'),'en');await click(el('enable'));
  await waitFor('manual edit survives full document reload',()=>page.cdp.evaluate(`${el('current')}?.textContent==='Corrected English sentence.'`));
  check('manual-edit-persists-after-full-document-reload',await page.cdp.evaluate(`${el('current')}.textContent==='Corrected English sentence.'`));
  await click(manualButton);await click(`${el('rows')}.querySelector('.cue-edit-restore')`);
  await waitFor('restore original after reload',()=>page.cdp.evaluate(`${el('current')}?.textContent===${JSON.stringify(fixture.englishText)}`));
  check('manual-restore-keeps-original-timeline',await worker.evaluate(`(async()=>{const data=await chrome.storage.local.get('biliscript-study-corrections:en:${fixture.videos[0].bvid}:p1');return Object.values(Object.values(data)[0]||{}).every(items=>items.length===0)})()`));

  await page.cdp.send('Runtime.evaluate',{expression:"document.querySelector('.bpx-player-container').requestFullscreen()",userGesture:true,awaitPromise:true});
  await waitFor('fullscreen enabled controls',()=>page.cdp.evaluate("!!document.fullscreenElement&&document.getElementById('biliscript-study-controls').hasAttribute('data-fullscreen')"));
  check('fullscreen-keeps-native-CC-and-existing-assistant-controls',await page.cdp.evaluate(`!document.getElementById('biliscript-study-entry')&&!!document.getElementById('native-cc')&&!document.getElementById('biliscript-study-controls').hidden&&!!${el('stopStudy')}`));
  await page.cdp.evaluate('document.exitFullscreen()');await waitFor('normal controls restored',()=>page.cdp.evaluate("!document.fullscreenElement&&!document.getElementById('biliscript-study-controls').hasAttribute('data-fullscreen')"));
  check('native-control-dom-preserved-after-fullscreen',(await nativeControls()).html===nativeBefore.html);

  await click(`[...${overlay}.querySelectorAll('.jp-word')].find(x=>x.textContent==='language')`);
  await waitFor('English word lookup', () => page.cdp.evaluate(`${host}.querySelector('.word-meaning')?.textContent.includes('英语夹具：语言')&&!!${host}.querySelector('.word-star:not(:disabled)')`));
  check('English-word-uses-English-dictionary', await pane() === 'vocabulary' && !(await audit()).ai.length);
  await click(`${host}.querySelector('.word-star')`);
  const saved = await worker.evaluate("(async()=> (await chrome.storage.local.get('biliscriptStudyVocabulary')).biliscriptStudyVocabulary)()");
  check('same-spelling-English-save-preserves-legacy-Japanese-word', saved.length === 2 && saved.some(x => x.term === 'language' && x.language === 'en') && saved.some(x => x.term === 'language' && !x.language), saved);
  await click(`${host}.querySelector('[data-pane=book]')`);
  check('English-wordbook-filters-Japanese-record', await page.cdp.evaluate(`${el('wordList')}.querySelectorAll('.saved-word').length===1&&${el('wordList')}.textContent.includes('英语夹具')&&!${el('wordList')}.textContent.includes('Legacy Japanese')`));
  await shot('03-English-wordbook');
  await drag(`${overlay}.querySelector('.ja')`, "don't", 'study');
  await waitFor('real English drag explanation', () => page.cdp.evaluate(`${el('detail')}.textContent.includes(${JSON.stringify('Selected: ' + fixture.firstSelection)})`));
  const firstAI = (await audit()).ai;
  check('English-drag-requests-exact-fragment-once', firstAI.length === 1 && firstAI[0].text === fixture.firstSelection && firstAI[0].system.includes('英语') && !firstAI[0].system.includes('日语'), firstAI);
  check('drag-release-does-not-open-a-word-card', await pane() === 'explanation');
  await shot('04-English-drag-explanation');

  await worker.evaluate('globalThis.__languageAudit.holdNext=1600');
  await drag(`${overlay}.querySelector('.ja')`, 'we', 'language');
  await waitFor('delayed English request', async () => (await audit()).ai.some(x => x.text === fixture.lateSelection && !x.finished));
  await click(`${host}.querySelector('[data-pane=subtitles]')`); await choose(el('sourceLanguage'), 'ja');
  const switched = await activity();
  check('switching-language-stops-and-waits-for-enable', !await enabled() && await sourceLanguage() === 'ja');
  await waitFor('late fixture reply completed despite abort', async () => (await audit()).ai.some(x => x.text === fixture.lateSelection && x.finished));
  check('old-English-reply-does-not-refill-after-language-switch', await page.cdp.evaluate(`!${el('detail')}.textContent.includes(${JSON.stringify('Selected: ' + fixture.lateSelection)})&&!document.getElementById('biliscript-study-overlay')`) && sameActivity(switched, await activity()));
  await click(`${host}.querySelector('[data-pane=book]')`);
  check('Japanese-wordbook-restores-legacy-only', await page.cdp.evaluate(`${el('wordList')}.querySelectorAll('.saved-word').length===1&&${el('wordList')}.textContent.includes('Legacy Japanese')&&!${el('wordList')}.textContent.includes('英语夹具')`));
  await shot('05-language-switch-isolation');

  await click(`${host}.querySelector('[data-pane=subtitles]')`); await choose(el('sourceLanguage'), 'en');
  await worker.evaluate("chrome.storage.local.remove('biliscriptStudyTemporaryV2')"); // Fresh transport fixture, not a cached prior track.
  mode = 'no-cc'; await page.cdp.evaluate('window.__INITIAL_STATE__.videoData.subtitle.list=[]');
  const beforeASR = traffic.asr.length; await click(el('enable'));
  await waitFor('English ASR window payload', () => traffic.asr.length > beforeASR);
  await waitFor('English ASR result displayed', () => page.cdp.evaluate(`${el('rows')}.textContent.includes('English recognition window')`));
  check('no-English-CC-sends-explicit-English-window-payload', traffic.asr.slice(beforeASR).every(x => x.language === 'en' && x.model === 'small' && x.bvid === fixture.videos[0].bvid && x.cid === fixture.videos[0].cid && x.start >= 0 && x.duration > 0 && x.duration <= 30), traffic.asr.slice(beforeASR));
  await shot('06-English-ASR-window-fixture');
  await click(el('enable')); const afterStop = await activity(); await sleep(400);
  check('disabled-after-ASR-has-no-new-work', !await enabled() && sameActivity(afterStop, await activity()));

  const optionsUrl = await worker.evaluate("chrome.runtime.getURL('study/options.html')");
  await page.cdp.send('Page.navigate', { url: optionsUrl });
  await waitFor('settings language selector', () => page.cdp.evaluate("!!document.getElementById('defaultSourceLanguage')&&document.getElementById('providerState').textContent==='已配置'"));
  check('settings-title-and-default-language', await page.cdp.evaluate("document.querySelector('h1').textContent==='设置'&&document.title.includes('字幕助手')&&document.getElementById('defaultSourceLanguage').value==='ja'"));
  await choose("document.getElementById('defaultSourceLanguage')", 'en');
  await waitFor('default English saved', async () => await worker.evaluate("(async()=> (await chrome.storage.local.get('biliscriptJapaneseSettings')).biliscriptJapaneseSettings.sourceLanguage)()") === 'en');
  check('settings-language-save-needs-no-provider-or-ASR-request', sameActivity(afterStop, await activity()));
  check('settings-does-not-connect-manager-from-subtitles-category', (await audit()).nativeBlocked === 0);
  await shot('07-settings-English-default');
  mode = 'english-cc'; await navigateVideo(fixture.videos[1]);
  check('new-video-initializes-saved-English-default-disabled', await sourceLanguage() === 'en' && !await enabled() && sameActivity(afterStop, await activity()));
  await openFromToolbar(); await choose(el('sourceLanguage'), 'ja');
  check('sidebar-override-does-not-change-global-default', await worker.evaluate("(async()=> (await chrome.storage.local.get('biliscriptJapaneseSettings')).biliscriptJapaneseSettings.sourceLanguage)()") === 'en');
  await page.cdp.evaluate(`history.pushState({},'',${JSON.stringify(urlFor(fixture.videos[0]))})`);
  await waitFor('SPA route clears override', async () => await sourceLanguage() === 'en' && !await enabled());
  check('switching-video-clears-sidebar-override-and-remains-passive', sameActivity(afterStop, await activity()));
  await openFromToolbar(); await shot('08-new-video-default-restored');
  check('entry-remains-absent-after-SPA-navigation',await page.cdp.evaluate("!document.getElementById('biliscript-study-entry')&&!!document.getElementById('native-cc')"));
  await navigateVideo(fixture.videos[0]);await openFromToolbar();await choose(el('sourceLanguage'),'ja');
  await worker.evaluate("chrome.storage.local.remove('biliscriptStudyTemporaryV2')");
  await worker.evaluate(`chrome.storage.local.set({'biliscript-study-import:${fixture.videos[0].bvid}:p1:ja':{identity:'${fixture.videos[0].bvid}:${fixture.videos[0].cid}',name:'Japanese fixture',offset:0,cues:[{start:0,end:30,text:'古い字幕です。'}]}})`);
  await click(el('enable'));await waitFor('Japanese tokens ready',()=>page.cdp.evaluate(`${el('current')}?.querySelectorAll('rt').length>0`),{timeoutMs:30000});
  const beforeManualJa=(await audit()).ai.length;
  await click(manualButton);await typeEdit('明日は東京に行きます。');await click(saveEdit);
  await waitFor('new Japanese furigana',()=>page.cdp.evaluate(`${el('current')}?.textContent.includes('東京')&&[...${el('current')}.querySelectorAll('rt')].some(n=>n.textContent==='とうきょう')`));
  check('manual-Japanese-retokenizes-real-dictionary-furigana',await page.cdp.evaluate(`[...${overlay}.querySelectorAll('rt')].some(n=>n.textContent==='とうきょう')`)&&(await audit()).ai.length===beforeManualJa);
  await shot('09-manual-Japanese-furigana');
  await page.cdp.send('Page.navigate',{url:'about:blank'});await sleep(350); // Replace the transport fixture after disposing its previous document.
  const turboCues=JSON.parse(await readFile(path.join(REPO_ROOT,'tests/fixtures/study-opening-turbo.json'),'utf8'));
  const oldEdits=[{start:5.88,end:13.06,text:turboCues[0].text,originalText:turboCues[1].text},{start:6,end:12.62,text:turboCues[1].text,originalText:turboCues[1].text.replace('3足','3速')}];
  const routeKey=fixture.videos[0].bvid+':p1',resourceKey=fixture.videos[0].bvid+':'+fixture.videos[0].cid;
  await worker.evaluate("chrome.storage.local.remove('biliscriptStudyTemporaryV2')");
  await worker.evaluate(`chrome.storage.local.set(${JSON.stringify({['biliscript-study-import:'+routeKey+':ja']:{identity:resourceKey,name:'Real Turbo transcript fixture',offset:0,cues:turboCues},['biliscript-study-corrections:ja:'+routeKey]:{[resourceKey]:oldEdits}})})`);
  await navigateVideo(fixture.videos[0]);await openFromToolbar();await choose(el('sourceLanguage'),'ja');await click(el('enable'));
  await waitFor('migrated Turbo rows',()=>page.cdp.evaluate(`${el('rows')}.querySelectorAll('.cue').length===3&&${el('current')}?.querySelector('rt')`));
  const migrated=await page.cdp.evaluate(`[...${el('rows')}.querySelectorAll('[data-study-text]')].map(node=>{const copy=node.cloneNode(true);copy.querySelectorAll('rt').forEach(n=>n.remove());return copy.textContent})`);
  check('real-Turbo-text-plus-synthetic-old-edits-has-no-full-text-fragments',JSON.stringify(migrated)===JSON.stringify(turboCues.map(c=>c.text)),migrated);
  await click(`${el('rows')}.querySelectorAll('.cue-manual')[1]`);await click(`${el('rows')}.querySelector('.cue-edit-restore')`);
  const remaining=await worker.evaluate(`(async()=>{const data=await chrome.storage.local.get('biliscript-study-corrections:ja:${routeKey}');return data['biliscript-study-corrections:ja:${routeKey}']['${resourceKey}']})()`);
  check('restoring-rebased-correction-clears-old-anchor',remaining.length===1&&remaining[0].start===5.88,remaining);
  const restoredText=await page.cdp.evaluate(`(()=>{const copy=${el('current')}.cloneNode(true);copy.querySelectorAll('rt').forEach(n=>n.remove());return copy.textContent})()`);
  check('restore-uses-current-model-original-not-older-mistake',restoredText===turboCues[1].text,restoredText);
  await shot('10-rebased-Turbo-corrections');
  const beforeOrdinary=await activity();
  const optionResult=await worker.evaluate(`(async()=>{const tab=await chrome.tabs.create({url:'about:blank',active:false});await globalThis.__clickStudyIcon(tab);const options=await chrome.tabs.query({url:chrome.runtime.getURL('study/options.html')});await chrome.tabs.remove(tab.id);return {opened:options.length>0}})()`);
  check('ordinary-page-icon-opens-real-extension-settings',optionResult.opened,optionResult);
  check('ordinary-page-icon-does-not-start-CC-ASR-AI',sameActivity(beforeOrdinary,await activity()));
  evidence.actionVerification='Actual action routing module and real Chrome tab/options APIs; onClicked registration shim, not a physical toolbar click.';

  check('all-external-HTTP-was-replayed-or-blocked', traffic.blocked.length === 0, traffic.blocked);
  evidence.finalAudit = await audit();
  check('no-page-or-interception-exception', evidence.exceptions.length === 0, evidence.exceptions);
} catch (error) {
  evidence.error = String(error.stack); process.exitCode = 1; log(error.message);
  try { evidence.lastAudit = await audit(); evidence.lastUI = await page.cdp.evaluate(`({url:location.href,body:document.body.innerText.slice(-3000),status:document.getElementById('biliscript-japanese-study')?.shadowRoot.getElementById('status')?.textContent,resources:performance.getEntriesByType('resource').map(x=>x.toJSON()),marker:window.__BILISCRIPT_STUDY_ROUTE_V2__?{...window.__BILISCRIPT_STUDY_ROUTE_V2__,video:undefined,sync:undefined}:null})`); await shot('failure'); } catch {}
} finally {
  evidence.failed = checks.filter(x => !x.ok);
  try { await page?.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>{v.pause();v.removeAttribute('src');v.load()})"); } catch {}
  await Promise.allSettled([...pending]); await writeEvidence(out, evidence);
  await teardown({ browser, cdps });
}
