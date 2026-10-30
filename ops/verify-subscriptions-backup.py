#!/usr/bin/env python3
# [INPUT]: 下载的加密订阅归档、本机age私钥及逐表摘要。
# [OUTPUT]: 隔离解密、SQLite保真和私有卡面核验报告。
# [POS]: 本机恢复边界；不接触在线工作库或远程服务。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
import hashlib
import importlib.util
import json
import re
import tarfile
import tempfile
from pathlib import Path
from backup import run
spec=importlib.util.spec_from_file_location('subscriptions_backup',Path(__file__).with_name('subscriptions-backup.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def verify(archive,identity):
    with tempfile.TemporaryDirectory(prefix='subos-restore-') as directory:
        directory=Path(directory);plain=directory/'bundle.tar'
        run(['age','-d','-i',str(identity),'-o',str(plain),str(archive)])
        with tarfile.open(plain) as tar:
            names=[m.name for m in tar.getmembers()]
            if len(names)!=len(set(names)):raise RuntimeError('DUPLICATE_ARCHIVE_MEMBER')
            for member in tar.getmembers():
                if not member.isfile() or not re.fullmatch(r'manifest\.json|runtime/subos\.sqlite3(?:-wal|-shm)?|runtime/card-covers/[a-f0-9]{24}\.(jpg|png|webp)',member.name):raise RuntimeError('ARCHIVE_MEMBER_INVALID')
                p=directory/member.name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(tar.extractfile(member).read())
        manifest=json.loads((directory/'manifest.json').read_text())
        if manifest['format']!='lifeos-subscriptions-backup-v1':raise RuntimeError('BACKUP_FORMAT_INVALID')
        if set(names)!={*manifest['files'],'manifest.json'}:raise RuntimeError('ARCHIVE_FILES_MISMATCH')
        for name,sha in manifest['files'].items():
            if hashlib.sha256((directory/name).read_bytes()).hexdigest()!=sha:raise RuntimeError('FILE_HASH_MISMATCH')
        tables=module.fingerprints(directory/'runtime/subos.sqlite3')
        if tables!=manifest['tables']:raise RuntimeError('TABLE_DATA_MISMATCH')
        return {'restore_verified':True,'tables':{k:v['rows'] for k,v in tables.items()},'all_rows_exact':True,'all_files_exact':True,'network_listener':False}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);parser.add_argument('--identity',type=Path,required=True);parser.add_argument('--report',type=Path,required=True);args=parser.parse_args()
    result=verify(args.archive,args.identity);args.report.write_text(json.dumps(result,indent=2));args.report.chmod(0o600);print(json.dumps(result))
