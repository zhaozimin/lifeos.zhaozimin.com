-- [INPUT]: 不可变原话、微信管家执行器与本人 AAL2 网页会话。
-- [OUTPUT]: 灵感记录表、严格两层标签系统、自动入库/撤销扩展及网页原子管理 RPC。
-- [POS]: 灵感领域数据边界；原话正文零改写，标签严格限制为概念大类与具体分类两层。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

-- ============================================================
-- 1. 两层标签体系表（Level 1 概念大类 / Level 2 具体分类）
-- ============================================================

create table public.inspiration_tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  level smallint not null check (level in (1, 2)),
  parent_id uuid references public.inspiration_tags(id),
  name text not null check (
    length(btrim(name)) between 1 and 40
    and btrim(name) = name
    and position('/' in name) = 0
  ),
  description text check (description is null or length(description) <= 200),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inspiration_tags_level_parent_check check (
    (level = 1 and parent_id is null)
    or (level = 2 and parent_id is not null)
  )
);

create unique index inspiration_tags_l1_unique
  on public.inspiration_tags (owner_id, lower(name))
  where level = 1 and archived_at is null;

create unique index inspiration_tags_l2_unique
  on public.inspiration_tags (owner_id, parent_id, lower(name))
  where level = 2 and archived_at is null;

create index inspiration_tags_parent_lookup
  on public.inspiration_tags (owner_id, parent_id)
  where archived_at is null;

create function public.enforce_inspiration_tag_hierarchy()
returns trigger language plpgsql set search_path = '' as $$
declare parent_row public.inspiration_tags%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.owner_id <> old.owner_id or new.created_at <> old.created_at then
      raise exception 'tag identity is immutable' using errcode = '55000';
    end if;
    if new.level <> old.level then
      raise exception 'tag level is immutable' using errcode = '23514';
    end if;
    new.updated_at := clock_timestamp();
  end if;
  if new.level = 2 then
    select * into parent_row from public.inspiration_tags where id = new.parent_id;
    if not found or parent_row.owner_id <> new.owner_id or parent_row.level <> 1 then
      raise exception 'level 2 tag must reference a level 1 group of the same owner' using errcode = '23514';
    end if;
    if new.archived_at is null and parent_row.archived_at is not null then
      raise exception 'cannot attach active tag to archived group' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger inspiration_tags_hierarchy
  before insert or update on public.inspiration_tags
  for each row execute function public.enforce_inspiration_tag_hierarchy();

-- ============================================================
-- 2. 灵感记录主表与标签关联表
-- ============================================================

create table public.inspirations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  raw_input_id uuid references public.raw_inputs(id),
  item_index integer not null default 0 check (item_index >= 0),
  source text not null check (source in ('wechat', 'web')),
  title text check (title is null or length(btrim(title)) between 1 and 120),
  summary text check (summary is null or length(btrim(summary)) between 1 and 500),
  content text not null check (length(btrim(content)) between 1 and 10000),
  pinned boolean not null default false,
  captured_at timestamptz not null default now(),
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deletion_reason text
);

create unique index inspirations_raw_input_item_unique
  on public.inspirations (raw_input_id, item_index)
  where raw_input_id is not null;

create index inspirations_owner_feed
  on public.inspirations (owner_id, pinned desc, captured_at desc, id)
  where deleted_at is null;

create table public.inspiration_tag_links (
  inspiration_id uuid not null references public.inspirations(id) on delete cascade,
  tag_id uuid not null references public.inspiration_tags(id),
  created_at timestamptz not null default now(),
  primary key (inspiration_id, tag_id)
);

create index inspiration_tag_links_tag_lookup
  on public.inspiration_tag_links (tag_id, inspiration_id);

create function public.enforce_inspiration_tag_link()
returns trigger language plpgsql set search_path = '' as $$
declare insp_owner uuid; tag_row public.inspiration_tags%rowtype;
begin
  select owner_id into strict insp_owner from public.inspirations where id = new.inspiration_id;
  select * into strict tag_row from public.inspiration_tags where id = new.tag_id;
  if tag_row.owner_id <> insp_owner or tag_row.level <> 2 or tag_row.archived_at is not null then
    raise exception 'inspiration must link to an active level 2 tag of the same owner' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger inspiration_tag_links_validate
  before insert or update on public.inspiration_tag_links
  for each row execute function public.enforce_inspiration_tag_link();

