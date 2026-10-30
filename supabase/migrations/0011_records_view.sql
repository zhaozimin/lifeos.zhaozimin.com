-- [INPUT]: 本人账目、辅助记录与原话来源。
-- [OUTPUT]: 可分页检索的历史记录视图，不含渠道上下文或附件内容。
-- [POS]: 网页历史入口；security_invoker 继承底表的本人 AAL2 限制。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
create view public.v_records with(security_invoker=true) as
select t.id,'time'::text as kind,t.start_at as event_at,t.activity as title,
  concat_ws(' ',t.activity,t.note,t.project) as search_text,r.source,
  t.deleted_at,to_jsonb(t) as data
from public.time_entries t join public.raw_inputs r on r.id=t.raw_input_id
union all
select t.id,'money',t.occurred_at,coalesce(nullif(t.title,''),nullif(t.merchant,''),nullif(t.note,''),'未命名流水'),
  concat_ws(' ',t.title,t.merchant,t.note,t.account,t.from_account,t.to_account,t.project),r.source,
  t.deleted_at,to_jsonb(t)
from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
union all
select l.id,l.kind,coalesce((l.data->>'task_date')::date::timestamp at time zone 'Asia/Shanghai',l.created_at),
  coalesce(l.data->>'title',l.data->>'name','未命名记录'),
  concat_ws(' ',l.data->>'title',l.data->>'name',l.data->>'note'),'local-lifeos',
  l.deleted_at,to_jsonb(l)
from public.local_records l;
revoke all on public.v_records from public,anon,authenticated;
grant select on public.v_records to authenticated,service_role;
