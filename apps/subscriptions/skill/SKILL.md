---
name: subos
description: >
  本地 SubOS 订阅承诺钟。用户说新订了、开通了、续费了某个服务并带金额或下次扣款日，
  或说某订阅不续了、取消、暂停、停掉、到期不再付、又要用回来了、重新订上，
  即使没提 SubOS，也必须加载本 Skill 并用 subosctl 写入。
  也用于查看今天 7/3/1 天提醒。Use when the user runs /subos。
---

<!--
[INPUT]: 依赖本机 SubOS（127.0.0.1:18787）与 scripts/subosctl.py
[OUTPUT]: 代记新订阅、暂停与恢复、列出到期三波
[POS]: Hermes / Grok 的 SubOS 入口。钟的算术在服务端，这里只传用户原话
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->

# SubOS

执行必须调用本目录 `scripts/subosctl.py`，禁止手写 curl。连不上就让用户先在项目里 `./start.sh --daemon`。

```bash
python3 scripts/subosctl.py <命令>
```

Skill 若已安装，也可用 `~/.hermes/skills/subos/scripts/subosctl.py` 或 `~/.grok/skills/subos/scripts/subosctl.py`。

## 何时动手

- **记下**：新订、开通、买了会员、以后每月要扣，且能确定名称、网站、金额、下次扣款日。
- **到期不续**：不续了、取消、到期不再付，使用 `cancel`。保留原账单日，不赠回剩余天数；用户还需自行关闭服务商自动续费。
- **暂停**：明确冻结时使用 `pause`，立即冻结剩余天数。明确放弃剩余期限才加 `--now`。这些动作只修改本机记录。
- **恢复**：又要用了、重新订上、继续续订。`resume` 把冻结的天数还回来；没有剩余的从那天起重新算一期。
- **查看**：有哪些订阅、今天该不该提醒。

缺关键字段只问那一个：名称、网站、金额（人民币）、下次扣款日。周期默认每月；用户说年付再用 `--cycle yearly`。网站填域名，不要用名称猜 logo。分类可由服务端按名称推断；用户明说「这是话费」再带 `--category`。

## 命令

```bash
python3 scripts/subosctl.py list
python3 scripts/subosctl.py due
python3 scripts/subosctl.py add --name "ChatGPT Plus" --website chatgpt.com --amount 72.48 --next 2026-09-01
python3 scripts/subosctl.py add --name "ChatGPT Plus" --website chatgpt.com --amount 72.48 --next 2026-09-01 --account me@x.com --category AI
python3 scripts/subosctl.py add --name "iCloud+" --website icloud.com --amount 21 --next 2026-09-01 --cycle yearly
python3 scripts/subosctl.py add --name "周卡" --website example.com --amount 10 --next 2026-09-01 --cycle custom --days 7
python3 scripts/subosctl.py cancel "ChatGPT"
python3 scripts/subosctl.py pause "ChatGPT"
python3 scripts/subosctl.py pause "ChatGPT" --now
python3 scripts/subosctl.py pause "ChatGPT" --id sub_ab12
python3 scripts/subosctl.py resume "ChatGPT"
```

`pause` / `cancel` / `resume` 命中多条时，把列出的 id 给用户选，再带 `--id` 重跑。不要一次停掉全部。

同一应用可以有多个账号，记下第二条订阅即可。账号标识相同则复用同一条账号，不要新建。

成功时原样转达脚本打印的那一行。没有那一行就不能说已经写入。

## 提醒（给 Hermes cron，不是对话里现算）

三波由 SubOS 判定：正好提前 7 天、3 天、1 天各一次，错过不补。投递脚本：

```bash
python3 ~/.hermes/scripts/subos-remind.py
```

空输出 = 今天没到点。有输出 = 原文发给用户。不要让模型重写到期日。此 stdout cron 没有成功投递回调，因此不提前回执；失败可重试，同日重复运行可能重复提醒。

具备外部成功回调的投递器可运行 `remind --receipt-file /本机唯一新文件.json` 领取五分钟租约；确认发送成功后才运行 `ack-reminders /同一文件.json`。不要在仅生成文案时执行 ack。超时或失败不确认，下次领取可重试。

安装投递（一天一次，早上九点，微信原文）：

```bash
hermes cron create "0 9 * * *" \
  --name "SubOS 三波提醒" \
  --script subos-remind.py \
  --no-agent \
  --deliver weixin
```

## 边界

- 不编流水、不改金额除非用户明说。
- 不把密码写进账号。
- 暂停不是删除。用户说删掉再用编辑页或明确再说。
- 暂停也不是过期。暂停的订阅不算月费、不响三波，但记录和分类都还在，随时能恢复。
- 恢复和确认续费会挪下次扣款日。不要替用户猜日期，恢复完把脚本那一行原样转达。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
