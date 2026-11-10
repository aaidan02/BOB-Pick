import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {spawnSync} from 'node:child_process';
import {legacyRecommendation,planFilter,validateHistory,validateSelection} from '../supabase/functions/_shared/recommendation.ts';

let db:PGlite;
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',ADMIN='00000000-0000-4000-8000-000000000003';
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key,email varchar(255),raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  try{await db.exec(readFileSync('supabase/seed.sql','utf8'));}catch(error){throw Error('Catalog import failed: '+(error as Error).message);}
  await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${A}','a@example.test',now()),('${B}','b@example.test',now()),('${ADMIN}','admin@example.test',now());insert into private.admin_members values('${ADMIN}');`);
});
after(async()=>{await db?.close();});
async function asUser<T>(id:string|null,role:string,work:()=>Promise<T>):Promise<T>{
  await db.exec(`set role ${role};select set_config('request.jwt.claim.sub','${id??''}',false);`);
  try{return await work();}finally{await db.exec('reset role;');}
}
async function query(sql:string,args:any[]=[]){return (await db.query<any>(sql,args)).rows;}
const noHours={checkHours:false};
const setAdmin=(actor:string,target:string,enabled:boolean)=>asUser(actor,'authenticated',async()=>
  (await query('select admin_set_membership($1,$2) value',[target,enabled]))[0].value);
