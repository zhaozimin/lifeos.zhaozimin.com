# store/
> L2 | 父级: ../CLAUDE.md

成员清单
records.ts: 记录板块的默认列表类型；persist 写入 lifeos-records，历史页打开时采用。
shell.ts: 二级栏收起偏好（persist，键 lifeos-shell）。
timeView.ts: 时间域会话内共享视图：锚定日期（null 跟随今天）、日/周、来源筛选与可见区间；DayPage 与时间二级栏共用。
theme.ts: Zustand 外观状态；以 `lifeos-theme` 为本地键持久化亮暗偏好（v1 起不再存色板）。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
