// Independent geometry review of the user's normal-window complaint.
// Actual public Bilibili DOM; local subtitle fixture, no AI or microphone use.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { REPO_ROOT, launchBrowser, attachPage, createWorkerSession, screenshot, teardown, waitFor, sleep, writeEvidence, artifactDir } from './harness.mjs';

const distDir = path.resolve(process.argv[2] || 'dist-study');
const out = artifactDir('study-windowed-root-' + (process.argv[3] || 'candidate'));
const temp = path.join(REPO_ROOT, '.scratch/browser-temp');
await mkdir(temp, { recursive: true }); process.env.TEMP = temp; process.env.TMP = temp;
const checks = [], evidence = { scope: 'real Bilibili public page, isolated Edge, synthetic imported Japanese subtitles and proofreading transport; no paid AI or microphone capture', checks };
let browser, page, worker; const cdps = [];
const host = "document.getElementById('biliscript-japanese-study').shadowRoot";
const controls = "document.getElementById('biliscript-study-controls').shadowRoot";
const el = id => `(${host}.getElementById(${JSON.stringify(id)})||${controls}.getElementById(${JSON.stringify(id)})||document.getElementById('biliscript-study-entry').shadowRoot.getElementById(${JSON.stringify(id)}))`;
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); }
async function click(expression) {
  const point = await page.cdp.evaluate(`(()=>{const e=${expression},r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=e.getRootNode().elementFromPoint(x,y);return {x,y,visible:r.width>0&&r.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight,hit:h===e||e.contains(h)}})()`);
  check('reachable-' + checks.length, point.visible && point.hit, point);
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  for (const type of ['mousePressed', 'mouseReleased']) await page.cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(200);
}
async function measure() {
  return page.cdp.evaluate(`(()=>{
    const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const h=${host},b=${controls},v=document.querySelector('video'),status=${el('status')};
    return {scrollY,viewport:{width:innerWidth,height:innerHeight},title:box(document.querySelector('h1')),video:box(v),toolbar:box(b.querySelector('.toolbar')),card:box(b.getElementById('learningControls')),panel:box(h.querySelector('.panel')),head:box(h.querySelector('.head')),status:box(status),statusParent:status.parentElement.className,practice:box(${el('practice')}),practiceRoot:${el('practice')}.getRootNode().host.id,mic:box(${el('micDevice')}),start:box(${el('micStart')}),original:box(${el('micOriginal')}),recordButton:box(${el('record')}),tabs:[...h.querySelectorAll('[data-pane]')].map(x=>({text:x.textContent,box:box(x)})),duplicateHosts:document.querySelectorAll('#biliscript-japanese-study').length};
  })()`);
}
const inside = (rect, viewport) => !!rect && rect.width > 0 && rect.height > 0 && rect.x >= -1 && rect.y >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1;
try {
  browser = await launchBrowser({ distDir, profilePrefix: 'study-windowed-root-', muted: true, sync: false });
  page = await attachPage(browser, { viewport: { width: 2048, height: 970, deviceScaleFactor: 1, mobile: false } }); cdps.push(page.cdp);
  worker = createWorkerSession({ pageCdp: page.cdp, browser, distDir });
  if (!await worker.ensureAlive()) throw new Error('Extension worker unavailable'); cdps.push(worker.handle.cdp);
  const bv = 'BV1wYAmeqEuV';
  await worker.evaluate(`chrome.storage.local.set(${JSON.stringify({ biliscriptJapaneseSettings: { autoStart: false, autoTranslate: false, apiKey: '' }, ['biliscript-study-import:' + bv + ':p1']: { identity: bv + ':fixture', name: 'root-review.srt', cues: [{ start: 0, end: 120, text: '私たちの暮らしに広がる変化です。' }] } })})`);
  await page.cdp.send('Page.navigate', { url: 'https://www.bilibili.com/video/' + bv + '/' });
  await waitFor('Bilibili hydrated and extension mounted', () => page.cdp.evaluate("!!document.querySelector('video')&&!document.querySelector('#app[data-server-rendered]')&&!!document.getElementById('biliscript-japanese-study')"), { timeoutMs: 45000 });
  await page.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause());scrollTo(0,0)");
  // Enable via the same runtime message as the user-approved browser action.
  await worker.evaluate("(async()=>{const tabs=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.sendMessage(tabs[0].id,{type:'study-toggle'})})()");
  await waitFor('subtitles and normal layout', () => page.cdp.evaluate(`${el('current')}.textContent.includes('暮らし')&&${host}.querySelector('[data-pane=practice]')`));
  await sleep(1000);
  evidence.sizes = [];
  for (const [width, height] of [[2048, 970], [1440, 900], [1366, 768], [1280, 800], [1280, 720]]) {
    await page.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await sleep(800);
    await page.cdp.evaluate("scrollTo(0,0);document.querySelectorAll('video,audio').forEach(v=>v.pause())"); await sleep(300);
    const before = await measure();
    check('compact-single-toolbar-' + width, before.toolbar.height <= 52, before.toolbar);
    check('title-player-toolbar-tabs-in-one-viewport-' + width, inside(before.title, before.viewport) && inside(before.video, before.viewport) && inside(before.toolbar, before.viewport) && before.tabs.every(x => inside(x.box, before.viewport)), before);
    check('normal-status-next-to-caption-switch-' + width, before.statusParent === 'head' && before.status.y >= before.head.y && before.status.bottom <= before.head.bottom + 1, before.status);
    check('normal-followalong-duplicate-hidden-' + width, before.recordButton.width === 0 && before.recordButton.height === 0, before.recordButton);
    await click(`${host}.querySelector('[data-pane=practice]')`);
    await waitFor('practice opened', () => page.cdp.evaluate(`!${el('practice')}.hidden`));
    const after = await measure(); evidence.sizes.push({ before, after });
    check('practice-visible-without-page-scroll-' + width, Math.abs(after.scrollY - before.scrollY) < 1 && inside(after.mic, after.viewport) && inside(after.start, after.viewport) && inside(after.original, after.viewport), after);
    check('same-player-position-on-practice-' + width, Math.abs(after.video.y - before.video.y) < 1 && Math.abs(after.video.height - before.video.height) < 1, { before: before.video, after: after.video });
    check('practice-in-right-host-' + width, after.practiceRoot === 'biliscript-japanese-study' && after.duplicateHosts === 1, after.practiceRoot);
    await screenshot(page.cdp, path.join(out, 'practice-' + width + '.png'));
    await click(`${host}.querySelector('[data-pane=subtitles]')`);
  }
  await worker.evaluate("chrome.storage.local.set({biliscriptStudyAppearance:{size:24,color:'#ffe595'}})");
  await waitFor('appearance propagated to current player', () => page.cdp.evaluate("(()=>{const e=document.getElementById('biliscript-study-overlay')?.shadowRoot?.querySelector('.ja');return !!e&&getComputedStyle(e).fontSize==='24px'&&getComputedStyle(e).color==='rgb(255, 229, 149)'})()"));
  check('appearance-applies-live-without-restarting-subtitles', true);
  await worker.evaluate(`(()=>{globalThis.__rootProofRequests=[];const originalFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith('https://root-review.invalid/v1/chat/completions')){const body=JSON.parse(options.body);globalThis.__rootProofRequests.push(body);return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({status:'suggested',suggestedText:'私たちの暮らしに広がる変化を取材しました。',reason:'人工测试建议，未经原声确认。'})}}]}),{status:200,headers:{'content-type':'application/json'}})}return originalFetch(url,options)};return chrome.storage.local.set({biliscriptJapaneseSettings:{autoStart:false,autoTranslate:false,apiKey:'synthetic-root-review-only',model:'fixture',baseUrl:'https://root-review.invalid/v1'}})})()`);
  await sleep(300);
  const cueBase = `(()=>{const e=${el('rows')}.querySelector('[data-study-text]'),rubies=[...e.querySelectorAll('ruby')];return rubies.length?rubies.map(r=>r.firstChild.textContent).join(''):e.textContent})()`;
  const originalText = await page.cdp.evaluate(cueBase);
  const originalClock = await page.cdp.evaluate(`${el('rows')}.querySelector('.cue-time').textContent`);
  await click(`${el('rows')}.querySelector('.cue-proofread')`);
  await waitFor('proofreading suggestion ready', () => page.cdp.evaluate(`!!${el('detail')}.querySelector('.proof-apply')`));
  check('suggestion-does-not-automatically-edit-subtitle', await page.cdp.evaluate(cueBase) === originalText);
  await click(`${el('detail')}.querySelector('.proof-apply')`);
  await waitFor('adopted correction in subtitle', () => page.cdp.evaluate(cueBase).then(text => text === '私たちの暮らしに広がる変化を取材しました。'));
  check('adopt-keeps-original-timestamp', await page.cdp.evaluate(`${el('rows')}.querySelector('.cue-time').textContent`) === originalClock);
  check('bilingual-off-correction-does-not-start-translation', await worker.evaluate('globalThis.__rootProofRequests.length') === 1);
  await screenshot(page.cdp, path.join(out, 'proofreading-adopted.png'));
  await click(`${el('detail')}.querySelector('.proof-restore')`);
  check('restore-returns-original-subtitle', await page.cdp.evaluate(cueBase) === originalText);
  await page.cdp.send('Runtime.evaluate', { expression: "document.querySelector('video').closest('.bpx-player-container').requestFullscreen()", userGesture: true, awaitPromise: true, returnByValue: true });
  await waitFor('fullscreen layout', () => page.cdp.evaluate("!!document.fullscreenElement")); await sleep(500);
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 150, y: 150 });
  const fullscreen = await measure(); evidence.fullscreen = fullscreen;
  check('fullscreen-status-inside-toolbar-first', await page.cdp.evaluate(`${el('status')}.parentElement.classList.contains('toolbar')&&${el('status')}.parentElement.firstElementChild===${el('status')}`));
  check('fullscreen-record-entry-retained', fullscreen.recordButton.width > 0 && fullscreen.recordButton.height > 0, fullscreen.recordButton);
  check('fullscreen-size-color-retained', await page.cdp.evaluate("(()=>{const e=document.getElementById('biliscript-study-overlay').shadowRoot.querySelector('.ja');return getComputedStyle(e).fontSize==='24px'&&getComputedStyle(e).color==='rgb(255, 229, 149)'})()"));
  await click(el('record')); await waitFor('same practice node in fullscreen', () => page.cdp.evaluate(`${el('practice')}.getRootNode().host.id==='biliscript-study-controls'&&!${el('practice')}.hidden`));
  check('fullscreen-practice-reuses-node', true);
  await screenshot(page.cdp, path.join(out, 'fullscreen-practice.png'));
  await page.cdp.evaluate('document.exitFullscreen()'); await sleep(500);
  check('exit-fullscreen-restores-status-header', await page.cdp.evaluate(`${el('status')}.parentElement.classList.contains('head')`));
} catch (error) { evidence.error = String(error.stack); console.error(error.message); process.exitCode = 1; try { await screenshot(page.cdp, path.join(out, 'failure.png')); } catch {} }
finally { evidence.failed = checks.filter(x => !x.ok); await writeEvidence(out, evidence); try { await page?.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause())"); } catch {} await teardown({ browser, cdps }); }
