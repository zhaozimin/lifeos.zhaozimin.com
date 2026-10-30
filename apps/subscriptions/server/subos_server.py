#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖 store 的领域读写、cardidentify 的瞬时 BIN 查询、cardartsearch 的候选发现、aicardart 的脱敏照片生成，依赖 server/web 预构建看板
[OUTPUT]: 提供本人接口、只读公开目录、静态前端和双模式分钟结算
[POS]: server 的进程入口，不承载日期算术
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import json
import logging
import mimetypes
import os
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from appstore import ensure_icon, guess_track_id, warm_icons  # noqa: E402
from aicardart import ai_status, generate_card_art, save_openai_api_key  # noqa: E402
from cardartsearch import search_card_art  # noqa: E402
from cardidentify import identify_card_iin  # noqa: E402
from cardcovers import (  # noqa: E402
    cover_content_type,
    cover_path,
    resolve_card_cover,
)
from catalog import known_track_ids, logo_src  # noqa: E402
from store import Store, StoreError  # noqa: E402
from visitor import visitor_catalog  # noqa: E402
from visitor_icons import visitor_icon  # noqa: E402

RUNTIME_DIR = ROOT / "runtime"
COVER_DIR = RUNTIME_DIR / "card-covers"
DB_PATH = Path(os.environ.get("SUBOS_DB") or (RUNTIME_DIR / "subos.sqlite3"))
WEB_DIR = ROOT / "web"
WEB_ROOT = WEB_DIR.resolve()
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 18787
MAX_JSON_BODY_BYTES = 64 * 1024
MAX_AI_JSON_BODY_BYTES = 2 * 1024 * 1024

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

STORE = Store(DB_PATH)


def json_bytes(payload: Any, status: int = 200) -> tuple[int, bytes, str]:
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return status, body, "application/json; charset=utf-8"


