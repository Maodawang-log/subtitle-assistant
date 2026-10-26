export const APPEARANCE_KEY='biliscriptStudyAppearance';
export const DEFAULT_APPEARANCE={size:32,color:'#ffffff'};
export function normalizeAppearance(value:any){const size=Number(value?.size);return {size:Math.max(16,Math.min(52,Number.isFinite(size)&&size?size:32)),color:/^#[0-9a-f]{6}$/i.test(value?.color)?value.color.toLowerCase():'#ffffff'}}
export function appearanceCss(value:any){const v=normalizeAppearance(value);return `.ja{font-size:${v.size}px!important}.zh{font-size:${Math.round(v.size*.79)}px!important}.ja,.zh{color:${v.color}!important}rt{font-size:.4em!important}`}
export function setupAppearance(){
 const $=(id:string)=>document.getElementById(id) as HTMLInputElement;let state={...DEFAULT_APPEARANCE},write=Promise.resolve();
 function render(){for(const id of ['subtitleSize','subtitleSizeNumber'])$(id).value=String(state.size);$('subtitleColor').value=state.color;$('appearancePreview').style.fontSize=state.size+'px';$('appearancePreview').style.color=state.color}
 function save(){const snapshot={...state};write=write.catch(()=>{}).then(()=>chrome.storage.local.set({[APPEARANCE_KEY]:snapshot}));$('appearanceStatus').textContent='已保存，已打开的视频页会立即应用。'}
 void chrome.storage.local.get(APPEARANCE_KEY).then(data=>{state=normalizeAppearance(data[APPEARANCE_KEY]);render()});
 for(const id of ['subtitleSize','subtitleSizeNumber'])$(id).oninput=()=>{state=normalizeAppearance({...state,size:$(id).value});render();save()};
 $('subtitleColor').oninput=()=>{state=normalizeAppearance({...state,color:$('subtitleColor').value});render();save()};
 document.querySelectorAll<HTMLButtonElement>('[data-subtitle-color]').forEach(button=>button.onclick=()=>{state=normalizeAppearance({...state,color:button.dataset.subtitleColor});render();save()});
 $('appearanceReset').onclick=()=>{state={...DEFAULT_APPEARANCE};render();save()};
}
