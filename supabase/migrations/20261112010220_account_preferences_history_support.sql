begin;
create function private.valid_food_words(words text[]) returns boolean
language sql immutable set search_path='' as $$
  select cardinality(words)<=30 and not exists(select 1 from unnest(words) w where w is null or length(trim(w)) not between 1 and 60)
$$;
revoke all on function private.valid_food_words(text[]) from public,anon,authenticated;
create table public.food_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  liked_categories text[] not null default '{}',avoided_categories text[] not null default '{}',
  liked_forms text[] not null default '{}',avoided_menus text[] not null default '{}',
  min_price integer check(min_price>=0),max_price integer check(max_price>=0),
  avoid_visited_days integer not null default 7 check(avoid_visited_days in (0,7,14,30)),
  updated_at timestamptz not null default now(),
  check(min_price is null or max_price is null or min_price<=max_price),
  check(liked_categories <@ array['한식','양식','중식','일식','아시안','분식','패스트푸드','치킨','카페·디저트','야식','기타']::text[]),
  check(avoided_categories <@ array['한식','양식','중식','일식','아시안','분식','패스트푸드','치킨','카페·디저트','야식','기타']::text[]),
  check(not(liked_categories && avoided_categories)),
  check(liked_forms <@ array['구이','국·탕·찌개','디저트','면','미분류','밥','볶음','빵','음료','찜·삶음','튀김','회·생식']::text[]),
  check(private.valid_food_words(liked_categories) and private.valid_food_words(avoided_categories) and private.valid_food_words(liked_forms) and private.valid_food_words(avoided_menus))
);
alter table public.food_preferences enable row level security;
create policy food_preferences_read on public.food_preferences for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.food_preferences from anon,authenticated;
grant select on public.food_preferences to authenticated;

create function private.initialize_food_preferences() returns trigger
language plpgsql security definer set search_path='' as $$
declare p jsonb:=coalesce(new.raw_user_meta_data->'food_preferences','{}');
begin
  begin
    insert into public.food_preferences(user_id,liked_categories,avoided_categories,liked_forms,avoided_menus,min_price,max_price,avoid_visited_days)
    values(new.id,array(select jsonb_array_elements_text(coalesce(p->'liked_categories','[]'))),array(select jsonb_array_elements_text(coalesce(p->'avoided_categories','[]'))),
      array(select jsonb_array_elements_text(coalesce(p->'liked_forms','[]'))),array(select jsonb_array_elements_text(coalesce(p->'avoided_menus','[]'))),
      nullif(p->>'min_price','')::integer,nullif(p->>'max_price','')::integer,coalesce((p->>'avoid_visited_days')::integer,7));
  exception when check_violation or invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range or not_null_violation then
    insert into public.food_preferences(user_id) values(new.id);
  end;
  return new;
end $$;
revoke all on function private.initialize_food_preferences() from public,anon,authenticated;
create trigger on_auth_user_food_preferences after insert on auth.users for each row execute function private.initialize_food_preferences();
insert into public.food_preferences(user_id) select id from auth.users on conflict do nothing;

