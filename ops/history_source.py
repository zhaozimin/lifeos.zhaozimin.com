#!/usr/bin/env python3
# [INPUT]: 本机正式三库、冻结时区及附件目录。
# [OUTPUT]: 私有 SQLite 快照、原始行和可核对的账本投影。
# [POS]: 迁移读取边界；不用备份库，不向本机数据库写入。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_EVEN
from pathlib import Path
from uuid import UUID, uuid5
from zoneinfo import ZoneInfo

SOURCE_KEY = 'local-lifeos-main'
TABLES = {
    'time': ['segments', 'categories', 'projects', 'settings', 'audit_events', 'runtime_state'],
    'finance': ['transactions', 'categories', 'accounts', 'ledger_settings', 'attachments', 'recurring_rules', 'audit_events'],
    'tasks': ['tasks', 'task_groups'],
}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def identifier(owner, kind, source_id):
    return str(uuid5(UUID(owner), f'{SOURCE_KEY}:{kind}:{source_id}'))


def cents(value):
    number = Decimal(str(value))
    rounded = number.quantize(Decimal('.01'), rounding=ROUND_HALF_EVEN)
    if not number.is_finite() or abs(number-rounded) > Decimal('0.00000001'):
        raise ValueError('SOURCE_AMOUNT_PRECISION_INVALID')
    result = int(rounded*100)
    if abs(result) > 9007199254740991:
        raise ValueError('SOURCE_AMOUNT_RANGE_INVALID')
    return result


def instant(value, zone='Asia/Shanghai'):
    if value is None or value == '':
        return None
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        result = result.replace(tzinfo=ZoneInfo(zone))
    return result.astimezone(timezone.utc).isoformat()


