// Single-sentence listening state stays separate from the global bilingual switch.
export function createListening(ui:any,adapter:any){
 const $=ui.$;let active=false,revealedOriginal=false,revealedChinese=false,key='',epoch=0,pending=false,chinese='',error='';
 const cueKey=()=>{const c=adapter.current();return c?JSON.stringify([adapter.binding(),c.id,c.revision,c.start,c.end,c.text]):''};
 const message=(text:string,failed=false)=>{$('listeningStatus').textContent=text;$('listeningStatus').classList.toggle('error',failed)};
 function cancelChinese(){epoch++;pending=false;adapter.cancelChinese?.()}
 function render(){
  const c=adapter.current(),all=adapter.material()?.cues||[],index=all.findIndex((x:any)=>x.id===c?.id);
  ui.host.toggleAttribute('data-intensive',active);ui.controls.toggleAttribute('data-intensive',active);
  for(const host of [ui.host,ui.controls])host.toggleAttribute('data-reveal-original',revealedOriginal);
  $('listeningToggle').textContent=active?'退出精听':'开始精听';$('listeningToggle').disabled=!c;
  $('listenPrev').disabled=!c||index<=0;$('listenNext').disabled=!c||index<0||index>=all.length-1;$('listenReplay').disabled=!c;
  for(const [id,revealed,label] of [['listenOriginal',revealedOriginal,'原文'],['listenChinese',revealedChinese,'中文']] as const){
   const control=$(id);control.disabled=!active;control.textContent=(revealed?'隐藏':'揭示')+label;control.setAttribute('aria-pressed',String(revealed));control.classList.toggle('on',revealed);
  }
  $('listenChinese').setAttribute('aria-busy',String(pending));
  $('practiceCue').textContent=c?.text||'开启字幕后显示当前句。';
  $('practiceChinese').textContent=revealedChinese?chinese:'';$('practiceChinese').hidden=!revealedChinese||!chinese;
  $('practiceChineseStatus').textContent=pending?'正在翻译当前句…':error;$('practiceChineseStatus').hidden=!pending&&!error;$('practiceChineseStatus').classList.toggle('error',!!error);
  adapter.updatePracticeCue?.(c);
 }
 function sync(){const next=cueKey();if(next!==key){key=next;cancelChinese();revealedOriginal=false;revealedChinese=false;chinese='';error=''}render()}
 function redraw(){render();adapter.redraw()}
 function clearChinese(){cancelChinese();revealedChinese=false;chinese='';error='';render()}
 async function play(delta=0){
  if(!adapter.current())return;
  if(delta){const all=adapter.material()?.cues||[],index=all.findIndex((c:any)=>c.id===adapter.current()?.id);if(index+delta<0||index+delta>=all.length)return;adapter.selectRelative(delta);sync()}
  const owner=key,version=epoch;
  await adapter.replay(active);
  if(owner===key&&version===epoch)message(active?'本句结束自动暂停；可揭示原文、中文或重听。':'播放到本句结束后暂停。');
 }
 const run=(task:()=>Promise<void>)=>void task().catch(e=>message(e.message,true));
 $('listeningToggle').onclick=()=>{
  if(active){active=false;clearChinese();revealedOriginal=false;adapter.clearListeningPlayback?.();redraw();message('精听已退出。');return}
  if(!adapter.current())return;active=true;sync();revealedOriginal=false;clearChinese();redraw();run(()=>play());
 };
 $('listenPrev').onclick=()=>run(()=>play(-1));$('listenReplay').onclick=()=>run(()=>play());$('listenNext').onclick=()=>run(()=>play(1));
 $('listenOriginal').onclick=()=>{if(active){sync();revealedOriginal=!revealedOriginal;redraw()}};
 $('listenChinese').onclick=async()=>{
  if(!active||!adapter.current())return;
  sync();
  if(revealedChinese){cancelChinese();revealedChinese=false;error='';render();return}
  const c={...adapter.current()},owner=key,version=++epoch;
  revealedChinese=true;chinese=chinese||adapter.availableChinese?.(c)||'';error='';
  if(chinese){render();return}
  pending=true;render();
  const valid=()=>active&&key===owner&&epoch===version&&cueKey()===owner;
  try{const text=await adapter.translateCurrent(c,valid);if(valid()){if(!text)throw new Error('未取得当前句译文，请重试。');chinese=text}}
  catch(e){if(valid()){revealedChinese=false;error=(e as Error).message+' 点击“揭示中文”重试。'}}
  finally{if(valid()){pending=false;render()}}
 };

 render();
 return {sync,clearChinese,hideOriginal:()=>active&&!revealedOriginal,hideChinese:()=>active,
  reset(){active=false;key='';clearChinese();revealedOriginal=false;adapter.clearListeningPlayback?.();render()},
  configurationChanged(){clearChinese()},
 };
}
