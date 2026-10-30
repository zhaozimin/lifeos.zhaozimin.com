<!--
[INPUT]: 每日小结 RPC、本人微信上下文与现有回执队列。
[OUTPUT]: 私密预览、日历安装及启用后的行为约定。
[POS]: P2 定时小结入口；它不运行模型或第二个微信接收器。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->
# 每日微信小结

北京时间每天 23:30 入队一次。
数据库固定快照时刻，合并覆盖区间并分币种汇总。
空白时段至少五分钟，最多列出最长五段。
分类累计可以含重叠；覆盖时长只计算一次。

仅使用本人当天的微信上下文。
当天没有上下文时跳过，不猜测收件人。
微信拒绝过期会话时，既有 outbox 按退避规则重试。
可以在微信发送“今天”主动获取汇总。

系统小结使用 source=system，不计入用户原话条数。
同一自然日使用固定 external_id，重复触发不重复生成。
生成结果作为 parsed 指令恢复回执，不进入模型解析。
微信原话收件箱只显示 source=wechat。

## 安装与启用

先应用 0007_daily_summary.sql，再构建 relay。
`bash ops/deploy-daily.sh` 只安装新定时器，不启用。
明确授权主动推送后，执行：

```bash
bash /opt/lifeos/ops/deploy-daily.sh --enable
systemctl list-timers lifeos-daily.timer --no-pager
```

定时器错过时不在晨间补发。
服务失败十分钟后重试；午夜后不会生成上一日的补发。
暂停推送：`systemctl disable --now lifeos-daily.timer`。

只读预览使用 `dist/src/daily.js --dry-run`。
`--at` 只允许搭配 `--dry-run` 选择历史快照。
预览不入队、不发送消息，输出仅在私有终端或文件查看。
常驻日志只记录结果与错误码，不记录汇总正文。
