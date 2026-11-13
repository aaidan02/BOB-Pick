begin;
-- Supabase default privileges may grant EXECUTE directly to anon, separately
-- from PUBLIC. Revoke both; all write RPCs require an authenticated identity.
revoke all on function public.consume_ai_quota(),public.submit_request(text,text,jsonb,text),public.review_request(uuid,text,text),public.is_admin() from public,anon;
grant execute on function public.consume_ai_quota(),public.submit_request(text,text,jsonb,text),public.review_request(uuid,text,text),public.is_admin() to authenticated;
drop policy restaurants_read on public.restaurants;
create policy restaurants_public on public.restaurants for select to anon using(active);
create policy restaurants_members on public.restaurants for select to authenticated using(active or (select public.is_admin()));
drop policy menus_read on public.menus;
create policy menus_public on public.menus for select to anon using(active and exists(select 1 from public.restaurants r where r.id=restaurant_id and r.active));
create policy menus_members on public.menus for select to authenticated using((active and exists(select 1 from public.restaurants r where r.id=restaurant_id and r.active)) or (select public.is_admin()));
drop policy promotions_read on public.promotions;
create policy promotions_read on public.promotions for select using(ends_at>now() and exists(select 1 from public.restaurants r where r.id=restaurant_id and r.active));
revoke all on schema private from public,anon,authenticated;
revoke all on private.admin_members,private.ai_usage from public,anon,authenticated;
alter table private.admin_members enable row level security;
alter table private.ai_usage enable row level security;
revoke all on all functions in schema private from public,anon,authenticated;
create index favorites_menu_idx on public.favorites(menu_id);
create index requests_restaurant_idx on public.requests(restaurant_id);
create index reviews_reviewer_idx on public.request_reviews(reviewer_id);
create index change_logs_actor_idx on public.change_logs(actor_id);
create index change_logs_request_idx on public.change_logs(request_id);
create index change_logs_created_idx on public.change_logs(created_at desc);
create index promotions_restaurant_idx on public.promotions(restaurant_id);
commit;
