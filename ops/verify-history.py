#!/usr/bin/env python3
# [INPUT]: 私有源 SQLite 快照、云端行导出和迁移清单。
# [OUTPUT]: 原始档案、逐字段投影及附件字节的独立核对报告。
# [POS]: 迁移验收；不调用导入器，不连接或修改生产数据库。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
import hashlib
import json
import re
import sqlite3
from datetime import datetime,timezone
from decimal import Decimal,ROUND_HALF_EVEN
from pathlib import Path
from zoneinfo import ZoneInfo


def utc(value,zone='Asia/Shanghai'):
    if not value:return None
    value=value.replace('Z','+00:00')
    if re.search(r'[+-]\d{2}$',value):value+=':00'
    value=re.sub(r'\.(\d{1,6})(?=[+-]|$)',lambda m:'.'+m.group(1).ljust(6,'0'),value)
    date=datetime.fromisoformat(value)
    if date.tzinfo is None:date=date.replace(tzinfo=ZoneInfo(zone))
    return date.astimezone(timezone.utc)


def same(actual,expected,field,*,date=False):
    if date:actual,expected=utc(actual),utc(expected)
    if actual!=expected:raise ValueError('HISTORY_FIELD_MISMATCH:'+field)


def verify(folder,export):
    report=json.loads((folder/'report.json').read_text())
    archive={(r['domain'],r['table_name'],r['source_id']):r for r in export['archive']}
    source={}
    for domain,tables in report['source_tables'].items():
        with sqlite3.connect((folder/(domain+'.sqlite3')).as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row
            source[domain]={table:[dict(x) for x in db.execute('select * from "'+table+'"')] for table in tables}
        for table,rows in source[domain].items():
            same(len(rows),tables[table],domain+':'+table+':count')
            for row in rows:
                key=(domain,table,str(row.get('id',row.get('key'))))
                saved=archive[key]
                same(saved['payload'],row,domain+':'+table+':original')
                canonical=json.dumps(row,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
                same(saved['source_hash'],hashlib.sha256(canonical.encode()).hexdigest(),'source_hash')
    same(len(archive),sum(sum(t.values()) for t in report['source_tables'].values()),'archive_count')
    times={r['source_id']:r for r in export['time']}
    same(len(times),len(source['time']['segments']),'time_count')
    for row in source['time']['segments']:
        actual=times[row['id']]
        category=json.loads(row['category_json'])
        same(actual['start_at'],row['started_utc'] or row['started_at'],'start_at',date=True)
        same(actual['end_at'],row['ended_utc'] or row['ended_at'],'end_at',date=True)
        same(actual['activity'],row['title'],'activity')
        same(actual['deduction_minutes'],row['deduction_minutes'] or 0,'deduction_minutes')
        same(actual['deduction_note'],row['deduction_note'],'deduction_note')
        same(actual['note'],row['note'],'time_note')
        same(actual['project'],row['project_name'],'time_project')
        same(actual['tags'],json.loads(row['tags_json'] or '[]'),'time_tags')
        same(actual['deleted_at'],row['deleted_at'],'time_deleted_at',date=True)
        same(actual['category_name'],category.get('name') or '未分类','time_category')
        same(actual['category_nature'],category.get('nature') or 'support','time_nature')
    money={r['source_id']:r for r in export['money']}
    same(len(money),len(source['finance']['transactions']),'money_count')
    settings=json.loads(source['finance']['ledger_settings'][0]['payload_json'])
    for row in source['finance']['transactions']:
        actual=money[row['id']]
        amount=int(Decimal(str(row['amount'])).quantize(Decimal('.01'),rounding=ROUND_HALF_EVEN)*100)
        same(actual['amount_cents'],amount,'amount_cents')
        same(actual['currency'],row['currency'] or settings['defaultCurrency'],'currency')
        same(utc(actual['occurred_at']),utc(row['occurred_at'],settings['timezone']),'occurred_at')
        for field,original in [('direction','kind'),('title','title'),('account','account_name'),
            ('from_account','from_account_name'),('to_account','to_account_name'),('merchant','merchant'),
            ('note','note'),('project','project_name')]:same(actual[field],row[original],field)
        same(actual['tags'],json.loads(row['tags_json'] or '[]'),'money_tags')
        same(actual['deleted_at'],row['deleted_at'],'money_deleted_at',date=True)
        category=json.loads(row['category_json'])
        if isinstance(category,str):category={'name':category}
        same(actual['category_name'],category.get('name') or '未分类','money_category')
        for key,value in actual['details'].items():same(value,row.get(key),'money_details:'+key)
    auxiliary={(r['kind'],r['source_id']):r for r in export['auxiliary']}
    for row in source['finance']['accounts']:
        expected=json.loads(row['payload_json']);expected['id']=row['id']
        same(auxiliary[('account',row['id'])]['data'],expected,'account_data')
    for table,kind in [('tasks','task'),('task_groups','task_group')]:
        for row in source['tasks'][table]:same(auxiliary[(kind,row['id'])]['data'],row,kind+'_data')
    for row in source['time']['projects']:
        expected=json.loads(row['payload_json']);expected['id']=row['id']
        same(auxiliary[('project','time:'+row['id'])]['data'],expected,'time_project_data')
    for row in settings.get('projects',[]):same(auxiliary[('project','finance:'+row['id'])]['data'],row,'finance_project_data')
    same(len(export['attachments']),len(source['finance']['attachments']),'attachment_count')
    for row in source['finance']['attachments']:
        content=(folder/('attachment-'+row['id'])).read_bytes()
        original_hash=hashlib.sha256(content).hexdigest()
        actual=next(a for a in export['attachments'] if a['source_transaction_id']==row['transaction_id'] and a['sha256']==original_hash)
        same(bytes.fromhex(actual['content_hex']),content,'attachment_bytes')
        same(actual['filename'],row['original_name'],'attachment_filename')
        same(actual['mime'],row['mime'],'attachment_mime')
    return {'verified':True,'archive_rows':len(archive),'time_rows':len(times),'money_rows':len(money),
            'auxiliary_rows':len(auxiliary),'attachments':len(export['attachments']),
            'original_rows_equal':True,'canonical_fields_equal':True,'attachment_bytes_equal':True,
            'snapshot_at':report['snapshot_at']}


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('folder',type=Path)
    parser.add_argument('export',type=Path)
    args=parser.parse_args()
    proof=verify(args.folder.resolve(),json.loads(args.export.read_text()))
    path=args.folder/'verification.json';path.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n');path.chmod(0o600)
    print(json.dumps(proof,ensure_ascii=False))
