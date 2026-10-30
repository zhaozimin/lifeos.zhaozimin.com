-- [INPUT]: 本人返还的大类清单、事件映射与既有时间账本。
-- [OUTPUT]: 大类策略、精确事件规则和WHOOP待校准睡眠标记。
-- [POS]: 分类真源；仅服务端安装本人规则，不创建细分类。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create table public.time_group_policies(
 owner_id uuid primary key references auth.users(id),review_hash text not null,
 sleep_authority boolean not null default true,include_naps boolean not null default true,
 installed_at timestamptz not null default now()
);
create table public.time_group_rules(
 owner_id uuid not null references auth.users(id),activity text not null,
 category_id smallint not null references public.categories(id),review_hash text not null,
 primary key(owner_id,activity)
);
alter table public.time_group_policies enable row level security;
alter table public.time_group_rules enable row level security;
revoke all on public.time_group_policies,public.time_group_rules from public,anon,authenticated;
grant select on public.time_group_policies,public.time_group_rules to authenticated;
grant all on public.time_group_policies,public.time_group_rules to service_role;
create policy owner_read on public.time_group_policies for select to authenticated using
 (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
create policy owner_read on public.time_group_rules for select to authenticated using
 (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');

create function public.install_time_groups(p_owner_id uuid,p_review_hash text,p_groups jsonb,p_rules jsonb,p_include_naps boolean default true)
returns jsonb language plpgsql set search_path='' as $$
declare g jsonb;r jsonb;category smallint;rule_count integer:=0;
begin
 if length(p_review_hash)<>64 or jsonb_typeof(p_groups)<>'array' or jsonb_array_length(p_groups) not between 2 and 30
  or jsonb_typeof(p_rules)<>'array' or jsonb_array_length(p_rules)>5000 then
  raise exception 'invalid group review' using errcode='22023';end if;
 if (select count(distinct value->>'name') from jsonb_array_elements(p_groups))<>jsonb_array_length(p_groups)
  or (select count(distinct value->>'code') from jsonb_array_elements(p_groups))<>jsonb_array_length(p_groups)
  or not exists(select 1 from jsonb_array_elements(p_groups) x where x->>'code'='uncategorized' and x->>'name'='待确认') then
  raise exception 'group names and codes must be unique' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':time-groups',0));
 perform set_config('lifeos.dashboard_category_write','yes',true);
 update public.categories set is_active=false where owner_id=p_owner_id and kind='time';
 for g in select value from jsonb_array_elements(p_groups) loop
  if length(trim(g->>'name')) not between 1 and 40 or g->>'nature' not in ('core','support','recovery','leisure')
   or g->>'code'!~'^(uncategorized|time-group-[a-z0-9-]+)$' then
   raise exception 'invalid time group' using errcode='22023';end if;
  insert into public.categories(owner_id,kind,code,name,nature,keywords,is_active,metadata)
   values(p_owner_id,'time',g->>'code',g->>'name',g->>'nature',
    array(select jsonb_array_elements_text(coalesce(g->'keywords','[]'))),true,
    jsonb_build_object('bigGroup',true,'reviewHash',p_review_hash))
  on conflict(owner_id,kind,code) do update set name=excluded.name,nature=excluded.nature,
   keywords=excluded.keywords,is_active=true,metadata=categories.metadata||excluded.metadata;
 end loop;
 delete from public.time_group_rules where owner_id=p_owner_id;
 for r in select value from jsonb_array_elements(p_rules) loop
  if length(trim(r->>'activity')) not between 1 and 500 then raise exception 'invalid reviewed activity' using errcode='22023';end if;
  select id into category from public.categories where owner_id=p_owner_id and kind='time' and is_active
   and metadata->>'bigGroup'='true' and name=r->>'group';
  if category is null then raise exception 'reviewed group missing' using errcode='22023';end if;
  insert into public.time_group_rules values(p_owner_id,r->>'activity',category,p_review_hash);
  rule_count:=rule_count+1;
 end loop;
 insert into public.time_group_policies(owner_id,review_hash,include_naps) values(p_owner_id,p_review_hash,p_include_naps)
  on conflict(owner_id) do update set review_hash=excluded.review_hash,include_naps=excluded.include_naps,installed_at=now();
 perform set_config('lifeos.dashboard_category_write','',true);
 return jsonb_build_object('groups',jsonb_array_length(p_groups),'rules',rule_count,'include_naps',p_include_naps);
