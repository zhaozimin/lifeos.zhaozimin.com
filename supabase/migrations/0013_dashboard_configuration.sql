-- [INPUT]: 本人 AAL2、完整配置草稿及配置版本。
-- [OUTPUT]: 原版分类、账户、项目和周起点的原子保存。
-- [POS]: 主数据唯一写入口；改名传播到账本并保留来源档案。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
create or replace function public.protect_category() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.owner_id,new.code,new.kind,new.parent_id,new.created_at) is distinct from
  (old.owner_id,old.code,old.kind,old.parent_id,old.created_at) then
  raise exception 'category identity is immutable' using errcode='55000'; end if;
 if (new.name,new.keywords,new.direction,new.nature) is distinct from (old.name,old.keywords,old.direction,old.nature)
  and coalesce(current_setting('lifeos.dashboard_category_write',true),'')<>'yes' then
  raise exception 'category semantics require dashboard operation' using errcode='55000'; end if;
 if new.direction is distinct from old.direction and new.direction is not null and exists(
  select 1 from public.transactions where category_id=old.id and direction<>new.direction) then
  raise exception 'category direction conflicts with history' using errcode='23514'; end if;
 return new;
end;
$$;
create function public.dashboard_local(p_kind text,p_source text,p_data jsonb,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=public.dashboard_owner(); v_old public.local_records%rowtype; v_result jsonb;
begin
 if p_kind not in ('account','project') or jsonb_typeof(p_data)<>'object' or
  length(trim(coalesce(p_data->>'name',''))) not between 1 and 500 or octet_length(p_data::text)>32768 then
  raise exception 'invalid master record' using errcode='22023'; end if;
 if p_kind='account' and (jsonb_typeof(p_data->'openingBalance') is distinct from 'number' or
  abs((p_data->>'openingBalance')::numeric)>90071992547409.91 or
  round((p_data->>'openingBalance')::numeric,2)<>(p_data->>'openingBalance')::numeric) then
  raise exception 'invalid opening balance' using errcode='22023'; end if;
 select * into v_old from public.local_records where owner_id=v_owner and kind=p_kind and source_id=p_source for update;
 if found then
  if v_old.data is not distinct from p_data then return to_jsonb(v_old); end if;
  if p_revision is null or p_revision<>v_old.revision then raise exception 'master revision conflict' using errcode='40001'; end if;
  update public.local_records set data=p_data,deleted_at=(p_data->>'deletedAt')::timestamptz
   where id=v_old.id returning to_jsonb(local_records) into v_result;
  if p_kind='account' and v_old.data->>'name' is distinct from p_data->>'name' then
   update public.transactions t set account=case when t.account=v_old.data->>'name' then p_data->>'name' else t.account end,
    from_account=case when t.from_account=v_old.data->>'name' then p_data->>'name' else t.from_account end,
    to_account=case when t.to_account=v_old.data->>'name' then p_data->>'name' else t.to_account end
   from public.raw_inputs r where r.id=t.raw_input_id and r.owner_id=v_owner and
    (t.account=v_old.data->>'name' or t.from_account=v_old.data->>'name' or t.to_account=v_old.data->>'name');
  end if;
 else
  insert into public.local_records(owner_id,kind,source_id,data) values(v_owner,p_kind,p_source,p_data)
   returning to_jsonb(local_records) into v_result;
  insert into public.record_changes(owner_id,kind,record_id,revision,before_data,after_data,actor)
   values(v_owner,p_kind,(v_result->>'id')::uuid,1,'{}',v_result,'web');
 end if;
 return v_result;
end;
$$;
create function public.dashboard_configuration(p_domain text,p_revision bigint,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid:=public.dashboard_owner(); v_pref public.dashboard_preferences%rowtype;
 v_item jsonb; v_old jsonb; v_category public.categories%rowtype; v_id smallint; v_result jsonb;
 v_settings jsonb; v_before jsonb; v_ids smallint[]:='{}';
begin
 if p_domain not in ('time','finance') or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>524288 then
  raise exception 'invalid configuration' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':configuration',0));
 perform set_config('lifeos.dashboard_category_write','yes',true);
 insert into public.dashboard_preferences(owner_id,domain) values(v_owner,p_domain) on conflict do nothing;
 select * into v_pref from public.dashboard_preferences where owner_id=v_owner and domain=p_domain for update;
 if p_revision is null or p_revision<>v_pref.revision then raise exception 'configuration revision conflict' using errcode='40001'; end if;
 v_settings:=coalesce(p_data->'settings','{}');
 if p_domain='time' then
  if v_settings->>'weekStart' not in ('monday','sunday') then raise exception 'invalid week start' using errcode='22023'; end if;
  v_settings:=v_pref.data||jsonb_build_object('weekStart',v_settings->>'weekStart');
 else
  if jsonb_typeof(p_data->'accounts')<>'array' or jsonb_array_length(p_data->'accounts')>1000 or
   jsonb_typeof(p_data->'categories')<>'array' or jsonb_array_length(p_data->'categories')>1000 or
   jsonb_typeof(v_settings)<>'object' then raise exception 'invalid finance configuration' using errcode='22023'; end if;
  if v_settings->>'defaultCurrency' is distinct from 'CNY' or v_settings->>'timezone' is distinct from 'Asia/Shanghai' then
   raise exception 'cloud ledger currency and timezone fixed' using errcode='22023'; end if;
  for v_item in select value from jsonb_array_elements(p_data->'accounts') loop
   perform public.dashboard_local('account',v_item->>'id',v_item-'currentBalance'-'cloudId'-'revision',nullif(v_item->>'revision','')::bigint);
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(v_settings->'projects','[]')) loop
   perform public.dashboard_local('project','finance:'||(v_item->>'id'),v_item-'cloudId'-'revision',nullif(v_item->>'revision','')::bigint);
  end loop;
  for v_item in select value from jsonb_array_elements(p_data->'categories') loop
   if length(trim(coalesce(v_item->>'name',''))) not between 1 and 500 then raise exception 'invalid category name' using errcode='22023'; end if;
   select * into v_category from public.categories where owner_id=v_owner and kind='money' and id::text=v_item->>'id' for update;
   if found then
    v_id:=v_category.id; v_before:=to_jsonb(v_category);
    update public.categories set name=v_item->>'name',metadata=v_item-'id',
     direction=case v_item->>'direction' when '收入' then 'income' when '支出' then 'expense' else null end,
     keywords=array(select jsonb_array_elements_text(coalesce(v_item->'keywords','[]'))),
     is_active=coalesce(v_item->>'deletedAt','')='' where id=v_id returning to_jsonb(categories) into v_result;
   else
    insert into public.categories(owner_id,kind,code,name,direction,metadata,keywords)
    values(v_owner,'money','web:'||gen_random_uuid()::text,v_item->>'name',case v_item->>'direction' when '收入' then 'income' when '支出' then 'expense' else null end,
     v_item-'id',array(select jsonb_array_elements_text(coalesce(v_item->'keywords','[]')))) returning id,to_jsonb(categories) into v_id,v_result;
    v_before:='{}';
   end if;
   v_ids:=array_append(v_ids,v_id);
   if v_before is distinct from v_result then
    insert into public.record_changes(owner_id,kind,record_id,revision,before_data,after_data,actor)
     values(v_owner,'category',gen_random_uuid(),1,v_before,v_result,'web');
   end if;
  end loop;
  -- 分类删除只停用；历史账目与原始来源仍可查询。
  update public.categories set is_active=false where owner_id=v_owner and kind='money' and code<>'uncategorized' and not(id=any(v_ids));
  v_settings:=v_settings-'projects';
 end if;
 update public.dashboard_preferences set data=v_settings,revision=revision+1,updated_at=clock_timestamp()
  where id=v_pref.id returning to_jsonb(dashboard_preferences) into v_result;
 insert into public.record_changes(owner_id,kind,record_id,revision,before_data,after_data,actor)
  values(v_owner,'configuration',v_pref.id,v_pref.revision+1,to_jsonb(v_pref),v_result,'web');
 perform set_config('lifeos.dashboard_category_write','',true);
 return v_result;
