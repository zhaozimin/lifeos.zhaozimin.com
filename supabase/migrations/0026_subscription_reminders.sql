-- [INPUT]: VPS订阅快照、当前微信绑定及既有回执队列。
-- [OUTPUT]: 每笔续费的七天提醒幂等入队与当日投递期限。
-- [POS]: 服务身份专用通知事务；浏览器提醒回执不参与去重。
-- [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

alter table public.raw_inputs add column reply_expires_at timestamptz;

create function public.enqueue_subscription_reminder(p_owner_id uuid,p_subscription_id text,
  p_renewal_on date,p_text text,p_wechat_account_id text,p_wechat_user_id text)
returns jsonb language plpgsql set search_path='' as $$
declare
  v_now timestamptz:=now();
  v_day date:=(v_now at time zone 'Asia/Shanghai')::date;
  v_time time:=(v_now at time zone 'Asia/Shanghai')::time;
  v_key text; v_context uuid; v_id uuid; v_existing public.raw_inputs;
begin
  if p_owner_id is null or p_renewal_on is null
    or coalesce(length(btrim(p_subscription_id)),0) not between 1 and 100
    or coalesce(length(btrim(p_text)),0) not between 1 and 2000
    or coalesce(length(p_wechat_account_id),0)=0 or coalesce(length(p_wechat_user_id),0)=0 then
    raise exception 'subscription reminder parameters required' using errcode='22023';
  end if;
  if p_renewal_on<>v_day+7 then
    return jsonb_build_object('queued',false,'reason','not_due');
  end if;
  if v_time<time '09:00' or v_time>=time '22:00' then
    return jsonb_build_object('queued',false,'reason','outside_window');
  end if;
  v_key:='subscription:'||p_subscription_id||':'||p_renewal_on||':7';
  select * into v_existing from public.raw_inputs
    where owner_id=p_owner_id and source='system' and external_id=v_key for update;
  if v_existing.delivered_at is not null or v_existing.revoked_at is not null then
    return jsonb_build_object('queued',false,'reason','already_queued');
  end if;
  -- 只复用当前机器人与本人上下文；换绑后不得借用旧机器人的会话。
  select id into v_context from public.raw_inputs
    where owner_id=p_owner_id and source='wechat' and received_at<=v_now
      and left(external_id,length(p_wechat_account_id)+1)=p_wechat_account_id||':'
      and payload->>'from_user_id'=p_wechat_user_id
      and jsonb_typeof(payload->'context_token')='string' and length(payload->>'context_token')>0
    order by received_at desc,created_at desc,id desc limit 1;
  if v_context is null then
    return jsonb_build_object('queued',false,'reason','no_context');
  end if;
  if v_existing.id is not null then
    if v_existing.reply_attempts>=5 or v_existing.reply_input_id is distinct from v_context then
      update public.raw_inputs set reply_input_id=v_context,reply_attempts=0,reply_next_at=v_now
        where id=v_existing.id;
      return jsonb_build_object('queued',true,'reason','retry_queued');
    end if;
    return jsonb_build_object('queued',false,'reason','already_queued');
  end if;
  insert into public.raw_inputs(owner_id,source,external_id,text,received_at,payload,input_kind,
    status,parse_result,receipt_text,reply_input_id,receipt_revision,reply_expires_at)
  values(p_owner_id,'system',v_key,'订阅扣款提醒',v_now,
    jsonb_build_object('kind','subscription_reminder','subscription_id',p_subscription_id,'renewal_on',p_renewal_on),
    'command','parsed',jsonb_build_object('command','subscription_reminder'),p_text,v_context,1,
    (v_day+1)::timestamp at time zone 'Asia/Shanghai')
  on conflict(owner_id,source,external_id) do nothing returning id into v_id;
  return jsonb_build_object('queued',v_id is not null,'reason',case when v_id is null then 'already_queued' else 'queued' end);
end;
$$;

revoke all on function public.enqueue_subscription_reminder(uuid,text,date,text,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_subscription_reminder(uuid,text,date,text,text,text) to service_role;
