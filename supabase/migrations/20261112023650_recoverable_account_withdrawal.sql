begin;
create table private.account_lifecycle (
  user_id uuid primary key references auth.users(id) on delete cascade,
  withdrawn_at timestamptz,purge_at timestamptz,restored_at timestamptz,
  check((withdrawn_at is null)=(purge_at is null)),
  check(purge_at is null or purge_at=withdrawn_at+interval '7 days')
);
create index ai_usage_retention_day on private.ai_usage(day);
create index ai_requests_retention_created on private.ai_requests(created_at);
create index account_lifecycle_due on private.account_lifecycle(purge_at) where purge_at is not null;
alter table private.account_lifecycle enable row level security;
revoke all on private.account_lifecycle from public,anon,authenticated,service_role;

create function public.is_active_member() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); state private.account_lifecycle; session_key uuid;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null) then return false;end if;
  select * into state from private.account_lifecycle where user_id=actor;
  if not found then return true;end if;
  if state.withdrawn_at is not null then return false;end if;
  -- After a restoration, even an unexpired JWT must belong to a live session.
  begin session_key:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return false;end;
  return exists(select 1 from auth.sessions where id=session_key and user_id=actor and (not_after is null or not_after>now()));
end $$;
revoke all on function public.is_active_member() from public,anon,authenticated;
grant execute on function public.is_active_member() to authenticated;

create function public.account_content_visible(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from private.account_lifecycle where user_id=p_user_id and withdrawn_at is not null)
$$;
revoke all on function public.account_content_visible(uuid) from public,anon,authenticated;
grant execute on function public.account_content_visible(uuid) to anon,authenticated;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_active_member() and exists(select 1 from private.admin_members where user_id=auth.uid())
$$;

-- Existing ownership rules still apply. These restrictive rules also stop old
-- tokens from reading or writing as a withdrawn account.
do $$declare target text;begin
  foreach target in array array['profiles','favorites','posts','requests','request_reviews','change_logs','food_preferences','recommendation_history','support_tickets'] loop
    execute format('create policy active_account_access on public.%I as restrictive for all to authenticated using ((select public.is_active_member())) with check ((select public.is_active_member()))',target);
  end loop;
end $$;
alter policy profiles_read on public.profiles using(public.account_content_visible(id));
alter policy posts_read on public.posts using(public.account_content_visible(user_id));

create function private.require_active_actor() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and not public.is_active_member() then raise exception using errcode='42501',message='탈퇴한 계정입니다. 복원 후 이용해 주세요.';end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.require_active_actor() from public,anon,authenticated,service_role;
do $$declare target text;begin
  foreach target in array array['profiles','favorites','posts','requests','request_reviews','change_logs','promotions','food_preferences','recommendation_history','support_tickets'] loop
    execute format('create trigger require_active_actor before insert or update or delete on public.%I for each row execute function private.require_active_actor()',target);
  end loop;
  foreach target in array array['admin_members','ai_usage','ai_requests'] loop
    execute format('create trigger require_active_actor before insert or update or delete on private.%I for each row execute function private.require_active_actor()',target);
  end loop;
end $$;

create function public.account_recovery_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); state private.account_lifecycle;
begin
  if actor is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  if not exists(select 1 from auth.users where id=actor and deleted_at is null) then return jsonb_build_object('missing',true,'pending',false);end if;
  select * into state from private.account_lifecycle where user_id=actor;
  return jsonb_build_object('missing',false,'pending',state.withdrawn_at is not null,'canRestore',state.withdrawn_at is not null and state.purge_at>now(),
    'requestedAt',state.withdrawn_at,'restoreUntil',state.purge_at,'active',public.is_active_member());
end $$;
revoke all on function public.account_recovery_status() from public,anon,authenticated;
grant execute on function public.account_recovery_status() to authenticated;

create function public.request_account_withdrawal(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state private.account_lifecycle; moment timestamptz:=clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':lifecycle',0));
  lock table private.admin_members in share row exclusive mode;
  if not exists(select 1 from auth.users where id=p_user_id and deleted_at is null) then raise exception '계정을 찾지 못했습니다.';end if;
  if exists(select 1 from private.admin_members where user_id=p_user_id and is_master) then raise exception '마스터 계정은 탈퇴할 수 없습니다.';end if;
  if exists(select 1 from private.admin_members where user_id=p_user_id) and (select count(*) from private.admin_members)<=1 then raise exception '마지막 관리자는 탈퇴할 수 없습니다.';end if;
  select * into state from private.account_lifecycle where user_id=p_user_id for update;
  if state.withdrawn_at is not null then return jsonb_build_object('withdrawn',true,'restoreUntil',state.purge_at);end if;
  insert into private.account_lifecycle(user_id,withdrawn_at,purge_at) values(p_user_id,moment,moment+interval '7 days')
  on conflict(user_id) do update set withdrawn_at=excluded.withdrawn_at,purge_at=excluded.purge_at,restored_at=null;
  return jsonb_build_object('withdrawn',true,'restoreUntil',moment+interval '7 days');