create function public.version_inspiration_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id
    or new.raw_input_id is distinct from old.raw_input_id
    or new.item_index <> old.item_index
    or new.source <> old.source
    or new.created_at <> old.created_at then
    raise exception 'inspiration identity is immutable' using errcode = '55000';
  end if;
  if coalesce(current_setting('lifeos.inspiration_bump', true), '') <> 'yes'
    and (to_jsonb(new) - 'revision' - 'updated_at') = (to_jsonb(old) - 'revision' - 'updated_at') then
    return old;
  end if;
  new.revision := old.revision + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create function public.audit_inspiration_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.revision = old.revision then return new; end if;
  insert into public.record_changes(owner_id, kind, record_id, revision, before_data, after_data, actor)
  values (
    new.owner_id, 'inspiration', old.id, new.revision, to_jsonb(old), to_jsonb(new),
    case when auth.uid() is null then 'service' else 'web' end
  );
  return new;
end;
$$;

create trigger inspirations_edit_version
  before update on public.inspirations
  for each row execute function public.version_inspiration_update();

create trigger inspirations_edit_audit
  after update on public.inspirations
  for each row execute function public.audit_inspiration_update();

-- ============================================================
-- 3. RLS 与最小权限边界（仅本人 AAL2 只读，写入全部经 RPC）
-- ============================================================

alter table public.inspiration_tags enable row level security;
alter table public.inspirations enable row level security;
alter table public.inspiration_tag_links enable row level security;

revoke all on public.inspiration_tags, public.inspirations, public.inspiration_tag_links
  from public, anon, authenticated;
grant select on public.inspiration_tags, public.inspirations, public.inspiration_tag_links
  to authenticated;
grant all on public.inspiration_tags, public.inspirations, public.inspiration_tag_links
  to service_role;

create policy owner_read on public.inspiration_tags for select to authenticated using (
  owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2'
);

create policy owner_read on public.inspirations for select to authenticated using (
  owner_id = (select auth.uid()) and (select auth.jwt() ->> 'aal') = 'aal2'
);

create policy owner_read on public.inspiration_tag_links for select to authenticated using (
  exists (
    select 1 from public.inspirations i
    where i.id = inspiration_id
      and i.owner_id = (select auth.uid())
      and (select auth.jwt() ->> 'aal') = 'aal2'
  )
);

-- ============================================================
-- 4. 两层标签原子维护辅助函数
-- ============================================================

create function public.ensure_inspiration_tag(p_owner_id uuid, p_group text, p_name text)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_group text := btrim(coalesce(p_group, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_group_id uuid;
  v_tag_id uuid;
begin
  if length(v_group) not between 1 and 40 or position('/' in v_group) > 0
    or length(v_name) not between 1 and 40 or position('/' in v_name) > 0 then
    raise exception 'invalid two-level tag name' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':inspiration-tags', 0));
  select id into v_group_id from public.inspiration_tags
  where owner_id = p_owner_id and level = 1 and archived_at is null and lower(name) = lower(v_group)
  limit 1;
  if v_group_id is null then
    insert into public.inspiration_tags(owner_id, level, parent_id, name)
    values (p_owner_id, 1, null, v_group)
    returning id into v_group_id;
  end if;
  select id into v_tag_id from public.inspiration_tags
  where owner_id = p_owner_id and level = 2 and parent_id = v_group_id
    and archived_at is null and lower(name) = lower(v_name)
  limit 1;
  if v_tag_id is null then
    insert into public.inspiration_tags(owner_id, level, parent_id, name)
    values (p_owner_id, 2, v_group_id, v_name)
    returning id into v_tag_id;
  end if;
  return v_tag_id;
end;
$$;

