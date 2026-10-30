#!/usr/bin/env python3
# [INPUT]: 本机 runtime 路径、本人标识和现有云端分类。
# [OUTPUT]: 私有快照、幂等导入 SQL 与数量金额核对清单。
# [POS]: 一次性迁移入口；生成材料后由部署流程执行事务。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
import json
import os
from datetime import datetime,timezone
from pathlib import Path
from history_source import snapshot,build,report
from history_sql import build_sql

if __name__=='__main__':
    os.umask(0o077)
    parser=argparse.ArgumentParser()
    parser.add_argument('--runtime',type=Path,required=True)
    parser.add_argument('--owner',required=True)
    parser.add_argument('--categories',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    at=datetime.now(timezone.utc).isoformat()
    source=snapshot(args.runtime,args.output)
    output=build(source,args.owner,json.loads(args.categories.read_text()),at,args.output)
    plan=report(source,output,at)
    sql=build_sql(output,args.owner)
    (args.output/'history.sql').write_text(sql)
    (args.output/'report.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'snapshot_at':at,'target_counts':plan['target_counts'],'sql_bytes':len(sql.encode()),
                      'cloud_applied':False},ensure_ascii=False))
