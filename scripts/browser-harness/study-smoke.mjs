// Isolated study acceptance. Uses the repository's browser harness only.
// Fixture phases are explicitly synthetic; no authenticated user profile is read.
import path from "node:path";
import { mkdir, realpath, readFile, access } from "node:fs/promises";
import { REPO_ROOT, launchBrowser, attachPage, createWorkerSession, screenshot,
  teardown, waitFor, sleep, writeEvidence, artifactDir, log } from "./harness.mjs";

const distDir = path.join(REPO_ROOT, "dist-study");
const tempRoot = path.resolve(REPO_ROOT, ".scratch", "browser-temp");
const fixtureOnly = process.argv.includes("--fixture-only");
const realOnly = process.argv.includes("--real-only");
const diagnose = process.argv.includes("--diagnose");
const inspectPageState = process.argv.includes("--inspect-page-state");
const requestedUrl = process.argv.find((arg) => arg.startsWith("--public-url="))?.slice("--public-url=".length);
const approvedPublicUrls = ["https://www.bilibili.com/video/BV1Qtnt6JEy8/", "https://www.bilibili.com/video/BV1wYAmeqEuV/"];
if (requestedUrl && !approvedPublicUrls.includes(requestedUrl)) throw new Error("Public URL is outside the explicitly approved pair");
const out = artifactDir(inspectPageState ? "japanese-study-native-state" : fixtureOnly ? "japanese-study-fixture" : realOnly ? "japanese-study-real-news" : "japanese-study");
const wavFile = path.resolve(REPO_ROOT, "..", "..", "local-asr", "tests", "jsut-000.wav");
await mkdir(tempRoot, { recursive: true });
// Process-local environment only. os.tmpdir() in launchBrowser now stays on E:.
process.env.TEMP = tempRoot; process.env.TMP = tempRoot;
const checks = [], evidence = { scope: "isolated Edge; real public page then explicitly labelled fixtures", checks };
let browser, page, worker;
const cdps = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail: detail ?? null });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : " " + JSON.stringify(detail).slice(0, 300)}`);
};
const safeError = (error) => String(error?.message || error).replace(/https?:\/\/[^\s"']+/g, "[URL redacted]").slice(0, 450);
const pause = async () => page?.cdp.evaluate("document.querySelectorAll('video,audio').forEach(m=>m.pause())", { timeoutMs: 3000 }).catch(() => {});
const snap = (name) => screenshot(page.cdp, path.join(out, name + ".png"));
const domState = `(() => { const h=document.getElementById('biliscript-japanese-study'),s=h?.shadowRoot;
 return {host:!!h,visible:!!h&&getComputedStyle(h).display!=='none',status:s?.getElementById('status')?.textContent,
 show:s?.getElementById('show')?.textContent,enable:s?.getElementById('enable')?.textContent,
 current:s?.getElementById('current')?.textContent,chinese:s?.getElementById('chinese')?.textContent,
 position:s?.getElementById('position')?.textContent,overlay:!!document.getElementById('biliscript-study-overlay')}; })()`;
async function click(selector, shadow = true) {
  const target = shadow ? `document.getElementById('biliscript-japanese-study')?.shadowRoot?.querySelector(${JSON.stringify(selector)})`
    : `document.querySelector(${JSON.stringify(selector)})`;
  const point = await page.cdp.evaluate(`(() => {const e=${target};if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();
    const x=r.x+r.width/2,y=r.y+r.height/2;const root=e.getRootNode();return {x,y,w:r.width,h:r.height,hit:root.elementFromPoint(x,y)===e};})()`);
  if (!point?.hit || !point.w || !point.h) throw new Error(`Target has no clickable geometry: ${selector}`);
  await page.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

try {
  await access(wavFile);
  browser = await launchBrowser({ distDir, profilePrefix: "japanese-study-", muted: true, sync: false,
    extraArgs: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wavFile}`] });
  const actualProfile = await realpath(browser.profileDir), actualRoot = await realpath(tempRoot);
  const relative = path.relative(actualRoot, actualProfile);
  check("profile-contained-on-E", path.isAbsolute(actualProfile) && actualProfile.toLowerCase().startsWith("e:") && relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  if (!checks.at(-1).ok) throw new Error("Unexpected profile location; teardown deletion refused");
  evidence.browser = { version: browser.version.Browser, ownPid: browser.pid, temporaryProfile: actualProfile, muted: browser.muted, sync: browser.sync };
  page = await attachPage(browser); cdps.push(page.cdp);
  worker = createWorkerSession({ pageCdp: page.cdp, browser, distDir });
  if (!(await worker.ensureAlive())) throw new Error("Study service worker could not be attached");
  cdps.push(worker.handle.cdp);
  const ext = await worker.evaluate("({id:chrome.runtime.id,version:chrome.runtime.getManifest().version,name:chrome.runtime.getManifest().name,listeners:chrome.runtime.onMessage.hasListeners()})");
  check("study-extension-loaded", ext.name === "BiliScript 日语学习" && worker.handle.url.endsWith("/entry/study-background.js") && ext.listeners, { name: ext.name, version: ext.version });
  evidence.extension = ext;
  await page.cdp.send("Page.navigate", { url: `chrome-extension://${ext.id}/study/options.html` });
  await waitFor("study settings page", () => page.cdp.evaluate("document.getElementById('autoStart')!==null"));
  const config = await page.cdp.evaluate("chrome.runtime.sendMessage({type:'study-settings-public'}).then(r=>({ok:r?.ok,autoStart:r?.config?.autoStart,autoTranslate:r?.config?.autoTranslate,configured:r?.config?.configured,asrModel:r?.config?.asrModel}))");
  check("public-settings-no-key-default-off", config.ok && config.autoStart === false && config.configured === false && config.asrModel === "small", config);
  const health = await page.cdp.evaluate("chrome.runtime.sendMessage({type:'study-local-asr',action:'health',requestId:crypto.randomUUID()}).then(r=>({ok:r?.ok,status:r?.data?.status,model:r?.data?.default_model,device:r?.data?.backend?.device,error:r?.error?.code}))");
  evidence.health = health;
  await snap("01-isolated-settings");
  await writeEvidence(out, evidence);
  log("FIRST MILESTONE: extension/SW/settings verified in isolated E: profile");

  if (!fixtureOnly) {
  if (diagnose) {
    await worker.evaluate(`(() => {
      globalThis.__studyHarnessScripting=[];
      const original=chrome.scripting.executeScript.bind(chrome.scripting);
      chrome.scripting.executeScript=async(options)=>{
        try {const result=await original(options);globalThis.__studyHarnessScripting.push({world:options.world,result:result.map(r=>({ok:r.result?.ok,apiCode:r.result?.data?.code,exception:!!r.exceptionDetails}))});return result}
        catch(error){globalThis.__studyHarnessScripting.push({world:options.world,errorName:error.name,message:String(error.message).replace(/https?:\\/\\/[^\\s"']+/g,'[URL redacted]').slice(0,200)});throw error}
      };return true;
    })()`);
    await page.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      window.__studyHarnessApi=[];const original=window.fetch;
      window.fetch=async function(...args){const raw=args[0];let u;try{u=new URL(typeof raw==='string'?raw:raw.url,location.href)}catch{}
        const observed=u?.hostname==='api.bilibili.com'&&['/x/web-interface/view','/x/player/v2','/x/player/wbi/v2','/x/player/playurl'].includes(u.pathname);
        try{const response=await original.apply(this,args);if(observed){let code;try{code=(await response.clone().json())?.code}catch{}
          window.__studyHarnessApi.push({phase:u.pathname,status:response.status,apiCode:code})}return response}
        catch(error){if(observed)window.__studyHarnessApi.push({phase:u.pathname,errorName:error.name,message:String(error.message).replace(/https?:\\/\\/[^\\s"']+/g,'[URL redacted]').slice(0,200)});throw error}
      };
    })()` });
  }
  const realWindows = [];
  const realWorker = worker.handle;
  realWorker.cdp.on("Fetch.requestPaused", async (event, eventSessionId) => {
    if ((eventSessionId || null) !== (realWorker.sessionId || null)) return;
    try {
      const body = JSON.parse(event.request.postData || "{}");
      const allowed = Number(body.start) < 30;
      realWindows.push({ start: body.start, duration: body.duration, bvid: body.bvid, cid: body.cid, language: body.language, model: body.model, forwardedToService: allowed });
      if (!allowed) {
        // This public page advertises a 30s anonymous preview. Stop at that
        // boundary before the local service can fetch any later audio window.
        await realWorker.cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 499,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify({ error: { code: "PREVIEW_BOUNDARY", message: "Acceptance limited to the current 30-second preview" } })).toString("base64") }, realWorker.sessionId);
      } else await realWorker.cdp.send("Fetch.continueRequest", { requestId: event.requestId }, realWorker.sessionId);
    } catch (error) { evidence.realWindowInterceptError = safeError(error); }
  });
  await realWorker.cdp.send("Fetch.enable", { patterns: [{ urlPattern: "http://127.0.0.1:18766/v1/audio/window" }] }, realWorker.sessionId);
  // No authentication or security interstitial bypass. Read public page state.
  const publicUrl = requestedUrl || approvedPublicUrls[0];
  const responses = [];
  page.cdp.on("Network.responseReceived", ({ response, type }) => {
    try { const u = new URL(response.url); if (["Document", "XHR", "Fetch"].includes(type) && responses.length < 40)
      responses.push({ origin: u.origin, path: u.pathname, status: response.status }); } catch {}
  });
  await page.cdp.send("Page.navigate", { url: publicUrl });
  await sleep(5000); await pause();
  const realState = await page.cdp.evaluate(`({origin:location.origin,path:location.pathname,title:document.title,
    securityInterstitial:location.protocol==='chrome-error:'||!!document.querySelector('#main-frame-error'),
    excerpt:document.body?.innerText?.slice(0,300),videoCount:document.querySelectorAll('video').length,
    media:(()=>{const v=document.querySelector('video');return v?{duration:v.duration,currentTime:v.currentTime,paused:v.paused,readyState:v.readyState}:null})(),study:(${domState})})`);
  evidence.realPublicPage = { ...realState, responses, authenticatedProfileUsed: false, fixture: false };
  if (inspectPageState) {
    evidence.nativePageState = await page.cdp.evaluate(`(() => {
      const currentBvid=location.pathname.match(/\\/video\\/(BV[0-9A-Za-z]+)/)?.[1]||'',p=Number(new URL(location.href).searchParams.get('p')||1);
      const state=window.__INITIAL_STATE__,v=state?.videoData,play=window.__playinfo__,d=play?.data;
      const pages=Array.isArray(v?.pages)?v.pages:[],page=pages.find(x=>Number(x.page)===p),cid=page?.cid||(p===1?v?.cid:undefined);
      const same=(a,b)=>a!==undefined&&a!==null&&b!==undefined&&b!==null&&String(a)===String(b);
      const flags=obj=>Object.fromEntries(Object.entries(obj||{}).filter(([k,val])=>/preview|trial|timelength|duration|need_vip|is_vip|is_charge|pay|vip_type|vip_status|is_upower/i.test(k)&&['string','number','boolean'].includes(typeof val)).map(([k,val])=>[k,typeof val==='string'?val.slice(0,80):val]));
      const nativeTracks=v?.subtitle?.list||v?.subtitle?.subtitles;
      const playCid=d?.cid??play?.cid,playBvid=d?.bvid??play?.bvid;
      return {currentUrlBvidPresent:!!currentBvid,pageIndex:p,initialStateExists:!!state,videoDataExists:!!v,
        videoDataBvidPresent:!!v?.bvid,bvidMatchesCurrent:same(v?.bvid,currentBvid),videoDataCidPresent:!!v?.cid,
        currentPageCidPresent:cid!==undefined&&cid!==null,pageCount:pages.length,selectedPageFound:!!page,
        videoDataCidMatchesSelectedPage:same(v?.cid,cid),subtitleFieldExists:v?.subtitle!==undefined,
        subtitleListExists:Array.isArray(nativeTracks),subtitleTrackCount:Array.isArray(nativeTracks)?nativeTracks.length:null,
        japaneseTrackCount:Array.isArray(nativeTracks)?nativeTracks.filter(t=>/^(?:ai-)?(?:ja|jp)(?:[-_]|$)/i.test(t.lan||'')).length:null,
        videoFlags:flags(v),playinfoExists:!!play,playDataExists:!!d,dashExists:!!d?.dash,audioArrayExists:Array.isArray(d?.dash?.audio),
        audioTrackCount:Array.isArray(d?.dash?.audio)?d.dash.audio.length:null,
        playinfoBvidPresent:playBvid!==undefined,playinfoCidPresent:playCid!==undefined,
        playinfoBvidMatchesCurrent:playBvid===undefined?null:same(playBvid,currentBvid),playinfoCidMatchesSelectedPage:playCid===undefined?null:same(playCid,cid),
        playinfoFlags:flags(d),dashFlags:flags(d?.dash),identityConclusion:playCid===undefined||playBvid===undefined?'playinfo-has-no-independent-video-identity':'direct-fields-available'};
    })()`);
    await snap("02-native-page-state-read-only");
  }
  if (realState.videoCount) check("real-playable-page-content-script", realState.study?.host, { path: realState.path, duration: realState.media?.duration });
  if (realState.study?.host && !inspectPageState) {
    check("real-page-learning-default-off", realState.study.enable === "开启学习" && !realState.study.overlay, realState.study);
    await click("#show");
    await waitFor("real first-window result or explicit failure", async () => {
      const state = await page.cdp.evaluate(domState);
      return state.overlay || /失败|未启动|无法|风控/.test(state.status || "");
    }, { timeoutMs: 25000, intervalMs: 300 }).catch((error) => { evidence.realPublicPage.waitError = safeError(error); });
    await pause();
    evidence.realPublicPage.enabled = await page.cdp.evaluate(`({study:(${domState}),source:document.getElementById('biliscript-japanese-study')?.shadowRoot?.getElementById('source')?.textContent,
      rows:[...document.getElementById('biliscript-japanese-study')?.shadowRoot?.querySelectorAll('.cue')||[]].slice(0,5).map(e=>e.textContent)})`);
    evidence.realPublicPage.localWindows = realWindows;
    if (diagnose) {
      evidence.realPublicPage.apiDiagnostics = await page.cdp.evaluate("window.__studyHarnessApi || []");
      evidence.realPublicPage.scriptingDiagnostics = await worker.evaluate("globalThis.__studyHarnessScripting || []");
    }
    check("real-first-caption", evidence.realPublicPage.enabled.study.overlay || evidence.realPublicPage.enabled.rows.length > 0,
      { status: evidence.realPublicPage.enabled.study.status, source: evidence.realPublicPage.enabled.source });
    check("real-preview-boundary-respected", realWindows.filter((w) => w.forwardedToService).every((w) => w.start >= 0 && w.start + w.duration <= 30), realWindows);
    await snap("02-real-public-page");
    await click("#enable"); await pause();
  } else if (!inspectPageState) {
    log("Real public page blocked or content script unavailable; no security bypass attempted");
    await snap("02-real-public-page-blocked");
  }
  await realWorker.cdp.send("Fetch.disable", {}, realWorker.sessionId);
  await writeEvidence(out, evidence);
  }

  if (!realOnly) {
  // Explicit synthetic fixture: existing repository CC recordings + own player.
  const fixtureId = "BV1mAam6tEL8";
  const bundles = JSON.parse(await readFile(path.join(REPO_ROOT, "tests/fixtures/bilibili/bilingual-walkthrough/bundles.json"), "utf8"));
  const bodies = JSON.parse(await readFile(path.join(REPO_ROOT, "tests/fixtures/bilibili/bilingual-walkthrough/bodies.json"), "utf8"));
  const wav = (await readFile(wavFile)).toString("base64");
  const fixtureHtml = `<!doctype html><meta charset="utf-8"><title>EXPLICIT FIXTURE — Japanese Study</title>
    <style>body{margin:0;background:#e8eee9;font:18px system-ui}h1{font-size:18px;margin:12px}.bpx-player-container{position:relative;width:950px;height:610px;margin:18px;background:#16251d}.bpx-player-container:fullscreen{width:100vw;height:100vh;margin:0}video{width:100%;height:100%;object-fit:contain}#fixture-fullscreen{position:absolute;top:10px;left:10px}</style>
    <h1>合成验收页面 · 非真实 B站接口 / subtitles fixture</h1><div class="bpx-player-container"><video controls preload="auto" src="data:audio/wav;base64,${wav}"></video><button id="fixture-fullscreen" onclick="this.parentElement.requestFullscreen()">Fixture fullscreen</button></div>`;
  const meta = { code: 0, data: { bvid: fixtureId, aid: 117370433574328, cid: 42393338874, title: "EXPLICIT FIXTURE", pages: [{ page: 1, cid: 42393338874 }] } };
  // The proxy captures its fetch dependency at startup. Intercept its actual
  // network request rather than monkeypatching a later global fetch reference.
  const workerHandle = worker.handle;
  workerHandle.cdp.on("Fetch.requestPaused", async (event, eventSessionId) => {
    if ((eventSessionId || null) !== (workerHandle.sessionId || null)) return;
    try {
      const u = new URL(event.request.url);
      const key = u.pathname.split("/").pop().replace(/\.json$/, "");
      if (u.hostname.endsWith(".hdslb.com") && bodies[key]) {
        await workerHandle.cdp.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(bodies[key])).toString("base64") }, workerHandle.sessionId);
      } else await workerHandle.cdp.send("Fetch.continueRequest", { requestId: event.requestId }, workerHandle.sessionId);
    } catch (error) { evidence.fixtureWorkerInterceptError = safeError(error); }
  });
  await workerHandle.cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://*.hdslb.com/bfs/ai_subtitle/walkthrough-fixture/*" }] }, workerHandle.sessionId);
  const fulfill = async (requestId, body, contentType) => page.cdp.send("Fetch.fulfillRequest", { requestId, responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: contentType }, { name: "Access-Control-Allow-Origin", value: "https://www.bilibili.com" }, { name: "Access-Control-Allow-Credentials", value: "true" }], body: Buffer.from(body).toString("base64") });
  page.cdp.on("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const u = new URL(request.url);
      if (u.hostname === "www.bilibili.com" && u.pathname === `/video/${fixtureId}/`) await fulfill(requestId, fixtureHtml, "text/html;charset=utf-8");
      else if (u.hostname === "api.bilibili.com" && u.pathname === "/x/web-interface/view") await fulfill(requestId, JSON.stringify(meta), "application/json");
      else if (u.hostname === "api.bilibili.com" && /\/x\/player\/(?:wbi\/)?v2$/.test(u.pathname)) await fulfill(requestId, JSON.stringify(bundles[fixtureId]), "application/json");
      else await page.cdp.send("Fetch.continueRequest", { requestId });
    } catch (error) { evidence.fixtureInterceptError = safeError(error); }
  });
  await page.cdp.send("Fetch.enable", { patterns: [{ urlPattern: `https://www.bilibili.com/video/${fixtureId}/*` }, { urlPattern: "https://api.bilibili.com/*" }] });
  await page.cdp.send("Page.navigate", { url: `https://www.bilibili.com/video/${fixtureId}/` });
  await waitFor("fixture study shell", () => page.cdp.evaluate("!!document.getElementById('biliscript-japanese-study')"));
  await pause();
  check("fixture-default-off", (await page.cdp.evaluate(domState)).enable === "开启学习");
  await click("#show");
  await waitFor("fixture CC ready", async () => /日文字幕已就绪/.test((await page.cdp.evaluate(domState)).status || ""), { timeoutMs: 15000 });
  await page.cdp.evaluate("document.querySelector('video').currentTime=1;document.querySelector('video').pause()");
  await sleep(600);
  const fixtureState = await page.cdp.evaluate(`({study:(${domState}),overlay:(()=>{const e=document.getElementById('biliscript-study-overlay'),r=e?.getBoundingClientRect();return {text:e?.shadowRoot?.textContent,parent:e?.parentElement?.className,width:r?.width,height:r?.height};})(),geometry:(()=>{const h=document.getElementById('biliscript-japanese-study'),s=h.shadowRoot,r=s.querySelector('.panel').getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight};})()})`);
  evidence.fixture = { fixture: true, dataSource: "tests/fixtures/bilibili/bilingual-walkthrough", ...fixtureState };
  check("fixture-real-dom-japanese-chinese-overlay", fixtureState.overlay.width > 100 && fixtureState.overlay.height > 20 && fixtureState.overlay.text.includes("JA-1") && fixtureState.overlay.text.includes("中文第1段"), fixtureState.overlay);
  check("fixture-panel-in-viewport", fixtureState.geometry.width > 300 && fixtureState.geometry.right <= fixtureState.geometry.viewportWidth && fixtureState.geometry.bottom <= fixtureState.geometry.viewportHeight, fixtureState.geometry);
  await snap("03-fixture-japanese-chinese");
  await click("#next"); await pause(); await sleep(350);
  const nextState = await page.cdp.evaluate(`({study:(${domState}),time:document.querySelector('video').currentTime,paused:document.querySelector('video').paused})`);
  check("fixture-next-sentence-seeks-paused", nextState.time >= 2.4 && nextState.paused, nextState);
  await click("#prev"); await pause();
  await click("#fixture-fullscreen", false); await sleep(300); await pause();
  const fullscreen = await page.cdp.evaluate("({active:!!document.fullscreenElement,hostInFullscreen:document.fullscreenElement?.contains(document.getElementById('biliscript-japanese-study')),overlayInFullscreen:document.fullscreenElement?.contains(document.getElementById('biliscript-study-overlay'))})");
  check("fixture-player-fullscreen-container", fullscreen.active && fullscreen.hostInFullscreen && fullscreen.overlayInFullscreen, fullscreen);
  await snap("04-fixture-fullscreen");
  await page.cdp.evaluate("document.fullscreenElement&&document.exitFullscreen()");
  await sleep(200);

  // Real MediaRecorder, fed exclusively by Chromium fake-device flags and the
  // repository WAV. No physical microphone, external upload or saved recording.
  await click("#record");
  const recorderTarget = await waitFor("fake-microphone recorder tab", async () => {
    const targets = await page.cdp.send("Target.getTargets");
    return targets.targetInfos.find((t) => t.type === "page" && t.url.startsWith(`chrome-extension://${ext.id}/study/recorder.html`));
  });
  const recorderSession = (await page.cdp.send("Target.attachToTarget", { targetId: recorderTarget.targetId, flatten: true })).sessionId;
  await page.cdp.send("Runtime.enable", {}, recorderSession);
  const recorderEval = (expression) => page.cdp.evaluate(expression, { sessionId: recorderSession, timeoutMs: 8000 });
  async function recorderClick(selector) {
    const rect = await recorderEval(`(() => {const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height,disabled:e.disabled}:null})()`);
    if (!rect?.w || !rect.h || rect.disabled) throw new Error(`Recorder control unavailable: ${selector}`);
    await page.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 }, recorderSession);
    await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 }, recorderSession);
  }
  try {
    await waitFor("recorder reference session", () => recorderEval("document.getElementById('reference')?.textContent?.includes('JA-1')"));
    await recorderClick("#start");
    await waitFor("MediaRecorder recording", () => recorderEval("!document.getElementById('stop').disabled"), { timeoutMs: 8000 });
    await sleep(900);
    await recorderClick("#stop");
    await waitFor("MediaRecorder Blob ready", () => recorderEval("!document.getElementById('save').disabled"));
    const recorded = await recorderEval("(async()=>{const a=document.getElementById('audio'),b=await(await fetch(a.src)).blob();return {bytes:b.size,type:b.type,blobUrl:a.src.startsWith('blob:'),hidden:a.hidden,status:document.getElementById('status').textContent}})()");
    evidence.recorder = { fakeDeviceOnly: true, source: "local-asr/tests/jsut-000.wav", ...recorded };
    check("fake-mic-real-mediarecorder-blob", recorded.bytes > 1000 && recorded.blobUrl && !recorded.hidden, recorded);
    // A temporary harness button supplies a real user gesture to HTMLMediaElement
    // playback. Product audio source/controls/MediaRecorder remain unchanged.
    await recorderEval("(()=>{const b=document.createElement('button');b.id='harness-playback';b.textContent='Fixture playback';b.onclick=()=>document.getElementById('audio').play();document.querySelector('main').append(b)})()");
    await recorderClick("#harness-playback");
    await sleep(250);
    const played = await recorderEval("(()=>{const a=document.getElementById('audio'),r={paused:a.paused,currentTime:a.currentTime,readyState:a.readyState};a.pause();return r})()");
    evidence.recorder.playback = played;
    check("fake-mic-blob-replay", !played.paused && played.currentTime > 0, played);
    await screenshot({ send: (method, params) => page.cdp.send(method, params, recorderSession) }, path.join(out, "05-fake-mic-recorder.png"));
  } finally {
    await recorderEval("document.querySelectorAll('video,audio').forEach(m=>m.pause())").catch(() => {});
    await page.cdp.send("Target.closeTarget", { targetId: recorderTarget.targetId }).catch(() => {});
  }
  await click("#enable"); await pause(); await sleep(350);
  const stopped = await page.cdp.evaluate(domState);
  check("fixture-close-clears-overlay", stopped.enable === "开启学习" && !stopped.overlay, stopped);
  await snap("05-fixture-stopped");
  }
} catch (error) {
  if (page) {
    evidence.lastDom = await page.cdp.evaluate(domState, { timeoutMs: 3000 }).catch(() => null);
    await snap("failure").catch(() => {});
  }
  check("no-fatal", false, safeError(error));
} finally {
  await pause();
  if (browser?.profileDir) {
    const resolved = path.resolve(browser.profileDir), relative = path.relative(tempRoot, resolved);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      await teardown({ browser, cdps });
      check("own-profile-removed", !!browser.profileRemoved);
    } else {
      check("teardown-refused-outside-temp-root", false);
      for (const cdp of cdps) cdp.close();
      browser.child.kill();
    }
  }
  evidence.failed = checks.filter((item) => !item.ok).map((item) => item.name);
  await writeEvidence(out, evidence);
  if (evidence.failed.length) process.exitCode = 1;
}