create function public.save_food_preferences(p_settings jsonb,p_user_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  if p_user_id is not null and p_user_id<>actor then raise exception using errcode='42501',message='계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  if jsonb_typeof(p_settings)<>'object' or octet_length(p_settings::text)>10000 then raise exception '취향 설정을 확인해 주세요.';end if;
  insert into public.food_preferences(user_id,liked_categories,avoided_categories,liked_forms,avoided_menus,min_price,max_price,avoid_visited_days)
  values(actor,array(select jsonb_array_elements_text(coalesce(p_settings->'liked_categories','[]'))),array(select jsonb_array_elements_text(coalesce(p_settings->'avoided_categories','[]'))),
    array(select jsonb_array_elements_text(coalesce(p_settings->'liked_forms','[]'))),array(select jsonb_array_elements_text(coalesce(p_settings->'avoided_menus','[]'))),
    nullif(p_settings->>'min_price','')::integer,nullif(p_settings->>'max_price','')::integer,coalesce((p_settings->>'avoid_visited_days')::integer,7))
  on conflict(user_id) do update set liked_categories=excluded.liked_categories,avoided_categories=excluded.avoided_categories,
    liked_forms=excluded.liked_forms,avoided_menus=excluded.avoided_menus,min_price=excluded.min_price,max_price=excluded.max_price,
    avoid_visited_days=excluded.avoid_visited_days,updated_at=now();
end $$;

create table public.recommendation_history (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,source text not null check(source in ('manual','ai')),filter jsonb not null default '{}',
  restaurant_id text references public.restaurants(id) on delete set null,menu_id uuid references public.menus(id) on delete set null,
  restaurant_name text not null,menu_name text not null,address text not null default '',latitude double precision,longitude double precision,
  price integer,variable_price boolean not null default false,created_at timestamptz not null default now(),visited_at timestamptz,
  unique(user_id,event_id,restaurant_id)
);
create index recommendation_history_owner_time on public.recommendation_history(user_id,created_at desc,id desc);
create index recommendation_history_visits on public.recommendation_history(user_id,visited_at desc) where visited_at is not null;
create index recommendation_history_restaurant on public.recommendation_history(restaurant_id);
create index recommendation_history_menu on public.recommendation_history(menu_id);
alter table public.recommendation_history enable row level security;
create policy history_read on public.recommendation_history for select to authenticated using(user_id=(select auth.uid()));
create policy history_remove on public.recommendation_history for delete to authenticated using(user_id=(select auth.uid()));
create policy history_visit on public.recommendation_history for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.recommendation_history from anon,authenticated;
grant select,delete on public.recommendation_history to authenticated;
grant update(visited_at) on public.recommendation_history to authenticated;

create function public.save_recommendation_history(p_event_id uuid,p_source text,p_filter jsonb,p_items jsonb,p_user_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  if p_user_id is not null and p_user_id<>actor then raise exception using errcode='42501',message='계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  if p_event_id is null or p_source not in ('manual','ai') or jsonb_typeof(p_filter)<>'object' or octet_length(p_filter::text)>16000
    or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 3 then raise exception '추천 기록을 확인해 주세요.';end if;
  if exists(select 1 from jsonb_array_elements(p_items) i left join public.restaurants r on r.id=i->>'restaurantId'
    left join public.menus m on m.id=nullif(i->>'menuId','')::uuid and m.restaurant_id=r.id
    where r.id is null or not r.active or (nullif(i->>'menuId','') is not null and (m.id is null or not m.active))) then raise exception '음식점과 메뉴를 확인해 주세요.';end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':history',0));
  insert into public.recommendation_history(user_id,event_id,source,filter,restaurant_id,menu_id,restaurant_name,menu_name,address,latitude,longitude,price,variable_price)
  select actor,p_event_id,p_source,p_filter,r.id,m.id,r.name,coalesce(m.name,nullif(r.representative_menu,''),r.name),r.address,r.latitude,r.longitude,m.price,coalesce(m.variable_price,false)
  from jsonb_array_elements(p_items) i join public.restaurants r on r.id=i->>'restaurantId'
  left join public.menus m on m.id=nullif(i->>'menuId','')::uuid and m.restaurant_id=r.id
  on conflict(user_id,event_id,restaurant_id) do nothing;
  -- Keep all self-reported visits; only older unvisited suggestions are trimmed.
  delete from public.recommendation_history where id in (select id from public.recommendation_history where user_id=actor and visited_at is null order by created_at desc,id desc offset 100);
end $$;

create function public.set_history_visit(p_id uuid,p_visited boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  update public.recommendation_history set visited_at=case when p_visited then now() else null end where id=p_id and user_id=auth.uid();
  if not found then raise exception '추천 기록을 찾지 못했습니다.';end if;
end $$;

create function public.my_food_preferences() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p public.food_preferences; actor uuid:=auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  select * into p from public.food_preferences where user_id=actor;
  return jsonb_build_object('settings',to_jsonb(p)-'user_id'-'updated_at','filter',jsonb_build_object(
    'preferredCategories',p.liked_categories,'excludedCategories',p.avoided_categories,'preferredForms',p.liked_forms,'excludedTerms',p.avoided_menus,'min',p.min_price,'max',p.max_price,
    'excludedRestaurantIds',coalesce((select jsonb_agg(distinct restaurant_id) from public.recommendation_history where user_id=actor and restaurant_id is not null
      and p.avoid_visited_days>0 and visited_at>=now()-make_interval(days=>p.avoid_visited_days)),'[]'::jsonb)));
end $$;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check(category in ('general','account','recommendation','bug')),
  subject text not null check(length(trim(subject)) between 1 and 120),body text not null check(length(trim(body)) between 1 and 5000),
  status text not null default 'open' check(status in ('open','answered')),reply text not null default '' check(length(reply)<=5000),
  answered_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now(),answered_at timestamptz
);
create index support_owner_created on public.support_tickets(user_id,created_at desc);
create index support_status_created on public.support_tickets(status,created_at desc);
create index support_answered_by on public.support_tickets(answered_by);
alter table public.support_tickets enable row level security;
create policy support_read on public.support_tickets for select to authenticated using(user_id=(select auth.uid()) or (select public.is_admin()));
create policy support_add on public.support_tickets for insert to authenticated with check(user_id=(select auth.uid()) and status='open' and reply='' and answered_by is null and answered_at is null);
revoke all on public.support_tickets from anon,authenticated;
grant select on public.support_tickets to authenticated;
grant insert(user_id,category,subject,body) on public.support_tickets to authenticated;

