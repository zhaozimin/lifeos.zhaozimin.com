#!/usr/bin/env python3
# [INPUT]: 本机 LifeOS 双账本的只读分类定义与本人 UUID。
# [OUTPUT]: 幂等分类种子 SQL；仅复制活跃定义，不读取交易与余额。
# [POS]: 旧系统到云端的主数据边界；未分类映射到既有 canonical code。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
import json
import re
import sqlite3
from pathlib import Path
from uuid import UUID


def read_categories(runtime):
    result = []
    for folder, kind in [('time', 'time'), ('finance', 'money')]:
        path = Path(runtime) / folder / (folder + '.sqlite3')
        with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as connection:
            rows = connection.execute('select payload_json from categories order by sort_order').fetchall()
        for row in rows:
            item = json.loads(row[0])
            if item.get('deletedAt') or item['id'] == 'category-uncategorized':
                continue
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', item['id']):
                raise ValueError('分类 code 不符合契约')
            result.append({'code': item['id'], 'name': item['name'], 'kind': kind,
                           'keywords': item.get('keywords', []),
                           'direction': {'收入': 'income', '支出': 'expense'}.get(item.get('direction')) if kind == 'money' else None,
                           'nature': item.get('nature') if kind == 'time' else None})
    return result


def literal(value):
    return 'null' if value is None else "'" + value.replace("'", "''") + "'"


def seed_sql(items, owner):
    UUID(owner)
    values = []
    for item in items:
        keywords = 'ARRAY[' + ','.join(literal(word) for word in item['keywords']) + ']::text[]'
        values.append('(' + ','.join([literal(owner), literal(item['code']), literal(item['name']),
                      literal(item['kind']), keywords, literal(item['direction']), literal(item['nature'])]) + ')')
    return '-- 私有生成文件：只新增分类，不修改已有定义或账目。\n' + (
        'insert into public.categories(owner_id,code,name,kind,keywords,direction,nature) values\n'
        + ',\n'.join(values) + '\non conflict(owner_id,kind,code) do nothing;\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--owner', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    items = read_categories(args.runtime.resolve())
    args.output.write_text(seed_sql(items, args.owner))
    args.output.chmod(0o600)
    print(json.dumps({'time': sum(i['kind'] == 'time' for i in items),
                      'money': sum(i['kind'] == 'money' for i in items), 'history_copied': False}))
