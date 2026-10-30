#!/usr/bin/env python3
# [INPUT]: 本机只读时间快照、云端时间快照与无私人数据的HTML模板。
# [OUTPUT]: 包含全部事件、原分类与空白整理字段的离线HTML。
# [POS]: 人工分类交付边界；按来源编号去重，不修改任何账本。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def stamp():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(text.encode()).hexdigest()


def build(local, cloud):
    originals = {row['id']: row for row in local['records']}
    categories = {}
    for item in local['categories']:
        categories[item['id']] = {'key': item['id'], 'name': item['name'],
            'nature': item.get('nature'), 'keywords': item.get('keywords', []),
            'local': item, 'cloud': None}
    cloud_categories = {row['id']: row for row in cloud['categories']}
    for item in cloud['categories']:
        key = item['code']
        categories.setdefault(key, {'key': key, 'name': item['name'], 'nature': item.get('nature'),
                                   'keywords': item.get('keywords', []), 'local': None, 'cloud': None})
        categories[key]['cloud'] = item
    records, matched = [], set()
    for row in cloud['records']:
        original = None
        if row['source'] == 'local-lifeos':
            prefix = 'local-lifeos-main:time:'
            if not row['external_id'].startswith(prefix):
                raise ValueError('LOCAL_SOURCE_ID_UNKNOWN')
            local_id = row['external_id'][len(prefix):]
            if local_id not in originals or local_id in matched:
                raise ValueError('LOCAL_SOURCE_ID_MISSING_OR_DUPLICATE')
            original = originals[local_id]
            matched.add(local_id)
        category = cloud_categories[row['category_id']]
        records.append({'id': row['id'], 'cloudRevision': row['revision'],
            'localId': original['id'] if original else None, 'title': row['activity'],
            'start': row['start_at'], 'end': row['end_at'], 'deductionMinutes': row['deduction_minutes'],
            'originalCategoryKey': category['code'], 'originalCategory': category['name'],
            'originalNature': category.get('nature'), 'project': row['project'], 'tags': row['tags'],
            'note': row['note'], 'source': row['source'], 'externalId': row['external_id'],
            'deletedAt': row['deleted_at'], 'localOriginal': original, 'baselineHash': digest(row)})
    if matched != set(originals):
        raise ValueError('LOCAL_RECORDS_NOT_FULLY_INCLUDED')
    category_rows = list(categories.values())
    for item in category_rows:
        item['recordCount'] = sum(row['originalCategoryKey'] == item['key'] for row in records)
    records.sort(key=lambda row: (row['start'], row['id']))
    summary = {'localRecords': len(originals), 'cloudNewRecords': len(records)-len(originals),
        'totalRecords': len(records), 'activeRecords': sum(not r['deletedAt'] for r in records),
        'deletedRecords': sum(bool(r['deletedAt']) for r in records),
        'uniqueEvents': len({r['title'] for r in records}), 'categoryDefinitions': len(category_rows),
        'localCategoryDefinitions': len(local['categories']), 'cloudCategoryDefinitions': len(cloud['categories'])}
    data = {'format': 'lifeos-time-review-data/v1', 'createdAt': stamp(), 'timezone': 'Asia/Shanghai',
        'summary': summary, 'records': records, 'categories': category_rows,
        'sourceNotes': ['本机历史与云端导入按原始编号去重。', '本机原始行完整保留在localOriginal。',
                        '云端修订号与快照哈希用于返还后的冲突核对。', '已删除记录保留并单独标记。']}
    data['datasetId'] = digest({'records': records, 'categories': category_rows})
    return data


def render(data, target, template):
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('>', '\\u003e')
    text = template.read_text()
    if text.count('__LIFEOS_REVIEW_DATA__') != 1:
        raise ValueError('TEMPLATE_DATA_MARKER_INVALID')
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    target.write_text(text.replace('__LIFEOS_REVIEW_DATA__', encoded))
    target.chmod(0o600)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--local', required=True, type=Path)
    parser.add_argument('--cloud', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    data = build(json.loads(args.local.read_text()), json.loads(args.cloud.read_text()))
    render(data, args.output, Path(__file__).with_name('time-review.html'))
    print(json.dumps({'output': str(args.output), **data['summary']}, ensure_ascii=False))
