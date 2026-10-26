/** Read only selected Japanese glyphs, excluding ruby readings and controls. */
export function selectedSubtitleText(root: HTMLElement, selection: Selection | null) {
 if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
 const range = selection.getRangeAt(0);
 if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
 const element = (node: Node) => node.nodeType === 1 ? node as Element : node.parentElement;
 const first = element(range.startContainer)?.closest<HTMLElement>("[data-study-text]");
 const last = element(range.endContainer)?.closest<HTMLElement>("[data-study-text]");
 if (!first || !last || !root.contains(first) || !root.contains(last)) return null;
 const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
 let text = "", current: Node | null, previous: Element | null = null;
 while ((current = walk.nextNode())) {
  const parent = current.parentElement, surface = parent?.closest("[data-study-text]");
  if (!surface || parent?.closest("rt,rp") || !range.intersectsNode(current)) continue;
  const start = current === range.startContainer ? range.startOffset : 0;
  const end = current === range.endContainer ? range.endOffset : current.textContent!.length;
  const part = current.textContent!.slice(start, end);
  if (part) { if (previous && previous !== surface) text += "\n"; text += part; previous = surface; }
 }
 text = text.trim();
 if (!text || text.length > 1500 || !/[\p{L}\p{N}]/u.test(text)) return null;
 return {text, first: first.dataset.cue || "", last: last.dataset.cue || "", index: Number(first.dataset.index || 0)};
}

export function createSubtitleSelection(options: {
 binding: () => string;
 onDrag: () => void;
 onSelect: (value: NonNullable<ReturnType<typeof selectedSubtitleText>>, binding: string) => void;
}) {
 type Point={node:Node;offset:number};
 let drag: {root: HTMLElement; x: number; y: number; binding: string; moved: boolean; pointer: number;anchor:Point|null} | null = null;
 let suppressUntil = 0;
 const bound = new WeakSet<HTMLElement>();
 function caret(root:HTMLElement,x:number,y:number):Point|null{
  const doc=document as Document & {caretPositionFromPoint?:(x:number,y:number,options:{shadowRoots:ShadowRoot[]})=>{offsetNode:Node;offset:number}|null};
  const tree=root.getRootNode();
  const point=doc.caretPositionFromPoint?.(x,y,{shadowRoots:tree instanceof ShadowRoot?[tree]:[]});
  if(!point||!root.contains(point.offsetNode)||!point.offsetNode.parentElement?.closest("[data-study-text]")||point.offsetNode.parentElement?.closest("rt,rp"))return null;
  return {node:point.offsetNode,offset:point.offset};
 }
 function bind(root: HTMLElement) {
  if (bound.has(root)) return;
  bound.add(root);
  root.addEventListener("pointerdown", e => {
   if (e.button !== 0 || !(e.target as Element).closest("[data-study-text]")) return;
   e.stopPropagation();
   const anchor=caret(root,e.clientX,e.clientY);
   // Chromium's shadow-aware caret API lets our subtitle surface retain drag
   // selection even when the native player cancels media-surface mouse defaults.
   if(anchor)e.preventDefault();
   drag = {root, x:e.clientX, y:e.clientY, binding:options.binding(), moved:false, pointer:e.pointerId,anchor};
  });
  // The native player cancels text selection on its own media surface. Keep
  // subtitle selection events local while preserving the browser default.
  for(const type of ["mousedown","selectstart","click"])root.addEventListener(type,e=>{if((e.target as Element)?.closest?.("[data-study-text]"))e.stopPropagation()});
 }
 function move(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointer) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) >= 4) {drag.moved = true; options.onDrag();}
  if(drag.moved&&drag.anchor){
   const point=caret(drag.root,e.clientX,e.clientY),scope=drag.root.getRootNode() as ShadowRoot & {getSelection?:()=>Selection|null};
   if(point){const selected=scope.getSelection?.()||document.getSelection();selected?.setBaseAndExtent(drag.anchor.node,drag.anchor.offset,point.node,point.offset);e.preventDefault();}
  }
 }
 function end(e: PointerEvent) {
  const current = drag; if (!current || e.pointerId !== current.pointer) return;
  drag = null;
  if (!current.moved) return;
  suppressUntil = Date.now() + 500;
  if (current.binding !== options.binding() || !current.root.isConnected) return;
  const scope = current.root.getRootNode() as ShadowRoot & {getSelection?: () => Selection | null};
  const value = selectedSubtitleText(current.root, scope.getSelection?.() || document.getSelection());
  if (!value) return;
  // Each pointer gesture ends once. Repeat gestures may reuse the AI cache or
  // retry a failed/unconfigured request; never blacklist a selection forever.
  options.onSelect(value, current.binding);
 }
 document.addEventListener("pointermove", move, true);
 document.addEventListener("pointerup", end, true);
 const cancel = () => {if (drag?.moved) suppressUntil = Date.now() + 500; drag = null;};
 document.addEventListener("pointercancel", cancel, true);
 return {bind, get active(){return !!drag;}, suppressClick:()=>Date.now()<suppressUntil,
  reset(){cancel();},
  destroy(){document.removeEventListener("pointermove",move,true);document.removeEventListener("pointerup",end,true);document.removeEventListener("pointercancel",cancel,true);cancel();}
 };
}
