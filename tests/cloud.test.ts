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
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  try{await db.exec(readFileSync('supabase/seed.sql','utf8'));}catch(error){throw Error('Catalog import failed: '+(error as Error).message);}
  await db.exec(`insert into auth.users(id,email) values('${A}','a@example.test'),('${B}','b@example.test'),('${ADMIN}','admin@example.test');insert into private.admin_members values('${ADMIN}');`);
});
after(async()=>{await db?.close();});
async function asUser<T>(id:string|null,role:string,work:()=>Promise<T>):Promise<T>{
  await db.exec(`set role ${role};select set_config('request.jwt.claim.sub','${id??''}',false);`);
  try{return await work();}finally{await db.exec('reset role;');}
}
async function query(sql:string,args:any[]=[]){return (await db.query<any>(sql,args)).rows;}
const noHours={checkHours:false};
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
test('posts are publicly searchable; only the author edits and own IDs cannot be forged',async()=>{
  await asUser(A,'authenticated',()=>db.query("insert into posts(user_id,title,body) values($1,'대구탕 추천','미향일식 맛있어요')",[A]));
  const row=(await asUser(null,'anon',()=>query("select * from search_posts('대구탕')")))[0];assert.equal(row.user_id,A);
  await asUser(B,'authenticated',()=>db.query("update posts set title='다른 회원' where id=$1",[row.id]));
  assert.equal((await query('select title from posts where id=$1',[row.id]))[0].title,'대구탕 추천');
  await assert.rejects(()=>asUser(B,'authenticated',()=>db.query("insert into posts(user_id,title,body) values($1,'위조','위조')",[A])));
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
