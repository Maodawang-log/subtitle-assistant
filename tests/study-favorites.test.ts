import './helpers/study-learning-store-host.js';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createStudyShell } from '../extension/study/ui-shell.js';
import { createLearningWorkspace } from '../extension/study/learning-workspace.js';
import { sentenceBookmark } from '../extension/study/learning-favorites.js';
import { learningAction, LIBRARY_KEY, TEMP_KEY } from '../extension/study/learning-store.js';
import * as storeClient from '../extension/study/learning-store.js';
import { materialKey } from '../extension/study/learning-data.js';
import { createMemoryStorageArea } from './helpers/memory-storage-area.js';

let ui:any,workspace:any,m:any,adapter:any,area:any,disk:Map<string,any>,send:any;
const deferred=()=>{let resolve!:()=>void;return {promise:new Promise<void>(done=>resolve=done),resolve}};
const settle=async()=>{for(let n=0;n<100;n++)await Promise.resolve()};
function mount(){ui=createStudyShell();workspace=createLearningWorkspace(ui,adapter);ui.setEnabled(true);ui.setPane('subtitles')}
function star(c=m.cues[0]){const b=workspace.sentenceButton(c);ui.$('rows').append(b);return b}
const saved=()=>Object.values(disk.get(LIBRARY_KEY)?.bookmarks||{}) as any[];
beforeEach(()=>{
 disk=new Map();area=createMemoryStorageArea(disk);
 m={version:1,key:materialKey('BV1ab411c7mD:p1','en'),route:'BV1ab411c7mD:p1',identity:'BV1ab411c7mD:111',bvid:'BV1ab411c7mD',page:1,cid:'111',language:'en',title:'Source video',duration:90,offset:2,source:'cc',ranges:[],cues:[{id:'one',revision:1,start:53,end:55,text:'A sentence.',originalText:'A sentence.'}],at:1};
 send=vi.fn(async r=>({ok:true,data:{supported:true,blocks:[{text:'summary',refs:[r.evidence?.[0]?.id]}],chapters:[],learning:[{text:'expression',refs:[r.evidence?.[0]?.id]}]},model:'fixture',provider:'fixture'}));
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('chrome',{runtime:{sendMessage:send,getURL:(p:string)=>p},storage:{local:area}});
 adapter={material:()=>structuredClone(m),meta:()=>({...m}),current:()=>m.cues[0],binding:()=>m.key,configuration:()=>'',manualEditing:()=>false,cancelCollection:vi.fn(),collectFull:vi.fn(),redraw:()=>{},jump:vi.fn(async()=>{})};mount();
});
afterEach(async()=>{workspace.reset();await settle();ui.destroy();vi.unstubAllGlobals();vi.restoreAllMocks()});

