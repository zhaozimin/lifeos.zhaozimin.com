# settings/
> L2 | 父级: ../CLAUDE.md

成员清单
SettingsHub.tsx: 按领域装配设置面板；settingsNavFor 提供同源菜单。时间、财务、记录拥有独立路径，旧深链自动跳转。LifeOS 设置只放全局选项。
AboutPanel.tsx: LifeOS 设置「关于作者」页的作者名片；站点磁贴与频道胶囊，懒加载。原在订阅设置顶部。
about.css: 作者名片样式；只用 --zzm-* 令牌与 .zzm-card，只由 AboutPanel 导入。
about-avatar.ts: 作者头像 data URI（160px JPEG）；名片零网络请求。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
