-- [INPUT]: 不可变原话、有效租约与既有受限账目执行器。
-- [OUTPUT]: 事务保存自然回答，服务端读取同归属同来源的最近八轮。
-- [POS]: 对话补层；回答不能绕过账目校验，也不能覆盖已提交结果。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

alter function public.apply_steward(uuid,uuid,jsonb,jsonb) rename to apply_steward_records;

create function public.apply_steward(p_input_id uuid,p_lease_token uuid,p_result jsonb,p_expected_ongoing jsonb default null)
returns public.raw_inputs language plpgsql set search_path='' as $$
declare r public.raw_inputs%rowtype; answer text;
begin
  select * into strict r from public.raw_inputs where id=p_input_id for update;
  if r.revoked_at is not null or r.status in ('parsed','ignored') then return r; end if;
  if r.lease_token is null or r.lease_token is distinct from p_lease_token then
    raise exception 'input lease changed' using errcode='55000'; end if;
  if jsonb_typeof(p_result) is distinct from 'object' then
    raise exception 'invalid dialogue plan' using errcode='22023'; end if;
  if p_result?'answer' and p_result->'answer'<>'null'::jsonb then
    if jsonb_typeof(p_result->'answer') is distinct from 'string' then
      raise exception 'invalid answer type' using errcode='22023'; end if;
    answer:=btrim(p_result->>'answer');
    if length(answer) not between 1 and 3000 or nullif(p_result->>'clarify','') is not null then
      raise exception 'invalid answer or clarification conflict' using errcode='22023'; end if;
  end if;
  select * into r from public.apply_steward_records(p_input_id,p_lease_token,p_result-'answer',p_expected_ongoing);
  -- 账目拒绝并要求补充时，不保留模型预先编写的成功或建议。
  if answer is not null and r.status='parsed' then
    update public.raw_inputs set parse_result=r.parse_result||jsonb_build_object('answer',answer)
      where id=r.id returning * into r;
  end if;
  return r;
end;
$$;

create function public.get_recent_dialogue(p_input_id uuid) returns jsonb
language sql stable set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('text',left(x.text,1000),'reply',left(x.reply,1000),
  'received_at',x.received_at) order by x.received_at,x.created_at,x.id),'[]'::jsonb)
from (
  select r.id,r.text,coalesce(nullif(r.parse_result->>'answer',''),r.receipt_text) reply,r.received_at,r.created_at
  from public.raw_inputs anchor join public.raw_inputs r
    on r.owner_id=anchor.owner_id and r.source=anchor.source
  where anchor.id=p_input_id and r.revoked_at is null and r.status='parsed'
    and (r.received_at,r.created_at,r.id)<(anchor.received_at,anchor.created_at,anchor.id)
  order by r.received_at desc,r.created_at desc,r.id desc limit 8
) x;
$$;

revoke all on function public.apply_steward(uuid,uuid,jsonb,jsonb),public.get_recent_dialogue(uuid)
  from public,anon,authenticated;
grant execute on function public.apply_steward(uuid,uuid,jsonb,jsonb),public.get_recent_dialogue(uuid) to service_role;
