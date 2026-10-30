#!/usr/bin/env python3
# [INPUT]: VPS订阅SQLite、原版一致快照、公钥及既有限桶R2配置。
# [OUTPUT]: 独立加密订阅归档、逐表摘要和上传核验。
# [POS]: 订阅备份入口；不改变数据库，也不复制授权令牌。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import hashlib
import json
import os
import sqlite3
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from contextlib import closing
from pathlib import Path
from backup import run, expired_backup_keys


def fingerprints(database):
    with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro', uri=True)) as db:
        if db.execute('pragma integrity_check').fetchone()[0]!='ok':raise RuntimeError('SQLITE_INTEGRITY_FAILED')
        if db.execute('pragma foreign_key_check').fetchone():raise RuntimeError('SQLITE_FOREIGN_KEY_FAILED')
        result={}
        for (name,) in db.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").fetchall():
            quote=lambda value:'"'+value.replace('"','""')+'"'
            columns=[r[1] for r in db.execute('pragma table_info('+quote(name)+')')]
            rows=db.execute('select * from '+quote(name)+' order by '+','.join(map(quote,columns))).fetchall()
            content=json.dumps({'columns':columns,'rows':rows},ensure_ascii=False,separators=(',',':')).encode()
            result[name]={'rows':len(rows),'sha256':hashlib.sha256(content).hexdigest()}
        return result


def backup():
    os.umask(0o077)
    server=Path(os.environ.get('SUBOS_SERVER','/opt/lifeos-subscriptions/server'))
    sys.path.insert(0,str(server))
    from runtimeops import snapshot_runtime
    source=Path(os.environ.get('SUBOS_RUNTIME','/var/lib/lifeos-subscriptions'))
    directory=Path(os.environ.get('SUBOS_BACKUP_DIR','/var/lib/lifeos-subscriptions-backup'));directory.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    final=directory/('subos-'+stamp+'.tar.age');partial=final.with_suffix('.partial')
    with tempfile.TemporaryDirectory(prefix='.snapshot-',dir=directory) as folder:
        folder=Path(folder);snapshot_runtime(source,folder/'runtime')
        # 仅在隔离快照中关闭WAL，归档不携带工作缓存。
        with closing(sqlite3.connect(folder/'runtime/subos.sqlite3')) as db:
            assert db.execute('pragma journal_mode=delete').fetchone()[0]=='delete'
        tables=fingerprints(folder/'runtime/subos.sqlite3')
        files={str(p.relative_to(folder)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (folder/'runtime').rglob('*') if p.is_file()}
        manifest={'format':'lifeos-subscriptions-backup-v1','created_at':stamp,'tables':tables,'files':files}
        (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False))
        with tarfile.open(folder/'bundle.tar','w') as tar:
            for name in [*files,'manifest.json']:tar.add(folder/name,arcname=name)
        run(['age','--recipients-file',os.environ['LIFEOS_AGE_RECIPIENTS'],'--output',str(partial),str(folder/'bundle.tar')])
    partial.replace(final);sha=hashlib.sha256(final.read_bytes()).hexdigest()
    endpoint=os.environ['LIFEOS_R2_ENDPOINT'];bucket=os.environ['LIFEOS_R2_BUCKET'];key='subscriptions/'+final.name
    run(['aws','--region','auto','--endpoint-url',endpoint,'s3','cp',str(final),'s3://'+bucket+'/'+key,'--only-show-errors','--metadata','sha256='+sha])
    remote=json.loads(run(['aws','--region','auto','--endpoint-url',endpoint,'s3api','head-object','--bucket',bucket,'--key',key]))
    if remote['ContentLength']!=final.stat().st_size or remote['Metadata'].get('sha256')!=sha:raise RuntimeError('R2_VERIFY_FAILED')
    objects=json.loads(run(['aws','--region','auto','--endpoint-url',endpoint,'s3api','list-objects-v2','--bucket',bucket,'--prefix','subscriptions/']))
    for old in expired_backup_keys(objects.get('Contents',[]),datetime.now(timezone.utc),'subscriptions/subos-'):
        run(['aws','--region','auto','--endpoint-url',endpoint,'s3api','delete-object','--bucket',bucket,'--key',old])
    status={'uploaded':True,'object_key':key,'sha256':sha,'bytes':final.stat().st_size,'tables':tables}
    (directory/'last-success.json').write_text(json.dumps(status));print(json.dumps(status))
    cutoff=datetime.now(timezone.utc).timestamp()-30*86400
    for old in directory.glob('subos-*.tar.age'):
        if old!=final and old.stat().st_mtime<cutoff:old.unlink()


if __name__=='__main__':backup()
