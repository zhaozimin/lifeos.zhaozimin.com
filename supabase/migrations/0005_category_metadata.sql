-- [INPUT]: 既有分类与本机 LifeOS 分类定义。
-- [OUTPUT]: 关键词、收支方向、时间性质与数据库方向校验。
-- [POS]: 分类语义边界；新增定义不改变历史归属，身份字段保持不可变。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

alter table public.categories
  add column keywords text[] not null default '{}',
  add column direction text check (direction in ('income','expense')),
  add column nature text check (nature in ('core','support','recovery','leisure')),
  add constraint category_metadata_kind check (
    (kind = 'time' and direction is null) or (kind = 'money' and nature is null)
  );

create or replace function public.protect_category() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.owner_id,new.code,new.name,new.kind,new.parent_id,new.created_at,new.keywords,new.direction,new.nature)
    is distinct from
    (old.owner_id,old.code,old.name,old.kind,old.parent_id,old.created_at,old.keywords,old.direction,old.nature) then
    raise exception 'category identity is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.validate_entry_category() returns trigger
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
  if tg_table_name = 'transactions' then
    if exists (select 1 from public.categories c where c.id = new.category_id
      and c.direction is not null and c.direction <> new.direction) then
      raise exception 'category direction mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger money_category_check on public.transactions;
create trigger money_category_check before insert or update of category_id,raw_input_id,direction
  on public.transactions for each row execute function public.validate_entry_category();
