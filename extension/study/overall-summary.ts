import { overallBasis, overallBasisLabel, materialCoverage, type OverallBasis, type VideoMaterial } from './learning-data.js';

export interface OverallSummaryScope { version:1; kind:'overall'; basis:OverallBasis }
export function overallSourcePlan(m:VideoMaterial, model?:string) {
 const basis=overallBasis(m);
 if(basis&&(m.source!=='asr'||!model||m.asrModel===model))return {action:'ready' as const,basis};
 return {action:m.source==='cc'?'refresh-cc' as const:m.source==='import'?'confirm-import' as const:'collect-asr' as const};
}
export function overallScope(m:VideoMaterial):OverallSummaryScope {
 const basis=overallBasis(m);
 if(!basis||!m.cues?.length)throw new Error('全片资料尚未准备成功，未请求整体总结。');
 return {version:1,kind:'overall',basis};
}
export function summaryScopeLabel(snapshot:{overall?:OverallSummaryScope;material:VideoMaterial}) {
 const basis=overallBasis(snapshot.material);
 if(snapshot.overall?.version===1&&snapshot.overall.kind==='overall'&&basis===snapshot.overall.basis)return `整体总结 · ${overallBasisLabel(basis)}`;
 return '历史／局部总结（未按整体总结流程验证）';
}
export function summaryScopeText(snapshot:{overall?:OverallSummaryScope;material:VideoMaterial}) {
 const label=summaryScopeLabel(snapshot),coverage=materialCoverage({...snapshot.material,cues:[]}).text.replace(' · 0 句','');
 const detail=label.startsWith('整体总结')?coverage.split(' · ').slice(1).join(' · '):coverage;
 return [label,detail].filter(Boolean).join(' · ');
}
