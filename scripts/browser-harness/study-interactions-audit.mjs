import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {REPO_ROOT,launchBrowser,attachPage,createWorkerSession,screenshot,teardown,waitFor,sleep,writeEvidence,artifactDir,log} from './harness.mjs';
const label=process.argv[2]||'2.6.4.0',out=artifactDir('study-interactions-'+label),distDir=path.join(REPO_ROOT,'dist-study'),temp=path.join(REPO_ROOT,'.scratch/browser-temp');
await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
let browser,page,worker;const cdps=[],checks=[],evidence={scope:'isolated Edge real Bilibili DOM and mouse gestures; imported subtitle/dictionary and AI transport fixtures; no paid provider calls or user profile access',checks,exceptions:[]};
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});if(!ok)throw new Error(name+': '+JSON.stringify(detail));log('PASS '+name)};
const host=`document.getElementById('biliscript-japanese-study').shadowRoot`,bar=`document.getElementById('biliscript-study-controls').shadowRoot`,entry=`document.getElementById('biliscript-study-entry').shadowRoot`,overlay=`document.getElementById('biliscript-study-overlay').shadowRoot`;
const el=id=>`(${host}.getElementById(${JSON.stringify(id)})||${bar}.getElementById(${JSON.stringify(id)})||${entry}.getElementById(${JSON.stringify(id)}))`;
async function click(expression){
 await page.cdp.evaluate(`(${expression}).scrollIntoView({block:'center',behavior:'instant'})`);await sleep(100);
 const p=await page.cdp.evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await page.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await sleep(100);
 for(const type of ['mousePressed','mouseReleased'])await page.cdp.send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await sleep(150);
}
async function gestures(root,start,end){
 await page.cdp.evaluate(`(${root}).scrollIntoView({block:'center',behavior:'instant'})`);await sleep(150);
 const points=await page.cdp.evaluate(`(()=>{const root=${root};const words=[...root.querySelectorAll('[role=button]')];const a=words.find(x=>x.querySelector('ruby')?.firstChild.textContent===${JSON.stringify(start)}),b=words.find(x=>x.querySelector('ruby')?.firstChild.textContent===${JSON.stringify(end)});if(!a||!b)return {words:words.map(x=>x.querySelector('ruby')?.firstChild.textContent)};const point=(el,right)=>{const node=el.querySelector('ruby').firstChild,r=document.createRange();r.selectNodeContents(node);const box=r.getBoundingClientRect();return {x:right?box.right-.3:box.left+.3,y:box.y+box.height*.65}};return {a:point(a,false),b:point(b,true)}})()`);
 if(!points.a)throw new Error('Missing gesture tokens '+JSON.stringify(points));
 await page.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...points.a});await page.cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...points.a,button:'left',clickCount:1});
 for(let n=1;n<=18;n++){await page.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.a.x+(points.b.x-points.a.x)*n/18,y:points.a.y+(points.b.y-points.a.y)*n/18,buttons:1});await sleep(18)}
 await page.cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...points.b,button:'left',clickCount:1});await sleep(250);
}
const ai=()=>worker.evaluate('globalThis.__studyAiFixture');
const pane=()=>page.cdp.evaluate(`${host}.querySelector('[data-pane].selected')?.dataset.pane`);
const detail=()=>page.cdp.evaluate(`${el('detail')}.textContent`);
async function screenshotAs(name){await screenshot(page.cdp,path.join(out,name+'.png'))}
try{
 browser=await launchBrowser({distDir,profilePrefix:'study-interactions-',muted:true,sync:false});page=await attachPage(browser);cdps.push(page.cdp);
 page.cdp.on('Runtime.exceptionThrown',e=>evidence.exceptions.push(e.exceptionDetails.text));
 worker=createWorkerSession({pageCdp:page.cdp,browser,distDir});if(!await worker.ensureAlive())throw new Error('No extension worker');cdps.push(worker.handle.cdp);
 await worker.evaluate(`(()=>{globalThis.__studyAiFixture=[];globalThis.__holdNext=0;const original=fetch;globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://api.deepseek.com/')){const body=JSON.parse(init.body),text=JSON.parse(body.messages.at(-1).content).text;globalThis.__studyAiFixture.push({text,system:body.messages[0].content});const delay=globalThis.__holdNext||0;globalThis.__holdNext=0;if(delay)await new Promise(r=>setTimeout(r,delay));return new Response(JSON.stringify({choices:[{message:{content:'## 夹具讲解\\n选中：'+text},finish_reason:'stop'}],usage:{completion_tokens:20}}),{headers:{'Content-Type':'application/json'}})}return original(url,init)}})()`);
 const route='BV1wYAmeqEuV:p1';
 await worker.evaluate(`chrome.storage.local.set(${JSON.stringify({biliscriptJapaneseSettings:{autoStart:true,autoTranslate:true,asrModel:'medium',baseUrl:'https://api.deepseek.com',model:'fixture-no-network',apiKey:'isolated-fixture-key'},biliscriptStudyDictionary:{'友達':{reading:'ともだち',meaning:'朋友'},'図書館':{reading:'としょかん',meaning:'图书馆'},'日本語':{reading:'にほんご',meaning:'日语'}},['biliscript-study-import:'+route]:{identity:route,name:'interaction-fixture.srt',offset:0,cues:[{start:0,end:20,text:'昨日、友達と図書館で日本語を勉強しました。'},{start:20,end:40,text:'今日は新しい本を読みます。'},{start:40,end:90,text:'一緒に日本語を練習しましょう。'}]}})})`);
 await page.cdp.send('Page.navigate',{url:'https://www.bilibili.com/zh-Hans/video/BV1wYAmeqEuV/'});
 await waitFor('native control entry',()=>page.cdp.evaluate("!!document.querySelector('.bpx-player-control-bottom-right #biliscript-study-entry')"),{timeoutMs:30000});
 await page.cdp.evaluate("document.querySelector('video').pause();document.querySelector('video').currentTime=1;window.scrollTo(0,0)");
 check('legacy-auto-start-and-translation-flags-do-not-enable',await page.cdp.evaluate(`!document.getElementById('biliscript-study-controls').hasAttribute('data-enabled')`));
 const header=await waitFor('native navigation text',async()=>{const text=await page.cdp.evaluate("document.querySelector('.bili-header')?.textContent||''");return text&&['消息','动态','收藏','历史'].every(t=>text.includes(t))?text:false},{timeoutMs:15000});
 check('native-navigation-still-mounted',!!header);
 await click(el('show'));
 await waitFor('Japanese token overlay',()=>page.cdp.evaluate(`document.getElementById('biliscript-study-overlay')?.shadowRoot.querySelectorAll('.jp-word').length>5`),{timeoutMs:30000});
 check('Japanese-first-no-AI',!(await ai()).length&&await page.cdp.evaluate(`${overlay}.querySelector('.zh').textContent===''`));
 check('titles-removed-and-five-tabs',await page.cdp.evaluate(`${host}.querySelectorAll('[data-pane]').length===5&&!${host}.querySelector('.head strong')&&!${bar}.querySelector('.study-mark')`));
 await screenshotAs('01-native-entry-and-Japanese');
 await click(`${overlay}.querySelectorAll('.jp-word')[2]`);
 check('single-click-local-word-only',await pane()==='vocabulary'&&!(await ai()).length);
 await waitFor('word star ready',()=>page.cdp.evaluate(`!!${host}.querySelector('.word-star:not(:disabled)')`));await click(`${host}.querySelector('.word-star')`);
 check('star-toggles-on',await page.cdp.evaluate(`${host}.querySelector('.word-star').getAttribute('aria-pressed')==='true'`));
 await click(`${host}.querySelector('[data-pane=book]')`);
 check('separate-collapsed-wordbook-and-source',await page.cdp.evaluate(`${host}.querySelectorAll('.saved-word').length===1&&!!${host}.querySelector('.saved-word details:not([open])')&&${host}.querySelector('.source-link').href.includes('t=0')`));await screenshotAs('02-wordbook');
 await page.cdp.evaluate('window.scrollTo(0,0)');
 await gestures(`${overlay}.querySelector('.ja')`,'友達','図書館');
 await waitFor('selection explanation',async()=>await pane()==='explanation'&&(await detail()).includes('友達と図書館'));
 const firstCalls=await ai();check('drag-triggers-one-fragment-without-ruby',firstCalls.length===1&&firstCalls[0].text==='友達と図書館',firstCalls);
 check('drag-tail-click-does-not-switch-word-pane',await pane()==='explanation');
 await waitFor('multiple local word cards',()=>page.cdp.evaluate(`${host}.querySelectorAll('.word-card').length>=3`));await screenshotAs('03-selection-explanation');
 await gestures(`${overlay}.querySelector('.ja')`,'友達','図書館');await sleep(300);
 check('same-selection-reuses-cache',(await ai()).length===1);
 await click(el('explain'));await waitFor('manual full sentence',async()=> (await ai()).some(x=>x.text==='昨日、友達と図書館で日本語を勉強しました。'));
 check('sentence-button-stays-full-sentence',(await ai()).at(-1).text==='昨日、友達と図書館で日本語を勉強しました。');
 await click(el('translate'));await sleep(400);
 check('bilingual-switch-prefetches-at-most-next', (await ai()).filter(x=>x.system.startsWith('仅将')).length===2);
 await click(el('translate'));check('bilingual-off-keeps-Japanese',await page.cdp.evaluate(`${overlay}.querySelectorAll('.jp-word').length>0&&${overlay}.querySelector('.zh').textContent===''`));
 await click(`${host}.querySelector('[data-pane=subtitles]')`);
 await gestures(`${el('current')}`,'日本語','勉強');await waitFor('sidebar drag explanation',async()=>await pane()==='explanation'&&(await detail()).includes('日本語を勉強'));
 check('sidebar-real-mouse-drag-works',(await ai()).at(-1).text==='日本語を勉強');
 const setFixtureKey=key=>worker.evaluate(`(async()=>{const s=(await chrome.storage.local.get('biliscriptJapaneseSettings')).biliscriptJapaneseSettings;await chrome.storage.local.set({biliscriptJapaneseSettings:{...s,apiKey:${JSON.stringify(key)}}})})()`);
 await setFixtureKey('');const beforeMissing=(await ai()).length;
 await gestures(`${overlay}.querySelector('.ja')`,'図書館','日本語');await waitFor('missing key setup message',async()=> (await detail()).includes('尚未配置文字接口'));
 check('missing-key-local-words-and-setup-button',beforeMissing===(await ai()).length&&await page.cdp.evaluate(`!!${host}.querySelector('#detail .setup-link')&&${host}.querySelectorAll('.word-card').length>0`));
 await setFixtureKey('isolated-fixture-key');await gestures(`${overlay}.querySelector('.ja')`,'図書館','日本語');await waitFor('same selection retry after key setup',async()=> (await detail()).includes('选中：図書館で日本語'));
 check('same-selection-retries-after-missing-key',(await ai()).length===beforeMissing+1);
 await worker.evaluate('globalThis.__holdNext=2200');await gestures(`${overlay}.querySelector('.ja')`,'昨日','友達');
 await waitFor('delayed old request started',async()=> (await ai()).at(-1).text==='昨日、友達');
 await gestures(`${overlay}.querySelector('.ja')`,'日本語','勉強');await waitFor('new selection wins',async()=> (await detail()).includes('选中：日本語を勉強'));await sleep(2400);
 check('old-selection-response-does-not-overwrite-new',(await detail()).includes('选中：日本語を勉強')&&!(await detail()).includes('选中：昨日、友達'));
 await page.cdp.send('Runtime.evaluate',{expression:"document.querySelector('.bpx-player-container').requestFullscreen()",userGesture:true,awaitPromise:true});await sleep(400);
 await gestures(`${overlay}.querySelector('.ja')`,'友達','図書館');await waitFor('fullscreen explanation panel',async()=>await pane()==='explanation');
 check('fullscreen-drag-keeps-subtitles',await page.cdp.evaluate(`!!document.fullscreenElement&&document.getElementById('biliscript-study-overlay').getBoundingClientRect().width>0`));await screenshotAs('04-fullscreen-selection');
 await click(el('stopStudy'));check('fullscreen-closed-hides-all-plugin-UI',await page.cdp.evaluate("!document.getElementById('biliscript-study-overlay')&&document.getElementById('biliscript-study-controls').hidden&&document.getElementById('biliscript-study-entry').hidden&&document.getElementById('biliscript-japanese-study').hidden"));
 await page.cdp.evaluate('document.exitFullscreen()');await sleep(250);
 check('entry-restores-in-native-controls',await page.cdp.evaluate("!document.getElementById('biliscript-study-entry').hidden&&!!document.querySelector('.bpx-player-control-bottom-right #biliscript-study-entry')"));
 check('no-hydration-error',!evidence.exceptions.some(x=>x.includes('HierarchyRequestError')));
 evidence.aiRequests=await ai();evidence.savedWords=await worker.evaluate("(async()=>{return (await chrome.storage.local.get('biliscriptStudyVocabulary')).biliscriptStudyVocabulary})()");
}catch(error){evidence.error=String(error.stack);log(error.message);process.exitCode=1;try{evidence.aiRequests=await ai();evidence.lastPane=await pane();evidence.detail=await detail();evidence.selection=await page.cdp.evaluate(`(()=>{const root=document.getElementById('biliscript-study-overlay')?.shadowRoot;const s=root?.getSelection?.()||document.getSelection();return {text:s?.toString(),anchor:s?.anchorNode?.parentElement?.outerHTML,focus:s?.focusNode?.parentElement?.outerHTML,jaUserSelect:root?getComputedStyle(root.querySelector('.ja')).userSelect:null}})()`);await screenshotAs('failure')}catch{}}
finally{evidence.failed=checks.filter(x=>!x.ok);await writeEvidence(out,evidence);try{await page?.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause())")}catch{}await teardown({browser,cdps})}
