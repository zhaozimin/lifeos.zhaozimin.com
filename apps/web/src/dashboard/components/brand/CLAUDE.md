# brand/
> L2 | 父级: ../CLAUDE.md

LifeOS 品牌标识的唯一母版。
图形是朱砂根（Ardisia crenata）：一枝墨色枝叶，叶下垂一串朱砂红圆果，呼应主配色朱砂红。

成员清单
lifeos-mark.svg: 24 网格母版；枝叶用 currentColor 随亮暗变化，果实取 --zzm-accent，叶脉取 --zzm-paper。ProductLogo 以 ?raw 内联它，apps/web/brand-icons.mjs 由它生成收藏夹与桌面图标。

法则: 改标识只改本文件，再运行 npm run icons 重新生成 public/ 下的图标；不在别处另画一份。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
