import {it,expect,vi,afterEach} from "vitest";
import {createStudyShell} from "../extension/study/ui-shell.js";
let shell:ReturnType<typeof createStudyShell>|undefined;
afterEach(()=>{shell?.destroy();document.body.replaceChildren();delete (document as any).fullscreenElement;vi.unstubAllGlobals();vi.restoreAllMocks()});
it("does not insert study hosts or alter sidebar styles before server DOM hydration finishes",()=>{
 vi.stubGlobal("chrome",{runtime:{getURL:(p:string)=>p}});
 document.body.innerHTML='<div id="app" data-server-rendered="true"><main class="left-container"><div id="playerWrap"><video></video></div><div id="native-actions">native actions</div></main><aside class="right-container"><div>native recommendations</div></aside></div>';
 const app=document.getElementById("app")!,before=app.outerHTML,video=app.querySelector("video")!;
 shell=createStudyShell();for(let i=0;i<8;i++)shell.mount(video);
 expect(app.outerHTML).toBe(before);expect(app.contains(shell.host)).toBe(false);expect(app.contains(shell.slot)).toBe(false);
 // Enabling early must not mutate the site's not-yet-hydrated DOM either.
 shell.setEnabled(true);shell.mount(video);expect(app.outerHTML).toBe(before);
 shell.setEnabled(false);app.removeAttribute("data-server-rendered");shell.mount(video);
 expect(shell.slot.previousElementSibling?.id).toBe("playerWrap");expect(document.querySelectorAll("#biliscript-study-slot")).toHaveLength(1);
});
it("reserves a sibling slot outside the fixed player wrapper through repeated mounts",()=>{
 vi.stubGlobal("chrome",{runtime:{getURL:(p:string)=>p}});
 document.body.innerHTML='<main class="left-container"><div id="playerWrap" style="height:400px"><div id="bilibili-player"><video></video></div></div><div id="native-actions">native actions</div></main>';
 shell=createStudyShell();const video=document.querySelector("video")!;
 for(let i=0;i<4;i++){shell.mount(video);shell.setEnabled(i%2===0)}
 expect(shell.slot.parentElement).toBe(document.querySelector(".left-container"));
 expect(shell.slot.previousElementSibling?.id).toBe("playerWrap");
 expect(shell.slot.nextElementSibling?.id).toBe("native-actions");
 expect(shell.controls.parentElement).toBe(shell.slot);
 expect(document.getElementById("playerWrap")!.contains(shell.controls)).toBe(false);
 expect(document.querySelectorAll("#biliscript-study-slot")).toHaveLength(1);
 shell.destroy();expect(document.querySelector("#biliscript-study-slot")).toBeNull();
});
it("moves the same controls into and out of fullscreen without duplicating the slot",()=>{
 vi.stubGlobal("chrome",{runtime:{getURL:(p:string)=>p}});
 document.body.innerHTML='<main class="left-container"><div id="playerWrap"><div class="bpx-player-container"><video></video></div></div><div id="native-actions"></div></main>';
 shell=createStudyShell();const video=document.querySelector("video")!,full=document.querySelector(".bpx-player-container")!;
 let fullscreen:Element|null=null;Object.defineProperty(document,"fullscreenElement",{configurable:true,get:()=>fullscreen});shell.mount(video);
 fullscreen=full;shell.mount(video);expect(shell.controls.parentElement).toBe(full);expect(shell.controls.hidden).toBe(true);
 shell.setEnabled(true);expect(shell.controls.hidden).toBe(false);
 fullscreen=null;shell.mount(video);expect(shell.controls.parentElement).toBe(shell.slot);expect(shell.slot.previousElementSibling?.id).toBe("playerWrap");
});
