begin;
-- Keep all three rankings public; only current administrators receive numeric totals.
create or replace function public.site_popularity() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare searches jsonb; visits jsonb; favorites jsonb; show_counts boolean:=public.is_admin();
begin
  select coalesce(jsonb_agg(case when show_counts then to_jsonb(t) else to_jsonb(t)-'metric_count' end order by t.metric_count desc,t.name,t.id),'[]') into searches from (
    select r.id,r.name,r.address,r.latitude,r.longitude,c.search_count metric_count
    from private.restaurant_search_counts c join public.restaurants r on r.id=c.restaurant_id where r.active and c.search_count>0
    order by c.search_count desc,r.name,r.id limit 3
  ) t;
  select coalesce(jsonb_agg(case when show_counts then to_jsonb(t) else to_jsonb(t)-'metric_count' end order by t.metric_count desc,t.name,t.id),'[]') into visits from (
    select r.id,r.name,r.address,r.latitude,r.longitude,count(distinct h.user_id) metric_count
    from public.recommendation_history h join public.restaurants r on r.id=h.restaurant_id join auth.users u on u.id=h.user_id
    left join private.account_lifecycle l on l.user_id=u.id
    where r.active and h.visited_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=now()) and l.withdrawn_at is null
    group by r.id order by count(distinct h.user_id) desc,r.name,r.id limit 3
  ) t;
  select coalesce(jsonb_agg(case when show_counts then to_jsonb(t) else to_jsonb(t)-'metric_count' end order by t.metric_count desc,t.name,t.id),'[]') into favorites from (
    select r.id,r.name,r.address,r.latitude,r.longitude,count(distinct f.user_id) metric_count
    from public.favorites f join public.menus m on m.id=f.menu_id join public.restaurants r on r.id=m.restaurant_id join auth.users u on u.id=f.user_id
    left join private.account_lifecycle l on l.user_id=u.id
    where r.active and m.active and u.deleted_at is null and not coalesce(u.is_anonymous,false)
      and (u.banned_until is null or u.banned_until<=now()) and l.withdrawn_at is null
    group by r.id order by count(distinct f.user_id) desc,r.name,r.id limit 3
  ) t;
  return jsonb_build_object('canViewCounts',show_counts,'canViewSearchCounts',show_counts,'startedAt',(select started_at from private.site_popularity_meta),'searches',searches,'visits',visits,'favorites',favorites);
end $$;
notify pgrst,'reload schema';
commit;
