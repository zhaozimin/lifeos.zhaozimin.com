<!--
[INPUT]: MemOS云接口、0020消息队列与VPS独立私有配置。
[OUTPUT]: 启停、同步状态、结果不明核查与恢复边界。
[POS]: 云记忆运维入口；不在本文保存凭据或对话正文。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->
# MemOS云记忆

主进程为lifeos-relay.service，不启动第二个微信轮询器。
凭据为`/etc/lifeos/memos.env`，root所有，权限0600。
单元在relay.env后读取此文件。

配置字段：

- MEMOS_ENABLED：true启用，false暂停云读写。
- MEMOS_API_KEY：独立MemOS项目密钥，不进入agy环境。
- MEMOS_BASE_URL：固定官方openmem/v1接口。
- MEMOS_AGENT_ID：默认lifeos-butler，首次启用后保持稳定。
- MEMOS_RECALL_TIMEOUT_MS：默认3000，范围1000至8000。

云user_id固定为`lifeos:`加本人Auth UUID。
微信会话按原话的上海日期分组，角色与原发生时间单独传递。
上传显式设置allow_public=false，不生成共享公共记忆。
召回限五条、合计6000字符，不注入工具和Skill记忆。

## 两条运行路径

回答前检索，失败时用当前消息和最近八轮继续回答。
后台通过memory_jobs提交消息并保存task_id。
已有task_id时只查get/status，不重复上传。
仅同步source=wechat的文字，不批量上传账本或WHOOP原始记录。
用户正文引用raw_inputs，不在档案表再复制一份。
每版回复正文单独保存，渠道接受后才进入云记忆队列。

状态含义：

| 状态 | 含义 |
|---|---|
| waiting_delivery | 回复已生成，渠道接受尚未确认 |
| pending | 可以提交，或明确拒绝后的安全重试 |
| submitting | 当前提交租约持有中 |
| processing | 已有云task_id，等待完成 |
| completed | 云端确认任务完成；不保证一定提炼出新事实 |
| failed | 明确失败或已达到重试上限 |
| unknown | 写入是否被接受不明，禁止自动盲目重投 |

明确可重试的错误退避30秒起，最多五次。
提交网络中断、5xx或写入租约过期且无task_id时记unknown。
轮询失败保留task_id并退避。
unknown先通过会话和source_message_id核查，不直接重置为pending。
原文和回复版本仍保留，可在确认结果后修复同步。
get/message实测给正文外包双引号，并把换行变为空格。
核对时只消除这两项返回差异，再比较角色、正文和条数。
云历史接口不能代替完整格式的自有原文档案。
不得用这个读取格式改写上传正文。

## 检查与暂停

使用systemctl查看服务状态。
journalctl中的relay_ready含memory_enabled。
memory_sync只记录任务编号与状态，不打印正文或密钥。
服务端RPC get_memory_sync_status只返回归属内计数。
网页用户不能领取或完成记忆任务。

暂停时将MEMOS_ENABLED改为false，再重启relay。
暂停不删除档案和任务，也不影响基本问答与记账。
恢复true后继续已有任务；unknown仍需先核查。

上线前运行relay与数据库测试。
真实探针为ops/probe-memory.mjs，使用隔离合成身份。
探针的agy部分与生产模型串行，不向微信发测试消息。

## 备份边界

conversation_messages与memory_jobs进入加密R2副本。
恢复验证同时检查本人AAL2和异主隔离。
云向量、模型内部状态和私有Key不在数据库归档内。
原始微信文字和已捕获回复可用于重建记忆。
整库恢复后先暂停云同步，核对备份之后的云任务，再恢复队列。
不得将已被云接受的旧pending任务盲目重投。
旧版已覆盖的回复无法从当前回执重建。
逐次HTTP投递事件、对话专页和R2长期冷归档尚未实现。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
