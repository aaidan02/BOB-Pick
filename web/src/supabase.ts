import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const db=url&&key&&!url.includes('YOUR_PROJECT')&&!key.startsWith('YOUR_')?createClient(url,key,{auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}}):null;
export function client(){if(!db)throw Error('Supabase 연결 설정이 필요합니다.');return db;}
export async function rpc<T=any>(name:string,args:Record<string,unknown>={},signal?:AbortSignal):Promise<T>{
  let request=client().rpc(name,args);if(signal)request=request.abortSignal(signal);
  const {data,error}=await request;if(error)throw Error(error.message);return data as T;
}
