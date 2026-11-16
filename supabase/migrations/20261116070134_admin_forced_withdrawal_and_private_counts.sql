begin;
alter table private.account_lifecycle
  add column withdrawal_kind text not null default 'self' check(withdrawal_kind in ('self','admin')),
  add column admin_reason text not null default '' check(length(admin_reason)<=500),
  add column forced_by uuid references auth.users(id) on delete set null,
  add column session_cutoff timestamptz,
  add column revision integer not null default 1;
create index account_lifecycle_forced_by on private.account_lifecycle(forced_by);
create trigger lifecycle_revision before update on private.account_lifecycle for each row execute function private.bump_record_revision();

-- Old sessions remain invalid even after an administrator undoes a forced withdrawal.
-- No client claims or editable user_metadata grant administrative privileges.
create or replace function public.is_active_member() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); state private.account_lifecycle; session_key uuid;
begin
  if actor is null or not exists(select 1 from auth.users where id=actor and deleted_at is null) then return false;end if;
  select * into state from private.account_lifecycle where user_id=actor;
  if not found then return true;end if;
  if state.withdrawn_at is not null then return false;end if;
  begin session_key:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return false;end;
  return exists(select 1 from auth.sessions s where s.id=session_key and s.user_id=actor and (s.not_after is null or s.not_after>now())
    and (state.session_cutoff is null or s.created_at>=state.session_cutoff));
end $$;

create or replace function public.account_recovery_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); state private.account_lifecycle; forced boolean;
begin
  if actor is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  if not exists(select 1 from auth.users where id=actor and deleted_at is null) then return jsonb_build_object('missing',true,'pending',false);end if;
  select * into state from private.account_lifecycle where user_id=actor;
  forced:=state.withdrawn_at is not null and state.withdrawal_kind='admin';
  return jsonb_build_object('missing',false,'pending',state.withdrawn_at is not null,
    'canRestore',state.withdrawn_at is not null and state.purge_at>now() and not forced,
    'forced',coalesce(forced,false),'canAdminRestore',coalesce(forced and state.purge_at>now(),false),'reason',case when forced then state.admin_reason else '' end,
    'requestedAt',state.withdrawn_at,'restoreUntil',state.purge_at,'active',public.is_active_member());
end $$;

create or replace function public.restore_withdrawn_account(p_user_id uuid,p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state private.account_lifecycle;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':lifecycle',0));
  select * into state from private.account_lifecycle where user_id=p_user_id for update;
  if state.withdrawn_at is null then raise exception '복원할 탈퇴 내역이 없습니다.';end if;
  if state.withdrawal_kind='admin' then raise exception '관리자가 탈퇴 처리한 계정입니다. 운영자에게 문의해 주세요.';end if;
  if state.purge_at<=clock_timestamp() then raise exception '복원 가능한 7일이 지났습니다.';end if;
  if not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_user_id and (s.not_after is null or s.not_after>now())
    and (state.session_cutoff is null or s.created_at>=state.session_cutoff)) then raise exception '본인 확인 후 다시 시도해 주세요.';end if;
  update private.account_lifecycle set withdrawn_at=null,purge_at=null,restored_at=clock_timestamp() where user_id=p_user_id;
  return jsonb_build_object('restored',true);
end $$;

