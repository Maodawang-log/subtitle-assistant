export const APPEARANCE_KEY='biliscriptStudyAppearance';
export interface SubtitleAppearance {mode:'auto'|'manual';size:number;color:string}
export const DEFAULT_APPEARANCE:SubtitleAppearance={mode:'auto',size:32,color:'#ffffff'};
export function normalizeAppearance(value:any):SubtitleAppearance{const size=Number(value?.size);return {mode:value?.mode==='manual'?'manual':'auto',size:Math.max(16,Math.min(52,Number.isFinite(size)&&size?size:32)),color:/^#[0-9a-f]{6}$/i.test(value?.color)?value.color.toLowerCase():'#ffffff'}}
export function resolveSubtitleSize(value:any,player?:{width:number;height:number}){
 const v=normalizeAppearance(value);if(v.mode==='manual')return v.size;
 if(!player||!Number.isFinite(player.width)||!Number.isFinite(player.height)||player.width<=0||player.height<=0)return 32;
 return Math.round(Math.max(20,Math.min(34,player.width*.032,player.height*.065)));
}
export function appearanceCss(value:any,player?:{width:number;height:number}){const v=normalizeAppearance(value),size=resolveSubtitleSize(v,player);return `.ja{font-size:${size}px!important}.zh{font-size:${Math.round(size*.79)}px!important}.ja,.zh{color:${v.color}!important}rt{font-size:.4em!important}`}
export function setupAppearance(){
 const $=(id:string)=>document.getElementById(id) as HTMLInputElement;let state={...DEFAULT_APPEARANCE},write=Promise.resolve(),pending=0,closed=false;
 function render(){
  const auto=state.mode==='auto';$('subtitleSizeMode').value=state.mode;
  for(const id of ['subtitleSize','subtitleSizeNumber']){$(id).value=String(state.size);$(id).disabled=auto}
  $('subtitleColor').value=state.color;$('appearancePreview').style.fontSize=(auto?32:state.size)+'px';$('appearancePreview').style.color=state.color;
  const hint=$('appearanceModeHint');if(hint)hint.textContent=auto?'字号随播放器实际大小调整；已保留手动字号 '+state.size+'。':'使用固定字号，切换窗口或全屏时保持。';
  const label=$('appearancePreviewLabel');if(label)label.textContent=auto?'自动模式预览（示意）':'手动模式预览 · '+state.size+'px';
 }
 function save(){const snapshot={...state};pending++;write=write.catch(()=>{}).then(()=>chrome.storage.local.set({[APPEARANCE_KEY]:snapshot})).then(()=>{$('appearanceStatus').textContent='已保存，已打开的视频页会立即应用。'},()=>{$('appearanceStatus').textContent='保存失败，请重试。'}).finally(()=>pending--)}
 void chrome.storage.local.get(APPEARANCE_KEY).then(data=>{if(!closed){state=normalizeAppearance(data[APPEARANCE_KEY]);render()}});
 $('subtitleSizeMode').onchange=()=>{state=normalizeAppearance({...state,mode:$('subtitleSizeMode').value});render();save()};
 for(const id of ['subtitleSize','subtitleSizeNumber'])$(id).oninput=()=>{if(state.mode!=='manual')return;state=normalizeAppearance({...state,size:$(id).value});render();save()};
 $('subtitleColor').oninput=()=>{state=normalizeAppearance({...state,color:$('subtitleColor').value});render();save()};
 document.querySelectorAll<HTMLButtonElement>('[data-subtitle-color]').forEach(button=>button.onclick=()=>{state=normalizeAppearance({...state,color:button.dataset.subtitleColor});render();save()});
 $('appearanceReset').onclick=()=>{state={...DEFAULT_APPEARANCE};render();save()};
 const changed=(changes:any,area:string)=>{if(!closed&&area==='local'&&changes[APPEARANCE_KEY]&&!pending){state=normalizeAppearance(changes[APPEARANCE_KEY].newValue);render()}};
 chrome.storage.onChanged?.addListener(changed);
 addEventListener('pagehide',()=>{closed=true;chrome.storage.onChanged?.removeListener(changed)},{once:true});
}