end;
$$;
create function public.dashboard_master(p_entity text,p_action text,p_id text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=public.dashboard_owner(); v_result jsonb; v_old jsonb; v_id smallint; v_local public.local_records%rowtype;
begin
 if p_entity not in ('category','project') or p_action not in ('create','update','delete') or
  jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16384 then raise exception 'invalid master operation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':configuration',0));
 perform set_config('lifeos.dashboard_category_write','yes',true);
 if p_entity='category' then
  if p_action='create' then
   insert into public.categories(owner_id,kind,code,name,nature,keywords,metadata)
   values(v_owner,'time','web:'||gen_random_uuid()::text,p_data->>'name',p_data->>'nature',
    array(select jsonb_array_elements_text(coalesce(p_data->'keywords','[]'))),p_data) returning to_jsonb(categories) into v_result;
   v_old:='{}';
  else
   select to_jsonb(c) into v_old from public.categories c where owner_id=v_owner and kind='time' and id::text=p_id for update;
   if v_old is null then raise exception 'category not found' using errcode='P0002'; end if;
   if v_old->>'code'='uncategorized' then raise exception 'protected category' using errcode='22023'; end if;
   if p_action='delete' then update public.categories set is_active=false where id=(v_old->>'id')::smallint returning to_jsonb(categories) into v_result;
   else
    update public.categories set name=p_data->>'name',nature=p_data->>'nature',
     keywords=array(select jsonb_array_elements_text(coalesce(p_data->'keywords','[]'))),metadata=metadata||p_data
     where id=(v_old->>'id')::smallint returning to_jsonb(categories) into v_result;
   end if;
  end if;
  if length(trim(v_result->>'name')) not between 1 and 500 or v_result->>'nature' not in ('core','support','recovery','leisure') then
   raise exception 'invalid time category' using errcode='22023'; end if;
  insert into public.record_changes(owner_id,kind,record_id,revision,before_data,after_data,actor)
   values(v_owner,'category',gen_random_uuid(),1,v_old,v_result,'web');
 else
  if p_action='create' then
   v_result:=public.dashboard_local('project','time:'||gen_random_uuid()::text,p_data,1);
  else
   select * into v_local from public.local_records where owner_id=v_owner and kind='project' and id::text=p_id and source_id like 'time:%' for update;
   if not found then raise exception 'project not found' using errcode='P0002'; end if;
   if p_action='delete' then
    update public.local_records set deleted_at=now() where id=v_local.id returning to_jsonb(local_records) into v_result;
   else v_result:=public.dashboard_local('project',v_local.source_id,v_local.data||p_data,v_local.revision); end if;
  end if;
 end if;
 perform set_config('lifeos.dashboard_category_write','',true);
 return v_result;
end;
$$;
revoke all on function public.dashboard_local(text,text,jsonb,bigint),public.dashboard_configuration(text,bigint,jsonb),
 public.dashboard_master(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.dashboard_configuration(text,bigint,jsonb),public.dashboard_master(text,text,text,jsonb) to authenticated;
