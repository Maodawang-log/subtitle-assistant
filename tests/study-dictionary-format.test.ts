import {it,expect} from "vitest";
import {glossaryText,parseTerm} from "../extension/study/dictionary-format.js";
import {validateRelease,ZH_DICTIONARY,JA_EN_DICTIONARY,EN_DICTIONARY} from "../extension/study/dictionary-catalog.js";
it("flattens Yomitan structured meanings as inert text including all senses",()=>{
 const term=parseTerm(["食べる","たべる","","",0,[{type:"structured-content",content:[{tag:"li",content:"吃"},{tag:"li",content:"生活；维持生计"},{tag:"img",src:"https://untrusted.test/image"},{tag:"div",data:{content:"attribution"},content:"JMdict"}]}],1358280,""],"test",0);
 expect(term.meaning).toContain("吃");expect(term.meaning).toContain("维持生计");expect(term.meaning).not.toContain("https");expect(term.meaning).not.toContain("JMdict");
 expect(glossaryText({tag:"script",content:"<img onerror=x>"})).toBe("<img onerror=x>"); // rendered only with textContent
});
it("binds language, parser and attribution to the verified catalog, not incoming metadata",()=>{
 for(const release of [JA_EN_DICTIONARY,EN_DICTIONARY])expect(validateRelease(release)).toEqual(release);
 const value=validateRelease({...EN_DICTIONARY,sourceLanguage:"ja",targetLanguage:"ko",format:"yomitan",name:"spoofed",license:"unknown"});
 expect(value).toEqual(EN_DICTIONARY);
});
it("rejects cross-dictionary assets and an unverified ECDICT revision",()=>{
 for(const value of [{...JA_EN_DICTIONARY,url:ZH_DICTIONARY.url},{...ZH_DICTIONARY,url:JA_EN_DICTIONARY.url},{...EN_DICTIONARY,url:EN_DICTIONARY.url.replace("ab22ad36302cafc6349a050e2b60894855208055","master")},{...EN_DICTIONARY,id:"korean-placeholder"}])expect(()=>validateRelease(value)).toThrow();
});
it("only accepts pinned project dictionary ZIP assets and mandatory hashes",()=>{
 expect(validateRelease(ZH_DICTIONARY)).toEqual(ZH_DICTIONARY);
 for(const patch of [{url:ZH_DICTIONARY.url.replace("github.com","evil.example")},{sha256:""},{bytes:1000000000},{url:ZH_DICTIONARY.url.replace("jitendex-yomitan-zh-full","review-details")}])expect(()=>validateRelease({...ZH_DICTIONARY,...patch})).toThrow();
});
