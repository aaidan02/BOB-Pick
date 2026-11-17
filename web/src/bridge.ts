import {client,rpc} from './supabase';
import {friendly} from './ui';
import {legacyRecommendation,type Candidate} from '../../supabase/functions/_shared/recommendation';
import {applyPreferenceFilter} from '../../supabase/functions/_shared/preferences';
import {activePreferenceFilter,preferencesFailed} from './preference-state';
export {directionsUrl} from './naver';

export function manualFilter(q:URLSearchParams){
  const filter:Record<string,unknown>={checkHours:q.get('time')!=='all',categories:q.get('category')?[q.get('category')]:[],forms:q.get('form')?[q.get('form')]:[]};
  for(const key of ['min','max'])if(q.has(key)&&q.get(key)!==''){
    const value=Number(q.get(key));if(!Number.isInteger(value)||value<0||value>2147483647)throw Error('최소·최대 가격을 확인해 주세요.');filter[key]=value;
  }
  if(filter.min!=null&&filter.max!=null&&Number(filter.min)>Number(filter.max))throw Error('최소·최대 가격을 확인해 주세요.');
  if(q.get('date'))filter.date=q.get('date');if(q.get('time')&&q.get('time')!=='all')filter.time=q.get('time');
  if(q.get('taste')==='on'){
    if(preferencesFailed())throw Error('취향을 불러오지 못했어요. 다시 로그인하거나 내 취향 반영을 해제해 주세요.');
    const preferences=activePreferenceFilter();delete preferences.min;delete preferences.max;
    return applyPreferenceFilter(filter,preferences);
  }
  return filter;
}
export function batchState(q:URLSearchParams){
  const locked:string[]=[],prior:Record<string,string>={};
  for(let i=0;i<3;i++){
    if(q.get('exclude'+i))locked.push(q.get('exclude'+i)!);
    if(q.get('prior'+i))prior[q.get('prior'+i)!]=q.get('menu'+i)??'';
  }
  return {locked,prior};
}
export async function appFetch(url:string,options:RequestInit={}):Promise<Response>{
  try{
    const parsed=new URL(url,location.origin),q=parsed.searchParams,signal=options.signal??undefined;
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(parsed.pathname==='/api/chat'){
      const q=new URLSearchParams(String(options.body??'')),{locked,prior}=batchState(q);
      const {data:{session}}=await client().auth.getSession();if(!session)return new Response('AI 추천은 로그인 후 사용할 수 있습니다.',{status:401});
      try{
        const response=await fetch(import.meta.env.VITE_SUPABASE_URL+'/functions/v1/ai-recommend',{method:'POST',headers:{'Content-Type':'application/json',apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({history:JSON.parse(q.get('history')??'[]'),size:Number(q.get('size')??3),locked,prior,usePreferences:q.get('taste')==='on'}),signal});
        const data=await response.json();return new Response(response.ok?JSON.stringify(data):friendly(data.error??'AI 추천에 실패했습니다.'),{status:response.status,headers:{'Content-Type':response.ok?'application/json':'text/plain'}});
      }finally{window.dispatchEvent(new Event('ai-usage-changed'));}
    }
    if(parsed.pathname==='/api/retry'){
      const {filter,size,locked,prior}=JSON.parse(String(options.body??'{}'));
      if(!filter||typeof filter!=='object'||Array.isArray(filter))throw Error('재검색 조건을 확인해 주세요.');
      const batch=await rpc<{count:number;restaurants:Candidate[]}>('pick_restaurants',{p_filter:filter,p_size:size,p_locked:locked,p_prior:prior},signal);
      return Response.json({count:batch.count,restaurants:batch.restaurants.map(item=>legacyRecommendation(item,batch.count,filter))});
    }
    const filter=manualFilter(q);
    if(parsed.pathname==='/api/count')return new Response(String(await rpc('recommend_count',{p_filter:filter},signal)));
    if(['/api/pick','/api/picks'].includes(parsed.pathname)){
      const {locked,prior}=batchState(q),single=parsed.pathname==='/api/pick';
      if(single&&q.get('previous'))prior[q.get('previous')!]=q.get('previousMenu')??'';
      const batch=await rpc<{count:number;restaurants:Candidate[]}>('pick_restaurants',{p_filter:filter,p_size:single?1:Number(q.get('size')??3),p_locked:locked,p_prior:prior},signal);
      const restaurants=batch.restaurants.map(item=>legacyRecommendation(item,batch.count,filter));
      if(single){if(!restaurants.length)return new Response('조건에 맞는 음식점이 없습니다.',{status:404});return new Response(new URLSearchParams(restaurants[0]).toString());}
      return Response.json({...batch,restaurants});
    }
    return fetch(url,options);
  }catch(error){
    if(options.signal?.aborted)throw error;
    return new Response(friendly(error),{status:400});
  }
}
