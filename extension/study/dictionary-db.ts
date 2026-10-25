// IndexedDB belongs to the extension origin. Content scripts request only matches.
export interface DictionaryTerm {generation:string;row:number;term:string;reading:string;meaning:string;sequence:number}
export interface InstalledDictionary {id:string;generation:string;version:string;name:string;rows:number;bytes:number;at:number;attribution:string;source:string;sha256:string}
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
export async function dictionaryState():Promise<InstalledDictionary|undefined>{const db=await openDictionaryDb();return result(db.transaction("meta").objectStore("meta").get("jitendex-zh"))}
export async function putDictionaryMeta(meta:any){const db=await openDictionaryDb(),tx=db.transaction("meta","readwrite"),done=transactionDone(tx);tx.objectStore("meta").put(meta);await done}
export async function putDictionaryBatch(terms:DictionaryTerm[]){const db=await openDictionaryDb(),tx=db.transaction("terms","readwrite"),done=transactionDone(tx);for(const term of terms)tx.objectStore("terms").put(term);await done}
export async function removeDictionaryGeneration(generation:string){
 const db=await openDictionaryDb(),tx=db.transaction(["terms","meta"],"readwrite"),done=transactionDone(tx);
 tx.objectStore("terms").delete(IDBKeyRange.bound([generation,0],[generation,Number.MAX_SAFE_INTEGER]));
 tx.objectStore("meta").delete("pending:"+generation);await done;
}
export async function cleanupStaging(){
 const db=await openDictionaryDb(),all=await result<any[]>(db.transaction("meta").objectStore("meta").getAll());
 const active=all.find(x=>x.id==="jitendex-zh")?.generation;
 for(const m of all)if(m.id.startsWith("pending:")&&m.generation!==active)await removeDictionaryGeneration(m.generation);
}
export async function activateDictionary(meta:InstalledDictionary,previousGeneration?:string){
 const db=await openDictionaryDb(),tx=db.transaction("meta","readwrite"),done=transactionDone(tx);
 tx.objectStore("meta").put(meta);tx.objectStore("meta").delete("pending:"+meta.generation);if(previousGeneration)tx.objectStore("meta").put({id:"pending:"+previousGeneration,generation:previousGeneration});await done;
}
export async function deleteDictionary(){
 const db=await openDictionaryDb(),tx=db.transaction(["terms","meta"],"readwrite"),done=transactionDone(tx);
 tx.objectStore("terms").clear();tx.objectStore("meta").clear();await done;
}
export async function lookupDictionary(queries:string[]){
 const db=await openDictionaryDb(),tx=db.transaction(["meta","terms"]),done=transactionDone(tx);
 // Start every dependent request inside the same transaction to avoid an update
 // deleting the generation between reading its metadata and reading its terms.
 const entries=await new Promise<any[]>((resolve,reject)=>{
  const meta=tx.objectStore("meta").get("jitendex-zh");
  meta.onerror=()=>reject(meta.error);
  meta.onsuccess=()=>{
   if(!meta.result){resolve([]);return}
   const requests:Promise<DictionaryTerm[]>[]=[];
   for(const query of [...new Set(queries)].slice(0,4))for(const name of ["term","reading"])requests.push(result(tx.objectStore("terms").index(name).getAll([meta.result.generation,query],20)));
   Promise.all(requests).then(groups=>{
    const seen=new Set();const matches=[];
    for(const term of groups.flat()){const key=term.term+":"+term.reading+":"+term.sequence;if(seen.has(key))continue;seen.add(key);matches.push({term:term.term,reading:term.reading,meaning:term.meaning,source:meta.result.name,version:meta.result.version})}
    resolve(matches.slice(0,12));
   }).catch(reject);
  };
 });
 await done;return entries;
}
