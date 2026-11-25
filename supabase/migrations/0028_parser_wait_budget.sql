-- [INPUT]: 串行原话领取、模型等待预算和既有故障回执。
-- [OUTPUT]: 六分钟解析租约；重试耗尽回执可在重启后恢复。
-- [POS]: 慢响应恢复边界；延长既有租约，保留原话和回执修订。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

alter function public.claim_next_input(uuid,boolean) rename to claim_next_input_before_wait_budget;
create function public.claim_next_input(p_owner_id uuid,p_records_enabled boolean)
returns setof public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype;
begin
  -- 最终失败只恢复回执，不增加尝试次数或重新调用模型。
  select * into r from public.raw_inputs where owner_id=p_owner_id and revoked_at is null
    and status='failed' and attempts>=5 and receipt_text is null
    and (lease_until is null or lease_until<now())
    order by received_at,created_at for update skip locked limit 1;
  if r.id is not null then
    update public.raw_inputs set lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes'
      where id=r.id returning * into r;
    return next r;
    return;
  end if;
  select * into r from public.claim_next_input_before_wait_budget(p_owner_id,p_records_enabled);
  if r.id is null then return; end if;
  -- 四分钟模型总预算外预留上下文读取、事务提交与进程回收时间。
  if r.status in ('pending','failed') and r.input_kind='record' then
    update public.raw_inputs set lease_until=now()+interval '6 minutes'
      where id=r.id and lease_token=r.lease_token returning * into r;
  end if;
  return next r;
end;
$$;

create or replace function public.fail_input(p_input_id uuid,p_lease_token uuid,p_error_code text)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; notify boolean;
begin
  select * into strict r from public.raw_inputs where id=p_input_id for update;
  if r.revoked_at is not null or r.status in ('parsed','ignored') then return r; end if;
  if r.lease_token is distinct from p_lease_token or r.lease_token is null then return r; end if;
  notify:=r.error_code is null or r.attempts>=5;
  update public.raw_inputs set status='failed',error_code=left(p_error_code,80),
    next_attempt_at=now()+interval '10 minutes',lease_token=null,lease_until=null,
    receipt_text=case when notify then null else receipt_text end,
    receipt_revision=receipt_revision+case when notify then 1 else 0 end,
    delivered_at=case when notify then null else delivered_at end,
    reply_attempts=case when notify then 0 else reply_attempts end
    where id=r.id returning * into r;
  return r;
end;
$$;

revoke all on function public.claim_next_input(uuid,boolean),public.claim_next_input_before_wait_budget(uuid,boolean),
  public.fail_input(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_next_input(uuid,boolean),public.claim_next_input_before_wait_budget(uuid,boolean),
  public.fail_input(uuid,uuid,text) to service_role;
