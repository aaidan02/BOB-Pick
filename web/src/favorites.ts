import {client} from './supabase';
import {user,requireUser} from './auth';
import {date,el,friendly,node,price} from './ui';
import {directionsUrl} from './bridge';
const saved=new Set<string>(),pending=new Set<string>();let generation=0,offset=0;
export function paintFavorites(){
  document.querySelectorAll<HTMLButtonElement>('.save-menu').forEach(button=>{
    const id=button.dataset.menuId??'';button.disabled=pending.has(id);button.setAttribute('aria-pressed',String(saved.has(id)));button.textContent=saved.has(id)?'메뉴 찜 해제 ♥':'메뉴 찜하기 ♡';
  });
}
async function loadIds(){
  const mine=++generation;saved.clear();paintFavorites();
  if(!user)return;
  const who=user.id;
  for(let offset=0;;offset+=500){
    const {data,error}=await client().from('favorites').select('menu_id').eq('user_id',who).range(offset,offset+499);
    if(mine!==generation||error)return;for(const row of data??[])saved.add(row.menu_id);
    if((data?.length??0)<500)break;
  }
  paintFavorites();
}
async function toggle(menuId:string){
  const who=requireUser();if(pending.has(menuId))return;
  pending.add(menuId);paintFavorites();
  try{
    const removing=saved.has(menuId);
    const result=removing?await client().from('favorites').delete().eq('user_id',who.id).eq('menu_id',menuId):await client().from('favorites').insert({user_id:who.id,menu_id:menuId});
    if(result.error&&result.error.code!=='23505')throw result.error;
    if(user?.id===who.id){if(removing)saved.delete(menuId);else saved.add(menuId);if(location.hash==='#favorites'){offset=0;await loadFavorites();}}
  }finally{pending.delete(menuId);paintFavorites();}
}
export async function loadFavorites(append=false){
  const mine=generation;if(!append)el('favorite-list').replaceChildren();
  if(!user){el('favorite-status').textContent='로그인하면 찜한 메뉴를 볼 수 있어요.';return;}
  const {data,error}=await client().from('favorites').select('id,menu_id,created_at,menus(id,name,price,variable_price,restaurants(id,name,address,latitude,longitude))').eq('user_id',user.id).order('created_at',{ascending:false}).range(offset,offset+49);
  if(mine!==generation)return;
  if(error){el('favorite-status').textContent=friendly(error);return;}
  for(const row of data??[]){
    const m=row.menus as any,r=m?.restaurants,card=node('article','','list-card'),remove=node('button','찜 해제 ♥','save-menu secondary');
    remove.dataset.menuId=row.menu_id;
    card.append(node('h3',m?.name??'현재 추천 대상이 아닌 메뉴'),node('p',r?.name??''),node('p',m?price(m):''));
    if(r){const link=node('a','네이버 길찾기 ↗');link.href=directionsUrl(r);link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
    card.append(node('small',date(row.created_at)),remove);el('favorite-list').append(card);
  }
  el('favorite-more').hidden=(data?.length??0)<50;
  el('favorite-status').textContent=el('favorite-list').children.length?'':'아직 찜한 메뉴가 없습니다.';paintFavorites();
}
export function initFavorites(){
  document.addEventListener('click',event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('.save-menu');if(!button?.dataset.menuId)return;
    void toggle(button.dataset.menuId).catch(error=>{el('favorite-status').textContent=friendly(error);if(user)alert(friendly(error));});
  });
  el('favorite-more').onclick=()=>{offset+=50;void loadFavorites(true);};
  window.addEventListener('identity-changed',()=>{offset=0;el('favorite-list').replaceChildren();void loadIds();if(location.hash==='#favorites')void loadFavorites();});
  window.addEventListener('recommendations-rendered',paintFavorites);
}
