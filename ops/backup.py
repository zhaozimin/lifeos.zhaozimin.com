#!/usr/bin/env python3
# [INPUT]: 独立只读数据库账号、age 公钥及限桶 R2 凭据。
# [OUTPUT]: 含大类规则、睡眠校准、账本和消息健康副本的一致性归档。
# [POS]: P1 每日备份入口；同一快照生成归档与计数，私钥不进入 VPS。
# 归档与恢复计数包含访客开关及公开健康副本。
# [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
import hashlib
import json
import os
import re
import select
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SCHEMAS = ['public', 'auth', 'storage', 'supabase_migrations']


class BackupError(Exception):
    pass


def expired_backup_keys(objects, now, prefix='daily/lifeos-'):
    cutoff = now.timestamp() - 30 * 86400
    result = []
    for item in objects:
        match = re.fullmatch(re.escape(prefix) + r'(\d{8}T\d{6}Z)\.tar\.age', item['Key'])
        if not match:
            continue
        try:
            created = datetime.strptime(match[1], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if created.timestamp() < cutoff:
            result.append(item['Key'])
    return result


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, timeout=180, **kwargs)
    if result.returncode:
        code = Path(args[0]).name.upper() + '_FAILED'
        diagnostic = result.stderr.decode(errors='replace')
        aws = re.search(r'An error occurred \(([A-Za-z0-9_]+)\) when calling the ([A-Za-z0-9_]+)', diagnostic)
        if aws:
            code += '_' + aws[1].upper() + '_' + aws[2].upper()
        raise BackupError(code)
    return result.stdout


def snapshot_sql():
    return """
    begin isolation level repeatable read read only;
    select jsonb_build_object(
      'snapshot',pg_export_snapshot(),
      'counts',jsonb_build_object(
        'categories',(select count(*) from public.categories),
        'raw_inputs',(select count(*) from public.raw_inputs),
        'time_entries',(select count(*) from public.time_entries),
        'transactions',(select count(*) from public.transactions),
        'auth_users',(select count(*) from auth.users),
        'storage_objects',(select count(*) from storage.objects)),
      'history_counts',jsonb_build_object(
        'local_records',(select count(*) from public.local_records),
        'local_archive',(select count(*) from public.local_archive),
        'record_attachments',(select count(*) from public.record_attachments),
        'record_changes',(select count(*) from public.record_changes),
        'dashboard_preferences',(select count(*) from public.dashboard_preferences),
        'whoop_records',(select count(*) from public.whoop_records),
        'whoop_publications',(select count(*) from public.whoop_publications),
        'visitor_settings',(select count(*) from public.visitor_settings),
        'visitor_health_publications',(select count(*) from public.visitor_health_publications),
        'whoop_plans',(select count(*) from public.whoop_plans),
        'whoop_jobs',(select count(*) from public.whoop_jobs),
        'conversation_messages',(select count(*) from public.conversation_messages),
        'memory_jobs',(select count(*) from public.memory_jobs),
        'time_group_policies',(select count(*) from public.time_group_policies),
        'time_group_rules',(select count(*) from public.time_group_rules),
        'time_sleep_alignments',(select count(*) from public.time_sleep_alignments)),
      'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'bypassrls',rolbypassrls))
        from pg_roles where rolname !~ '^pg_' and rolname <> 'postgres'),
      'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
      'large_objects',(select count(*) from pg_largeobject_metadata));
    """


