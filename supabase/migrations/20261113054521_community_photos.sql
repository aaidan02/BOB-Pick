begin;
-- Private Storage objects are only served after checking the current post/account state.
alter table public.posts add column photo_ids uuid[] not null default '{}' check(cardinality(photo_ids)<=3);
create table private.post_photos(
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  object_key text not null unique,mime text not null check(mime in ('image/jpeg','image/png','image/webp')),
  size_bytes integer not null check(size_bytes between 1 and 5242880),ready boolean not null default false,created_at timestamptz not null default now()
);
create index post_photos_owner on private.post_photos(owner_id) where post_id is null;
create index post_photos_post on private.post_photos(post_id);
create table private.media_cleanup_queue(object_key text primary key,lease_id uuid,leased_until timestamptz,created_at timestamptz not null default now());
create table private.media_cleanup_tickets(id uuid primary key default gen_random_uuid(),expires_at timestamptz not null default now()+interval '2 minutes');
create table private.media_config(singleton boolean primary key default true check(singleton),function_url text);
insert into private.media_config(singleton) values(true);
alter table private.post_photos enable row level security;
alter table private.media_cleanup_queue enable row level security;
alter table private.media_cleanup_tickets enable row level security;
alter table private.media_config enable row level security;
revoke all on private.post_photos,private.media_cleanup_queue,private.media_cleanup_tickets,private.media_config from public,anon,authenticated,service_role;

create function private.queue_photo_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into private.media_cleanup_queue(object_key) values(old.object_key) on conflict do nothing;return old;end $$;
create trigger photo_object_cleanup after delete on private.post_photos for each row execute function private.queue_photo_delete();

