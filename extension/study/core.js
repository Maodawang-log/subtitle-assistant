/* MIT — Japanese study additions. Pure functions shared by runtime and tests. */
var JSTUDY = (() => {
  const VERSION = "1";
  function resource(url) {
    const u = new URL(url); const bvid = u.pathname.match(/BV[0-9A-Za-z]{10}/)?.[0] || u.searchParams.get("bvid");
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || "")) return null;
    return { bvid, page: Math.max(1, parseInt(u.searchParams.get("p") || "1", 10) || 1) };
  }
  const keyOf = r => r ? r.bvid + ":p" + r.page : "";
  const isJa = lang => /^(?:ai-)?(?:ja|jp)(?:-|$)/i.test(lang || "");
  function normalize(rows) {
    return (Array.isArray(rows) ? rows : []).map((x,i) => ({
      id: String(x.id ?? i), start: Number(x.start ?? x.from),
      end: Number(x.end ?? x.to ?? (Number(x.start) + Number(x.duration))),
      text: String(x.text ?? x.content ?? "").replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim()
    })).filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.start >= 0 && x.end > x.start && x.text).sort((a,b)=>a.start-b.start);
  }
  function timestamp(t) {
    const m = String(t).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!m || +m[2] > 59 || +m[3] > 59) return NaN;
    return +(m[1] || 0)*3600 + +m[2]*60 + +m[3] + +(m[4].padEnd(3,"0"))/1000;
  }
  function parseSubtitle(text) {
    const lines = String(text).replace(/^\uFEFF/,"").replace(/\r/g,"").split("\n");
    const cues=[]; let i=0;
    while(i<lines.length) {
      const match=lines[i++].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
      if(!match) continue;
      const content=[]; while(i<lines.length && lines[i].trim()) content.push(lines[i++]);
      cues.push({start:timestamp(match[1]),end:timestamp(match[2]),text:content.join(" ")});
    }
    const result=normalize(cues);
    if(!result.length) throw new Error("没有读到有效时间轴。请选择 UTF-8 SRT 或 WebVTT 字幕。");
    if(result.length>20000) throw new Error("字幕超过 20,000 条，请分段导入。");
    return result;
  }
  function at(cues,t) {
    let lo=0,hi=cues.length-1,res=-1;
    while(lo<=hi){const mid=(lo+hi)>>1;if(cues[mid].start<=t){res=mid;lo=mid+1}else hi=mid-1}
    return res>=0 && t<cues[res].end ? res : -1;
  }
  function context(cues,i,radius=2) { return cues.slice(Math.max(0,i-radius),i+radius+1).map(c=>c.text).join("\n"); }
  function paired(cue,translations) {
    return translations.filter(c=>Math.min(c.end,cue.end)-Math.max(c.start,cue.start)>0.05).map(c=>c.text).join(" ");
  }
  const hiragana = text => String(text||"").replace(/[\u30a1-\u30f6]/g,c=>String.fromCharCode(c.charCodeAt(0)-96));
  function conjugation(token) {
    const map={"基本形":"词典形","連用形":"连用形（可接ます等）","連用タ接続":"连用形（接た／て）","未然形":"未然形（可接ない等）","仮定形":"假定形","命令ｅ":"命令形","連用デ接続":"连用形（接で）"};
    const form=token.conjugated_form;
    return form && form!=="*" ? (map[form] || form)+"；"+token.conjugated_type : "";
  }
  class Player {
    constructor(video){this.video=video;this.mode=null;this.cue=null;}
    clear(){this.mode=null;this.cue=null;}
    seekTime(time){this.video.__biliscriptOwnedSeek={time,until:Date.now()+1200};this.video.currentTime=time;}
    seekPause(cue){this.clear();this.video.pause();this.seekTime(cue.start);}
    async play(cue,loop=false){this.cue=cue;this.mode=loop?"loop":"once";this.seekTime(cue.start);try{await this.video.play()}catch(e){this.clear();throw e}}
    tick(){
      if(!this.cue || !this.mode || this.video.paused) return;
      if(this.video.currentTime>=this.cue.end){
        if(this.mode==="loop"){this.seekTime(this.cue.start);}
        else{this.video.pause();this.seekTime(Math.max(this.cue.start,this.cue.end-0.015));this.clear();}
      }
    }
  }
  return {VERSION,resource,keyOf,isJa,normalize,parseSubtitle,timestamp,at,context,paired,hiragana,conjugation,Player};
})();
if(typeof module!=="undefined") module.exports=JSTUDY;
