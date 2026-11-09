import './style.css';
import './portal.css';
import {db,rpc} from './supabase';
import {directionsUrl} from './bridge';
import {initPortal} from './portal';
import {el,friendly,node} from './ui';

async function loadPromotions(){
  if(!db)return;
  const {data,error}=await db.from('promotions').select('title,content,restaurants(name,latitude,longitude)').order('created_at',{ascending:false}).limit(12);
  if(error||!data?.length)return;
  const section=node('section','','filters');section.setAttribute('aria-label','동네 가게 소식');section.append(node('h2','동네 가게 소식'));
  const grid=node('div','','portal-grid');
  for(const row of data){
    const r=row.restaurants as any,card=node('article','','list-card');card.append(node('h3',row.title),node('p',row.content));
    if(r){const link=node('a',r.name+' · 네이버 길찾기 ↗');link.href=directionsUrl(r);link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
    grid.append(card);
  }
  section.append(grid);el('home-view').querySelector('.content')!.append(section);
}

async function start(){
  if(db){
    try{
      const options=await rpc<{categories:string[];forms:string[]}>('catalog_options');
      for(const [id,values] of [['category',options.categories],['form',options.forms]] as const){
        const select=el<HTMLSelectElement>(id);for(const value of values){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option);}
      }
    }catch(error){el('status').textContent=friendly(error);}
  }
  await initPortal().catch(error=>{el('auth-status').textContent=friendly(error);});
  await import('./legacy.js');
  void loadPromotions();
}
void start();