def export_database(directory, pg_bin):
    process = subprocess.Popen([str(pg_bin / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1', '--no-password'],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        process.stdin.write(snapshot_sql() + '\n')
        process.stdin.flush()
        readable, _, _ = select.select([process.stdout], [], [], 35)
        if not readable:
            raise BackupError('SNAPSHOT_TIMEOUT')
        line = process.stdout.readline()
        if not line:
            raise BackupError('SNAPSHOT_FAILED')
        metadata = json.loads(line)
        if metadata['counts']['storage_objects']:
            raise BackupError('STORAGE_EXPORT_REQUIRED')
        if metadata['large_objects']:
            raise BackupError('LARGE_OBJECT_EXPORT_REQUIRED')
        dump = directory / 'database.dump'
        run([str(pg_bin / 'pg_dump'), '--format=custom', '--no-owner', '--no-password',
             '--snapshot=' + metadata.pop('snapshot'), '--file=' + str(dump)]
            + ['--schema=' + schema for schema in SCHEMAS])
        run([str(pg_bin / 'pg_restore'), '--list', str(dump)])
        return metadata
    finally:
        if process.poll() is None:
            try:
                process.stdin.write('rollback;\n\\q\n')
                process.stdin.flush()
                process.communicate(timeout=5)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                process.kill()
                process.wait()


def backup():
    os.umask(0o077)
    project = os.environ['LIFEOS_PROJECT_REF']
    if not re.fullmatch(r'[a-z]{20}', project):
        raise BackupError('PROJECT_REF_INVALID')
    directory = Path(os.environ.get('LIFEOS_BACKUP_DIR', '/var/lib/lifeos-backup'))
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    pg_bin = Path(os.environ.get('LIFEOS_PG_BIN', '/usr/lib/postgresql/17/bin'))
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    name = 'lifeos-' + timestamp + '.tar.age'
    final = directory / name
    temporary = directory / (name + '.partial')
    try:
        with tempfile.TemporaryDirectory(prefix='.export-', dir=directory) as scratch:
            scratch = Path(scratch)
            metadata = export_database(scratch, pg_bin)
            metadata.update({'format': 'lifeos-backup-v1', 'project': project,
                             'created_at': timestamp, 'schemas': SCHEMAS,
                             'dump_sha256': hashlib.sha256((scratch / 'database.dump').read_bytes()).hexdigest()})
            (scratch / 'manifest.json').write_text(json.dumps(metadata, ensure_ascii=False))
            archive = scratch / 'bundle.tar'
            with tarfile.open(archive, 'w') as tar:
                for member in ['database.dump', 'manifest.json']:
                    tar.add(scratch / member, arcname=member)
            run(['age', '--recipients-file', os.environ['LIFEOS_AGE_RECIPIENTS'],
                 '--output', str(temporary), str(archive)])
        temporary.replace(final)
        sha256 = hashlib.sha256(final.read_bytes()).hexdigest()
        status = {'event': 'backup_encrypted', 'file': name, 'sha256': sha256,
                  'bytes': final.stat().st_size, 'counts': metadata['counts'], 'uploaded': False}
        if os.environ.get('LIFEOS_R2_BUCKET'):
            endpoint = os.environ['LIFEOS_R2_ENDPOINT']
            if not re.fullmatch(r'https://[a-f0-9]{32}\.r2\.cloudflarestorage\.com', endpoint):
                raise BackupError('R2_ENDPOINT_INVALID')
            key = 'daily/' + name
            destination = 's3://' + os.environ['LIFEOS_R2_BUCKET'] + '/' + key
            run(['aws', '--endpoint-url', endpoint, 's3', 'cp', str(final), destination,
                 '--only-show-errors', '--metadata', 'sha256=' + sha256])
            remote = json.loads(run(['aws', '--endpoint-url', endpoint, 's3api', 'head-object',
                                     '--bucket', os.environ['LIFEOS_R2_BUCKET'], '--key', key]))
            if remote['ContentLength'] != final.stat().st_size or remote['Metadata'].get('sha256') != sha256:
                raise BackupError('REMOTE_VERIFY_FAILED')
            status.update({'event': 'backup_uploaded', 'uploaded': True, 'object_key': key})
            objects = json.loads(run(['aws', '--endpoint-url', endpoint, 's3api', 'list-objects-v2',
                                      '--bucket', os.environ['LIFEOS_R2_BUCKET'], '--prefix', 'daily/']))
            for old_key in expired_backup_keys(objects.get('Contents', []), datetime.now(timezone.utc)):
                run(['aws', '--endpoint-url', endpoint, 's3api', 'delete-object',
                     '--bucket', os.environ['LIFEOS_R2_BUCKET'], '--key', old_key])
        (directory / 'last-success.json').write_text(json.dumps(status))
        # 新备份确认成功后，才清除本机超出保留期的加密归档。
        cutoff = datetime.now(timezone.utc).timestamp() - 30 * 86400
        for old in directory.glob('lifeos-*.tar.age'):
            if old != final and old.stat().st_mtime < cutoff:
                old.unlink()
        print(json.dumps(status))
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        backup()
    except Exception as error:
        code = str(error) if isinstance(error, BackupError) else type(error).__name__.upper()
        print(json.dumps({'event': 'backup_failed', 'code': code}), file=sys.stderr)
        sys.exit(1)
