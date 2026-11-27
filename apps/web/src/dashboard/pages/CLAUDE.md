# pages/
> L2 | 父级: ../CLAUDE.md

成员清单
访客复用时间浏览与统计，撤除修改痕迹、编辑和拖拽。
DayPage页头常显日周切换，访客与本人共用状态和日期面板。
DayPage.tsx: 按服务端记录时区加载可导航的日/周账本与本人 Orca AI 遥测；在汇总卡展示 AI 双轨协同摘要栏并向日/周时间轴下发 AI 并发切片与墙钟/UTC 瞬间；AbortSignal/请求代次阻止旧覆盖，修改痕迹入口读取本地审计版本。
StatsPage.tsx: 本人大类统计；工作时间拆分心流深度与 AI 轻度协同，叠加 Orca AI 算力/并发杠杆 KPI 及人机双轨 ECharts 趋势图；WHOOP实睡按醒来日汇总，日历分布按实际时段切分。
SettingsPage.tsx: 时间板块独立设置；section 切换主数据、周起点、记录时区三屏。并列展示 resolvedTimezone 真源与 nullable currentSystemTimezone 候选；候选不可识别时禁用 system，preserve 继续 fail-closed。时区迁移经 context 回流 App；登录与验证归 LifeOS 设置。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
