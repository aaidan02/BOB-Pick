begin;
-- Reservations protect concurrent requests, while the public counter records successes only.
create table private.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default (now() at time zone 'Asia/Seoul')::date,
  state text not null default 'pending' check(state in ('pending','completed','failed')),
  charged boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '3 minutes'
);
alter table private.ai_requests enable row level security;
revoke all on private.ai_requests from public,anon,authenticated,service_role;
create index ai_requests_owner_created on private.ai_requests(user_id,created_at desc);
create index ai_requests_pending on private.ai_requests(user_id,expires_at) where state='pending';

create function public.begin_ai_request() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); used integer; pending integer; result uuid; unlimited boolean;
begin
  if actor is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  update private.ai_requests set state='failed' where user_id=actor and state='pending' and expires_at<=now();
  delete from private.ai_requests where user_id=actor and created_at<now()-interval '3 days';
  unlimited:=public.is_admin();
  if not unlimited and (select count(*) from private.ai_requests where user_id=actor and created_at>now()-interval '1 minute')>=12 then
    raise exception '요청이 많아요. 잠시 후 다시 시도해 주세요.';
  end if;
  select count(*) into pending from private.ai_requests where user_id=actor and state='pending' and expires_at>now();
  if not unlimited and pending>=3 then raise exception '진행 중인 추천이 있어요. 잠시 후 다시 시도해 주세요.';end if;
  select coalesce((select calls from private.ai_usage where user_id=actor and day=(now() at time zone 'Asia/Seoul')::date),0) into used;
  if not unlimited and used+pending>=20 then
    if used>=20 then raise exception '오늘 AI 추천 횟수를 모두 사용했습니다.';end if;
    raise exception '진행 중인 추천이 있어요. 완료 후 다시 시도해 주세요.';
  end if;
  insert into private.ai_requests(user_id) values(actor) returning id into result;
  return result;
end $$;

-- Only the trusted Edge Function can settle or compensate a reservation.
create function public.complete_ai_request(p_request_id uuid,p_success boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; attempt private.ai_requests; used integer; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
  select user_id into actor from private.ai_requests where id=p_request_id;
  if actor is null or p_success is null then return jsonb_build_object('completed',false);end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into attempt from private.ai_requests where id=p_request_id for update;
  if not found then return jsonb_build_object('completed',false);end if;
  if not p_success then
    if attempt.state='completed' and attempt.charged then
      update private.ai_usage set calls=greatest(0,calls-1) where user_id=actor and day=attempt.day;
    end if;
    update private.ai_requests set state='failed',charged=false where id=p_request_id;
    return jsonb_build_object('completed',false);
  end if;
  if attempt.state='completed' then return jsonb_build_object('completed',true,'charged',attempt.charged);end if;
  if attempt.state<>'pending' or attempt.expires_at<=now() then
    update private.ai_requests set state='failed' where id=p_request_id;
    return jsonb_build_object('completed',false);
  end if;
  if not exists(select 1 from private.admin_members where user_id=actor) then
    insert into private.ai_usage(user_id,day,calls) values(actor,today,1)
    on conflict(user_id,day) do update set calls=private.ai_usage.calls+1 where private.ai_usage.calls<20
    returning calls into used;
    if used is null then
      update private.ai_requests set state='failed' where id=p_request_id;
      return jsonb_build_object('completed',false,'quotaExceeded',true);
    end if;
  end if;
  update private.ai_requests set state='completed',day=today,charged=used is not null where id=p_request_id;
  return jsonb_build_object('completed',true,'charged',used is not null);
end $$;
revoke all on function public.begin_ai_request(),public.complete_ai_request(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.begin_ai_request() to authenticated;
grant execute on function public.complete_ai_request(uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
