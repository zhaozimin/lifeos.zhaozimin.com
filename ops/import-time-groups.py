#!/usr/bin/env python3
# [INPUT]: 本人返还HTML、经核对的云端快照与明确的新事件补充映射。
# [OUTPUT]: 仅大类的私有应用计划；保留版本，不自行连接生产数据库。
# [POS]: 人工整理到受限事务的桥；细类和确认框不作为本轮安装条件。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path


class Review(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current = None
        self.blocks = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script':
            self.current = attrs.get('id')
            self.blocks[self.current] = ''

    def handle_endtag(self, tag):
        if tag == 'script':
            self.current = None

    def handle_data(self, text):
        if self.current:
            self.blocks[self.current] += text


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def plan(review, live, extra):
    parser = Review()
    parser.feed(review.read_text())
    data = json.loads(parser.blocks['review-data'])
    state = json.loads(parser.blocks['review-state'])
    if data['datasetId'] != digest({'records': data['records'], 'categories': data['categories']}):
        raise ValueError('REVIEW_BASELINE_CHANGED')
    if state['datasetId'] != data['datasetId'] or state['format'] != 'lifeos-time-review-state/v1':
        raise ValueError('REVIEW_DATASET_MISMATCH')
    nature = {'工作': 'core', '学习成长': 'support', '生活自理': 'recovery', '饮食': 'recovery',
              '清醒休息': 'recovery', '睡眠': 'recovery', '运动': 'recovery', '娱乐': 'leisure',
              '私人社交': 'leisure', '出行': 'support', '待确认': 'support'}
    codes = dict(zip(nature, ['work','learning','self-care','food','rest','sleep','exercise','entertainment','social','travel','pending']))
    mapping = {name: value['group'] for name, value in state.get('titles', {}).items() if value.get('group')}
    for name, group in extra.items():
        if name in mapping and mapping[name] != group:
            raise ValueError('EXTRA_RULE_CONFLICTS_WITH_PERSON')
        mapping[name] = group
    groups = []
    for group in state['groups']:
        if group not in nature:
            raise ValueError('NEW_GROUP_NEEDS_NATURE')
        groups.append({'name': group, 'code': 'uncategorized' if group == '待确认' else 'time-group-'+codes[group],
                       'nature': nature[group], 'keywords': sorted(name for name, value in mapping.items() if value == group)})
    if set(mapping.values())-set(state['groups']):
        raise ValueError('REVIEW_GROUP_UNDECLARED')
    records, missing = [], []
    original = {row['id']: row for row in data['records']}
    for row in live['time']:
        if row['deleted_at']:
            continue
        baseline = original.get(row['id'])
        override = state.get('records', {}).get(row['id'], {})
        group = override.get('group') or mapping.get(row['activity'])
        if baseline and baseline['title'] != row['activity']:
            raise ValueError('EVENT_TITLE_CHANGED_AFTER_REVIEW')
        if not group:
            missing.append(row['activity'])
            continue
        records.append({'id': row['id'], 'revision': row['revision'], 'activity': row['activity'], 'group': group})
    if missing:
        raise ValueError('NEW_EVENTS_REQUIRE_GROUP: '+', '.join(sorted(set(missing))))
    owners = {row['owner_id'] for row in live['time']}
    if len(owners) != 1:
        raise ValueError('ONE_OWNER_REQUIRED')
    return {'ownerId': owners.pop(), 'reviewHash': hashlib.sha256(review.read_bytes()).hexdigest(),
            'datasetId': data['datasetId'], 'groups': groups,
            'rules': [{'activity': name, 'group': group} for name, group in sorted(mapping.items())],
            'entries': records, 'includeNaps': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--live', type=Path, required=True)
    parser.add_argument('--extra', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = plan(args.review, json.loads(args.live.read_text()), json.loads(args.extra.read_text()) if args.extra else {})
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    args.output.chmod(0o600)
    print(json.dumps({'groups': len(result['groups']), 'rules': len(result['rules']), 'records': len(result['entries']), 'includeNaps': True}))
