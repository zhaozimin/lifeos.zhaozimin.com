-- [INPUT]: 原版时间调节、当前余额修改与报销删除语义。
-- [OUTPUT]: 未来/重叠门禁、余额差额记录和核销删除级联。
-- [POS]: 原版操作的不变量；旧来源与不可变档案保持原样。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
create function public.validate_manual_time() returns trigger language plpgsql set search_path='' as $$
declare v_owner uuid;
begin
 if auth.uid() is null or current_setting('role',true) is distinct from 'authenticated' or new.deleted_at is not null then return new; end if;
 if tg_op='UPDATE' and (new.start_at,new.end_at) is not distinct from (old.start_at,old.end_at) then return new; end if;
 v_owner:=public.dashboard_owner();
 if new.start_at>now() or new.end_at>now() then raise exception 'manual time cannot be future' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':dashboard-records',0));
 if exists(select 1 from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
  where r.owner_id=v_owner and t.id<>new.id and t.deleted_at is null
  and t.start_at<coalesce(new.end_at,'infinity') and coalesce(t.end_at,'infinity')>new.start_at) then
  raise exception 'manual time overlaps existing record' using errcode='23514'; end if;
 return new;
end;
$$;
create trigger manual_time_bounds before insert or update on public.time_entries
 for each row execute function public.validate_manual_time();

alter function public.dashboard_configuration(text,bigint,jsonb) rename to dashboard_configuration_base;
revoke all on function public.dashboard_configuration_base(text,bigint,jsonb) from public,anon,authenticated;
create function public.dashboard_configuration(p_domain text,p_revision bigint,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid:=public.dashboard_owner(); v_result jsonb; v_item jsonb; v_account public.local_records%rowtype;
 v_movement numeric; v_current numeric; v_delta bigint; v_sign integer; v_category smallint;
begin
 v_result:=public.dashboard_configuration_base(p_domain,p_revision,p_data);
 if p_domain='finance' then
  for v_item in select value from jsonb_array_elements(p_data->'accounts') loop
   if not(v_item?'currentBalance') or coalesce(v_item->>'deletedAt','')<>'' then continue; end if;
   if jsonb_typeof(v_item->'currentBalance')<>'number' or abs((v_item->>'currentBalance')::numeric)>90071992547409.91 then
    raise exception 'invalid current balance' using errcode='22023'; end if;
   select * into v_account from public.local_records where owner_id=v_owner and kind='account' and source_id=v_item->>'id';
   select coalesce(sum(case
     when t.direction='income' and t.account=v_account.data->>'name' then t.amount_cents
     when t.direction='expense' and t.account=v_account.data->>'name' then -t.amount_cents
     when t.direction='transfer' then (case when t.to_account=v_account.data->>'name' then t.amount_cents else 0 end)-
       (case when t.from_account=v_account.data->>'name' then t.amount_cents else 0 end) else 0 end),0)
    into v_movement from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
    where r.owner_id=v_owner and t.deleted_at is null and t.currency=coalesce(v_account.data->>'currency','CNY');
   v_sign:=case when v_account.data->>'classification'='liability' then -1 else 1 end;
   v_current:=round((v_account.data->>'openingBalance')::numeric*100)+v_movement*v_sign;
   v_delta:=round((v_item->>'currentBalance')::numeric*100)-v_current;
   if v_delta<>0 then
    select id into v_category from public.categories where owner_id=v_owner and kind='money' and direction is null order by (code='uncategorized') desc,id limit 1;
    perform public.dashboard_record('money','create',gen_random_uuid(),null,jsonb_build_object(
      'title','余额调整','occurred_at',now(),'direction',case when v_delta*v_sign>0 then 'income' else 'expense' end,
      'amount_cents',abs(v_delta),'currency',coalesce(v_account.data->>'currency','CNY'),'category_id',v_category,
      'account',v_account.data->>'name','merchant','余额调整','tags',jsonb_build_array('余额调整','黑洞资金'),
      'note','在账户设置确认当前余额；差额自动记账','details',jsonb_build_object('source','adjustment','source_name','余额调整','reimbursement_status','notApplicable')));
   end if;
  end loop;
 end if;
 return v_result;
end;
$$;
create function public.cascade_reimbursement_delete() returns trigger language plpgsql set search_path='' as $$
begin
 if old.deleted_at is null and new.deleted_at is not null and new.direction='income' then
  update public.transactions t set details=t.details||jsonb_build_object('reimbursement_status','draft','reimbursed_by',null)
   from public.raw_inputs expense,public.raw_inputs income where expense.id=t.raw_input_id and income.id=new.raw_input_id
   and expense.owner_id=income.owner_id and t.details->>'reimbursed_by'=new.id::text and t.deleted_at is null;
 end if;
 return new;
end;
$$;
create trigger money_reimbursement_delete after update of deleted_at on public.transactions
 for each row execute function public.cascade_reimbursement_delete();
revoke all on function public.validate_manual_time(),public.dashboard_configuration(text,bigint,jsonb),
 public.cascade_reimbursement_delete() from public,anon,authenticated;
grant execute on function public.dashboard_configuration(text,bigint,jsonb) to authenticated;
