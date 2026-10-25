// RFC-style CSV parsing for the pinned ECDICT file; never evaluate cell content.
export function* csvRows(input:string):Generator<string[]> {
 let field="",row:string[]=[],quoted=false,closed=false;
 const text=input.replace(/^\uFEFF/,"");
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c}
  else if(c===","){row.push(field);field="";closed=false}
  else if(c==="\n"||c==="\r"){
   row.push(field);yield row;row=[];field="";closed=false;if(c==="\r"&&text[i+1]==="\n")i++;
  }else if(c==='"'&&!field&&!closed)quoted=true;
  else{if(closed)throw new Error("CSV 引号后有无效内容");field+=c}
  if(field.length>64000)throw new Error("CSV 字段过长");
 }
 if(quoted)throw new Error("CSV 引号未闭合");
 if(row.length||field||closed){row.push(field);yield row}
}
export function ecdictTerm(row:string[],columns:Record<string,number>,generation:string,index:number){
 const word=row[columns.word],reading=row[columns.phonetic]||"";
 if(!word||word.length>200||reading.length>200)throw new Error("ECDICT 词条或音标格式无效");
 const chinese=(row[columns.translation]||"").replace(/\\n/g,"\n").trim(),english=(row[columns.definition]||"").replace(/\\n/g,"\n").trim();
 const meaning=(chinese+(english?(chinese?"\n\n":"")+"英文释义\n"+english:"")).slice(0,24000)||"此条目暂缺释义";
 return {generation,row:index,term:word.toLowerCase(),displayTerm:word,reading,meaning,sequence:index};
}
