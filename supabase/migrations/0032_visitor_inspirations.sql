-- [INPUT]: 依赖 0024_visitor.sql 的 visitor_settings 与 0031_inspirations.sql 的灵感及两层标签表。
-- [OUTPUT]: 在 visitor_settings 新增默认关闭的 share_inspirations 开关，提供匿名只读投影 RPC public.visitor_inspirations。
-- [POS]: 灵感公开与可抓取出口；遵循默认关闭、底表零授权、仅暴露公开字段（不暴露 raw_input_id/owner_id/revision）的安全边界。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

alter table public.visitor_settings
  add column if not exists share_inspirations boolean not null default false;

create or replace function public.visitor_inspirations_enabled() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.visitor_settings
    where id = 1 and enabled and share_inspirations
  )
$$;

create or replace function public.visitor_inspirations(
  p_date date default null,
  p_from date default null,
  p_to date default null,
  p_group text default null,
  p_tag text default null,
  p_q text default null,
  p_limit integer default 100,
  p_offset integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  cfg public.visitor_settings;
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 200));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 10000));
  v_group text := nullif(btrim(coalesce(p_group, '')), '');
  v_tag text := nullif(btrim(coalesce(p_tag, '')), '');
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_from date := p_from;
  v_to date := p_to;
  v_items jsonb;
  v_total integer;
  v_tags_tree jsonb;
  v_dates jsonb;
begin
  select * into cfg from public.visitor_settings
  where id = 1 and enabled and share_inspirations;
  if not found then
    raise exception 'visitor inspirations disabled' using errcode = '42501';
  end if;

  if p_date is not null then
    v_from := p_date;
    v_to := p_date;
  elsif v_from is not null and v_to is not null then
    if v_to < v_from or (v_to - v_from) > 367 then
      raise exception 'invalid visitor date range' using errcode = '22023';
    end if;
  elsif v_from is not null and v_to is null then
    v_to := v_from;
  elsif v_from is null and v_to is not null then
    v_from := v_to;
  end if;

  with base as (
    select
      i.id,
      i.title,
      i.summary,
      i.content,
      i.pinned,
      i.captured_at,
      ((i.captured_at at time zone 'Asia/Shanghai')::date) as day_cn
    from public.inspirations i
    where i.owner_id = cfg.owner_id
      and i.deleted_at is null
  ),
  filtered as (
    select b.*
    from base b
    where (v_from is null or b.day_cn >= v_from)
      and (v_to is null or b.day_cn <= v_to)
      and (
        v_q is null
        or coalesce(b.title, '') ilike '%' || v_q || '%'
        or coalesce(b.summary, '') ilike '%' || v_q || '%'
        or b.content ilike '%' || v_q || '%'
      )
      and (
        v_group is null
        or exists (
          select 1
          from public.inspiration_tag_links l
          join public.inspiration_tags c on c.id = l.tag_id and c.level = 2 and c.archived_at is null
          join public.inspiration_tags g on g.id = c.parent_id and g.level = 1 and g.archived_at is null
          where l.inspiration_id = b.id
            and lower(g.name) = lower(v_group)
        )
      )
      and (
        v_tag is null
        or exists (
          select 1
          from public.inspiration_tag_links l
          join public.inspiration_tags c on c.id = l.tag_id and c.level = 2 and c.archived_at is null
          join public.inspiration_tags g on g.id = c.parent_id and g.level = 1 and g.archived_at is null
          where l.inspiration_id = b.id
            and (
              lower(c.name) = lower(v_tag)
              or lower(g.name || '/' || c.name) = lower(v_tag)
            )
        )
      )
  ),
  paged as (
    select * from filtered
    order by pinned desc, captured_at desc, id desc
    limit v_limit offset v_offset
  )
  select
    (select count(*)::integer from filtered),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'title', p.title,
          'summary', p.summary,
          'content', p.content,
          'pinned', p.pinned,
          'captured_at', p.captured_at,
          'date_shanghai', to_char(p.day_cn, 'YYYY-MM-DD'),
          'tags', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'group_id', g.id,
                'group', g.name,
                'name', c.name
              ) order by g.name, c.name
            )
            from public.inspiration_tag_links l
            join public.inspiration_tags c on c.id = l.tag_id and c.level = 2 and c.archived_at is null
            join public.inspiration_tags g on g.id = c.parent_id and g.level = 1 and g.archived_at is null
            where l.inspiration_id = p.id
          ), '[]'::jsonb)
        ) order by p.pinned desc, p.captured_at desc, p.id desc
      )
      from paged p
    ), '[]'::jsonb)
  into v_total, v_items;

  -- 活跃两层标签树（仅计公开未删灵感）
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'description', g.description,
      'count', (
        select count(distinct l.inspiration_id)::integer
        from public.inspiration_tag_links l
        join public.inspiration_tags c2 on c2.id = l.tag_id and c2.parent_id = g.id and c2.level = 2 and c2.archived_at is null
        join public.inspirations i2 on i2.id = l.inspiration_id and i2.owner_id = cfg.owner_id and i2.deleted_at is null
      ),
      'children', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'parent_id', c.parent_id,
            'name', c.name,
            'description', c.description,
            'count', (
              select count(distinct l2.inspiration_id)::integer
              from public.inspiration_tag_links l2
              join public.inspirations i3 on i3.id = l2.inspiration_id and i3.owner_id = cfg.owner_id and i3.deleted_at is null
              where l2.tag_id = c.id
            )
          ) order by c.created_at, c.name
        )
        from public.inspiration_tags c
        where c.owner_id = cfg.owner_id and c.level = 2 and c.parent_id = g.id and c.archived_at is null
      ), '[]'::jsonb)
    ) order by g.created_at, g.name
  ), '[]'::jsonb)
  into v_tags_tree
  from public.inspiration_tags g
  where g.owner_id = cfg.owner_id and g.level = 1 and g.archived_at is null;

  -- 最近 90 个有灵感的上海自然日，便于 Agent 与访客按日抓取
  select coalesce(jsonb_agg(to_char(d.day_cn, 'YYYY-MM-DD') order by d.day_cn desc), '[]'::jsonb)
  into v_dates
  from (
    select distinct ((i.captured_at at time zone 'Asia/Shanghai')::date) as day_cn
    from public.inspirations i
    where i.owner_id = cfg.owner_id and i.deleted_at is null
    order by day_cn desc
    limit 90
  ) d;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'timezone', 'Asia/Shanghai',
    'date', case when p_date is not null then to_char(p_date, 'YYYY-MM-DD') else null end,
    'from', case when v_from is not null then to_char(v_from, 'YYYY-MM-DD') else null end,
    'to', case when v_to is not null then to_char(v_to, 'YYYY-MM-DD') else null end,
    'tags_tree', v_tags_tree,
    'available_dates', v_dates
  );
end;
$$;

revoke all on function public.visitor_inspirations_enabled() from public;
grant execute on function public.visitor_inspirations_enabled() to anon, authenticated, service_role;

revoke all on function public.visitor_inspirations(date, date, date, text, text, text, integer, integer) from public;
grant execute on function public.visitor_inspirations(date, date, date, text, text, text, integer, integer) to anon, authenticated, service_role;
