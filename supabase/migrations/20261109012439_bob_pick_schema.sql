begin;
create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 40),
  created_at timestamptz not null default now()
);
create table private.admin_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create function public.is_admin() returns boolean language sql stable security definer
set search_path = '' as $$ select exists(select 1 from private.admin_members where user_id=auth.uid()) $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create function private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare n text;
begin
  n:=trim(new.raw_user_meta_data->>'nickname');
  if n is null or length(n) not between 2 and 40 then n:='밥친구_'||left(new.id::text,8); end if;
  insert into public.profiles(id,nickname) values(new.id,n);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.create_profile();
insert into public.profiles(id,nickname) select id,case when length(trim(raw_user_meta_data->>'nickname')) between 2 and 40 then trim(raw_user_meta_data->>'nickname') else '밥친구_'||left(id::text,8) end from auth.users on conflict(id) do nothing;

create table public.restaurants (
  id text primary key,
  name text not null check(length(trim(name)) between 1 and 200),
  address text not null default '', detail_address text not null default '', phone text not null default '',
  representative_menu text not null default '',
  latitude double precision check(latitude between -90 and 90), longitude double precision check(longitude between -180 and 180),
  categories text[] not null default '{}', forms text[] not null default '{}',
  hours_text text not null default '', hours_display text not null default '',
  hours jsonb not null default '{"days":{},"rules":{}}',
  source_fields jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.menus (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  source_index integer not null default 0,
  name text not null check(length(trim(name)) between 1 and 10000),
  price integer check(price>0), variable_price boolean not null default false,
  forms text[] not null default '{}', active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(restaurant_id,source_index),
  constraint variable_price_has_no_fixed_price check(not variable_price or price is null)
);
create index menus_restaurant_idx on public.menus(restaurant_id);
create index restaurants_categories_idx on public.restaurants using gin(categories);
create index menus_forms_idx on public.menus using gin(forms);
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_id uuid not null references public.menus(id) on delete cascade,
  created_at timestamptz not null default now(), unique(user_id,menu_id)
);
create index favorites_user_idx on public.favorites(user_id,created_at desc);
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  title text not null check(length(trim(title)) between 1 and 120),
  body text not null check(length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index posts_user_idx on public.posts(user_id);
create index posts_created_idx on public.posts(created_at desc);
create index posts_search_idx on public.posts using gin(to_tsvector('simple',title||' '||body));
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check(kind in ('correction','registration','promotion')),
  restaurant_id text references public.restaurants(id),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  message text not null default '' check(length(message)<=3000),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(), reviewed_at timestamptz,
  check(kind='registration' or restaurant_id is not null)
);
create index requests_user_idx on public.requests(user_id,created_at desc);
create index requests_status_idx on public.requests(status,created_at);
create table public.request_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.requests(id),
  reviewer_id uuid references auth.users(id) on delete set null,
  decision text not null check(decision in ('approved','rejected')),
  note text not null default '' check(length(note)<=3000), created_at timestamptz not null default now()
);
create table public.change_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  request_id uuid references public.requests(id),
  entity text not null, entity_id text not null, action text not null,
  before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurants(id),
  request_id uuid not null unique references public.requests(id),
  title text not null check(length(trim(title)) between 1 and 120),
  content text not null check(length(trim(content)) between 1 and 3000),
  ends_at timestamptz not null, created_at timestamptz not null default now(),check(ends_at>created_at)
);
create table private.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null, calls integer not null default 1,
  primary key(user_id,day)
);
create table public.holidays (day date primary key, kinds text[] not null);

