# components/
> L2 | 父级: ../CLAUDE.md

成员清单
访客外壳显示只读标识，不挂载财务搜索。
charts/: ECharts 生命周期与主题色适配层；业务页只提供 option。
shell/: 工作台外壳；一级图标栏、二级栏、窄屏标签条与领域清单。
timeline/: 日/周时间账领域编排层；把 UTC 真实时长、24h 墙钟几何、DST 只读降级、整屏/五档缩放、普通日调时和七日日历映射到 ui 时间画布原语。
brand/: 品牌标识母版；ProductLogo 与图标生成器的唯一真源。
ui/: 受控弹层、按钮、卡片、输入与指标卡等设计系统原语。
Layout.tsx: 访客提示不展示登录链接； LifeOS 工作台三栏壳（一级栏 + 二级栏 + 内容区）；承载 ⌘K 全局搜索与软刷新，业务页面在 Outlet 内自行取数；ErrorBoundary 只裹 Outlet，故障半径因此止于内容区。软刷新信号有两条出口：outlet context 给直接挂在本层 Outlet 下的时间三页，导出的 `useRefreshSignal()` 给任意深度的页面——财务页在 FinPageFrame 的二级 Outlet 下，那层不透传 context，`useOutletContext()` 只会拿到 undefined，跨层信号必须走普通 React context。
ErrorBoundary.tsx: 全站唯一的 render 期故障隔离层（class + getDerivedStateFromError/componentDidCatch）；降级卡片点名出事区块、给出可转达的错误摘要与重试按钮，resetKey 变化即自动复位。Layout 用它隔离单页崩溃，App 另挂一层同款兜住壳层崩溃——两层嵌套时 React 交给最近的边界，页面故障吃不掉顶栏与导航。
ProductLogo.tsx: LifeOS 统一品牌标识「朱砂根」；以 ?raw 内联 brand/lifeos-mark.svg 母版，枝叶随墨色切换亮暗，四粒果实用朱砂红。PWA 与收藏夹图标由 brand-icons.mjs 从同一母版生成。不从图标库引入：库图标随升级变形，没有测试会发现。
RevisionHistoryModal.tsx: 时间与账目共用的云端版本历史弹窗；只消费审计事件真值，将旧版本和删除内容统一显示为灰色删除线，当前版本保持正常样式。
RecordTimeZoneProvider.tsx: 记录时区的变更回流桥；App 持有真源，设置面板隔着 Layout/Outlet 只能经它把迁移结果推回，缺 Provider 直接抛错而非静默丢弃。
StatusIndicator.tsx: `/v1/health` 的只读连接状态；compact 为一级栏图标，不产生轮询式业务采集。
ThemeProvider.tsx: 把亮暗偏好写成根节点的 data-theme 与 .dark；颜色全部来自 CSS 令牌。
ThemeSwitcher.tsx: 亮暗模式切换；一级栏为单键轮换，设置页为三档按钮组。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
