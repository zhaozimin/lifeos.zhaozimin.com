-- [INPUT]: 本人 AAL2、记录版本和受限字段补丁。
-- [OUTPUT]: 原子人工编辑、账户改名传播及不可变修改记录。
-- [POS]: 网页唯一写入口；客户端没有底表写权限。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

create function public.version_record_update() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id<>old.id or new.created_at<>old.created_at then
    raise exception 'record identity is immutable' using errcode='55000';
  end if;
  if tg_table_name='local_records' then
    if (new.owner_id,new.kind,new.source_id) is distinct from (old.owner_id,old.kind,old.source_id) then
      raise exception 'record origin is immutable' using errcode='55000';
    end if;
  else
    if (new.raw_input_id,new.item_index) is distinct from (old.raw_input_id,old.item_index) then
      raise exception 'record origin is immutable' using errcode='55000';
    end if;
  end if;
  if (to_jsonb(new)-'revision'-'updated_at'-'duration_min')=
     (to_jsonb(old)-'revision'-'updated_at'-'duration_min') then return old; end if;
  new.revision:=old.revision+1; new.updated_at:=clock_timestamp();
  return new;
end;
$$;
create function public.audit_record_update() returns trigger language plpgsql set search_path='' as $$
declare v_owner uuid; v_kind text;
begin
  if new.revision=old.revision then return new; end if;
  if tg_table_name='local_records' then v_owner:=new.owner_id; v_kind:=new.kind;
  else
    select owner_id into v_owner from public.raw_inputs where id=new.raw_input_id;
    v_kind:=case when tg_table_name='time_entries' then 'time' else 'money' end;
  end if;
  insert into public.record_changes(owner_id,kind,record_id,revision,before_data,after_data,actor)
    values(v_owner,v_kind,old.id,new.revision,to_jsonb(old),to_jsonb(new),
      case when auth.uid() is null then 'service' else 'web' end);
  return new;
end;
$$;
create trigger time_edit_version before update on public.time_entries
  for each row execute function public.version_record_update();
create trigger money_edit_version before update on public.transactions
  for each row execute function public.version_record_update();
create trigger local_edit_version before update on public.local_records
  for each row execute function public.version_record_update();
create trigger time_edit_audit after update on public.time_entries
  for each row execute function public.audit_record_update();
create trigger money_edit_audit after update on public.transactions
  for each row execute function public.audit_record_update();
create trigger local_edit_audit after update on public.local_records
  for each row execute function public.audit_record_update();

