begin;
alter table public.posts add column deleted_at timestamptz,add column deleted_by uuid references auth.users(id) on delete set null,add column revision integer not null default 1;
alter table public.requests add column revision integer not null default 1;
alter table public.support_tickets add column revision integer not null default 1;
create index posts_moderation_time on public.posts(deleted_at,created_at desc,id desc);
create index posts_deleted_by on public.posts(deleted_by);
create function private.bump_record_revision() returns trigger language plpgsql set search_path='' as $$
begin new.revision:=old.revision+1;return new;end $$;
revoke all on function private.bump_record_revision() from public,anon,authenticated;
create trigger posts_revision before update on public.posts for each row execute function private.bump_record_revision();
create trigger requests_revision before update on public.requests for each row execute function private.bump_record_revision();
create trigger support_revision before update on public.support_tickets for each row execute function private.bump_record_revision();
alter policy posts_read on public.posts using(deleted_at is null and public.account_content_visible(user_id));
alter policy posts_edit on public.posts using(user_id=(select auth.uid()) and deleted_at is null) with check(user_id=(select auth.uid()) and deleted_at is null);
revoke delete on public.posts from authenticated,anon;

drop function public.search_posts(text,integer,boolean);
create function public.search_posts(p_query text default '',p_offset integer default 0,p_mine boolean default false)
returns table(id uuid,user_id uuid,title text,body text,created_at timestamptz,updated_at timestamptz,author_name text,revision integer)
language sql stable security invoker set search_path='' as $$
  select p.id,p.user_id,p.title,p.body,p.created_at,p.updated_at,coalesce(pr.nickname,'탈퇴한 회원'),p.revision
  from public.posts p left join public.profiles pr on pr.id=p.user_id
  where (not p_mine or p.user_id=auth.uid()) and (coalesce(p_query,'')='' or position(lower(left(p_query,120)) in lower(p.title||' '||p.body))>0)
  order by p.created_at desc,p.id limit 20 offset greatest(0,least(p_offset,100000))
$$;
revoke all on function public.search_posts(text,integer,boolean) from public,anon,authenticated;
grant execute on function public.search_posts(text,integer,boolean) to anon,authenticated;

create function public.admin_search_posts(p_query text default '',p_state text default 'all',p_offset integer default 0)
returns table(id uuid,user_id uuid,title text,body text,created_at timestamptz,updated_at timestamptz,author_name text,deleted_at timestamptz,revision integer)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if p_state not in ('all','published','deleted') or p_state is null then raise exception '게시글 상태를 확인해 주세요.';end if;
  return query select p.id,p.user_id,p.title,p.body,p.created_at,p.updated_at,coalesce(pr.nickname,'탈퇴한 회원'),p.deleted_at,p.revision
  from public.posts p left join public.profiles pr on pr.id=p.user_id
  where public.account_content_visible(p.user_id) and (p_state='all' or (p_state='deleted')=(p.deleted_at is not null))
    and (coalesce(p_query,'')='' or position(lower(left(p_query,120)) in lower(p.title||' '||p.body||' '||coalesce(pr.nickname,'')))>0)
  order by p.created_at desc,p.id limit 20 offset greatest(0,least(p_offset,100000));
end $$;