create function public.set_inspiration_tags(p_owner_id uuid, p_inspiration_id uuid, p_tags jsonb)
returns void language plpgsql set search_path = '' as $$
declare item jsonb; v_tag_id uuid;
begin
  if jsonb_typeof(coalesce(p_tags, '[]'::jsonb)) is distinct from 'array'
    or jsonb_array_length(coalesce(p_tags, '[]'::jsonb)) > 8 then
    raise exception 'invalid inspiration tags' using errcode = '22023';
  end if;
  delete from public.inspiration_tag_links where inspiration_id = p_inspiration_id;
  for item in select value from jsonb_array_elements(coalesce(p_tags, '[]'::jsonb)) loop
    if jsonb_typeof(item) is distinct from 'object'
      or item - array['group', 'name'] <> '{}'::jsonb
      or jsonb_typeof(item -> 'group') is distinct from 'string'
      or jsonb_typeof(item -> 'name') is distinct from 'string' then
      raise exception 'each tag must specify group and name' using errcode = '22023';
    end if;
    v_tag_id := public.ensure_inspiration_tag(p_owner_id, item ->> 'group', item ->> 'name');
    insert into public.inspiration_tag_links(inspiration_id, tag_id)
    values (p_inspiration_id, v_tag_id)
    on conflict do nothing;
  end loop;
end;
$$;

create function public.inspiration_json(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id,
    'raw_input_id', i.raw_input_id,
    'source', i.source,
    'title', i.title,
    'summary', i.summary,
    'content', i.content,
    'pinned', i.pinned,
    'captured_at', i.captured_at,
    'revision', i.revision,
    'created_at', i.created_at,
    'updated_at', i.updated_at,
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'group_id', g.id,
        'group', g.name,
        'name', t.name
      ) order by g.name, t.name)
      from public.inspiration_tag_links l
      join public.inspiration_tags t on t.id = l.tag_id and t.archived_at is null
      join public.inspiration_tags g on g.id = t.parent_id and g.archived_at is null
      where l.inspiration_id = i.id
    ), '[]'::jsonb)
  )
  from public.inspirations i
  where i.id = p_id;
$$;

-- ============================================================
-- 5. 扩展管家上下文、快照与微信事务执行器
-- ============================================================

create or replace function public.get_steward_context(p_owner_id uuid) returns jsonb
language sql stable set search_path = '' as $$
select jsonb_build_object(
  'accounts', coalesce((select jsonb_agg(jsonb_build_object('name', data ->> 'name', 'type', data ->> 'type')
    order by data ->> 'name') from public.local_records
    where owner_id = p_owner_id and kind = 'account' and deleted_at is null), '[]'::jsonb),
  'ongoing', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'revision', t.revision,
    'start_at', t.start_at, 'activity', t.activity, 'category', c.code) order by t.start_at)
    from public.time_entries t join public.raw_inputs r on r.id = t.raw_input_id
    join public.categories c on c.id = t.category_id
    where r.owner_id = p_owner_id and t.deleted_at is null and t.end_at is null), '[]'::jsonb),
  'inspiration_tags', coalesce((
    select jsonb_agg(jsonb_build_object(
      'group', g.name,
      'tags', coalesce((
        select jsonb_agg(c.name order by c.name)
        from public.inspiration_tags c
        where c.owner_id = p_owner_id and c.level = 2 and c.parent_id = g.id and c.archived_at is null
      ), '[]'::jsonb)
    ) order by g.name)
    from public.inspiration_tags g
    where g.owner_id = p_owner_id and g.level = 1 and g.archived_at is null
  ), '[]'::jsonb)
);
$$;

alter function public.get_input_records(uuid) rename to get_input_records_before_inspirations;

create function public.get_input_records(p_input_id uuid) returns jsonb
language sql stable set search_path = '' as $$
select public.get_input_records_before_inspirations(p_input_id) || jsonb_build_object(
  'inspirations', coalesce((select jsonb_agg(jsonb_build_object(
    'id', i.id,
    'title', i.title,
    'summary', i.summary,
    'content', i.content,
    'tags', coalesce((
      select jsonb_agg(jsonb_build_object('group', g.name, 'name', t.name) order by g.name, t.name)
      from public.inspiration_tag_links l
      join public.inspiration_tags t on t.id = l.tag_id and t.archived_at is null
      join public.inspiration_tags g on g.id = t.parent_id and g.archived_at is null
      where l.inspiration_id = i.id
    ), '[]'::jsonb)
  ) order by i.item_index) from public.inspirations i
    where i.raw_input_id = p_input_id and i.deleted_at is null), '[]'::jsonb)
);
$$;