class Handler(BaseHTTPRequestHandler):
    server_version = "SubOS/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _internal_error(self, exc: Exception) -> None:
        # 不记录异常内容或 payload，避免敏感输入进入日志；保留类型与源码位置。
        frames = []
        trace = exc.__traceback__
        while trace is not None:
            frames.append(f"{Path(trace.tb_frame.f_code.co_filename).name}:{trace.tb_lineno}")
            trace = trace.tb_next
        logging.error("%s at %s", type(exc).__name__, " -> ".join(frames))
        self._send(*json_bytes({"error": "服务出了问题"}, 500))

    def _send(
        self,
        status: int,
        body: bytes,
        content_type: str,
        cache_control: str = "no-store",
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self, max_bytes: int = MAX_JSON_BODY_BYTES) -> dict[str, Any]:
        if self.headers.get_content_type() != "application/json":
            raise StoreError("请求需使用 application/json", 415)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError as exc:
            raise StoreError("Content-Length 不合法") from exc
        if length <= 0:
            return {}
        if length > max_bytes:
            raise StoreError("请求体太大", 413)
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise StoreError("JSON 解析失败") from exc
        if data is None:
            return {}
        if not isinstance(data, dict):
            raise StoreError("请求体必须是对象")
        return data

    def _route(self) -> tuple[Any, list[str]]:
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]
        return parsed, parts

    def _assert_local_request(self) -> None:
        allowed = {"127.0.0.1", "localhost", "::1"}
        try:
            host = urlparse(f"//{self.headers.get('Host') or ''}")
            port = self.server.server_address[1]
            if host.hostname not in allowed or (host.port or 80) != port or host.username or host.password or host.path or host.query or host.fragment:
                raise StoreError("SubOS 只接受当前本机地址访问", 403)
            origin_value = str(self.headers.get("Origin") or "").strip()
            if origin_value:
                origin = urlparse(origin_value)
                configured = set(os.environ.get("SUBOS_ALLOWED_ORIGINS", "").split(","))
                same = origin.scheme == "http" and origin.hostname == host.hostname and (origin.port or 80) == port
                explicit = origin_value in configured and origin.scheme == "http" and origin.hostname in allowed
                if not (same or explicit) or origin.username or origin.password or origin.path or origin.query or origin.fragment:
                    raise StoreError("拒绝未经允许的页面来源", 403)
        except ValueError as exc:
            raise StoreError("请求来源格式不合法", 403) from exc

    def do_GET(self) -> None:  # noqa: N802
        try:
            self._assert_local_request()
            parsed, parts = self._route()
            if parts == ["v1", "health"]:
                return self._send(*json_bytes({"ok": True, "name": "SubOS"}))
            if parts == ["v1", "visitor", "catalog"]:
                return self._send(*json_bytes(visitor_catalog(DB_PATH)))
            if parts == ["v1", "visitor", "catalog-v2"]:
                return self._send(*json_bytes(visitor_catalog(DB_PATH,True)))
            if len(parts)==4 and parts[:3]==["v1","visitor","logo"]:
                image,content_type=visitor_icon(DB_PATH,parts[3])
                return self._send(200,image,content_type)
            if parts == ["v1", "logo"]:
                query = parse_qs(parsed.query)
                website = (query.get("website") or [""])[0]
                custom = (query.get("logo_url") or [""])[0]
                return self._send(*json_bytes({"logo_src": logo_src(website, custom)}))
            if parts == ["v1", "summary"]:
                return self._send(*json_bytes(STORE.summary()))
            if parts == ["v1", "reminders"]:
                return self._send(*json_bytes(STORE.reminders()))
            if parts == ["v1", "subscriptions"]:
                return self._send(*json_bytes({"items": STORE.list_subscriptions()}))
            if len(parts) == 3 and parts[:2] == ["v1", "subscriptions"]:
                return self._send(*json_bytes(STORE.get_subscription(parts[2])))
            if parts == ["v1", "payment-methods"]:
                return self._send(*json_bytes({"items": STORE.list_payment_methods()}))
            if parts == ["v1", "cards"]:
                return self._send(*json_bytes({"items": STORE.list_cards()}))
            if parts == ["v1", "card-cover", "ai-status"]:
                return self._send(*json_bytes(ai_status()))
            if len(parts) == 3 and parts[:2] == ["v1", "cards"]:
                return self._send(*json_bytes(STORE.get_card(parts[2])))
            if len(parts) == 2 and parts[0] == "card-covers":
                return self._serve_card_cover(parts[1])
            if parts == ["v1", "accounts"]:
                return self._send(*json_bytes({"items": STORE.list_accounts()}))
            if parts == ["v1", "categories"]:
                return self._send(*json_bytes({"items": STORE.list_categories()}))
            if len(parts) == 2 and parts[0] == "icons":
                return self._serve_icon(parts[1])
            if parts and parts[0] == "v1":
                return self._send(*json_bytes({"error": "找不到这个接口"}, 404))
            return self._serve_static()
        except StoreError as exc:
            self._send(*json_bytes({"error": str(exc)}, exc.status))
        except sqlite3.Error:
            self._send(*json_bytes({"error": "本机账本正忙，请稍后再试"}, 503))
        except Exception as exc:
            self._internal_error(exc)

    def do_POST(self) -> None:  # noqa: N802
        try:
            self._assert_local_request()
            _, parts = self._route()
            max_bytes = (
                MAX_AI_JSON_BODY_BYTES
                if parts == ["v1", "card-cover", "ai-generate"]
                else MAX_JSON_BODY_BYTES
            )
            payload = self._read_json(max_bytes)
            if parts == ["v1", "subscriptions"]:
                return self._send(*json_bytes(STORE.create_subscription(payload), 201))
            if parts == ["v1", "payment-methods"]:
                return self._send(*json_bytes(STORE.create_payment_method(payload), 201))
            if parts == ["v1", "cards"]:
                return self._send(*json_bytes(STORE.create_card(payload), 201))
            if parts == ["v1", "card-identify"]:
                return self._send(*json_bytes(identify_card_iin(payload.get("iin"))))
            if parts == ["v1", "card-cover", "search"]:
                return self._send(*json_bytes(search_card_art(payload)))
            if parts == ["v1", "card-cover", "resolve"]:
                source_url = str(payload.get("source_url") or "").strip()
                return self._send(
                    *json_bytes(resolve_card_cover(source_url, COVER_DIR), 201)
                )
            if parts == ["v1", "card-cover", "ai-key"]:
                return self._send(*json_bytes(save_openai_api_key(payload.get("api_key"))))
            if parts == ["v1", "card-cover", "ai-generate"]:
                return self._send(*json_bytes(generate_card_art(payload, COVER_DIR), 201))
            if parts == ["v1", "accounts"]:
                return self._send(*json_bytes(STORE.create_account(payload), 201))
            if parts == ["v1", "categories"]:
                return self._send(*json_bytes(STORE.create_category(payload), 201))
            if parts == ["v1", "reminders", "claim"]:
                return self._send(*json_bytes(STORE.claim_reminders()))
            if parts == ["v1", "reminders", "release"]:
                return self._send(*json_bytes(STORE.release_reminders(payload)))
            if parts == ["v1", "reminders", "ack"]:
                return self._send(*json_bytes(STORE.ack_reminders(payload)))
            if len(parts) == 4 and parts[:2] == ["v1", "subscriptions"] and parts[3] in ("balance", "top-up"):
                action = STORE.set_balance if parts[3] == "balance" else STORE.top_up_balance
                return self._send(*json_bytes(action(parts[2], payload)))
            if (
                len(parts) == 4
                and parts[:2] == ["v1", "subscriptions"]
                and parts[3] in ("confirm-renewal", "pause", "resume")
            ):
                if parts[3] == "confirm-renewal":
                    return self._send(*json_bytes(STORE.confirm_renewal(parts[2])))
                if parts[3] == "pause":
                    keep = bool(payload.get("keep_remaining", True))
                    return self._send(
                        *json_bytes(STORE.pause_subscription(parts[2], keep))
                    )
                return self._send(*json_bytes(STORE.resume_subscription(parts[2])))
            self._send(*json_bytes({"error": "找不到这个接口"}, 404))
        except StoreError as exc:
            self._send(*json_bytes({"error": str(exc)}, exc.status))
        except sqlite3.Error:
            self._send(*json_bytes({"error": "本机账本正忙，请稍后再试"}, 503))
        except Exception as exc:
            self._internal_error(exc)

    def do_PUT(self) -> None:  # noqa: N802
        try:
            self._assert_local_request()
            _, parts = self._route()
            payload = self._read_json()
            if parts == ["v1", "subscriptions", "reorder"]:
                return self._send(*json_bytes(STORE.reorder_subscriptions(payload)))
            if len(parts) == 3 and parts[:2] == ["v1", "subscriptions"]:
                return self._send(*json_bytes(STORE.update_subscription(parts[2], payload)))
            if len(parts) == 3 and parts[:2] == ["v1", "payment-methods"]:
                return self._send(*json_bytes(STORE.update_payment_method(parts[2], payload)))
            if len(parts) == 3 and parts[:2] == ["v1", "cards"]:
                return self._send(*json_bytes(STORE.update_card(parts[2], payload)))
            if len(parts) == 3 and parts[:2] == ["v1", "accounts"]:
                return self._send(*json_bytes(STORE.update_account(parts[2], payload)))
            if len(parts) == 3 and parts[:2] == ["v1", "categories"]:
                return self._send(*json_bytes(STORE.update_category(parts[2], payload)))
            self._send(*json_bytes({"error": "找不到这个接口"}, 404))
        except StoreError as exc:
            self._send(*json_bytes({"error": str(exc)}, exc.status))
        except sqlite3.Error:
            self._send(*json_bytes({"error": "本机账本正忙，请稍后再试"}, 503))
        except Exception as exc:
            self._internal_error(exc)

    def do_DELETE(self) -> None:  # noqa: N802
        try:
            self._assert_local_request()
            _, parts = self._route()
            if len(parts) == 3 and parts[:2] == ["v1", "subscriptions"]:
                STORE.delete_subscription(parts[2])
                return self._send(*json_bytes({"ok": True}))
            if len(parts) == 3 and parts[:2] == ["v1", "payment-methods"]:
                STORE.delete_payment_method(parts[2])
                return self._send(*json_bytes({"ok": True}))
            if len(parts) == 3 and parts[:2] == ["v1", "cards"]:
                STORE.get_card(parts[2])
                STORE.delete_payment_method(parts[2])
                return self._send(*json_bytes({"ok": True}))
            if len(parts) == 3 and parts[:2] == ["v1", "accounts"]:
                STORE.delete_account(parts[2])
                return self._send(*json_bytes({"ok": True}))
            if len(parts) == 3 and parts[:2] == ["v1", "categories"]:
                STORE.delete_category(parts[2])
                return self._send(*json_bytes({"ok": True}))
            self._send(*json_bytes({"error": "找不到这个接口"}, 404))
        except StoreError as exc:
            self._send(*json_bytes({"error": str(exc)}, exc.status))
        except sqlite3.Error:
            self._send(*json_bytes({"error": "本机账本正忙，请稍后再试"}, 503))
        except Exception as exc:
            self._internal_error(exc)

    def _serve_icon(self, filename: str) -> None:
        stem = filename.rsplit(".", 1)[0]
        track_id = guess_track_id(stem)
        if track_id is None:
            self._send(*json_bytes({"error": "图标编号不合法"}, 400))
            return
        try:
            path = ensure_icon(track_id)
        except FileNotFoundError as exc:
            self._send(*json_bytes({"error": str(exc)}, 404))
            return
        except Exception as exc:
            # 不记录异常内容或 payload，避免敏感输入进入日志；保留类型与源码位置。
            frames = []
            trace = exc.__traceback__
            while trace is not None:
                frames.append(f"{Path(trace.tb_frame.f_code.co_filename).name}:{trace.tb_lineno}")
                trace = trace.tb_next
            logging.error("%s at %s", type(exc).__name__, " -> ".join(frames))
            self._send(*json_bytes({"error": "图标下载失败"}, 502))
            return
        self._send(200, path.read_bytes(), "image/jpeg", "public, max-age=604800")

    def _serve_card_cover(self, filename: str) -> None:
        path = cover_path(filename, COVER_DIR)
        if not path.exists() or not path.is_file():
            self._send(*json_bytes({"error": "找不到这张卡面"}, 404))
            return
        self._send(
            200,
            path.read_bytes(),
            cover_content_type(filename),
            "public, max-age=31536000, immutable",
        )

    def _serve_static(self) -> None:
        if not WEB_ROOT.exists():
            self._send(
                *json_bytes(
                    {
                        "error": "前端还没构建。请在项目根目录执行 ./start.sh，或进入 web/ 运行 npm run build。"
                    },
                    503,
                )
            )
            return
        parsed = urlparse(self.path)
        rel = parsed.path.lstrip("/")
        if rel == "" or rel.endswith("/"):
            rel = "index.html"
        target = (WEB_ROOT / rel).resolve()
        if not str(target).startswith(str(WEB_ROOT) + os.sep) and target != WEB_ROOT:
            self._send(*json_bytes({"error": "路径不合法"}, 400))
            return
        if not target.exists() or target.is_dir():
            # SPA fallback
            target = WEB_ROOT / "index.html"
        if not target.exists():
            self._send(*json_bytes({"error": "找不到页面"}, 404))
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if content_type.startswith("text/"):
            content_type += "; charset=utf-8"
        self._send(200, target.read_bytes(), content_type)


LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def assert_loopback(host: str) -> str:
    if host not in LOOPBACK_HOSTS:
        raise SystemExit(f"SubOS 只绑本机回环，拒绝 {host}")
    return host


def settle_billing_until(stopped: threading.Event) -> None:
    """每分钟续期；读取时也会按保存的订阅方式补算离线周期。"""
    while not stopped.is_set():
        try:
            STORE.settle_billing()
        except Exception as exc:
            logging.error("订阅计费结算失败：%s", type(exc).__name__)
        stopped.wait(60)


def run(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
    host = assert_loopback(host)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=warm_icons, args=(known_track_ids(),), daemon=True).start()
    httpd = ThreadingHTTPServer((host, port), Handler)
    stopped = threading.Event()
    threading.Thread(target=settle_billing_until, args=(stopped,), daemon=True).start()
    print(f"SubOS 已启动  http://{host}:{port}", flush=True)
    print(f"数据文件      {DB_PATH}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nSubOS 已停止", flush=True)
    finally:
        stopped.set()
        httpd.server_close()


if __name__ == "__main__":
    bind_host = os.environ.get("SUBOS_HOST", DEFAULT_HOST)
    bind_port = int(os.environ.get("SUBOS_PORT", str(DEFAULT_PORT)))
    run(bind_host, bind_port)
