// Reversible size constraints on the real native player, after SSR hydration.
// No native component is cloned, replaced or moved.
export function createCompactLayout(){
 const originals=new Map<HTMLElement,Map<string,{value:string;priority:string}>>();let target:HTMLElement|null=null;
 const set=(el:HTMLElement|null,property:string,value:string)=>{if(!el)return;let saved=originals.get(el);if(!saved){saved=new Map();originals.set(el,saved)}if(!saved.has(property))saved.set(property,{value:el.style.getPropertyValue(property),priority:el.style.getPropertyPriority(property)});if(el.style.getPropertyValue(property)!==value||el.style.getPropertyPriority(property)!=='important')el.style.setProperty(property,value,'important')};
 function restore(){for(const [el,values]of originals)for(const [name,old]of values){if(old.value)el.style.setProperty(name,old.value,old.priority);else el.style.removeProperty(name)}originals.clear();target=null}
 function apply(video:HTMLVideoElement|null,enabled:boolean){
  if(!enabled||document.fullscreenElement||innerWidth<900||document.querySelector('#app[data-server-rendered]')){restore();return false}
  const left=video?.closest<HTMLElement>('.left-container'),side=document.querySelector<HTMLElement>('.right-container'),player=video?.closest<HTMLElement>('#playerWrap,.player-wrap');
  if(!video||!left||!side||!player){restore();return false}
  if(target&&target!==player)restore();target=player;
  const parent=left.parentElement;if(parent&&side.parentElement===parent){set(parent,'display','flex');set(parent,'align-items','flex-start');set(parent,'gap','18px');set(parent,'width','calc(100% - 48px)');set(parent,'max-width','1800px');set(parent,'min-width','0')}
  const sideWidth=Math.max(280,Math.min(380,Math.round(innerWidth*.27)));
  set(left,'flex','1 1 0');set(left,'min-width','0');set(left,'width','0');set(side,'display','block');set(side,'flex','0 0 '+sideWidth+'px');set(side,'width',sideWidth+'px');set(side,'margin-left','0');set(side,'min-width','0');
  const top=player.getBoundingClientRect().top+scrollY;
  // The native bottom controls/danmaku band are part of the full player.
  // Fit using document position, not the user's current scroll position.
  const height=Math.max(260,Math.min(left.getBoundingClientRect().width*9/16+46,innerHeight-top-64));
  set(player,'height',Math.round(height)+'px');set(player,'min-height','0');set(player,'max-height','none');
  for(const node of player.querySelectorAll<HTMLElement>('#bilibili-player,.bpx-docker-major,.bpx-player-container')){set(node,'height','100%');set(node,'min-height','0')}
  set(video,'object-fit','contain');
  return true;
 }
 return {apply,restore};
}