alter function public.apply_steward(uuid, uuid, jsonb, jsonb) rename to apply_steward_before_inspirations;

create function public.apply_steward(
  p_input_id uuid, p_lease_token uuid, p_result jsonb, p_expected_ongoing jsonb default null
) returns public.raw_inputs language plpgsql set search_path = '' as $$
declare
  r public.raw_inputs%rowtype; inspirations jsonb := '[]'::jsonb; item jsonb; tag_item jsonb;
  plan jsonb; item_idx integer; v_id uuid; v_title text; v_summary text; v_content text;
  committed jsonb := '[]'::jsonb;
begin
  select * into strict r from public.raw_inputs where id = p_input_id for update;
  if r.revoked_at is not null or r.status in ('parsed', 'ignored') then return r; end if;
  if r.lease_token is null or r.lease_token is distinct from p_lease_token then
    raise exception 'input lease changed' using errcode = '55000'; end if;
  if jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'invalid steward plan' using errcode = '22023'; end if;

  if p_result ? 'inspirations' and p_result -> 'inspirations' <> 'null'::jsonb then
    inspirations := p_result -> 'inspirations';
    if jsonb_typeof(inspirations) is distinct from 'array' or jsonb_array_length(inspirations) > 10 then
      raise exception 'invalid inspirations array' using errcode = '22023'; end if;
    if nullif(p_result ->> 'clarify', '') is not null and jsonb_array_length(inspirations) > 0 then
      raise exception 'clarification conflicts with inspirations' using errcode = '22023'; end if;
    for item in select value from jsonb_array_elements(inspirations) loop
      if jsonb_typeof(item) is distinct from 'object'
        or item - array['title', 'summary', 'content', 'tags'] <> '{}'::jsonb
        or jsonb_typeof(item -> 'content') is distinct from 'string'
        or length(btrim(item ->> 'content')) not between 1 and 10000 then
        raise exception 'invalid inspiration entry' using errcode = '22023'; end if;
      if item ? 'title' and item -> 'title' <> 'null'::jsonb and (
        jsonb_typeof(item -> 'title') is distinct from 'string'
        or length(btrim(item ->> 'title')) not between 1 and 120) then
        raise exception 'invalid inspiration title' using errcode = '22023'; end if;
      if item ? 'summary' and item -> 'summary' <> 'null'::jsonb and (
        jsonb_typeof(item -> 'summary') is distinct from 'string'
        or length(btrim(item ->> 'summary')) not between 1 and 500) then
        raise exception 'invalid inspiration summary' using errcode = '22023'; end if;
      if item ? 'tags' and item -> 'tags' <> 'null'::jsonb then
        if jsonb_typeof(item -> 'tags') is distinct from 'array' or jsonb_array_length(item -> 'tags') > 8 then
          raise exception 'invalid inspiration tags' using errcode = '22023'; end if;
        for tag_item in select value from jsonb_array_elements(item -> 'tags') loop
          if jsonb_typeof(tag_item) is distinct from 'object'
            or tag_item - array['group', 'name'] <> '{}'::jsonb
            or jsonb_typeof(tag_item -> 'group') is distinct from 'string'
            or jsonb_typeof(tag_item -> 'name') is distinct from 'string'
            or length(btrim(tag_item ->> 'group')) not between 1 and 40
            or length(btrim(tag_item ->> 'name')) not between 1 and 40
            or position('/' in (tag_item ->> 'group')) > 0
            or position('/' in (tag_item ->> 'name')) > 0 then
            raise exception 'invalid two-level inspiration tag' using errcode = '22023'; end if;
        end loop;
      end if;
    end loop;
  end if;

  plan := p_result - 'inspirations';
  if jsonb_array_length(inspirations) > 0 and nullif(plan ->> 'archive_kind', '') is null then
    plan := plan || jsonb_build_object('archive_kind', 'inspiration');
  end if;

  select * into r from public.apply_steward_before_inspirations(p_input_id, p_lease_token, plan, p_expected_ongoing);

  if r.status = 'parsed' then
    if jsonb_array_length(inspirations) > 0 then
      for item, item_idx in select value, ordinality::integer - 1
        from jsonb_array_elements(inspirations) with ordinality loop
        v_title := nullif(btrim(coalesce(item ->> 'title', '')), '');
        v_summary := nullif(btrim(coalesce(item ->> 'summary', '')), '');
        v_content := item ->> 'content';
        v_id := null;
        insert into public.inspirations(owner_id, raw_input_id, item_index, source, title, summary, content, captured_at)
        values (r.owner_id, r.id, item_idx, 'wechat', v_title, v_summary, v_content, r.received_at)
        on conflict (raw_input_id, item_index) where raw_input_id is not null do nothing
        returning id into v_id;
        if v_id is not null then
          perform public.set_inspiration_tags(r.owner_id, v_id, coalesce(item -> 'tags', '[]'::jsonb));
          committed := committed || jsonb_build_array(public.inspiration_json(v_id));
        end if;
      end loop;
      update public.raw_inputs
      set parse_result = r.parse_result || jsonb_build_object('inspirations', committed)
      where id = r.id returning * into r;
    elsif r.parse_result ->> 'archive_kind' = 'inspiration'
      and nullif(btrim(r.text), '') is not null
      and not exists (select 1 from public.inspirations where raw_input_id = r.id) then
      insert into public.inspirations(owner_id, raw_input_id, item_index, source, content, captured_at)
      values (r.owner_id, r.id, 0, 'wechat', left(r.text, 10000), r.received_at)
      on conflict (raw_input_id, item_index) where raw_input_id is not null do nothing;
    end if;
  end if;

  return r;
