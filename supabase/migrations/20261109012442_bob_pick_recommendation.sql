begin;
create function public.parse_hours(p_text text) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:='{"days":{"월":null,"화":null,"수":null,"목":null,"금":null,"토":null,"일":null},"rules":{}}';
  field text; k text; v text; part text; pair text[]; windows jsonb; a integer; b integer; t text; mins integer[]; rule text;
begin
  if p_text is null or trim(p_text) in ('','미확인') then return result; end if;
  foreach field in array regexp_split_to_array(p_text,'\s*\|\s*') loop
    if position('=' in field)=0 then raise exception 'format'; end if;
    k:=trim(split_part(field,'=',1)); v:=trim(substring(field from position('=' in field)+1));
    if k in ('고정휴무','정기휴무','영업조건') then
      foreach rule in array string_to_array(v,',') loop
        if k='고정휴무' then
          if to_char(('2000-'||rule)::date,'MM-DD')<>rule then raise exception 'rule'; end if;
        elsif rule !~ '^[월화수목금토일]#([1-5]|마지막)$' then raise exception 'rule'; end if;
      end loop;
      result:=jsonb_set(result,array['rules',k],to_jsonb(string_to_array(v,',')));
    else
      if k not in ('월','화','수','목','금','토','일','명절','명절당일','설날','설날당일','추석','추석당일') and k not like '공휴일%' then raise exception 'day'; end if;
      windows:='[]';
      if v='미확인' then windows:='null';
      elsif v<>'휴무' then
        foreach part in array string_to_array(v,',') loop
          pair:=string_to_array(trim(part),'~'); if cardinality(pair)<>2 then raise exception 'window'; end if;
          mins:='{}';
          foreach t in array pair loop
            t:=trim(t); a:=0;
            if starts_with(t,'익일') then a:=1440; t:=substring(t from 3); end if;
            if t='24:00' then a:=a+1440;
            elsif t ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then a:=a+split_part(t,':',1)::integer*60+split_part(t,':',2)::integer;
            else raise exception 'time'; end if;
            mins:=array_append(mins,a);
          end loop;
          a:=mins[1]; b:=mins[2]; if b<a then b:=b+1440; end if;
          if b<=a or b-a>1440 then raise exception 'window'; end if;
          windows:=windows||jsonb_build_array(jsonb_build_array(a,b));
        end loop;
      end if;
      result:=jsonb_set(result,array['days',k],windows);
    end if;
  end loop;
  return result;
exception when others then return '{"days":{"월":null,"화":null,"수":null,"목":null,"금":null,"토":null,"일":null},"rules":{}}';
end $$;
create function private.refresh_hours() returns trigger language plpgsql set search_path='' as $$
begin new.hours:=public.parse_hours(new.hours_text); return new; end $$;
create trigger restaurants_hours before insert or update of hours_text on public.restaurants for each row execute function private.refresh_hours();

create function public.windows_on_day(p_hours jsonb,p_day date) returns jsonb language plpgsql stable set search_path='' as $$
declare weekday text:=(array['월','화','수','목','금','토','일'])[extract(isodow from p_day)::integer];
  rules jsonb:=coalesce(p_hours->'rules','{}'); days jsonb:=coalesce(p_hours->'days','{}'); rule text; matches boolean;
  normal jsonb; kinds text[]; k text; special text; chosen jsonb;
begin
  if (rules->'고정휴무') ? to_char(p_day,'MM-DD') then return '[]'; end if;
  foreach k in array array['정기휴무','영업조건'] loop
    for rule in select jsonb_array_elements_text(coalesce(rules->k,'[]')) loop
      matches:=split_part(rule,'#',1)=weekday and
        case when split_part(rule,'#',2)='마지막' then extract(month from p_day+7)<>extract(month from p_day)
        else ((extract(day from p_day)::integer-1)/7+1)::text=split_part(rule,'#',2) end;
      if (k='정기휴무' and matches) or (k='영업조건' and starts_with(rule,weekday||'#') and not matches) then return '[]'; end if;
    end loop;
  end loop;
  normal:=nullif(days->weekday,'null'::jsonb);
  if not exists(select 1 from jsonb_object_keys(days) key where key not in ('월','화','수','목','금','토','일')) then return normal; end if;
  if extract(year from p_day) not between 2020 and 2035 then return null; end if;
  select h.kinds into kinds from public.holidays h where h.day=p_day;
  foreach special in array array['추석당일','설날당일','명절당일','추석','설날','명절'] loop
    k:=case special when '추석당일' then 'chuseok_day' when '설날당일' then 'seollal_day' when '명절당일' then 'lunar_day' when '추석' then 'chuseok' when '설날' then 'seollal' else 'lunar' end;
    if days ? special and k=any(kinds) then return nullif(days->special,'null'::jsonb); end if;
  end loop;
  if 'public'=any(kinds) then
    k:=case when days ? ('공휴일'||weekday) then '공휴일'||weekday else '공휴일' end;
    chosen:=case when days ? k then nullif(days->k,'null'::jsonb) else normal end;
    if normal='[]'::jsonb and jsonb_array_length(chosen)>0 then return null; end if;
    return chosen;
  end if;
  return normal;
