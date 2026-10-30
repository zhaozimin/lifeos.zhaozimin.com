# Design System · SubOS

> 设计系统真源是 https://ui.zhaozimin.com（赵子民设计系统 v4「纸 · 墨 · 朱」）。
> 本仓库锁定 v0.7.0，文件在 `design/zzm/zzm.css`，由 `web/src/index.css` 导入并放进 `zzm` 层（排在 Tailwind 工具类之前）。
> 订阅域只在 `web/src/design/tokens.css` 做语义映射，色值全部指向 `--zzm-*`，不另写色板。

## 本地约定

- 两种模式：浅色与深色。宿主 LifeOS 下发 `light / dark`，写成根节点的 `data-theme`。
- 主配色是朱砂红：主操作 `.btn-zhu` 是朱键，`.btn-ink` 是次一级墨键；侧栏当前行朱色淡底朱字。
- 侧栏宽 266，即 LifeOS 工作台的订阅二级栏，贴着一级栏铺满。
- 内容区自适应铺满，上 24、左右 40；最宽 `--lifeos-content-max` 后居中，与宿主同值。订阅卡以标准卡宽 264 自动排列列数（`.sub-grid`），不写死列数。
- 侧栏导航行扁平：悬停一层 `fill` 灰底；当前行朱色淡底、朱字、600 字重。
- 键的光影只取 `--zzm-key-*` 与 `--zzm-ink-key-*`；卡片、浮层分别取 `--zzm-card-shadow`、`--zzm-float-shadow`。
- 系统字体栈，无衬线；金额与正文同族。

## 订阅域语义色

| 令牌 | 含义 | 取值 |
|---|---|---|
| `--due-ok` | 到期从容（＞7 天） | `--zzm-text-4`，不着色 |
| `--due-mid` | 将到期（4–7 天） | 提醒赭 `#96691F` / 深色 `#D9A94F` |
| `--due-late` | 紧急（≤3 天） | `--zzm-accent-ink` |
| `--balance-gold` | 余额抵扣 | 哑光金 `#A68A5B` / 深色 `#C8AD7F` |
| `--ico-*` | 分类边标 | 哑光数据色，与 LifeOS 面板 `DATA_SERIES` 同族 |

## 提醒

提醒三波：正好提前 7 / 3 / 1 天各响一次。错过不补发。页开着走浏览器通知；页关着走 Hermes 微信。
