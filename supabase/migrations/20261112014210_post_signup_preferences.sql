begin;
alter table public.food_preferences add column onboarding_completed_at timestamptz;
-- Existing members keep their saved settings and do not enter a new signup flow.
update public.food_preferences set onboarding_completed_at=updated_at;

create or replace function private.initialize_food_preferences() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Signup creates an empty owner row. Preferences are collected after sign-in.
  insert into public.food_preferences(user_id) values(new.id);
  return new;
end $$;

create or replace function public.save_food_preferences(p_settings jsonb,p_user_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  if p_user_id is not null and p_user_id<>actor then raise exception using errcode='42501',message='계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  if jsonb_typeof(p_settings)<>'object' or octet_length(p_settings::text)>10000 then raise exception '취향 설정을 확인해 주세요.';end if;
  insert into public.food_preferences(user_id,liked_categories,avoided_categories,liked_forms,avoided_menus,min_price,max_price,avoid_visited_days,onboarding_completed_at)
  values(actor,array(select jsonb_array_elements_text(coalesce(p_settings->'liked_categories','[]'))),array(select jsonb_array_elements_text(coalesce(p_settings->'avoided_categories','[]'))),
    array(select jsonb_array_elements_text(coalesce(p_settings->'liked_forms','[]'))),array(select jsonb_array_elements_text(coalesce(p_settings->'avoided_menus','[]'))),
    nullif(p_settings->>'min_price','')::integer,nullif(p_settings->>'max_price','')::integer,coalesce((p_settings->>'avoid_visited_days')::integer,7),now())
  on conflict(user_id) do update set liked_categories=excluded.liked_categories,avoided_categories=excluded.avoided_categories,
    liked_forms=excluded.liked_forms,avoided_menus=excluded.avoided_menus,min_price=excluded.min_price,max_price=excluded.max_price,
    avoid_visited_days=excluded.avoid_visited_days,updated_at=now(),onboarding_completed_at=coalesce(public.food_preferences.onboarding_completed_at,now());
end $$;

create function public.complete_food_preference_onboarding(p_user_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  if p_user_id is not null and p_user_id<>actor then raise exception using errcode='42501',message='계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  update public.food_preferences set onboarding_completed_at=coalesce(onboarding_completed_at,now()) where user_id=actor;
  if not found then raise exception '취향 설정을 찾지 못했습니다. 다시 로그인해 주세요.';end if;
end $$;
revoke all on function public.complete_food_preference_onboarding(uuid) from public,anon,authenticated;
grant execute on function public.complete_food_preference_onboarding(uuid) to authenticated;

create or replace function public.my_food_preferences() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p public.food_preferences; actor uuid:=auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  select * into p from public.food_preferences where user_id=actor;
  return jsonb_build_object('onboardingComplete',p.onboarding_completed_at is not null,
    'settings',to_jsonb(p)-'user_id'-'updated_at'-'onboarding_completed_at','filter',jsonb_build_object(
    'preferredCategories',p.liked_categories,'excludedCategories',p.avoided_categories,'preferredForms',p.liked_forms,'excludedTerms',p.avoided_menus,'min',p.min_price,'max',p.max_price,
    'excludedRestaurantIds',coalesce((select jsonb_agg(distinct restaurant_id) from public.recommendation_history where user_id=actor and restaurant_id is not null
      and p.avoid_visited_days>0 and visited_at>=now()-make_interval(days=>p.avoid_visited_days)),'[]'::jsonb)));
end $$;
notify pgrst,'reload schema';
commit;
