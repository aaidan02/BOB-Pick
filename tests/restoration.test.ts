import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {communityMedia,type MediaDependencies} from '../supabase/functions/_shared/community-media.ts';
let db:PGlite;
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',ADMIN='10000000-0000-4000-8000-000000000003',MASTER='10000000-0000-4000-8000-000000000004';
before(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
  create table auth.users(id uuid primary key,email varchar(255),raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
  create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,not_after timestamptz);
  create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const f of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
  for(const id of [A,B,ADMIN,MASTER])await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id,id+'@example.test']);
  await db.query('insert into private.admin_members(user_id,is_master) values($1,false),($2,true)',[ADMIN,MASTER]);
  await db.exec("insert into restaurants(id,name,address) values('restore-store','복원 가게','둔산동 1');insert into menus(restaurant_id,source_index,name,price) values('restore-store',0,'국밥',7000),('restore-store',1,'대구탕',9000)");
});
after(async()=>db?.close());
async function call(actor:string|null,name:string,args:Record<string,unknown>={},role=actor?'authenticated':'anon'){
  return db.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[actor??'',JSON.stringify(actor?{sub:actor}:{})]);const keys=Object.keys(args);return (await tx.query<any>(`select public.${name}(${keys.map((k,i)=>k+'=> $'+(i+1)).join(',')}) result`,Object.values(args).map((v,i)=>keys[i]==='p_items'?JSON.stringify(v):v))).rows[0].result;});
}
const sql=async(text:string,args:unknown[]=[]) =>(await db.query<any>(text,args)).rows;
async function post(title='복원할 이야기',photos:string[]=[]){return call(A,'save_post',{p_id:null,p_title:title,p_body:'수정 전 내용',p_photos:photos,p_expected_revision:null,p_expected_actor:A});}
async function preview(kind:string,id:string,version:number|null=null){return call(ADMIN,'admin_restore_preview',{p_kind:kind,p_id:id,p_version_id:version});}
async function restore(items:any[],actor=ADMIN){return call(actor,'admin_restore_selected',{p_items:items,p_expected_actor:actor});}
const choice=(p:any)=>({kind:p.kind,id:p.id,version_id:p.version_id,expected:p.expected});

test('restoration is private; deleted posts and administrator edits restore with reversible history and live actor checks',async()=>{
  const id=await post();
  for(const actor of [null,A])await assert.rejects(()=>call(actor,'admin_restore_items',{p_kind:'post',p_query:'',p_offset:0}));
  await call(ADMIN,'admin_edit_post',{p_id:id,p_title:'관리자 정정',p_body:'정정한 내용',p_expected_revision:1,p_expected_actor:ADMIN});
  let p=await preview('post',id);assert.equal(p.target.title,'복원할 이야기');assert.equal(p.current.title,'관리자 정정');assert.equal(p.versions.length,1);
  assert.equal(await restore([choice(p)]),1);assert.equal((await sql('select title from posts where id=$1',[id]))[0].title,'복원할 이야기');
  await assert.rejects(()=>restore([choice(p)]),/변경된 항목/);
  p=await preview('post',id);assert.equal(p.target.title,'관리자 정정');
  await call(A,'set_post_visibility',{p_id:id,p_deleted:true,p_expected_revision:Number(p.expected),p_expected_actor:A});
  p=await preview('post',id);assert.equal(p.version_id,null);assert.equal(p.target.deleted,false);await restore([choice(p)]);assert.equal((await sql('select deleted_at from posts where id=$1',[id]))[0].deleted_at,null);
  await assert.rejects(async()=>call(ADMIN,'admin_restore_selected',{p_items:[choice(await preview('post',id))],p_expected_actor:A}),/계정이 변경/);
});

