import {rpc} from './supabase';
import {el,node} from './ui';
import {directionsUrl,type MapPlace} from './naver';
type PopularPlace=MapPlace&{id:string;address:string;metric_count:number};
type Popularity={startedAt:string;searches:PopularPlace[];visits:PopularPlace[];favorites:PopularPlace[]};
let version=0,controller:AbortController|null=null,timer:ReturnType<typeof setTimeout>,loaded=false;
async function loadPopularity(){
  controller?.abort();controller=new AbortController();const mine=++version;el<HTMLButtonElement>('popularity-reload').disabled=true;
  try{
    const data=await rpc<Popularity>('site_popularity',{},controller.signal);if(mine!==version)return;
    for(const kind of ['searches','visits','favorites'] as const){
      if(!Array.isArray(data[kind]))throw Error('Invalid statistics');
      const list=el('popular-'+kind);list.replaceChildren();
      data[kind].forEach((row,index)=>{
        const count=Number(row.metric_count);if(!Number.isFinite(count)||count<=0||typeof row.name!=='string')return;
        const item=node('li'),link=node('a','','popular-place'),rank=node('span',String(index+1),'popular-rank'),info=node('span','','popular-place-info');
        info.append(node('strong',row.name),node('small',row.address||'둔산동'));link.href=directionsUrl(row);link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',row.name+' 네이버 길찾기 (새 탭)');
        link.append(rank,info,node('span',count.toLocaleString('ko-KR')+(kind==='searches'?'회':'명'),'popular-total'));item.dataset.restaurantId=row.id;item.append(link);list.append(item);
      });
      if(!list.children.length){const text=kind==='searches'?'아직 집계된 검색 결과가 없어요.':kind==='visits'?'아직 방문 표시가 없어요.':'아직 찜한 메뉴가 없어요.';list.append(node('li',text,'popular-empty'));}
    }
    const started=new Date(data.startedAt);if(Number.isFinite(started.getTime()))el('popular-started').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'}).format(started)+'부터 검색 집계';
    loaded=true;el('popularity-status').textContent='';
  }catch{if(mine===version){el('popularity-status').textContent='인기 음식점을 불러오지 못했어요. 새로고침으로 다시 확인해 주세요.';if(!loaded)for(const kind of ['searches','visits','favorites'])el('popular-'+kind).replaceChildren(node('li','잠시 후 다시 확인해 주세요.','popular-empty'));}}
  finally{if(mine===version)el<HTMLButtonElement>('popularity-reload').disabled=false;}
}
export function initPopularity(){
  el('popularity-reload').onclick=()=>void loadPopularity();
  const changed=()=>{clearTimeout(timer);timer=setTimeout(()=>void loadPopularity(),200);};
  window.addEventListener('site-activity-changed',changed);window.addEventListener('identity-changed',changed);window.addEventListener('focus',changed);
  void loadPopularity();
}