end;
$$;

create function public.apply_time_group_rule() returns trigger language plpgsql set search_path='' as $$
declare owner uuid;source text;policy public.time_group_policies%rowtype;reviewed smallint;group_name text;
begin
 select owner_id,r.source into owner,source from public.raw_inputs r where r.id=new.raw_input_id;
 select * into policy from public.time_group_policies where owner_id=owner;
 if not found or source='whoop' then return new;end if;
 if tg_op='INSERT' and source='wechat' then
  select category_id into reviewed from public.time_group_rules where owner_id=owner and activity=new.activity;
  if reviewed is not null then new.category_id:=reviewed;end if;
 end if;
 select name into group_name from public.categories where id=new.category_id and owner_id=owner;
 if policy.sleep_authority and (group_name='睡眠' or (group_name='待确认' and new.activity~'(睡觉|睡眠|午睡|午觉|补觉|打盹|入睡)')) and
  (policy.include_naps or new.activity!~'(午睡|午觉|补觉|打盹)') then
  select id into new.category_id from public.categories where owner_id=owner and kind='time' and code='uncategorized';
  if not ('whoop-pending'=any(coalesce(new.tags,'{}'))) then new.tags:=coalesce(new.tags,'{}')||array['whoop-pending'];end if;
 end if;
 return new;
end;
$$;
create trigger time_group_rule before insert or update of activity,category_id on public.time_entries
 for each row execute function public.apply_time_group_rule();
revoke all on function public.install_time_groups(uuid,text,jsonb,jsonb,boolean),public.apply_time_group_rule()
 from public,anon,authenticated;
grant execute on function public.install_time_groups(uuid,text,jsonb,jsonb,boolean),public.apply_time_group_rule() to service_role;

create function public.resolve_time_group(p_owner uuid,p_activity text,p_code text) returns text
language plpgsql stable set search_path='' as $$
declare code text;name text;policy public.time_group_policies%rowtype;
begin
 select * into policy from public.time_group_policies where owner_id=p_owner;
 if not found then return p_code;end if;
 select c.code,c.name into code,name from public.time_group_rules r join public.categories c on c.id=r.category_id
  where r.owner_id=p_owner and r.activity=p_activity and c.is_active;
 if code is null then select c.code,c.name into code,name from public.categories c
  where c.owner_id=p_owner and c.kind='time' and c.code=p_code and c.is_active and c.metadata->>'bigGroup'='true';end if;
 if code is null then return 'uncategorized';end if;
 if name='睡眠' and policy.sleep_authority and (policy.include_naps or p_activity!~'(午睡|午觉|补觉|打盹)') then return 'uncategorized';end if;
 return code;
end;
$$;
alter function public.apply_steward_records(uuid,uuid,jsonb,jsonb) rename to apply_steward_records_before_groups;
create function public.apply_steward_records(p_input_id uuid,p_lease_token uuid,p_result jsonb,p_expected_ongoing jsonb default null)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare owner uuid;plan jsonb:=p_result;items jsonb;item jsonb;key text;
begin
 select owner_id into owner from public.raw_inputs where id=p_input_id;
 if exists(select 1 from public.time_group_policies where owner_id=owner) then
  foreach key in array array['time_entries','time_events'] loop
   if jsonb_typeof(plan->key)='array' then
    items:='[]';
    for item in select value from jsonb_array_elements(plan->key) loop
     if key='time_entries' or item->>'action'='switch' then
      item:=jsonb_set(item,'{category}',to_jsonb(public.resolve_time_group(owner,item->>'activity',item->>'category')));
     end if;
     items:=items||jsonb_build_array(item);
    end loop;
    plan:=jsonb_set(plan,array[key],items);
   end if;
  end loop;
 end if;
 return public.apply_steward_records_before_groups(p_input_id,p_lease_token,plan,p_expected_ongoing);
end;
$$;
revoke all on function public.resolve_time_group(uuid,text,text),public.apply_steward_records(uuid,uuid,jsonb,jsonb),public.apply_steward_records_before_groups(uuid,uuid,jsonb,jsonb)
 from public,anon,authenticated;
grant execute on function public.resolve_time_group(uuid,text,text),public.apply_steward_records(uuid,uuid,jsonb,jsonb),public.apply_steward_records_before_groups(uuid,uuid,jsonb,jsonb) to service_role;
