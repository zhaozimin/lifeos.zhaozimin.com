# skill/
> L2 | 父级: ../CLAUDE.md

成员清单
SKILL.md: Hermes / Grok 入口。记下新订、暂停与恢复。
scripts/subosctl.py: 唯一 HTTP 客户端。list / due / add / pause / cancel / resume / remind / ack-reminders。自定义周期必须带 --days。pause 默认立即冻结天数；cancel 到期不续并保留账单日，--now 是生效途中退订。账号按标识复用，不限制同一应用挂几个号。
scripts/subos-remind.py: cron 静音文案，空则无输出；无投递回调时不写成功回执。
install.sh: 软链到 ~/.hermes/skills/subos 与 ~/.grok/skills/subos；cron 脚本实拷到 ~/.hermes/scripts。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