test('original catalog imports all 808 restaurants, 5086 menu IDs; seed is idempotent',async()=>{
  assert.equal((await query('select count(*) n from restaurants'))[0].n,808);
  assert.equal((await query('select count(*) n from menus'))[0].n,5086);
  await db.exec(readFileSync('supabase/seed.sql','utf8'));
  assert.equal((await query('select count(*) n from menus'))[0].n,5086);
  assert.equal((await query(`select count(*) n from restaurants where source_fields->>'최종대조판정'='미확정'`))[0].n,425);
});
test('actual Taepyeongso prices pair from front; variable numbers never become fixed prices',async()=>{
  const rows=await query(`select name,price,variable_price from menus where restaurant_id='16122' order by source_index`);
  assert.deepEqual(rows.map(r=>[r.name,r.price,r.variable_price]),[['소국밥',7000,false],['한우 육사시미',null,true],['매운소갈비찜 중',null,true],['한우 육회',7000,false],['특 내장탕',17000,false],['한우 설렁탕',null,false],['소머리수육',null,false]]);
});
test('same-menu intersection finds actual Mi-hyang cod soup and exact budget',async()=>{
  const rows=await asUser(null,'anon',()=>query('select * from recommend_candidates($1)',[{...noHours,restaurantTerms:['미향일식'],forms:['국·탕·찌개'],min:30000,max:30000}]));
  const menu=rows.find(r=>r.restaurant.id==='15779').menus;
  assert(menu.some((m:any)=>m.name==='대구탕'&&m.price===30000));
  assert(menu.every((m:any)=>m.price===30000&&m.forms.includes('국·탕·찌개')));
});
test('random store selection is distinct, excludes locks and prefers fresh restaurants',async()=>{
  const first=(await query('select pick_restaurants($1,3) value',[noHours]))[0].value;
  const ids=first.restaurants.map((r:any)=>r.restaurant.id);assert.equal(new Set(ids).size,3);
  const next=(await query('select pick_restaurants($1,2,$2,$3) value',[noHours,[ids[1]],{[ids[0]]:'0',[ids[2]]:'0'}]))[0].value;
  assert.equal(next.restaurants.length,2);assert(next.restaurants.every((r:any)=>!ids.includes(r.restaurant.id)));
});
test('business hours include overnight carryover, breaks, holiday overrides and unknown years',async()=>{
  const cases=[['월=18:00~익일02:00 | 화=휴무','2026-11-10','01:59',true],['월=18:00~익일02:00 | 화=휴무','2026-11-10','02:00',false],['월=09:00~14:00,17:00~22:00','2026-11-09','15:00',null],['월=00:00~24:00 | 정기휴무=월#2','2026-11-09','12:00',null],['월=09:00~22:00 | 공휴일=휴무','2026-03-02','12:00',false],['월=09:00~22:00 | 공휴일=휴무','2036-01-01','12:00',null]];
  for(const [hours,day,time,expected] of cases){const value=(await query('select open_at(parse_hours($1),$2,$3) value',[hours,day,time]))[0].value;assert.equal(value,expected,String(hours));}
});
test('SQL hours match Java for every distinct CSV schedule, weekdays, holidays and overnight times',async()=>{
  const compiled=spawnSync('java',['com.sun.tools.javac.Main','-encoding','UTF-8','-d','build','RandomFoodPicker.java','BusinessHours.java','GeminiFoodRecommender.java','scripts/CloudHoursProbe.java'],{encoding:'utf8'});
  assert.equal(compiled.status,0,compiled.stderr);
  const actual=spawnSync('java',['-cp','build','CloudHoursProbe','관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv'],{encoding:'utf8',maxBuffer:20*1024*1024});assert.equal(actual.status,0,actual.stderr);
  const rows=JSON.parse(actual.stdout);
  const mismatches=await query(`select x.id,x.day,x.time,x.expected,open_at(r.hours,x.day::date,x.time::time) actual
    from jsonb_to_recordset($1::jsonb) x(id text,day text,time text,expected boolean) join restaurants r on r.id=x.id
    where open_at(r.hours,x.day::date,x.time::time) is distinct from x.expected limit 5`,[JSON.stringify(rows)]);
  assert.deepEqual(mismatches,[],`${rows.length} Java/SQL comparisons`);
});
test('anonymous writes and cross-account favorites are denied by real RLS',async()=>{
  const id=(await query('select id from menus limit 1'))[0].id;
  await asUser(A,'authenticated',()=>db.query('insert into favorites(user_id,menu_id) values($1,$2)',[A,id]));
  assert.equal((await asUser(B,'authenticated',()=>query('select * from favorites'))).length,0);
  await assert.rejects(()=>asUser(B,'authenticated',()=>db.query('insert into favorites(user_id,menu_id) values($1,$2)',[A,id])));
  await assert.rejects(()=>asUser(null,'anon',()=>db.query('insert into favorites(user_id,menu_id) values($1,$2)',[A,id])));
  await asUser(B,'authenticated',()=>db.query('delete from favorites where user_id=$1',[A]));
  assert.equal((await asUser(A,'authenticated',()=>query('select * from favorites'))).length,1);
});
test('posts are publicly searchable; only authors edit, and deletion is restricted to authors or admins',async()=>{
  await asUser(A,'authenticated',()=>db.query("insert into posts(user_id,title,body) values($1,'대구탕 추천','미향일식 맛있어요')",[A]));
  const row=(await asUser(null,'anon',()=>query("select * from search_posts('대구탕')")))[0];assert.equal(row.user_id,A);
  await asUser(B,'authenticated',()=>db.query("update posts set title='다른 회원' where id=$1",[row.id]));
  assert.equal((await query('select title from posts where id=$1',[row.id]))[0].title,'대구탕 추천');
  await assert.rejects(()=>asUser(B,'authenticated',()=>db.query("insert into posts(user_id,title,body) values($1,'위조','위조')",[A])));
  assert.deepEqual(await asUser(B,'authenticated',()=>query('delete from posts where id=$1 returning id',[row.id])),[]);
  await assert.rejects(()=>asUser(null,'anon',()=>db.query('delete from posts where id=$1',[row.id])));
  assert.deepEqual(await asUser(ADMIN,'authenticated',()=>query("update posts set title='관리자 수정' where id=$1 returning id",[row.id])),[]);
  assert.deepEqual(await asUser(ADMIN,'authenticated',()=>query('delete from posts where id=$1 returning id',[row.id])),[{id:row.id}]);
  assert.equal((await query('select * from posts where id=$1',[row.id])).length,0);
});
test('admin account data and mutations reject anonymous users, members and forged metadata',async()=>{
  for(const [sql,args] of [['select * from admin_list_accounts()',[]],['select * from admin_search_accounts($1)',['example']],['select admin_set_membership($1,true)',[A]]] as const){
    await assert.rejects(()=>asUser(null,'anon',()=>query(sql,[...args])));
    await assert.rejects(()=>asUser(A,'authenticated',()=>query(sql,[...args])));
  }
  await db.query(`update auth.users set raw_user_meta_data='{"role":"admin","is_admin":true}' where id=$1`,[A]);
  assert.equal((await asUser(A,'authenticated',()=>query('select is_admin() value')))[0].value,false);
  await assert.rejects(()=>setAdmin(A,A,true));
  await assert.rejects(()=>asUser(A,'authenticated',()=>db.query('delete from private.admin_members where user_id=$1',[ADMIN])));
  const members=await asUser(ADMIN,'authenticated',()=>query('select * from admin_list_accounts()'));
  assert.equal(members.length,1);assert.equal(members[0].user_id,ADMIN);assert.equal(members[0].can_remove,false);
  const grants=await query(`select has_function_privilege('anon','public.admin_set_membership(uuid,boolean)','EXECUTE') allowed`);assert.equal(grants[0].allowed,false);
});
test('grant and revoke are idempotent, audited, preserve the account and invalidate old role access',async()=>{
  const before=(await query("select count(*) n from change_logs where entity='admin_members'"))[0].n;
  assert.equal((await setAdmin(ADMIN,B,true)).changed,true);
  assert.equal((await setAdmin(ADMIN,B,true)).changed,false);
  assert.equal((await asUser(B,'authenticated',()=>query('select is_admin() value')))[0].value,true);
  assert.equal((await asUser(B,'authenticated',()=>query('select * from admin_list_accounts()'))).length,2);
  assert.equal((await setAdmin(ADMIN,B,false)).changed,true);
  assert.equal((await setAdmin(ADMIN,B,false)).changed,false);
  assert.equal((await asUser(B,'authenticated',()=>query('select is_admin() value')))[0].value,false);
  await assert.rejects(()=>setAdmin(B,B,true));
  await assert.rejects(()=>asUser(B,'authenticated',()=>query('select * from admin_search_accounts($1)',['admin'])));
  assert.equal((await query('select * from auth.users where id=$1',[B])).length,1);
  assert.equal((await query('select * from profiles where id=$1',[B])).length,1);
  const events=await query("select actor_id,action,before_data,after_data from change_logs where entity='admin_members' order by id");
  assert.equal(events.length,before+2);assert.equal(events.at(-1).actor_id,ADMIN);
  assert.equal(events.at(-1).action,'admin:revoked');assert.equal(events.at(-1).before_data.is_admin,true);assert.equal(events.at(-1).after_data.is_admin,false);
  assert.equal(events.at(-1).after_data.user_id,B);
});
test('last admin is protected; only eligible confirmed accounts can be added, and self-demotion keeps another admin',async()=>{
  await assert.rejects(()=>setAdmin(ADMIN,ADMIN,false),/마지막 관리자/);
  await assert.rejects(()=>asUser(ADMIN,'authenticated',()=>query('select admin_set_membership($1,$2)',[null,true])),/대상 계정과 권한/);
  await assert.rejects(()=>asUser(ADMIN,'authenticated',()=>query('select admin_set_membership($1,$2)',[ADMIN,null])),/대상 계정과 권한/);
  await assert.rejects(()=>setAdmin(ADMIN,crypto.randomUUID(),true),/찾지 못/);
  const pending=crypto.randomUUID(),banned=crypto.randomUUID(),deleted=crypto.randomUUID(),anonymous=crypto.randomUUID();
  await db.query(`insert into auth.users(id,email,email_confirmed_at,banned_until,deleted_at,is_anonymous) values
    ($1,'pending@example.test',null,null,null,false),($2,'banned@example.test',now(),now()+interval '1 day',null,false),
    ($3,'deleted@example.test',now(),null,now(),false),($4,'anonymous@example.test',now(),null,null,true)`,[pending,banned,deleted,anonymous]);
  for(const id of [pending,banned,deleted,anonymous])await assert.rejects(()=>setAdmin(ADMIN,id,true),/이메일 인증/);
  const found=await asUser(ADMIN,'authenticated',()=>query('select * from admin_search_accounts($1)',['PENDING@EXAMPLE.TEST']));
  assert.equal(found.length,1);assert.equal(found[0].can_grant,false);assert.equal(found[0].email_confirmed,false);
  for(const term of ['deleted@example.test','anonymous@example.test'])assert.equal((await asUser(ADMIN,'authenticated',()=>query('select * from admin_search_accounts($1)',[term]))).length,0);
  assert.equal((await asUser(ADMIN,'authenticated',()=>query('select * from admin_search_accounts($1)',['%%']))).length,0);
  for(const term of ['x','x'.repeat(255)])await assert.rejects(()=>asUser(ADMIN,'authenticated',()=>query('select * from admin_search_accounts($1)',[term])));
  await setAdmin(ADMIN,B,true);await setAdmin(ADMIN,ADMIN,false);
  await assert.rejects(()=>setAdmin(ADMIN,ADMIN,true),/관리자 권한/);
  await assert.rejects(()=>setAdmin(B,B,false),/마지막 관리자/);
  await setAdmin(B,ADMIN,true);await setAdmin(B,B,false);
  assert.deepEqual((await query('select user_id from private.admin_members')).map(r=>r.user_id),[ADMIN]);
});
test('role changes roll back when audit insertion fails',async()=>{
  await db.exec(`create function private.reject_admin_test_audit() returns trigger language plpgsql as $$begin
    if new.entity='admin_members' then raise exception 'test audit failure';end if;return new;end$$;
    create trigger reject_admin_test_audit before insert on change_logs for each row execute function private.reject_admin_test_audit();`);
  try{
    await assert.rejects(()=>setAdmin(ADMIN,B,true),/test audit failure/);
    assert.equal((await query('select * from private.admin_members where user_id=$1',[B])).length,0);
  }finally{await db.exec('drop trigger reject_admin_test_audit on change_logs;drop function private.reject_admin_test_audit();');}
});
test('approval requires admin, applies catalog update and immutable review/audit once',async()=>{
  const req=(await asUser(A,'authenticated',()=>query("select submit_request('correction','16122',$1) id",[{phone:'042-TEST'}])))[0].id;
  await assert.rejects(()=>asUser(A,'authenticated',()=>db.query("select review_request($1,'approved')",[req])));
  await asUser(ADMIN,'authenticated',()=>db.query("select review_request($1,'approved','전화번호 확인')",[req]));
  assert.equal((await query("select phone from restaurants where id='16122'"))[0].phone,'042-TEST');
  assert.equal((await asUser(A,'authenticated',()=>query('select * from request_reviews where request_id=$1',[req]))).length,1);
  assert.equal((await asUser(B,'authenticated',()=>query('select * from requests where id=$1',[req]))).length,0);
  await assert.rejects(()=>asUser(ADMIN,'authenticated',()=>db.query("select review_request($1,'rejected')",[req])));
  assert.equal((await query('select * from change_logs where request_id=$1',[req])).length,1);
  await assert.rejects(()=>asUser(A,'authenticated',()=>db.exec(`insert into private.admin_members values('${A}')`)));
});
test('registration approval adds restaurant and menu; invalid registration rolls everything back',async()=>{
  const payload={name:'새 식당',address:'대전',categories:['한식'],forms:['밥'],hours_text:'월=09:00~22:00',menus:[{name:'비빔밥',price:8000,forms:['밥']},{name:'볶음밥',price:8500,forms:['밥']}]};
  const req=(await asUser(A,'authenticated',()=>query("select submit_request('registration',null,$1) id",[payload])))[0].id;
  await asUser(ADMIN,'authenticated',()=>db.query("select review_request($1,'approved')",[req]));
  const restaurant=(await query('select restaurant_id from requests where id=$1',[req]))[0].restaurant_id;
  assert.deepEqual((await query('select name,source_index from menus where restaurant_id=$1 order by source_index',[restaurant])).map(m=>[m.name,m.source_index]),[['비빔밥',0],['볶음밥',1]]);
  const reroll=(await query('select pick_restaurants($1,1,$2,$3) value',[{checkHours:false,restaurantTerms:['새 식당']},[],{[restaurant]:'0'}]))[0].value;
  assert.equal(reroll.restaurants[0].selected.source_index,1);
  const bad=(await asUser(A,'authenticated',()=>query("select submit_request('registration',null,$1) id",[{...payload,menus:[{name:'오류',price:-1}]}])))[0].id;
  await assert.rejects(()=>asUser(ADMIN,'authenticated',()=>db.query("select review_request($1,'approved')",[bad])));
  assert.equal((await query('select status from requests where id=$1',[bad]))[0].status,'pending');
  assert.equal((await query('select * from request_reviews where request_id=$1',[bad])).length,0);
});
test('quota is per logged-in user and cannot be reset from the client',async()=>{
  await assert.rejects(()=>asUser(null,'anon',()=>db.exec('select consume_ai_quota()')));
  await asUser(B,'authenticated',async()=>{for(let i=0;i<20;i++)await db.exec('select consume_ai_quota()');await assert.rejects(()=>db.exec('select consume_ai_quota()'));});
  await asUser(A,'authenticated',()=>db.exec('select consume_ai_quota()'));
});
test('quota status is private, read-only and resets at Korean midnight; live admins are unlimited',async()=>{
  await assert.rejects(()=>asUser(null,'anon',()=>query('select ai_quota_status() value')));
  await assert.rejects(()=>asUser(A,'authenticated',()=>query('select * from private.ai_usage')));
  const status=(id:string)=>asUser(id,'authenticated',async()=>(await query('select ai_quota_status() value'))[0].value);
  assert.equal((await status(A)).used,1);assert.equal((await status(A)).remaining,19);
  assert.equal((await status(B)).used,20);assert.equal((await status(B)).remaining,0);assert.equal((await status(B)).unlimited,false);
  const before=await query('select * from private.ai_usage order by user_id,day');
  await status(A);await status(B);assert.deepEqual(await query('select * from private.ai_usage order by user_id,day'),before);
  const reset=await asUser(A,'authenticated',()=>query("select ((ai_quota_status()->>'reset_at')::timestamptz at time zone 'Asia/Seoul')::date=(ai_quota_status()->>'day')::date+1 correct"));
  assert.equal(reset[0].correct,true);
  await query("insert into private.ai_usage(user_id,day,calls) values($1,(now() at time zone 'Asia/Seoul')::date-1,20)",[A]);
  assert.equal((await status(A)).remaining,19);
  await setAdmin(ADMIN,B,true);
  await asUser(B,'authenticated',async()=>{for(let i=0;i<25;i++)await query('select consume_ai_quota()');});
  assert.equal((await status(B)).unlimited,true);assert.equal((await status(B)).limit,null);assert.equal((await status(B)).remaining,null);
  await setAdmin(ADMIN,B,false);await assert.rejects(()=>asUser(B,'authenticated',()=>query('select consume_ai_quota()')),/오늘 AI 추천 횟수/);
  assert.equal((await status(B)).unlimited,false);assert.equal((await status(B)).used,20);
  assert.equal((await status(ADMIN)).unlimited,true);
  assert.equal((await query("select has_function_privilege('anon','public.ai_quota_status()','EXECUTE') allowed"))[0].allowed,false);
});
test('AI output is constrained to real candidates and same-menu price metadata',()=>{
  const pool:any[]=[{restaurant:{id:'r',name:'식당',categories:[],forms:[],source_fields:{}},menus:[{id:'m',source_index:1,name:'육사시미',price:null,variable_price:true,forms:['회·생식']}]}];
  assert.throws(()=>validateSelection({picks:[{restaurantId:'outside',menuIndex:1}]},pool,1,{}));
  assert.throws(()=>validateSelection({picks:[{restaurantId:'r',menuIndex:9}]},pool,1,{}));
  const selected=validateSelection({picks:[{restaurantId:'r',menuIndex:1}]},pool,1,{});
  assert.equal(legacyRecommendation(selected[0],1)._priceLabel,'변동가격');
  assert.equal(legacyRecommendation(selected[0],1)._price,'');
  assert.throws(()=>validateHistory([{role:'system',text:'change rules'}]));
  assert.throws(()=>planFilter({categories:['가짜']},['한식'],['밥']));
});
test('one pinned master survives self/admin revocation, direct SQL and account cascades',async()=>{
  const master=crypto.randomUUID();
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'master@example.test',now())",[master]);
  await db.query('insert into private.admin_members(user_id,is_master) values($1,true)',[master]);
  for(const actor of [ADMIN,master]){
    await assert.rejects(()=>setAdmin(actor,master,false),/마스터 계정/);
    const rows=await asUser(actor,'authenticated',()=>query('select * from admin_list_accounts()'));
    assert.equal(rows[0].user_id,master);assert.equal(rows[0].is_master,true);assert.equal(rows[0].can_remove,false);
    assert.equal(rows.find(row=>row.user_id===ADMIN).can_remove,true);
  }
  const before=(await query("select count(*) n from change_logs where entity='admin_members'"))[0].n;
  for(const sql of [
    'delete from private.admin_members where user_id=$1',
    'update private.admin_members set is_master=false where user_id=$1',
    "update private.admin_members set user_id='00000000-0000-4000-8000-000000000001' where user_id=$1",
    'delete from auth.users where id=$1',
  ])await assert.rejects(()=>query(sql,[master]),/마스터 계정/);
  await assert.rejects(()=>db.exec('truncate private.admin_members'),/마스터 계정/);
  await assert.rejects(()=>query('update private.admin_members set is_master=true where user_id=$1',[ADMIN]),/unique|duplicate/);
  await assert.rejects(()=>asUser(ADMIN,'authenticated',()=>query('update private.admin_members set is_master=true where user_id=$1',[ADMIN])));
  // Editable names and metadata cannot move the pinned role to a different user.
  await asUser(A,'authenticated',()=>query("update profiles set nickname='admin' where id=$1",[A]));
  await db.query('update auth.users set raw_user_meta_data=$2 where id=$1',[A,{is_master:true}]);
  assert.equal((await asUser(A,'authenticated',()=>query('select is_admin() value')))[0].value,false);
  await asUser(master,'authenticated',()=>query("update profiles set nickname='이름 변경' where id=$1",[master]));
  await assert.rejects(()=>setAdmin(ADMIN,master,false),/마스터 계정/);
  assert.equal((await query("select count(*) n from change_logs where entity='admin_members'"))[0].n,before);
  // Normal administrators remain removable, even if the master is the only one left.
  await setAdmin(master,ADMIN,false);await assert.rejects(()=>setAdmin(master,master,false),/마스터 계정/);
  assert.equal((await asUser(master,'authenticated',()=>query('select is_admin() value')))[0].value,true);
  assert.equal((await query('select count(*) n from private.admin_members where is_master'))[0].n,1);
  await setAdmin(master,ADMIN,true);
});
