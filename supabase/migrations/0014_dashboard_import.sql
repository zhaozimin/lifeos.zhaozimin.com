-- [INPUT]: 本人 AAL2、确认后的导入批次和报销对应关系。
-- [OUTPUT]: 可重投导入、原子核销及逐笔修改版本。
-- [POS]: 财务批量事务边界；预览和文件解析不在本函数执行。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
create function public.dashboard_import(p_batch uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=public.dashboard_owner(); v_item jsonb; v_index integer:=0; v_ok integer:=0; v_errors jsonb:='[]';
begin
 if p_batch is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 5000 then
  raise exception 'invalid import batch' using errcode='22023'; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
  begin
   perform public.dashboard_record('money','create',md5(p_batch::text||':'||v_index::text)::uuid,null,v_item);
   v_ok:=v_ok+1;
  exception when others then
   v_errors:=v_errors||jsonb_build_array(jsonb_build_object('index',v_index,'error','账目不符合金额、分类或账户规则'));
  end;
  v_index:=v_index+1;
 end loop;
 return jsonb_build_object('imported',v_ok,'failed',jsonb_array_length(v_errors),'errors',v_errors);
end;
$$;
create function public.dashboard_settle(p_income uuid,p_settle jsonb,p_unsettle jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=public.dashboard_owner(); v_item jsonb; v_row public.transactions%rowtype;
 v_income public.transactions%rowtype; v_settled integer:=0; v_unsettled integer:=0;
begin
 if jsonb_typeof(p_settle)<>'array' or jsonb_typeof(p_unsettle)<>'array' or
  jsonb_array_length(p_settle)+jsonb_array_length(p_unsettle)>5000 then
  raise exception 'invalid settlement' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_owner::text||':dashboard-records',0));
 select t.* into v_income from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
  where r.owner_id=v_owner and t.id=p_income and t.direction='income' and t.deleted_at is null for update of t;
 if not found then raise exception 'income not found' using errcode='P0002'; end if;
 for v_item in select value from jsonb_array_elements(p_settle) loop
  select t.* into v_row from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
   where r.owner_id=v_owner and t.id=(v_item->>'id')::uuid and t.direction='expense' and t.deleted_at is null for update of t;
  if not found then raise exception 'expense not found' using errcode='P0002'; end if;
  if (v_item->>'revision')::bigint is distinct from v_row.revision then raise exception 'settlement revision conflict' using errcode='40001'; end if;
  if v_row.currency<>v_income.currency or (nullif(v_row.details->>'reimbursed_by','') is not null and v_row.details->>'reimbursed_by'<>p_income::text) then
   raise exception 'expense already settled or currency mismatch' using errcode='23514'; end if;
  update public.transactions set details=details||jsonb_build_object('reimbursement_status','reimbursed','reimbursed_by',p_income)
   where id=v_row.id;
  v_settled:=v_settled+1;
 end loop;
 for v_item in select value from jsonb_array_elements(p_unsettle) loop
  select t.* into v_row from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
   where r.owner_id=v_owner and t.id=(v_item->>'id')::uuid and t.deleted_at is null for update of t;
  if not found or v_row.details->>'reimbursed_by' is distinct from p_income::text then raise exception 'settlement mismatch' using errcode='23514'; end if;
  if (v_item->>'revision')::bigint is distinct from v_row.revision then raise exception 'settlement revision conflict' using errcode='40001'; end if;
  update public.transactions set details=details||jsonb_build_object('reimbursement_status','draft','reimbursed_by',null) where id=v_row.id;
  v_unsettled:=v_unsettled+1;
 end loop;
 return jsonb_build_object('ok',true,'incomeId',p_income,'settled',v_settled,'unsettled',v_unsettled,'invalid','[]'::jsonb,'operations','[]'::jsonb);
end;
$$;
revoke all on function public.dashboard_import(uuid,jsonb),public.dashboard_settle(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dashboard_import(uuid,jsonb),public.dashboard_settle(uuid,jsonb,jsonb) to authenticated;
