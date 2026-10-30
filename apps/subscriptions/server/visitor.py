# -*- coding: utf-8 -*-
"""
[INPUT]: 订阅SQLite的只读连接。
[OUTPUT]: 不含价格、账号、网址和银行卡的公开目录。
[POS]: 访客投影边界；不调用结算或修改工作库。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import re
import sqlite3
import hashlib

def public_label(value):
    text = str(value or "")
    text = re.sub(r"https?://\S+|[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}|\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:\+?\d[\d ()-]{5,}\d)", "[已隐藏]", text)
    text = re.sub(r"[¥￥$€£]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:美元|人民币|港币|欧元|英镑|元|USD|CNY|HKD|EUR)", "[已隐藏]", text, flags=re.I)
    return text[:100]

def visitor_catalog(db_path, include_brand=False):
    with sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True) as conn:
        rows = conn.execute("""SELECT s.id, s.name, c.name, s.cycle, s.status, s.next_renewal_on
            FROM subscriptions s LEFT JOIN categories c ON c.id=s.category_id
            ORDER BY c.sort_order,s.sort_order,s.name LIMIT 500""").fetchall()
    return {"items": [{"name": public_label(name), "category": public_label(category or "未分类"),
        "cycle": cycle, "status": status, "renewalDate": renewal,
        **({"id":public_id(id),"logoSrc":"/api/visitor/subscriptions/logo/"+public_id(id)} if include_brand else {})}
        for id, name, category, cycle, status, renewal in rows]}

def public_id(id):
    return hashlib.sha256(str(id).encode()).hexdigest()[:24]