test('catalog snapshots capture restaurant and menu prices together, retain menu IDs and undo the restoration',async()=>{
  const before=(await sql("select id,price from menus where restaurant_id='restore-store' order by source_index")),id=before[0].id;
  const request=await call(A,'submit_request',{p_kind:'correction',p_restaurant_id:'restore-store',p_payload:{phone:'042-NEW',menu_patch:{id,price:12000,variable_price:false}},p_message:'정정'});
  await call(ADMIN,'review_request',{p_request_id:request,p_decision:'approved',p_note:'확인'});
  let p=await preview('restaurant','restore-store');assert.equal(p.target.restaurant.phone,'');assert.equal(p.current.restaurant.phone,'042-NEW');assert.equal(p.target.menus.find((m:any)=>m.id===id).price,7000);assert.equal(p.current.menus.find((m:any)=>m.id===id).price,12000);
  await restore([choice(p)]);assert.equal((await sql('select price from menus where id=$1',[id]))[0].price,7000);assert.equal((await sql("select phone from restaurants where id='restore-store'"))[0].phone,'');
  p=await preview('restaurant','restore-store');assert.equal(p.target.restaurant.phone,'042-NEW');await restore([choice(p)]);assert.equal((await sql('select price from menus where id=$1',[id]))[0].price,12000);
});

test('batch restoration is atomic if any preview is stale; revoking the current administrator stops access',async()=>{
  const ids=[await post('일괄 첫째'),await post('일괄 둘째')].sort();
  for(const id of ids)await call(ADMIN,'admin_edit_post',{p_id:id,p_title:'바뀐 글',p_body:'바뀐 내용',p_expected_revision:1,p_expected_actor:ADMIN});
  const choices=await Promise.all(ids.map(async id=>choice(await preview('post',id))));
  await call(A,'save_post',{p_id:ids[1],p_title:'나중에 쓴 글',p_body:'새로운 내용',p_photos:[],p_expected_revision:2,p_expected_actor:A});
  await assert.rejects(()=>restore(choices),/변경된 항목/);assert.equal((await sql('select title from posts where id=$1',[ids[0]]))[0].title,'바뀐 글');
  const fresh=await Promise.all(ids.map(async id=>choice(await preview('post',id))));assert.equal(await restore(fresh),2);
  await call(MASTER,'admin_set_membership',{p_user_id:ADMIN,p_enabled:false});await assert.rejects(()=>preview('post',ids[0]),/관리자 권한/);await call(MASTER,'admin_set_membership',{p_user_id:ADMIN,p_enabled:true});
});

test('a menu-only correction invalidates the full-store preview, and failed audits roll back both content and version capture',async()=>{
  const old=await preview('restaurant','restore-store'),menu=(await sql("select id from menus where restaurant_id='restore-store' order by source_index limit 1"))[0].id;
  const q=await call(A,'submit_request',{p_kind:'correction',p_restaurant_id:'restore-store',p_payload:{menu_patch:{id:menu,price:14000,variable_price:false}},p_message:'메뉴만 변경'});
  await call(ADMIN,'review_request',{p_request_id:q,p_decision:'approved',p_note:''});await assert.rejects(()=>restore([choice(old)]),/변경된 항목/);
  const id=await post('감사 실패 원문');await call(ADMIN,'admin_edit_post',{p_id:id,p_title:'감사 실패 정정',p_body:'정정 내용',p_expected_revision:1,p_expected_actor:ADMIN});const p=await preview('post',id),before=(await sql('select count(*) n from private.post_versions where post_id=$1',[id]))[0].n;
  await db.exec("create function private.test_restore_audit_failure() returns trigger language plpgsql as $$begin if new.action in ('post:version_restored','catalog:restored') then raise exception 'test audit failure';end if;return new;end$$;create trigger test_restore_audit_failure before insert on change_logs for each row execute function private.test_restore_audit_failure()");
  try{await assert.rejects(()=>restore([choice(p)]),/test audit failure/);assert.equal((await sql('select title from posts where id=$1',[id]))[0].title,'감사 실패 정정');assert.equal((await sql('select count(*) n from private.post_versions where post_id=$1',[id]))[0].n,before);}finally{await db.exec('drop trigger test_restore_audit_failure on change_logs;drop function private.test_restore_audit_failure()');}
});

