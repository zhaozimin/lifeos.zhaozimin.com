-- [INPUT]: 固定站点归属、流水日期和收入支出方向。
-- [OUTPUT]: 不含金额、账户、商户或原始标题的财务结构投影。
-- [POS]: 访客完整财务页的数据边界，不授予底表权限。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
create function public.visitor_finance() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid;result jsonb;
begin
 select owner_id into owner from public.visitor_settings where id=1 and enabled;
 if owner is null then raise exception 'visitor disabled' using errcode='42501';end if;
 select coalesce(jsonb_agg(x.row order by x.event_day desc),'[]') into result from (
  select (t.occurred_at at time zone 'Asia/Shanghai')::date event_day,
   jsonb_build_object('id',md5(t.id::text),'day',(t.occurred_at at time zone 'Asia/Shanghai')::date,
    'kind',t.direction,'category',case
     when t.direction='income' then '收入'
     when t.direction='transfer' then '转账'
     when c.name~'(餐|饮|吃)' then '餐饮'
     when c.name~'(交通|车|出行)' then '交通'
     when c.name~'(软件|订阅|工具|数码)' then '软件与工具'
     when c.name~'(购|日用|生活)' then '生活消费'
     when c.name~'(学|书|教育)' then '学习'
     when c.name~'(健康|医疗|运动|健身)' then '健康'
     else '其他支出' end) row
  from public.transactions t join public.raw_inputs r on r.id=t.raw_input_id
  left join public.categories c on c.id=t.category_id
  where r.owner_id=owner and t.deleted_at is null
  order by t.occurred_at desc limit 5000) x;
 return result;
end;
$$;
revoke all on function public.visitor_finance() from public;
grant execute on function public.visitor_finance() to anon,authenticated,service_role;
