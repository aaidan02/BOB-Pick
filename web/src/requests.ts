import {client,rpc} from './supabase';
import {admin,user,requireUser} from './auth';
import {action,date,el,input,message,node,friendly} from './ui';
const labels:Record<string,string>={correction:'정보 수정',registration:'음식점 등록',promotion:'홍보',pending:'대기',approved:'승인',rejected:'반려'};
const fieldLabels:Record<string,string>={name:'음식점 이름',address:'주소',phone:'전화번호',latitude:'위도',longitude:'경도',categories:'음식 종류',forms:'음식 형태',hours_text:'영업시간',hours_display:'영업시간',title:'홍보 제목',content:'홍보 내용',ends_at:'종료일',active:'추천 대상',price:'가격',variable_price:'변동가격'};
type StoreOption={id:string;name:string;address:string};
let stores:StoreOption[]=[],storesLoaded=false,storeLoad:Promise<void>|null=null;
let requestVersion=0,adminVersion=0,menuVersion=0;
function priceStep(field:HTMLInputElement){field.addEventListener('input',()=>{const n=Number(field.value);field.min=Number.isInteger(n)&&n>=0?String(n%1000):'0';});}
function option(select:HTMLSelectElement,value:string,text:string){const item=node('option',text);item.value=value;select.append(item);}
function searchText(value:string){return value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();}
function renderStores(){
  const query=searchText(input('request-search')),select=el<HTMLSelectElement>('request-target'),previous=select.value;
  const matching=stores.filter(row=>[row.name,row.address,row.id].some(value=>searchText(value).includes(query)));
  select.replaceChildren();
  option(select,'',!storesLoaded?'음식점을 불러오는 중입니다':matching.length?'음식점을 선택하세요':'검색된 음식점이 없습니다');
  for(const row of matching)option(select,row.id,row.name+(row.address?' · '+row.address:'')+' ('+row.id+')');
  select.value=matching.some(row=>row.id===previous)?previous:'';
  message('request-search-status',!storesLoaded?'음식점을 불러오는 중입니다.':(query?'검색 결과 ':'전체 ')+matching.length.toLocaleString('ko-KR')+'곳');
  if(previous!==select.value||!select.value)void loadMenus().catch(error=>message('request-status',friendly(error)));
}
function loadStores(){
  if(storeLoad)return storeLoad;
  storeLoad=(async()=>{
    const loaded:StoreOption[]=[];
    for(let offset=0;;offset+=500){
      const {data,error}=await client().from('restaurants').select('id,name,address').eq('active',true).order('name').order('id').range(offset,offset+499);
      if(error)throw error;loaded.push(...(data??[]));if((data?.length??0)<500)break;
    }
    stores=loaded;storesLoaded=true;renderStores();
  })().finally(()=>{storeLoad=null;});
  return storeLoad;
}
function addMenu(){
  const row=node('div','','menu-input-row portal-grid');row.innerHTML='<label>메뉴명<input class="new-menu-name" maxlength="300" required></label><label>가격 (원)<input class="new-menu-price" type="number" min="0" step="1000"></label><label>음식 형태<select class="new-menu-form"></select></label><label class="checkbox"><input class="new-menu-variable" type="checkbox">변동가격</label><button class="remove-menu secondary" type="button">이 메뉴 삭제</button>';
  priceStep(row.querySelector<HTMLInputElement>('.new-menu-price')!);
  row.querySelector<HTMLButtonElement>('.remove-menu')!.onclick=()=>row.remove();
  const select=row.querySelector<HTMLSelectElement>('select')!;option(select,'미분류','미분류');
  for(const item of el<HTMLSelectElement>('form').options)if(item.value&&item.value!=='미분류')option(select,item.value,item.text);
  row.querySelector<HTMLInputElement>('.new-menu-variable')!.onchange=event=>{row.querySelector<HTMLInputElement>('.new-menu-price')!.disabled=(event.target as HTMLInputElement).checked;};
  el('request-menu-rows').append(row);
}
function changeKind(){
  const kind=input('request-kind'),registration=kind==='registration',promotion=kind==='promotion';
  el('request-target-row').hidden=registration;el<HTMLSelectElement>('request-target').required=!registration;
  el('request-details').hidden=promotion;(el('request-details') as HTMLFieldSetElement).disabled=promotion;
  el('promotion-details').hidden=!promotion;(el('promotion-details') as HTMLFieldSetElement).disabled=!promotion;
  el('request-category-row').hidden=!registration;el('registration-menus').hidden=!registration;el('correction-menu').hidden=registration;
  el<HTMLInputElement>('request-name').required=registration;el<HTMLInputElement>('request-address').required=registration;
  el<HTMLInputElement>('promotion-title').required=promotion;el<HTMLTextAreaElement>('promotion-content').required=promotion;el<HTMLInputElement>('promotion-end').required=promotion;
  el('request-menu-rows').querySelectorAll<HTMLInputElement>('input').forEach(input=>input.disabled=!registration);
  if(registration&&!el('request-menu-rows').children.length)addMenu();
  el('request-hours-row').hidden=!el<HTMLInputElement>('request-hours-enabled').checked;
  renderStores();
}
async function loadMenus(){
  const mine=++menuVersion,id=input('request-target'),select=el<HTMLSelectElement>('request-menu');select.replaceChildren();option(select,'','메뉴 가격은 변경하지 않음');
  const price=el<HTMLInputElement>('request-menu-price');price.value='';price.disabled=false;price.min='0';el<HTMLInputElement>('request-menu-variable').checked=false;
  if(!id)return;
  const {data,error}=await client().from('menus').select('id,name').eq('restaurant_id',id).eq('active',true).order('source_index');if(error)throw error;if(mine!==menuVersion)return;
  for(const menu of data??[])option(select,menu.id,menu.name);
}
function summary(payload:Record<string,any>){
  const box=node('dl','','request-summary');
  for(const [key,value] of Object.entries(payload)){
    if(key==='hours_text'&&payload.hours_display)continue;
    if(key==='menus'){
      box.append(node('dt','메뉴'),node('dd',value.map((m:any)=>m.name+' · '+(m.variable_price?'변동가격':m.price==null?'가격 표시 없음':Number(m.price).toLocaleString('ko-KR')+'원')).join('\n')));
    }else if(key==='menu_patch'){
      box.append(node('dt','메뉴 가격 수정'),node('dd',value.variable_price?'변동가격':Number(value.price).toLocaleString('ko-KR')+'원'));
    }else if(fieldLabels[key])box.append(node('dt',fieldLabels[key]),node('dd',Array.isArray(value)?value.join(' · '):String(value??'')));
  }
  return box;
}
function requestCard(row:any){
  const card=node('article','','list-card');card.append(node('h3',labels[row.kind]+' · '+labels[row.status]),node('small',date(row.created_at)),summary(row.payload));
  if(row.message)card.append(node('p',row.message));
  for(const review of row.request_reviews??[])card.append(node('p',(labels[review.decision]??review.decision)+(review.note?' · '+review.note:'')));
  return card;
}
export async function loadRequests(){
  const mine=++requestVersion;el('request-list').replaceChildren();if(!user)return;
  try{
    await loadStores();
    const {data,error}=await client().from('requests').select('*,request_reviews(*)').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100);if(error)throw error;if(mine!==requestVersion)return;
    for(const row of data??[])el('request-list').append(requestCard(row));
    if(!data?.length)el('request-list').append(node('p','신청 내역이 없습니다.'));
  }catch(error){if(mine===requestVersion)message('request-status',friendly(error));}
}
export async function loadAdmin(){
  const mine=++adminVersion;el('admin-pending').replaceChildren();el('admin-reviews').replaceChildren();el('admin-logs').replaceChildren();
  if(!admin){el('admin-content').hidden=true;message('admin-status','관리자 권한이 필요합니다.');return;}
  el('admin-content').hidden=false;
  try{
    const results=await Promise.all([
      client().from('requests').select('*,request_reviews(*)').eq('status','pending').order('created_at').limit(100),
      client().from('requests').select('*,request_reviews(*)').neq('status','pending').order('reviewed_at',{ascending:false}).limit(50),
      client().from('change_logs').select('*').order('created_at',{ascending:false}).limit(100)
    ]);
    for(const result of results)if(result.error)throw result.error;if(mine!==adminVersion||!admin)return;
    for(const row of results[0].data??[]){
      const card=requestCard(row),note=node('textarea'),approve=node('button','승인'),reject=node('button','반려','secondary'),actions=node('div','','button-row');
      note.maxLength=3000;note.placeholder='처리 사유';note.setAttribute('aria-label','처리 사유');
      for(const [button,decision] of [[approve,'approved'],[reject,'rejected']] as const)button.onclick=()=>void action(button,'admin-status',async()=>{
        requireUser();approve.disabled=true;reject.disabled=true;
        try{await rpc('review_request',{p_request_id:row.id,p_decision:decision,p_note:note.value.trim()});await loadAdmin();message('admin-status','처리했습니다.');}
        finally{approve.disabled=false;reject.disabled=false;}
      });
      actions.append(approve,reject);card.append(note,actions);el('admin-pending').append(card);
    }
    if(!results[0].data?.length)el('admin-pending').append(node('p','대기 중인 신청이 없습니다.'));
    for(const row of results[1].data??[])el('admin-reviews').append(requestCard(row));
    for(const row of results[2].data??[]){
      const card=node('article','','list-card'),parts=row.action.split(':');card.append(node('h3',(labels[parts[0]]??parts[0])+' · '+(labels[parts[1]]??'')),node('small',date(row.created_at)));
      const changed:Record<string,any>={};for(const [key,value] of Object.entries(row.after_data??{}))if(fieldLabels[key]&&JSON.stringify(value)!==JSON.stringify(row.before_data?.[key]))changed[key]=value;
      card.append(summary(changed));
      if(row.after_data?.menu){const before=row.before_data?.menu,after=row.after_data.menu,format=(m:any)=>m?.variable_price?'변동가격':m?.price==null?'가격 표시 없음':Number(m.price).toLocaleString('ko-KR')+'원';card.append(node('p',after.name+' · '+format(before)+' → '+format(after)));}
      el('admin-logs').append(card);
    }
    message('admin-status','');
  }catch(error){if(mine===adminVersion)message('admin-status',friendly(error));}
}
export function initRequests(){
  priceStep(el<HTMLInputElement>('request-menu-price'));
  const categories=el<HTMLSelectElement>('request-category');for(const item of el<HTMLSelectElement>('category').options)if(item.value)option(categories,item.value,item.text);
  el('request-kind').onchange=changeKind;changeKind();
  el('request-search').oninput=renderStores;
  el('request-search').onkeydown=event=>{
    if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();renderStores();el('request-target').focus();}
  };
  el('request-target').onchange=()=>void loadMenus().catch(error=>message('request-status',friendly(error)));
  el('request-add-menu').onclick=addMenu;
  el('request-hours-enabled').onchange=()=>{el('request-hours-row').hidden=!el<HTMLInputElement>('request-hours-enabled').checked;};
  el('request-menu-variable').onchange=()=>{el<HTMLInputElement>('request-menu-price').disabled=el<HTMLInputElement>('request-menu-variable').checked;};
  el('admin-reload').onclick=()=>void loadAdmin();
  el<HTMLFormElement>('request-form').onsubmit=event=>{
    event.preventDefault();void action(el('request-submit'),'request-status',async()=>{
      requireUser();const kind=input('request-kind'),payload:Record<string,any>={};
      if(kind==='promotion'){
        Object.assign(payload,{title:input('promotion-title'),content:input('promotion-content'),ends_at:input('promotion-end')+'T23:59:59+09:00'});
        if(!payload.title||!payload.content||new Date(payload.ends_at).getTime()<=Date.now())throw Error('홍보 제목·내용과 종료 날짜를 확인해 주세요.');
      }else{
        for(const key of ['name','address','phone','latitude','longitude'])if(input('request-'+key))payload[key]=input('request-'+key);
        if(el<HTMLInputElement>('request-hours-enabled').checked){
          const open=input('request-open'),close=input('request-close');if(!open||!close)throw Error('영업 시작과 종료 시각을 입력해 주세요.');
          const end=close===open?'익일'+close:close;
          payload.hours_text=[...'월화수목금토일'].map(day=>day+'='+open+'~'+end).join(' | ');payload.hours_display='매일 '+open+' ~ '+(close<=open?'익일 ':'')+close;
        }
        if(kind==='registration'){
          payload.categories=[input('request-category')];payload.menus=[];
          for(const row of el('request-menu-rows').children){
            const name=row.querySelector<HTMLInputElement>('.new-menu-name')!.value.trim(),amount=row.querySelector<HTMLInputElement>('.new-menu-price')!.value,variable=row.querySelector<HTMLInputElement>('.new-menu-variable')!.checked;
            if(!name)throw Error('메뉴명을 입력해 주세요.');
            if(!variable&&amount&&(!Number.isInteger(Number(amount))||Number(amount)<=0))throw Error('가격은 0보다 큰 정수로 입력해 주세요.');
            payload.menus.push({name,price:variable||!amount?null:Number(amount),variable_price:variable,forms:[row.querySelector<HTMLSelectElement>('.new-menu-form')!.value]});
          }
          if(!payload.menus.length)throw Error('메뉴를 한 개 이상 입력해 주세요.');
          payload.forms=[...new Set(payload.menus.flatMap((m:any)=>m.forms))];
        }else if(input('request-menu')&&(input('request-menu-price')||el<HTMLInputElement>('request-menu-variable').checked)){
          const variable=el<HTMLInputElement>('request-menu-variable').checked,amount=Number(input('request-menu-price'));
          if(!variable&&(!Number.isInteger(amount)||amount<=0))throw Error('가격은 0보다 큰 정수로 입력해 주세요.');
          payload.menu_patch={id:input('request-menu'),price:variable?null:amount,variable_price:variable};
        }
      }
      if(!Object.keys(payload).length)throw Error('수정할 내용을 입력해 주세요.');
      await rpc('submit_request',{p_kind:kind,p_restaurant_id:kind==='registration'?null:input('request-target'),p_payload:payload,p_message:input('request-message')});
      el<HTMLFormElement>('request-form').reset();el('request-menu-rows').replaceChildren();changeKind();await loadRequests();message('request-status','신청을 접수했습니다.');
    });
  };
  window.addEventListener('identity-changed',()=>{el('request-list').replaceChildren();el('admin-pending').replaceChildren();el('admin-reviews').replaceChildren();el('admin-logs').replaceChildren();if(location.hash==='#requests')void loadRequests();});
}
