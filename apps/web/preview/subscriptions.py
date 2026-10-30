# -*- coding: utf-8 -*-
"""
[INPUT]: 父进程指定的临时目录、SubOS领域接口与可选的本人快照 apps/web/.private/subos-preview.sqlite3。
[OUTPUT]: 随机回环端口上的订阅账本：有快照用快照副本，没有快照用合成样本。
[POS]: UI演示子进程；不启动结算线程，不连接VPS或18787隧道。
       快照只复制进本次临时目录，预览里的修改随临时目录回收，不回写快照或真账本。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import os
import shutil
import sys
from pathlib import Path
from http.server import ThreadingHTTPServer

runtime = Path(sys.argv[1]).resolve()
database = runtime / "subscriptions.sqlite3"
# 本人快照：被 .gitignore 与 Vite fs.deny 同时挡住，只在本机存在
snapshot = Path(__file__).resolve().parents[1] / ".private" / "subos-preview.sqlite3"
if snapshot.is_file():
    shutil.copyfile(snapshot, database)
os.environ["SUBOS_DB"] = str(database)
os.environ["SUBOS_ALLOWED_ORIGINS"] = "http://127.0.0.1:5173"
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "subscriptions" / "server"))
import subos_server as app

app.RUNTIME_DIR = runtime
app.COVER_DIR = runtime / "card-covers"
# 已有订阅时 seed_demo 不写入，快照副本保持原样
app.STORE.seed_demo()

class Handler(app.Handler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
print(server.server_port, flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