create function public.reply_support_ticket(p_id uuid,p_reply text) returns void
language plpgsql security definer set search_path='' as $$
declare old_status text;
begin
  if auth.uid() is null or not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if length(trim(p_reply)) not between 1 and 5000 then raise exception '답변을 1~5,000자로 입력해 주세요.';end if;
  select status into old_status from public.support_tickets where id=p_id for update;
  if not found then raise exception '문의를 찾지 못했습니다.';end if;
  update public.support_tickets set reply=trim(p_reply),status='answered',answered_by=auth.uid(),answered_at=now() where id=p_id;
  insert into public.change_logs(actor_id,entity,entity_id,action,before_data,after_data) values(auth.uid(),'support_tickets',p_id::text,'support:answered',jsonb_build_object('status',old_status),jsonb_build_object('status','answered'));
end $$;

create function public.my_account_overview() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  return jsonb_build_object('favorites',(select count(*) from public.favorites where user_id=actor),'history',(select count(*) from public.recommendation_history where user_id=actor),
    'visits',(select count(*) from public.recommendation_history where user_id=actor and visited_at is not null),'support',(select count(*) from public.support_tickets where user_id=actor));
end $$;
create function public.account_deletion_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  if exists(select 1 from private.admin_members where user_id=auth.uid() and is_master) then return jsonb_build_object('allowed',false,'reason','마스터 계정은 탈퇴할 수 없습니다.');end if;
  if public.is_admin() and (select count(*) from private.admin_members)<=1 then return jsonb_build_object('allowed',false,'reason','다른 관리자를 추가한 뒤 탈퇴해 주세요.');end if;
  return jsonb_build_object('allowed',true);
end $$;
create function private.cleanup_deleted_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  lock table private.admin_members in share row exclusive mode;
  if exists(select 1 from private.admin_members where user_id=old.id and is_master) then raise exception '마스터 계정은 탈퇴할 수 없습니다.';end if;
  if exists(select 1 from private.admin_members where user_id=old.id) and (select count(*) from private.admin_members)<=1 then raise exception '마지막 관리자는 탈퇴할 수 없습니다.';end if;
  delete from public.posts where user_id=old.id;
  update public.requests set message='' where user_id=old.id;
  update public.change_logs set entity_id='deleted-account',before_data=(before_data-'nickname'-'email'-'user_id')||jsonb_build_object('account','탈퇴한 회원'),
    after_data=(after_data-'nickname'-'email'-'user_id')||jsonb_build_object('account','탈퇴한 회원') where entity='admin_members' and entity_id=old.id::text;
  return old;
end $$;
revoke all on function private.cleanup_deleted_account() from public,anon,authenticated;
create trigger cleanup_deleted_account before delete on auth.users for each row execute function private.cleanup_deleted_account();

revoke all on function public.save_food_preferences(jsonb,uuid),public.save_recommendation_history(uuid,text,jsonb,jsonb,uuid),public.set_history_visit(uuid,boolean),public.my_food_preferences(),public.reply_support_ticket(uuid,text),public.my_account_overview(),public.account_deletion_status() from public,anon,authenticated;
grant execute on function public.save_food_preferences(jsonb,uuid),public.save_recommendation_history(uuid,text,jsonb,jsonb,uuid),public.set_history_visit(uuid,boolean),public.my_food_preferences(),public.reply_support_ticket(uuid,text),public.my_account_overview(),public.account_deletion_status() to authenticated;

create or replace function public.recommend_candidates(p_filter jsonb default '{}')
returns table(restaurant jsonb,menus jsonb) language plpgsql stable security invoker set search_path='' as $$
declare lo integer:=nullif(p_filter->>'min','')::integer; hi integer:=nullif(p_filter->>'max','')::integer;
  day_ date:=coalesce(nullif(p_filter->>'date','')::date,(now() at time zone 'Asia/Seoul')::date);
  time_ time:=coalesce(nullif(p_filter->>'time','')::time,(now() at time zone 'Asia/Seoul')::time);
  check_hours boolean:=coalesce((p_filter->>'checkHours')::boolean,true);
  cats text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'categories','[]')));
  fs text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'forms','[]')));
  notcats text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'excludedCategories','[]')));
  notforms text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'excludedForms','[]')));
  terms text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'menuTerms','[]')));
  notterms text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'excludedTerms','[]')));
  stores text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'restaurantTerms','[]')));
  notids text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'excludedRestaurantIds','[]')));
  notstores text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'excludedRestaurants','[]')));
