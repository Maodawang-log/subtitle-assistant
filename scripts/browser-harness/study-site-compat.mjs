// Public-page differential diagnosis. No profile or credentials from the user.
import path from 'node:path';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {REPO_ROOT,launchBrowser,attachPage,screenshot,teardown,sleep,writeEvidence,artifactDir,log} from './harness.mjs';
const label=process.argv[2]||'before',modes=(process.argv[3]||'full,control,observer-only,content-only').split(',');
const pageUrl=process.argv[5]||'https://www.bilibili.com/video/BV1wYAmeqEuV/';
const source=path.resolve(process.argv[4]||'dist-study'),out=artifactDir('site-compat-'+label);
const temp=path.join(REPO_ROOT,'.scratch/browser-temp');await mkdir(temp,{recursive:true});process.env.TEMP=temp;process.env.TMP=temp;
const evidence={scope:'isolated Edge; public Bilibili; learning never enabled; no ASR or AI requests',source,label,pageUrl,runs:[]};
for(const mode of modes){
 const dir=path.join(out,'variants',mode);await mkdir(dir,{recursive:true});
 if(mode==='control')await writeFile(path.join(dir,'manifest.json'),JSON.stringify({manifest_version:3,name:'Read-only page control',version:'0.0.1'}));
 else{
  await cp(source,dir,{recursive:true});const manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
  if(mode==='observer-only')manifest.content_scripts=manifest.content_scripts.filter(x=>x.world==='MAIN');
  if(mode==='content-only')manifest.content_scripts=manifest.content_scripts.filter(x=>x.world!=='MAIN');
  if(mode==='unmounted')await build({entryPoints:[path.join(REPO_ROOT,'extension/study/content.ts')],bundle:true,minify:true,format:'iife',platform:'browser',target:'chrome120',outfile:path.join(dir,'entry/study.js'),plugins:[{name:'diagnostic-no-dom-mount',setup(b){b.onLoad({filter:/ui-shell\.ts$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('function mount(video:HTMLVideoElement|null){','function mount(video:HTMLVideoElement|null){ if(!enabled)return;'),loader:'ts'}))}}]});
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest));
 }
 const run={mode,exceptions:[],consoleErrors:[],httpErrors:[],checks:[]};evidence.runs.push(run);let browser,page;
 try{
  browser=await launchBrowser({distDir:dir,profilePrefix:'site-compat-'+mode+'-',muted:true,sync:false});page=await attachPage(browser);
  page.cdp.on('Runtime.exceptionThrown',e=>run.exceptions.push({text:e.exceptionDetails.text,description:e.exceptionDetails.exception?.description,stack:e.exceptionDetails.stackTrace}));
  page.cdp.on('Log.entryAdded',e=>{if(e.entry.level==='error')run.consoleErrors.push({text:e.entry.text.slice(0,400),url:e.entry.url?.split('?')[0]})});
  page.cdp.on('Network.responseReceived',e=>{if(e.response.status>=400)run.httpErrors.push({status:e.response.status,url:e.response.url.split('?')[0]})});
  if(mode==='full-delayed'){
   await page.cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
   await page.cdp.send('Fetch.enable',{patterns:[{urlPattern:'https://s1.hdslb.com/bfs/static/jinkela/video/video.*.js',resourceType:'Script',requestStage:'Request'}]});
   page.cdp.on('Fetch.requestPaused',async e=>{run.delayedSiteScript=true;await sleep(6000);await page.cdp.send('Fetch.continueRequest',{requestId:e.requestId}).catch(()=>{})});
  }
  await page.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__siteCompat={ticks:0,ssrTicks:0,loaded:false,firstRoot:null,firstStudyInApp:null};setInterval(()=>{window.__siteCompat.ticks++;if(document.querySelector('#app[data-server-rendered]'))window.__siteCompat.ssrTicks++},100);document.addEventListener('DOMContentLoaded',()=>window.__siteCompat.loaded=true,{once:true});new MutationObserver(()=>{const a=document.getElementById('app'),s=document.getElementById('biliscript-study-slot');if(a&&!window.__siteCompat.firstRoot)window.__siteCompat.firstRoot={at:performance.now(),attributes:[...a.attributes].map(x=>[x.name,x.value])};if(a?.contains(s)&&!window.__siteCompat.firstStudyInApp)window.__siteCompat.firstStudyInApp={at:performance.now(),attributes:[...a.attributes].map(x=>[x.name,x.value])}}).observe(document,{childList:true,subtree:true})"});
  await page.cdp.send('Page.navigate',{url:pageUrl});await sleep(mode==='full-delayed'?13000:9500);
  const inspect=`(()=>{const text=e=>(e?.textContent||'').replace(/\\s+/g,' ').slice(0,650);const deep=(root,selector)=>{let values=[...root.querySelectorAll(selector)];for(const e of root.querySelectorAll('*'))if(e.shadowRoot)values.push(...deep(e.shadowRoot,selector));return values};const header=document.querySelector('.bili-header'),images=[...document.querySelectorAll('.right-container img')];return {url:location.href,title:document.title,readyState:document.readyState,audit:window.__siteCompat,headerText:text(header),headerHtml:header?.outerHTML.slice(0,1500),headerLinks:[...document.querySelectorAll('.bili-header a')].map(a=>({text:text(a),href:a.href.split('?')[0]})).filter(a=>a.text),rightImages:images.map(i=>({src:i.currentSrc?.split('?')[0],loaded:i.complete&&i.naturalWidth>0,width:i.naturalWidth})),commentDefined:!!customElements.get('bili-comments'),comments:deep(document,'bili-comments,#comment,.reply-list,.comment-list').map(e=>({tag:e.tagName,id:e.id,cls:e.className,children:e.childElementCount,text:text(e),shadowChildren:e.shadowRoot?.childElementCount})),appChildren:document.querySelector('#app')?.childElementCount,studyEnabled:document.getElementById('biliscript-study-controls')?.hasAttribute('data-enabled'),studyNodes:document.querySelectorAll('#biliscript-study-slot,#biliscript-japanese-study').length}})()`;
  await page.cdp.evaluate("document.querySelectorAll('video,audio').forEach(v=>v.pause())");run.top=await page.cdp.evaluate(inspect);await screenshot(page.cdp,path.join(out,mode+'-top.png'));
  await page.cdp.evaluate("window.scrollTo({top:1400,behavior:'instant'})");await sleep(6500);run.afterScroll=await page.cdp.evaluate(inspect);await screenshot(page.cdp,path.join(out,mode+'-comments.png'));
  if(label.startsWith('after')){
   const state=run.afterScroll,check=(name,ok)=>run.checks.push({name,ok:!!ok});
   check('native-navigation-mounted',['消息','动态','收藏','历史'].every(t=>state.headerText.includes(t)));
   check('recommendation-images-loaded',state.rightImages.filter(x=>x.loaded).length>=3);
   check('native-comments-mounted',state.commentDefined&&state.comments.some(x=>x.tag==='BILI-COMMENTS'&&x.shadowChildren>0)&&state.comments.some(x=>x.tag==='BILI-COMMENT-RENDERER'&&x.shadowChildren>0));
   check('no-hydration-exception',!run.exceptions.some(x=>x.text.includes('HierarchyRequestError')));
   check('learning-stays-off',state.studyEnabled!==true);
   if(mode.startsWith('full'))check('study-inserted-only-after-hydration',state.audit.firstStudyInApp&&!state.audit.firstStudyInApp.attributes.some(x=>x[0]==='data-server-rendered'));
   if(mode==='full-delayed'){check('delayed-site-script-exercised',run.delayedSiteScript);check('ssr-stayed-pending-during-delay',state.audit.ssrTicks>=40)}
  }
  log(JSON.stringify({mode,exceptions:run.exceptions.map(x=>x.description),header:run.top.headerText,imagesLoaded:run.afterScroll.rightImages.filter(x=>x.loaded).length,images:run.afterScroll.rightImages.length,comments:run.afterScroll.comments.map(x=>({tag:x.tag,children:x.children,shadow:x.shadowChildren})),ticks:run.afterScroll.audit.ticks}));
 }catch(error){run.error=String(error.stack);log(mode+' '+error.message)}
 finally{await writeEvidence(out,evidence);await teardown({browser,cdps:page?[page.cdp]:[]})}
}
if(evidence.runs.some(x=>x.error||x.checks.some(c=>!c.ok)))process.exitCode=1;
