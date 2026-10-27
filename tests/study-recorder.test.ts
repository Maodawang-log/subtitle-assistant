import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {createInlineRecorder} from "../extension/study/inline-recorder.js";
let getUserMedia:any,track:any,ui:any,recording:any,created:any[]=[];
class Recorder {
 static isTypeSupported(){return true}state="inactive";mimeType="audio/webm";ondataavailable:any;onstop:any;onerror:any;
 constructor(){created.push(this)}
 start(){this.state="recording"}stop(){this.state="inactive"}
 finish(text="audio"){this.ondataavailable?.({data:new Blob([text])});this.onstop?.()}
}
const $=(id:string)=>document.getElementById(id) as any;
async function click(id:string){$(id).click();for(let i=0;i<12;i++)await Promise.resolve()}
beforeEach(()=>{
 vi.useFakeTimers();created=[];track={stop:vi.fn()};getUserMedia=vi.fn(async()=>({getTracks:()=>[track]}));
 Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia}});
 vi.stubGlobal("MediaRecorder",Recorder);vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(()=>{});
 vi.stubGlobal("URL",Object.assign(URL,{createObjectURL:vi.fn(()=>"blob:test"),revokeObjectURL:vi.fn()}));
 document.body.innerHTML='<section id="practice" hidden><p id="practiceCue"></p><p id="practiceStatus"></p><p id="practiceTime"></p><audio id="micAudio"></audio>'+["micStart","micStop","micReplay","micSave","micOriginal","practiceClose"].map(id=>'<button id="'+id+'"></button>').join("")+'</section>';
 ui={$ ,pin:vi.fn(),reveal:vi.fn()};recording=createInlineRecorder(ui,vi.fn(async()=>{}),vi.fn());recording.open({start:1,end:3,text:"第一句"});
});
afterEach(()=>{recording.clear();vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()});
it("uses independent recording data and blocks immediate restart until stop delivery",async()=>{
 await click("micStart");await click("micStop");expect($("micStart").disabled).toBe(true);
 await click("micStart");expect(created).toHaveLength(1);
 created[0].finish("old");expect($("micStart").disabled).toBe(false);
 await click("micStart");created[0].ondataavailable({data:new Blob(["late-old"])});
 await click("micStop");created[1].finish("new");
 const calls=vi.mocked(URL.createObjectURL).mock.calls;
 expect((calls.at(-1)![0] as Blob).size).toBe(3);
 expect(track.stop).toHaveBeenCalled();
});
it("stops a late microphone grant after practice closes",async()=>{
 let resolve:any;getUserMedia.mockImplementation(()=>new Promise(r=>resolve=r));
 await click("micStart");await click("practiceClose");resolve({getTracks:()=>[track]});
 for(let i=0;i<12;i++)await Promise.resolve();
 expect(track.stop).toHaveBeenCalledTimes(1);expect(created).toHaveLength(0);
});
it("clears old blob when opening a different sentence and releases tracks on close",async()=>{
 await click("micStart");await click("micStop");created[0].finish();
 expect($("micSave").disabled).toBe(false);
 recording.open({start:4,end:6,text:"第二句"});
 expect($("micSave").disabled).toBe(true);expect($("micAudio").hasAttribute("src")).toBe(false);expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it("reports denied microphone permission and allows retry without opening tabs",async()=>{
 getUserMedia.mockRejectedValue(new DOMException("denied","NotAllowedError"));
 await click("micStart");expect($("practiceStatus").textContent).toContain("未获允许");expect($("micStart").disabled).toBe(false);
});
it('shows the current listening sentence without microphone access or discarding the existing recording',async()=>{
 await click('micStart');await click('micStop');created[0].finish('kept');const url=$('micAudio').src;getUserMedia.mockClear();vi.mocked(URL.revokeObjectURL).mockClear();
 recording.show({start:4,end:6,text:'第二句'});recording.setCurrent({start:7,end:9,text:'第三句'});
 expect($('practice').hidden).toBe(false);expect($('practiceCue').textContent).toBe('第三句');expect($('micAudio').src).toBe(url);expect($('micSave').disabled).toBe(false);expect(getUserMedia).not.toHaveBeenCalled();expect(URL.revokeObjectURL).not.toHaveBeenCalled();
});
