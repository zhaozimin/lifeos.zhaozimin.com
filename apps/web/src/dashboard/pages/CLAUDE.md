# pages/
> L2 | 父级: ../CLAUDE.md

成员清单
访客复用时间浏览与统计，撤除修改痕迹、编辑和拖拽。
DayPage页头常显日周切换，访客与本人共用状态和日期面板。
DayPage.tsx: 按服务端记录时区加载可导航的日/周账本；同时下发墙钟当前分钟与 UTC 当前瞬间，DST 时长服从 UTC，AbortSignal/请求代次阻止旧覆盖，进行中范围逐分钟刷新并在跨午夜时有条件跟随今天；修改痕迹入口读取本地审计版本，旧内容统一灰色删除线且不参与统计。
StatsPage.tsx: 本人大类统计；只计工作大类，WHOOP实睡按醒来日汇总，日历分布按实际时段切分。
SettingsPage.tsx: 时间板块独立设置；section 切换主数据、周起点、记录时区三屏。并列展示 resolvedTimezone 真源与 nullable currentSystemTimezone 候选；候选不可识别时禁用 system，preserve 继续 fail-closed。时区迁移经 context 回流 App；登录与验证归 LifeOS 设置。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
