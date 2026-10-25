import {DICTIONARIES,getDictionary,type DictionaryLanguage} from "./dictionary-catalog.js";
// Preserve the v1 database, IDs and generation indexes for existing installations.
export interface DictionaryTerm {generation:string;row:number;term:string;reading:string;meaning:string;sequence:number;displayTerm?:string}
export interface InstalledDictionary {id:string;generation:string;version:string;name:string;rows:number;bytes:number;at:number;attribution:string;source:string;sha256:string;sourceLanguage?:DictionaryLanguage;targetLanguage?:string}
const DB="biliscript-study-dictionaries";
let opening:Promise<IDBDatabase>|undefined;
export function openDictionaryDb():Promise<IDBDatabase>{
 if(!opening)opening=new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore("meta",{keyPath:"id"});const terms=db.createObjectStore("terms",{keyPath:["generation","row"]});terms.createIndex("term",["generation","term"]);terms.createIndex("reading",["generation","reading"])};
  req.onsuccess=()=>{req.result.onversionchange=()=>{req.result.close();opening=undefined};resolve(req.result)};
  req.onerror=()=>{opening=undefined;reject(req.error)};
 });return opening;
}
const result=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
export const transactionDone=(tx:IDBTransaction)=>new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||new Error("词典写入被中断"))});
export const dictionaryLanguage=(meta:InstalledDictionary)=>getDictionary(meta.id)?.sourceLanguage;
function selectDefault(all:any[],language:string,id?:string):InstalledDictionary|undefined{
 const installed=all.filter(x=>x.generation&&getDictionary(x.id)?.sourceLanguage===language);
 const desired=id||all.find(x=>x.id==="default:"+language)?.dictionaryId;
 if(desired){const match=installed.find(x=>x.id===desired);if(match||id)return match}
 return DICTIONARIES.filter(x=>x.sourceLanguage===language).map(x=>installed.find(m=>m.id===x.id)).find(Boolean);
}
export async function dictionaryState(id="jitendex-zh"):Promise<InstalledDictionary|undefined>{const db=await openDictionaryDb();return result(db.transaction("meta").objectStore("meta").get(id))}
export async function dictionaryInventory(){
 const db=await openDictionaryDb(),all=await result<any[]>(db.transaction("meta").objectStore("meta").getAll());
 return {installed:all.filter(x=>x.generation&&getDictionary(x.id)) as InstalledDictionary[],defaults:{ja:selectDefault(all,"ja")?.id,en:selectDefault(all,"en")?.id}};
}
export async function setDefaultDictionary(language:string,id:string){
 if(getDictionary(id)?.sourceLanguage!==language)throw new Error("词典与所选语言不匹配");
 const db=await openDictionaryDb(),tx=db.transaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta");
 const req=store.get(id);let missing=false;
 req.onsuccess=()=>{if(!req.result){missing=true;return}store.put({id:"default:"+language,dictionaryId:id})};
 await done;if(missing)throw new Error("请先安装该词典");
}
export async function putDictionaryMeta(meta:any){const db=await openDictionaryDb(),tx=db.transaction("meta","readwrite"),done=transactionDone(tx);tx.objectStore("meta").put(meta);await done}
export async function putDictionaryBatch(terms:DictionaryTerm[]){const db=await openDictionaryDb(),tx=db.transaction("terms","readwrite"),done=transactionDone(tx);for(const term of terms)tx.objectStore("terms").put(term);await done}
export async function removeDictionaryGeneration(generation:string){
 const db=await openDictionaryDb(),tx=db.transaction(["terms","meta"],"readwrite"),done=transactionDone(tx);
 tx.objectStore("terms").delete(IDBKeyRange.bound([generation,0],[generation,Number.MAX_SAFE_INTEGER]));tx.objectStore("meta").delete("pending:"+generation);await done;
}
export async function cleanupStaging(){
 const db=await openDictionaryDb(),all=await result<any[]>(db.transaction("meta").objectStore("meta").getAll());
 const active=new Set(all.filter(x=>x.generation&&getDictionary(x.id)).map(x=>x.generation));
 for(const m of all)if(typeof m.id==="string"&&m.id.startsWith("pending:")&&!active.has(m.generation))await removeDictionaryGeneration(m.generation);
}
export async function activateDictionary(meta:InstalledDictionary,previousGeneration?:string){
 const db=await openDictionaryDb(),tx=db.transaction("meta","readwrite"),done=transactionDone(tx),store=tx.objectStore("meta"),req=store.getAll();
 req.onsuccess=()=>{
  const language=dictionaryLanguage(meta),previousDefault=selectDefault(req.result,language||"");
  store.put(meta);store.delete("pending:"+meta.generation);
  if(language)store.put({id:"default:"+language,dictionaryId:previousDefault?.id||meta.id});
  if(previousGeneration)store.put({id:"pending:"+previousGeneration,generation:previousGeneration,dictionaryId:meta.id});
 };await done;
}
export async function deleteDictionary(id="jitendex-zh"){
 if(!getDictionary(id))throw new Error("未知词典，未删除任何内容");
 const db=await openDictionaryDb(),tx=db.transaction(["terms","meta"],"readwrite"),done=transactionDone(tx),store=tx.objectStore("meta"),req=store.getAll();
 req.onsuccess=()=>{
  const selected=req.result.find(x=>x.id===id);if(!selected)return;
  tx.objectStore("terms").delete(IDBKeyRange.bound([selected.generation,0],[selected.generation,Number.MAX_SAFE_INTEGER]));store.delete(id);
  const pref=req.result.find(x=>x.id==="default:"+dictionaryLanguage(selected));if(pref?.dictionaryId===id)store.delete(pref.id);
 };await done;
}
export async function lookupDictionary(queries:string[],language="ja",dictionaryId?:string){
 const db=await openDictionaryDb(),tx=db.transaction(["meta","terms"]),done=transactionDone(tx);
 const entries=await new Promise<any[]>((resolve,reject)=>{
  const meta=tx.objectStore("meta").getAll();meta.onerror=()=>reject(meta.error);
  meta.onsuccess=()=>{
   const selected=selectDefault(meta.result,language,dictionaryId);if(!selected){resolve([]);return}
   const requests:Promise<DictionaryTerm[]>[]=[];
   for(const query of [...new Set(queries.map(q=>language==="en"?q.toLowerCase():q))].slice(0,4))for(const name of ["term","reading"])requests.push(result(tx.objectStore("terms").index(name).getAll([selected.generation,query],20)));
   Promise.all(requests).then(groups=>{
    const seen=new Set(),matches=[];
    for(const term of groups.flat()){const key=term.term+":"+term.reading+":"+term.sequence;if(seen.has(key))continue;seen.add(key);matches.push({term:term.displayTerm||term.term,reading:term.reading,meaning:term.meaning,source:selected.name,version:selected.version,dictionaryId:selected.id,sourceLanguage:language})}
    resolve(matches.slice(0,12));
   }).catch(reject);
  };
 });await done;return entries;
}
