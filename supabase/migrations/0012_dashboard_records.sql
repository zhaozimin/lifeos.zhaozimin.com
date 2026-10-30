-- [INPUT]: 本人 AAL2、原版页面字段与现有版本编辑契约。
-- [OUTPUT]: 补录、软删除、财务扩展字段与私有附件写入。
-- [POS]: 原版界面的事务边界；不授予底表写权限。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

alter table public.categories add column metadata jsonb not null default '{}';
alter table public.time_entries add column deletion_reason text;
alter table public.record_attachments add column deleted_at timestamptz;
create table public.dashboard_preferences (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 domain text not null check(domain in ('time','finance')),
 data jsonb not null default '{}' check(jsonb_typeof(data)='object'),
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 unique(owner_id,domain)
);
alter table public.dashboard_preferences enable row level security;
revoke all on public.dashboard_preferences from public,anon,authenticated;
grant select on public.dashboard_preferences to authenticated;
grant all on public.dashboard_preferences to service_role;
create policy owner_read on public.dashboard_preferences for select to authenticated using
 (owner_id=(select auth.uid()) and (select auth.jwt()->>'aal')='aal2');
grant select(deleted_at) on public.record_attachments to authenticated;

insert into public.dashboard_preferences(owner_id,domain,data)
select distinct owner_id,domain,(payload->>'payload_json')::jsonb
from public.local_archive where (domain='time' and table_name='settings') or
 (domain='finance' and table_name='ledger_settings')
on conflict(owner_id,domain) do nothing;
-- 原版色彩和分类属性只补元数据，分类编号与账目归属保持不变。
update public.categories c set metadata=(a.payload->>'payload_json')::jsonb
from public.local_archive a where a.table_name='categories' and a.owner_id=c.owner_id
 and ((a.domain='time' and c.kind='time') or (a.domain='finance' and c.kind='money'))
 and ((a.payload->>'payload_json')::jsonb->>'name')=c.name;

create function public.dashboard_owner() returns uuid language plpgsql stable set search_path='' as $$
begin
 if auth.uid() is null or (auth.jwt()->>'aal') is distinct from 'aal2' then
  raise exception 'owner aal2 required' using errcode='42501'; end if;
 return auth.uid();
end;
$$;
create function public.dashboard_record(p_kind text,p_action text,p_id uuid,p_revision bigint,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid:=public.dashboard_owner(); v_raw uuid; v_id uuid; v_result jsonb; v_details jsonb;
 v_base jsonb:=p_data-'details'; v_existing jsonb; v_allowed text[];
begin
 if p_kind not in ('time','money') or p_action not in ('create','update','delete','restore') or
  jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>65536 then
  raise exception 'invalid record operation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':dashboard-records',0));
 if p_action in ('update','delete','restore') then
  if p_kind='time' then
   select to_jsonb(t) into v_existing from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
    where t.id=p_id and r.owner_id=v_owner for update of t;
  else
   select to_jsonb(t) into v_existing from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
    where t.id=p_id and r.owner_id=v_owner for update of t;
  end if;
  if v_existing is null then raise exception 'record not found' using errcode='P0002'; end if;
  if p_revision is null or (v_existing->>'revision')::bigint<>p_revision then
   raise exception 'record revision conflict' using errcode='40001'; end if;
 end if;
 if p_action='update' then
  if p_data?'details' then
   if p_kind<>'money' or jsonb_typeof(p_data->'details') is distinct from 'object' or
    exists(select 1 from jsonb_object_keys(p_data->'details') k where not(k=any(array[
      'reimbursement_status','reimbursed_by','source','source_name','counterparty_id','invoice_issued',
      'invoice_attachment_id','tax_category','amount_in_base_currency','deletion_reason']))) then
    raise exception 'invalid finance details' using errcode='22023'; end if;
   v_details:=coalesce(v_existing->'details','{}')||(p_data->'details');
   if coalesce(v_details->>'reimbursement_status','notApplicable') not in
     ('draft','submitted','reimbursed','rejected','notApplicable') then
    raise exception 'invalid reimbursement status' using errcode='22023'; end if;
  end if;
  if v_base<>'{}' then v_result:=public.edit_record(p_kind,p_id,p_revision,v_base); else v_result:=v_existing; end if;
  if v_details is not null and v_details is distinct from v_existing->'details' then
   update public.transactions set details=v_details where id=p_id returning to_jsonb(transactions) into v_result;
  end if;
  return v_result;
 elsif p_action in ('delete','restore') then
  if exists(select 1 from jsonb_object_keys(p_data) k where k<>'reason') then
   raise exception 'invalid deletion field' using errcode='22023'; end if;
  if p_kind='time' then
   update public.time_entries set deleted_at=case when p_action='delete' then now() else null end,
    deletion_reason=case when p_action='delete' then left(p_data->>'reason',2000) else null end
    where id=p_id returning to_jsonb(time_entries) into v_result;
  else
   update public.transactions set deleted_at=case when p_action='delete' then now() else null end,
    details=details||jsonb_build_object('deletion_reason',case when p_action='delete' then left(p_data->>'reason',2000) else null end)
    where id=p_id returning to_jsonb(transactions) into v_result;
  end if;
  return v_result;
 end if;
 v_allowed:=case p_kind when 'time' then array['activity','start_at','end_at','category_id','project','tags','note','deduction_minutes','deduction_note']
  else array['title','occurred_at','direction','amount_cents','currency','category_id','account','from_account','to_account','merchant','project','tags','note','details'] end;
 if exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(v_allowed))) then
  raise exception 'invalid record field' using errcode='22023'; end if;
 -- 同一补录请求重投只返回原记录，不重复插入。
 select id into v_raw from public.raw_inputs where owner_id=v_owner and source='web' and external_id=p_id::text;
 if v_raw is not null then
  if p_kind='time' then select to_jsonb(t) into v_result from public.time_entries t where raw_input_id=v_raw;
  else select to_jsonb(t) into v_result from public.transactions t where raw_input_id=v_raw; end if;
  return v_result;
 end if;
 insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,status,delivered_at)
 values(v_owner,'web',p_id::text,p_data::text,now(),jsonb_build_object('manual',true),'import','parsed',now()) returning id into v_raw;
 if p_kind='time' then
  if exists(select 1 from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
   where r.owner_id=v_owner and t.deleted_at is null and t.end_at is not null
   and t.start_at<coalesce((p_data->>'end_at')::timestamptz,'infinity')
   and t.end_at>(p_data->>'start_at')::timestamptz) then
   raise exception 'time overlaps existing record' using errcode='23514'; end if;
  -- 新时段只关闭本人此前未结束的时段，版本触发器保留修改。
  update public.time_entries t set end_at=(p_data->>'start_at')::timestamptz
   from public.raw_inputs r where r.id=t.raw_input_id and r.owner_id=v_owner
   and t.deleted_at is null and t.end_at is null and t.start_at<(p_data->>'start_at')::timestamptz;
  insert into public.time_entries(raw_input_id,item_index,start_at,end_at,category_id,activity,project,tags,note,deduction_minutes,deduction_note)
  values(v_raw,0,(p_data->>'start_at')::timestamptz,(p_data->>'end_at')::timestamptz,(p_data->>'category_id')::smallint,
   p_data->>'activity',p_data->>'project',array(select jsonb_array_elements_text(coalesce(p_data->'tags','[]'))),p_data->>'note',
   coalesce((p_data->>'deduction_minutes')::integer,0),p_data->>'deduction_note') returning id,to_jsonb(time_entries) into v_id,v_result;
 else
  if jsonb_typeof(coalesce(p_data->'details','{}'))<>'object' then raise exception 'invalid details' using errcode='22023'; end if;
  insert into public.transactions(raw_input_id,item_index,occurred_at,direction,amount_cents,currency,category_id,title,account,from_account,to_account,merchant,project,tags,note,details)
  values(v_raw,0,(p_data->>'occurred_at')::timestamptz,p_data->>'direction',(p_data->>'amount_cents')::bigint,coalesce(p_data->>'currency','CNY'),
   (p_data->>'category_id')::smallint,p_data->>'title',p_data->>'account',p_data->>'from_account',p_data->>'to_account',p_data->>'merchant',p_data->>'project',
   array(select jsonb_array_elements_text(coalesce(p_data->'tags','[]'))),p_data->>'note',coalesce(p_data->'details','{}')) returning id,to_jsonb(transactions) into v_id,v_result;
 end if;
 insert into public.record_changes(owner_id,kind,record_id,revision,before_data,after_data,actor)
 values(v_owner,p_kind,v_id,1,'{}',v_result,'web');
 return v_result;