def snapshot(runtime, target):
    runtime, target = Path(runtime).resolve(), Path(target).resolve()
    if target == runtime or runtime in target.parents:
        raise ValueError('SNAPSHOT_MUST_BE_OUTSIDE_SOURCE')
    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    result = {}
    for domain, tables in TABLES.items():
        original = runtime/domain/(domain+'.sqlite3')
        copy = target/(domain+'.sqlite3')
        with sqlite3.connect(original.as_uri()+'?mode=ro', uri=True) as source:
            with sqlite3.connect(copy) as destination:
                source.backup(destination)
        copy.chmod(0o600)
        with sqlite3.connect(copy) as connection:
            connection.row_factory = sqlite3.Row
            result[domain] = {table: [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"')]
                              for table in tables}
    for attachment in result['finance']['attachments']:
        path = (runtime/'finance'/attachment['stored_path']).resolve()
        if runtime/'finance' not in path.parents or path.is_symlink() or not path.is_file():
            raise ValueError('SOURCE_ATTACHMENT_PATH_INVALID')
        content = path.read_bytes()
        if len(content) != attachment['size_bytes'] or len(content)>10485760:
            raise ValueError('SOURCE_ATTACHMENT_SIZE_INVALID')
        copy = target/('attachment-'+attachment['id'])
        copy.write_bytes(content); copy.chmod(0o600)
    return result


def category_shape(value):
    value = json.loads(value) if isinstance(value, str) else value
    if isinstance(value, str):
        return {'name': value}
    return value if isinstance(value, dict) else {}


def build(source, owner, categories, at, folder):
    UUID(owner)
    at = instant(at)
    time_zone = {r['key']: json.loads(r['value_json']) for r in source['time']['runtime_state']}
    time_zone = time_zone['record_timezone_resolved']
    finance_settings = json.loads(source['finance']['ledger_settings'][0]['payload_json'])
    finance_zone = finance_settings.get('timezone', 'Asia/Shanghai')
    default_currency = finance_settings.get('defaultCurrency', 'CNY')
    output = {table: [] for table in ['categories','local_archive','raw_inputs','time_entries',
              'transactions','local_records','record_attachments']}
    category_lookup = {(c['kind'],c['name'],c.get('nature'),c.get('direction')): c['id'] for c in categories}

    def resolve_category(raw, kind, direction=None):
        item = category_shape(raw)
        name = item.get('name') or '未分类'
        nature = item.get('nature') if kind == 'time' else None
        if kind=='time' and nature not in ('core','support','recovery','leisure'):
            nature='support'
        key = (kind,name,nature,direction)
        if key not in category_lookup:
            code='legacy-'+digest(key)[:24]
            output['categories'].append({'owner_id':owner,'code':code,'name':name,'kind':kind,
                                         'nature':nature,'direction':direction,'is_active':False})
            category_lookup[key]={'code':code,'kind':kind}
        return category_lookup[key]

    def raw_input(domain, row):
        raw_id=identifier(owner,domain+':raw',row['id'])
        output['raw_inputs'].append({'id':raw_id,'owner_id':owner,'source':'local-lifeos',
            'external_id':f"{SOURCE_KEY}:{domain}:{row['id']}",'text':row.get('title') or '本机历史记录',
            'received_at':instant(row.get('created_at')) or at,'payload':{'source_key':SOURCE_KEY,'domain':domain,'original':row},
            'input_kind':'import','status':'parsed','receipt_text':'本机历史导入，不发送回执',
            'delivered_at':at,'created_at':instant(row.get('created_at')) or at})
        return raw_id

    for domain, tables in source.items():
        for table, rows in tables.items():
            for row in rows:
                row_id=str(row.get('id',row.get('key')))
                if row_id=='None': raise ValueError('SOURCE_ROW_ID_REQUIRED')
                output['local_archive'].append({'owner_id':owner,'source_key':SOURCE_KEY,'domain':domain,
                    'table_name':table,'source_id':row_id,'payload':row,'source_hash':digest(row)})
    for row in source['time']['segments']:
        start=instant(row['started_utc'] or row['started_at'],time_zone)
        end=instant(row['ended_utc'] or row['ended_at'],time_zone)
        output['time_entries'].append({'id':identifier(owner,'time',row['id']),
            'raw_input_id':raw_input('time',row),'item_index':0,'start_at':start,'end_at':end,
            'activity':row['title'],'category_id':resolve_category(row['category_json'],'time'),
            'deduction_minutes':row['deduction_minutes'] or 0,'deduction_note':row['deduction_note'],
            'project':row['project_name'],'tags':json.loads(row['tags_json'] or '[]'),'note':row['note'],
            'created_at':instant(row['created_at']) or at,'updated_at':instant(row['updated_at']) or at,
            'deleted_at':instant(row['deleted_at'])})
    for row in source['finance']['transactions']:
        kind=row['kind']
        if kind not in ('expense','income','transfer'):raise ValueError('SOURCE_DIRECTION_INVALID')
        output['transactions'].append({'id':identifier(owner,'money',row['id']),
            'raw_input_id':raw_input('finance',row),'item_index':0,'occurred_at':instant(row['occurred_at'],finance_zone),
            'direction':kind,'amount_cents':cents(row['amount']),'currency':row['currency'] or default_currency,
            'category_id':resolve_category(row['category_json'],'money',None if kind=='transfer' else kind),
            'title':row['title'],'account':row['account_name'],'from_account':row['from_account_name'],
            'to_account':row['to_account_name'],'merchant':row['merchant'],'project':row['project_name'],
            'tags':json.loads(row['tags_json'] or '[]'),'note':row['note'],
            'details':{key:row.get(key) for key in ['reimbursement_status','reimbursed_by','source','source_name',
                'counterparty_id','invoice_issued','invoice_attachment_id','tax_category','amount_in_base_currency']},
            'created_at':instant(row['created_at']) or at,'updated_at':instant(row['updated_at']) or at,
            'deleted_at':instant(row['deleted_at'])})

    def local(kind, source_id, data, created=None, updated=None, deleted=None):
        output['local_records'].append({'id':identifier(owner,kind,source_id),'owner_id':owner,
            'kind':kind,'source_id':source_id,'data':data,'created_at':instant(created) or at,
            'updated_at':instant(updated) or at,'deleted_at':instant(deleted)})

    for row in source['finance']['accounts']:
        data=json.loads(row['payload_json']);data['id']=row['id']
        local('account',row['id'],data,updated=row['updated_at'],deleted=data.get('deletedAt'))
    for row in source['time']['projects']:
        data=json.loads(row['payload_json']);data['id']=row['id']
        local('project','time:'+row['id'],data,updated=row['updated_at'],deleted=data.get('deletedAt'))
    for data in finance_settings.get('projects',[]):
        local('project','finance:'+data['id'],data,deleted=data.get('deletedAt'))
    for table,kind in [('task_groups','task_group'),('tasks','task')]:
        for row in source['tasks'][table]:
            local(kind,row['id'],row,row['created_at'],row['updated_at'],row['deleted_at'])
    for row in source['finance']['attachments']:
        content=(Path(folder)/('attachment-'+row['id'])).read_bytes()
        output['record_attachments'].append({'id':identifier(owner,'attachment',row['id']),'owner_id':owner,
            'transaction_id':identifier(owner,'money',row['transaction_id']),'filename':row['original_name'],
            'mime':row['mime'],'size_bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),'content':content})
    return output


def report(source, output, at):
    times=[x for x in output['time_entries'] if not x['deleted_at']]
    tx=[x for x in output['transactions'] if not x['deleted_at']]
    gross=sum(int((datetime.fromisoformat(x['end_at'])-datetime.fromisoformat(x['start_at'])).total_seconds()//60)
              for x in times if x['end_at'])
    deductions=sum(x['deduction_minutes'] for x in times)
    totals={}
    for row in tx:
        key=row['currency']+':'+row['direction']
        totals[key]=totals.get(key,0)+row['amount_cents']
    return {'snapshot_at':at,'source_key':SOURCE_KEY,
        'source_tables':{d:{t:len(rows) for t,rows in tables.items()} for d,tables in source.items()},
        'target_counts':{t:len(rows) for t,rows in output.items()},
        'live_time':len(times),'open_time':sum(x['end_at'] is None for x in times),
        'closed_gross_minutes':gross,'deduction_minutes':deductions,'closed_net_minutes':gross-deductions,
        'live_transactions':len(tx),'money_totals_cents':totals,
        'negative_amounts':sum(x['amount_cents']<0 for x in tx),'zero_amounts':sum(x['amount_cents']==0 for x in tx),
        'source_untouched':True,'cloud_applied':False}
