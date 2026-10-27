import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createStudyShell} from '../extension/study/ui-shell.js';
import {createListening} from '../extension/study/listening.js';
let ui:any,controller:any,adapter:any,index:number,cues:any[];
const deferred=()=>{let resolve!:(v:string)=>void,reject!:(e:Error)=>void;return {promise:new Promise<string>((a,b)=>{resolve=a;reject=b}),resolve,reject}};
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve()};
beforeEach(()=>{
 cues=[{id:'one',revision:1,start:0,end:2,text:'First.'},{id:'two',revision:1,start:2,end:4,text:'Second.'}];index=0;
 vi.stubGlobal('chrome',{runtime:{getURL:(p:string)=>p}});ui=createStudyShell();
 adapter={current:()=>cues[index],material:()=>({cues}),binding:()=> 'video-1',redraw:vi.fn(),replay:vi.fn(async()=>{}),selectRelative:(d:number)=>{index+=d;controller.sync()},availableChinese:vi.fn(()=>''),translateCurrent:vi.fn(async()=> '中文译文'),cancelChinese:vi.fn(),clearListeningPlayback:vi.fn(),updatePracticeCue:vi.fn(),record:vi.fn()};
 controller=createListening(ui,adapter);controller.sync();
});
afterEach(()=>{controller.reset();ui.destroy();vi.unstubAllGlobals()});
it('keeps ordinary replay/navigation out of listening and disables both sentence boundaries',async()=>{
 expect(ui.$('listenPrev').disabled).toBe(true);expect(ui.$('listenNext').disabled).toBe(false);
 ui.$('listenReplay').click();await flush();expect(adapter.replay).toHaveBeenLastCalledWith(false);expect(controller.hideOriginal()).toBe(false);
 ui.$('listenNext').click();await flush();expect(index).toBe(1);expect(ui.$('listenNext').disabled).toBe(true);expect(ui.$('listenPrev').disabled).toBe(false);expect(ui.$('listeningToggle').textContent).toBe('开始精听');
 ui.$('listenPrev').click();await flush();expect(index).toBe(0);expect(ui.$('listenPrev').disabled).toBe(true);
});
it('reveals Chinese independently in the existing current card and preserves reveals on replay',async()=>{
 adapter.availableChinese.mockReturnValue('已有中文');ui.$('listeningToggle').click();ui.$('listenChinese').click();await flush();
 expect(controller.hideOriginal()).toBe(true);expect(ui.$('practiceChinese').textContent).toBe('已有中文');expect(ui.$('practiceChinese').hidden).toBe(false);expect(adapter.translateCurrent).not.toHaveBeenCalled();
 ui.$('listenOriginal').click();ui.$('listenReplay').click();await flush();expect(controller.hideOriginal()).toBe(false);expect(ui.$('practiceChinese').textContent).toBe('已有中文');expect(adapter.replay).toHaveBeenLastCalledWith(true);
 ui.$('listenNext').click();await flush();expect(controller.hideOriginal()).toBe(true);expect(ui.$('practiceCue').textContent).toBe('Second.');expect(ui.$('practiceChinese').hidden).toBe(true);
 ui.$('listenPrev').click();await flush();expect(ui.$('practiceChinese').hidden).toBe(true);expect(controller.hideOriginal()).toBe(true);
});
it('keeps the close button available while loading and allows one-click retry after failure',async()=>{
 const hold=deferred();adapter.translateCurrent.mockReturnValueOnce(hold.promise);ui.$('listeningToggle').click();ui.$('listenChinese').click();
 expect(adapter.translateCurrent).toHaveBeenCalledOnce();expect(ui.$('practiceChineseStatus').textContent).toContain('正在翻译当前句');expect(ui.$('listenChinese').disabled).toBe(false);expect(ui.$('listenChinese').textContent).toBe('隐藏中文');
 hold.reject(new Error('翻译失败'));await flush();expect(ui.$('practiceChineseStatus').textContent).toContain('翻译失败');expect(ui.$('practiceChineseStatus').hidden).toBe(false);expect(ui.$('listenChinese').textContent).toBe('揭示中文');expect(ui.$('listenChinese').getAttribute('aria-pressed')).toBe('false');
 ui.$('listenChinese').click();await flush();expect(ui.$('practiceChinese').textContent).toBe('中文译文');expect(ui.$('practiceChineseStatus').hidden).toBe(true);
});
it('toggles each display independently, preserves acquired Chinese and leaves playback untouched',async()=>{
 ui.$('listeningToggle').click();await flush();adapter.replay.mockClear();adapter.clearListeningPlayback.mockClear();
 const original=ui.$('listenOriginal'),translated=ui.$('listenChinese');
 original.click();expect(original.textContent).toBe('隐藏原文');expect(original.getAttribute('aria-pressed')).toBe('true');expect(original.classList.contains('on')).toBe(true);
 translated.click();await flush();expect(translated.textContent).toBe('隐藏中文');expect(translated.getAttribute('aria-pressed')).toBe('true');expect(translated.classList.contains('on')).toBe(true);
 original.click();expect(controller.hideOriginal()).toBe(true);expect(ui.$('practiceChinese').hidden).toBe(false);expect(original.textContent).toBe('揭示原文');
 translated.click();expect(ui.$('practiceChinese').hidden).toBe(true);expect(translated.textContent).toBe('揭示中文');expect(translated.getAttribute('aria-pressed')).toBe('false');
 translated.click();await flush();expect(ui.$('practiceChinese').textContent).toBe('中文译文');expect(adapter.translateCurrent).toHaveBeenCalledOnce();expect(controller.hideOriginal()).toBe(true);
 original.click();translated.click();expect(controller.hideOriginal()).toBe(false);expect(ui.$('practiceChinese').hidden).toBe(true);
 expect(adapter.replay).not.toHaveBeenCalled();expect(adapter.clearListeningPlayback).not.toHaveBeenCalled();expect(ui.host.hasAttribute('data-intensive')).toBe(true);
});
it.each(['resolve','reject'])('hides a pending translation and ignores its late %s without changing the original toggle',async outcome=>{
 const hold=deferred();adapter.translateCurrent.mockReturnValueOnce(hold.promise);ui.$('listeningToggle').click();ui.$('listenOriginal').click();ui.$('listenChinese').click();ui.$('listenChinese').click();
 expect(adapter.translateCurrent).toHaveBeenCalledOnce();expect(ui.$('listenChinese').textContent).toBe('揭示中文');expect(ui.$('listenChinese').getAttribute('aria-busy')).toBe('false');expect(ui.$('practiceChineseStatus').hidden).toBe(true);expect(controller.hideOriginal()).toBe(false);
 if(outcome==='resolve')hold.resolve('STALE');else hold.reject(new Error('OLD FAILURE'));await flush();expect(ui.$('practiceChinese').hidden).toBe(true);expect(ui.$('practiceChineseStatus').hidden).toBe(true);
 ui.$('listenChinese').click();await flush();expect(ui.$('practiceChinese').textContent).toBe('中文译文');expect(ui.$('listenChinese').textContent).toBe('隐藏中文');
});
it.each(['next','exit','bilingual-off','revision','configuration','reset'])('rejects late Chinese after %s',async action=>{
 const hold=deferred();adapter.translateCurrent.mockReturnValueOnce(hold.promise);ui.$('listeningToggle').click();ui.$('listenChinese').click();
 if(action==='next')ui.$('listenNext').click();if(action==='exit')ui.$('listeningToggle').click();if(action==='bilingual-off')controller.clearChinese();if(action==='revision'){cues[0].revision++;controller.sync()}if(action==='configuration')controller.configurationChanged();if(action==='reset')controller.reset();
 hold.resolve('STALE');await flush();expect(ui.$('practiceChinese').textContent).not.toContain('STALE');expect(ui.$('practiceChineseStatus').textContent).not.toContain('正在翻译');expect(adapter.cancelChinese).toHaveBeenCalled();
});
it('exits without seeking, playback or recording actions and clears only listening playback ownership',async()=>{
 ui.$('listeningToggle').click();await flush();adapter.replay.mockClear();adapter.record.mockClear();ui.$('listeningToggle').click();
 expect(adapter.clearListeningPlayback).toHaveBeenCalledOnce();expect(adapter.replay).not.toHaveBeenCalled();expect(adapter.record).not.toHaveBeenCalled();expect(controller.hideOriginal()).toBe(false);expect(controller.hideChinese()).toBe(false);
});
