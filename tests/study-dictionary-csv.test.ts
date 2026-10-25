import {it,expect} from "vitest";
import {csvRows,ecdictTerm} from "../extension/study/dictionary-csv.js";
import {DICTIONARIES,EN_DICTIONARY,JA_EN_DICTIONARY,validateRelease} from "../extension/study/dictionary-catalog.js";
it("parses commas, escaped quotes, embedded newlines, CRLF and BOM without evaluating CSV content",()=>{
 expect([...csvRows('\uFEFFword,meaning\r\n"a,b","line 1\nline ""2"""\r\n=1+1,<script>\r\n')]).toEqual([["word","meaning"],["a,b",'line 1\nline "2"'],["=1+1","<script>"]]);
 expect(()=>[...csvRows('word,"unfinished')]).toThrow("引号未闭合");
 expect(()=>[...csvRows('word,"closed"oops')]).toThrow("无效内容");
});
it("keeps display spelling and phonetics while indexing English case-insensitively",()=>{
 const row=ecdictTerm(["Hello","hə'ləu","interj. 喂\\n你好","greeting"],{word:0,phonetic:1,translation:2,definition:3},"gen",4);
 expect(row).toMatchObject({term:"hello",displayTerm:"Hello",reading:"hə'ləu",meaning:"interj. 喂\n你好\n\n英文释义\ngreeting",row:4});
});
it("marks missing definitions rather than inventing a translation",()=>{
 expect(ecdictTerm(["example","","",""],{word:0,phonetic:1,translation:2,definition:3},"gen",0).meaning).toBe("此条目暂缺释义");
});
it("binds language and format to verified catalog entries, not worker message claims",()=>{
 expect(DICTIONARIES.map(d=>d.id)).toEqual(["jitendex-zh","jitendex-en","ecdict-en-zh"]);
 expect(validateRelease({...EN_DICTIONARY,sourceLanguage:"ja",format:"yomitan"})).toEqual(EN_DICTIONARY);
 expect(validateRelease(JA_EN_DICTIONARY)).toEqual(JA_EN_DICTIONARY);
 expect(()=>validateRelease({...EN_DICTIONARY,url:EN_DICTIONARY.url.replace('ab22ad36302cafc6349a050e2b60894855208055','master')})).toThrow();
 expect(()=>validateRelease({...EN_DICTIONARY,id:"korean-placeholder"})).toThrow();
});
