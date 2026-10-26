"""Online metadata from the upstream mapping and pinned Hugging Face blobs.
No remote Python is executed and catalog refresh never requests model.bin.
"""
import ast, json, re, time, urllib.request

MAPPING_URL='https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/faster_whisper/utils.py'
FILES={'model.bin','config.json','tokenizer.json','vocabulary.json','vocabulary.txt','preprocessor_config.json'}

def metadata_read(url, limit=2_000_000):
    from manager import allowed_download
    if url != MAPPING_URL: allowed_download(url)
    class CheckedRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,headers,newurl):
            if url==MAPPING_URL:raise ValueError('官方映射不接受重定向。')
            allowed_download(newurl)
            return super().redirect_request(req,fp,code,msg,headers,newurl)
    request=urllib.request.Request(url,headers={'User-Agent':'BiliScriptLocalModels/1.1'})
    with urllib.request.build_opener(CheckedRedirect()).open(request,timeout=15) as response:
        final=response.geturl()
        if url==MAPPING_URL:
            if final!=MAPPING_URL:raise ValueError('官方模型目录发生未预期跳转。')
        else:allowed_download(final)
        data=response.read(limit+1)
    if len(data)>limit:raise ValueError('模型元数据超过大小限制。')
    return data

def parse_mapping(source):
    if len(source)>500_000:raise ValueError('官方映射过大。')
    value=None
    for node in ast.parse(source).body:
        if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='_MODELS' for target in node.targets):value=ast.literal_eval(node.value)
    if not isinstance(value,dict) or not 1<=len(value)<=64:raise ValueError('官方兼容映射格式已变化。')
    result={}
    for alias,repo in value.items():
        if not isinstance(alias,str) or not re.fullmatch(r'[a-zA-Z0-9_.-]{1,80}',alias) or not isinstance(repo,str) or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo):raise ValueError('模型映射包含不支持的标识。')
        result.setdefault(repo,[]).append(alias)
    return result

def release_from_metadata(repo,aliases,data):
    revision=data.get('sha','')
    if not re.fullmatch(r'[0-9a-f]{40}',revision):raise ValueError('缺少可固定的模型版本。')
    model=next((name for name in aliases if name not in {'large','turbo'}),aliases[0]);files={}
    for entry in data.get('siblings',[]):
        name=entry.get('rfilename');size=entry.get('size')
        if name not in FILES:continue
        if not isinstance(size,int) or not 0<size<=8_000_000_000:raise ValueError('模型文件大小无效。')
        sha=(entry.get('lfs') or {}).get('sha256');blob=entry.get('blobId')
        if isinstance(sha,str) and re.fullmatch(r'[a-f0-9]{64}',sha):digest={'sha256':sha}
        elif name!='model.bin' and isinstance(blob,str) and re.fullmatch(r'[a-f0-9]{40}',blob):digest={'gitSha1':blob}
        else:raise ValueError('模型文件缺少可信摘要。')
        files[name]={'bytes':size,**digest}
    if not {'model.bin','config.json','tokenizer.json'}.issubset(files) or not {'vocabulary.json','vocabulary.txt'}&files.keys():raise ValueError('尚不具备完整的离线 Whisper 文件。')
    languages=(data.get('cardData') or {}).get('language',[])
    if isinstance(languages,str):languages=[languages]
    languages=[language for language in languages if isinstance(language,str)] if isinstance(languages,list) else []
    known_multilingual={'Systran/faster-whisper-'+name for name in ('tiny','base','small','medium','large-v1','large-v2','large-v3')}|{'mobiuslabsgmbh/faster-whisper-large-v3-turbo','dropbox-dash/faster-whisper-large-v3-turbo'}
    japanese='ja' in languages or not languages and repo in known_multilingual
    english=languages==['en'] or not languages and all(alias.endswith('.en') or alias.startswith('distil-') for alias in aliases)
    language='多语言（含日语）' if japanese else '英语' if english else '语言：'+', '.join(languages) if languages else '语言未确认'
    positioning='轻量，适合先试；实际效果取决于音频。' if model.startswith(('tiny','base')) else '速度优先的裁剪版本，可能牺牲准确性。' if 'turbo' in model or 'distil' in model else '计算与显存需求较高；大小不代表每段音频都更准。' if model.startswith('large') else '平衡资源占用与识别效果。' if model=='small' else '计算量较高，可与 small 对比同一段音频。'
    return model,{'repo':repo,'revision':revision,'name':'Whisper '+model,'aliases':aliases,'files':files,'language':language,'japaneseSupported':japanese,'positioning':positioning,'source':'official-online'}

def fetch_catalog(reader=metadata_read,progress=None,cancel=None):
    mapping=parse_mapping(reader(MAPPING_URL).decode('utf-8'));releases={};errors=[]
    for index,(repo,aliases) in enumerate(mapping.items()):
        if cancel and cancel.is_set():raise InterruptedError('已取消目录检查。')
        if progress:progress(index,len(mapping),repo)
        try:
            data=json.loads(reader('https://huggingface.co/api/models/'+repo+'?blobs=true'))
            model,release=release_from_metadata(repo,aliases,data);releases[model]=release
        except Exception as error:errors.append({'repo':repo,'message':type(error).__name__})
    if not releases:raise ValueError('未取得可验证的模型目录；保留上次结果。')
    if progress:progress(len(mapping),len(mapping),'')
    return {'checkedAt':time.time(),'mappingSource':MAPPING_URL,'models':releases,'errors':errors}
