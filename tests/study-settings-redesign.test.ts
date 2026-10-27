import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {setupSettingsNavigation} from '../extension/study/settings-navigation.js';
import {updateStudySettings} from '../extension/study/settings-store.js';
import {createMemoryStorageArea} from './helpers/memory-storage-area.js';

beforeEach(()=>{
 document.body.innerHTML=new DOMParser().parseFromString(readFileSync('extension/study/options.html','utf8'),'text/html').body.innerHTML;
 history.replaceState(null,'','#subtitles');vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
});
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren()});

it('routes categories without losing unsaved fields, and skip-content does not switch categories',()=>{
 setupSettingsNavigation();
 const input=document.getElementById('model') as HTMLInputElement;input.value='unsaved-model';
 const link=document.querySelector<HTMLAnchorElement>('[data-settings-page="translation"]')!;link.click();
 expect(document.querySelectorAll('.settings-page:not([hidden])')).toHaveLength(1);
 expect(document.getElementById('translation')!.hidden).toBe(false);expect(link.getAttribute('aria-current')).toBe('page');
 document.querySelector<HTMLAnchorElement>('.skip-link')!.click();
 expect(document.activeElement?.id).toBe('settingsContent');expect(location.hash).toBe('#translation');
 document.querySelector<HTMLAnchorElement>('[data-settings-page="subtitles"]')!.click();link.click();
 expect(input.value).toBe('unsaved-model');
 history.replaceState(null,'','#recognition');window.dispatchEvent(new HashChangeEvent('hashchange'));
 expect(document.getElementById('recognition')!.hidden).toBe(false);
});

it('merges simultaneous language and model changes without losing provider settings',async()=>{
 const key='biliscriptJapaneseSettings';const storage=new Map<string,unknown>([[key,{apiKey:'fixture-key',sourceLanguage:'ja',asrModel:'small',retained:true}]]);
 const area=createMemoryStorageArea(storage);vi.stubGlobal('chrome',{storage:{local:area}});
 await Promise.all([updateStudySettings({sourceLanguage:'en'}),updateStudySettings({asrModel:'medium'})]);
 expect(storage.get(key)).toEqual({apiKey:'fixture-key',sourceLanguage:'en',asrModel:'medium',retained:true});
});

it('does not poison later independent settings writes when one write fails',async()=>{
 const key='biliscriptJapaneseSettings';const storage=new Map<string,unknown>([[key,{retained:true}]]);
 const area=createMemoryStorageArea(storage);area.set.mockRejectedValueOnce(new Error('fixture save failure'));vi.stubGlobal('chrome',{storage:{local:area}});
 await expect(updateStudySettings({sourceLanguage:'en'})).rejects.toThrow('fixture save failure');
 await updateStudySettings({asrModel:'medium'});expect(storage.get(key)).toEqual({retained:true,asrModel:'medium'});
});
