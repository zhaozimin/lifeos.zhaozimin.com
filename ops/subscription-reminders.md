<!--
[INPUT]: VPS订阅API、当前微信绑定、数据库迁移和relay投递队列。
[OUTPUT]: 七天扣款提醒的安装、预览及故障恢复契约。
[POS]: 订阅推送运维入口；业务日期与去重规则在代码和数据库执行。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->
# 订阅扣款提醒

北京时间每天09至21点整点检查。
只选7天后扣款、生效且自动续费的非零订阅。
文案含订阅名、预计金额、币种和扣款日期。
读取127.0.0.1:18787，不直接读取SQLite。
原版日期推进和月末锚点仍由订阅服务负责。
电脑关机不影响VPS调度。

## 投递边界

复用常驻relay的微信发件队列，不增加接收器。
当前机器人和本人必须有已接收的微信上下文。
扫码只更新授权；新绑定尚未聊天时不猜测上下文。
若微信拒绝旧上下文，发一条消息可更新上下文。
后续检查会更新未送达提醒的上下文并重试。
每笔订阅的每个续费日期只创建一个提醒。
成功后不重发，网络失败仍使用同一投递标识。
当日午夜后排除过期提醒，避免发送旧的七天文案。
浏览器7/3/1天通知独立，不互相消耗回执。
该任务不更改订阅、不扣款、不创建财务流水。
系统提醒不进入微信对话记忆上传队列。

## 安装与验收

先应用0026_subscription_reminders.sql。
构建并发布apps/relay，再重启lifeos-relay.service。
安装同目录的service和timer至/etc/systemd/system/。
执行systemd-analyze verify后执行systemctl daemon-reload。
用户要求启用提醒时执行：

```sh
systemctl enable --now lifeos-subscription-reminders.timer
systemctl start lifeos-subscription-reminders.service
systemctl list-timers lifeos-subscription-reminders.timer
journalctl -u lifeos-subscription-reminders.service --since today
```

运行身份为lifeos，配置沿用/etc/lifeos/relay.env。
只读预览不加载数据库或微信凭据，也不入队：

```sh
cd /opt/lifeos/apps/relay
/home/lifeos/.local/bin/node dist/src/subscriptions.js --dry-run
```

预览包含私人订阅文案，只在本人终端查看。
运行日志只记录数量、原因和安全错误码。
停用只需systemctl disable --now lifeos-subscription-reminders.timer。
