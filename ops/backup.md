<!--
[INPUT]: 只读导出账号、R2 私有桶与本机 age 私钥。
[OUTPUT]: 备份检查、异地下载、隔离恢复与故障定位步骤。
[POS]: P1 数据恢复入口；服务配置与 OAuth 会话另按各自运维说明恢复。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->
# 每日加密备份

VPS 在北京时间 02:00 后两分钟内运行备份。
账号为 `lifeos-backup`，与传话筒账号隔离。
数据库账号同名，只获得全库读取能力。
归档与行数来自同一 PostgreSQL 快照。
备份包含 public、auth、storage 和迁移记录。
public 包含本机来源档案、私有附件、人工修改版本和原版界面配置。
微信消息档案、回复版本和云记忆队列随库备份。
导出失败或发现尚未支持的 Storage 实体时，任务失败。

`age` 公钥位于 VPS，私钥只在本机：
`~/Library/Application Support/LifeOS/credentials/lifeos-backup-age.key`。
不得把私钥上传到 VPS 或 R2。
明文导出仅存在于私有临时目录，结束时删除。

R2桶名从私有配置读取，示例为`YOUR_PRIVATE_BACKUP_BUCKET`。
部署时禁用公开访问，不在Git保存真实桶名。
对象前缀为 `daily/`，文件后缀为 `.tar.age`。
专用令牌只读写此桶，来源仅限 VPS 的 IPv4 与 IPv6。
上传后检查对象长度和 SHA256 元数据。
新备份确认成功后，清理超过三十天的本系统归档。
失败十分钟后重试，两小时内最多三次。

检查命令：

```bash
systemctl status lifeos-backup.timer --no-pager
systemctl show lifeos-backup -p Result -p ExecMainStatus
journalctl -u lifeos-backup -n 20 --no-pager
```

最近一次成功状态在 `/var/lib/lifeos-backup/last-success.json`。
`uploaded: true` 才代表异地副本已确认。
日志不包含密码、密钥或原话。
来源地址变化时，核对 VPS 的真实出口后更新令牌白名单。

## 恢复演练

从 R2 下载归档，核对 SHA256，再复制到本机私有目录。
VPS 没有解密私钥，不能代替本机执行解密。
在本机运行：

```bash
python3 ops/verify-backup.py <归档路径> \
  --identity "$HOME/Library/Application Support/LifeOS/credentials/lifeos-backup-age.key" \
  --report <私有报告路径>
```

验证器使用临时 PostgreSQL 17，只监听私有 Unix socket。
它恢复所有归档表，并比较同一快照的行数。
清单单独核对来源、附件、修改版本、偏好、健康和记忆表。
附件同时核对字节长度和 SHA256。
它用真实归属检查本人 AAL2 可读、AAL1 与异主不可读。
它还检查匿名权限、原话和助手正文不可变约束。
结束时关闭临时数据库，删除解密文件。
它不连接生产数据库，不执行线上切换。

数据库恢复不包括服务器配置、域名或 OAuth 授权。
健康发布副本、报告与操作记录随数据库恢复。
WHOOP私有SQLite及刷新令牌不在此归档内。
MemOS私有Key、云向量和模型内部状态不在此归档内。
整库恢复前暂停云同步，核对备份之后已接受的云任务。
不要将备份中的pending任务直接再次上传。
VPS丢失后，恢复网页历史并重新授权WHOOP。
重建运行环境时，按 relay.md、wechat.md 和 antigravity.md 恢复这些配置。
切换线上数据库前，先停止传话筒，核对本人账号、RLS 与迁移版本。

发布验收连续手动触发备份时，systemd 的启动频率限制也会计数。
先核对此前任务均成功，再对该服务执行 reset-failed 并手动验收一次。
不修改定时器的失败重试上限。
