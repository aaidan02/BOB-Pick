import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {recommendWithAi,AiRequestError} from '../_shared/ai-service.ts';

async function generate(prompt:string,data:unknown,responseSchema:unknown,signal?:AbortSignal){
  const key=Deno.env.get('GEMINI_API_KEY');if(!key)throw Error('AI 연결 설정이 필요합니다.');
  const model=Deno.env.get('GEMINI_MODEL')||'gemini-3.5-flash-lite';
  if(!/^[a-zA-Z0-9.-]+$/.test(model))throw Error('AI 모델 설정을 확인해 주세요.');
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:AbortSignal.any([AbortSignal.timeout(45000),...(signal?[signal]:[])]),body:JSON.stringify({systemInstruction:{parts:[{text:prompt}]},contents:[{role:'user',parts:[{text:JSON.stringify(data)}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:responseSchema,...(model.startsWith('gemini-3')?{thinkingConfig:{thinkingLevel:model.includes('flash-lite')?'minimal':'low'}}:{})}})});
  if(!response.ok){await response.body?.cancel();throw Error(`AI 연결에 실패했습니다. 잠시 후 다시 시도해 주세요. (${response.status})`);}
  const reader=response.body?.getReader();if(!reader)throw Error('AI 응답이 없습니다.');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw Error('AI 응답이 너무 깁니다.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const packet=JSON.parse(new TextDecoder().decode(bytes));
  const candidate=packet.candidates?.[0];if(candidate?.finishReason!=='STOP')throw Error('AI 응답이 완료되지 않았습니다. 다시 시도해 주세요.');
  return JSON.parse(candidate.content.parts.filter((part:{thought?:boolean})=>!part.thought).map((part:{text?:string})=>part.text??'').join(''));
}
Deno.serve(async req=>{
  const origin=req.headers.get('Origin')??'';
  const allowed=(Deno.env.get('ALLOWED_ORIGINS')??'').split(',').map(s=>s.trim()).filter(Boolean);
  const cors={'Access-Control-Allow-Origin':origin||'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(origin&&allowed.length&&!allowed.includes(origin))return reply(403,{error:'허용되지 않은 접속 주소입니다.'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply(405,{error:'지원하지 않는 요청입니다.'});
  try{
    const token=req.headers.get('Authorization')??'';
    if(!/^Bearer \S+$/.test(token))return reply(401,{error:'AI 추천은 로그인 후 사용할 수 있습니다.'});
    const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:token}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:authError}=await client.auth.getUser(token.slice(7));
    if(authError||!user)return reply(401,{error:'로그인 후 다시 시도해 주세요.'});
    if(Number(req.headers.get('Content-Length')??0)>65536)return reply(413,{error:'요청 내용이 너무 깁니다.'});
    const body=await req.text();if(body.length>65536)return reply(413,{error:'요청 내용이 너무 깁니다.'});
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!serviceKey)throw Error('AI 연결 설정이 필요합니다.');
    const service=createClient(Deno.env.get('SUPABASE_URL')!,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const rpc=(db:typeof client)=>async(name:string,args:Record<string,unknown>={})=>{const {data,error}=await db.rpc(name,args);if(error)throw Object.assign(Error(error.message),{code:error.code});return data;};
    const call=rpc(client);
    const result=await recommendWithAi(JSON.parse(body),{rpc:call,settle:rpc(service),generate,signal:req.signal,restaurantCatalog:async()=>{
      const {data,error}=await client.from('restaurants').select('id,name,address,categories,latitude,longitude').eq('active',true).limit(10000);if(error)throw Error('음식점 이름을 불러오지 못했습니다.');return data??[];
    },preferences:async()=>{
      const saved=await call('my_food_preferences');return saved.filter;
    }});
    return reply(200,result);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    console.error('ai-recommend failed',error instanceof Error?error.name:'Error');
    return reply(error instanceof AiRequestError?error.status:400,{error:/^(AI|방문|최소|대화|음식점|추천|요청|진행|오늘|거리|기준 장소)/.test(message)?message:'추천 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'});
  }
});