begin
  if (lo is not null and lo<0) or (hi is not null and hi<0) or lo>hi then raise exception '최소·최대 가격을 확인해 주세요.'; end if;
  return query select to_jsonb(r),coalesce(found.items,'[]'::jsonb)
  from public.restaurants r
  cross join lateral (
    select jsonb_agg(to_jsonb(m) order by m.source_index,m.id) items
    from public.menus m where m.restaurant_id=r.id and m.active
      and (cardinality(fs)=0 or m.forms && fs) and not(m.forms && notforms)
      and (lo is null or m.price>=lo) and (hi is null or m.price<=hi)
      and (cardinality(terms)=0 or exists(select 1 from unnest(terms) t where position(regexp_replace(lower(t),'\s','','g') in regexp_replace(lower(m.name),'\s','','g'))>0))
      and not exists(select 1 from unnest(notterms) t where position(regexp_replace(lower(t),'\s','','g') in regexp_replace(lower(m.name),'\s','','g'))>0)
  ) found
  where r.active and not(r.id=any(notids)) and (cardinality(cats)=0 or r.categories && cats) and not(r.categories && notcats)
    and (cardinality(fs)=0 or r.forms && fs)
    and (not check_hours or public.open_at(r.hours,day_,time_) is true)
    and (cardinality(stores)=0 or exists(select 1 from unnest(stores) t where position(regexp_replace(lower(t),'\s','','g') in regexp_replace(lower(r.name),'\s','','g'))>0))
    and not exists(select 1 from unnest(notstores) t where position(regexp_replace(lower(t),'\s','','g') in regexp_replace(lower(r.name),'\s','','g'))>0)
    and (found.items is not null or (lo is null and hi is null and cardinality(fs)=0 and cardinality(notforms)=0 and cardinality(terms)=0 and cardinality(notterms)=0));
end $$;

create or replace function public.pick_restaurants(p_filter jsonb default '{}',p_size integer default 1,p_locked text[] default '{}',p_prior jsonb default '{}')
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare eligible jsonb; pool jsonb; chosen jsonb:='[]'; item jsonb; menu jsonb; choices jsonb; count_ integer; fresh integer;
  preferred_categories text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'preferredCategories','[]')));
  preferred_forms text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'preferredForms','[]')));
begin
  if p_size not between 1 and 3 or p_size+cardinality(p_locked)>3 then raise exception '추천 개수를 확인해 주세요.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('restaurant',c.restaurant,'menus',c.menus)),'[]') into eligible from public.recommend_candidates(p_filter) c;
  count_:=jsonb_array_length(eligible);
  select coalesce(jsonb_agg(v),'[]') into pool from jsonb_array_elements(eligible) v where not(v->'restaurant'->>'id'=any(p_locked));
  select count(*) into fresh from jsonb_array_elements(pool) v where not(p_prior ? (v->'restaurant'->>'id'));
  if fresh>=least(p_size,jsonb_array_length(pool)) then
    select coalesce(jsonb_agg(v),'[]') into pool from jsonb_array_elements(pool) v where not(p_prior ? (v->'restaurant'->>'id'));
  end if;
  for item in select v from jsonb_array_elements(pool) v order by case when (v->'restaurant'->'categories') ?| preferred_categories then 1 else 0 end desc,
    case when exists(select 1 from jsonb_array_elements(v->'menus') m where (m->'forms') ?| preferred_forms) then 1 else 0 end desc,random() limit p_size loop
    choices:=item->'menus';
    if jsonb_array_length(choices)>1 then
      select jsonb_agg(v) into choices from jsonb_array_elements(choices) v where v->>'source_index' is distinct from p_prior->>(item->'restaurant'->>'id');
    end if;
    select v into menu from jsonb_array_elements(choices) v order by case when (v->'forms') ?| preferred_forms then 1 else 0 end desc,random() limit 1;
    chosen:=chosen||jsonb_build_array(item||jsonb_build_object('selected',menu));
  end loop;
  return jsonb_build_object('count',count_,'restaurants',chosen);
end $$;

notify pgrst,'reload schema';
commit;
