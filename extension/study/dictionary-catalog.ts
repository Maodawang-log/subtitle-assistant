export type DictionaryLanguage = "ja" | "en";
export interface DictionaryRelease {id:string;name:string;sourceLanguage:DictionaryLanguage;targetLanguage:string;format:"yomitan"|"ecdict-csv";version:string;url:string;sha256:string;bytes:number;expectedRows?:number;source:string;license:string;licenseUrl:string;attribution:string;quality:string}
const jitendexLicense={license:"CC BY-SA 4.0",licenseUrl:"https://creativecommons.org/licenses/by-sa/4.0/",attribution:"Stephen Kraus 2023–2026；EDRDG / JMdict。Tatoeba 例句另按 CC BY 2.0 FR。"};
export const ZH_DICTIONARY:DictionaryRelease={
 id:"jitendex-zh",name:"Jitendex 社区日中词典",sourceLanguage:"ja",targetLanguage:"zh",format:"yomitan",version:"v2026.08.11-zh.4",
 url:"https://github.com/greyindex/jitendex-yomitan-zh/releases/download/v2026.08.11-zh.4/jitendex-yomitan-zh-full-review-dedup-20260927.zip",
 sha256:"9872fc32d05e3f7ea9b5b70a253610e49d99b6eef7db519b96faad1bbec2b678",bytes:36703585,expectedRows:435448,
 source:"https://github.com/greyindex/jitendex-yomitan-zh",...jitendexLicense,quality:"社区 AI 译制 / 模型校订；并非人工权威词典，也非上游官方日中版。"
};
export const JA_EN_DICTIONARY:DictionaryRelease={
 id:"jitendex-en",name:"Jitendex 官方日英词典",sourceLanguage:"ja",targetLanguage:"en",format:"yomitan",version:"2026.10.03.0",
 url:"https://github.com/stephenmk/stephenmk.github.io/releases/download/2026.10.03.0/jitendex-yomitan.zip",
 sha256:"e914c76596220dffc6ee0c069cd05992f03adb2988c12c3cebe817a3ac271356",bytes:38831822,expectedRows:436555,
 source:"https://jitendex.org/pages/downloads.html",...jitendexLicense,quality:"日语词条、英文释义；不是中文词典。"
};
export const EN_DICTIONARY:DictionaryRelease={
 id:"ecdict-en-zh",name:"ECDICT 英汉双解词典",sourceLanguage:"en",targetLanguage:"zh",format:"ecdict-csv",version:"ab22ad36",
 url:"https://raw.githubusercontent.com/skywind3000/ECDICT/ab22ad36302cafc6349a050e2b60894855208055/ecdict.csv",
 sha256:"d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc",bytes:66009548,expectedRows:770611,
 source:"https://github.com/skywind3000/ECDICT",license:"MIT",licenseUrl:"https://github.com/skywind3000/ECDICT/blob/ab22ad36302cafc6349a050e2b60894855208055/LICENSE",attribution:"Copyright (c) 2025 Linwei. MIT License；完整许可随扩展保存。",
 quality:"社区汇编的基础 CSV 版本；373 条没有中文释义，显示其英文释义。不是发布页的340万词增强版。"
};
export const DICTIONARIES=[ZH_DICTIONARY,JA_EN_DICTIONARY,EN_DICTIONARY];
export const getDictionary=(id:string)=>DICTIONARIES.find(item=>item.id===id);
export const DICTIONARY_ORIGINS=["https://github.com/*","https://api.github.com/*","https://release-assets.githubusercontent.com/*","https://objects.githubusercontent.com/*","https://raw.githubusercontent.com/*"];
export function validateRelease(raw:any):DictionaryRelease{
 const catalog=getDictionary(raw?.id);
 const allowed=catalog?.id==="jitendex-zh"?/^https:\/\/github\.com\/greyindex\/jitendex-yomitan-zh\/releases\/download\/[^/]+\/jitendex-yomitan-zh[^/]+\.zip$/.test(raw.url)
  :catalog?.id==="jitendex-en"?/^https:\/\/github\.com\/stephenmk\/stephenmk\.github\.io\/releases\/download\/[^/]+\/jitendex-yomitan\.zip$/.test(raw.url)
  :catalog?.id==="ecdict-en-zh"&&raw.url===EN_DICTIONARY.url;
 if(!catalog||!allowed||typeof raw.version!=="string"||raw.version.length>120||!/^[a-f0-9]{64}$/.test(raw.sha256)||!Number.isInteger(raw.bytes)||raw.bytes<1000000||raw.bytes>96000000||raw.expectedRows!==undefined&&(!Number.isInteger(raw.expectedRows)||raw.expectedRows<1))throw new Error("词典发布元数据无效，未开始安装");
 const {expectedRows:_,...base}=catalog;
 return {...base,version:raw.version,url:raw.url,sha256:raw.sha256,bytes:raw.bytes,...(raw.expectedRows?{expectedRows:raw.expectedRows}:{})};
}
export async function checkDictionaryUpdate(signal?:AbortSignal,id=ZH_DICTIONARY.id):Promise<DictionaryRelease>{
 const catalog=getDictionary(id);if(!catalog)throw new Error("未提供这个词典资源");
 if(catalog.format==="ecdict-csv")return catalog;
 const repo=id==="jitendex-en"?"stephenmk/stephenmk.github.io":"greyindex/jitendex-yomitan-zh";
 const response=await fetch("https://api.github.com/repos/"+repo+"/releases/latest",{credentials:"omit",signal});
 if(!response.ok)throw new Error("检查更新失败（HTTP "+response.status+"）；已安装词典仍可使用");
 const data=await response.json();
 const asset=data.assets?.filter((a:any)=>id==="jitendex-en"?a.name==="jitendex-yomitan.zip":/^jitendex-yomitan-zh.*\.zip$/.test(a.name)&&!a.name.includes("details")).sort((a:any,b:any)=>b.size-a.size)[0];
 if(!asset||typeof asset.digest!=="string"||!asset.digest.startsWith("sha256:"))throw new Error("新发布未提供可验证的词典包及 SHA256；保留当前版本");
 return validateRelease({id,version:data.tag_name,url:asset.browser_download_url,sha256:asset.digest.slice(7),bytes:asset.size,...(data.tag_name===catalog.version?{expectedRows:catalog.expectedRows}:{})});
}
