#!/usr/bin/env python3
# [INPUT]: 合成分类账本与加密备份对象名。
# [OUTPUT]: 只读分类筛选、SQL 转义和保留期边界的行为证据。
# [POS]: 运维行为验收；不连接本机真实账本、VPS 或云端。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


backup = module('backup')
categories = module('import-categories')


class BackupTests(unittest.TestCase):
    def test_retention_only_expires_valid_old_lifeos_objects(self):
        keys = ['daily/lifeos-20260901T010000Z.tar.age', 'daily/lifeos-20261023T010000Z.tar.age',
                'daily/lifeos-20269999T010000Z.tar.age', 'daily/other-20260901T010000Z.tar.age',
                'manual/lifeos-20260901T010000Z.tar.age', 'daily/lifeos-20270901T010000Z.tar.age']
        actual = backup.expired_backup_keys([{'Key': key} for key in keys], datetime(2026, 10, 24, tzinfo=timezone.utc))
        self.assertEqual(actual, [keys[0]])

    def test_subscription_retention_does_not_touch_database_backups(self):
        keys=['subscriptions/subos-20260901T010000Z.tar.age','daily/lifeos-20260901T010000Z.tar.age','subscriptions/subos-20261023T010000Z.tar.age']
        actual=backup.expired_backup_keys([{'Key':key} for key in keys],datetime(2026,10,24,tzinfo=timezone.utc),'subscriptions/subos-')
        self.assertEqual(actual,[keys[0]])

    def test_category_import_skips_deleted_and_uses_existing_fallback(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for kind in ['time', 'finance']:
                (root / kind).mkdir()
                with sqlite3.connect(root / kind / (kind + '.sqlite3')) as db:
                    db.execute('create table categories(payload_json text,sort_order integer)')
                    rows = [{'id': 'category-uncategorized', 'name': '未分类'},
                            {'id': kind + '-valid', 'name': "名称'含引号", 'keywords': ["词'条"],
                             'nature': 'core' if kind == 'time' else None, 'direction': '支出'},
                            {'id': kind + '-deleted', 'name': '已删除', 'deletedAt': '2026-01-01'}]
                    db.executemany('insert into categories values (?,?)', [(json.dumps(row), i) for i, row in enumerate(rows)])
            result = categories.read_categories(root)
            self.assertEqual(len(result), 2)
            self.assertIsNone(result[0]['direction'])
            self.assertIsNone(result[1]['nature'])
            sql = categories.seed_sql(result, '11111111-1111-4111-8111-111111111111')
            self.assertIn("名称''含引号", sql)
            self.assertIn("词''条", sql)
            self.assertNotIn('已删除', sql)
            self.assertIn('on conflict(owner_id,kind,code) do nothing', sql)


if __name__ == '__main__':
    unittest.main()