create function public.admin_search_users(p_query text,p_state text default 'all',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare term text:=lower(trim(coalesce(p_query,'')));result jsonb;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if length(term) not between 2 and 254 or p_state is null or p_state not in ('all','active','forced','withdrawn') then raise exception '검색어와 계정 상태를 확인해 주세요.';end if;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from (
    select u.id user_id,coalesce(u.email::text,'') email,coalesce(p.nickname,'밥친구') nickname,
      a.user_id is not null is_admin,coalesce(a.is_master,false) is_master,u.id=auth.uid() is_self,
      case when l.withdrawn_at is null then 'active' when l.withdrawal_kind='admin' then 'forced' else 'withdrawn' end state,
      coalesce(l.revision,0) revision,l.withdrawn_at,l.purge_at,l.admin_reason reason,
      u.id<>auth.uid() and a.user_id is null and (l.purge_at is null or l.purge_at>now()) and (l.withdrawn_at is null or l.withdrawal_kind='self') can_force,
      l.withdrawn_at is not null and l.withdrawal_kind='admin' and l.purge_at>now() and a.user_id is null and u.id<>auth.uid() can_restore,
      case when u.id=auth.uid() then '본인 계정은 강제 탈퇴할 수 없어요.' when a.is_master then '마스터 계정은 보호됩니다.' when a.user_id is not null then '관리자 권한을 먼저 해제해 주세요.' when l.purge_at<=now() then '복원 기간이 지나 영구 삭제 예정입니다.' else '' end blocked_reason
    from auth.users u left join public.profiles p on p.id=u.id left join private.admin_members a on a.user_id=u.id left join private.account_lifecycle l on l.user_id=u.id
    where u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (strpos(lower(coalesce(u.email,'')),term)>0 or strpos(lower(coalesce(p.nickname,'')),term)>0)
      and (p_state='all' or (p_state='active' and l.withdrawn_at is null) or (p_state='forced' and l.withdrawn_at is not null and l.withdrawal_kind='admin') or (p_state='withdrawn' and l.withdrawn_at is not null and l.withdrawal_kind='self'))
    order by (lower(coalesce(u.email,''))=term) desc,lower(coalesce(p.nickname,'')),lower(coalesce(u.email,'')),u.id
    limit 20 offset greatest(0,least(coalesce(p_offset,0),100000))) q;
  return result;
end $$;

create function public.admin_moderate_user(p_user_id uuid,p_action text,p_reason text,p_expected_revision integer,p_expected_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state private.account_lifecycle; moment timestamptz;reason text:=trim(coalesce(p_reason,''));
begin
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if p_expected_actor is distinct from auth.uid() then raise exception '계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  if p_user_id is null or p_action is null or p_action not in ('force','restore') then raise exception '대상 계정과 처리 내용을 확인해 주세요.';end if;
  if p_user_id=auth.uid() then raise exception '본인 계정은 강제 탈퇴할 수 없어요.';end if;
  if p_action='force' and length(reason) not between 2 and 500 then raise exception '탈퇴 사유를 2~500자로 입력해 주세요.';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':lifecycle',0));
  lock table private.admin_members in share row exclusive mode;
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if not exists(select 1 from auth.users where id=p_user_id and deleted_at is null and not coalesce(is_anonymous,false)) then raise exception '가입된 회원을 찾지 못했습니다.';end if;
  if exists(select 1 from private.admin_members where user_id=p_user_id and is_master) then raise exception '마스터 계정은 보호됩니다.';end if;
  if exists(select 1 from private.admin_members where user_id=p_user_id) then raise exception '관리자 권한을 먼저 해제해 주세요.';end if;
  select * into state from private.account_lifecycle where user_id=p_user_id for update;
  if p_expected_revision is null or p_expected_revision<>coalesce(state.revision,0) then raise exception '계정 상태가 변경됐어요. 다시 검색해 주세요.';end if;
  moment:=clock_timestamp();
  if state.purge_at<=moment then raise exception '복원 기간이 지나 영구 삭제 예정입니다.';end if;
  if p_action='force' then
    if state.withdrawn_at is not null and state.withdrawal_kind='admin' then return jsonb_build_object('changed',false,'forced',true,'restoreUntil',state.purge_at);end if;
    -- Converting a voluntary withdrawal never extends its erasure deadline.
    insert into private.account_lifecycle(user_id,withdrawn_at,purge_at,withdrawal_kind,admin_reason,forced_by,session_cutoff)
    values(p_user_id,coalesce(state.withdrawn_at,moment),coalesce(state.purge_at,moment+interval '7 days'),'admin',reason,auth.uid(),moment)
    on conflict(user_id) do update set withdrawn_at=excluded.withdrawn_at,purge_at=excluded.purge_at,withdrawal_kind='admin',admin_reason=excluded.admin_reason,forced_by=excluded.forced_by,session_cutoff=excluded.session_cutoff,restored_at=null;
  else
    if state.withdrawn_at is null or state.withdrawal_kind<>'admin' then raise exception '관리자가 탈퇴 처리한 계정만 복원할 수 있어요.';end if;
    update private.account_lifecycle set withdrawn_at=null,purge_at=null,withdrawal_kind='self',admin_reason='',forced_by=null,session_cutoff=moment,restored_at=moment where user_id=p_user_id;
  end if;
  -- Reasons remain only in the private, erasable lifecycle row, never in durable logs.
  insert into public.change_logs(actor_id,entity,entity_id,action,before_data,after_data)
  values(auth.uid(),'account_moderation',p_user_id::text,case when p_action='force' then 'account:forced_withdrawal' else 'account:restored' end,
    jsonb_build_object('withdrawn',state.withdrawn_at is not null),jsonb_build_object('withdrawn',p_action='force'));
  return jsonb_build_object('changed',true,'forced',p_action='force');
