-- [INPUT]: 本机 UTC 锚点、带符号金额、任务及不可变来源档案。
-- [OUTPUT]: 历史账本扩展、私有附件、辅助记录和含扣减的日视图。
-- [POS]: 本机迁移的存储边界；不改变原话，不把转账计入收支。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

alter table public.raw_inputs drop constraint raw_inputs_input_kind_check;
alter table public.raw_inputs add constraint raw_inputs_input_kind_check
  check(input_kind in ('record','command','unsupported','import'));

alter table public.time_entries alter column end_at drop not null;
alter table public.time_entries drop column duration_min;
alter table public.time_entries
  add column deduction_minutes integer not null default 0,
  add column deduction_note text,
  add column project text,
  add column tags text[] not null default '{}',
  add column revision bigint not null default 1,
  add column updated_at timestamptz not null default now(),
  add column duration_min integer generated always as
    (floor(extract(epoch from(end_at-start_at))/60)::integer-deduction_minutes) stored,
  add constraint time_deduction_valid check(deduction_minutes>=0 and
    ((end_at is null and deduction_minutes=0) or
     deduction_minutes<=floor(extract(epoch from(end_at-start_at))/60)));

alter table public.transactions drop constraint transactions_direction_check;
alter table public.transactions add constraint transactions_direction_check
  check(direction in ('expense','income','transfer'));
alter table public.transactions drop constraint transactions_amount_cents_check;
alter table public.transactions add constraint transactions_amount_cents_check
  check(amount_cents between -9007199254740991 and 9007199254740991);
alter table public.transactions
  add column title text,
  add column from_account text,
  add column to_account text,
  add column project text,
  add column tags text[] not null default '{}',
  add column details jsonb not null default '{}',
  add column revision bigint not null default 1,
  add column updated_at timestamptz not null default now(),
  add constraint transfer_accounts_valid check(direction<>'transfer' or
    (length(trim(coalesce(from_account,'')))>0 and length(trim(coalesce(to_account,'')))>0 and
     from_account<>to_account and amount_cents>0));

create table public.local_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  kind text not null check(kind in ('account','task','task_group','project')),
  source_id text not null,
  data jsonb not null check(jsonb_typeof(data)='object'),
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(owner_id,kind,source_id)
);
create unique index local_account_name on public.local_records(owner_id,(data->>'name'))
  where kind='account' and deleted_at is null;

create table public.local_archive (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  source_key text not null,
  domain text not null check(domain in ('time','finance','tasks')),
  table_name text not null,
  source_id text not null,
  payload jsonb not null,
  source_hash text not null,
  imported_at timestamptz not null default now(),
  unique(owner_id,source_key,domain,table_name,source_id)
);
create table public.record_attachments (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  transaction_id uuid not null references public.transactions(id),
  filename text not null,
  mime text not null,
  size_bytes integer not null check(size_bytes between 0 and 10485760),
  sha256 text not null,
  content bytea not null,
  check(octet_length(content)=size_bytes)
);
create table public.record_changes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  kind text not null,
  record_id uuid not null,
  revision bigint not null,
  before_data jsonb not null,
  after_data jsonb not null,
  changed_at timestamptz not null default now(),
  actor text not null,
  unique(kind,record_id,revision)
);
create index record_changes_lookup on public.record_changes(owner_id,kind,record_id,revision desc);

alter table public.local_records enable row level security;
alter table public.local_archive enable row level security;
alter table public.record_attachments enable row level security;
alter table public.record_changes enable row level security;
revoke all on public.local_records,public.local_archive,public.record_attachments,public.record_changes
  from anon,authenticated;
grant select on public.local_records,public.local_archive,public.record_changes to authenticated;
grant select(id,owner_id,transaction_id,filename,mime,size_bytes,sha256)
  on public.record_attachments to authenticated;
grant all on public.local_records,public.local_archive,public.record_attachments,public.record_changes to service_role;
create policy owner_read on public.local_records for select to authenticated using
  (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy owner_read on public.local_archive for select to authenticated using
  (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy owner_read on public.record_attachments for select to authenticated using
  (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy owner_read on public.record_changes for select to authenticated using
  (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');

create function public.reject_archive_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'source and revision archives are immutable' using errcode='55000'; end;
$$;
create trigger archive_immutable before update or delete on public.local_archive
  for each row execute function public.reject_archive_change();
create trigger archive_no_truncate before truncate on public.local_archive
  for each statement execute function public.reject_archive_change();
create trigger change_immutable before update or delete on public.record_changes
  for each row execute function public.reject_archive_change();
create trigger change_no_truncate before truncate on public.record_changes
  for each statement execute function public.reject_archive_change();
create trigger attachment_immutable before update or delete on public.record_attachments
  for each row execute function public.reject_archive_change();
create function public.validate_attachment_owner() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
    where t.id=new.transaction_id and r.owner_id=new.owner_id) then
    raise exception 'attachment owner mismatch' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger attachment_owner_check before insert on public.record_attachments
  for each row execute function public.validate_attachment_owner();

-- Python round 的半偶数规则，保持旧账本的跨日扣减分配。
create function public.round_minutes_even(v numeric) returns bigint
language sql immutable set search_path='' as $$
  select (floor(v)+case when v-floor(v)<0.5 then 0 when v-floor(v)>0.5 then 1
    else mod(floor(v),2) end)::bigint;
$$;
create function public.net_time_minutes(s timestamptz,e timestamptz,d integer,
  a timestamptz,b timestamptz,p_now timestamptz default now()) returns bigint
language sql stable set search_path='' as $$
  with bounds as(select coalesce(e,p_now) finish), piece as(
    select greatest(s,a) x,least(finish,b) y,finish from bounds
  ) select case when y<=x or finish<=s then 0 else
    floor(extract(epoch from(y-x))/60)::bigint -
    (public.round_minutes_even(d*extract(epoch from(y-s))/extract(epoch from(finish-s)))-
     public.round_minutes_even(d*extract(epoch from(x-s))/extract(epoch from(finish-s)))) end from piece;
$$;
create or replace view public.v_daily_time with(security_invoker=true) as
select r.owner_id,d.day::date as day,t.category_id,
  sum(public.net_time_minutes(t.start_at,t.end_at,t.deduction_minutes,
    d.day at time zone 'Asia/Shanghai',(d.day+interval '1 day') at time zone 'Asia/Shanghai'))::bigint as minutes
from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
cross join lateral generate_series(date_trunc('day',t.start_at at time zone 'Asia/Shanghai'),
  date_trunc('day',(coalesce(t.end_at,now())-interval '1 microsecond') at time zone 'Asia/Shanghai'),
  interval '1 day') d(day)
where t.deleted_at is null group by r.owner_id,d.day,t.category_id;
create or replace view public.v_daily_money with(security_invoker=true) as
select r.owner_id,(t.occurred_at at time zone 'Asia/Shanghai')::date as day,
  t.direction,t.currency,t.category_id,sum(t.amount_cents) as cents
from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
where t.deleted_at is null and t.direction<>'transfer'
group by r.owner_id,day,t.direction,t.currency,t.category_id;

revoke all on function public.reject_archive_change(),public.validate_attachment_owner(),public.round_minutes_even(numeric),
  public.net_time_minutes(timestamptz,timestamptz,integer,timestamptz,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.round_minutes_even(numeric),
  public.net_time_minutes(timestamptz,timestamptz,integer,timestamptz,timestamptz,timestamptz)
  to authenticated,service_role;
