import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {recommendWithAi,isRandomRequest,AiRequestError,type AiDependencies} from '../supabase/functions/_shared/ai-service.ts';
import {applyPreferenceFilter,emptyPreferences} from '../supabase/functions/_shared/preferences.ts';
import {deleteOwnAccount,AccountDeletionError,type AccountDeletionDependencies} from '../supabase/functions/_shared/account-deletion.ts';
let db:PGlite;
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',ADMIN='00000000-0000-4000-8000-000000000003',MASTER='00000000-0000-4000-8000-000000000005';
before(async()=>{
  db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key,email varchar(255),raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated;`);
  for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec(readFileSync('supabase/seed.sql','utf8'));
  for(const [id,name] of [[A,'회원가'],[B,'회원나'],[ADMIN,'관리자'],[MASTER,'마스터']])await db.query('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now())',[id,id+'@example.test',{nickname:name}]);
  await db.query('insert into private.admin_members(user_id,is_master) values($1,false),($2,true)',[ADMIN,MASTER]);
  const hours=['월','화','수','목','금','토','일'].map(d=>d+'=00:00~24:00').join(' | ');
  await db.query("insert into restaurants(id,name,categories,forms,hours) values('ai-always','항상 영업하는 테스트 가게',array['한식'],array['밥'],parse_hours($1))",[hours]);
  await db.exec("insert into menus(restaurant_id,name,source_index,price,forms) values('ai-always','테스트 밥',0,5000,array['밥'])");
});
after(async()=>{await db?.close();});
async function actor<T>(id:string|null,role:string,work:(tx:any)=>Promise<T>){return db.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id??'']);return work(tx);});}
const rpc=(id:string|null,role='authenticated')=>async(name:string,args:Record<string,unknown>={})=>actor(id,role,async tx=>{
  const values=Object.values(args),names=Object.keys(args).map((key,index)=>key+'=> $'+(index+1)).join(',');
  if(name==='recommend_candidates')return (await tx.query(`select * from public.${name}(${names})`,values)).rows;
  return (await tx.query(`select public.${name}(${names}) value`,values)).rows[0].value;
});
async function used(id=A){return (await rpc(id)('ai_quota_status')).used;}
async function resetQuota(){await db.exec('delete from private.ai_requests;delete from private.ai_usage;');}
function plan(extra:Record<string,unknown>={}){return {intent:'recommendation',categories:['한식'],excludedCategories:[],forms:['국·탕·찌개'],excludedForms:[],menuTerms:[],excludedTerms:[],restaurantTerms:[],excludedRestaurants:[],minPrice:-1,maxPrice:10000,date:'',time:'',allHours:true,question:'',...extra};}
function dependencies(id=A,options:{plan?:Record<string,unknown>;fail?:string;signal?:AbortSignal;afterDecision?:()=>void}={}){
  let calls=0;
  const deps:AiDependencies={rpc:rpc(id),settle:rpc(null,'service_role'),signal:options.signal,preferences:async()=>(await rpc(id)('my_food_preferences')).filter,
    generate:async(_prompt,data:any)=>{
      calls++;if(options.fail==='provider')throw Error('AI 연결에 실패했습니다.');
      if(calls===1)return options.plan??plan();
      options.afterDecision?.();
      return {picks:options.fail==='selection'?[{restaurantId:'fabricated',menuIndex:0}]:data.candidates.slice(0,data.wanted).map((r:any)=>({restaurantId:r[0],menuIndex:r[3][0]?.[0]??-1}))};
    }};
  return {deps,calls:()=>calls};
}
const input=(text='만 원 이하 국물 요리 추천해줘',extra:Record<string,unknown>={})=>({history:[{role:'user',text}],size:3,...extra});
test('AI success is settled once; only the service role can settle or compensate',async()=>{
  await resetQuota();const request=await rpc(A)('begin_ai_request');assert.equal(await used(),0);
  await assert.rejects(()=>rpc(A)('complete_ai_request',{p_request_id:request,p_success:true}),/permission denied/);
  await assert.rejects(()=>rpc(null,'anon')('begin_ai_request'),/permission denied/);
  const settle=rpc(null,'service_role');assert.equal((await settle('complete_ai_request',{p_request_id:request,p_success:true})).completed,true);
  await settle('complete_ai_request',{p_request_id:request,p_success:true});assert.equal(await used(),1);
  await settle('complete_ai_request',{p_request_id:request,p_success:false});await settle('complete_ai_request',{p_request_id:request,p_success:false});assert.equal(await used(),0);
  assert.equal((await settle('complete_ai_request',{p_request_id:request,p_success:true})).completed,false);
});
test('concurrent reservations cannot overspend a daily allowance; failed/expired holds are not usage',async()=>{
  await resetQuota();await db.query("insert into private.ai_usage(user_id,day,calls) values($1,(now() at time zone 'Asia/Seoul')::date,19)",[A]);
  const hold=await rpc(A)('begin_ai_request');await assert.rejects(()=>rpc(A)('begin_ai_request'),/진행/);assert.equal(await used(),19);
  await rpc(null,'service_role')('complete_ai_request',{p_request_id:hold,p_success:false});const next=await rpc(A)('begin_ai_request');
  await db.query("update private.ai_requests set expires_at=now()-interval '1 second' where id=$1",[next]);
  assert.equal((await rpc(null,'service_role')('complete_ai_request',{p_request_id:next,p_success:true})).completed,false);assert.equal(await used(),19);
  const final=await rpc(A)('begin_ai_request');await rpc(null,'service_role')('complete_ai_request',{p_request_id:final,p_success:true});assert.equal(await used(),20);
  await assert.rejects(()=>rpc(A)('begin_ai_request'),/오늘/);
});
test('gibberish is not a recommendation and never calls the model or charges usage',async()=>{
  for(const text of ['ㅋㅋㅋㅋ','ㅁㄴㅇㄹ','asdfasdf','!!!!!']){
    await resetQuota();const {deps,calls}=dependencies();const result=await recommendWithAi(input(text),deps);
    assert.equal(result.needsClarification,true);assert.equal(result.restaurants.length,0);assert.equal(calls(),0);assert.equal(await used(),0);
  }
});
test('몰라 아무거나 is a valid random request with real food candidates and one successful use',async()=>{
  await resetQuota();assert(isRandomRequest('몰라 아무거나'));assert(isRandomRequest('그냥 아무거나 추천해줘!'));
  const {deps,calls}=dependencies();const result=await recommendWithAi(input('몰라 아무거나'),deps);
  assert(result.restaurants.length>0);assert.equal(result.needsClarification,false);assert.equal(calls(),0);assert.equal(await used(),1);
});
test('unrelated input, clarification and no matching restaurant do not charge',async()=>{
  for(const [text,answer,clarifies]of [
    ['오늘 날씨 알려줘',plan({intent:'unrelated',question:''}),true],
    ['저녁 메뉴 추천',plan({intent:'clarification',question:'몇 시에 방문하시나요?'}),true],
    ['이세상에없는테스트메뉴 먹고싶어',plan({menuTerms:['이세상에없는테스트메뉴']}),false],
    ['abcdefzyx',plan({categories:[],forms:[],maxPrice:-1}),true]
  ] as const){
    await resetQuota();const {deps}=dependencies(A,{plan:answer});const result=await recommendWithAi(input(text),deps);
    assert.equal(result.restaurants.length,0);assert.equal(result.needsClarification,clarifies);assert.equal(await used(),0);
    assert.equal((await db.query<any>("select count(*) n from private.ai_requests where state='pending'")).rows[0].n,0);
  }
});
test('provider failures, invalid selections and invalid parsed filters release their reservations',async()=>{
  for(const options of [{fail:'provider'},{fail:'selection'},{plan:plan({categories:['가짜 업종']})}]){
    await resetQuota();const {deps}=dependencies(A,options);await assert.rejects(()=>recommendWithAi(input(),deps),options.fail==='provider'?/AI 연결/:options.fail==='selection'?/후보 밖|유효한/:/AI 검색/);assert.equal(await used(),0);
    assert.equal((await db.query<any>("select count(*) n from private.ai_requests where state='pending'")).rows[0].n,0);
  }
});
test('cancellation and an uncertain settlement response are not charged',async()=>{
  await resetQuota();const controller=new AbortController();const {deps}=dependencies(A,{signal:controller.signal,afterDecision:()=>controller.abort()});
  await assert.rejects(()=>recommendWithAi(input(),deps),/취소/);assert.equal(await used(),0);
  await resetQuota();const normal=dependencies().deps,settle=normal.settle;
  normal.settle=async(name,args)=>{const result=await settle(name,args);if(args?.p_success)throw Error('Settlement response lost');return result;};
  await assert.rejects(()=>recommendWithAi(input(),normal),/lost/);assert.equal(await used(),0);
});
test('a normal AI result costs one use; current administrators remain unlimited',async()=>{
  await resetQuota();const normal=dependencies();const result=await recommendWithAi(input(),normal.deps);
  assert.equal(result.restaurants.length,3);assert.equal(normal.calls(),2);assert.equal(await used(),1);
  for(let i=0;i<22;i++)await recommendWithAi(input('아무거나'),dependencies(ADMIN).deps);
  assert.equal(await used(ADMIN),0);assert.equal((await rpc(ADMIN)('ai_quota_status')).unlimited,true);
});
test('quota denial happens before model calls, with no new successful usage',async()=>{
  await resetQuota();await db.query("insert into private.ai_usage(user_id,day,calls) values($1,(now() at time zone 'Asia/Seoul')::date,20)",[A]);
  const {deps,calls}=dependencies();await assert.rejects(()=>recommendWithAi(input(),deps),error=>error instanceof AiRequestError&&error.status===429);assert.equal(calls(),0);assert.equal(await used(),20);
});
test('preferences are private, mutually exclusive, validated and bound to the expected account',async()=>{
  const settings={...emptyPreferences(),liked_categories:['한식'],avoided_categories:['치킨'],liked_forms:['밥'],avoided_menus:['짜장면'],min_price:5000,max_price:10000};
  await rpc(A)('save_food_preferences',{p_settings:settings,p_user_id:A});const saved=await rpc(A)('my_food_preferences');assert.deepEqual(saved.settings.liked_categories,['한식']);
  const other=await actor(B,'authenticated',tx=>tx.query('select * from food_preferences where user_id=$1',[A]));assert.equal(other.rows.length,0);
  await assert.rejects(()=>rpc(B)('save_food_preferences',{p_settings:settings,p_user_id:A}),/계정/);
  await assert.rejects(()=>rpc(A)('save_food_preferences',{p_settings:{...settings,avoided_categories:['한식']}}));
  await assert.rejects(()=>rpc(A)('save_food_preferences',{p_settings:{...settings,min_price:15000,max_price:10000}}));
  assert.deepEqual((await rpc(A)('my_food_preferences')).settings.liked_categories,['한식']);
  const filtered=applyPreferenceFilter({checkHours:false,max:3000},saved.filter);assert.equal(filtered.max,3000);assert.equal(filtered.min,undefined);
  const count=(await rpc(A)('pick_restaurants',{p_filter:applyPreferenceFilter({checkHours:false},saved.filter),p_size:3}));
  assert.equal(count.restaurants.length,3);assert(count.restaurants.every((r:any)=>r.restaurant.categories.includes('한식')&&!r.restaurant.categories.includes('치킨')));
});
test('signup stores optional preferences before email confirmation and safely ignores malformed metadata',async()=>{
  const first=crypto.randomUUID(),second=crypto.randomUUID();
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[first,'signup@example.test',{nickname:'새회원',food_preferences:{...emptyPreferences(),liked_categories:['일식']}}]);
  assert.deepEqual((await db.query<any>('select liked_categories from food_preferences where user_id=$1',[first])).rows[0].liked_categories,['일식']);
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[second,'malformed@example.test',{food_preferences:{liked_categories:'invalid'}}]);
  assert.deepEqual((await db.query<any>('select liked_categories from food_preferences where user_id=$1',[second])).rows[0].liked_categories,[]);
});
test('recommendation history uses real menu snapshots, deduplicates events and denies cross-account access',async()=>{
  const menu=(await db.query<any>("select id,price from menus where restaurant_id='15779' and name='대구탕' limit 1")).rows[0],event=crypto.randomUUID();
  const args={p_event_id:event,p_source:'ai',p_filter:{forms:['국·탕·찌개']},p_items:[{restaurantId:'15779',menuId:menu.id,name:'조작',price:1}],p_user_id:A};
  await rpc(A)('save_recommendation_history',args);await rpc(A)('save_recommendation_history',args);
  const rows=(await actor(A,'authenticated',tx=>tx.query('select * from recommendation_history where event_id=$1',[event]))).rows;assert.equal(rows.length,1);assert.equal(rows[0].menu_name,'대구탕');assert.equal(rows[0].price,30000);
  assert.equal((await actor(B,'authenticated',tx=>tx.query('select * from recommendation_history'))).rows.length,0);
  await assert.rejects(()=>rpc(B)('save_recommendation_history',{...args,p_user_id:A}),/계정/);
  await assert.rejects(()=>rpc(B)('set_history_visit',{p_id:rows[0].id,p_visited:true}),/찾지/);
  await actor(B,'authenticated',tx=>tx.query('delete from recommendation_history where id=$1',[rows[0].id]));
  assert.equal((await db.query<any>('select count(*) n from recommendation_history where id=$1',[rows[0].id])).rows[0].n,1);
});
test('only self-reported recent visits are excluded, and undo/expiry/settings restore eligibility',async()=>{
  const row=(await actor(A,'authenticated',tx=>tx.query("select * from recommendation_history where restaurant_id='15779' limit 1"))).rows[0];
  assert(!(await rpc(A)('my_food_preferences')).filter.excludedRestaurantIds.includes('15779'));
  await rpc(A)('set_history_visit',{p_id:row.id,p_visited:true});let prefs=await rpc(A)('my_food_preferences');assert(prefs.filter.excludedRestaurantIds.includes('15779'));
  const noHours=applyPreferenceFilter({checkHours:false,restaurantTerms:['미향일식']},prefs.filter);
  assert.equal((await rpc(A)('pick_restaurants',{p_filter:noHours,p_size:1})).restaurants.length,0);
  await rpc(A)('set_history_visit',{p_id:row.id,p_visited:false});assert(!(await rpc(A)('my_food_preferences')).filter.excludedRestaurantIds.includes('15779'));
  await actor(A,'authenticated',tx=>tx.query("update recommendation_history set visited_at=now()-interval '8 days' where id=$1",[row.id]));
  assert(!(await rpc(A)('my_food_preferences')).filter.excludedRestaurantIds.includes('15779'));
});
test('customer tickets are private, cannot forge replies and permit audited administrator answers',async()=>{
  const text='문의 내용 <script>alert(1)</script>';
  await actor(B,'authenticated',tx=>tx.query("insert into support_tickets(user_id,category,subject,body) values($1,'bug','추천 오류',$2)",[B,text]));
  const row=(await actor(B,'authenticated',tx=>tx.query('select * from support_tickets'))).rows[0];
  assert.equal((await actor(A,'authenticated',tx=>tx.query('select * from support_tickets'))).rows.length,0);
  await assert.rejects(()=>actor(B,'authenticated',tx=>tx.query("update support_tickets set reply='위조',status='answered' where id=$1",[row.id])));
  await assert.rejects(()=>rpc(B)('reply_support_ticket',{p_id:row.id,p_reply:'위조'}),/관리자/);
  await rpc(ADMIN)('reply_support_ticket',{p_id:row.id,p_reply:'오류를 확인했습니다.'});
  const updated=(await actor(B,'authenticated',tx=>tx.query('select * from support_tickets where id=$1',[row.id]))).rows[0];assert.equal(updated.status,'answered');assert.equal(updated.reply,'오류를 확인했습니다.');
  const audit=(await db.query<any>("select * from change_logs where entity='support_tickets' and entity_id=$1",[row.id])).rows[0];assert(!JSON.stringify(audit).includes(text));
});
test('account deletion cascades private data, removes posts and preserves anonymous restaurant processing',async()=>{
  const id=crypto.randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[id,'delete@example.test']);
  const menu=(await db.query<any>("select id from menus where restaurant_id='15779' and name='대구탕' limit 1")).rows[0];
  await actor(id,'authenticated',async tx=>{await tx.query('insert into favorites(user_id,menu_id) values($1,$2)',[id,menu.id]);await tx.query("insert into posts(user_id,title,body) values($1,'삭제할 글','내용')",[id]);await tx.query("insert into support_tickets(user_id,category,subject,body) values($1,'account','탈퇴 문의','내용')",[id]);});
  await rpc(id)('save_recommendation_history',{p_event_id:crypto.randomUUID(),p_source:'manual',p_filter:{},p_items:[{restaurantId:'15779',menuId:menu.id}]});
  const request=await rpc(id)('submit_request',{p_kind:'correction',p_restaurant_id:'15779',p_payload:{phone:'042-123-4567'},p_message:'개인 문의 메시지'});
  assert.equal((await rpc(id)('account_deletion_status')).allowed,true);await db.query('delete from auth.users where id=$1',[id]);
  for(const table of ['profiles','food_preferences','favorites','recommendation_history','support_tickets','posts'])assert.equal((await db.query<any>(`select count(*) n from ${table} where ${table==='profiles'?'id':'user_id'}=$1`,[id])).rows[0].n,0,table);
  const retained=(await db.query<any>('select user_id,message from requests where id=$1',[request])).rows[0];assert.equal(retained.user_id,null);assert.equal(retained.message,'');
  assert.equal((await rpc(MASTER)('account_deletion_status')).allowed,false);await assert.rejects(()=>db.query('delete from auth.users where id=$1',[MASTER]),/마스터/);
});
test('withdrawal requires confirmation, the same signed-in account and current password before any delete',async()=>{
  const calls:string[]=[],deps:AccountDeletionDependencies={status:async()=>({allowed:true}),verifyPassword:async password=>password==='correct-password'?{userId:A,token:'verified-test-token'}:null,signOutAll:async token=>{calls.push('logout:'+token);},deleteUser:async id=>{calls.push('delete:'+id);}};
  await assert.rejects(()=>deleteOwnAccount({confirm:false,expectedUserId:A,password:'correct-password'},A,deps),AccountDeletionError);
  await assert.rejects(()=>deleteOwnAccount({confirm:true,expectedUserId:B,password:'correct-password'},A,deps),AccountDeletionError);
  await assert.rejects(()=>deleteOwnAccount({confirm:true,expectedUserId:A,password:'wrong-password'},A,deps),/현재 비밀번호/);assert.deepEqual(calls,[]);
  await assert.rejects(()=>deleteOwnAccount({confirm:true,expectedUserId:A,password:'correct-password'},A,{...deps,status:async()=>({allowed:false,reason:'마스터 보호'})}),/마스터/);assert.deepEqual(calls,[]);
  assert.equal((await deleteOwnAccount({confirm:true,expectedUserId:A,password:'correct-password'},A,deps)).deleted,true);assert.deepEqual(calls,['logout:verified-test-token','delete:'+A]);
});