create function public.set_post_visibility(p_id uuid,p_deleted boolean,p_expected_revision integer,p_expected_actor uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare item public.posts; privileged boolean;
begin
  if not public.is_active_member() then raise exception using errcode='42501',message='로그인 후 이용해 주세요.';end if;
  if p_expected_actor is not null and p_expected_actor<>auth.uid() then raise exception '계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  privileged:=public.is_admin();select * into item from public.posts where id=p_id for update;
  if not found then raise exception '게시글을 찾지 못했습니다.';end if;
  if not privileged and (item.user_id is distinct from auth.uid() or p_deleted is not true) then raise exception using errcode='42501',message='게시글 관리 권한이 없습니다.';end if;
  if p_deleted is null or p_expected_revision is null or p_expected_revision<>item.revision then raise exception '다른 곳에서 변경된 글입니다. 목록을 새로고침해 주세요.';end if;
  if not p_deleted and not public.account_content_visible(item.user_id) then raise exception '탈퇴 중인 회원의 글은 복원할 수 없습니다.';end if;
  if (item.deleted_at is not null)=p_deleted then return;end if;
  update public.posts set deleted_at=case when p_deleted then clock_timestamp() else null end,deleted_by=case when p_deleted then auth.uid() else null end where id=p_id;
  insert into public.change_logs(actor_id,entity,entity_id,action,before_data,after_data)
  values(auth.uid(),'posts',p_id::text,case when p_deleted then 'post:deleted' else 'post:restored' end,
    jsonb_build_object('deleted',item.deleted_at is not null,'revision',item.revision),jsonb_build_object('deleted',p_deleted,'revision',item.revision+1));
end $$;

create function public.admin_edit_post(p_id uuid,p_title text,p_body text,p_expected_revision integer,p_expected_actor uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare item public.posts;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if p_expected_actor is not null and p_expected_actor<>auth.uid() then raise exception '계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  if p_title is null or length(trim(p_title)) not between 1 and 120 or p_body is null or length(trim(p_body)) not between 1 and 10000 then raise exception '제목과 내용을 확인해 주세요.';end if;
  select * into item from public.posts where id=p_id for update;
  if not found or not public.account_content_visible(item.user_id) then raise exception '수정할 수 있는 게시글이 아닙니다.';end if;
  if p_expected_revision is null or item.revision<>p_expected_revision then raise exception '다른 곳에서 변경된 글입니다. 목록을 새로고침해 주세요.';end if;
  update public.posts set title=trim(p_title),body=trim(p_body) where id=p_id;
  -- No copies of content: account erasure must also erase deleted posts.
  insert into public.change_logs(actor_id,entity,entity_id,action,before_data,after_data) values(auth.uid(),'posts',p_id::text,'post:edited',
    jsonb_build_object('deleted',item.deleted_at is not null,'revision',item.revision),jsonb_build_object('deleted',item.deleted_at is not null,'revision',item.revision+1));
end $$;

create function public.admin_edit_request(p_id uuid,p_payload jsonb,p_message text,p_note text,p_expected_revision integer,p_reopen boolean default false,p_expected_actor uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare item public.requests; next_status text;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if p_expected_actor is not null and p_expected_actor<>auth.uid() then raise exception '계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>50000 or length(coalesce(p_message,''))>3000 or length(coalesce(p_note,''))>3000 or p_reopen is null then raise exception '문의 내용과 처리 사유를 확인해 주세요.';end if;
  select * into item from public.requests where id=p_id for update;
  if not found or item.user_id is null or not public.account_content_visible(item.user_id) then raise exception '탈퇴 처리된 회원의 문의는 수정할 수 없습니다.';end if;
  if p_expected_revision is null or item.revision<>p_expected_revision then raise exception '다른 곳에서 변경된 문의입니다. 목록을 새로고침해 주세요.';end if;
  if item.status='approved' and p_payload<>item.payload then raise exception '승인된 음식점 정보는 새 수정 신청으로 변경해 주세요.';end if;
  if p_reopen and item.status<>'rejected' then raise exception '반려한 문의만 승인 대기로 돌릴 수 있습니다.';end if;
  next_status:=case when p_reopen then 'pending' else item.status end;
  if p_reopen then delete from public.request_reviews where request_id=p_id;
  elsif item.status<>'pending' then
    insert into public.request_reviews(request_id,reviewer_id,decision,note,created_at) values(p_id,auth.uid(),item.status,coalesce(p_note,''),coalesce(item.reviewed_at,now()))
    on conflict(request_id) do update set note=excluded.note;
  end if;
  update public.requests set payload=p_payload,message=coalesce(p_message,''),status=next_status,reviewed_at=case when p_reopen then null else reviewed_at end where id=p_id;
  insert into public.change_logs(actor_id,request_id,entity,entity_id,action,before_data,after_data) values(auth.uid(),p_id,'requests',p_id::text,case when p_reopen then 'request:reopened' else 'request:edited' end,
    jsonb_build_object('status',item.status,'revision',item.revision),jsonb_build_object('status',next_status,'revision',item.revision+1));
end $$;

create function public.admin_edit_support_ticket(p_id uuid,p_category text,p_subject text,p_body text,p_expected_revision integer,p_expected_actor uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare item public.support_tickets;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='관리자 권한이 필요합니다.';end if;
  if p_expected_actor is not null and p_expected_actor<>auth.uid() then raise exception '계정이 변경되었습니다. 다시 시도해 주세요.';end if;
  select * into item from public.support_tickets where id=p_id for update;
  if not found then raise exception '문의를 찾지 못했습니다.';end if;
  if p_expected_revision is null or p_expected_revision<>item.revision then raise exception '다른 곳에서 변경된 문의입니다. 목록을 새로고침해 주세요.';end if;
  if not public.account_content_visible(item.user_id) then raise exception '탈퇴 중인 회원의 문의는 수정할 수 없습니다.';end if;
  update public.support_tickets set category=p_category,subject=trim(p_subject),body=trim(p_body) where id=p_id;
  insert into public.change_logs(actor_id,entity,entity_id,action,before_data,after_data) values(auth.uid(),'support_tickets',p_id::text,'support:edited',jsonb_build_object('revision',item.revision),jsonb_build_object('revision',item.revision+1));
end $$;

revoke all on function public.admin_search_posts(text,text,integer),public.set_post_visibility(uuid,boolean,integer,uuid),public.admin_edit_post(uuid,text,text,integer,uuid),public.admin_edit_request(uuid,jsonb,text,text,integer,boolean,uuid),public.admin_edit_support_ticket(uuid,text,text,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.admin_search_posts(text,text,integer),public.set_post_visibility(uuid,boolean,integer,uuid),public.admin_edit_post(uuid,text,text,integer,uuid),public.admin_edit_request(uuid,jsonb,text,text,integer,boolean,uuid),public.admin_edit_support_ticket(uuid,text,text,text,integer,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
