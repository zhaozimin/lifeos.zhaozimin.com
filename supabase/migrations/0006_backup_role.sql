-- [INPUT]: PostgreSQL 17 的角色与 pg_read_all_data 能力。
-- [OUTPUT]: 未设置密码、默认只读的独立导出角色。
-- [POS]: 备份权限边界；密码由部署时私有注入，不授予 postgres 成员身份。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create role lifeos_backup nologin bypassrls;
grant pg_read_all_data to lifeos_backup;
alter role lifeos_backup set default_transaction_read_only = on;
alter role lifeos_backup set statement_timeout = '120s';
alter role lifeos_backup set idle_in_transaction_session_timeout = '5min';
