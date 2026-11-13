begin;
-- auth.users.email is varchar(255) in hosted Supabase. RETURN QUERY requires
-- an explicit text cast; use the same auth column type in the test facade.
create or replace function public.admin_list_accounts()
returns table(user_id uuid,email text,nickname text,is_self boolean,can_remove boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); total bigint;
begin
  if actor is null or not exists(select 1 from private.admin_members a where a.user_id=actor) then
    raise exception using errcode='42501',message='관리자 권한이 필요합니다.';
  end if;
  select count(*) into total from private.admin_members;
  return query
    select a.user_id,coalesce(u.email::text,''),coalesce(p.nickname,'밥친구'),a.user_id=actor,total>1
    from private.admin_members a join auth.users u on u.id=a.user_id
    left join public.profiles p on p.id=u.id
    order by lower(coalesce(p.nickname,'')),lower(coalesce(u.email,'')),u.id;
end $$;

create or replace function public.admin_search_accounts(p_query text)
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
    select u.id,coalesce(u.email::text,''),coalesce(p.nickname,'밥친구'),u.email_confirmed_at is not null,
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
revoke all on function public.admin_list_accounts(),public.admin_search_accounts(text) from public,anon,authenticated;
grant execute on function public.admin_list_accounts(),public.admin_search_accounts(text) to authenticated;
notify pgrst,'reload schema';
commit;
