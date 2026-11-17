import {admin,user,requireUser} from './auth';
import {rpc} from './supabase';
import {date,el,input,message,node,friendly} from './ui';
import {clearPhotoGalleries,renderPhotoGallery} from './community-photos';
type Kind='post'|'restaurant';
type Item={id:string;title:string;subtitle:string;deleted:boolean;changed_at:string;version_count:number};
type Preview={kind:Kind;id:string;version_id:number|null;expected:string;current:any;target:any;versions:{id:number;created_at:string;reason:string}[]};
let kind:Kind='post',offset=0,generation=0,busy=false,identity='';
const selected=new Map<string,Preview>();
export function restoreMarkup(){return `
<section id="admin-restore-panel" class="service-panel" hidden aria-labelledby="restore-heading">
  <div class="page-heading heading-actions"><div><a href="#admin" class="inline-link">← 관리자 페이지</a><p class="section-eyebrow">밥픽 운영</p><h1 id="restore-heading">복원하기</h1><p>삭제한 글과 가게의 이전 정보를 확인하고 복원해요.</p></div><button id="restore-reload" type="button" class="secondary">새로고침</button></div>
  <p id="restore-access" class="surface empty-state" hidden>관리자 계정으로 로그인해 주세요. <a href="#account">로그인하기 →</a></p>
  <div id="restore-content" hidden><div class="surface restore-tools"><div class="account-tabs" role="tablist" aria-label="복원할 항목"><button id="restore-tab-post" type="button" role="tab" aria-selected="true" aria-controls="restore-list">게시글 복원</button><button id="restore-tab-restaurant" type="button" role="tab" aria-selected="false" aria-controls="restore-list">가게 정보 복원</button></div><label class="search-field">복원 내역 검색<input id="restore-search" type="search" maxlength="120" placeholder="제목·가게 이름·주소로 검색"></label><p class="helper">항목을 펼쳐 현재 내용과 복원할 내용을 확인해 주세요.</p></div>
    <div class="restore-selection"><span id="restore-selection-count" role="status">선택한 항목 없음</span><button id="restore-apply" type="button" disabled>선택 항목 복원</button></div>
    <p id="restore-status" class="form-status" role="status"></p><div id="restore-list" role="tabpanel" aria-labelledby="restore-tab-post"></div><div class="button-row pagination"><button id="restore-prev" type="button" class="secondary" hidden>이전</button><button id="restore-next" type="button" class="secondary" hidden>다음</button></div>
  </div>
</section>`;}
function updateSelection(){el('restore-selection-count').textContent=selected.size?`${selected.size}개 선택됨`:'선택한 항목 없음';el<HTMLButtonElement>('restore-apply').disabled=busy||!selected.size;}
function fields(host:HTMLElement,values:[string,unknown][]){
  const list=node('dl','','restore-fields');for(const [label,value]of values){list.append(node('dt',label),node('dd',Array.isArray(value)?value.join(' · '):value==null||value===''?'없음':String(value)));}host.append(list);
}
const price=(menu:any)=>menu.variable_price?'변동가격':menu.price==null?'가격 표시 없음':Number(menu.price).toLocaleString('ko-KR')+'원';
function snapshot(host:HTMLElement,data:any,type:Kind){
  if(type==='post'){
    fields(host,[['공개 상태',data.deleted?'삭제됨':'게시 중'],['제목',data.title]]);host.append(node('p',data.body,'restore-post-body'));
    if(data.photo_ids?.length){const photos=node('div');host.append(photos);renderPhotoGallery(photos,data.photo_ids);}
  }else{
    const r=data.restaurant;fields(host,[['가게 이름',r.name],['주소',r.address],['상세 주소',r.detail_address],['전화번호',r.phone],['가게 상태',r.active?'공개':'숨김'],['대표 메뉴',r.representative_menu],['음식 종류',r.categories],['음식 형태',r.forms],['영업시간',r.hours_display||r.hours_text],['지도 좌표',r.latitude!=null&&r.longitude!=null?`${r.latitude}, ${r.longitude}`:'없음']]);
    const menus=node('details','','restore-menus');menus.append(node('summary',`메뉴 ${data.menus.length}개 확인`));
    const list=node('ul');for(const m of data.menus)list.append(node('li',`${m.name} · ${price(m)}${m.forms?.length?' · '+m.forms.join(' / '):''}${m.active?'':' · 숨김'}`));menus.append(list);host.append(menus);
  }
}
export async function loadRestore(){
  const mine=++generation,who=user?.id;selected.clear();updateSelection();clearPhotoGalleries(el('restore-list'));el('restore-list').replaceChildren();
  el('restore-access').hidden=admin;el('restore-content').hidden=!admin;if(!admin||!who)return;
  message('restore-status','복원할 내역을 불러오고 있어요.');
  try{
    const rows=await rpc<Item[]>('admin_restore_items',{p_kind:kind,p_query:input('restore-search'),p_offset:offset});
    if(mine!==generation||user?.id!==who||!admin)return;
    for(const row of rows){
      const card=node('details','','surface restore-card'),summary=node('summary','','restore-summary'),head=node('div');head.append(node('h2',row.title),node('small',row.subtitle+' · '+date(row.changed_at)));summary.append(head,node('span',kind==='post'&&row.deleted?'삭제됨':`이전 기록 ${row.version_count}개`,'status-badge'));
      const body=node('div','','restore-card-body'),status=node('p','','form-status');status.setAttribute('role','status');body.append(status);card.append(summary,body);el('restore-list').append(card);
      let previewed=false,request=0,previous:Preview|null=null;
      const show=async(versionId:number|null=null)=>{
        if(busy)return;const req=++request;selected.delete(row.id);updateSelection();status.textContent='내용을 불러오고 있어요.';
        try{
          const preview=await rpc<Preview>('admin_restore_preview',{p_kind:kind,p_id:row.id,p_version_id:versionId});
          if(req!==request||mine!==generation||user?.id!==who||!admin)return;previous=preview;clearPhotoGalleries(body);body.replaceChildren();
          const label=node('label','복원할 시점'),select=node('select');select.setAttribute('aria-label',row.title+' 복원 시점');
          if(kind==='post'&&row.deleted){const opt=node('option','삭제된 현재 내용으로 다시 공개');opt.value='current';select.append(opt);}
          for(const v of preview.versions){const opt=node('option',date(v.created_at)+' · '+(v.reason==='deleted'?'삭제 전':v.reason==='restored'?'복원 전':'수정 전'));opt.value=String(v.id);select.append(opt);}
          select.value=preview.version_id===null?'current':String(preview.version_id);select.onchange=()=>void show(select.value==='current'?null:Number(select.value));label.append(select);
          const compare=node('div','','restore-comparison'),current=node('section'),target=node('section');current.append(node('h3','현재 내용'));target.append(node('h3',kind==='post'?'복원 후 다시 공개할 내용':'복원할 이전 정보'));snapshot(current,preview.current,kind);snapshot(target,preview.target,kind);compare.append(current,target);
          const checkbox=node('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label',row.title+' 복원 선택');const checkLabel=node('label','','checkbox');checkLabel.append(checkbox,document.createTextNode('내용을 확인했고 이 항목을 복원할게요'));
          checkbox.onchange=()=>{if(busy){checkbox.checked=selected.has(row.id);return;}if(checkbox.checked)selected.set(row.id,preview);else selected.delete(row.id);updateSelection();};
          body.append(label,compare,checkLabel,status);status.textContent='';
        }catch(error){if(req===request&&mine===generation){body.replaceChildren(status);status.textContent=friendly(error);previewed=false;}}
      };
      card.addEventListener('toggle',()=>{if(card.open&&!previewed){previewed=true;void show();}if(!card.open&&previous){/* Keep the reviewed selection until refresh or tab change. */}});
    }
    el('restore-prev').hidden=offset===0;el('restore-next').hidden=rows.length<20;message('restore-status',rows.length?'':input('restore-search')?'검색된 복원 내역이 없어요.':'복원할 내역이 없어요.');
  }catch(error){if(mine===generation)message('restore-status',friendly(error));}
}
export function initRestore(){
  let timer:ReturnType<typeof setTimeout>;
  const switchTab=(next:Kind)=>{if(busy)return;kind=next;offset=0;for(const t of ['post','restaurant'])el('restore-tab-'+t).setAttribute('aria-selected',String(t===kind));el('restore-list').setAttribute('aria-labelledby','restore-tab-'+kind);void loadRestore();};
  for(const t of ['post','restaurant'] as const)el('restore-tab-'+t).onclick=()=>switchTab(t);
  el('restore-tab-post').parentElement!.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();switchTab(event.key==='Home'?'post':event.key==='End'?'restaurant':kind==='post'?'restaurant':'post');el('restore-tab-'+kind).focus();}};
  el('restore-reload').onclick=()=>{if(!busy)void loadRestore();};
  el('restore-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!busy){offset=0;void loadRestore();}},250);};
  el('restore-prev').onclick=()=>{if(!busy){offset=Math.max(0,offset-20);void loadRestore();}};el('restore-next').onclick=()=>{if(!busy){offset+=20;void loadRestore();}};
  el('restore-apply').onclick=async()=>{
    if(busy||!selected.size||!admin)return;
    const items=Array.from(selected.values()).map(p=>({kind:p.kind,id:p.id,version_id:p.version_id,expected:p.expected})),actor=requireUser().id;
    if(!confirm(`${items.length}개 항목을 확인한 내용으로 복원할까요? 게시글은 다시 공개되고 가게 정보는 선택한 이전 값으로 바뀝니다.`))return;
    busy=true;updateSelection();message('restore-status','복원하고 있어요.');
    el('restore-content').querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select').forEach(e=>e.disabled=true);
    try{
      const count=await rpc<number>('admin_restore_selected',{p_items:items,p_expected_actor:actor});
      if(user?.id!==actor||!admin)return;busy=false;await loadRestore();message('restore-status',`${count}개 항목을 복원했습니다.`);
    }catch(error){if(user?.id===actor&&admin)message('restore-status',friendly(error));}
    finally{busy=false;el('restore-content').querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('input,button,select').forEach(e=>e.disabled=false);updateSelection();}
  };
  window.addEventListener('identity-changed',()=>{const next=(user?.id??'')+':'+admin;if(next===identity)return;identity=next;generation++;selected.clear();el('restore-list').replaceChildren();el('restore-content').hidden=!admin;el('restore-access').hidden=admin;updateSelection();if(location.hash==='#admin-restore')void loadRestore();});
}