end $$;
create function public.restore_withdrawn_account(p_user_id uuid,p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state private.account_lifecycle;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':lifecycle',0));
  select * into state from private.account_lifecycle where user_id=p_user_id for update;
  if state.withdrawn_at is null then raise exception '복원할 탈퇴 내역이 없습니다.';end if;
  if state.purge_at<=clock_timestamp() then raise exception '복원 가능한 7일이 지났습니다.';end if;
  if not exists(select 1 from auth.sessions where id=p_session_id and user_id=p_user_id and (not_after is null or not_after>now())) then raise exception '본인 확인 후 다시 시도해 주세요.';end if;
  update private.account_lifecycle set withdrawn_at=null,purge_at=null,restored_at=clock_timestamp() where user_id=p_user_id;
  return jsonb_build_object('restored',true);
end $$;
revoke all on function public.request_account_withdrawal(uuid),public.restore_withdrawn_account(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_account_withdrawal(uuid),public.restore_withdrawn_account(uuid,uuid) to service_role;

-- Keep anonymous catalog processing records, without the former member's text
-- or arbitrary payload. Pending requests cannot be approved after erasure.
create or replace function private.cleanup_deleted_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  lock table private.admin_members in share row exclusive mode;
  if exists(select 1 from private.admin_members where user_id=old.id and is_master) then raise exception '마스터 계정은 탈퇴할 수 없습니다.';end if;
  if exists(select 1 from private.admin_members where user_id=old.id) and (select count(*) from private.admin_members)<=1 then raise exception '마지막 관리자는 탈퇴할 수 없습니다.';end if;
  delete from public.posts where user_id=old.id;
  update public.request_reviews set note='' where request_id in (select id from public.requests where user_id=old.id);
  insert into public.request_reviews(request_id,decision,note) select id,'rejected','탈퇴한 회원의 신청입니다.' from public.requests where user_id=old.id and status='pending' on conflict(request_id) do nothing;
  update public.requests set status=case when status='pending' then 'rejected' else status end,reviewed_at=coalesce(reviewed_at,now()),message='',payload='{}' where user_id=old.id;
  update public.change_logs set entity_id='deleted-account',before_data=(before_data-'nickname'-'email'-'user_id')||jsonb_build_object('account','탈퇴한 회원'),
    after_data=(after_data-'nickname'-'email'-'user_id')||jsonb_build_object('account','탈퇴한 회원') where entity='admin_members' and entity_id=old.id::text;
  return old;
end $$;

create function private.purge_expired_accounts() returns jsonb
language plpgsql security definer set search_path='' as $$
declare target uuid; removed integer:=0; usage_removed integer; attempts_removed integer;
begin
  for target in select user_id from private.account_lifecycle where purge_at<=clock_timestamp() order by purge_at for update skip locked limit 200 loop
    delete from auth.users where id=target;removed:=removed+1;
  end loop;
  delete from private.ai_usage where day<(now() at time zone 'Asia/Seoul')::date-29;get diagnostics usage_removed=row_count;
  delete from private.ai_requests where created_at<now()-interval '3 days';get diagnostics attempts_removed=row_count;
  return jsonb_build_object('accounts',removed,'usage',usage_removed,'requests',attempts_removed);
end $$;
revoke all on function private.purge_expired_accounts() from public,anon,authenticated,service_role;

-- The local SQL test engine has no pg_cron. Hosted Supabase supplies it.
do $$begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('bob-pick-retention-cleanup','*/5 * * * *','select private.purge_expired_accounts()');
  end if;
end $$;
create or replace function public.complete_ai_request(p_request_id uuid,p_success boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; attempt private.ai_requests; used integer; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
  select user_id into actor from private.ai_requests where id=p_request_id;
  if actor is null or p_success is null then return jsonb_build_object('completed',false);end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  select * into attempt from private.ai_requests where id=p_request_id for update;
  if not found then return jsonb_build_object('completed',false);end if;
  if p_success and exists(select 1 from private.account_lifecycle where user_id=actor and withdrawn_at is not null) then p_success:=false;end if;
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

notify pgrst,'reload schema';
commit;
