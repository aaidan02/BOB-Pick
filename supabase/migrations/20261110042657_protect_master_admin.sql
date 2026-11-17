begin;

-- Master status is pinned to a user ID, never an editable nickname or JWT claim.
-- Assign the existing operator separately; migrations contain no hosted user IDs.
alter table private.admin_members add column is_master boolean not null default false;
create unique index admin_members_one_master on private.admin_members(is_master) where is_master;

create function private.protect_master_admin() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='TRUNCATE' then
    if exists(select 1 from private.admin_members where is_master) then
      raise exception using errcode='22023',message='마스터 계정의 관리자 권한은 해제할 수 없습니다.';
    end if;
    return null;
  end if;
  if old.is_master then
    if tg_op='DELETE' then
      raise exception using errcode='22023',message='마스터 계정의 관리자 권한은 해제할 수 없습니다.';
    end if;
    if new.user_id is distinct from old.user_id or new.is_master is distinct from true then
      raise exception using errcode='22023',message='마스터 계정의 관리자 권한은 해제할 수 없습니다.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.protect_master_admin() from public,anon,authenticated;
create trigger protect_master_admin before update or delete on private.admin_members
  for each row execute function private.protect_master_admin();
create trigger protect_master_admin_truncate before truncate on private.admin_members
  for each statement execute function private.protect_master_admin();

-- Adding an OUT column requires recreating the function, with explicit grants.
drop function public.admin_list_accounts();
create function public.admin_list_accounts()
returns table(user_id uuid,email text,nickname text,is_self boolean,can_remove boolean,is_master boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); total bigint;
begin
  if actor is null or not exists(select 1 from private.admin_members a where a.user_id=actor) then
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
  if actor is null or not exists(select 1 from private.admin_members a where a.user_id=actor) then
    raise exception using errcode='42501',message='관리자 권한이 필요합니다.';
  end if;
  lock table private.admin_members in share row exclusive mode;
  if not exists(select 1 from private.admin_members a where a.user_id=actor) then
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
    if target.email_confirmed_at is null or nullif(trim(target.email),'') is null
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

revoke all on function public.admin_list_accounts(),public.admin_set_membership(uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_list_accounts(),public.admin_set_membership(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
