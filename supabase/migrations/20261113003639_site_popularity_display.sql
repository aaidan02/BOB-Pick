begin;
create table private.site_popularity_meta(id boolean primary key default true check(id),started_at timestamptz not null default clock_timestamp());
insert into private.site_popularity_meta default values;
create table private.restaurant_search_counts(restaurant_id text primary key references public.restaurants(id) on delete cascade,search_count bigint not null default 0 check(search_count>=0));
alter table private.site_popularity_meta enable row level security;
alter table private.restaurant_search_counts enable row level security;
revoke all on private.site_popularity_meta,private.restaurant_search_counts from public,anon,authenticated,service_role;

create function private.record_search_popularity() returns trigger
language plpgsql security definer set search_path='' as $$
declare item record;
begin
  -- Transition rows contain only real inserts, excluding retried event IDs.
  -- A consistent lock order prevents concurrent three-card batches deadlocking.
  for item in select restaurant_id,count(*) total from new_search_rows where restaurant_id is not null group by restaurant_id order by restaurant_id loop
    insert into private.restaurant_search_counts(restaurant_id,search_count) values(item.restaurant_id,item.total)
    on conflict(restaurant_id) do update set search_count=private.restaurant_search_counts.search_count+excluded.search_count;
  end loop;
  return null;
end $$;
revoke all on function private.record_search_popularity() from public,anon,authenticated,service_role;
create trigger recommendation_search_totals after insert on public.recommendation_history referencing new table as new_search_rows for each statement execute function private.record_search_popularity();

create function public.site_popularity() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare searches jsonb; visits jsonb; favorites jsonb;
begin
  select coalesce(jsonb_agg(t order by t.metric_count desc,t.name,t.id),'[]') into searches from (
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
  return jsonb_build_object('startedAt',(select started_at from private.site_popularity_meta),'searches',searches,'visits',visits,'favorites',favorites);
end $$;
revoke all on function public.site_popularity() from public,anon,authenticated;
grant execute on function public.site_popularity() to anon,authenticated;
notify pgrst,'reload schema';
commit;
