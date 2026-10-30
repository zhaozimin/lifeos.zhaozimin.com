# design/zzm/
> L2 | 父级: ../CLAUDE.md

赵子民设计系统 v4「纸 · 墨 · 朱」的锁版本副本。
真源是 https://ui.zhaozimin.com ，本目录只存消费方落点，不在这里改样式。

成员清单
zzm.css: v0.7.0（2026-10-16）完整样式，原样取自 https://ui.zhaozimin.com/v/0.7.0/zzm.css ；sha256 d9d4e8bdbd57964e9920014b2546e069a144f6292b4f0bb7caed1210169d38a9。

消费方
apps/web/src/dashboard/index.css: 面板以 layer(zzm) 导入，排在 Tailwind base 之后、utilities 之前；根节点 html 带 .zzm-v4。
apps/web/health-ui.mjs: 构建健康页时复制为 health-console/zzm.css。
apps/subscriptions/web/src/index.css: SubOS 样式入口，同样入 zzm 层。

升级: 下载新版本覆盖 zzm.css，更新本文件的版本与 sha256，并同步 apps/web/src/dashboard/theme/index.ts 里镜像的画布实色。
已知上游问题: .zzm-tab:hover 与 .zzm-page:hover 写死浅色值，深色下会变成近黑字；面板因此不使用这两个类。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
