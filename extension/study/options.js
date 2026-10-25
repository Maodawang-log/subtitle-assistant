const key="biliscriptJapaneseSettings",$=id=>document.getElementById(id);let previous={};
chrome.storage.local.get(key).then(x=>{previous=x[key]||{};$("autoStart").checked=!!previous.autoStart;$("asrModel").value=previous.asrModel||"small";$("autoTranslate").checked=previous.autoTranslate!==false;$("baseUrl").value=previous.baseUrl||"https://api.deepseek.com";$("model").value=previous.model||"deepseek-v4-flash";$("status").textContent=previous.apiKey?"已保存 Key；留空可保持。":"尚未配置 Key。"});
$("save").onclick=async()=>{
 try{
  const u=new URL($("baseUrl").value.trim());if(u.protocol!=="https:"&&!(u.protocol==="http:"&&["localhost","127.0.0.1"].includes(u.hostname)))throw new Error("请输入HTTPS或本机HTTP地址");
  const granted=await chrome.permissions.request({origins:[u.origin+"/*"]});if(!granted)throw new Error("未允许访问该接口域名，未保存");
  const data={asrModel:$("asrModel").value,autoStart:$("autoStart").checked,autoTranslate:$("autoTranslate").checked,baseUrl:u.href.replace(/\/+$/,""),model:$("model").value.trim(),apiKey:$("apiKey").value.trim()||previous.apiKey||""};
  if(!data.model)throw new Error("请填写模型名");await chrome.storage.local.set({[key]:data});previous=data;$("apiKey").value="";$("status").textContent="已保存。关闭学习再开启会应用新设置。";
 }catch(e){$("status").textContent=e.message}
};
$("health").onclick=async()=>{try{const r=await chrome.runtime.sendMessage({type:"study-local-asr",action:"health",requestId:crypto.randomUUID()});if(!r?.ok)throw new Error(r?.error?.message||"本地服务未启动");$("status").textContent="本地服务可用："+JSON.stringify(r.data)}catch(e){$("status").textContent=e.message+"。请运行E盘local-asr的启动脚本。"}};
