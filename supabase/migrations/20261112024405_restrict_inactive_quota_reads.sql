begin;
create or replace function public.ai_quota_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); today date:=(now() at time zone 'Asia/Seoul')::date; used integer; unlimited boolean;
begin
  if actor is null then
    raise exception using errcode='42501',message='로그인 후 AI 추천 횟수를 확인할 수 있습니다.';
  end if;
  if not public.is_active_member() then raise exception using errcode='42501',message='로그인 상태를 확인해 주세요.';end if;
  select a.calls into used from private.ai_usage a where a.user_id=actor and a.day=today;
  used:=coalesce(used,0);
  unlimited:=public.is_admin();
  return jsonb_build_object('day',today,'limit',case when unlimited then null else 20 end,
    'unlimited',unlimited,'used',used,'remaining',case when unlimited then null else greatest(0,20-used) end,
    'reset_at',(today+1)::timestamp at time zone 'Asia/Seoul');
end $$;
notify pgrst,'reload schema';
commit;
