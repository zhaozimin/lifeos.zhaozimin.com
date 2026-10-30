# web/src/
> L2 | 父级: ../CLAUDE.md

成员清单
visitor.ts: 公开目录到原版卡片的只读适配；不请求私人账号、银行卡或写接口。
main.tsx: 浏览器挂载点；样式经 index.css 导入（锁版本 zzm.css 入 zzm 层）。
App.tsx: 嵌入使用MemoryRouter，独立页面使用BrowserRouter；左右壳。挂载订阅、银行卡、统计、设置路由；提醒循环只在本人模式挂载；访客复用原版卡片与只读详情。
shell.tsx: 卡片筛选（全部 / 分类 / 即将到期 / 已暂停 / 已取消与结束 / 已过期）与折合月费。边栏不折叠。
index.css: 纸墨朱样式入口；按原顺序加载 styles，最后复用主工作台 sidebar.css。令牌指向 --zzm-*，银行卡样式由 cards.css 进入。
cards.css: 银行卡资产页主样式边界。点卡即编辑的 Wallet 式层叠卡包、公开原卡图无覆盖、AI 底图本地信息层、BIN 识别与两列公开卡面候选同源。
card-photo.css: AI 卡面照片视觉子边界。上传、脱敏预览、Keychain 配置与生成进度从 cards.css 独立，保持样式职责单一。
types.ts: 与 /v1 同构的双模式订阅、通用余额、银行卡、卡面、支付与汇总类型。
lifeos-bridge.ts: 同源宿主的亮暗模式与刷新桥接；只写 data-theme，不保存会话。
api.ts: 云端走本人AAL2代理，本机维护入口走原版回环REST；唯一fetch出口。包含通用余额设置与幂等充值。领域写成功广播 subos:changed，提醒回执与卡面准备不广播。
vite-env.d.ts: Vite 客户端类型。
pages/: 看板、统计、编辑与设置。
components/: 订阅行与暂停时点选择。
design/: 视觉令牌真源。
lib/: 中文措辞、浏览器通知、统一刷新与异步请求身份。
styles/: 基础页面、浮层响应式与设计展示样式。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
