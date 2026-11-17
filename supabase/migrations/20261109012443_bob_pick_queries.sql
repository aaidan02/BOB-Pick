begin;
create function public.catalog_options() returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'categories',coalesce((select jsonb_agg(v order by v) from (select distinct unnest(categories) v from public.restaurants where active) t),'[]'),
    'forms',coalesce((select jsonb_agg(v order by v) from (select distinct unnest(forms) v from public.restaurants where active) t),'[]'))
$$;
create function public.recommend_count(p_filter jsonb default '{}') returns integer language sql stable security invoker set search_path='' as $$
  select count(*)::integer from public.recommend_candidates(p_filter)
$$;
create function public.search_posts(p_query text default '',p_offset integer default 0,p_mine boolean default false)
returns table(id uuid,user_id uuid,title text,body text,created_at timestamptz,updated_at timestamptz,author_name text)
language sql stable security invoker set search_path='' as $$
  select p.id,p.user_id,p.title,p.body,p.created_at,p.updated_at,coalesce(pr.nickname,'탈퇴한 회원')
  from public.posts p left join public.profiles pr on pr.id=p.user_id
  where (not p_mine or p.user_id=auth.uid())
    and (coalesce(p_query,'')='' or position(lower(left(p_query,120)) in lower(p.title||' '||p.body))>0)
  order by p.created_at desc,p.id limit 20 offset greatest(0,least(p_offset,100000))
$$;
revoke all on function public.catalog_options(),public.recommend_count(jsonb),public.search_posts(text,integer,boolean) from public;
grant execute on function public.catalog_options(),public.recommend_count(jsonb),public.search_posts(text,integer,boolean) to anon,authenticated;
commit;
