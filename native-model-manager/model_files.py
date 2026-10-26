"""Inspect data files only; never execute local model/repository code."""
import hashlib,json,struct
from pathlib import Path
NAMES={'model.bin','config.json','tokenizer.json','vocabulary.json','vocabulary.txt','preprocessor_config.json'}

def inspect_model(path,safe):
    path=safe(path)
    if not path.is_dir():raise ValueError('请选择完整的实体模型文件夹。')
    for file in path.iterdir():safe(file,path)
    files={}
    for name in NAMES:
        file=safe(path/name,path)
        if file.is_file():
            size=file.stat().st_size
            if name!='model.bin' and size>32_000_000:raise ValueError('模型附属文件超过格式检查上限。')
            files[name]={'bytes':size}
    if not {'model.bin','config.json','tokenizer.json'}.issubset(files) or not {'vocabulary.txt','vocabulary.json'}&files.keys():raise ValueError('需要 model.bin、config、tokenizer 和 vocabulary；不自动联网补文件。')
    with (path/'model.bin').open('rb') as stream:header=stream.read(32)
    if len(header)<22 or struct.unpack('<I',header[:4])[0]!=6 or header[4:18]!=b'\x0c\x00WhisperSpec\x00' or struct.unpack('<I',header[18:22])[0]!=3:raise ValueError('不是本机已验证的 CTranslate2 Whisper 格式（binary 6 / WhisperSpec 3）；不会运行仓库代码。')
    def small_json(name):
        if files[name]['bytes']>16_000_000:raise ValueError('模型配置文件过大。')
        value=json.loads((path/name).read_text(encoding='utf-8'))
        if not isinstance(value,dict):raise ValueError('模型配置格式不完整。')
        return value
    config=small_json('config.json');tokenizer=small_json('tokenizer.json')
    if not isinstance(config.get('suppress_ids'),list) or not isinstance(config.get('suppress_ids_begin'),list) or not isinstance(tokenizer.get('model'),dict):raise ValueError('Whisper 配置或 tokenizer 不完整。')
    for name in files:
        if name!='model.bin':
            with (path/name).open('rb') as stream:files[name]['sha256']=hashlib.file_digest(stream,'sha256').hexdigest()
    lang_ids=config.get('lang_ids',[])
    if not isinstance(lang_ids,list) or any(not isinstance(value,int) for value in lang_ids):raise ValueError('Whisper 语言配置格式不完整。')
    tokens={entry.get('content'):entry.get('id') for entry in tokenizer.get('added_tokens',[]) if isinstance(entry,dict)}
    tokens.update(tokenizer['model'].get('vocab',{}));ja=tokens.get('<|ja|>');japanese=isinstance(ja,int) and ja in lang_ids
    return {'name':path.name,'revision':'local','repo':'','source':'local-import','files':files,'language':'多语言（含日语）' if japanese else '未确认支持日语','japaneseSupported':japanese,'positioning':'本地格式检查通过；实际加载与效果需启动后验证。'}

def file_identity(path):
    info=path.stat()
    return [info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns]
