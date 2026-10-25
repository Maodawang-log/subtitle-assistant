export interface DictionaryRelease {id:string;name:string;version:string;url:string;sha256:string;bytes:number;expectedRows?:number}
export const ZH_DICTIONARY:DictionaryRelease={
 id:"jitendex-zh",name:"Jitendex 社区日中词典",version:"v2026.08.11-zh.4",
 url:"https://github.com/greyindex/jitendex-yomitan-zh/releases/download/v2026.08.11-zh.4/jitendex-yomitan-zh-full-review-dedup-20260927.zip",
 sha256:"9872fc32d05e3f7ea9b5b70a253610e49d99b6eef7db519b96faad1bbec2b678",bytes:36703585,expectedRows:435448
};
export const DICTIONARY_ORIGINS=["https://github.com/*","https://api.github.com/*","https://release-assets.githubusercontent.com/*","https://objects.githubusercontent.com/*"];
export function validateRelease(raw:any):DictionaryRelease{
 if(raw?.id!=="jitendex-zh"||typeof raw.version!=="string"||raw.version.length>120||!/^https:\/\/github\.com\/greyindex\/jitendex-yomitan-zh\/releases\/download\/[^/]+\/jitendex-yomitan-zh[^/]+\.zip$/.test(raw.url)||!/^[a-f0-9]{64}$/.test(raw.sha256)||!Number.isInteger(raw.bytes)||raw.bytes<1000000||raw.bytes>96000000)throw new Error("词典发布元数据无效，未开始安装");
 return {id:ZH_DICTIONARY.id,name:ZH_DICTIONARY.name,version:raw.version,url:raw.url,sha256:raw.sha256,bytes:raw.bytes,...(raw.expectedRows?{expectedRows:raw.expectedRows}:{})};
}
export async function checkDictionaryUpdate(signal?:AbortSignal):Promise<DictionaryRelease>{
 const response=await fetch("https://api.github.com/repos/greyindex/jitendex-yomitan-zh/releases/latest",{credentials:"omit",signal});
 if(!response.ok)throw new Error("检查更新失败（HTTP "+response.status+"）；已安装词典仍可使用");
 const data=await response.json();
 const asset=data.assets?.filter((a:any)=>/^jitendex-yomitan-zh.*\.zip$/.test(a.name)&&!a.name.includes("details")).sort((a:any,b:any)=>b.size-a.size)[0];
 if(!asset||typeof asset.digest!=="string"||!asset.digest.startsWith("sha256:"))throw new Error("新发布未提供可验证的词典包及 SHA256；保留当前版本");
 return validateRelease({id:ZH_DICTIONARY.id,version:data.tag_name,url:asset.browser_download_url,sha256:asset.digest.slice(7),bytes:asset.size});
}
