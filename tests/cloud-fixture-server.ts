/** Local test-only Auth/PostgREST facade backed by real PostgreSQL/RLS (PGlite). */
import {createServer} from 'node:http';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email varchar(255),raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const file of readdirSync('supabase/migrations').sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
await db.exec(readFileSync('supabase/seed.sql','utf8'));
const users=new Map<string,any>(),tokens=new Map<string,any>();
for(const [suffix,email] of [['1','a@example.test'],['2','b@example.test'],['3','admin@example.test'],['4','pending@example.test'],['5','master@example.test']]){
  const id='00000000-0000-4000-8000-00000000000'+suffix;
  const user={id,aud:'authenticated',role:'authenticated',email,email_confirmed_at:suffix==='4'?null:new Date().toISOString(),created_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{nickname:'밥친구'+suffix}};
  users.set(email,user);await db.query('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,$4)',[id,email,user.user_metadata,user.email_confirmed_at]);
  if(['3','5'].includes(suffix))await db.query('insert into private.admin_members(user_id,is_master) values($1,$2)',[id,suffix==='5']);
}
function session(user:any){
  const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test-only-signature';
  tokens.set(token,user);return {access_token:token,refresh_token:'test-refresh-'+user.id,expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};
}
const rpcArgs:Record<string,string[]>={catalog_options:[],is_admin:[],recommend_count:['p_filter'],recommend_candidates:['p_filter'],pick_restaurants:['p_filter','p_size','p_locked','p_prior'],search_posts:['p_query','p_offset','p_mine'],submit_request:['p_kind','p_restaurant_id','p_payload','p_message'],review_request:['p_request_id','p_decision','p_note'],consume_ai_quota:[],admin_list_accounts:[],admin_search_accounts:['p_query'],admin_set_membership:['p_user_id','p_enabled']};
createServer(async(req,res)=>{
  const origin=req.headers.origin??'*';res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,prefer,range,range-unit,x-supabase-api-version');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  const send=(status:number,data:any)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(data==null?'':JSON.stringify(data));};
  if(req.method==='OPTIONS'){send(204,null);return;}
  const url=new URL(req.url!,'http://localhost'),user=tokens.get((req.headers.authorization??'').replace(/^Bearer /,''));
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  try{
    if(url.pathname==='/health'){send(200,{ok:true});return;}
    if(url.pathname.startsWith('/auth/v1/')){
      if(url.pathname.endsWith('/token')){const found=users.get(body.email);if(!found||body.password!=='test-password'){send(400,{message:'Invalid login credentials',error_description:'Invalid login credentials'});return;}send(200,session(found));return;}
      if(url.pathname.endsWith('/signup')){
        const id=crypto.randomUUID(),created={id,email:body.email,aud:'authenticated',role:'authenticated',user_metadata:body.data??{},app_metadata:{provider:'email'},created_at:new Date().toISOString()};
        await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,body.email,body.data??{}]);users.set(body.email,created);send(200,session(created));return;
      }
      if(url.pathname.endsWith('/user')){send(user?200:401,user??{message:'Not logged in'});return;}
      send(204,null);return;
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
      if(!['profiles','restaurants','menus','favorites','posts','requests','change_logs','promotions'].includes(name))throw Error('Unknown test table');
      const where:string[]=[],values:any[]=[];
      for(const [key,value] of url.searchParams){
        if(['select','limit','offset','order'].includes(key))continue;
        if(!/^[a-z_]+$/.test(key))throw Error('Bad filter');
        const match=/^(eq|neq)\.(.*)$/.exec(value);if(!match)continue;values.push(match[2]);where.push(`t.${key}${match[1]==='eq'?'=':'<>'}$${values.length}`);
      }
      const clause=where.length?' where '+where.join(' and '):'';
      if(req.method==='GET'){
        let select='t.*';
        if(name==='favorites')select=`t.*, (select to_jsonb(m)||jsonb_build_object('restaurants',(select to_jsonb(r) from restaurants r where r.id=m.restaurant_id)) from menus m where m.id=t.menu_id) menus`;
        if(name==='requests')select=`t.*,(select to_jsonb(v) from request_reviews v where v.request_id=t.id) request_reviews,(select jsonb_build_object('name',r.name) from restaurants r where r.id=t.restaurant_id) restaurants`;
        const ordering=url.searchParams.get('order')?.split('.');
        const order=ordering&&/^[a-z_]+$/.test(ordering[0])?' order by t.'+ordering[0]+(ordering[1]==='desc'?' desc':' asc'):'';
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
}).listen(54329,'127.0.0.1',()=>console.log('Test-only Supabase facade ready'));
