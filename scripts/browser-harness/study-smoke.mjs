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
const auditAssociation = process.argv.includes("--audit-association");
const nativeE2e = process.argv.includes("--native-e2e");
const finalDist = process.argv.includes("--final-dist");
const nativeStaleOnly = process.argv.includes("--native-stale-only");
const requestedUrl = process.argv.find((arg) => arg.startsWith("--public-url="))?.slice("--public-url=".length);
const approvedPublicUrls = ["https://www.bilibili.com/video/BV1Qtnt6JEy8/", "https://www.bilibili.com/video/BV1wYAmeqEuV/"];
if (requestedUrl && !approvedPublicUrls.includes(requestedUrl)) throw new Error("Public URL is outside the explicitly approved pair");
const out = artifactDir(nativeStaleOnly ? "japanese-study-native-stale-2.6.3.3" : nativeE2e ? finalDist ? "japanese-study-native-e2e-final-2.6.3.3" : "japanese-study-native-e2e-2.6.3.3" : auditAssociation ? "japanese-study-audio-association" : inspectPageState ? "japanese-study-native-state" : fixtureOnly ? "japanese-study-fixture" : realOnly ? "japanese-study-real-news" : "japanese-study");
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
const domState = `(() => { const h=document.getElementById('biliscript-japanese-study'),s=h?.shadowRoot,t=document.getElementById('biliscript-study-controls')?.shadowRoot||s;
 return {host:!!h,visible:!!h&&getComputedStyle(h).display!=='none',status:t?.getElementById('status')?.textContent,
 show:t?.getElementById('show')?.textContent,enable:s?.getElementById('enable')?.textContent,
 current:s?.getElementById('current')?.textContent,chinese:s?.getElementById('chinese')?.textContent,
 position:t?.getElementById('position')?.textContent,overlay:!!document.getElementById('biliscript-study-overlay')}; })()`;