end $$;
create function public.open_at(p_hours jsonb,p_day date,p_time time) returns boolean language plpgsql stable set search_path='' as $$
declare today jsonb:=public.windows_on_day(p_hours,p_day); yesterday jsonb:=public.windows_on_day(p_hours,p_day-1);
  point integer:=extract(hour from p_time)::integer*60+extract(minute from p_time)::integer;
begin
  if exists(select 1 from jsonb_array_elements(today) w where point>=(w->>0)::integer and point<(w->>1)::integer)
    or exists(select 1 from jsonb_array_elements(yesterday) w where point+1440>=(w->>0)::integer and point+1440<(w->>1)::integer) then return true; end if;
  if today is null or yesterday is null then return null; end if;
  return false;
end $$;

-- Both manual search and AI use this same per-menu intersection.
create function public.recommend_candidates(p_filter jsonb default '{}')
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
  where r.active and (cardinality(cats)=0 or r.categories && cats) and not(r.categories && notcats)
    and (cardinality(fs)=0 or r.forms && fs)
    and (not check_hours or public.open_at(r.hours,day_,time_) is true)
    and (cardinality(stores)=0 or exists(select 1 from unnest(stores) t where position(regexp_replace(lower(t),'\s','','g') in regexp_replace(lower(r.name),'\s','','g'))>0))
    and not exists(select 1 from unnest(notstores) t where position(regexp_replace(lower(t),'\s','','g') in regexp_replace(lower(r.name),'\s','','g'))>0)
    and (found.items is not null or (lo is null and hi is null and cardinality(fs)=0 and cardinality(notforms)=0 and cardinality(terms)=0 and cardinality(notterms)=0));
end $$;

create function public.pick_restaurants(p_filter jsonb default '{}',p_size integer default 1,p_locked text[] default '{}',p_prior jsonb default '{}')
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare eligible jsonb; pool jsonb; chosen jsonb:='[]'; item jsonb; menu jsonb; choices jsonb; count_ integer; fresh integer;
begin
  if p_size not between 1 and 3 or p_size+cardinality(p_locked)>3 then raise exception '추천 개수를 확인해 주세요.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('restaurant',c.restaurant,'menus',c.menus)),'[]') into eligible from public.recommend_candidates(p_filter) c;
  count_:=jsonb_array_length(eligible);
  select coalesce(jsonb_agg(v),'[]') into pool from jsonb_array_elements(eligible) v where not(v->'restaurant'->>'id'=any(p_locked));
  select count(*) into fresh from jsonb_array_elements(pool) v where not(p_prior ? (v->'restaurant'->>'id'));
  if fresh>=least(p_size,jsonb_array_length(pool)) then
    select coalesce(jsonb_agg(v),'[]') into pool from jsonb_array_elements(pool) v where not(p_prior ? (v->'restaurant'->>'id'));
  end if;
  for item in select v from jsonb_array_elements(pool) v order by random() limit p_size loop
    choices:=item->'menus';
    if jsonb_array_length(choices)>1 then
      select jsonb_agg(v) into choices from jsonb_array_elements(choices) v where v->>'source_index' is distinct from p_prior->>(item->'restaurant'->>'id');
    end if;
    select v into menu from jsonb_array_elements(choices) v order by random() limit 1;
    chosen:=chosen||jsonb_build_array(item||jsonb_build_object('selected',menu));
  end loop;
  return jsonb_build_object('count',count_,'restaurants',chosen);
end $$;
revoke all on function public.parse_hours(text),public.windows_on_day(jsonb,date),public.open_at(jsonb,date,time),public.recommend_candidates(jsonb),public.pick_restaurants(jsonb,integer,text[],jsonb) from public;
grant execute on function public.parse_hours(text),public.windows_on_day(jsonb,date),public.open_at(jsonb,date,time),public.recommend_candidates(jsonb),public.pick_restaurants(jsonb,integer,text[],jsonb) to anon,authenticated;
commit;