end;
$$;

create or replace function public.read_attachment(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.dashboard_owner();
 select jsonb_build_object('filename',filename,'mime',mime,'size_bytes',size_bytes,'base64',encode(content,'base64'),'sha256',sha256)
 into result from public.record_attachments where id=p_id and owner_id=auth.uid() and deleted_at is null;
 if result is null then raise exception 'attachment not found' using errcode='P0002'; end if;
 return result;
end;
$$;
create function public.protect_attachment_content() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-'deleted_at') is distinct from (to_jsonb(old)-'deleted_at') then
  raise exception 'attachment bytes immutable' using errcode='55000'; end if;
 return new;
end;
$$;
drop trigger attachment_immutable on public.record_attachments;
create trigger attachment_immutable before update or delete on public.record_attachments
 for each row execute function public.protect_attachment_content();
create function public.dashboard_attachment(p_action text,p_id uuid,p_transaction uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=public.dashboard_owner(); v_bytes bytea; v_result jsonb;
begin
 if p_action='delete' then
  update public.record_attachments set deleted_at=now() where id=p_id and owner_id=v_owner returning to_jsonb(record_attachments)-'content' into v_result;
 elsif p_action='create' then
  if not exists(select 1 from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id where t.id=p_transaction and r.owner_id=v_owner and t.deleted_at is null) then
   raise exception 'transaction not found' using errcode='P0002'; end if;
  v_bytes:=decode(p_data->>'data','base64');
  if octet_length(v_bytes)>10485760 or length(p_data->>'filename')>500 then raise exception 'attachment too large' using errcode='22023'; end if;
  insert into public.record_attachments(id,owner_id,transaction_id,filename,mime,size_bytes,sha256,content)
  values(p_id,v_owner,p_transaction,p_data->>'filename',p_data->>'mime',octet_length(v_bytes),encode(sha256(v_bytes),'hex'),v_bytes)
  returning to_jsonb(record_attachments)-'content' into v_result;
 else raise exception 'invalid attachment operation' using errcode='22023'; end if;
 if v_result is null then raise exception 'attachment not found' using errcode='P0002'; end if;
 return v_result;
end;
$$;
revoke all on function public.dashboard_owner(),public.dashboard_record(text,text,uuid,bigint,jsonb),
 public.dashboard_attachment(text,uuid,uuid,jsonb),public.protect_attachment_content() from public,anon,authenticated;
grant execute on function public.dashboard_record(text,text,uuid,bigint,jsonb),public.dashboard_attachment(text,uuid,uuid,jsonb) to authenticated;
