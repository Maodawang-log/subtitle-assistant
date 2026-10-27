import { expect,it } from 'vitest';
import { correctionStorageKey,createCorrectionWriter } from '../extension/study/manual-corrections.js';
import { createMemoryStorageArea } from './helpers/memory-storage-area.js';
it('persists independent video/P/language edits and restores only the selected sentence',async()=>{
 const disk=new Map(),storage=createMemoryStorageArea(disk),save=createCorrectionWriter(storage);
 const ja=correctionStorageKey('BV1:p1','ja'),en=correctionStorageKey('BV1:p1','en'),part=correctionStorageKey('BV1:p2','ja');
 const c={start:1,end:3,originalText:'original',text:'edit'};
 await Promise.all([save(ja,'BV1:111',c),save(ja,'BV1:111',{...c,start:4,end:6}),save(en,'BV1:111',c),save(part,'BV1:222',c)]);
 expect(disk.get(ja)['BV1:111']).toHaveLength(2);
 await createCorrectionWriter(storage)(ja,'BV1:111',{...c,text:'original'});
 expect(disk.get(ja)['BV1:111']).toEqual([{...c,start:4,end:6}]);
 expect(disk.get(en)['BV1:111']).toEqual([c]);expect(disk.get(part)['BV1:222']).toEqual([c]);
});
it('surfaces failed writes and allows retry without swallowing the first failure',async()=>{
 let fail=true;const disk=new Map(),storage=createMemoryStorageArea(disk);
 const save=createCorrectionWriter({get:storage.get,set:async (value:Record<string,unknown>)=>{if(fail)throw new Error('disk full');return storage.set(value)}});
 const c={start:1,end:3,originalText:'original',text:'edit'};
 await expect(save('test','video',c)).rejects.toThrow('disk full');fail=false;
 await save('test','video',c);expect(disk.get('test').video).toEqual([c]);
});