create function public.reserve_post_photo(p_mime text,p_size integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare photo private.post_photos; new_id uuid:=gen_random_uuid();
begin
  if not public.is_active_member() then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  if p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp') or p_size is null or p_size not between 1 and 5242880 then raise exception '사진은 JPG·PNG·WebP, 한 장에 5MB까지 첨부할 수 있어요.';end if;
  if (select count(*) from private.post_photos where owner_id=auth.uid() and post_id is null)>=6 then raise exception '첨부 대기 중인 사진이 많아요. 사용하지 않는 사진을 지우고 다시 시도해 주세요.';end if;
  insert into private.post_photos(id,owner_id,object_key,mime,size_bytes) values(new_id,auth.uid(),new_id::text||case p_mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end,p_mime,p_size) returning * into photo;
  return jsonb_build_object('id',photo.id,'object_key',photo.object_key,'mime',photo.mime);
end $$;
create function public.finish_post_photo(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin update private.post_photos set ready=true where id=p_id and post_id is null; if not found then raise exception '사진 첨부를 확인하지 못했어요.';end if;end $$;
create function public.discard_post_photo(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_active_member() then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  delete from private.post_photos where id=p_id and owner_id=auth.uid() and post_id is null;
end $$;
create function public.post_photo_access(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare photo private.post_photos; item public.posts; actor boolean:=public.is_active_member();
begin
  select * into photo from private.post_photos where id=p_id and ready;
  if not found then raise exception using errcode='42501',message='사진을 볼 수 없어요.';end if;
  if photo.post_id is null then
    if not actor or photo.owner_id<>auth.uid() then raise exception using errcode='42501',message='사진을 볼 수 없어요.';end if;
  else
    select * into item from public.posts where id=photo.post_id;
    if not found or not public.account_content_visible(item.user_id) or (auth.uid() is not null and not actor) then raise exception using errcode='42501',message='사진을 볼 수 없어요.';end if;
    if not (item.deleted_at is null and photo.id=any(item.photo_ids)) and not (actor and (public.is_admin() or item.user_id=auth.uid())) then raise exception using errcode='42501',message='사진을 볼 수 없어요.';end if;
  end if;
  return jsonb_build_object('object_key',photo.object_key,'mime',photo.mime);
end $$;

create function public.save_post(p_id uuid,p_title text,p_body text,p_photos uuid[],p_expected_revision integer,p_expected_actor uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare item public.posts; target uuid:=coalesce(p_id,gen_random_uuid()); privileged boolean; photo private.post_photos;
begin
  if not public.is_active_member() then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  if p_expected_actor is distinct from auth.uid() then raise exception '계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  if p_title is null or length(trim(p_title)) not between 1 and 120 or p_body is null or length(trim(p_body)) not between 1 and 10000 then raise exception '제목과 내용을 확인해 주세요.';end if;
  if p_photos is null or cardinality(p_photos)>3 or cardinality(p_photos)<>(select count(distinct x) from unnest(p_photos) x) then raise exception '사진은 서로 다른 파일로 최대 3장까지 첨부할 수 있어요.';end if;
  privileged:=public.is_admin();
  if p_id is not null then
    select * into item from public.posts where id=p_id for update;
    if not found or not public.account_content_visible(item.user_id) then raise exception '수정할 수 있는 게시글이 아닙니다.';end if;
    if not privileged and (item.user_id is distinct from auth.uid() or item.deleted_at is not null) then raise exception using errcode='42501',message='게시글 수정 권한이 없습니다.';end if;
    if p_expected_revision is null or item.revision<>p_expected_revision then raise exception '다른 곳에서 변경된 글입니다. 목록을 새로고침해 주세요.';end if;
  end if;
  for photo in select * from private.post_photos where id=any(p_photos) order by id for update loop
    if not photo.ready or not (photo.post_id is not distinct from target or (photo.post_id is null and photo.owner_id=auth.uid())) then raise exception using errcode='42501',message='첨부할 수 없는 사진이 있어요. 사진을 다시 선택해 주세요.';end if;
  end loop;
  if (select count(*) from private.post_photos where id=any(p_photos))<>cardinality(p_photos) then raise exception '사진을 다시 선택해 주세요.';end if;
  if p_id is null then insert into public.posts(id,user_id,title,body,photo_ids) values(target,auth.uid(),trim(p_title),trim(p_body),p_photos);
  else
    update public.posts set title=trim(p_title),body=trim(p_body),photo_ids=p_photos where id=target;
    if privileged then insert into public.change_logs(actor_id,entity,entity_id,action,before_data,after_data) values(auth.uid(),'posts',target::text,'post:edited',jsonb_build_object('revision',item.revision),jsonb_build_object('revision',item.revision+1));end if;
  end if;
  update private.post_photos set post_id=target,owner_id=coalesce(item.user_id,auth.uid()) where id=any(p_photos) and post_id is null;
  return target;
end $$;

-- Keep existing search APIs; attach IDs only, never bucket URLs or image bytes.
drop function public.search_posts(text,integer,boolean);
create function public.search_posts(p_query text default '',p_offset integer default 0,p_mine boolean default false)
returns table(id uuid,user_id uuid,title text,body text,created_at timestamptz,updated_at timestamptz,author_name text,revision integer,photo_ids uuid[])
language sql stable security invoker set search_path='' as $$
  select p.id,p.user_id,p.title,p.body,p.created_at,p.updated_at,coalesce(pr.nickname,'탈퇴한 회원'),p.revision,p.photo_ids
  from public.posts p left join public.profiles pr on pr.id=p.user_id
  where (not p_mine or p.user_id=auth.uid()) and (coalesce(p_query,'')='' or position(lower(left(p_query,120)) in lower(p.title||' '||p.body))>0)
  order by p.created_at desc,p.id limit 20 offset greatest(0,least(p_offset,100000))
$$;
drop function public.admin_search_posts(text,text,integer);
create function public.admin_search_posts(p_query text default '',p_state text default 'all',p_offset integer default 0)
returns table(id uuid,user_id uuid,title text,body text,created_at timestamptz,updated_at timestamptz,author_name text,deleted_at timestamptz,revision integer,photo_ids uuid[])
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if p_state not in ('all','published','deleted') or p_state is null then raise exception '게시글 상태를 확인해 주세요.';end if;
  return query select p.id,p.user_id,p.title,p.body,p.created_at,p.updated_at,coalesce(pr.nickname,'탈퇴한 회원'),p.deleted_at,p.revision,p.photo_ids
  from public.posts p left join public.profiles pr on pr.id=p.user_id
  where public.account_content_visible(p.user_id) and (p_state='all' or (p_state='deleted')=(p.deleted_at is not null))
    and (coalesce(p_query,'')='' or position(lower(left(p_query,120)) in lower(p.title||' '||p.body||' '||coalesce(pr.nickname,'')))>0)
  order by p.created_at desc,p.id limit 20 offset greatest(0,least(p_offset,100000));
end $$;

-- A single-use cron ticket authorizes the Edge worker. Storage deletes use its API,
-- never DELETE FROM storage.objects (which would leave physical files behind).
create function public.claim_media_cleanup(p_ticket uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare claimed uuid; lease uuid:=gen_random_uuid(); result jsonb;
begin
  delete from private.media_cleanup_tickets where id=p_ticket and expires_at>now() returning id into claimed;
  if claimed is null then raise exception using errcode='42501',message='정리 요청을 확인할 수 없습니다.';end if;
  delete from private.post_photos where post_id is null and created_at<now()-interval '1 day';
  with targets as (select object_key from private.media_cleanup_queue where leased_until is null or leased_until<now() order by created_at limit 100 for update skip locked),
  updated as (update private.media_cleanup_queue q set lease_id=lease,leased_until=now()+interval '3 minutes' from targets t where q.object_key=t.object_key returning q.object_key)
  select coalesce(jsonb_agg(object_key),'[]') into result from updated;
  return jsonb_build_object('lease',lease,'keys',result);
end $$;
create function public.ack_media_cleanup(p_lease uuid) returns void language sql security definer set search_path='' as $$delete from private.media_cleanup_queue where lease_id=p_lease$$;
create function private.dispatch_media_cleanup() returns void language plpgsql security definer set search_path='' as $$
declare target text;ticket uuid;
begin
  delete from private.media_cleanup_tickets where expires_at<now();
  if not exists(select 1 from private.media_cleanup_queue) and not exists(select 1 from private.post_photos where post_id is null and created_at<now()-interval '1 day') then return;end if;
  select function_url into target from private.media_config where singleton;
  if target is null then return;end if;
  insert into private.media_cleanup_tickets default values returning id into ticket;
  execute 'select net.http_post(url:=$1,body:=$2,headers:=$3,timeout_milliseconds:=15000)'
    using target||'?cleanup=1',jsonb_build_object('ticket',ticket),jsonb_build_object('Content-Type','application/json');
end $$;
revoke all on function private.queue_photo_delete(),private.dispatch_media_cleanup() from public,anon,authenticated,service_role;
revoke all on function public.reserve_post_photo(text,integer),public.finish_post_photo(uuid),public.discard_post_photo(uuid),public.post_photo_access(uuid),public.save_post(uuid,text,text,uuid[],integer,uuid),public.search_posts(text,integer,boolean),public.admin_search_posts(text,text,integer),public.claim_media_cleanup(uuid),public.ack_media_cleanup(uuid) from public,anon,authenticated,service_role;
grant execute on function public.reserve_post_photo(text,integer),public.discard_post_photo(uuid),public.save_post(uuid,text,text,uuid[],integer,uuid),public.admin_search_posts(text,text,integer) to authenticated;
grant execute on function public.post_photo_access(uuid),public.search_posts(text,integer,boolean) to anon,authenticated;
grant execute on function public.finish_post_photo(uuid),public.claim_media_cleanup(uuid),public.ack_media_cleanup(uuid) to service_role;
do $$begin
  if exists(select 1 from pg_available_extensions where name='pg_net') then execute 'create extension if not exists pg_net with schema extensions';end if;
  if exists(select 1 from pg_extension where extname='pg_cron') then perform cron.schedule('bob-pick-media-cleanup','*/5 * * * *','select private.dispatch_media_cleanup()');end if;
end $$;
commit;
