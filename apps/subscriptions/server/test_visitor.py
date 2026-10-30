# -*- coding: utf-8 -*-
"""
[INPUT]: 临时合成订阅库及敏感字段金丝雀。
[OUTPUT]: 只读目录与邮箱、号码、价格、账号隔离验收。
[POS]: 订阅公开边界回归，不读取运行库。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import sqlite3
import tempfile
import unittest
import json
from pathlib import Path
from visitor import visitor_catalog
from visitor_icons import brand_host,visitor_icon
from unittest.mock import patch
from visitor import public_id

class VisitorTests(unittest.TestCase):
    def test_brand_ignores_userinfo_and_queries_and_never_reads_custom_images(self):
        self.assertEqual(brand_host('https://private-user:private-password@api.chatgpt.com/?token=secret'),'chatgpt.com')
        self.assertEqual(brand_host('http://127.0.0.1/private'),'')
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'brands.sqlite3'
            with sqlite3.connect(p) as db:
                db.executescript("CREATE TABLE subscriptions(id,name,website); INSERT INTO subscriptions VALUES('private-id','Demo','https://chatgpt.com/?secret=PRIVATE');")
            image=Path(tmp)/'brand.png';image.write_bytes(b'\x89PNG\r\n\x1a\nbrand')
            with patch('visitor_icons.ensure_icon',return_value=image):
                content,mime=visitor_icon(p,public_id('private-id'))
            self.assertEqual(mime,'image/png');self.assertNotIn(b'PRIVATE',content)
            self.assertNotIn('private-id',public_id('private-id'))

    def test_projection_never_selects_private_fields_or_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "demo.sqlite3"
            with sqlite3.connect(p) as db:
                db.executescript("""CREATE TABLE categories(id,name,sort_order);
                    CREATE TABLE subscriptions(id,name,category_id,cycle,status,next_renewal_on,sort_order,amount_fen,account,notes);
                    INSERT INTO categories VALUES('cat','AI',1);
                    INSERT INTO subscriptions VALUES('private-id','Demo user@example.com +8613812345678','cat','monthly','active','2026-11-01',1,987654321,'PRIVATE-ACCOUNT','PRIVATE-NOTE');""")
            before = p.read_bytes()
            value = visitor_catalog(p)
            text = json.dumps(value)
            for secret in ['987654321','PRIVATE-ACCOUNT','PRIVATE-NOTE','user@example.com','13812345678']:
                self.assertNotIn(secret,text)
            self.assertEqual(set(value['items'][0]),{'name','category','cycle','status','renewalDate'})
            self.assertEqual(before,p.read_bytes())
            rich=visitor_catalog(p,True)['items'][0]
            self.assertNotIn('private-id',json.dumps(rich))
            self.assertEqual(len(rich['id']),24)
            self.assertTrue(rich['logoSrc'].endswith(rich['id']))

if __name__ == '__main__':
    unittest.main()
