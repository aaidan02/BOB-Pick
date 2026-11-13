export interface CatalogPlace {id:string;name:string;address?:string;categories:string[];latitude:number|null;longitude:number|null}
export const normalized=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const generic=new Set(['카페','음식점','식당','치킨','피자','한식','양식','중식','일식','분식','밥','면','커피','디저트']);
function aliases(place:CatalogPlace){return [...new Set([normalized(place.name),normalized(place.name.split(/\s/)[0])])].filter(s=>s.length>=3&&!generic.has(s));}
export function stripPlaceNames(text:string,places:CatalogPlace[]){
  for(const p of places)for(const name of [p.name,p.name.split(/\s/)[0]]){if(name.length<3)continue;const pattern=[...name.replace(/\s/g,'')].map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*');text=text.replace(new RegExp(pattern,'gi'),'');}return text;
}
export function placeMatches(text:string,catalog:CatalogPlace[]){
  const id=/^(?:음식점\s*)?(?:아이디|id|#)\s*[:：]?\s*([a-zA-Z0-9_-]+)$/i.exec(text.trim())?.[1]??(/^\d+$/.test(text.trim())?text.trim():null);if(id)return catalog.filter(p=>p.id===id);
  const value=normalized(text),full=catalog.filter(p=>normalized(p.name).length>=2&&!generic.has(normalized(p.name))&&value.includes(normalized(p.name)));
  if(full.length)return full.filter(p=>!full.some(other=>other.id!==p.id&&normalized(other.name).includes(normalized(p.name))));
  const matches=catalog.flatMap(p=>aliases(p).filter(a=>value.includes(a)).map(a=>({p,length:a.length})));
  const longest=Math.max(0,...matches.map(m=>m.length));return [...new Map(matches.filter(m=>m.length===longest).map(m=>[m.p.id,m.p])).values()];
}
function edits(a:string,b:string){let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(row[j]+1,next[j-1]+1,row[j-1]+Number(a[i-1]!==b[j-1]));row=next;}return row[b.length];}
export function similarPlaces(text:string,catalog:CatalogPlace[]){
  const value=normalized(text.replace(/추천해줘|추천해주세요|추천|알려줘|찾아줘|찾아주세요|메뉴|어때|가게|음식점/g,''));
  if(value.length<3||value.length>30||generic.has(value))return [];
  const ranked=catalog.map(p=>({p,score:Math.min(...aliases(p).map(a=>{const distance=edits(a,value);return distance<=1||(distance<=2&&value.length>=4&&a.startsWith(value.slice(0,2)))?distance:99;}))})).filter(m=>m.score<99);
  const best=Math.min(...ranked.map(m=>m.score));return ranked.filter(m=>m.score===best).slice(0,5).map(m=>m.p);
}
export function spatialRequest(text:string){
  const match=/(?:와|과|에서|의)?\s*(?:근처|주변|가까운|가까이|인근|옆)\s*(?:에\s*있는\s*|의\s*)?/.exec(text);
  return match?{anchor:text.slice(0,match.index).trim(),target:text.slice(match.index+match[0].length).trim()}:null;
}
export function foodHints(text:string,categories:string[],forms:string[]){
  const cats:string[]=[],fs:string[]=[];let rest=text;
  // Explicit exclusions belong to the planner; never turn them into positives.
  if(/빼고|제외|말고|싫|안\s*먹|피하/.test(text))return {categories:cats,forms:fs,noisy:false};
  for(const c of categories){const names=c.includes('카페')?['카페','커피','디저트']:c==='패스트푸드'?['패스트푸드','페스트푸드']: [c];if(names.some(name=>rest.includes(name))){cats.push(c);for(const name of names)rest=rest.replaceAll(name,'');}}
  const soup=/국물|국[·.]탕|국밥|찌개|(?:대구|매운|감자|설렁|갈비|내장|곰)탕|탕(?=\s|$|요리|추천|먹|찾)/.test(rest);
  for(const [form,names]of [['밥',['밥']],['면',['면']],['튀김',['튀김']],['구이',['구이']],['찜·삶음',['찜']],['볶음',['볶음']]] as const){if(form==='밥'&&soup)continue;if(forms.includes(form)&&names.some(name=>rest.includes(name)))fs.push(form);}
  if(soup&&forms.includes('국·탕·찌개'))fs.push('국·탕·찌개');
  return {categories:[...new Set(cats)],forms:[...new Set(fs)],noisy:(/[ㄱ-ㅎㅏ-ㅣ]/.test(text)||/^(밥|면|치킨|카페|커피|피자)\1+$/.test(text.trim()))&&!!(cats.length||fs.length)};
}
export function placeQuestion(term:string,places:CatalogPlace[]){return places.length?`‘${term.slice(0,80)}’과 비슷한 등록명이 있어요. ${places.slice(0,3).map(p=>'‘'+p.name.slice(0,80)+'’ ('+(p.address?.slice(0,60)||'둔산동')+', ID '+p.id.slice(0,50)+')').join(', ')} 중 어느 곳인가요? 이름·지점이나 ID로 알려주세요.`:`‘${term.slice(0,120)}’을 기준 장소로 찾지 못했어요. 등록된 음식점이나 카페의 이름·지점을 알려주세요.`;}
