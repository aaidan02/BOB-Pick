begin;

-- These RPCs need privileged access to auth.users and the unexposed role table.
-- Every entry point checks the caller's live membership; no JWT metadata grants roles.
create function public.admin_list_accounts()
returns table(user_id uuid,email text,nickname text,is_self boolean,can_remove boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); total bigint;
begin
  if actor is null or not exists(select 1 from private.admin_members a where a.user_id=actor) then
    raise exception using errcode='42501',message='관리자 권한이 필요합니다.';
  end if;
  select count(*) into total from private.admin_members;
  return query
    select a.user_id,coalesce(u.email,''),coalesce(p.nickname,'밥친구'),a.user_id=actor,total>1
    from private.admin_members a join auth.users u on u.id=a.user_id
    left join public.profiles p on p.id=u.id
    order by lower(coalesce(p.nickname,'')),lower(coalesce(u.email,'')),u.id;
end $$;

create function public.admin_search_accounts(p_query text)
returns table(user_id uuid,email text,nickname text,email_confirmed boolean,is_admin boolean,can_grant boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); term text:=lower(trim(coalesce(p_query,'')));
begin
  if actor is null or not exists(select 1 from private.admin_members a where a.user_id=actor) then
    raise exception using errcode='42501',message='관리자 권한이 필요합니다.';
  end if;
  if length(term) not between 2 and 254 then
    raise exception using errcode='22023',message='검색어는 2~254자로 입력해 주세요.';
  end if;
  return query
    select u.id,coalesce(u.email,''),coalesce(p.nickname,'밥친구'),u.email_confirmed_at is not null,
      a.user_id is not null,
      a.user_id is null and u.email_confirmed_at is not null and nullif(trim(u.email),'') is not null
        and (u.banned_until is null or u.banned_until<=now())
    from auth.users u left join public.profiles p on p.id=u.id
    left join private.admin_members a on a.user_id=u.id
    where u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (strpos(lower(coalesce(u.email,'')),term)>0 or strpos(lower(coalesce(p.nickname,'')),term)>0)
    order by (lower(coalesce(u.email,''))=term) desc,
      lower(coalesce(p.nickname,'')),lower(coalesce(u.email,'')),u.id
    limit 20;
end $$;

create function public.admin_set_membership(p_user_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target record; was_admin boolean;
begin
  if actor is null or not exists(select 1 from private.admin_members a where a.user_id=actor) then
    raise exception using errcode='42501',message='관리자 권한이 필요합니다.';
  end if;
  -- Serialize changes and recheck permission AFTER waiting: simultaneous removals
  -- cannot leave zero admins, and a caller revoked while waiting cannot proceed.
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

-- Supabase may have direct anon grants in addition to the PostgreSQL PUBLIC default.
revoke all on function public.admin_list_accounts(),public.admin_search_accounts(text),public.admin_set_membership(uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_list_accounts(),public.admin_search_accounts(text),public.admin_set_membership(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
