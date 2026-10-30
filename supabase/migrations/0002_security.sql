-- [INPUT]: 四张业务表、Supabase auth.uid() 与 auth.jwt()。
-- [OUTPUT]: 本人 AAL2 只读权限、原话不可变约束与分类归属校验。
-- [POS]: 数据访问边界；service_role 仍须遵守原话不可变触发器。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

alter table public.categories enable row level security;
alter table public.raw_inputs enable row level security;
alter table public.time_entries enable row level security;
alter table public.transactions enable row level security;

revoke all on public.categories, public.raw_inputs, public.time_entries, public.transactions
  from anon, authenticated;
grant select on public.categories, public.time_entries, public.transactions to authenticated;
grant select (id, owner_id, source, external_id, text, received_at, input_kind,
  status, attempts, next_attempt_at, parse_result, error_code, clarification_for,
  clarification_prompt, revoked_at, created_at)
  on public.raw_inputs to authenticated;
grant all on public.categories, public.raw_inputs, public.time_entries, public.transactions to service_role;
grant usage, select on sequence public.categories_id_seq to service_role;

create policy owner_read on public.categories for select to authenticated using
  (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');
create policy owner_read on public.raw_inputs for select to authenticated using
  (owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2');
create policy owner_read on public.time_entries for select to authenticated using
  ((select auth.jwt() ->> 'aal') = 'aal2' and exists (
    select 1 from public.raw_inputs r where r.id = raw_input_id and r.owner_id = (select auth.uid())
  ));
create policy owner_read on public.transactions for select to authenticated using
  ((select auth.jwt() ->> 'aal') = 'aal2' and exists (
    select 1 from public.raw_inputs r where r.id = raw_input_id and r.owner_id = (select auth.uid())
  ));

create function public.protect_raw_input() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'raw inputs cannot be deleted' using errcode = '55000';
  end if;
  if (new.owner_id, new.source, new.external_id, new.text, new.received_at, new.payload, new.created_at)
    is distinct from
    (old.owner_id, old.source, old.external_id, old.text, old.received_at, old.payload, old.created_at) then
    raise exception 'original input is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger raw_input_immutable before update or delete on public.raw_inputs
  for each row execute function public.protect_raw_input();
create trigger raw_input_no_truncate before truncate on public.raw_inputs
  for each statement execute function public.protect_raw_input();

create function public.protect_category() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.owner_id, new.code, new.name, new.kind, new.parent_id, new.created_at)
    is distinct from
    (old.owner_id, old.code, old.name, old.kind, old.parent_id, old.created_at) then
    raise exception 'category identity is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger category_immutable before update on public.categories
  for each row execute function public.protect_category();

create function public.validate_entry_category() returns trigger
language plpgsql set search_path = '' as $$
declare expected_kind text;
begin
  expected_kind := case when tg_table_name = 'time_entries' then 'time' else 'money' end;
  if not exists (
    select 1 from public.categories c join public.raw_inputs r on r.owner_id = c.owner_id
    where c.id = new.category_id and r.id = new.raw_input_id and c.kind = expected_kind
  ) then
    raise exception 'category kind or owner mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger time_category_check before insert or update of category_id, raw_input_id
  on public.time_entries for each row execute function public.validate_entry_category();
create trigger money_category_check before insert or update of category_id, raw_input_id
  on public.transactions for each row execute function public.validate_entry_category();

revoke all on function public.protect_raw_input(), public.protect_category(),
  public.validate_entry_category() from public, anon, authenticated;
