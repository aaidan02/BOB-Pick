begin;
-- Read only the caller's daily counter; the private table remains inaccessible.
create function public.ai_quota_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); today date:=(now() at time zone 'Asia/Seoul')::date; used integer; unlimited boolean;
begin
  if actor is null then
    raise exception using errcode='42501',message='로그인 후 AI 추천 횟수를 확인할 수 있습니다.';
  end if;
  select a.calls into used from private.ai_usage a where a.user_id=actor and a.day=today;
  used:=coalesce(used,0);
  unlimited:=public.is_admin();
  return jsonb_build_object('day',today,'limit',case when unlimited then null else 20 end,
    'unlimited',unlimited,'used',used,'remaining',case when unlimited then null else greatest(0,20-used) end,
    'reset_at',(today+1)::timestamp at time zone 'Asia/Seoul');
end $$;
revoke all on function public.ai_quota_status() from public,anon,authenticated;
grant execute on function public.ai_quota_status() to authenticated;

-- Live DB membership governs exemptions; a revoked administrator is limited again.
create or replace function public.consume_ai_quota() returns void
language plpgsql security definer set search_path='' as $$
declare used integer;
begin
  if auth.uid() is null then raise exception 'AI 추천은 로그인 후 사용할 수 있습니다.';end if;
  if public.is_admin() then return;end if;
  insert into private.ai_usage(user_id,day,calls) values(auth.uid(),(now() at time zone 'Asia/Seoul')::date,1)
  on conflict(user_id,day) do update set calls=private.ai_usage.calls+1 where private.ai_usage.calls<20
  returning calls into used;
  if used is null then raise exception '오늘 AI 추천 횟수를 모두 사용했습니다.';end if;
end $$;
revoke all on function public.consume_ai_quota() from public,anon,authenticated;
grant execute on function public.consume_ai_quota() to authenticated;
notify pgrst,'reload schema';
commit;
