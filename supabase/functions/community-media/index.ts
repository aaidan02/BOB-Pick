import {createClient,type SupabaseClient} from 'npm:@supabase/supabase-js@2.119.0';
import {communityMedia,MediaError} from '../_shared/community-media.ts';
const bucket='community-images';
Deno.serve(async req=>{
  const origin=req.headers.get('Origin')??'',allowed=(Deno.env.get('ALLOWED_ORIGINS')??'').split(',').map(s=>s.trim()).filter(Boolean);
  const cors={'Access-Control-Allow-Origin':origin||'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Vary':'Origin'};
  if(origin&&allowed.length&&!allowed.includes(origin))return new Response(null,{status:403,headers:cors});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_ANON_KEY')!;
  const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const invoke=(db:SupabaseClient<any>)=>async(name:string,args:Record<string,unknown>={})=>{const {data,error}=await db.rpc(name,args);if(error)throw error;return data;};
  const response=await communityMedia(req,{
    actor:async()=>{
      const authorization=req.headers.get('Authorization'),client=createClient(url,key,{global:{headers:authorization?{Authorization:authorization}:{}},auth:{persistSession:false,autoRefreshToken:false}});
      let userId:string|null=null;
      if(authorization){
        if(!/^Bearer \S+$/.test(authorization))throw new MediaError('로그인 후 다시 시도해 주세요.',401);
        const {data,error}=await client.auth.getUser(authorization.slice(7));if(error||!data.user)throw new MediaError('로그인 후 다시 시도해 주세요.',401);userId=data.user.id;
      }
      return {userId,rpc:invoke(client)};
    },
    service:invoke(service),
    ensureBucket:async()=>{
      let {data,error}=await service.storage.getBucket(bucket);
      if(error){const created=await service.storage.createBucket(bucket,{public:false,fileSizeLimit:5*1024*1024,allowedMimeTypes:['image/jpeg','image/png','image/webp']});if(created.error){const again=await service.storage.getBucket(bucket);if(again.error)throw created.error;data=again.data;}}
      if(data?.public)throw Error('Expected private media bucket');
    },
    upload:async(path,bytes,contentType)=>{const {error}=await service.storage.from(bucket).upload(path,bytes,{contentType,upsert:false,cacheControl:'0'});if(error)throw error;},
    download:async path=>{const {data,error}=await service.storage.from(bucket).download(path);if(error)throw error;return data;},
    remove:async paths=>{const {error}=await service.storage.from(bucket).remove(paths);if(error)throw error;}
  });
  const headers=new Headers(response.headers);for(const [name,value]of Object.entries(cors))headers.set(name,value);
  return new Response(response.body,{status:response.status,headers});
});
