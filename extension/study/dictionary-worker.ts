import { unzipSync, strFromU8 } from "fflate";
import { validateRelease } from "./dictionary-catalog.js";
import { dictionaryState,putDictionaryMeta,putDictionaryBatch,removeDictionaryGeneration,cleanupStaging,activateDictionary,deleteDictionary } from "./dictionary-db.js";
import { parseTerm } from "./dictionary-format.js";
import { csvRows,ecdictTerm } from "./dictionary-csv.js";
const ctx=globalThis as unknown as {postMessage(value:unknown):void;onmessage:((event:MessageEvent)=>void)|null};
let controller:AbortController|undefined,busy=false;
const emit=(stage:string,fields={})=>ctx.postMessage({stage,...fields});
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException("已取消","AbortError")};
async function install(raw:unknown,signal:AbortSignal){
 const release=validateRelease(raw);await cleanupStaging();check(signal);
 const previous=await dictionaryState(release.id),generation=crypto.randomUUID();let committed=false;
 try{
  emit("download",{done:0,total:release.bytes});
  const response=await fetch(release.url,{credentials:"omit",signal});
  if(!response.ok||!response.body)throw new Error("下载失败（HTTP "+response.status+"），可重新点击安装");
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  while(true){check(signal);const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>release.bytes){await reader.cancel();throw new Error("下载包大小与发布记录不一致")}chunks.push(value);emit("download",{done:total,total:release.bytes})}
  if(total!==release.bytes)throw new Error("下载不完整，可重新点击安装");
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}chunks.length=0;
  emit("verify");const digest=await crypto.subtle.digest("SHA-256",bytes);
  if(Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")!==release.sha256)throw new Error("SHA256 校验失败，未安装下载内容");
  check(signal);
  let rows=0,attribution=release.attribution;
  await putDictionaryMeta({id:"pending:"+generation,generation,dictionaryId:release.id});
  if(release.format==="yomitan"){
  const bankNames:string[]=[];let expanded=0;
  unzipSync(bytes,{filter:file=>{
   expanded+=file.originalSize;if(expanded>900000000)throw new Error("词典解压大小超过限制");
   if(/^term_bank_[1-9]\d*\.json$/.test(file.name)){if(file.originalSize>8000000)throw new Error("词库分片过大");bankNames.push(file.name)}
   if(file.name==="index.json"&&file.originalSize>64000)throw new Error("词典索引过大");
   return false;
  }});
  if(!bankNames.length||bankNames.length>2000||new Set(bankNames).size!==bankNames.length)throw new Error("缺少有效的 Yomitan 词库分片");
  const indexFile=unzipSync(bytes,{filter:f=>f.name==="index.json"})["index.json"];
  if(!indexFile)throw new Error("缺少词典索引");
  const index=JSON.parse(strFromU8(indexFile));
  if(index.format!==3||index.sourceLanguage!==release.sourceLanguage||index.targetLanguage!==release.targetLanguage)throw new Error("词典语言或 Yomitan 格式与目录不符");
  attribution=String(index.attribution||release.attribution).slice(0,20000);
  bankNames.sort((a,b)=>Number(a.match(/\d+/)?.[0])-Number(b.match(/\d+/)?.[0]));
  for(let i=0;i<bankNames.length;i++){
   check(signal);const name=bankNames[i];
   const data=JSON.parse(strFromU8(unzipSync(bytes,{filter:f=>f.name===name})[name]));
   if(!Array.isArray(data)||data.length>20000)throw new Error("词库分片记录数无效");
   for(let start=0;start<data.length;start+=1000){check(signal);await putDictionaryBatch(data.slice(start,start+1000).map(row=>parseTerm(row,generation,rows++)))}
   emit("import",{done:i+1,total:bankNames.length,rows,unit:"分片"});
  }
  }else{
   const iterator=csvRows(new TextDecoder("utf-8",{fatal:true}).decode(bytes)),header=iterator.next().value as string[]|undefined;
   if(!header||!["word","phonetic","translation","definition"].every(name=>header.includes(name)))throw new Error("CSV 缺少 ECDICT 字段");
   const columns=Object.fromEntries(header.map((name,index)=>[name,index]));let batch=[];
   for(const row of iterator){
    check(signal);if(row.length!==header.length)throw new Error("CSV 列数与表头不一致");
    batch.push(ecdictTerm(row,columns,generation,rows++));
    if(batch.length===1000){await putDictionaryBatch(batch);batch=[];emit("import",{done:rows,total:release.expectedRows||rows,rows,unit:"条"})}
   }
   if(batch.length)await putDictionaryBatch(batch);
   emit("import",{done:rows,total:rows,rows,unit:"条"});
  }
  if(rows<200000||release.expectedRows&&rows!==release.expectedRows)throw new Error("完整词库记录数校验失败");
  check(signal);
  const meta={id:release.id,generation,version:release.version,name:release.name,rows,bytes:release.bytes,at:Date.now(),attribution,source:release.source,sha256:release.sha256,sourceLanguage:release.sourceLanguage,targetLanguage:release.targetLanguage};
  await activateDictionary(meta,previous?.generation);committed=true;
  // Mark old generation for recovery before removal if the settings page closes.
  if(previous&&previous.generation!==generation){await removeDictionaryGeneration(previous.generation).catch(()=>{})}
  return {stage:"installed",meta};
 }catch(e){if(!committed)await removeDictionaryGeneration(generation).catch(()=>{});throw e}
}
ctx.onmessage=async({data})=>{
 if(data?.action==="cancel"){controller?.abort();return}
 if(busy)return;busy=true;controller=new AbortController();
 let terminal:Record<string,unknown>|undefined;
 try{
  terminal=await navigator.locks.request("biliscript-study-dictionary-install",{ifAvailable:true},async lock=>{
   if(!lock)throw new Error("另一设置页正在管理词典，请稍后再试");
   if(data?.action==="install")return await install(data.release,controller!.signal);
   if(data?.action==="delete"){await deleteDictionary(data.id||"jitendex-zh");return {stage:"deleted"}}
   if(data?.action==="recover"){await cleanupStaging();return {stage:"ready"}}
   throw new Error("未知词典操作");
  });
 }catch(e){terminal={stage:(e as Error).name==="AbortError"?"canceled":"error",message:(e as Error).name==="AbortError"?"已取消安装；原词典仍可使用。":(e as Error).message}}
 finally{controller=undefined;busy=false}
 // Ready means the lock has actually released; a fast next click cannot be lost.
 if(terminal)ctx.postMessage(terminal);
};
