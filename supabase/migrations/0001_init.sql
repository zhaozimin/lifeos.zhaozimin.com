-- [INPUT]: Supabase Auth 用户与 PostgreSQL 17。
-- [OUTPUT]: 分类、原话、时间账与金钱账四张表。
-- [POS]: 数据库基础契约；多表业务动作由后续事务 RPC 完成。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create type public.input_status as enum
  ('pending', 'awaiting_clarification', 'parsed', 'failed', 'ignored');

create table public.categories (
  id smallserial primary key,
  owner_id uuid not null references auth.users(id),
  code text not null,
  name text not null,
  kind text not null check (kind in ('time', 'money')),
  parent_id smallint references public.categories(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (owner_id, kind, code)
);

create table public.raw_inputs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  source text not null default 'wechat',
  external_id text not null,
  text text not null,
  received_at timestamptz not null,
  payload jsonb not null default '{}',
  input_kind text not null default 'record' check (input_kind in ('record', 'command', 'unsupported')),
  status public.input_status not null default 'pending',
  attempts smallint not null default 0 check (attempts between 0 and 5),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  parse_result jsonb,
  error_code text,
  clarification_for uuid references public.raw_inputs(id),
  clarification_prompt text,
  reply_input_id uuid references public.raw_inputs(id),
  revoked_at timestamptz,
  receipt_text text,
  receipt_revision integer not null default 0 check (receipt_revision >= 0),
  reply_attempts smallint not null default 0 check (reply_attempts between 0 and 5),
  reply_next_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, source, external_id),
  check ((lease_token is null) = (lease_until is null))
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  raw_input_id uuid not null references public.raw_inputs(id),
  item_index integer not null check (item_index >= 0),
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  duration_min integer generated always as
    (floor(extract(epoch from (end_at - start_at)) / 60)::integer) stored,
  category_id smallint not null references public.categories(id),
  activity text not null check (length(activity) between 1 and 500),
  note text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (raw_input_id, item_index)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  raw_input_id uuid not null references public.raw_inputs(id),
  item_index integer not null check (item_index >= 0),
  occurred_at timestamptz not null,
  direction text not null check (direction in ('expense', 'income')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  category_id smallint not null references public.categories(id),
  account text,
  merchant text,
  note text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (raw_input_id, item_index)
);

create index on public.raw_inputs(owner_id, status, next_attempt_at)
  where revoked_at is null and status in ('pending', 'failed');
create index on public.raw_inputs(owner_id, reply_next_at)
  where delivered_at is null and receipt_text is not null and revoked_at is null;
create index on public.raw_inputs(clarification_for);
create index on public.time_entries(start_at) where deleted_at is null;
create index on public.transactions(occurred_at) where deleted_at is null;
