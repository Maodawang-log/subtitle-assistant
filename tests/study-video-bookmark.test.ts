import {describe,it,expect} from 'vitest';
import {createLearningStore,LIBRARY_KEY,TEMP_KEY,videoBookmarkId} from '../extension/study/learning-store.js';
import {materialKey} from '../extension/study/learning-data.js';
import {createMemoryStorageArea} from './helpers/memory-storage-area.js';

const cue={id:'c1',revision:1,start:1,end:4,text:'A sentence.',originalText:'A sentence.'};
const material={version:1 as const,key:materialKey('BV1ab411c7mD:p1','en'),route:'BV1ab411c7mD:p1',identity:'BV1ab411c7mD:111',bvid:'BV1ab411c7mD',page:1,cid:'111',language:'en' as const,title:'Saved video',duration:120,offset:0,source:'asr' as const,ranges:[{start:0,end:30}],cues:[cue],at:1};
const meta={bvid:material.bvid,page:1,language:'en',title:material.title,cid:material.cid,kind:'video'};
const record={conversation:[{question:'Why?',answer:'Because.'}]};
const emptyLibrary=():any=>({version:1,documents:{},records:{},bookmarks:{},reviews:{},batches:{}});
const setup=(data?:Map<string,any>)=>{const disk=data||new Map(),area=createMemoryStorageArea(disk);return {disk,area,store:createLearningStore(area)}};

describe('one video bookmark also keeps its acquired study material',()=>{
 it('promotes the existing transcript and conversation together and survives cache clearing',async()=>{
  const {store}=setup();await store.action('snapshot',{document:material});await store.action('record',{key:material.key,record});
  await store.action('videoBookmark',{bookmark:meta});await store.action('cacheClear');
  const data=await store.action('get',{key:material.key});expect(data.bookmarked).toBe(true);expect(data.document).toEqual(material);expect(data.record).toEqual(record);expect((await store.action('list')).bookmarks).toHaveLength(1);
 });
 it('can bookmark before subtitles arrive, then keeps future acquired ranges and records',async()=>{
  const {store}=setup();await store.action('videoBookmark',{bookmark:meta});
  await store.action('snapshot',{document:material});const later={...material,ranges:[{start:0,end:60}],cues:[cue,{...cue,id:'c2',start:31,end:34,text:'Later.'}]};
  await store.action('snapshot',{document:later});await store.action('record',{key:material.key,record});await store.action('cacheClear');
  const data=await store.action('get',{key:material.key});expect(data.document.cues).toHaveLength(2);expect(data.record).toEqual(record);
 });
 it('keeps other languages and parts temporary until the user bookmarks each one',async()=>{
  const {store}=setup();await store.action('videoBookmark',{bookmark:meta,document:material});
  const japanese={...material,language:'ja',key:materialKey(material.route,'ja')},part2={...material,page:2,route:material.bvid+':p2',key:materialKey(material.bvid+':p2','en')};
  for(const item of [japanese,part2]){await store.action('snapshot',{document:item});expect((await store.action('get',{key:item.key})).bookmarked).toBe(false)}
  await store.action('cacheClear');expect((await store.action('get',{key:material.key})).document).toEqual(material);for(const item of [japanese,part2])expect((await store.action('get',{key:item.key})).document).toBeUndefined();
 });
 it('shows legacy separately pinned documents as video bookmarks without losing study records',async()=>{
  const lib=emptyLibrary();lib.documents[material.key]=material;lib.records[material.key]=record;
  const {store}=setup(new Map([[LIBRARY_KEY,lib]]));const data=await store.action('get',{key:material.key});
  expect(data.bookmarked).toBe(true);expect(data.record).toEqual(record);expect((await store.action('list')).bookmarks).toContainEqual(expect.objectContaining({id:videoBookmarkId(meta),kind:'video',bvid:meta.bvid}));
 });
 it('upgrades a legacy metadata-only bookmark using already cached material',async()=>{
  const lib=emptyLibrary();lib.bookmarks['old-video-id']={...meta,id:'old-video-id'};
  const {store}=setup(new Map([[LIBRARY_KEY,lib],[TEMP_KEY,{['document:'+material.key]:{at:1,value:material},['record:'+material.key]:{at:1,value:record}}]]));
  await store.action('get',{key:material.key});await store.action('cacheClear');const data=await store.action('get',{key:material.key});expect(data.document).toEqual(material);expect(data.record).toEqual(record);
 });
 it('canceling video collection demotes material while preserving sentence favorites, words, corrections and review state',async()=>{
  const {store,disk}=setup();await store.action('videoBookmark',{bookmark:meta,document:material,record});
  await store.action('bookmark',{bookmark:{...meta,id:'sentence-1',kind:'sentence',text:cue.text,start:1,end:4}});disk.set('biliscriptStudyVocabulary',[{term:'keep'}]);disk.set('biliscript-study-corrections:en:'+material.route,{edit:'keep'});
  await store.action('review',{id:'word-1',remembered:true});await store.action('unpin',{key:material.key});
  let data=await store.action('get',{key:material.key});expect(data.bookmarked).toBe(false);expect(data.document).toEqual(material);expect(data.record).toEqual(record);
  const list=await store.action('list');expect(list.bookmarks).toHaveLength(1);expect(list.bookmarks[0].kind).toBe('sentence');expect(list.reviews['word-1']).toBeDefined();
  await store.action('cacheClear');data=await store.action('get',{key:material.key});expect(data.document).toBeUndefined();expect(disk.get('biliscriptStudyVocabulary')).toEqual([{term:'keep'}]);expect(disk.get('biliscript-study-corrections:en:'+material.route)).toEqual({edit:'keep'});
 });
 it('removing a saved video from the library also releases permanent material',async()=>{
  const {store}=setup();await store.action('videoBookmark',{bookmark:meta,document:material,record});await store.action('removeBookmark',{id:videoBookmarkId(meta)});
  expect((await store.action('get',{key:material.key})).bookmarked).toBe(false);expect((await store.action('list')).documents).toHaveLength(0);
 });
 it('rejects a mismatched video or language before committing any saved entry',async()=>{
  const {store,disk}=setup();await expect(store.action('videoBookmark',{bookmark:{...meta,language:'ja'},document:material,record})).rejects.toThrow('不匹配');expect(disk.has(LIBRARY_KEY)).toBe(false);
 });
 it('a failed persistent write does not falsely report a saved video or poison the next try',async()=>{
  const {store,area,disk}=setup();area.set.mockRejectedValueOnce(new Error('disk-full'));
  await expect(store.action('videoBookmark',{bookmark:meta,document:material,record})).rejects.toThrow('disk-full');expect(disk.has(LIBRARY_KEY)).toBe(false);
  await store.action('videoBookmark',{bookmark:meta,document:material,record});expect((await store.action('get',{key:material.key})).bookmarked).toBe(true);
 });
});
