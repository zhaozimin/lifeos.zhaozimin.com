# theme/
> L2 | 父级: ../CLAUDE.md

纸墨朱单一主题，浅色与深色两套值。
界面颜色由 design/zzm/zzm.css 的 var(--zzm-*) 提供。
index.css 把 shadcn 语义变量桥接到 --zzm-*。
ECharts 和 Canvas 读不到 CSS 变量，只从本目录取实色。

成员清单
index.ts: 画布实色 ZZM_TOKENS、哑光数据色 DATA_SERIES 与浏览器 theme-color；逐项镜像 zzm.css v0.7.0。

法则：数据色避开朱色色相；DATA_SERIES 前四位必须与 index.css 的 nature 色同值。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
