import {deleteOwnAccount,AccountDeletionError} from '../supabase/functions/_shared/account-deletion.ts';
import {recommendWithAi,AiRequestError} from '../supabase/functions/_shared/ai-service.ts';
/** Local test-only Auth/PostgREST facade backed by real PostgreSQL/RLS (PGlite). */
import {createServer} from 'node:http';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email varchar(255),raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
await db.exec(readFileSync('supabase/seed.sql','utf8'));
const users=new Map<string,any>(),tokens=new Map<string,any>(),passwords=new Map<string,string>();
for(const [suffix,email] of [['1','a@example.test'],['2','b@example.test'],['3','admin@example.test'],['4','pending@example.test'],['5','master@example.test']]){
  const id='00000000-0000-4000-8000-00000000000'+suffix;
  const user={id,aud:'authenticated',role:'authenticated',email,email_confirmed_at:suffix==='4'?null:new Date().toISOString(),created_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{nickname:'밥친구'+suffix}};
  users.set(email,user);passwords.set(email,'test-password');await db.query('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,$4)',[id,email,user.user_metadata,user.email_confirmed_at]);
  if(['3','5'].includes(suffix))await db.query('insert into private.admin_members(user_id,is_master) values($1,$2)',[id,suffix==='5']);
}
function session(user:any){
  const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test-only-signature';
  tokens.set(token,user);return {access_token:token,refresh_token:'test-refresh-'+user.id,expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};
}
const rpcArgs:Record<string,string[]>={catalog_options:[],is_admin:[],recommend_count:['p_filter'],recommend_candidates:['p_filter'],pick_restaurants:['p_filter','p_size','p_locked','p_prior'],search_posts:['p_query','p_offset','p_mine'],submit_request:['p_kind','p_restaurant_id','p_payload','p_message'],review_request:['p_request_id','p_decision','p_note'],consume_ai_quota:[],ai_quota_status:[],admin_list_accounts:[],admin_search_accounts:['p_query'],admin_set_membership:['p_user_id','p_enabled'],begin_ai_request:[],complete_ai_request:['p_request_id','p_success'],save_food_preferences:['p_settings','p_user_id'],my_food_preferences:[],my_account_overview:[],account_deletion_status:[],save_recommendation_history:['p_event_id','p_source','p_filter','p_items','p_user_id'],set_history_visit:['p_id','p_visited'],reply_support_ticket:['p_id','p_reply']};
createServer(async(req,res)=>{
  const origin=req.headers.origin??'*';res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,prefer,range,range-unit,x-supabase-api-version,content-profile,accept-profile,x-retry-count');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  const send=(status:number,data:any)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(data==null?'':JSON.stringify(data));};
  if(req.method==='OPTIONS'){send(204,null);return;}
  const url=new URL(req.url!,'http://localhost'),user=tokens.get((req.headers.authorization??'').replace(/^Bearer /,''));
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  try{
    if(url.pathname==='/health'){send(200,{ok:true});return;}
    if(url.pathname.startsWith('/auth/v1/')){
      if(url.pathname.endsWith('/token')){const found=users.get(body.email);if(!found||body.password!==passwords.get(body.email)){send(400,{message:'Invalid login credentials',error_description:'Invalid login credentials'});return;}send(200,session(found));return;}
      if(url.pathname.endsWith('/signup')){
        const id=crypto.randomUUID(),created={id,email:body.email,aud:'authenticated',role:'authenticated',user_metadata:body.data??{},app_metadata:{provider:'email'},created_at:new Date().toISOString()};
        await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,body.email,body.data??{}]);users.set(body.email,created);passwords.set(body.email,body.password);send(200,session(created));return;
      }
      if(url.pathname.endsWith('/user')&&user&&['PUT','PATCH'].includes(req.method!)){if(body.password)passwords.set(user.email,body.password);send(200,user);return;}
      if(url.pathname.endsWith('/user')){send(user?200:401,user??{message:'Not logged in'});return;}
      send(204,null);return;
    }
    if(url.pathname==='/functions/v1/ai-recommend'){
      if(!user){send(401,{error:'로그인 후 이용해 주세요.'});return;}
      const invoke=(role:string,actor:string|null)=>async(name:string,args:Record<string,unknown>={})=>db.transaction(async tx=>{
        await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor??'']);
        const keys=Object.keys(args);if(name==='recommend_candidates')return (await tx.query<any>(`select * from public.${name}(${keys.map((key,i)=>key+'=> $'+(i+1)).join(',')})`,Object.values(args))).rows;return (await tx.query<any>(`select public.${name}(${keys.map((key,i)=>key+'=> $'+(i+1)).join(',')}) value`,Object.values(args))).rows[0].value;
      });
      const call=invoke('authenticated',user.id);
      try{
        const result=await recommendWithAi(body,{rpc:call,settle:invoke('service_role',null),now:()=>({date:'2026-11-12',time:'12:00'}),preferences:async()=>(await call('my_food_preferences')).filter,
          generate:async(_prompt:string,data:any)=>{
            if(data.candidates)return {picks:data.candidates.slice(0,data.wanted).map((row:any)=>({restaurantId:row[0],menuIndex:row[3][0]?.[0]??-1}))};
            const text=data.history.filter((item:any)=>item.role==='user').at(-1).text;
            if(/테스트 오류|강제 실패/.test(text))throw Error('AI 연결에 실패했습니다.');
            const plan:any={intent:'recommendation',categories:[],excludedCategories:[],forms:[],excludedForms:[],menuTerms:[],excludedTerms:[],restaurantTerms:[],excludedRestaurants:[],minPrice:-1,maxPrice:-1,date:'',time:'',allHours:/영업시간.*무시/.test(text),question:''};
            if(/날씨|자바 코드|영화/.test(text)){plan.intent='unrelated';return plan;}
            if(/확인 질문/.test(text)){plan.intent='clarification';plan.question='방문 시각을 알려주세요.';return plan;}
            if(/국물|국밥|탕/.test(text))plan.forms=['국·탕·찌개'];
            if(/한식/.test(text))plan.categories=['한식'];if(/치킨/.test(text))plan.categories=['치킨'];
            if(/만 ?원|10000/.test(text))plan.maxPrice=10000;
            if(/존재하지않는메뉴/.test(text))plan.menuTerms=['존재하지않는메뉴'];
            return plan;
          }});
        send(200,result);
      }catch(error){send(error instanceof AiRequestError?error.status:400,{error:(error as Error).message});}
      return;
    }
    if(url.pathname==='/functions/v1/delete-account'){
      if(!user){send(401,{error:'로그인 후 이용해 주세요.'});return;}
      try{
        const result=await deleteOwnAccount(body,user.id,{
          status:()=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user.id]);return (await tx.query<any>('select public.account_deletion_status() status')).rows[0].status;}),
          verifyPassword:async password=>password===passwords.get(user.email)?{userId:user.id,token:'verified-test-token'}:null,
          signOutAll:async()=>{},
          deleteUser:async id=>{await db.query('delete from auth.users where id=$1',[id]);users.delete(user.email);passwords.delete(user.email);for(const [token,record] of tokens)if(record.id===id)tokens.delete(token);}
        });
        send(200,result);
      }catch(error){send(error instanceof AccountDeletionError?error.status:400,{error:(error as Error).message});}
      return;
    }
    const result=await db.transaction(async tx=>{
      await tx.exec('set local role '+(user?'authenticated':'anon'));
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user?.id??'']);
      const name=url.pathname.split('/').at(-1)!;
      if(url.pathname.startsWith('/rest/v1/rpc/')){
        const args=rpcArgs[name];if(!args)throw Error('Unknown test RPC');
        const values=args.map(k=>body[k]??null),slots=args.map((_,i)=>'$'+(i+1)).join(',');
        if(['recommend_candidates','search_posts','admin_list_accounts','admin_search_accounts'].includes(name))return (await tx.query(`select * from public.${name}(${slots})`,values)).rows;
        return (await tx.query<any>(`select public.${name}(${slots}) value`,values)).rows[0].value;
      }
      if(!['profiles','restaurants','menus','favorites','posts','requests','change_logs','promotions','food_preferences','recommendation_history','support_tickets'].includes(name))throw Error('Unknown test table');
      const where:string[]=[],values:any[]=[];
      for(const [key,value] of url.searchParams){
        if(['select','limit','offset','order'].includes(key))continue;
        if(!/^[a-z_]+$/.test(key))throw Error('Bad filter');
        if(value==='not.is.null'||value==='is.null'){where.push(`t.${key} is ${value.startsWith('not')?'not ':''}null`);continue;}
        const match=/^(eq|neq)\.(.*)$/.exec(value);if(!match)continue;values.push(match[2]);where.push(`t.${key}${match[1]==='eq'?'=':'<>'}$${values.length}`);
      }
      const clause=where.length?' where '+where.join(' and '):'';
      if(req.method==='GET'){
        let select='t.*';
        if(name==='favorites')select=`t.*, (select to_jsonb(m)||jsonb_build_object('restaurants',(select to_jsonb(r) from restaurants r where r.id=m.restaurant_id)) from menus m where m.id=t.menu_id) menus`;
        if(name==='requests')select=`t.*,(select to_jsonb(v) from request_reviews v where v.request_id=t.id) request_reviews,(select jsonb_build_object('name',r.name) from restaurants r where r.id=t.restaurant_id) restaurants`;
        const ordering=url.searchParams.get('order')?.split(',')??[];
        const order=ordering.length?' order by '+ordering.map(part=>{const [column,direction]=part.split('.');if(!/^[a-z_]+$/.test(column))throw Error('Bad order');return 't.'+column+(direction==='desc'?' desc':' asc');}).join(','):'';
        const rows=(await tx.query<any>(`select ${select} from public.${name} t${clause}${order} limit ${Math.min(10000,Number(url.searchParams.get('limit')??1000))} offset ${Number(url.searchParams.get('offset')??0)}`,values)).rows;
        if(req.headers.accept?.includes('vnd.pgrst.object'))return rows[0]??null;
        return rows;
      }
      if(req.method==='POST'){
        const keys=Object.keys(body);if(keys.some(k=>!/^[a-z_]+$/.test(k)))throw Error('Bad column');
        await tx.query(`insert into public.${name}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>body[k]));return null;
      }
      if(req.method==='PATCH'){
        const assignments=Object.entries(body).map(([key,value])=>{if(!/^[a-z_]+$/.test(key))throw Error('Bad column');values.push(value);return key+'=$'+values.length;});
        const changed=await tx.query(`update public.${name} t set ${assignments.join(',')}${clause} returning t.*`,values);return req.headers.prefer?.includes('return=representation')?changed.rows:null;
      }
      if(req.method==='DELETE'){const changed=await tx.query(`delete from public.${name} t${clause} returning t.*`,values);return req.headers.prefer?.includes('return=representation')?changed.rows:null;}
      throw Error('Unknown method');
    });
    send(req.method==='GET'||url.pathname.includes('/rpc/')||result!==null?200:req.method==='POST'?201:204,result);
  }catch(error){send(400,{message:(error as Error).message,code:(error as any).code??'TEST'});}
}).listen(Number(process.env.BOB_PICK_FIXTURE_PORT??54329),'127.0.0.1',()=>console.log('Test-only Supabase facade ready'));
