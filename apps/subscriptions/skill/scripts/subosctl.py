# -*- coding: utf-8 -*-
"""
[INPUT]: 依赖本机 SubOS HTTP（默认 127.0.0.1:18787）
[OUTPUT]: 对外提供 list / due / add / pause / cancel / resume / remind / ack-reminders
[POS]: Skill 的唯一写入口。禁止 Agent 手写 curl
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
import urllib.error
import urllib.request
from typing import Any

BASE = os.environ.get("SUBOS_URL", "http://127.0.0.1:18787").rstrip("/")


def _request(method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            msg = json.loads(detail).get("error") or detail
        except json.JSONDecodeError:
            msg = detail or str(exc)
        raise SystemExit(f"SubOS {exc.code}：{msg}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"连不上 SubOS（{BASE}）。先在项目目录执行 ./start.sh --daemon"
        ) from exc
    return json.loads(raw) if raw else {}


def _items() -> list[dict[str, Any]]:
    pack = _request("GET", "/v1/subscriptions")
    return list(pack.get("items") or [])


def _match(query: str) -> list[dict[str, Any]]:
    q = query.strip().lower()
    found: list[dict[str, Any]] = []
    for item in _items():
        blob = f"{item.get('name','')} {item.get('website','')}".lower()
        if q and q in blob:
            found.append(item)
    return found


def _pick(items: list[dict[str, Any]], query: str, key: str = "name") -> dict[str, Any] | None:
    q = query.strip().lower()
    if not q:
        return None
    exact = [item for item in items if str(item.get(key) or "").lower() == q]
    if len(exact) == 1:
        return exact[0]
    loose = [
        item
        for item in items
        if q in str(item.get(key) or "").lower() or q == str(item.get("id") or "")
    ]
    return loose[0] if len(loose) == 1 else None


def cmd_list(_: argparse.Namespace) -> int:
    rows = _items()
    if not rows:
        print("还没有任何订阅。")
        return 0
    for item in rows:
        print(
            f"{item['id']}  {item['name']}  ¥{item['amount_yuan']}  "
            f"{item['next_renewal_on']}  还剩{item['days_left']}天  {item['status']}"
        )
    return 0


def cmd_due(_: argparse.Namespace) -> int:
    pack = _request("GET", "/v1/reminders")
    due = pack.get("due") or []
    if not due:
        print("今天没有 7 / 3 / 1 天的提醒。")
        return 0
    for item in due:
        print(
            f"{item['name']}  提前{item['wave']}天  "
            f"¥{item['amount_yuan']}  {item['next_renewal_on']}"
        )
    return 0


def cmd_remind(args: argparse.Namespace) -> int:
    receipt = getattr(args, "receipt_file", "")
    if receipt and Path(receipt).exists():
        raise SystemExit("领取凭据必须写入新的文件，拒绝覆盖既有批次")
    pack = _request("POST", "/v1/reminders/claim", {}) if receipt else _request("GET", "/v1/reminders")
    due = pack.get("due") or []
    if not due:
        return 0
    lines = []
    ack: list[dict[str, Any]] = []
    for item in due:
        lines.append(
            f"SubOS · {item['name']} 还有 {item['wave']} 天扣款"
            f"（¥{item['amount_yuan']} · {item['next_renewal_on']}）"
        )
        ack.append(
            {
                "id": item["id"],
                "delivery_token": item.get("delivery_token"),
                "wave": item["wave"],
                "next_renewal_on": item["next_renewal_on"],
            }
        )
    if receipt:
        # 领取凭据只落本机，stdout 始终是可投递文案。
        try:
            with open(receipt, "x", encoding="utf-8") as output:
                os.chmod(receipt, 0o600)
                json.dump({"items": ack}, output)
        except OSError:
            _request("POST", "/v1/reminders/release", {"items": ack})
            raise
    print("\n".join(lines))
    return 0


def cmd_ack_reminders(args: argparse.Namespace) -> int:
    receipt = Path(args.receipt_file)
    payload = json.loads(receipt.read_text())
    result = _request("POST", "/v1/reminders/ack", payload)
    print(f"已确认 {result['accepted']} 条成功投递")
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    payload = {
        "name": args.name,
        "website": args.website,
        "amount_yuan": args.amount,
        "cycle": args.cycle,
        "next_renewal_on": args.next,
        "auto_renew": not args.no_renew,
    }
    if args.cycle == "custom":
        if not args.days:
            raise SystemExit("自定义周期要带 --days")
        payload["cycle_days"] = args.days
    if args.account:
        existing = _request("GET", "/v1/accounts").get("items") or []
        acc = _pick(existing, args.account, "identifier") or _pick(
            existing, args.account, "label"
        )
        if acc is None:
            acc = _request(
                "POST",
                "/v1/accounts",
                {"label": args.account, "identifier": args.account},
            )
        payload["account_id"] = acc["id"]
    if args.category:
        cats = _request("GET", "/v1/categories").get("items") or []
        cat = _pick(cats, args.category, "name")
        if cat is None:
            raise SystemExit(f"没有这个分类：{args.category}")
        payload["category_id"] = cat["id"]
    if args.payment:
        methods = _request("GET", "/v1/payment-methods").get("items") or []
        pay = _pick(methods, args.payment, "name") or _pick(
            methods, args.payment, "account"
        )
        if pay is None:
            raise SystemExit(f"没有这个支付方式：{args.payment}")
        payload["payment_method_id"] = pay["id"]
    created = _request("POST", "/v1/subscriptions", payload)
    print(
        f"已记下 {created['name']}  ¥{created['amount_yuan']}  "
        f"下次 {created['next_renewal_on']}  {created['id']}"
    )
    return 0


def _lock_one(
    args: argparse.Namespace, want_status: str, already: str
) -> dict[str, Any] | None:
    """
    按名字或 --id 锁定唯一一条。命中多条不猜，把 id 列出来让用户选。
    返回 None 表示已经打印过说明，调用方直接收尾。
    """
    if not args.id and str(args.query).startswith("sub_"):
        args.id = args.query
    found = _match(args.query)
    if args.id:
        found = [row for row in found if row["id"] == args.id] or [
            row for row in _items() if row["id"] == args.id
        ]
    if not found:
        print(f"没有找到「{args.query}」。")
        return None
    hit = [row for row in found if row.get("status") == want_status]
    if not hit:
        print(f"「{found[0]['name']}」{already}")
        return None
    if len(hit) > 1 and not args.id:
        print("不止一条，请用更精确的名字或 --id：")
        for item in hit:
            print(f"  {item['id']}  {item['name']}  {item['next_renewal_on']}")
        return None
    return hit[0]


def cmd_pause(args: argparse.Namespace) -> int:
    item = _lock_one(args, "active", "现在不是生效中，暂停不了。")
    if item is None:
        return 1
    keep = not args.now
    updated = _request(
        "POST",
        f"/v1/subscriptions/{item['id']}/pause",
        {"keep_remaining": keep},
    )
    frozen = updated.get("paused_days_left") or 0
    if frozen:
        print(f"已暂停 {updated['name']}。冻住还剩的 {frozen} 天，恢复时还回来。")
    else:
        print(f"已暂停 {updated['name']}。服务当场停用，恢复时重新算一期。")
    return 0


def cmd_cancel(args: argparse.Namespace) -> int:
    item = _lock_one(args, "active", "这条订阅当前不在生效中。")
    if item is None:
        return 1
    updated = _request("PUT", f"/v1/subscriptions/{item['id']}", {"status": "cancelled", "auto_renew": False})
    print(f"已在本机标记 {updated['name']} 到期不续；期限到 {updated['next_renewal_on']}。请自行确认服务商已关闭续费。")
    return 0


def cmd_resume(args: argparse.Namespace) -> int:
    item = _lock_one(args, "paused", "现在没有暂停，不用恢复。")
    if item is None:
        return 1
    updated = _request("POST", f"/v1/subscriptions/{item['id']}/resume", {})
    print(
        f"已恢复 {updated['name']}。下次扣款 {updated['next_renewal_on']}，"
        f"还剩{updated['days_left']}天。"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="subosctl", description="SubOS 本机订阅钟")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="列出全部订阅").set_defaults(func=cmd_list)
    sub.add_parser("due", help="看今天该响的 7/3/1 天提醒").set_defaults(func=cmd_due)
    remind = sub.add_parser("remind", help="生成提醒文案，不提前确认送达")
    remind.add_argument("--receipt-file", default="", help="领取五分钟租约并保存凭据；投递成功后用 ack-reminders 确认")
    remind.set_defaults(func=cmd_remind)
    ack = sub.add_parser("ack-reminders", help="外部通道确认投递成功后写回执")
    ack.add_argument("receipt_file")
    ack.set_defaults(func=cmd_ack_reminders)

    add = sub.add_parser("add", help="记下一条订阅")
    add.add_argument("--name", required=True)
    add.add_argument("--website", required=True)
    add.add_argument("--amount", required=True, help="人民币，如 72.48")
    add.add_argument("--next", required=True, dest="next", help="下次扣款日 YYYY-MM-DD")
    add.add_argument("--cycle", default="monthly", choices=("monthly", "quarterly", "yearly", "custom"))
    add.add_argument("--days", type=int, default=0, help="自定义周期天数，配合 --cycle custom")
    add.add_argument("--account", default="", help="邮箱或账号标识")
    add.add_argument("--category", default="", help="分类名，如 AI / 话费")
    add.add_argument("--payment", default="", help="已有支付方式的名称或账号")
    add.add_argument("--no-renew", action="store_true")
    add.set_defaults(func=cmd_add)

    pause = sub.add_parser("pause", help="暂停订阅：留着记录，冻住时钟")
    pause.add_argument("query", help="名称或网址片段")
    pause.add_argument("--id", default="")
    pause.add_argument(
        "--now",
        action="store_true",
        help="服务生效途中就退订，剩余期限作废；默认立即暂停并冻结剩余天数",
    )
    pause.set_defaults(func=cmd_pause)

    cancel = sub.add_parser("cancel", help="到期不续：保留原账单日，不冻结天数")
    cancel.add_argument("query", help="名称或网址片段")
    cancel.add_argument("--id", default="")
    cancel.set_defaults(func=cmd_cancel)

    resume = sub.add_parser("resume", help="恢复订阅：把冻结的天数还回来")
    resume.add_argument("query", help="名称或网址片段")
    resume.add_argument("--id", default="")
    resume.set_defaults(func=cmd_resume)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