create function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at:=clock_timestamp(); return new; end $$;
create trigger posts_updated before update on public.posts for each row execute function private.touch_updated_at();
create trigger restaurants_updated before update on public.restaurants for each row execute function private.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.restaurants enable row level security;
alter table public.menus enable row level security;
alter table public.favorites enable row level security;
alter table public.posts enable row level security;
alter table public.requests enable row level security;
alter table public.request_reviews enable row level security;
alter table public.change_logs enable row level security;
alter table public.promotions enable row level security;
alter table public.holidays enable row level security;
create policy profiles_read on public.profiles for select using(true);
create policy profiles_edit on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy restaurants_read on public.restaurants for select using(active or (select public.is_admin()));
create policy menus_read on public.menus for select using((active and exists(select 1 from public.restaurants r where r.id=restaurant_id and r.active)) or (select public.is_admin()));
create policy favorites_read on public.favorites for select to authenticated using(user_id=(select auth.uid()));
create policy favorites_add on public.favorites for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.menus m join public.restaurants r on r.id=m.restaurant_id where m.id=menu_id and m.active and r.active));
create policy favorites_remove on public.favorites for delete to authenticated using(user_id=(select auth.uid()));
create policy posts_read on public.posts for select using(true);
create policy posts_add on public.posts for insert to authenticated with check(user_id=(select auth.uid()));
create policy posts_edit on public.posts for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy posts_remove on public.posts for delete to authenticated using(user_id=(select auth.uid()) or (select public.is_admin()));
create policy requests_read on public.requests for select to authenticated using(user_id=(select auth.uid()) or (select public.is_admin()));
create policy reviews_read on public.request_reviews for select to authenticated using((select public.is_admin()) or exists(select 1 from public.requests q where q.id=request_id and q.user_id=(select auth.uid())));
create policy logs_read on public.change_logs for select to authenticated using((select public.is_admin()));
create policy promotions_read on public.promotions for select using(ends_at>now());
create policy holidays_read on public.holidays for select using(true);

revoke all on public.profiles,public.restaurants,public.menus,public.favorites,public.posts,public.requests,public.request_reviews,public.change_logs,public.promotions,public.holidays from anon,authenticated;
grant select on public.profiles,public.restaurants,public.menus,public.posts,public.promotions,public.holidays to anon,authenticated;
grant update(nickname) on public.profiles to authenticated;
grant select,insert,delete on public.favorites to authenticated;
grant insert(user_id,title,body),update(title,body),delete on public.posts to authenticated;
grant select on public.requests,public.request_reviews,public.change_logs to authenticated;