end $$;

revoke all on function public.admin_search_users(text,text,integer),public.admin_moderate_user(uuid,text,text,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_users(text,text,integer),public.admin_moderate_user(uuid,text,text,integer,uuid) to authenticated;

create or replace function public.admin_list_accounts()
returns table(user_id uuid,email text,nickname text,is_self boolean,can_remove boolean,is_master boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); total bigint;
begin
  if not public.is_admin() then
    raise exception using errcode='42501',message='관리자 권한이 필요합니다.';
  end if;
  select count(*) into total from private.admin_members;
  return query
    select a.user_id,coalesce(u.email::text,''),coalesce(p.nickname,'밥친구'),a.user_id=actor,
      total>1 and not a.is_master,a.is_master
    from private.admin_members a join auth.users u on u.id=a.user_id
    left join public.profiles p on p.id=u.id
    order by a.is_master desc,lower(coalesce(p.nickname,'')),lower(coalesce(u.email,'')),u.id;
end $$;

create or replace function public.admin_set_membership(p_user_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target record; was_admin boolean;
begin
  if not public.is_admin() then
    raise exception using errcode='42501',message='관리자 권한이 필요합니다.';
  end if;
  lock table private.admin_members in share row exclusive mode;
  if not public.is_admin() then
    raise exception using errcode='42501',message='관리자 권한이 필요합니다.';
  end if;
  if p_user_id is null or p_enabled is null then
    raise exception using errcode='22023',message='대상 계정과 권한을 확인해 주세요.';
  end if;
  select u.id,u.email,u.email_confirmed_at,u.deleted_at,u.banned_until,u.is_anonymous,
    coalesce(p.nickname,'밥친구') nickname into target
    from auth.users u left join public.profiles p on p.id=u.id where u.id=p_user_id;
  if not found then raise exception '가입된 회원을 찾지 못했습니다.'; end if;
  was_admin:=exists(select 1 from private.admin_members a where a.user_id=p_user_id);
  if was_admin=p_enabled then
    return jsonb_build_object('user_id',p_user_id,'is_admin',p_enabled,'changed',false);
  end if;
  if not p_enabled and exists(select 1 from private.admin_members a where a.user_id=p_user_id and a.is_master) then
    raise exception using errcode='22023',message='마스터 계정의 관리자 권한은 해제할 수 없습니다.';
  end if;
  if p_enabled then
    if exists(select 1 from private.account_lifecycle where user_id=p_user_id and withdrawn_at is not null) or target.email_confirmed_at is null or nullif(trim(target.email),'') is null
      or target.deleted_at is not null or coalesce(target.is_anonymous,false)
      or (target.banned_until is not null and target.banned_until>now()) then
      raise exception '이메일 인증을 마친 이용 가능한 회원에게만 관리자 권한을 추가할 수 있습니다.';
    end if;
    insert into private.admin_members(user_id) values(p_user_id);
  else
    if (select count(*) from private.admin_members)<=1 then
      raise exception '마지막 관리자는 해제할 수 없습니다. 다른 관리자를 먼저 추가해 주세요.';
    end if;
    delete from private.admin_members a where a.user_id=p_user_id;
  end if;
  insert into public.change_logs(actor_id,entity,entity_id,action,before_data,after_data)
    values(actor,'admin_members',p_user_id::text,case when p_enabled then 'admin:granted' else 'admin:revoked' end,
      jsonb_build_object('user_id',p_user_id,'is_admin',was_admin,'nickname',target.nickname),
      jsonb_build_object('user_id',p_user_id,'is_admin',p_enabled,'nickname',target.nickname));
  return jsonb_build_object('user_id',p_user_id,'is_admin',p_enabled,'changed',true);
end $$;

create or replace function public.admin_search_accounts(p_query text)
returns table(user_id uuid,email text,nickname text,email_confirmed boolean,is_admin boolean,can_grant boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); term text:=lower(trim(coalesce(p_query,'')));
begin
  if not public.is_admin() then
    raise exception using errcode='42501',message='관리자 권한이 필요합니다.';
  end if;
  if length(term) not between 2 and 254 then
    raise exception using errcode='22023',message='검색어는 2~254자로 입력해 주세요.';
  end if;
  return query
    select u.id,coalesce(u.email::text,''),coalesce(p.nickname,'밥친구'),u.email_confirmed_at is not null,
      a.user_id is not null,
      a.user_id is null and u.email_confirmed_at is not null and nullif(trim(u.email),'') is not null
        and (u.banned_until is null or u.banned_until<=now()) and not exists(select 1 from private.account_lifecycle l where l.user_id=u.id and l.withdrawn_at is not null)
    from auth.users u left join public.profiles p on p.id=u.id
    left join private.admin_members a on a.user_id=u.id
    where u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (strpos(lower(coalesce(u.email,'')),term)>0 or strpos(lower(coalesce(p.nickname,'')),term)>0)
    order by (lower(coalesce(u.email,''))=term) desc,
      lower(coalesce(p.nickname,'')),lower(coalesce(u.email,'')),u.id
    limit 20;
end $$;

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
  update public.change_logs set entity_id='deleted-account' where entity='account_moderation' and entity_id=old.id::text;
  return old;
end $$;

create or replace function public.site_popularity() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare searches jsonb; visits jsonb; favorites jsonb; show_counts boolean:=public.is_admin();
begin
  select coalesce(jsonb_agg(case when show_counts then to_jsonb(t) else to_jsonb(t)-'metric_count' end order by t.metric_count desc,t.name,t.id),'[]') into searches from (
    select r.id,r.name,r.address,r.latitude,r.longitude,c.search_count metric_count
    from private.restaurant_search_counts c join public.restaurants r on r.id=c.restaurant_id where r.active and c.search_count>0
    order by c.search_count desc,r.name,r.id limit 3
  ) t;
  select coalesce(jsonb_agg(t order by t.metric_count desc,t.name,t.id),'[]') into visits from (
    select r.id,r.name,r.address,r.latitude,r.longitude,count(distinct h.user_id) metric_count
    from public.recommendation_history h join public.restaurants r on r.id=h.restaurant_id join auth.users u on u.id=h.user_id
    left join private.account_lifecycle l on l.user_id=u.id
    where r.active and h.visited_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=now()) and l.withdrawn_at is null
    group by r.id order by count(distinct h.user_id) desc,r.name,r.id limit 3
  ) t;
  select coalesce(jsonb_agg(t order by t.metric_count desc,t.name,t.id),'[]') into favorites from (
    select r.id,r.name,r.address,r.latitude,r.longitude,count(distinct f.user_id) metric_count
    from public.favorites f join public.menus m on m.id=f.menu_id join public.restaurants r on r.id=m.restaurant_id join auth.users u on u.id=f.user_id
    left join private.account_lifecycle l on l.user_id=u.id
    where r.active and m.active and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=now()) and l.withdrawn_at is null
    group by r.id order by count(distinct f.user_id) desc,r.name,r.id limit 3
  ) t;
  return jsonb_build_object('canViewSearchCounts',show_counts,'startedAt',(select started_at from private.site_popularity_meta),'searches',searches,'visits',visits,'favorites',favorites);
end $$;
notify pgrst,'reload schema';
commit;