it('waits for persistence, blocks repeated clicks across entrances, then toggles and reports in the subtitle pane',async()=>{
 const first=star(),second=star();await workspace.refreshFavorites();
 const hold=deferred(),original=area.set.getMockImplementation();area.set.mockImplementationOnce(async(v:any)=>{await hold.promise;await original(v)});
 first.click();second.click();first.click();await settle();
 expect(first.textContent).toBe('☆');expect(first.disabled).toBe(true);expect(second.disabled).toBe(true);expect(first.getAttribute('aria-busy')).toBe('true');expect(saved()).toHaveLength(0);expect(area.set).toHaveBeenCalledOnce();
 hold.resolve();await vi.waitFor(()=>expect(first.textContent).toBe('★'));
 expect(second.textContent).toBe('★');expect(first.classList.contains('is-saved')).toBe(true);expect(first.getAttribute('aria-pressed')).toBe('true');expect(first.title).toBe('取消收藏此句');expect(ui.$('status').textContent).toBe('已收藏句子。');expect(saved()).toHaveLength(1);
 second.click();await vi.waitFor(()=>expect(first.textContent).toBe('☆'));expect(saved()).toHaveLength(0);expect(first.getAttribute('aria-pressed')).toBe('false');expect(ui.$('status').textContent).toContain('已取消');
 expect(adapter.collectFull).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(disk.get(LIBRARY_KEY).documents).toEqual({});
});
it.each(['save','remove'])('keeps persisted state and gives visible feedback on %s failure',async operation=>{
 const b=star();await workspace.refreshFavorites();if(operation==='remove'){b.click();await vi.waitFor(()=>expect(b.textContent).toBe('★'))}
 area.set.mockRejectedValueOnce(new Error('storage unavailable'));b.click();await vi.waitFor(()=>expect(ui.$('status').textContent).toContain('storage unavailable'));
 expect(b.textContent).toBe(operation==='save'?'☆':'★');expect(b.disabled).toBe(false);expect(saved()).toHaveLength(operation==='save'?0:1);expect(ui.$('status').classList.contains('error')).toBe(true);
});
it('reconstructs stars after row rebuild, reopening and clearing temporary cache, without changing other records',async()=>{
 const correction={preserved:'manual'},vocabulary=[{word:'kept'}];disk.set('correction-fixture',correction);disk.set('biliscriptStudyVocabulary',vocabulary);
 disk.set(LIBRARY_KEY,{version:1,documents:{},records:{legacy:{conversation:['kept']}},bookmarks:{},reviews:{word:{due:42}},batches:{}});
 const b=star();b.click();await vi.waitFor(()=>expect(b.textContent).toBe('★'));ui.$('rows').replaceChildren();expect(star({...m.cues[0],id:'rebuilt',revision:2}).textContent).toBe('★');
 await learningAction('cacheClear');workspace.reset();ui.destroy();mount();const reopened=star();await vi.waitFor(()=>expect(reopened.textContent).toBe('★'));
 expect(disk.get(LIBRARY_KEY).records.legacy.conversation).toEqual(['kept']);expect(disk.get(LIBRARY_KEY).reviews.word.due).toBe(42);expect(disk.get('correction-fixture')).toEqual(correction);expect(disk.get('biliscriptStudyVocabulary')).toEqual(vocabulary);
});
it('uses the same old sentence id in stars, summary citations and learning examples, and synchronizes list removal',async()=>{
 const old=sentenceBookmark(m.cues[0],m);expect(old.id).toBe(JSON.stringify(['sentence',m.key,m.identity,53,55,'A sentence.']));
 const b=star();b.click();await vi.waitFor(()=>expect(b.textContent).toBe('★'));
 ui.$('summaryGenerate').click();await vi.waitFor(()=>expect(ui.$('pane-video').querySelectorAll('#videoSummary .save-sentence,#videoLearning .save-sentence')).toHaveLength(3));
 const controls=Array.from(ui.$('pane-video').querySelectorAll('#videoSummary .save-sentence,#videoLearning .save-sentence')) as HTMLButtonElement[];
 expect(controls.every(c=>c.textContent==='已收藏')).toBe(true);expect(saved()).toHaveLength(1);
 controls[2].click();await vi.waitFor(()=>expect(b.textContent).toBe('☆'));expect(controls.every(c=>c.getAttribute('aria-pressed')==='false')).toBe(true);
 controls[0].click();await vi.waitFor(()=>expect(b.textContent).toBe('★'));expect(saved()).toHaveLength(1);
 ui.$('savedLearning').querySelector('.favorite-sentence .remove-favorite').click();await vi.waitFor(()=>expect(b.textContent).toBe('☆'));expect(controls.every(c=>c.getAttribute('aria-pressed')==='false')).toBe(true);
});
it('groups legacy favorites with counts, source titles, offset times and working replay without favoriting the video',async()=>{
 const sentence={...sentenceBookmark(m.cues[0],m),at:1},video={id:'legacy-video',kind:'video',bvid:'BV1at7VzpEeR',page:2,language:'ja',title:'Other video',at:2};
 disk.set(LIBRARY_KEY,{version:1,documents:{},records:{},bookmarks:{[sentence.id]:sentence,[video.id]:video},reviews:{},batches:{}});
 const b=star();await workspace.refreshFavorites();expect(b.textContent).toBe('★');
 const groups=ui.$('savedLearning').querySelectorAll('.favorite-group');expect(groups).toHaveLength(2);expect(groups[0].querySelector('h3').textContent).toBe('视频收藏（1）');expect(groups[1].querySelector('h3').textContent).toBe('句子收藏（1）');
 const card=groups[1].querySelector('.favorite-sentence');expect(card.querySelector('.favorite-time').textContent).toBe('0:55 – 0:57');expect(card.querySelector('.favorite-source').textContent).toContain('Source video');expect(card.querySelector('a').href).toContain('t=55');
 (Array.from(card.querySelectorAll('button')) as HTMLButtonElement[]).find(b=>b.textContent==='在此重听')!.click();expect(adapter.jump).toHaveBeenCalledWith(55,57);
 expect(groups[0].querySelector('a').textContent).toBe('打开视频');expect(groups[0].querySelector('blockquote')).toBeNull();expect(disk.get(LIBRARY_KEY).documents).toEqual({});
});
it('accepts cross-page storage changes and keeps the active video bookmark semantics',async()=>{
 const b=star();await workspace.refreshFavorites();await learningAction('bookmark',{bookmark:sentenceBookmark(m.cues[0],m)});
 workspace.storageChanged({[LIBRARY_KEY]:{newValue:disk.get(LIBRARY_KEY)}},'local');expect(b.textContent).toBe('★');
 await learningAction('removeBookmark',{id:sentenceBookmark(m.cues[0],m).id});workspace.storageChanged({[LIBRARY_KEY]:{newValue:disk.get(LIBRARY_KEY)}},'local');expect(b.textContent).toBe('☆');
 ui.$('bookmarkVideo').click();await vi.waitFor(()=>expect(ui.$('bookmarkVideo').textContent).toBe('已收藏'));expect(disk.get(LIBRARY_KEY).documents[m.key].cues).toEqual(m.cues);
 ui.$('savedLearning').querySelector('.favorite-video .remove-favorite').click();await vi.waitFor(()=>expect(ui.$('bookmarkVideo').textContent).toBe('收藏视频'));expect(disk.get(TEMP_KEY)['document:'+m.key].value.cues).toEqual(m.cues);
});
it('does not let an old list response overwrite newer storage changes',async()=>{
 const hold=deferred(),original=area.get.getMockImplementation();area.get.mockImplementationOnce(async(k:any)=>{const old=await original(k);await hold.promise;return old});
 const b=star();await settle();const bookmark=sentenceBookmark(m.cues[0],m);
 const latest={version:1,bookmarks:{[bookmark.id]:bookmark},documents:{},records:{},reviews:{},batches:{}};disk.set(LIBRARY_KEY,latest);
 workspace.storageChanged({[LIBRARY_KEY]:{newValue:latest}},'local');expect(b.textContent).toBe('★');hold.resolve();await workspace.refreshFavorites();expect(b.textContent).toBe('★');
});
it.each(['save','remove'])('does not let a delayed %s receipt overwrite a newer opposite action from another page',async operation=>{
 const b=star(),bookmark=sentenceBookmark(m.cues[0],m);await workspace.refreshFavorites();
 if(operation==='remove'){b.click();await vi.waitFor(()=>expect(b.textContent).toBe('★'))}
 const original=storeClient.learningAction,hold=deferred(),persisted=deferred();
 vi.spyOn(storeClient,'learningAction').mockImplementation(async(action,payload)=>{
  const result=await original(action,payload);
  if(action===(operation==='save'?'bookmark':'removeBookmark')){persisted.resolve();await hold.promise}
  return result;
 });
 b.click();await persisted.promise;
 // The first write really reached disk; its browser message reply is delayed.
 workspace.storageChanged({[LIBRARY_KEY]:{newValue:structuredClone(disk.get(LIBRARY_KEY))}},'local');
 await original(operation==='save'?'removeBookmark':'bookmark',operation==='save'?{id:bookmark.id}:{bookmark});
 workspace.storageChanged({[LIBRARY_KEY]:{newValue:structuredClone(disk.get(LIBRARY_KEY))}},'local');
 hold.resolve();await vi.waitFor(()=>expect(b.disabled).toBe(false));
 expect(b.textContent).toBe(operation==='save'?'☆':'★');expect(saved()).toHaveLength(operation==='save'?0:1);expect(ui.$('status').textContent).toContain('已同步');
});
it('refreshes documents after cancelling a video even when an older list reply was in flight',async()=>{
 ui.$('bookmarkVideo').click();await vi.waitFor(()=>expect(ui.$('bookmarkVideo').textContent).toBe('已收藏'));await workspace.refreshFavorites();
 const original=storeClient.learningAction,hold=deferred(),read=deferred();let delay=true;
 vi.spyOn(storeClient,'learningAction').mockImplementation(async(action,payload)=>{
  const result=await original(action,payload);if(action==='list'&&delay){delay=false;read.resolve();await hold.promise}return result;
 });
 const oldRefresh=workspace.refreshFavorites();await read.promise;
 ui.$('savedLearning').querySelector('.favorite-video .remove-favorite').click();await vi.waitFor(()=>expect(saved().filter(b=>b.kind==='video')).toHaveLength(0));
 hold.resolve();await oldRefresh;await vi.waitFor(()=>expect(ui.$('bookmarkVideo').textContent).toBe('收藏视频'));
 expect(ui.$('bookmarkVideo').getAttribute('aria-pressed')).toBe('false');expect(disk.get(LIBRARY_KEY).documents[m.key]).toBeUndefined();
});