const objects=new Map<string,Blob>();
function mediaDeps(actor:string|null):MediaDependencies{return {actor:async()=>({userId:actor,rpc:(n,a)=>call(actor,n,a)}),service:(n,a)=>call(null,n,a,'service_role'),ensureBucket:async()=>{},upload:async(key,bytes,type)=>{objects.set(key,new Blob([bytes as BlobPart],{type}));},download:async key=>{const b=objects.get(key);if(!b)throw Error('Missing image');return b;},remove:async keys=>{for(const k of keys)objects.delete(k);}};}
// Tiny valid PNG used by upload tests (transport is mocked, SQL authorization is real).
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function upload(actor:string|null=A,bytes=png,type='image/png'){
  const form=new FormData();form.set('photo',new File([bytes], 'meal.png',{type}));return communityMedia(new Request('http://local/media',{method:'POST',body:form}),mediaDeps(actor));
}
async function getPhoto(id:string,actor:string|null=null){return communityMedia(new Request('http://local/media?id='+id),mediaDeps(actor));}

test('photo attachment ownership, three-photo limit, signature and private published/deleted access use the actual media handler',async()=>{
  assert.equal((await upload(null)).status,401);assert.equal((await upload(A,Buffer.from('<svg onload=alert(1)>'),'image/png')).status,400);
  const uploaded=await upload();assert.equal(uploaded.status,201);const {id}=await uploaded.json();assert.equal((await getPhoto(id)).status,403);assert.equal((await getPhoto(id,A)).status,200);
  await assert.rejects(()=>call(B,'save_post',{p_id:null,p_title:'도용',p_body:'다른 회원 사진',p_photos:[id],p_expected_revision:null,p_expected_actor:B}),/첨부할 수 없는/);
  await assert.rejects(()=>post('중복 사진',[id,id]),/서로 다른/);
  const postId=await post('사진 있는 글',[id]);const response=await getPhoto(id);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  await call(ADMIN,'set_post_visibility',{p_id:postId,p_deleted:true,p_expected_revision:1,p_expected_actor:ADMIN});assert.equal((await getPhoto(id)).status,403);assert.equal((await getPhoto(id,B)).status,403);assert.equal((await getPhoto(id,ADMIN)).status,200);
  await restore([choice(await preview('post',postId))]);assert.equal((await getPhoto(id)).status,200);
  await call(ADMIN,'save_post',{p_id:postId,p_title:'사진 뺀 글',p_body:'내용',p_photos:[],p_expected_revision:3,p_expected_actor:ADMIN});assert.equal((await getPhoto(id)).status,403);await restore([choice(await preview('post',postId))]);assert.equal((await getPhoto(id)).status,200);
  // A public client cannot mark arbitrary reservations as uploaded or run cleanup.
  await assert.rejects(()=>call(A,'finish_post_photo',{p_id:id}));await assert.rejects(()=>call(A,'claim_media_cleanup',{p_ticket:crypto.randomUUID()}));
});

test('withdrawal hides photos and version content immediately; expiry erases snapshots and queued Storage files through the API',async()=>{
  const uploaded=await upload(),{id}=await uploaded.json(),postId=await post('영구 삭제 대상',[id]);
  await call(ADMIN,'admin_edit_post',{p_id:postId,p_title:'정정한 원문',p_body:'이전 내용 보관',p_expected_revision:1,p_expected_actor:ADMIN});
  await call(null,'request_account_withdrawal',{p_user_id:A},'service_role');assert.equal((await getPhoto(id)).status,403);await assert.rejects(()=>preview('post',postId),/복원할 수/);
  await db.query("update private.account_lifecycle set withdrawn_at=now()-interval '8 days',purge_at=now()-interval '1 day' where user_id=$1",[A]);await db.exec('select private.purge_expired_accounts()');
  assert.equal((await sql('select count(*) n from private.post_versions where post_id=$1',[postId]))[0].n,0);assert.equal((await sql('select count(*) n from private.post_photos where id=$1',[id]))[0].n,0);
  const ticket=(await sql('insert into private.media_cleanup_tickets default values returning id'))[0].id;
  const clean=await communityMedia(new Request('http://local/media?cleanup=1',{method:'POST',body:JSON.stringify({ticket})}),mediaDeps(null));assert.equal(clean.status,200);assert.equal(objects.size,0);assert.equal((await sql('select count(*) n from private.media_cleanup_queue'))[0].n,0);
  const replay=await communityMedia(new Request('http://local/media?cleanup=1',{method:'POST',body:JSON.stringify({ticket})}),mediaDeps(null));assert.equal(replay.status,403);
});