create function public.submit_request(p_kind text,p_restaurant_id text,p_payload jsonb,p_message text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if octet_length(p_payload::text)>50000 then raise exception '신청 내용이 너무 깁니다.'; end if;
  if (select count(*) from public.requests where user_id=auth.uid() and created_at>now()-interval '1 day')>=20 then raise exception '오늘 신청 가능한 횟수를 초과했습니다.'; end if;
  insert into public.requests(user_id,kind,restaurant_id,payload,message)
  values(auth.uid(),p_kind,p_restaurant_id,p_payload,p_message) returning id into result;
  return result;
end $$;
revoke all on function public.submit_request(text,text,jsonb,text) from public;
grant execute on function public.submit_request(text,text,jsonb,text) to authenticated;

create function public.consume_ai_quota() returns void language plpgsql security definer set search_path='' as $$
declare used integer;
begin
  if auth.uid() is null then raise exception 'AI 추천은 로그인 후 사용할 수 있습니다.'; end if;
  insert into private.ai_usage(user_id,day,calls) values(auth.uid(),(now() at time zone 'Asia/Seoul')::date,1)
  on conflict(user_id,day) do update set calls=private.ai_usage.calls+1 where private.ai_usage.calls<20
  returning calls into used;
  if used is null then raise exception '오늘 AI 추천 횟수를 모두 사용했습니다.'; end if;
end $$;
revoke all on function public.consume_ai_quota() from public;
grant execute on function public.consume_ai_quota() to authenticated;

-- Approval, catalog edits, review, and audit entry commit in one transaction.
create function public.review_request(p_request_id uuid,p_decision text,p_note text default '') returns void
language plpgsql security definer set search_path='' as $$
declare q public.requests; target text; before_row jsonb; after_row jsonb; m jsonb; cats text[]; forms_ text[]; menu_index integer:=0;
begin
  if not public.is_admin() then raise exception '관리자 권한이 필요합니다.'; end if;
  if p_decision not in ('approved','rejected') or p_decision is null then raise exception '처리 상태를 확인해 주세요.'; end if;
  select * into q from public.requests where id=p_request_id for update;
  if not found or q.status<>'pending' then raise exception '이미 처리됐거나 없는 신청입니다.'; end if;
  target:=q.restaurant_id;
  if p_decision='approved' then
    if q.kind='registration' then
      target:=gen_random_uuid()::text;
      select coalesce(array_agg(value),'{}') into cats from jsonb_array_elements_text(coalesce(q.payload->'categories','[]'));
      select coalesce(array_agg(value),'{}') into forms_ from jsonb_array_elements_text(coalesce(q.payload->'forms','[]'));
      insert into public.restaurants(id,name,address,phone,latitude,longitude,categories,forms,hours_text,hours_display)
      values(target,q.payload->>'name',coalesce(q.payload->>'address',''),coalesce(q.payload->>'phone',''),nullif(q.payload->>'latitude','')::float8,nullif(q.payload->>'longitude','')::float8,cats,forms_,coalesce(q.payload->>'hours_text',''),coalesce(q.payload->>'hours_display',''));
      for m in select value from jsonb_array_elements(coalesce(q.payload->'menus','[]')) loop
        insert into public.menus(restaurant_id,source_index,name,price,variable_price,forms)
        values(target,menu_index,m->>'name',nullif(m->>'price','')::integer,coalesce((m->>'variable_price')::boolean,false),array(select jsonb_array_elements_text(coalesce(m->'forms','[]'))));
        menu_index:=menu_index+1;
      end loop;
      update public.requests set restaurant_id=target where id=q.id;
    elsif q.kind='correction' then
      select to_jsonb(r) into before_row from public.restaurants r where r.id=target for update;
      if before_row is null then raise exception '음식점을 찾을 수 없습니다.'; end if;
      update public.restaurants set name=coalesce(q.payload->>'name',name),address=coalesce(q.payload->>'address',address),phone=coalesce(q.payload->>'phone',phone),
        hours_text=coalesce(q.payload->>'hours_text',hours_text),hours_display=coalesce(q.payload->>'hours_display',hours_display),
        active=coalesce((q.payload->>'active')::boolean,active),
        latitude=case when q.payload?'latitude' then nullif(q.payload->>'latitude','')::float8 else latitude end,
        longitude=case when q.payload?'longitude' then nullif(q.payload->>'longitude','')::float8 else longitude end
      where id=target;
      if q.payload ? 'menu_patch' then
        m:=q.payload->'menu_patch';
        before_row:=before_row||jsonb_build_object('menu',(select to_jsonb(v) from public.menus v where v.id=(m->>'id')::uuid and v.restaurant_id=target));
        update public.menus set price=nullif(m->>'price','')::integer,variable_price=coalesce((m->>'variable_price')::boolean,false)
          where id=(m->>'id')::uuid and restaurant_id=target;
        if not found then raise exception '해당 음식점의 메뉴가 아닙니다.'; end if;
      end if;
    else
      insert into public.promotions(restaurant_id,request_id,title,content,ends_at)
      values(target,q.id,q.payload->>'title',q.payload->>'content',(q.payload->>'ends_at')::timestamptz);
    end if;
    select to_jsonb(r) into after_row from public.restaurants r where r.id=target;
    if q.kind='correction' and q.payload ? 'menu_patch' then
      after_row:=after_row||jsonb_build_object('menu',(select to_jsonb(v) from public.menus v where v.id=(q.payload->'menu_patch'->>'id')::uuid and v.restaurant_id=target));
    end if;
  end if;
  update public.requests set status=p_decision,reviewed_at=now() where id=q.id;
  insert into public.request_reviews(request_id,reviewer_id,decision,note) values(q.id,auth.uid(),p_decision,coalesce(p_note,''));
  insert into public.change_logs(actor_id,request_id,entity,entity_id,action,before_data,after_data)
  values(auth.uid(),q.id,case when q.kind='promotion' then 'promotion' else 'restaurant' end,coalesce(target,q.id::text),q.kind||':'||p_decision,before_row,
    case when q.kind='promotion' then q.payload else after_row end);
end $$;
revoke all on function public.review_request(uuid,text,text) from public;
grant execute on function public.review_request(uuid,text,text) to authenticated;
commit;
