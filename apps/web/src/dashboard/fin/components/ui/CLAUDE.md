# ui/
> L2 | 父级: ../CLAUDE.md

成员清单
AlertDialog.tsx: 受控确认与通知弹窗；统一危险操作和单按钮反馈，禁止业务层退回原生 alert/confirm。

法则: 本目录只保留与共享 `src/components/ui/` 行为真正分叉、合并即改变财务侧现有交互的原语。
其余原语（Autocomplete/Badge/Button/Card/DatePicker/KPICard/Modal/PageHeader/SegmentedSwitch/
Select/StatusPill/Tabs/TextInput）已并入 `src/components/ui/`，财务页面一律从那里导入，禁止再复制回来。
分叉的确切差异写在文件的 L3 头部；Autocomplete 的分叉随时间维度下拉一起消解；消解分叉必须先对齐行为，再删副本。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
