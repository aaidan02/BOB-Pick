begin;
-- Content copies live only beside their source post, so permanent erasure cascades.
create table private.post_versions(
  id bigint generated always as identity primary key,post_id uuid not null references public.posts(id) on delete cascade,
  title text not null,body text not null,photo_ids uuid[] not null,revision integer not null,
  reason text not null,actor_id uuid references auth.users(id) on delete set null,created_at timestamptz not null default now()
);
create index post_versions_post on private.post_versions(post_id,id desc);
create index post_versions_actor on private.post_versions(actor_id);
create table private.catalog_versions(
  id bigint generated always as identity primary key,restaurant_id text not null references public.restaurants(id) on delete cascade,
  snapshot jsonb not null,transaction_id bigint not null,actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),unique(restaurant_id,transaction_id)
);
create index catalog_versions_restaurant on private.catalog_versions(restaurant_id,id desc);
create index catalog_versions_actor on private.catalog_versions(actor_id);
alter table private.post_versions enable row level security;
alter table private.catalog_versions enable row level security;
revoke all on private.post_versions,private.catalog_versions from public,anon,authenticated,service_role;
revoke all on sequence private.post_versions_id_seq,private.catalog_versions_id_seq from public,anon,authenticated,service_role;

create function private.capture_post_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.is_admin() and (old.title,old.body,old.photo_ids,old.deleted_at) is distinct from (new.title,new.body,new.photo_ids,new.deleted_at) then
    insert into private.post_versions(post_id,title,body,photo_ids,revision,reason,actor_id)
    values(old.id,old.title,old.body,old.photo_ids,old.revision,case when new.deleted_at is not null and old.deleted_at is null then 'deleted' when new.deleted_at is null and old.deleted_at is not null then 'restored' else 'edited' end,auth.uid());
  end if;
  return new;
end $$;
create trigger posts_capture_version before update on public.posts for each row execute function private.capture_post_version();

create function private.catalog_snapshot(p_id text) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('restaurant',to_jsonb(r)-'updated_at','menus',coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.menus m where m.restaurant_id=r.id),'[]')) from public.restaurants r where r.id=p_id
$$;
create function private.capture_catalog_version() returns trigger language plpgsql security definer set search_path='' as $$
declare target text;
begin
  if public.is_admin() and (to_jsonb(old)-'updated_at') is distinct from (to_jsonb(new)-'updated_at') then
    if tg_table_name='restaurants' then target:=old.id;else target:=old.restaurant_id;end if;
    perform 1 from public.restaurants where id=target for update;
    insert into private.catalog_versions(restaurant_id,snapshot,transaction_id,actor_id)
    values(target,private.catalog_snapshot(target),txid_current(),auth.uid()) on conflict(restaurant_id,transaction_id) do nothing;
  end if;
  return new;
end $$;
create trigger restaurants_capture_version before update on public.restaurants for each row execute function private.capture_catalog_version();
create trigger menus_capture_version before update on public.menus for each row execute function private.capture_catalog_version();

create function public.admin_restore_items(p_kind text,p_query text default '',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if p_kind='post' then
    select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from (
      select p.id::text id,p.title,coalesce(pr.nickname,'탈퇴한 회원') subtitle,p.deleted_at is not null deleted,p.updated_at changed_at,
        (select count(*)::integer from private.post_versions v where v.post_id=p.id) version_count
      from public.posts p left join public.profiles pr on pr.id=p.user_id
      where public.account_content_visible(p.user_id) and (p.deleted_at is not null or exists(select 1 from private.post_versions v where v.post_id=p.id))
        and (coalesce(p_query,'')='' or position(lower(left(p_query,120)) in lower(p.title||' '||p.body||' '||coalesce(pr.nickname,'')))>0)
      order by p.updated_at desc,p.id limit 20 offset greatest(0,least(p_offset,100000))) q;
  elsif p_kind='restaurant' then
    select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from (
      select r.id,r.name title,r.address subtitle,not r.active deleted,max(v.created_at) changed_at,count(*)::integer version_count
      from public.restaurants r join private.catalog_versions v on v.restaurant_id=r.id
      where coalesce(p_query,'')='' or position(lower(left(p_query,120)) in lower(r.name||' '||r.address))>0
      group by r.id order by max(v.id) desc,r.id limit 20 offset greatest(0,least(p_offset,100000))) q;
  else raise exception '복원할 항목을 확인해 주세요.';end if;
  return result;
end $$;

create function public.admin_restore_preview(p_kind text,p_id text,p_version_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item public.posts; v private.post_versions; cv private.catalog_versions; current_ jsonb;target jsonb;versions jsonb;token text;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if p_kind='post' then
    select * into item from public.posts where id=p_id::uuid;
    if not found or not public.account_content_visible(item.user_id) then raise exception '복원할 수 있는 게시글이 아닙니다.';end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'created_at',q.created_at,'reason',q.reason) order by q.id desc),'[]') into versions from (select * from private.post_versions where post_id=item.id order by id desc limit 100) q;
    current_:=jsonb_build_object('title',item.title,'body',item.body,'photo_ids',item.photo_ids,'deleted',item.deleted_at is not null);
    if p_version_id is null and item.deleted_at is not null then target:=current_||'{"deleted":false}'::jsonb;
    else
      select * into v from private.post_versions where post_id=item.id and (p_version_id is null or id=p_version_id) order by id desc limit 1;
      if not found then raise exception '이전 내용이 보관되어 있지 않아요.';end if;
      target:=jsonb_build_object('title',v.title,'body',v.body,'photo_ids',v.photo_ids,'deleted',false);p_version_id:=v.id;
    end if;
    token:=item.revision::text;
  elsif p_kind='restaurant' then
    current_:=private.catalog_snapshot(p_id);
    if current_ is null then raise exception '가게를 찾을 수 없어요.';end if;
    select * into cv from private.catalog_versions where restaurant_id=p_id and (p_version_id is null or id=p_version_id) order by id desc limit 1;
    if not found then raise exception '이전 정보가 보관되어 있지 않아요.';end if;
    target:=cv.snapshot;p_version_id:=cv.id;token:=md5(current_::text);
    select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'created_at',q.created_at,'reason','edited') order by q.id desc),'[]') into versions from (select id,created_at from private.catalog_versions where restaurant_id=p_id order by id desc limit 100) q;
  else raise exception '복원할 항목을 확인해 주세요.';end if;
  return jsonb_build_object('kind',p_kind,'id',p_id,'version_id',p_version_id,'expected',token,'current',current_,'target',target,'versions',versions);