end;
$$;

-- ============================================================
-- 6. 扩展微信撤销指令（同步软删该原话生成的灵感记录）
-- ============================================================

alter function public.run_command(uuid, uuid, text) rename to run_command_before_inspirations;

create function public.run_command(p_input_id uuid, p_lease_token uuid, p_command text)
returns public.raw_inputs language plpgsql set search_path = '' as $$
declare
  r public.raw_inputs%rowtype;
  target_id uuid;
  affected integer := 0;
begin
  if p_command = 'undo' then
    select t.id into target_id
    from public.raw_inputs anchor
    join public.raw_inputs t on t.owner_id = anchor.owner_id
    where anchor.id = p_input_id
      and t.input_kind = 'record'
      and t.revoked_at is null
      and t.status <> 'ignored'
      and t.received_at <= anchor.received_at
      and t.id <> anchor.id
    order by t.received_at desc, t.created_at desc
    limit 1;
  end if;

  select * into r from public.run_command_before_inspirations(p_input_id, p_lease_token, p_command);

  if p_command = 'undo' and target_id is not null
    and coalesce((r.parse_result ->> 'undone')::boolean, false) then
    update public.inspirations
    set deleted_at = clock_timestamp(), deletion_reason = 'wechat-undo'
    where raw_input_id = target_id and deleted_at is null;
    get diagnostics affected = row_count;
    if affected > 0 then
      update public.raw_inputs
      set parse_result = r.parse_result || jsonb_build_object('inspiration_count', affected)
      where id = r.id returning * into r;
    end if;
  end if;

  return r;
end;
$$;

-- ============================================================
-- 7. 网页本人 AAL2 灵感与两层标签管理 RPC
-- ============================================================

