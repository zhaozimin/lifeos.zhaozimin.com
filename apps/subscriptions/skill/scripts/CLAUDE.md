# skill/scripts/
> L2 | 父级: ../CLAUDE.md

成员清单
subosctl.py: HTTP 客户端与命令行入口。调用本机订阅动作和提醒接口，不自行计算扣款日；remind 默认只输出，--receipt-file 领取，外部成功后 ack-reminders 确认。
subos-remind.py: Hermes cron 的静音入口。定位 subosctl 后调用提醒命令，输出由 Hermes 投递；stdout 流程没有成功反馈，保留至少一次投递语义。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
