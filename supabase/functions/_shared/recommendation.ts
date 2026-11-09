export interface Menu {id:string;restaurant_id:string;source_index:number;name:string;price:number|null;variable_price:boolean;forms:string[]}
export interface Restaurant {id:string;name:string;address:string;detail_address:string;phone:string;latitude:number|null;longitude:number|null;representative_menu:string;categories:string[];forms:string[];hours_display:string;source_fields:Record<string,string>}
export interface Candidate {restaurant:Restaurant;menus:Menu[];selected?:Menu|null}
export interface HistoryItem {role:'user'|'assistant';text:string}
export function seoulNow(){
  const now=new Date();
  return {date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),time:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now)};
}
export function legacyRecommendation(item:Candidate,count:number,filter:Record<string,unknown>={}){
  const r=item.restaurant,m=item.selected;
  return {...r.source_fields,'음식점아이디':r.id,'음식점명':r.name,'주소':r.address,'상세주소':r.detail_address,'전화번호':r.phone,'위도':r.latitude===null?'':String(r.latitude),'경도':r.longitude===null?'':String(r.longitude),'대표메뉴명':r.representative_menu,'운영시간정보':r.hours_display,
    _menu:m?.name??'',_menuId:m?.id??'',_menuIndex:m?String(m.source_index):'',_price:m?.price==null?'':String(m.price),_priceLabel:m?.variable_price?'변동가격':'',_priceMenu:m?.name??'',_menuForms:m?.forms.join(' · ')??'',
    _matchedMenuCount:String(item.menus.length),_matchedMenus:JSON.stringify(item.menus.map(menu=>({id:menu.id,name:menu.name,price:menu.price,...(menu.variable_price?{priceLabel:'변동가격'}:{})}))),
    _categories:r.categories.join(' · '),_forms:r.forms.join(' · '),_count:String(count),_timeApplied:String(filter.checkHours!==false)};
}
export function validateHistory(value:unknown):HistoryItem[]{
  if(!Array.isArray(value)||!value.length||value.length>8)throw Error('대화를 확인해 주세요.');
  let size=0;
  const result=value.map(item=>{
    if(!item||!['user','assistant'].includes(item.role)||typeof item.text!=='string'||item.text.length>1000||!item.text.trim())throw Error('대화를 확인해 주세요.');
    size+=item.text.length;return {role:item.role,text:item.text} as HistoryItem;
  });
  if(size>6000||!result.some(item=>item.role==='user'))throw Error('대화를 확인해 주세요.');
  return result;
}
export function validateSelection(value:unknown,pool:Candidate[],wanted:number,prior:Record<string,string>):Candidate[]{
  const picks=(value as {picks?:unknown})?.picks;
  if(!Array.isArray(picks)||picks.length!==wanted)throw Error('AI가 유효한 메뉴를 고르지 못했습니다. 다시 시도해 주세요.');
  const seen=new Set<string>();
  return picks.map(p=>{
    const candidate=pool.find(item=>item.restaurant.id===p?.restaurantId);
    if(!candidate||seen.has(p.restaurantId)||!Number.isInteger(p.menuIndex))throw Error('AI가 후보 밖의 메뉴를 반환했습니다. 다시 시도해 주세요.');
    seen.add(p.restaurantId);
    const selected=candidate.menus.find(menu=>menu.source_index===p.menuIndex);
    if(!selected&&!(p.menuIndex===-1&&candidate.menus.length===0))throw Error('AI가 후보 밖의 메뉴를 반환했습니다. 다시 시도해 주세요.');
    if(candidate.menus.length>1&&String(p.menuIndex)===prior[candidate.restaurant.id])throw Error('AI가 이전 메뉴를 다시 반환했습니다. 다시 시도해 주세요.');
    return {...candidate,selected:selected??null};
  });
}
export function planFilter(value:Record<string,unknown>,categories:string[],forms:string[]){
  const filter:Record<string,unknown>={...seoulNow(),checkHours:value.allHours!==true};
  for(const [source,target,options] of [['categories','categories',categories],['excludedCategories','excludedCategories',categories],['forms','forms',forms],['excludedForms','excludedForms',forms]] as const){
    const values=value[source];
    if(!Array.isArray(values)||values.length>30||values.some(v=>typeof v!=='string'||!options.includes(v)))throw Error('AI 검색 조건을 확인하지 못했습니다. 다시 시도해 주세요.');
    filter[target]=values;
  }
  for(const key of ['menuTerms','excludedTerms','restaurantTerms','excludedRestaurants']){
    const values=value[key];if(!Array.isArray(values)||values.length>20||values.some(v=>typeof v!=='string'||!v.trim()||v.length>100))throw Error('AI 검색 조건을 확인하지 못했습니다.');filter[key]=values;
  }
  for(const [source,target] of [['minPrice','min'],['maxPrice','max']]){
    const amount=value[source];if(!Number.isInteger(amount)||(amount as number)<-1||(amount as number)>2147483647)throw Error('AI 가격 조건을 확인하지 못했습니다.');
    if((amount as number)>=0)filter[target]=amount;
  }
  if(filter.min!=null&&filter.max!=null&&Number(filter.min)>Number(filter.max))throw Error('최소·최대 가격을 확인해 주세요.');
  for(const key of ['date','time']){
    if(typeof value[key]!=='string')throw Error('방문 일시를 확인해 주세요.');
    if(value[key]){
      if(!(key==='date'?/^\d{4}-\d{2}-\d{2}$/:/^([01]\d|2[0-3]):[0-5]\d$/).test(value[key] as string))throw Error('방문 일시를 확인해 주세요.');
      filter[key]=value[key];
    }
  }
  return filter;
}
