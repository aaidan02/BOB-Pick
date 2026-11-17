begin;
-- Keep the existing seven-day recovery period and master/last-admin protections.
-- Never delete unrelated authentication flows, or records during withdrawal alone.
create or replace function private.cleanup_deleted_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  lock table private.admin_members in share row exclusive mode;
  if exists(select 1 from private.admin_members where user_id=old.id and is_master) then raise exception '마스터 계정은 탈퇴할 수 없습니다.';end if;
  if exists(select 1 from private.admin_members where user_id=old.id) and (select count(*) from private.admin_members)<=1 then raise exception '마지막 관리자는 탈퇴할 수 없습니다.';end if;
  -- Auth identity / OTP / MFA / sessions cascade from auth.users. These two
  -- record types also support rows outside that FK chain, so erase by exact UID.
  -- This runs only as part of the already-authorized permanent account deletion.
  delete from auth.flow_state where user_id=old.id;
  delete from auth.refresh_tokens where user_id=old.id::text;
  delete from public.posts where user_id=old.id;
  update public.request_reviews set note='' where request_id in (select id from public.requests where user_id=old.id);
  insert into public.request_reviews(request_id,decision,note) select id,'rejected','탈퇴한 회원의 신청입니다.' from public.requests where user_id=old.id and status='pending' on conflict(request_id) do nothing;
  update public.requests set status=case when status='pending' then 'rejected' else status end,reviewed_at=coalesce(reviewed_at,now()),message='',payload='{}' where user_id=old.id;
  update public.change_logs set entity_id='deleted-account',before_data=(before_data-'nickname'-'email'-'user_id')||jsonb_build_object('account','탈퇴한 회원'),
    after_data=(after_data-'nickname'-'email'-'user_id')||jsonb_build_object('account','탈퇴한 회원') where entity='admin_members' and entity_id=old.id::text;
  update public.change_logs set entity_id='deleted-account' where entity='account_moderation' and entity_id=old.id::text;
  return old;
end $$;
revoke all on function private.cleanup_deleted_account() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