async function click(selector, shadow = true) {
  const target = shadow ? `(document.getElementById('biliscript-japanese-study')?.shadowRoot?.querySelector(${JSON.stringify(selector)})||document.getElementById('biliscript-study-controls')?.shadowRoot?.querySelector(${JSON.stringify(selector)}))`
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
  if (nativeE2e || nativeStaleOnly) check("native-version-2.6.3.3", ext.version === "2.6.3.3");
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
  const observedRequests = new Map(), observedAudioResponses = [];
  if (auditAssociation) {
    await page.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const key=()=>{const u=new URL(location.href);return (u.pathname.match(/\\/video\\/(BV[0-9A-Za-z]+)/)?.[1]||'')+':'+(u.searchParams.get('p')||1)};
      const audit=window.__studyAssociationAudit={documentId:crypto.randomUUID(),timeOrigin:performance.timeOrigin,routeEpoch:0,routeKey:key()};
      const update=()=>{const next=key();if(next!==audit.routeKey){audit.routeEpoch++;audit.routeKey=next}};
      for(const name of ['pushState','replaceState']){const original=history[name];history[name]=function(...args){const result=original.apply(this,args);update();return result}}
      addEventListener('popstate',update);
    })()` });
    page.cdp.on("Network.requestWillBeSent", (event) => {
      // Full URLs remain in this process's volatile memory solely for equality.
      // Neither this map nor candidate URLs are ever passed to writeEvidence/log.
      try {
        const u = new URL(event.request.url);
        if (["bilivideo.com", "bilivideo.cn"].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) {
          const document = new URL(event.documentURL);
          observedRequests.set(event.requestId, { url: event.request.url, loaderId: event.loaderId, frameId: event.frameId,
            documentRouteKey: (document.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] || "") + ":" + (document.searchParams.get("p") || 1),
            timestamp: event.timestamp, wallTime: event.wallTime });
        }
      } catch {}
    });
    page.cdp.on("Network.responseReceived", (event) => {
      const request = observedRequests.get(event.requestId);
      if (request && event.response.status === 206) observedAudioResponses.push({ ...request, responseUrl: event.response.url,
        responseLoaderId: event.loaderId, status: event.response.status, mimeType: event.response.mimeType, timestamp: event.timestamp });
    });
  }
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
  const localResponseIds = new Map(), localResponses = [];
  if (nativeE2e) {
    await worker.evaluate(`(() => {
      globalThis.__studyHarnessStopCounts={stopAi:0,cancelWindow:0};
      chrome.runtime.onMessage.addListener(message=>{if(message?.type==='study-stop-ai')globalThis.__studyHarnessStopCounts.stopAi++;
        if(message?.type==='study-local-asr'&&message.action==='cancel')globalThis.__studyHarnessStopCounts.cancelWindow++;});
      return true;
    })()`);
    await realWorker.cdp.send("Network.enable", {}, realWorker.sessionId);
    realWorker.cdp.on("Network.responseReceived", (event, eventSessionId) => {
      if ((eventSessionId || null) !== (realWorker.sessionId || null)) return;
      try { const u = new URL(event.response.url); if (u.origin === "http://127.0.0.1:18766" && u.pathname === "/v1/audio/window")
        localResponseIds.set(event.requestId, { status: event.response.status }); } catch {}
    });
    realWorker.cdp.on("Network.loadingFinished", async (event, eventSessionId) => {
      if ((eventSessionId || null) !== (realWorker.sessionId || null) || !localResponseIds.has(event.requestId)) return;
      try {
        const result = await realWorker.cdp.send("Network.getResponseBody", { requestId: event.requestId }, realWorker.sessionId);
        const raw = JSON.parse(result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body);
        const segments = Array.isArray(raw.segments) ? raw.segments.map((row) => ({ start: row.start, end: row.end, text: row.text })) : [];
        localResponses.push({ ...localResponseIds.get(event.requestId), timestampOrigin: raw.timestamp_origin,
          segments, segmentCount: segments.length, errorCode: raw.error?.code });
      } catch (error) { localResponses.push({ ...localResponseIds.get(event.requestId), bodyReadError: safeError(error) }); }
    });
  }
  realWorker.cdp.on("Fetch.requestPaused", async (event, eventSessionId) => {
    if ((eventSessionId || null) !== (realWorker.sessionId || null)) return;
    try {
      const body = JSON.parse(event.request.postData || "{}");
      const allowed = Number(body.start) < 30;
      realWindows.push({ start: body.start, duration: body.duration, language: body.language, model: body.model, forwardedToService: allowed });
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
  if (nativeStaleOnly) {
    const nativeSnapshot = () => worker.evaluate(`(async () => {
      const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url&&t.url.includes('/video/BV1wYAmeqEuV/'));
      if(!tab?.id)return {status:'unavailable',reason:'HARNESS_TAB'};
      const result=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:async()=>{
        const r=await chrome.runtime.sendMessage({type:'study-native-source'});
        return r?.status==='ready'?{status:r.status,subtitleListPresent:r.subtitleListPresent,japaneseTrackCount:r.japaneseTrackCount,
          duration:r.duration,playableDuration:r.playableDuration,binding:{routeEpoch:r.binding?.routeEpoch,videoGeneration:r.binding?.videoGeneration},
          audit:{requestStart:r.audit?.requestStart,epochStart:r.audit?.epochStart,videoEpoch:r.audit?.videoEpoch,responseStatus:r.audit?.responseStatus}}:
          {status:r?.status,reason:r?.reason,message:r?.message};
      }});return result[0]?.result;
    })()`);
    const markerSnapshot = () => page.cdp.evaluate(`(() => {
      const s=window.__BILISCRIPT_STUDY_ROUTE_V2__,audio=window.__playinfo__?.data?.dash?.audio||[];
      const urls=audio.flatMap(t=>[t.baseUrl,t.base_url,...(Array.isArray(t.backupUrl)?t.backupUrl:[]),...(Array.isArray(t.backup_url)?t.backup_url:[])]).filter(x=>typeof x==='string');
      const entries=performance.getEntriesByType('resource').filter(r=>urls.includes(r.name)&&r.responseStatus===206);
      return {routeEpoch:s?.routeEpoch,epochStart:s?.epochStart,videoGeneration:s?.videoGeneration,videoEpoch:s?.videoEpoch,
        pageIndex:Number(new URL(location.href).searchParams.get('p')||1),candidate206Count:entries.length,
        candidate206AfterEpochCount:entries.filter(e=>e.startTime>=s.epochStart).length,
        latestCandidate206Start:entries.length?Math.max(...entries.map(e=>e.startTime)):null};
    })()`);
    const baseline = await nativeSnapshot(), baselineMarker = await markerSnapshot();
    check("native-stale-baseline-ready", baseline?.status === "ready", { baseline, marker: baselineMarker });
    if (baseline?.status !== "ready") throw new Error("Native baseline not ready; synthetic route test cannot start");
    const blockedAudio = [];
    page.cdp.on("Fetch.requestPaused", async ({ requestId }) => {
      blockedAudio.push({ interceptedDuringSyntheticRouteTest: true });
      await page.cdp.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => {});
    });
    await page.cdp.send("Fetch.enable", { patterns: [{ urlPattern: "https://*.bilivideo.com/*" }, { urlPattern: "https://*.bilivideo.cn/*" }, { urlPattern: "https://upos-hz-mirrorakam.akamaized.net/*" }] });
    // Explicit synthetic history-only A -> B -> A. No network navigation or
    // different video is requested, and CDN requests are blocked before transfer.
    await page.cdp.evaluate("(()=>{const u=new URL(location.href);u.searchParams.set('p','2');history.pushState({syntheticStudyAcceptance:true},'',u);})()");
    const atB = await nativeSnapshot(), markerB = await markerSnapshot();
    check("synthetic-P2-rejects-old-CID", atB?.status === "unavailable" && atB.reason === "CID" && markerB.routeEpoch > baselineMarker.routeEpoch,
      { native: atB, marker: markerB });
    await page.cdp.evaluate("(()=>{const u=new URL(location.href);u.searchParams.delete('p');history.pushState({syntheticStudyAcceptance:true},'',u);})()");
    const backAtA = await nativeSnapshot(), markerA2 = await markerSnapshot();
    check("synthetic-A-B-A-rejects-stale-performance", backAtA?.status === "unavailable" && backAtA.reason === "NO_PLAYED_AUDIO" &&
      markerA2.routeEpoch > markerB.routeEpoch && markerA2.candidate206AfterEpochCount === 0 && markerA2.latestCandidate206Start < markerA2.epochStart,
      { native: backAtA, marker: markerA2 });
    evidence.syntheticRouteStale = { synthetic: true, method: "history.pushState only; same BV; P1 -> P2 -> P1", audioFetchBlockedBeforeTransfer: true,
      baseline, baselineMarker, atB, markerB, backAtA, markerA2, blockedAudioAttempts: blockedAudio.length,
      learnedOrTranscribed: false, anotherVideoVisited: false };
    await snap("02-synthetic-route-stale-rejected");
    await page.cdp.send("Fetch.disable");
  }
  if (inspectPageState || auditAssociation) {
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
  if (auditAssociation) {
    const frame = (await page.cdp.send("Page.getFrameTree")).frameTree.frame;
    const before = await page.cdp.evaluate("({...window.__studyAssociationAudit})");
    // Private transport object: contains candidate URLs in memory only. Project
    // every persisted field explicitly below; do not attach this object to evidence.
    const transient = await page.cdp.evaluate(`(() => {
      const v=window.__INITIAL_STATE__?.videoData,d=window.__playinfo__?.data,u=new URL(location.href),p=Number(u.searchParams.get('p')||1);
      const page=Array.isArray(v?.pages)?v.pages.find(x=>Number(x.page)===p):null,cid=String(page?.cid||(p===1?v?.cid:'')||'');
      const resources=performance.getEntriesByType('resource');
      const candidates=(Array.isArray(d?.dash?.audio)?d.dash.audio:[]).map((t,index)=>({index,
        urls:[t.baseUrl,t.base_url,...(Array.isArray(t.backupUrl)?t.backupUrl:[]),...(Array.isArray(t.backup_url)?t.backup_url:[])].filter(x=>typeof x==='string'),
        bandwidth:typeof t.bandwidth==='number'?t.bandwidth:null}));
      const video=document.querySelector('video'),media=video?{sourceKind:video.currentSrc.startsWith('blob:')?'blob':video.currentSrc.startsWith('http')?'http':video.currentSrc?'other':'empty',
        currentTime:video.currentTime,duration:video.duration,paused:video.paused,readyState:video.readyState,
        buffered:Array.from({length:video.buffered.length},(_,i)=>[video.buffered.start(i),video.buffered.end(i)]),
        seekable:Array.from({length:video.seekable.length},(_,i)=>[video.seekable.start(i),video.seekable.end(i)])}:null;
      const text=document.body?.innerText||'',preview=text.match(/试看\\s*(\\d+)\\s*秒/);
      const selector=e=>e.tagName.toLowerCase()+(e.id?'#'+CSS.escape(e.id):[...e.classList].map(c=>'.'+CSS.escape(c)).join(''));
      const previewDom=[...document.querySelectorAll('*')].filter(e=>e.childElementCount===0&&/试看\\s*\\d+\\s*秒/.test(e.textContent||'')).map(e=>{
        const r=e.getBoundingClientRect(),host=e.closest('.bpx-player-container'),ancestors=[];let n=e;
        for(let i=0;n&&i<5;i++,n=n.parentElement)ancestors.push(selector(n));
        return {selector:selector(e),parentSelector:e.parentElement?selector(e.parentElement):null,text:e.textContent.trim().slice(0,80),
          parentText:e.parentElement?.textContent?.trim().slice(0,160),insideBpxPlayerContainer:!!host,visible:r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden',
          rectangle:{width:r.width,height:r.height},ancestors}});
      const previewFields=[];const scan=(obj,loc,depth)=>{if(!obj||typeof obj!=='object'||depth>3)return;for(const [key,value] of Object.entries(obj)){
        if(['dash','durl','audio','video','backupUrl','backup_url','baseUrl','base_url'].includes(key))continue;
        if(/preview|trial|watch_time|limit|timelength|duration/i.test(key)&&['number','boolean'].includes(typeof value))previewFields.push({field:loc+'.'+key,value});
        else if(value&&typeof value==='object'&&!Array.isArray(value))scan(value,loc+'.'+key,depth+1)}};
      scan(d,'playinfo.data',0);scan(v?.rights,'videoData.rights',0);
      return {routeKey:(u.pathname.match(/\\/video\\/(BV[0-9A-Za-z]+)/)?.[1]||'')+':'+p,cid,bvidMatches:v?.bvid===u.pathname.match(/\\/video\\/(BV[0-9A-Za-z]+)/)?.[1],
        candidates,resources:resources.map(r=>({name:r.name,startTime:r.startTime,duration:r.duration,responseEnd:r.responseEnd,initiatorType:r.initiatorType,
          responseStatusAvailable:'responseStatus' in r,responseStatus:typeof r.responseStatus==='number'?r.responseStatus:null})),
        media,declaredPreviewSeconds:preview?Number(preview[1]):null,loginRequiredMessagePresent:/请先登录|登录.*试看|试看.*登录/.test(text),previewFields,previewDom,
        audit:{...window.__studyAssociationAudit},performanceTimeOrigin:performance.timeOrigin};
    })()`);
    const sameDocument = before.documentId === transient.audit?.documentId && before.timeOrigin === transient.performanceTimeOrigin;
    const sameRoute = before.routeKey === transient.routeKey && before.routeEpoch === transient.audit?.routeEpoch;
    const pathCid = (url) => {
      try { const match = new URL(url).pathname.match(/\/upgcxcode\/[^/]+\/[^/]+\/(\d+)\/(\d+)-/); return match && match[1] === match[2] ? match[1] : null; }
      catch { return null; }
    };
    const tracks = transient.candidates.map((candidate) => {
      const urls = [...new Set(candidate.urls)];
      const performanceMatches = transient.resources.filter((resource) => urls.includes(resource.name) && resource.startTime >= 0);
      const anyNetworkMatches = observedAudioResponses.filter((response) => urls.includes(response.responseUrl));
      const networkMatches = observedAudioResponses.filter((response) => urls.includes(response.responseUrl) && response.loaderId === frame.loaderId &&
        response.responseLoaderId === frame.loaderId && response.frameId === frame.id && response.documentRouteKey === transient.routeKey);
      return { candidateIndex: candidate.index, bandwidth: candidate.bandwidth, distinctUrlCount: urls.length,
        allUrlPathsCarrySelectedCid: urls.length > 0 && urls.every((url) => pathCid(url) === transient.cid),
        exactPerformanceUrlMatchCount: performanceMatches.length, exactSameDocument206UrlMatchCount: networkMatches.length,
        exactPerformance206MatchCount: performanceMatches.filter((entry) => entry.responseStatusAvailable && entry.responseStatus === 206).length,
        exactPerformanceEntrySamples: performanceMatches.slice(0,8).map(({startTime,duration,responseEnd,initiatorType,responseStatusAvailable,responseStatus})=>({startTime,duration,responseEnd,initiatorType,responseStatusAvailable,responseStatus})),
        exact206UrlMatchCount: anyNetworkMatches.length,
        exact206CurrentRequestLoaderMatchCount: anyNetworkMatches.filter((response) => response.loaderId === frame.loaderId).length,
        exact206CurrentResponseLoaderMatchCount: anyNetworkMatches.filter((response) => response.responseLoaderId === frame.loaderId).length,
        exact206CurrentMainFrameMatchCount: anyNetworkMatches.filter((response) => response.frameId === frame.id).length,
        exact206CurrentRouteMatchCount: anyNetworkMatches.filter((response) => response.documentRouteKey === transient.routeKey).length,
        exact206WithinDocumentWallTimeCount: anyNetworkMatches.filter((response) => response.wallTime * 1000 >= transient.performanceTimeOrigin).length,
        exact206EmptyRequestLoaderCount: anyNetworkMatches.filter((response) => !response.loaderId).length,
        exact206EmptyResponseLoaderCount: anyNetworkMatches.filter((response) => !response.responseLoaderId).length,
        exact206MimeTypes: [...new Set(anyNetworkMatches.map((response) => response.mimeType))],
        exactSameDocumentRequestUrlMatchCount: networkMatches.filter((response) => urls.includes(response.url)).length,
        performanceMatchesWithinDocumentLifetime: performanceMatches.every((entry) => entry.startTime >= 0),
        requestWallTimesWithinDocumentLifetime: networkMatches.every((entry) => entry.wallTime * 1000 >= transient.performanceTimeOrigin),
        observed206MimeTypes: [...new Set(networkMatches.map((response) => response.mimeType))],
        linkedByBothPerformanceAndCurrentDocument206: performanceMatches.length > 0 && networkMatches.length > 0 };
    });
    evidence.audioAssociationAudit = { readOnly: true, learnedOrTranscribed: false, currentBvidMatchesNativeMetadata: transient.bvidMatches,
      currentPageCidPresent: !!transient.cid, documentStable: sameDocument, routeEpochStable: sameRoute, routeEpoch: transient.audit?.routeEpoch,
      timeOriginMatchesDocumentMarker: transient.performanceTimeOrigin === transient.audit?.timeOrigin,
      candidateTrackCount: tracks.length, tracks, media: transient.media, declaredPreviewSeconds: transient.declaredPreviewSeconds,
      loginRequiredMessagePresent: transient.loginRequiredMessagePresent, previewFields: transient.previewFields,
      previewDom: transient.previewDom,
      observedPlayedTimeWithinDeclaredPreview: transient.declaredPreviewSeconds === null ? null : transient.media?.currentTime <= transient.declaredPreviewSeconds,
      safeTestWindowEnd: transient.declaredPreviewSeconds === null ? null : Math.min(30, transient.declaredPreviewSeconds),
      independentlyVerifiedPlayinfoIdentityFields: false,
      strongAssociationCandidateCount: tracks.filter((track) => transient.bvidMatches && sameDocument && sameRoute && track.allUrlPathsCarrySelectedCid &&
        track.linkedByBothPerformanceAndCurrentDocument206 && track.requestWallTimesWithinDocumentLifetime).length,
      performanceAndFresh206AssociationCandidateCount: tracks.filter((track) => transient.bvidMatches && sameDocument && sameRoute && track.allUrlPathsCarrySelectedCid &&
        track.exactPerformanceUrlMatchCount > 0 && track.exact206WithinDocumentWallTimeCount > 0).length,
      performance206AssociationCandidateCount: tracks.filter((track) => transient.bvidMatches && sameDocument && sameRoute && track.allUrlPathsCarrySelectedCid &&
        track.exactPerformance206MatchCount > 0).length,
      limitations: ["No seek or playback beyond the displayed anonymous preview was attempted.", "Buffered/seekable duration does not authorize content beyond the UI preview.", "This read-only observation does not test SPA stale-object rejection or signed URL expiry."] };
    check("current-document-performance206-association", evidence.audioAssociationAudit.performance206AssociationCandidateCount > 0,
      { candidates: tracks.length, strictLoaderLinkedCandidates: evidence.audioAssociationAudit.strongAssociationCandidateCount,
        performance206LinkedCandidates: evidence.audioAssociationAudit.performance206AssociationCandidateCount, declaredPreviewSeconds: transient.declaredPreviewSeconds });
    await snap("03-audio-association-read-only");
  }
  if (realState.videoCount) check("real-playable-page-content-script", realState.study?.host, { path: realState.path, duration: realState.media?.duration });
  if (realState.study?.host && !inspectPageState && !auditAssociation && !nativeStaleOnly) {
    check("real-page-learning-default-off", realState.study.enable === "开启学习" && !realState.study.overlay, realState.study);
    await click("#show");
    await waitFor("real first-window result or explicit failure", async () => {
      const state = await page.cdp.evaluate(domState);
      return state.overlay || /字幕已准备|字幕已就绪|失败|未启动|无法|风控/.test(state.status || "");
    }, { timeoutMs: 25000, intervalMs: 300 }).catch((error) => { evidence.realPublicPage.waitError = safeError(error); });
    await pause();
    if(nativeE2e){
      const hasRows=await page.cdp.evaluate("!!document.getElementById('biliscript-japanese-study')?.shadowRoot?.querySelector('.cue-time')");
      if(hasRows){await click('.cue-time');await sleep(350);await pause()}
    }
    if (nativeE2e) await sleep(300);
    evidence.realPublicPage.enabled = await page.cdp.evaluate(`({study:(${domState}),source:document.getElementById('biliscript-japanese-study')?.shadowRoot?.getElementById('source')?.textContent,
      rows:[...document.getElementById('biliscript-japanese-study')?.shadowRoot?.querySelectorAll('.cue')||[]].slice(0,5).map(e=>e.textContent)})`);
    evidence.realPublicPage.localWindows = realWindows;
    if (nativeE2e) {
      evidence.realPublicPage.localResponses = localResponses;
      evidence.realPublicPage.nativeEpoch = await page.cdp.evaluate(`(() => {const s=window.__BILISCRIPT_STUDY_ROUTE_V2__;return s?{
        version:s.version,routeEpoch:s.routeEpoch,epochStart:s.epochStart,videoGeneration:s.videoGeneration,videoEpoch:s.videoEpoch,
        active:s.active,previewLimit:s.previewLimit,previewUnknown:s.previewUnknown,videoConnected:!!s.video?.isConnected,videoBindingTagPresent:!!s.video?.getAttribute('data-biliscript-study-binding'),
        sourceKind:s.mediaSrc?.startsWith('blob:')?'blob':s.mediaSrc?'other':'empty'}:null})()`);
      check("real-native-30s-Japanese-segments", localResponses.some((r) => r.status === 200 && r.timestampOrigin === "absolute" &&
        r.segments?.length > 0 && r.segments.every((s) => s.start >= 0 && s.end <= 30) && r.segments.some((s) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(s.text || ""))),
        { windows: realWindows.length, responses: localResponses.map((r) => ({ status: r.status, segmentCount: r.segmentCount, errorCode: r.errorCode })) });
    }
    if (diagnose) {
      evidence.realPublicPage.apiDiagnostics = await page.cdp.evaluate("window.__studyHarnessApi || []");
      evidence.realPublicPage.scriptingDiagnostics = await worker.evaluate("globalThis.__studyHarnessScripting || []");
    }
    check("real-first-caption", evidence.realPublicPage.enabled.study.overlay || evidence.realPublicPage.enabled.rows.length > 0,
      { status: evidence.realPublicPage.enabled.study.status, source: evidence.realPublicPage.enabled.source });
    check("real-preview-boundary-respected", realWindows.filter((w) => w.forwardedToService).every((w) => w.start >= 0 && w.start + w.duration <= 30), realWindows);
    await snap("02-real-public-page");
    await click("#enable"); await pause();
    if (nativeE2e) {
      await sleep(600);
      const closed = await page.cdp.evaluate(domState);
      const stopMessages = await worker.evaluate("({...globalThis.__studyHarnessStopCounts})");
      evidence.realPublicPage.closed = { study: closed, stopMessages,
        windowRequestCountAfterClose: realWindows.length, finishedResponseCount: localResponses.filter((r) => r.status === 200 && r.segmentCount > 0).length,
        noInFlightWindowAtClose: localResponses.filter((r) => r.status === 200 && r.segmentCount > 0).length === realWindows.filter((w) => w.forwardedToService).length };
      check("real-native-overlay-visible", evidence.realPublicPage.enabled.study.overlay === true);
      check("real-close-clears-overlay-and-stops", closed.enable === "开启学习" && closed.overlay === false && stopMessages.stopAi >= 2,
        { enable: closed.enable, overlay: closed.overlay, stopMessages });
      check("real-only-one-preview-window", realWindows.length === 1 && realWindows[0].start === 0 && realWindows[0].duration === 30,
        { windows: realWindows.length, responses: localResponses.length });
      await snap("03-real-stopped");
    }
  } else if (!inspectPageState && !auditAssociation && !nativeStaleOnly) {
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
