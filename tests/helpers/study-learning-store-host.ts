// Run the real serialized store behind the study client in isolated DOM tests.
// These tests replace runtime.sendMessage for old CC/AI channels; no browser SW exists.
import {vi} from 'vitest';
vi.mock('../../extension/study/learning-store.js',async importOriginal=>{
 const actual=await importOriginal<typeof import('../../extension/study/learning-store.js')>();
 const stores=new WeakMap<object,ReturnType<typeof actual.createLearningStore>>();
 return {...actual,learningAction:(action:string,payload:any={})=>{
  const area=chrome.storage.local;if(!stores.has(area))stores.set(area,actual.createLearningStore(area));
  return stores.get(area)!.action(action,payload);
 }};
});