end $$;

create function public.admin_restore_selected(p_items jsonb,p_expected_actor uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare choice jsonb;preview jsonb;target jsonb;entry public.restaurants; m public.menus;item public.posts;count_ integer:=0;ids uuid[];
begin
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if p_expected_actor is distinct from auth.uid() then raise exception '계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception '한 번에 1~20개를 선택해 주세요.';end if;
  if jsonb_array_length(p_items)<>(select count(distinct (value->>'kind',value->>'id')) from jsonb_array_elements(p_items)) then raise exception '같은 항목을 중복 선택할 수 없어요.';end if;
  -- Deterministic locks + optimistic preview tokens prevent lost updates and partial batches.
  for choice in select value from jsonb_array_elements(p_items) order by value->>'kind',value->>'id' loop
    if choice->>'kind'='post' then
      select * into item from public.posts where id=(choice->>'id')::uuid for update;
      if not found then raise exception '게시글을 찾지 못했어요.';end if;
    elsif choice->>'kind'='restaurant' then
      perform 1 from public.restaurants where id=choice->>'id' for update;
      perform 1 from public.menus where restaurant_id=choice->>'id' order by id for update;
    else raise exception '복원할 항목을 확인해 주세요.';end if;
    preview:=public.admin_restore_preview(choice->>'kind',choice->>'id',(choice->>'version_id')::bigint);
    if choice->>'expected' is null or choice->>'expected'<>preview->>'expected' then raise exception '확인 후 변경된 항목이 있어요. 목록을 새로고침하고 다시 확인해 주세요.';end if;
    target:=preview->'target';
    if choice->>'kind'='post' then
      ids:=array(select jsonb_array_elements_text(target->'photo_ids'))::uuid[];
      if exists(select 1 from unnest(ids) x where not exists(select 1 from private.post_photos f where f.id=x and f.post_id=item.id and f.ready)) then raise exception '일부 사진을 복원할 수 없어 내용을 다시 확인해야 해요.';end if;
      update public.posts set title=target->>'title',body=target->>'body',photo_ids=ids,deleted_at=null,deleted_by=null where id=item.id;
      insert into public.change_logs(actor_id,entity,entity_id,action,before_data,after_data) values(auth.uid(),'posts',item.id::text,'post:version_restored',jsonb_build_object('revision',item.revision),jsonb_build_object('revision',item.revision+1,'version_id',preview->'version_id'));
    else
      entry:=jsonb_populate_record(null::public.restaurants,target->'restaurant');
      update public.restaurants set name=entry.name,address=entry.address,detail_address=entry.detail_address,phone=entry.phone,representative_menu=entry.representative_menu,latitude=entry.latitude,longitude=entry.longitude,categories=entry.categories,forms=entry.forms,hours_text=entry.hours_text,hours_display=entry.hours_display,hours=entry.hours,source_fields=entry.source_fields,active=entry.active where id=entry.id;
      update public.menus set active=false where restaurant_id=entry.id and id not in (select (value->>'id')::uuid from jsonb_array_elements(target->'menus'));
      for m in select * from jsonb_populate_recordset(null::public.menus,target->'menus') loop
        insert into public.menus(id,restaurant_id,source_index,name,price,variable_price,forms,active,created_at) values(m.id,entry.id,m.source_index,m.name,m.price,m.variable_price,m.forms,m.active,m.created_at)
        on conflict(id) do update set name=excluded.name,price=excluded.price,variable_price=excluded.variable_price,forms=excluded.forms,active=excluded.active;
      end loop;
      insert into public.change_logs(actor_id,entity,entity_id,action,before_data,after_data) values(auth.uid(),'restaurant',entry.id,'catalog:restored',jsonb_build_object('token',preview->>'expected'),jsonb_build_object('version_id',preview->'version_id'));
    end if;
    count_:=count_+1;
  end loop;
  return count_;
end $$;
revoke all on function private.capture_post_version(),private.catalog_snapshot(text),private.capture_catalog_version() from public,anon,authenticated,service_role;
revoke all on function public.admin_restore_items(text,text,integer),public.admin_restore_preview(text,text,bigint),public.admin_restore_selected(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_restore_items(text,text,integer),public.admin_restore_preview(text,text,bigint),public.admin_restore_selected(jsonb,uuid) to authenticated;
commit;
