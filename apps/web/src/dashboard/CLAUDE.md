# dashboard/ - 本机原版界面
> L2 | 父级: ../CLAUDE.md

直接移植本机 web-dashboard 的组件、图表与主题。
页面只依赖 api/；Cookie 与云端契约在传输层适配。
本机程序、SQLite 与访问密钥不进入云端。

成员清单
components/: 原版导航、顶栏、日周时间轴和 UI 原语。
fin/: 原版财务看板、流水、资金流及配置。
pages/: 原版时间账、统计与时间设置。
settings/: 原版设置分组与懒加载注册表。
theme/: 纸墨朱单一主题的画布实色与哑光数据色；界面色经 index.css 桥接到 --zzm-*。
lib/: 原版日期、导出与时间轴纯函数。
store/: 浏览器外观偏好；不保存认证令牌。
api/: 本人 Cookie 传输与云端数据契约。
types.ts: 大类统计、WHOOP睡眠权威来源、时间段与修改痕迹类型。
index.css: 导入锁版本 zzm.css，把 shadcn 语义变量桥接到 --zzm-*，定义字阶、数据色与弹层动效。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