create function public.edit_record(p_kind text,p_id uuid,p_revision bigint,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=auth.uid(); v_allowed text[]; v_result jsonb;
  v_time public.time_entries%rowtype; v_money public.transactions%rowtype;
  v_local public.local_records%rowtype; v_old_name text;
begin
  if v_owner is null or (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'owner aal2 required' using errcode='42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch='{}'::jsonb or p_revision is null or p_revision<1 then
    raise exception 'invalid edit patch' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(p_patch) e where e.key in
    ('activity','title','name','start_at','end_at','occurred_at','note','project','deduction_note',
     'direction','currency','account','from_account','to_account','merchant','task_date','start_time','end_time','status','group_id')
     and jsonb_typeof(e.value) not in ('string','null')) then
    raise exception 'invalid text field type' using errcode='22023'; end if;
  if p_patch?'tags' and (jsonb_typeof(p_patch->'tags') is distinct from 'array') then
    raise exception 'invalid tags type' using errcode='22023'; end if;
  if p_kind='task' then perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':tasks',0)); end if;
  if p_kind='time' then
    select t.* into v_time from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
      where t.id=p_id and r.owner_id=v_owner and t.deleted_at is null for update of t;
    if not found then raise exception 'record not found' using errcode='P0002'; end if;
    if v_time.revision<>p_revision then raise exception 'record revision conflict' using errcode='40001'; end if;
    v_allowed:=array['start_at','end_at','activity','category_id','deduction_minutes','deduction_note','project','tags','note'];
    if exists(select 1 from jsonb_object_keys(p_patch) k where not(k=any(v_allowed))) then
      raise exception 'field not editable' using errcode='22023';
    end if;
    v_time:=jsonb_populate_record(v_time,p_patch);
    if cardinality(v_time.tags)>50 or length(coalesce(v_time.note,''))>10000 or
      length(coalesce(v_time.deduction_note,''))>2000 then
      raise exception 'edit text too long' using errcode='22023'; end if;
    update public.time_entries set start_at=v_time.start_at,end_at=v_time.end_at,
      activity=v_time.activity,category_id=v_time.category_id,deduction_minutes=v_time.deduction_minutes,
      deduction_note=v_time.deduction_note,project=v_time.project,tags=v_time.tags,note=v_time.note
      where id=p_id returning to_jsonb(time_entries) into v_result;
  elsif p_kind='money' then
    select t.* into v_money from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
      where t.id=p_id and r.owner_id=v_owner and t.deleted_at is null for update of t;
    if not found then raise exception 'record not found' using errcode='P0002'; end if;
    if v_money.revision<>p_revision then raise exception 'record revision conflict' using errcode='40001'; end if;
    v_allowed:=array['occurred_at','direction','title','amount_cents','currency','category_id','account',
      'from_account','to_account','merchant','project','tags','note'];
    if exists(select 1 from jsonb_object_keys(p_patch) k where not(k=any(v_allowed))) then
      raise exception 'field not editable' using errcode='22023'; end if;
    v_money:=jsonb_populate_record(v_money,p_patch);
    if cardinality(v_money.tags)>50 or length(coalesce(v_money.note,''))>10000 or
      length(coalesce(v_money.title,''))>500 then
      raise exception 'edit text too long' using errcode='22023'; end if;
    update public.transactions set occurred_at=v_money.occurred_at,direction=v_money.direction,
      title=v_money.title,amount_cents=v_money.amount_cents,currency=v_money.currency,
      category_id=v_money.category_id,account=v_money.account,from_account=v_money.from_account,
      to_account=v_money.to_account,merchant=v_money.merchant,project=v_money.project,
      tags=v_money.tags,note=v_money.note where id=p_id returning to_jsonb(transactions) into v_result;
  elsif p_kind in ('account','task','task_group','project') then
    select * into v_local from public.local_records where id=p_id and owner_id=v_owner
      and kind=p_kind and deleted_at is null for update;
    if not found then raise exception 'record not found' using errcode='P0002'; end if;
    if v_local.revision<>p_revision then raise exception 'record revision conflict' using errcode='40001'; end if;
    v_allowed:=case p_kind
      when 'account' then array['name','openingBalance','note']
      when 'task' then array['title','task_date','start_time','end_time','note','status','group_id']
      when 'task_group' then array['title','note'] else array['name','note'] end;
    if exists(select 1 from jsonb_object_keys(p_patch) k where not(k=any(v_allowed))) then
      raise exception 'field not editable' using errcode='22023'; end if;
    v_old_name:=v_local.data->>'name';
    v_local.data:=v_local.data||p_patch;
    if length(trim(coalesce(v_local.data->>case when p_kind in ('account','project') then 'name' else 'title' end,''))) not between 1 and 500
      or length(coalesce(v_local.data->>'note',''))>10000 then
      raise exception 'invalid record text' using errcode='22023'; end if;
    if p_kind='account' then
      if jsonb_typeof(v_local.data->'openingBalance') is distinct from 'number' or
        abs((v_local.data->>'openingBalance')::numeric)>90071992547409.91 or
        round((v_local.data->>'openingBalance')::numeric,2)<>(v_local.data->>'openingBalance')::numeric then
        raise exception 'invalid opening balance' using errcode='22023'; end if;
    elsif p_kind='task' then
      if coalesce(v_local.data->>'status','') not in ('pending','completed') then
        raise exception 'invalid task status' using errcode='22023'; end if;
      if ((v_local.data->>'task_date' is null and v_local.data->>'start_time' is null and v_local.data->>'end_time' is null)
        or (v_local.data->>'task_date' is not null and v_local.data->>'start_time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and v_local.data->>'end_time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and v_local.data->>'end_time'>v_local.data->>'start_time')) is not true then
        raise exception 'invalid task schedule' using errcode='22023'; end if;
      perform (v_local.data->>'task_date')::date;
      if exists(select 1 from public.local_records l where l.owner_id=v_owner and l.kind='task'
        and l.id<>p_id and l.deleted_at is null and l.data->>'task_date'=v_local.data->>'task_date'
        and l.data->>'start_time'<v_local.data->>'end_time' and l.data->>'end_time'>v_local.data->>'start_time') then
        raise exception 'task schedule overlaps' using errcode='23514'; end if;
      if v_local.data->>'group_id' is not null and not exists(select 1 from public.local_records
        where owner_id=v_owner and kind='task_group' and source_id=v_local.data->>'group_id' and deleted_at is null) then
        raise exception 'invalid task group' using errcode='23514'; end if;
      v_local.data:=v_local.data||jsonb_build_object('completed_at',
        case when v_local.data->>'status'='completed' then coalesce(v_local.data->>'completed_at',now()::text) else null end);
    end if;
    update public.local_records set data=v_local.data where id=p_id returning to_jsonb(local_records) into v_result;
    if p_kind='account' and v_old_name is distinct from v_local.data->>'name' then
      update public.transactions t set
        account=case when account=v_old_name then v_local.data->>'name' else account end,
        from_account=case when from_account=v_old_name then v_local.data->>'name' else from_account end,
        to_account=case when to_account=v_old_name then v_local.data->>'name' else to_account end
      from public.raw_inputs r where r.id=t.raw_input_id and r.owner_id=v_owner
        and (t.account=v_old_name or t.from_account=v_old_name or t.to_account=v_old_name);
    end if;
  else raise exception 'invalid record kind' using errcode='22023'; end if;
  return v_result;
end;
$$;

create function public.read_attachment(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' then
    raise exception 'owner aal2 required' using errcode='42501'; end if;
  select jsonb_build_object('filename',filename,'mime',mime,'size_bytes',size_bytes,
    'base64',encode(content,'base64'),'sha256',sha256) into result from public.record_attachments
    where id=p_id and owner_id=auth.uid();
  if result is null then raise exception 'attachment not found' using errcode='P0002'; end if;
  return result;
end;
$$;
revoke all on function public.version_record_update(),public.audit_record_update(),public.edit_record(text,uuid,bigint,jsonb),
  public.read_attachment(uuid) from public,anon,authenticated;
grant execute on function public.edit_record(text,uuid,bigint,jsonb),public.read_attachment(uuid) to authenticated;
