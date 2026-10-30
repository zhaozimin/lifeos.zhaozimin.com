#!/usr/bin/env python3
# [INPUT]: 已验证的本机投影、稳定编号及分类引用。
# [OUTPUT]: 可重复执行的私有事务 SQL；源改变时拒绝覆盖。
# [POS]: 迁移序列化边界；原始来源与网页编辑都不会被重导覆盖。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
from history_source import canonical, SOURCE_KEY


def literal(value):
    if value is None:return 'null'
    if isinstance(value,bool):return 'true' if value else 'false'
    if isinstance(value,(int,float)):return str(value)
    return "'"+str(value).replace("'","''")+"'"


def sql_value(field, value, owner):
    if field=='category_id' and isinstance(value,dict):
        return '(select id from public.categories where owner_id='+literal(owner)+' and kind='+literal(value['kind'])+' and code='+literal(value['code'])+')'
    if field=='tags':return 'ARRAY['+','.join(literal(x) for x in value)+']::text[]'
    if isinstance(value,bytes):return "decode("+literal(value.hex())+",'hex')"
    if isinstance(value,(dict,list)):return literal(canonical(value))+'::jsonb'
    return literal(value)


def build_sql(output, owner):
    statements=['begin;',"set local standard_conforming_strings='on';",'set local statement_timeout=\'120s\';']
    conflicts={'categories':'owner_id,kind,code','local_archive':'owner_id,source_key,domain,table_name,source_id',
               'raw_inputs':'owner_id,source,external_id','time_entries':'raw_input_id,item_index',
               'transactions':'raw_input_id,item_index','local_records':'owner_id,kind,source_id','record_attachments':'id'}
    for table, rows in output.items():
        if not rows:continue
        fields=list(rows[0])
        for offset in range(0,len(rows),100):
            values=['('+','.join(sql_value(k,row[k],owner) for k in fields)+')' for row in rows[offset:offset+100]]
            statements.append('insert into public.'+table+'('+','.join(fields)+') values\n'+',\n'.join(values)+
                              '\non conflict('+conflicts[table]+') do nothing;')
    # 对照原始哈希，只拒绝变化的本机来源，不读取或覆盖人工编辑后的当前值。
    for offset in range(0,len(output['local_archive']),100):
        rows=output['local_archive'][offset:offset+100]
        values=','.join('('+','.join(literal(r[k]) for k in ['domain','table_name','source_id','source_hash'])+')' for r in rows)
        body=(" begin if exists(select 1 from (values "+values+
            ") v(domain,table_name,source_id,source_hash) left join public.local_archive a on a.owner_id="+literal(owner)+
            " and a.source_key="+literal(SOURCE_KEY)+" and a.domain=v.domain and a.table_name=v.table_name and a.source_id=v.source_id "+
            "where a.id is null or a.source_hash<>v.source_hash) then raise exception 'SOURCE_SNAPSHOT_CONFLICT'; end if; end ")
        delimiter='$lifeos_source_check$'
        while delimiter in body:delimiter=delimiter[:-1]+'_x$'
        statements.append('do '+delimiter+body+delimiter+';')
    statements.append('commit;')
    return '\n'.join(statements)+'\n'
