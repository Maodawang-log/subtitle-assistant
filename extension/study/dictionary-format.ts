// Yomitan structured content is data. No HTML, URL or image is executed.
export function glossaryText(value:unknown,depth=0):string{
 if(depth>32||value==null)return "";
 if(typeof value==="string")return value;
 if(Array.isArray(value))return value.map(v=>glossaryText(v,depth+1)).join("").slice(0,24000);
 if(typeof value!=="object")return "";
 const v=value as Record<string,any>;
 if(v.data?.content==="attribution"||v.tag==="rt")return "";
 const text=glossaryText(v.content??v.text,depth+1);
 if(v.data?.class==="tag")return "（"+text+"）";
 return ["div","ul","ol","li","p"].includes(v.tag)?"\n"+text+"\n":text;
}
export function parseTerm(row:unknown,generation:string,index:number){
 if(!Array.isArray(row)||row.length<6||typeof row[0]!=="string"||typeof row[1]!=="string"||row[0].length>200||row[1].length>200||!Array.isArray(row[5]))throw new Error("词条格式不符合 Yomitan term_bank");
 const meaning=row[5].map((entry:unknown)=>glossaryText(entry)).join("\n").replace(/\n{3,}/g,"\n\n").trim();
 return {generation,row:index,term:row[0],reading:row[1],meaning,sequence:typeof row[6]==="number"?row[6]:index};
}
