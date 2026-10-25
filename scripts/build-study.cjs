const fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
const {BUILD_TARGET,createLocalImportGuard}=require("./build-guards.js");
const root=path.resolve(__dirname,".."),extension=path.join(root,"extension"),out=path.join(root,"dist-study");
if(out!==path.join(root,"dist-study")||!out.startsWith(root+path.sep))throw new Error("Unsafe output");
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(path.join(out,"entry"),{recursive:true});
function copyTree(src,dest){fs.mkdirSync(dest,{recursive:true});for(const e of fs.readdirSync(src,{withFileTypes:true})){if(e.isDirectory())copyTree(path.join(src,e.name),path.join(dest,e.name));else fs.copyFileSync(path.join(src,e.name),path.join(dest,e.name))}}
(async()=>{
 const settings={bundle:true,minify:true,sourcemap:true,target:BUILD_TARGET,platform:"browser",metafile:true,plugins:[createLocalImportGuard(extension)],legalComments:"linked"};
 const content=await build({...settings,entryPoints:[path.join(extension,"study/content.ts")],format:"iife",outfile:path.join(out,"entry/study.js")});
 const background=await build({...settings,entryPoints:[path.join(extension,"study/background.ts")],format:"esm",outfile:path.join(out,"entry/study-background.js")});
 for(const result of [content,background])for(const input of Object.keys(result.metafile.inputs)){
  if(/extension[\\/]entry[\\/](content|background|offscreen)\.ts$/.test(input))throw new Error("Automatic upstream entry leaked: "+input);
 }
 const staticFiles=["core.js","kuromoji.js","basic-dictionary.json","ui.css","options.html","options.js","recorder.html","recorder.css","recorder.js"];
 fs.mkdirSync(path.join(out,"study"),{recursive:true});
 for(const file of staticFiles)fs.copyFileSync(path.join(extension,"study",file),path.join(out,"study",file));
 for(const dir of ["dict","licenses"])copyTree(path.join(extension,"study",dir),path.join(out,"study",dir));
 copyTree(path.join(extension,"icons"),path.join(out,"icons"));fs.copyFileSync(path.join(root,"LICENSE"),path.join(out,"LICENSE"));
 fs.writeFileSync(path.join(out,"STUDY-CHANGES.txt"),"Based on Edmund724/BiliScript MIT, e40ebd1152c13df8df293ee5d7bd42d673ec241e.\nJapanese study variant: opt-in only; passive upstream CC helpers and ASR audio source reused; bounded local ASR.\nKuromoji/IPADIC notices in study/licenses. No pronunciation scoring.\n");
 const manifest={manifest_version:3,name:"BiliScript 日语学习",version:"2.6.3.1",minimum_chrome_version:"120",description:"手动开启的B站日语学习：日中字幕、本地分段识别、点词/讲解、句子练习和录音回放。",permissions:["storage","unlimitedStorage","scripting"],host_permissions:["https://www.bilibili.com/*","https://api.bilibili.com/*","https://*.hdslb.com/*","http://127.0.0.1:18766/*","https://api.deepseek.com/*"],optional_host_permissions:["https://*/*","http://*/*"],background:{service_worker:"entry/study-background.js",type:"module"},action:{default_title:"开启当前视频的日语学习",default_icon:{"16":"icons/icon16.png","32":"icons/icon32.png"}},icons:{"16":"icons/icon16.png","32":"icons/icon32.png","128":"icons/icon128.png"},options_ui:{page:"study/options.html",open_in_tab:true},content_scripts:[{matches:["https://www.bilibili.com/video/*","https://www.bilibili.com/*/video/*","https://www.bilibili.com/list/watchlater*"],js:["study/core.js","study/kuromoji.js","entry/study.js"],run_at:"document_idle"}],web_accessible_resources:[{resources:["study/ui.css","study/basic-dictionary.json","study/dict/*"],matches:["https://www.bilibili.com/*"]}]};
 fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify(manifest,null,2));
 const referenced=[manifest.background.service_worker,manifest.options_ui.page,...manifest.content_scripts.flatMap(e=>e.js),...Object.values(manifest.icons)];
 for(const p of referenced)if(!fs.existsSync(path.join(out,p)))throw new Error("Missing "+p);
 fs.mkdirSync(path.join(root,".scratch"),{recursive:true});
 fs.writeFileSync(path.join(root,".scratch/study-metafile.json"),JSON.stringify({content:content.metafile,background:background.metafile},null,2));
 console.log(JSON.stringify({out,version:manifest.version,contentBytes:content.metafile.outputs[Object.keys(content.metafile.outputs).find(k=>k.endsWith("study.js"))].bytes,passiveEntry:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
