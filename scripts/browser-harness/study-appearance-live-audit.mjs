import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { REPO_ROOT, launchBrowser, attachPage, createWorkerSession, screenshot, teardown, waitFor, sleep, writeEvidence, artifactDir, log } from './harness.mjs';

const distDir = path.resolve(process.argv[2] || 'dist-study'), label = process.argv[3] || 'candidate', tailOnly = process.argv.includes('--tail');
const out = artifactDir('study-appearance-live-' + label), temp = artifactDir('appearance-private-temp');
await mkdir(temp, { recursive: true }); process.env.TEMP = temp; process.env.TMP = temp;
const dictionary = JSON.parse(await readFile(path.join(REPO_ROOT, 'extension/study/basic-dictionary.json'), 'utf8'));
const bodies = JSON.parse(await readFile(path.join(REPO_ROOT, 'tests/fixtures/bilibili/bilingual-walkthrough/bodies.json'), 'utf8'));
const japanese = Object.keys(dictionary).find(key => dictionary[key].reading && dictionary[key].reading !== key);
const chinese = Object.values(bodies).find(value => value.lang === 'zh').body[0].content;
const appearanceKey = 'biliscriptStudyAppearance', legacy = { size: 30, color: '#ffffff' }, bv = 'BV1wYAmeqEuV';
const checks = [], cdps = [], pages = [], evidence = {
  scope: 'Isolated headless Edge; two real hydrated public Bilibili pages plus built-extension settings. Synthetic imported Japanese text from bundled dictionary and synthetic Chinese response from existing fixture; real options inputs/storage/DOM sizing. No paid provider, local ASR, microphone or native manager actions. Viewport resizing is explicit; video replacement and pagehide/pageshow are synthetic lifecycle exercises, not a claim of natural site navigation or BFCache.',
  checks, states: [], exceptions: [], tailOnly,
  ...(tailOnly ? { scope: 'Tail-only rerun: two real public Bilibili pages with synthetic imported captions; isolated-context DOMDebugger seeking counts and synthetic pagehide/pageshow storage lifecycle. Core appearance checks are not rerun or counted here. Original core report retains its infrastructure failure at isolated-context lookup.', coreEvidence: 'study-appearance-live-2.6.5.2-review/evidence.json' } : {})
};
evidence.buildSha256 = Object.fromEntries(await Promise.all(['manifest.json','entry/study.js','entry/study-background.js','study/options.js'].map(async file => [file, createHash('sha256').update(await readFile(path.join(distDir,file))).digest('hex')])));
let browser, page, worker, options;
const host = "document.getElementById('biliscript-japanese-study').shadowRoot", bar = "document.getElementById('biliscript-study-controls').shadowRoot", entry = "document.getElementById('biliscript-study-entry').shadowRoot";
const element = id => `(${host}.getElementById(${JSON.stringify(id)})||${bar}.getElementById(${JSON.stringify(id)})||${entry}.getElementById(${JSON.stringify(id)}))`;
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); log('PASS ' + name); }
async function newPage(url, viewport) {
  const created = await page.cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await page.cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
  const cdp = { send: (method, params, ignored, timeoutMs) => page.cdp.send(method, params, sessionId, timeoutMs), evaluate: (expression, opts = {}) => page.cdp.evaluate(expression, { ...opts, sessionId }) };
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Emulation.setDeviceMetricsOverride', viewport);
  const result = { cdp, targetId: created.targetId, sessionId, scripts: new Set(), contexts: new Map() };
  page.cdp.on('Debugger.scriptParsed', (event, eventSession) => { if (eventSession === sessionId && /\/entry\/study\.js$/.test(event.url)) result.scripts.add(event.scriptId); });
  page.cdp.on('Runtime.executionContextCreated', (event, eventSession) => { if (eventSession === sessionId) result.contexts.set(event.context.id, event.context); });
  page.cdp.on('Runtime.executionContextDestroyed', (event, eventSession) => { if (eventSession === sessionId) result.contexts.delete(event.executionContextId); });
  page.cdp.on('Runtime.executionContextsCleared', (_event, eventSession) => { if (eventSession === sessionId) result.contexts.clear(); });
  await cdp.send('Debugger.enable'); await cdp.send('Page.navigate', { url }); return result;
}
async function installWorkerFixtures(handle) {
  if (!cdps.includes(handle.cdp)) cdps.push(handle.cdp);
  await handle.cdp.evaluate(`(()=>{if(globalThis.__appearanceAudit)return;const audit=globalThis.__appearanceAudit={ai:0,settings:0,native:0};
    chrome.runtime.connectNative=()=>{audit.native++;throw new Error('Native management blocked by isolated appearance audit')};
    chrome.runtime.onMessage.addListener(m=>{if(m?.type==='study-settings-public')audit.settings++});
    const original=fetch;globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://api.deepseek.com/')){audit.ai++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:${JSON.stringify(chinese)}}}]}),{headers:{'content-type':'application/json'}})}return original(url,init)};
  })()`, { sessionId: handle.sessionId });
}
async function click(target, expression) {
  await target.cdp.send('Page.bringToFront');
  await target.cdp.evaluate(`(${expression}).scrollIntoView({block:'center',behavior:'instant'})`); await sleep(100);
  const point = await target.cdp.evaluate(`(()=>{const e=${expression},r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;let hit=document.elementFromPoint(x,y);while(hit?.shadowRoot){const n=hit.shadowRoot.elementFromPoint(x,y);if(!n||n===hit)break;hit=n}return {x,y,width:r.width,height:r.height,hit:hit===e||e.contains(hit),disabled:!!e.disabled,obstruction:hit===e||e.contains(hit)?null:hit?.parentElement?.outerHTML.slice(0,1600)}})()`);
  check('reachable-input-' + checks.length, point.width > 0 && point.height > 0 && point.hit && !point.disabled, point);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await target.cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) });
  await sleep(180);
}
async function choose(target, id, value) {
  const expression = `document.getElementById(${JSON.stringify(id)})`; await click(target, expression);
  const index = await target.cdp.evaluate(`[...(${expression}).options].findIndex(o=>o.value===${JSON.stringify(value)})`);
  if (index < 0) throw new Error('Missing option ' + value);
  for (const key of ['Home', ...Array(index).fill('ArrowDown'), 'Enter']) for (const type of ['keyDown', 'keyUp']) await target.cdp.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: { Home: 36, ArrowDown: 40, Enter: 13 }[key] });
  await waitFor('selected ' + value, () => target.cdp.evaluate(`${expression}.value===${JSON.stringify(value)}`)); await sleep(200);
}
async function measure(target) {
  return target.cdp.evaluate(`(()=>{const root=document.getElementById('biliscript-study-overlay')?.shadowRoot;if(!root)return null;const ja=root.querySelector('.ja'),zh=root.querySelector('.zh'),rt=root.querySelector('rt'),container=root.host.parentElement,r=container.getBoundingClientRect(),s=getComputedStyle(ja),z=getComputedStyle(zh),video=document.querySelector('video').getBoundingClientRect();return {container:{width:r.width,height:r.height},video:{width:video.width,height:video.height},viewport:{width:innerWidth,height:innerHeight},ja:parseFloat(s.fontSize),zh:parseFloat(z.fontSize),ruby:rt?parseFloat(getComputedStyle(rt).fontSize):null,color:s.color,zhColor:z.color,shadow:s.textShadow,zhShadow:z.textShadow,text:ja.textContent,chinese:zh.textContent,fullscreen:!!document.fullscreenElement}})()`);
}
const autoSize = state => Math.round(Math.max(20, Math.min(34, state.container.width * .032, state.container.height * .065)));
async function stateCheck(name, target, mode = 'auto', color = 'rgb(255, 255, 255)', manual = 30) {
  await waitFor(name + ' appearance', async () => { const state = await measure(target); return state && state.ja === (mode === 'auto' ? autoSize(state) : manual) && state.color === color; });
  const state = await measure(target); evidence.states.push({ name, ...state });
  check(name + '-player-bound-size', state.ja === (mode === 'auto' ? autoSize(state) : manual), state);
  check(name + '-Chinese-ruby-ratios-shadow-color', state.zh === Math.round(state.ja * .79) && state.ruby !== null && Math.abs(state.ruby - state.ja * .4) < .12 && state.zhColor === color && state.shadow !== 'none' && state.zhShadow !== 'none', state);
  return state;
}
const stored = () => worker.evaluate(`chrome.storage.local.get('${appearanceKey}').then(v=>v.${appearanceKey})`);
const unchangedLegacy = value => value?.size === legacy.size && value?.color === legacy.color && !('mode' in value) && Object.keys(value).length === 2;
async function listenerCount(target, expression) {
  const frame = (await target.cdp.send('Page.getFrameTree')).frameTree.frame.id;
  const context = [...target.contexts.values()].reverse().find(value => value.auxData?.frameId === frame && (value.name === evidence.extensionId || value.origin.includes(evidence.extensionId)));
  if (!context) throw new Error('Extension isolated context missing: ' + JSON.stringify([...target.contexts.values()]));
  target.isolatedContextId = context.id;
  const object = await target.cdp.send('Runtime.evaluate', { expression, contextId: context.id, returnByValue: false });
  if (!object.result.objectId) throw new Error('Listener probe has no object: ' + expression);
  const { listeners } = await target.cdp.send('DOMDebugger.getEventListeners', { objectId: object.result.objectId });
  evidence.listenerSamples ||= []; evidence.listenerSamples.push({ expression, context: context.id, listeners: listeners.map(value => ({ type: value.type, scriptId: value.scriptId })) });
  return listeners.filter(listener => listener.type === 'seeking' && target.scripts.has(listener.scriptId)).length;
}
async function hydrateAndEnable(target) {
  await waitFor('public Bilibili hydrated', () => target.cdp.evaluate("!!document.querySelector('video')&&!document.querySelector('#app[data-server-rendered]')&&!!document.getElementById('biliscript-study-entry')?.shadowRoot"), { timeoutMs: 45000 });
  await target.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause());window.__appearancePauseTimer=setInterval(()=>document.querySelectorAll('video,audio').forEach(v=>v.pause()),150);document.querySelector('video').currentTime=1;scrollTo(0,0)");
  await sleep(1500);
  const coachmark = await target.cdp.evaluate("(()=>{const leaf=[...document.querySelectorAll('body *')].find(e=>e.children.length===0&&e.textContent.includes('登录后这里可以切换语言'));if(!leaf)return null;let node=leaf;for(let i=0;i<4&&node;i++,node=node.parentElement){const close=node.querySelector('[class*=close]');if(close){window.__appearanceCoachmarkClose=close;return {html:node.outerHTML.slice(0,1500),found:true}}}return {html:leaf.parentElement.outerHTML.slice(0,1500),found:false}})()");
  if (coachmark?.found) { evidence.states.push({ name: 'native-coachmark-dismissed', ...coachmark }); await click(target, 'window.__appearanceCoachmarkClose'); }
  else if (coachmark) log('Native coachmark: ' + JSON.stringify(coachmark));
  await click(target, element('show'));
  await waitFor('preview visible', () => target.cdp.evaluate("!document.getElementById('biliscript-japanese-study').hidden"));
  check('preview-before-enable-' + checks.length, await target.cdp.evaluate("!document.getElementById('biliscript-japanese-study').hidden&&!document.getElementById('biliscript-study-controls').hasAttribute('data-enabled')"));
  const bubble = await target.cdp.evaluate("(()=>{const node=document.querySelector('.lang-switch-bubble');if(!node)return null;const close=node.querySelector('[class*=close]');if(close)window.__appearanceCoachmarkClose=close;return {found:!!close,html:node.outerHTML.slice(-1800)}})()");
  if (bubble?.found) { evidence.states.push({ name: 'native-language-coachmark-dismissed', ...bubble }); await click(target, 'window.__appearanceCoachmarkClose'); }
  else if (bubble) log('Language coachmark DOM: ' + JSON.stringify(bubble));
  await click(target, element('enable'));
  await waitFor('imported caption and native ruby', () => target.cdp.evaluate("!!document.getElementById('biliscript-study-overlay')?.shadowRoot.querySelector('rt')"), { timeoutMs: 30000 });
  await target.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause())");
}
try {
  check('fixture-data-available', !!japanese && !!chinese);
  browser = await launchBrowser({ distDir, profilePrefix: 'study-appearance-', muted: true, sync: false });
  page = await attachPage(browser, { viewport: { width: 1700, height: 950, deviceScaleFactor: 1, mobile: false } }); cdps.push(page.cdp); page.scripts = new Set(); page.contexts = new Map(); pages.push(page);
  page.cdp.on('Debugger.scriptParsed', (event, sessionId) => { if (!sessionId && /\/entry\/study\.js$/.test(event.url)) page.scripts.add(event.scriptId); });
  page.cdp.on('Runtime.executionContextCreated', (event, sessionId) => { if (!sessionId) page.contexts.set(event.context.id, event.context); });
  page.cdp.on('Runtime.executionContextDestroyed', (event, sessionId) => { if (!sessionId) page.contexts.delete(event.executionContextId); });
  page.cdp.on('Runtime.executionContextsCleared', (_event, sessionId) => { if (!sessionId) page.contexts.clear(); });
  await page.cdp.send('Debugger.enable');
  worker = createWorkerSession({ pageCdp: page.cdp, browser, distDir, onReconnect: installWorkerFixtures });
  if (!await worker.ensureAlive()) throw new Error('No extension worker');
  evidence.build = await worker.evaluate('chrome.runtime.getManifest()');
  await worker.evaluate(`chrome.storage.local.set(${JSON.stringify({ [appearanceKey]: legacy, biliscriptJapaneseSettings: { sourceLanguage: 'ja', autoStart: false, autoTranslate: false, baseUrl: 'https://api.deepseek.com', apiKey: 'synthetic-appearance-only', model: 'fixture' }, ['biliscript-study-import:' + bv + ':p1:ja']: { language: 'ja', identity: bv + ':appearance', name: 'appearance-fixture', cues: [{ start: 0, end: 120, text: japanese }] } })})`);
  await page.cdp.send('Page.navigate', { url: `https://www.bilibili.com/video/${bv}/?appearance_audit=one` }); await hydrateAndEnable(page);
  const second = await newPage(`https://www.bilibili.com/video/${bv}/?appearance_audit=two`, { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); pages.push(second); await hydrateAndEnable(second);
  evidence.extensionId = await worker.evaluate('chrome.runtime.id');
  if (!tailOnly) {
  const initial = await stateCheck('initial-large-auto', page); await stateCheck('initial-small-auto', second);
  check('legacy-size-color-not-rewritten-on-render', unchangedLegacy(await stored()), await stored());
  const extensionId = await worker.evaluate('chrome.runtime.id'); evidence.extensionId = extensionId;
  options = await newPage(`chrome-extension://${extensionId}/study/options.html`, { width: 1300, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor('options auto mode', () => options.cdp.evaluate("document.getElementById('subtitleSizeMode')?.value==='auto'&&document.getElementById('subtitleSize').disabled"));
  check('legacy-options-retains-size30-in-auto', await options.cdp.evaluate("document.getElementById('subtitleSizeNumber').value==='30'&&document.getElementById('subtitleSizeNumber').disabled"));
  check('options-open-does-not-migrate-storage', unchangedLegacy(await stored()), await stored());
  for (const target of pages) await click(target, element('translate'));
  for (const target of pages) await waitFor('Chinese fixture rendered', () => target.cdp.evaluate(`document.getElementById('biliscript-study-overlay')?.shadowRoot.querySelector('.zh').textContent===${JSON.stringify(chinese)}`));
  await choose(options, 'subtitleSizeMode', 'manual');
  for (const [index, target] of pages.entries()) await stateCheck('manual30-tab' + index, target, 'manual');
  await click(options, "document.querySelector('[data-subtitle-color=\"#ffe595\"]')");
  for (const [index, target] of pages.entries()) await stateCheck('yellow-sync-tab' + index, target, 'manual', 'rgb(255, 229, 149)');
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 720, deviceScaleFactor: 1, mobile: false }); await sleep(600);
  await stateCheck('manual30-small-window', page, 'manual', 'rgb(255, 229, 149)');
  await choose(options, 'subtitleSizeMode', 'auto');
  for (const [index, target] of pages.entries()) await stateCheck('auto-yellow-sync-tab' + index, target, 'auto', 'rgb(255, 229, 149)');
  check('auto-keeps-remembered-manual30', (await stored()).size === 30 && (await stored()).mode === 'auto', await stored());
  await page.cdp.send('Page.bringToFront');
  await page.cdp.send('Runtime.evaluate', { expression: "document.querySelector('video').closest('.bpx-player-container').requestFullscreen()", userGesture: true, awaitPromise: true, returnByValue: true });
  await waitFor('real browser fullscreen', () => page.cdp.evaluate('!!document.fullscreenElement'));
  await stateCheck('auto-fullscreen', page, 'auto', 'rgb(255, 229, 149)'); await screenshot(page.cdp, path.join(out, 'auto-fullscreen.png'));
  await page.cdp.evaluate('document.exitFullscreen()'); await sleep(400);
  await stateCheck('auto-exit-fullscreen', page, 'auto', 'rgb(255, 229, 149)');
  await page.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 950, deviceScaleFactor: 1, mobile: false }); await sleep(600);
  const restored = await stateCheck('auto-restored-window', page, 'auto', 'rgb(255, 229, 149)');
  check('normal-player-size-restored', Math.abs(initial.container.width - restored.container.width) <= 1 && Math.abs(initial.container.height - restored.container.height) <= 1, { initial, restored });
  await worker.evaluate(`chrome.storage.local.set({${appearanceKey}:{mode:'manual',size:30,color:'#0055aa'}})`);
  await waitFor('options receives external storage change', () => options.cdp.evaluate("document.getElementById('subtitleSizeMode').value==='manual'&&!document.getElementById('subtitleSize').disabled&&document.getElementById('subtitleColor').value==='#0055aa'"));
  for (const [index, target] of pages.entries()) await stateCheck('external-blue-sync-tab' + index, target, 'manual', 'rgb(0, 85, 170)');
  await page.cdp.send('Page.bringToFront');
  await page.cdp.send('Runtime.evaluate', { expression: "document.querySelector('video').closest('.bpx-player-container').requestFullscreen()", userGesture: true, awaitPromise: true, returnByValue: true });
  await waitFor('manual fullscreen', () => page.cdp.evaluate('!!document.fullscreenElement')); await stateCheck('manual30-fullscreen', page, 'manual', 'rgb(0, 85, 170)');
  await page.cdp.evaluate('document.exitFullscreen()'); await sleep(400); await stateCheck('manual30-exit-fullscreen', page, 'manual', 'rgb(0, 85, 170)');
  await screenshot(page.cdp, path.join(out, 'manual30-restored.png')); await options.cdp.send('Page.bringToFront'); await screenshot(options.cdp, path.join(out, 'options-manual30.png')); await page.cdp.send('Page.bringToFront');
  }
  const beforeListeners = await listenerCount(page, "document.querySelector('video')");
  check('one-study-seeking-listener-initially', beforeListeners === 1, { count: beforeListeners, scripts: [...page.scripts] });
  for (let iteration = 0; iteration < 2; iteration++) {
    await page.cdp.send('Runtime.evaluate', { contextId: page.isolatedContextId, expression: "(()=>{const old=document.querySelector('video'),fresh=old.cloneNode(true);old.pause();fresh.muted=true;window.__appearanceOldVideo=old;old.replaceWith(fresh);fresh.pause()})()", returnByValue: true });
    await waitFor('replacement video bound', async () => await listenerCount(page, "document.querySelector('video')") === 1);
    check('replacement-removes-old-study-listener-' + iteration, await listenerCount(page, 'window.__appearanceOldVideo') === 0);
    check('replacement-has-single-study-listener-' + iteration, await listenerCount(page, "document.querySelector('video')") === 1);
  }
  await page.cdp.evaluate("dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))"); await sleep(400);
  check('pagehide-unbinds-study-seeking', await listenerCount(page, "document.querySelector('video')") === 0);
  const settingsBefore = await worker.evaluate('globalThis.__appearanceAudit.settings');
  await worker.evaluate("chrome.storage.local.get('biliscriptJapaneseSettings').then(x=>chrome.storage.local.set({biliscriptJapaneseSettings:{...x.biliscriptJapaneseSettings,model:'fixture-after-hide'}}))"); await sleep(500);
  const settingsAfter = await worker.evaluate('globalThis.__appearanceAudit.settings');
  // Tab two remains mounted and receives the same settings change once.
  check('pagehide-unsubscribes-content-settings-listener', settingsAfter - settingsBefore === 1, { settingsBefore, settingsAfter });
  await page.cdp.evaluate("dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
  await waitFor('pageshow rebinds seeking once', async () => await listenerCount(page, "document.querySelector('video')") === 1);
  check('pageshow-stays-disabled', await page.cdp.evaluate("!document.getElementById('biliscript-study-controls').hasAttribute('data-enabled')"));
  const settingsResumed = await worker.evaluate('globalThis.__appearanceAudit.settings');
  await worker.evaluate("chrome.storage.local.get('biliscriptJapaneseSettings').then(x=>chrome.storage.local.set({biliscriptJapaneseSettings:{...x.biliscriptJapaneseSettings,model:'fixture-after-show'}}))"); await sleep(500);
  check('pageshow-restores-one-content-settings-listener', (await worker.evaluate('globalThis.__appearanceAudit.settings')) - settingsResumed === 2);
  evidence.worker = await worker.evaluate('globalThis.__appearanceAudit'); evidence.finalAppearance = await stored();
  check((tailOnly ? 'lifecycle' : 'render-resize-fullscreen-lifecycle') + '-never-rewrites-manual-size', evidence.finalAppearance.size === 30, evidence.finalAppearance);
} catch (error) {
  evidence.error = String(error.stack); process.exitCode = 1; log(error.message);
  try { if (page) await screenshot(page.cdp, path.join(out, 'failure.png')); } catch {}
} finally {
  evidence.failed = checks.filter(value => !value.ok); await writeEvidence(out, evidence);
  for (const target of pages) try { await target.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause())"); } catch {}
  await teardown({ browser, cdps });
}
