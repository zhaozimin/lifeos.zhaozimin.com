# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 cardartsearch 的输入边界、候选清洗排序与可注入搜索提供方
[OUTPUT]: 对外提供卡号拒绝、HTTPS 白名单、官网优先、比例评分与不落库搜索形状回归
[POS]: server 的卡面发现单元测试；不访问真实搜索服务、不下载图片
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from cardartsearch import _search_brave, rank_candidates, search_card_art
from schema import StoreError


class CardArtSearchTests(unittest.TestCase):
    @patch("cardartsearch._read_url")
    def test_maps_brave_page_and_original_image_urls(self, read_url) -> None:
        read_url.return_value = b'''{
          "results": [{
            "title": "Example Gold",
            "url": "https://bank.example/cards/gold",
            "source": "bank.example",
            "thumbnail": {"src": "https://imgs.search.brave.com/gold.jpg"},
            "properties": {
              "url": "https://cdn.bank.example/gold.png",
              "width": 1015,
              "height": 640
            }
          }]
        }'''
        item = _search_brave("Example Gold", "secret")[0]
        self.assertEqual(item["image_url"], "https://cdn.bank.example/gold.png")
        self.assertEqual(item["source_page_url"], "https://bank.example/cards/gold")

    def test_rejects_pan_like_input(self) -> None:
        with self.assertRaises(StoreError):
            search_card_art(
                {"keywords": "4242 4242 4242 4242"},
                duckduckgo_search=lambda _query: [],
            )

    def test_ranks_official_card_shaped_image_first(self) -> None:
        items = rank_candidates(
            [
                {
                    "image_url": "https://images.example.net/logo.png",
                    "source_page_url": "https://images.example.net/page",
                    "title": "Example Bank logo",
                    "width": 128,
                    "height": 128,
                },
                {
                    "image_url": "https://cdn.bank.example/gold-card.webp",
                    "source_page_url": "https://bank.example/cards/gold",
                    "title": "Example Bank Gold Visa credit card",
                    "width": 1015,
                    "height": 640,
                },
            ],
            "bank.example",
            ["Example Bank", "Gold Visa"],
        )
        self.assertEqual(items[0]["source_host"], "bank.example")
        self.assertTrue(items[0]["official"])

    def test_discards_http_and_private_https_candidates(self) -> None:
        items = rank_candidates(
            [
                {"image_url": "http://bank.example/card.jpg"},
                {"image_url": "https://127.0.0.1/card.jpg"},
                {"image_url": "https://localhost/card.jpg"},
            ],
            "bank.example",
            ["Bank"],
        )
        self.assertEqual(items, [])

    @patch.dict(os.environ, {}, clear=True)
    def test_shapes_ephemeral_duckduckgo_result(self) -> None:
        seen: list[str] = []

        def fake(query: str) -> list[dict]:
            seen.append(query)
            return [
                {
                    "image_url": "https://cdn.example/card.jpg",
                    "thumbnail_url": "https://thumb.example/card.jpg",
                    "source_page_url": "https://bank.example/cards/gold",
                    "title": "Gold card",
                    "width": 1015,
                    "height": 640,
                }
            ]

        result = search_card_art(
            {
                "issuer": "Example Bank",
                "product": "Gold",
                "network": "visa",
                "issuer_website": "bank.example",
            },
            duckduckgo_search=fake,
        )
        self.assertEqual(result["provider"], "duckduckgo")
        self.assertEqual(len(result["items"]), 1)
        self.assertTrue(result["items"][0]["official"])
        self.assertIn("Example Bank Gold visa", seen[0])


if __name__ == "__main__":
    unittest.main()
