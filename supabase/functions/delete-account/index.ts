import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {deleteOwnAccount,AccountDeletionError} from '../_shared/account-deletion.ts';
Deno.serve(async req=>{
  const origin=req.headers.get('Origin')??'',allowed=(Deno.env.get('ALLOWED_ORIGINS')??'').split(',').map(s=>s.trim()).filter(Boolean);
  const cors={'Access-Control-Allow-Origin':origin||'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(origin&&allowed.length&&!allowed.includes(origin))return reply(403,{error:'허용되지 않은 접속 주소입니다.'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply(405,{error:'지원하지 않는 요청입니다.'});
  try{
    const authorization=req.headers.get('Authorization')??'';
    if(!/^Bearer \S+$/.test(authorization))return reply(401,{error:'로그인 후 이용해 주세요.'});
    const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
    const client=createClient(url,key,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error}=await client.auth.getUser(authorization.slice(7));if(error||!user?.email)return reply(401,{error:'로그인 후 다시 시도해 주세요.'});
    if(Number(req.headers.get('Content-Length')??0)>4096)return reply(413,{error:'요청 내용을 확인해 주세요.'});
    const text=await req.text();if(text.length>4096)return reply(413,{error:'요청 내용을 확인해 주세요.'});
    const verifier=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!serviceKey)throw Error('탈퇴 연결 설정이 필요합니다.');
    const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const result=await deleteOwnAccount(JSON.parse(text),user.id,{
      status:async()=>{const {data,error}=await client.rpc('account_deletion_status');if(error)throw error;return data;},
      verifyPassword:async password=>{const {data,error}=await verifier.auth.signInWithPassword({email:user.email!,password});if(error||!data.user||!data.session)return null;return {userId:data.user.id,token:data.session.access_token};},
      signOutAll:async token=>{const {error}=await service.auth.admin.signOut(token,'global');if(error)throw error;},
      deleteUser:async id=>{const {error}=await service.auth.admin.deleteUser(id);if(error)throw error;}
    });
    return reply(200,result);
  }catch(error){console.error('delete-account failed',error instanceof Error?error.name:'Error');return reply(error instanceof AccountDeletionError?error.status:400,{error:error instanceof AccountDeletionError?error.message:'탈퇴하지 못했습니다. 계정은 유지됩니다. 잠시 후 다시 시도해 주세요.'});}
});
