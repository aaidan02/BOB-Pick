begin;
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
  exact_ids text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'restaurantIds','[]')));
  anchor public.restaurants; near_id text:=nullif(p_filter->>'nearRestaurantId',''); radius double precision:=nullif(p_filter->>'maxDistanceMeters','')::double precision;
  stores text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'restaurantTerms','[]')));
  notids text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'excludedRestaurantIds','[]')));
  notstores text[]:=array(select jsonb_array_elements_text(coalesce(p_filter->'excludedRestaurants','[]')));
begin
  if (lo is not null and lo<0) or (hi is not null and hi<0) or lo>hi then raise exception '최소·최대 가격을 확인해 주세요.'; end if;
  if radius is not null and (radius<=0 or radius>50000 or near_id is null) then raise exception '거리 조건을 확인해 주세요.';end if;
  if near_id is not null then
    select * into anchor from public.restaurants where id=near_id and active;
    if not found or anchor.latitude is null or anchor.longitude is null then raise exception '기준 장소의 좌표를 확인해 주세요.';end if;
  end if;
  return query select to_jsonb(r)||case when near_id is null then '{}'::jsonb else jsonb_build_object('distance_m',d.meters) end,coalesce(found.items,'[]'::jsonb)
  from public.restaurants r
  cross join lateral (select case when near_id is not null and r.latitude is not null and r.longitude is not null then
    round(6371000 * acos(least(1.0,greatest(-1.0,sin(radians(anchor.latitude))*sin(radians(r.latitude))+cos(radians(anchor.latitude))*cos(radians(r.latitude))*cos(radians(r.longitude-anchor.longitude))))))::integer end meters) d
  cross join lateral (
    select jsonb_agg(to_jsonb(m) order by m.source_index,m.id) items
    from public.menus m where m.restaurant_id=r.id and m.active
      and (cardinality(fs)=0 or m.forms && fs) and not(m.forms && notforms)
      and (lo is null or m.price>=lo) and (hi is null or m.price<=hi)
      and (cardinality(terms)=0 or exists(select 1 from unnest(terms) t where position(regexp_replace(lower(t),'\s','','g') in regexp_replace(lower(m.name),'\s','','g'))>0))
      and not exists(select 1 from unnest(notterms) t where position(regexp_replace(lower(t),'\s','','g') in regexp_replace(lower(m.name),'\s','','g'))>0)
  ) found
  where r.active and (cardinality(exact_ids)=0 or r.id=any(exact_ids))
    and (near_id is null or (r.id<>near_id and d.meters is not null and (radius is null or d.meters<=radius)))
    and not(r.id=any(notids)) and (cardinality(cats)=0 or r.categories && cats) and not(r.categories && notcats)
    and (cardinality(fs)=0 or r.forms && fs)
    and (not check_hours or public.open_at(r.hours,day_,time_) is true)
    and (cardinality(stores)=0 or exists(select 1 from unnest(stores) t where position(regexp_replace(lower(t),'\s','','g') in regexp_replace(lower(r.name),'\s','','g'))>0))
    and not exists(select 1 from unnest(notstores) t where position(regexp_replace(lower(t),'\s','','g') in regexp_replace(lower(r.name),'\s','','g'))>0)
    and (found.items is not null or (lo is null and hi is null and cardinality(fs)=0 and cardinality(notforms)=0 and cardinality(terms)=0 and cardinality(notterms)=0))
  order by d.meters asc nulls last,r.id;
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
  for item in select v from jsonb_array_elements(pool) v order by case when p_filter ? 'nearRestaurantId' then (v->'restaurant'->>'distance_m')::integer end asc nulls last,case when (v->'restaurant'->'categories') ?| preferred_categories then 1 else 0 end desc,
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
