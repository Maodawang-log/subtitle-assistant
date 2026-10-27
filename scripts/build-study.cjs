const fs=require("node:fs"),path=require("node:path"),{build}=require("esbuild");
const {BUILD_TARGET,createLocalImportGuard}=require("./build-guards.js");
const root=path.resolve(__dirname,".."),extension=path.join(root,"extension"),out=path.join(root,"dist-study");
const {version}=require("../package.json");
if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version))throw new Error("Invalid extension version");
if(out!==path.join(root,"dist-study")||!out.startsWith(root+path.sep))throw new Error("Unsafe output");
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(path.join(out,"entry"),{recursive:true});
function copyTree(src,dest){fs.mkdirSync(dest,{recursive:true});for(const e of fs.readdirSync(src,{withFileTypes:true})){if(e.isDirectory())copyTree(path.join(src,e.name),path.join(dest,e.name));else fs.copyFileSync(path.join(src,e.name),path.join(dest,e.name))}}
(async()=>{
 const settings={bundle:true,minify:true,sourcemap:true,target:BUILD_TARGET,platform:"browser",metafile:true,plugins:[createLocalImportGuard(extension)],legalComments:"linked"};
 const content=await build({...settings,entryPoints:[path.join(extension,"study/content.ts")],format:"iife",outfile:path.join(out,"entry/study.js")});
 const background=await build({...settings,entryPoints:[path.join(extension,"study/background.ts")],format:"esm",outfile:path.join(out,"entry/study-background.js")});
 const options=await build({...settings,entryPoints:[path.join(extension,"study/options.ts")],format:"iife",outfile:path.join(out,"study/options.js")});
 const dictionary=await build({...settings,entryPoints:[path.join(extension,"study/dictionary-worker.ts")],format:"iife",outfile:path.join(out,"study/dictionary-worker.js")});
 for(const result of [content,background,options,dictionary])for(const input of Object.keys(result.metafile.inputs)){
  if(/extension[\\/]entry[\\/](content|background|offscreen)\.ts$/.test(input))throw new Error("Automatic upstream entry leaked: "+input);
 }
 const staticFiles=["native-observer.js","core.js","kuromoji.js","basic-dictionary.json","ui.css","options.html","options.css"];
 fs.mkdirSync(path.join(out,"study"),{recursive:true});
 for(const file of staticFiles)fs.copyFileSync(path.join(extension,"study",file),path.join(out,"study",file));
 for(const dir of ["dict","licenses"])copyTree(path.join(extension,"study",dir),path.join(out,"study",dir));
 copyTree(path.join(extension,"icons"),path.join(out,"icons"));fs.copyFileSync(path.join(root,"LICENSE"),path.join(out,"LICENSE"));
 fs.copyFileSync(path.join(root,"NOTICE.md"),path.join(out,"NOTICE.md"));
 const manifest={manifest_version:3,name:"字幕助手",version,minimum_chrome_version:"120",description:"按需开启的B站语言学习：字幕、词典、讲解、句控和跟读；支持日语和英语原文字幕与本地识别。",permissions:["storage","unlimitedStorage","scripting","nativeMessaging"],host_permissions:["https://www.bilibili.com/*","https://api.bilibili.com/*","https://*.hdslb.com/*","http://127.0.0.1:18766/*","https://api.deepseek.com/*"],optional_host_permissions:["https://*/*","http://*/*"],background:{service_worker:"entry/study-background.js",type:"module"},action:{default_title:"打开字幕助手",default_icon:{"16":"icons/icon16.png","32":"icons/icon32.png"}},icons:{"16":"icons/icon16.png","32":"icons/icon32.png","128":"icons/icon128.png"},options_ui:{page:"study/options.html",open_in_tab:true},content_scripts:[{matches:["https://www.bilibili.com/video/*","https://www.bilibili.com/*/video/*","https://www.bilibili.com/list/watchlater*"],js:["study/native-observer.js"],world:"MAIN",run_at:"document_start"},{matches:["https://www.bilibili.com/video/*","https://www.bilibili.com/*/video/*","https://www.bilibili.com/list/watchlater*"],js:["study/core.js","study/kuromoji.js","entry/study.js"],run_at:"document_idle"}],web_accessible_resources:[{resources:["study/ui.css","study/basic-dictionary.json","study/dict/*"],matches:["https://www.bilibili.com/*"]}]};
 // Known catalog hosts are declared at install time. No request is made until
 // the user clicks download/update; fetches omit credentials.
 manifest.host_permissions.push("https://github.com/*","https://api.github.com/*","https://release-assets.githubusercontent.com/*","https://objects.githubusercontent.com/*","https://raw.githubusercontent.com/*");
 fs.copyFileSync(path.join(root,"node_modules/fflate/LICENSE"),path.join(out,"study/licenses/fflate-MIT.txt"));
 fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify(manifest,null,2));
 const referenced=[manifest.background.service_worker,manifest.options_ui.page,...manifest.content_scripts.flatMap(e=>e.js),...Object.values(manifest.icons)];
 for(const p of referenced)if(!fs.existsSync(path.join(out,p)))throw new Error("Missing "+p);
 fs.mkdirSync(path.join(root,".scratch"),{recursive:true});
 fs.writeFileSync(path.join(root,".scratch/study-metafile.json"),JSON.stringify({content:content.metafile,background:background.metafile,options:options.metafile,dictionary:dictionary.metafile},null,2));
 console.log(JSON.stringify({out,version:manifest.version,contentBytes:content.metafile.outputs[Object.keys(content.metafile.outputs).find(k=>k.endsWith("study.js"))].bytes,passiveEntry:true}));
})().catch(e=>{console.error(e);process.exitCode=1});
