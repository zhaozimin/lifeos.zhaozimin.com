#!/usr/bin/env python3
# [INPUT]: age 加密归档、本机私钥与 PostgreSQL 17 工具。
# [OUTPUT]: 大类规则、睡眠校准、账本与消息副本的恢复及AAL2报告。
# [POS]: 备份验收边界；只使用临时 Unix socket，不连接远程或生产数据库。
# 归档与恢复计数包含访客开关及公开健康副本。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import argparse
import hashlib
import json
import os
import subprocess
import tarfile
import tempfile
import uuid
from pathlib import Path


class RestoreError(RuntimeError):
    def __init__(self, code, diagnostic):
        super().__init__(code)
        self.diagnostic = diagnostic


def run(args, *, env=None, input=None):
    result = subprocess.run([str(arg) for arg in args], env=env, input=input,
                            capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RestoreError(Path(args[0]).name.upper() + '_FAILED', result.stderr)
    return result.stdout


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def verify(archive, identity, pg_bin):
    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='lifeos-restore-', dir='/tmp') as folder:
        folder = Path(folder)
        bundle = folder / 'bundle.tar'
        run(['age', '--decrypt', '--identity', identity, '--output', bundle, archive])
        with tarfile.open(bundle) as tar:
            if {member.name for member in tar.getmembers()} != {'database.dump', 'manifest.json'}:
                raise RuntimeError('ARCHIVE_MEMBERS_INVALID')
            for member in tar.getmembers():
                if not member.isfile():
                    raise RuntimeError('ARCHIVE_TYPE_INVALID')
                (folder / member.name).write_bytes(tar.extractfile(member).read())
        manifest = json.loads((folder / 'manifest.json').read_text())
        if manifest['format'] != 'lifeos-backup-v1':
            raise RuntimeError('BACKUP_FORMAT_INVALID')
        if hashlib.sha256((folder / 'database.dump').read_bytes()).hexdigest() != manifest['dump_sha256']:
            raise RuntimeError('DUMP_HASH_MISMATCH')
        data = folder / 'cluster'
        socket = folder / 'socket'
        socket.mkdir(mode=0o700)
        env = {**os.environ, 'PGHOST': str(socket), 'PGPORT': '59473', 'PGUSER': 'restore_admin',
               'PGDATABASE': 'postgres', 'PGSSLMODE': 'disable', 'PGCONNECT_TIMEOUT': '10'}
        env.pop('PGPASSWORD', None)
        env.pop('PGPASSFILE', None)
        run([pg_bin / 'initdb', '-D', data, '-U', 'restore_admin', '--auth-local=trust',
             '--auth-host=reject', '--encoding=UTF8', '--locale=C'])
        started = False
        try:
            run([pg_bin / 'pg_ctl', '-D', data, '-l', folder / 'postgres.log', '-o',
                 "-c listen_addresses='' -c unix_socket_directories=" + str(socket) + ' -c port=59473',
                 '-w', 'start'], env=env)
            started = True
            sql = 'drop schema public; create role postgres nologin bypassrls;\n'
            for role in manifest['roles']:
                if role['name'] == 'restore_admin':
                    raise RuntimeError('ROLE_COLLISION')
                sql += 'create role ' + quoted(role['name']) + ' nologin ' + ('bypassrls' if role['bypassrls'] else 'nobypassrls') + ';\n'
            run([pg_bin / 'psql', '-Xq', '-v', 'ON_ERROR_STOP=1'], env=env, input=sql)
            run([pg_bin / 'pg_restore', '--no-owner', '--exit-on-error', '--single-transaction',
                 '--dbname=postgres', folder / 'database.dump'], env=env)
            counts = {}
            relations = {'categories': 'public.categories', 'raw_inputs': 'public.raw_inputs',
                         'time_entries': 'public.time_entries', 'transactions': 'public.transactions',
                         'auth_users': 'auth.users', 'storage_objects': 'storage.objects'}
            for name, relation in relations.items():
                counts[name] = int(run([pg_bin / 'psql', '-XqAt', '-c', 'select count(*) from ' + relation], env=env).strip())
            if counts != manifest['counts']:
                raise RuntimeError('RESTORE_COUNTS_MISMATCH')
            history_counts = {}
            for name, expected_count in manifest.get('history_counts', {}).items():
                if name not in {'local_records','local_archive','record_attachments','record_changes','dashboard_preferences',
                                'whoop_records','whoop_publications','whoop_plans','whoop_jobs',
                                'visitor_settings','visitor_health_publications',
                                'conversation_messages','memory_jobs','time_group_policies','time_group_rules','time_sleep_alignments'}:
                    raise RuntimeError('RESTORE_HISTORY_TABLE_INVALID')
                history_counts[name] = int(run([pg_bin / 'psql', '-XqAt', '-c',
                    'select count(*) from public.' + quoted(name)], env=env).strip())
                if history_counts[name] != expected_count:
                    raise RuntimeError('RESTORE_HISTORY_COUNTS_MISMATCH')
            if history_counts:
                invalid_hashes = int(run([pg_bin / 'psql','-XqAt','-c',
                    "select count(*) from public.record_attachments where encode(sha256(content),'hex')<>sha256 or octet_length(content)<>size_bytes;"],env=env).strip())
                if invalid_hashes:
                    raise RuntimeError('RESTORE_ATTACHMENT_HASH_MISMATCH')
            # 带入真实归属，避免缺少 sub 导致所有读取均为零的假阳性。
            owner = run([pg_bin / 'psql', '-XqAt', '-c',
                         'select id from auth.users order by created_at limit 1;'], env=env).strip()
            owner = str(uuid.UUID(owner))
            owner_counts = f"""select
              (select count(*) from public.categories where owner_id='{owner}'),
              (select count(*) from public.raw_inputs where owner_id='{owner}'),
              (select count(*) from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id where r.owner_id='{owner}'),
              (select count(*) from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id where r.owner_id='{owner}');"""
            visible_counts = '''select
              (select count(*) from public.categories),
              (select count(*) from public.raw_inputs),
              (select count(*) from public.time_entries),
              (select count(*) from public.transactions);'''
            for name in sorted(history_counts):
                owner_counts=owner_counts.rstrip(';')+",(select count(*) from public."+quoted(name)+" where owner_id='"+owner+"');"
                visible_counts=visible_counts.rstrip(';')+',(select count(*) from public.'+quoted(name)+');'
            expected = run([pg_bin / 'psql', '-XqAt', '-c', owner_counts], env=env).strip()
            denied_counts='|'.join(['0']*(4+len(history_counts)))

            def visible(subject, aal):
                claims = json.dumps({'sub': subject, 'aal': aal})
                checks = ("begin; set local role authenticated; select set_config('request.jwt.claims','"
                          + claims + "',true); " + visible_counts + ' rollback;')
                output = run([pg_bin / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1'], env=env, input=checks)
                return output.strip().splitlines()[-1]

            if visible(owner, 'aal1') != denied_counts:
                raise RuntimeError('RESTORED_RLS_AAL1_FAILED')
            if visible(owner, 'aal2') != expected:
                raise RuntimeError('RESTORED_RLS_OWNER_FAILED')
            if visible(str(uuid.uuid4()), 'aal2') != denied_counts:
                raise RuntimeError('RESTORED_RLS_OTHER_OWNER_FAILED')
            denied = subprocess.run([str(pg_bin / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1', '-c',
                                    'set role anon; select text from public.raw_inputs;'], env=env, capture_output=True)
            if denied.returncode == 0:
                raise RuntimeError('RESTORED_ANON_GRANT_FAILED')
            immutable = subprocess.run([str(pg_bin / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1', '-c',
                                       "update public.raw_inputs set text=text||'invalid';"], env=env, capture_output=True)
            if counts['raw_inputs'] and immutable.returncode == 0:
                raise RuntimeError('RESTORED_IMMUTABILITY_FAILED')
            if history_counts.get('conversation_messages'):
                reply_count=int(run([pg_bin/'psql','-XqAt','-c',
                    "select count(*) from public.conversation_messages where role='assistant';"],env=env).strip())
                if reply_count:
                    changed=subprocess.run([str(pg_bin/'psql'),'-XqAt','-v','ON_ERROR_STOP=1','-c',
                        "update public.conversation_messages set content=content||'invalid' where role='assistant';"],env=env,capture_output=True)
                    if changed.returncode==0:raise RuntimeError('RESTORED_REPLY_IMMUTABILITY_FAILED')
            sleep_verified = None
            if history_counts.get('time_sleep_alignments'):
                sleep_check = run([pg_bin/'psql','-XqAt','-v','ON_ERROR_STOP=1','-c', """
                    select count(*),coalesce(bool_and(t.duration_min=floor(a.asleep_millis/60000.0)::int),false)
                    from public.time_sleep_alignments a
                    join public.raw_inputs r on r.owner_id=a.owner_id and r.payload->>'sleep_id'=a.sleep_id
                    join public.time_entries t on t.raw_input_id=r.id and t.item_index=0 and t.deleted_at is null
                    where a.status='applied';"""],env=env).strip().split('|')
                if int(sleep_check[0]) == 0 or sleep_check[1] != 't':
                    raise RuntimeError('RESTORED_WHOOP_SLEEP_DURATION_FAILED')
                changed = subprocess.run([str(pg_bin/'psql'),'-XqAt','-v','ON_ERROR_STOP=1','-c', """
                    update public.time_entries t set activity=activity||'invalid'
                    from public.raw_inputs r where r.id=t.raw_input_id and r.source='whoop'
                    and t.item_index=0 and t.deleted_at is null;"""],env=env,capture_output=True)
                if changed.returncode == 0:
                    raise RuntimeError('RESTORED_WHOOP_PROTECTION_FAILED')
                sleep_verified = {'sessions':int(sleep_check[0]),'net_minutes_exact':True,'device_rows_protected':True}
            return {'event': 'restore_verified', 'project': manifest['project'], 'counts': counts,
                    'history_counts': history_counts,
                    'rls_aal1_denied': True, 'rls_aal2_owner_read': True,
                    'rls_other_owner_denied': True, 'anon_denied': True, 'raw_immutable': True,
                    'network_listener': False, 'whoop_sleep': sleep_verified}
        finally:
            if started:
                run([pg_bin / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'], env=env)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    parser.add_argument('--identity', type=Path, required=True)
    parser.add_argument('--pg-bin', type=Path, default=Path('/opt/homebrew/opt/postgresql@17/bin'))
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    try:
        report = verify(args.archive.resolve(), args.identity.resolve(), args.pg_bin.resolve())
    except RestoreError as error:
        diagnostic = args.report.with_suffix('.error.log')
        diagnostic.write_text(error.diagnostic)
        diagnostic.chmod(0o600)
        raise SystemExit(str(error) + '；私有诊断：' + str(diagnostic))
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    args.report.chmod(0o600)
    print(json.dumps(report))
