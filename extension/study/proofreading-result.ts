export interface ProofreadingSuggestion {status:'suggested'|'unchanged'|'uncertain';suggestedText:string;reason:string}
export function parseProofreading(text:string,original:string):ProofreadingSuggestion{
 let value:any;try{value=JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?/i,'').replace(/\n?```$/,''))}catch{throw new Error('校对结果不是完整建议，请重试；字幕未修改。')}
 if(!value||Array.isArray(value)||!['suggested','unchanged','uncertain'].includes(value.status)||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>1800||typeof value.suggestedText!=='string'||value.suggestedText.length>2000||Object.keys(value).some(k=>!['status','suggestedText','reason'].includes(k)))throw new Error('校对结果格式不完整，请重试；字幕未修改。');
 const suggestedText=value.status==='unchanged'?original:value.suggestedText.trim();
 if(value.status==='suggested'&&(!suggestedText||suggestedText===original))return {status:'unchanged',suggestedText:original,reason:value.reason.trim()};
 return {status:value.status,suggestedText,reason:value.reason.trim()};
}