create function public.create_inspiration(
  p_content text,
  p_title text default null,
  p_summary text default null,
  p_tags jsonb default '[]'::jsonb,
  p_pinned boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  v_id uuid;
begin
  if v_owner is null or (auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'owner aal2 required' using errcode = '42501';
  end if;
  if p_content is null or length(btrim(p_content)) not between 1 and 10000 then
    raise exception 'invalid inspiration content' using errcode = '22023';
  end if;
  if v_title is not null and length(v_title) > 120 then
    raise exception 'invalid inspiration title' using errcode = '22023';
  end if;
  if v_summary is not null and length(v_summary) > 500 then
    raise exception 'invalid inspiration summary' using errcode = '22023';
  end if;
  insert into public.inspirations(owner_id, source, title, summary, content, pinned, captured_at)
  values (v_owner, 'web', v_title, v_summary, p_content, coalesce(p_pinned, false), clock_timestamp())
  returning id into v_id;
  perform public.set_inspiration_tags(v_owner, v_id, coalesce(p_tags, '[]'::jsonb));
  return public.inspiration_json(v_id);
end;
$$;

create function public.edit_inspiration(p_id uuid, p_revision bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_row public.inspirations%rowtype;
  v_title text;
  v_summary text;
  v_content text;
  v_pinned boolean;
begin
  if v_owner is null or (auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'owner aal2 required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb
    or p_revision is null or p_revision < 1
    or p_patch - array['title', 'summary', 'content', 'pinned', 'tags'] <> '{}'::jsonb then
    raise exception 'invalid inspiration edit patch' using errcode = '22023';
  end if;
  select * into v_row from public.inspirations
  where id = p_id and owner_id = v_owner and deleted_at is null for update;
  if not found then raise exception 'inspiration not found' using errcode = 'P0002'; end if;
  if v_row.revision <> p_revision then raise exception 'record revision conflict' using errcode = '40001'; end if;

  v_title := v_row.title;
  v_summary := v_row.summary;
  v_content := v_row.content;
  v_pinned := v_row.pinned;

  if p_patch ? 'title' then
    if jsonb_typeof(p_patch -> 'title') not in ('string', 'null') then
      raise exception 'invalid title' using errcode = '22023';
    end if;
    v_title := nullif(btrim(coalesce(p_patch ->> 'title', '')), '');
    if v_title is not null and length(v_title) > 120 then
      raise exception 'invalid title length' using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'summary' then
    if jsonb_typeof(p_patch -> 'summary') not in ('string', 'null') then
      raise exception 'invalid summary' using errcode = '22023';
    end if;
    v_summary := nullif(btrim(coalesce(p_patch ->> 'summary', '')), '');
    if v_summary is not null and length(v_summary) > 500 then
      raise exception 'invalid summary length' using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'content' then
    if jsonb_typeof(p_patch -> 'content') is distinct from 'string'
      or length(btrim(p_patch ->> 'content')) not between 1 and 10000 then
      raise exception 'invalid content' using errcode = '22023';
    end if;
    v_content := p_patch ->> 'content';
  end if;

  if p_patch ? 'pinned' then
    if jsonb_typeof(p_patch -> 'pinned') is distinct from 'boolean' then
      raise exception 'invalid pinned' using errcode = '22023';
    end if;
    v_pinned := (p_patch ->> 'pinned')::boolean;
  end if;

  if p_patch ? 'tags' then
    perform public.set_inspiration_tags(v_owner, v_row.id, p_patch -> 'tags');
    perform set_config('lifeos.inspiration_bump', 'yes', true);
  end if;

  update public.inspirations
  set title = v_title, summary = v_summary, content = v_content, pinned = v_pinned
  where id = v_row.id;

  perform set_config('lifeos.inspiration_bump', '', true);
  return public.inspiration_json(v_row.id);
end;
$$;

create function public.delete_inspiration(p_id uuid, p_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_row public.inspirations%rowtype;
begin
  if v_owner is null or (auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'owner aal2 required' using errcode = '42501';
  end if;
  if p_revision is null or p_revision < 1 then
    raise exception 'invalid revision' using errcode = '22023';
  end if;
  select * into v_row from public.inspirations
  where id = p_id and owner_id = v_owner and deleted_at is null for update;
  if not found then raise exception 'inspiration not found' using errcode = 'P0002'; end if;
  if v_row.revision <> p_revision then raise exception 'record revision conflict' using errcode = '40001'; end if;
  update public.inspirations
  set deleted_at = clock_timestamp(), deletion_reason = 'web-delete'
  where id = v_row.id returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'revision', v_row.revision, 'deleted', true);
end;
$$;

create function public.manage_inspiration_tag(p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_name text;
  v_desc text;
  v_row public.inspiration_tags%rowtype;
  v_target public.inspiration_tags%rowtype;
  v_child public.inspiration_tags%rowtype;
  v_existing_id uuid;
  v_id uuid;
begin
  if v_owner is null or (auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'owner aal2 required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'invalid tag payload' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':inspiration-tags', 0));

  if p_action = 'create_group' then
    v_name := btrim(coalesce(p_payload ->> 'name', ''));
    v_desc := nullif(btrim(coalesce(p_payload ->> 'description', '')), '');
    insert into public.inspiration_tags(owner_id, level, parent_id, name, description)
    values (v_owner, 1, null, v_name, v_desc)
    returning * into v_row;
    return to_jsonb(v_row);

  elsif p_action = 'create_tag' then
    v_name := btrim(coalesce(p_payload ->> 'name', ''));
    v_desc := nullif(btrim(coalesce(p_payload ->> 'description', '')), '');
    v_id := (p_payload ->> 'parent_id')::uuid;
    insert into public.inspiration_tags(owner_id, level, parent_id, name, description)
    values (v_owner, 2, v_id, v_name, v_desc)
    returning * into v_row;
    return to_jsonb(v_row);

  elsif p_action = 'rename' then
    v_id := (p_payload ->> 'id')::uuid;
    v_name := btrim(coalesce(p_payload ->> 'name', ''));
    select * into v_row from public.inspiration_tags
    where id = v_id and owner_id = v_owner and archived_at is null for update;
    if not found then raise exception 'tag not found' using errcode = 'P0002'; end if;
    v_desc := case when p_payload ? 'description'
      then nullif(btrim(coalesce(p_payload ->> 'description', '')), '')
      else v_row.description end;
    update public.inspiration_tags
    set name = v_name, description = v_desc
    where id = v_row.id returning * into v_row;
    return to_jsonb(v_row);

  elsif p_action = 'move' then
    v_id := (p_payload ->> 'id')::uuid;
    select * into v_row from public.inspiration_tags
    where id = v_id and owner_id = v_owner and level = 2 and archived_at is null for update;
    if not found then raise exception 'level 2 tag not found' using errcode = 'P0002'; end if;
    select * into v_target from public.inspiration_tags
    where id = (p_payload ->> 'parent_id')::uuid and owner_id = v_owner and level = 1 and archived_at is null;
    if not found then raise exception 'target group not found' using errcode = 'P0002'; end if;
    update public.inspiration_tags set parent_id = v_target.id where id = v_row.id returning * into v_row;
    return to_jsonb(v_row);

  elsif p_action = 'merge' then
    select * into v_row from public.inspiration_tags
    where id = (p_payload ->> 'source_id')::uuid and owner_id = v_owner and archived_at is null for update;
    if not found then raise exception 'source tag not found' using errcode = 'P0002'; end if;
    select * into v_target from public.inspiration_tags
    where id = (p_payload ->> 'target_id')::uuid and owner_id = v_owner and archived_at is null for update;
    if not found then raise exception 'target tag not found' using errcode = 'P0002'; end if;
    if v_row.id = v_target.id or v_row.level <> v_target.level then
      raise exception 'merge requires two distinct tags of the same level' using errcode = '22023';
    end if;
    if v_row.level = 2 then
      insert into public.inspiration_tag_links(inspiration_id, tag_id)
      select inspiration_id, v_target.id from public.inspiration_tag_links where tag_id = v_row.id
      on conflict do nothing;
      delete from public.inspiration_tag_links where tag_id = v_row.id;
      update public.inspiration_tags set archived_at = clock_timestamp() where id = v_row.id;
    else
      for v_child in select * from public.inspiration_tags
        where owner_id = v_owner and level = 2 and parent_id = v_row.id and archived_at is null loop
        select id into v_existing_id from public.inspiration_tags
        where owner_id = v_owner and level = 2 and parent_id = v_target.id
          and archived_at is null and lower(name) = lower(v_child.name) limit 1;
        if v_existing_id is not null then
          insert into public.inspiration_tag_links(inspiration_id, tag_id)
          select inspiration_id, v_existing_id from public.inspiration_tag_links where tag_id = v_child.id
          on conflict do nothing;
          delete from public.inspiration_tag_links where tag_id = v_child.id;
          update public.inspiration_tags set archived_at = clock_timestamp() where id = v_child.id;
        else
          update public.inspiration_tags set parent_id = v_target.id where id = v_child.id;
        end if;
      end loop;
      update public.inspiration_tags set archived_at = clock_timestamp() where id = v_row.id;
    end if;
    return jsonb_build_object('merged_from', v_row.id, 'merged_into', v_target.id, 'level', v_row.level);

  elsif p_action = 'archive' then
    v_id := (p_payload ->> 'id')::uuid;
    select * into v_row from public.inspiration_tags
    where id = v_id and owner_id = v_owner and archived_at is null for update;
    if not found then raise exception 'tag not found' using errcode = 'P0002'; end if;
    if v_row.level = 1 then
      delete from public.inspiration_tag_links
      where tag_id in (select id from public.inspiration_tags where parent_id = v_row.id and owner_id = v_owner);
      update public.inspiration_tags
      set archived_at = clock_timestamp()
      where parent_id = v_row.id and owner_id = v_owner and archived_at is null;
    else
      delete from public.inspiration_tag_links where tag_id = v_row.id;
    end if;
    update public.inspiration_tags set archived_at = clock_timestamp() where id = v_row.id;
    return jsonb_build_object('archived', v_row.id, 'level', v_row.level);

  else
    raise exception 'unknown tag action' using errcode = '22023';
  end if;
end;
$$;

-- ============================================================
-- 8. 函数执行权限收口与历史灵感回填
-- ============================================================

revoke all on function
  public.enforce_inspiration_tag_hierarchy(), public.enforce_inspiration_tag_link(),
  public.version_inspiration_update(), public.audit_inspiration_update(),
  public.ensure_inspiration_tag(uuid, text, text), public.set_inspiration_tags(uuid, uuid, jsonb),
  public.inspiration_json(uuid), public.get_steward_context(uuid),
  public.get_input_records(uuid), public.get_input_records_before_inspirations(uuid),
  public.apply_steward(uuid, uuid, jsonb, jsonb), public.apply_steward_before_inspirations(uuid, uuid, jsonb, jsonb),
  public.run_command(uuid, uuid, text), public.run_command_before_inspirations(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function
  public.ensure_inspiration_tag(uuid, text, text), public.set_inspiration_tags(uuid, uuid, jsonb),
  public.inspiration_json(uuid), public.get_steward_context(uuid),
  public.get_input_records(uuid), public.get_input_records_before_inspirations(uuid),
  public.apply_steward(uuid, uuid, jsonb, jsonb), public.apply_steward_before_inspirations(uuid, uuid, jsonb, jsonb),
  public.run_command(uuid, uuid, text), public.run_command_before_inspirations(uuid, uuid, text)
to service_role;

revoke all on function
  public.create_inspiration(text, text, text, jsonb, boolean), public.edit_inspiration(uuid, bigint, jsonb),
  public.delete_inspiration(uuid, bigint), public.manage_inspiration_tag(text, jsonb)
from public, anon;

grant execute on function
  public.create_inspiration(text, text, text, jsonb, boolean), public.edit_inspiration(uuid, bigint, jsonb),
  public.delete_inspiration(uuid, bigint), public.manage_inspiration_tag(text, jsonb)
to authenticated, service_role;

-- 幂等回填已有 archive_kind = 'inspiration' 的微信原话
insert into public.inspirations(owner_id, raw_input_id, item_index, source, content, captured_at)
select r.owner_id, r.id, 0, 'wechat', left(r.text, 10000), r.received_at
from public.raw_inputs r
where r.source = 'wechat' and r.status = 'parsed' and r.revoked_at is null
  and r.parse_result ->> 'archive_kind' = 'inspiration' and nullif(btrim(r.text), '') is not null
on conflict (raw_input_id, item_index) where raw_input_id is not null do nothing;
