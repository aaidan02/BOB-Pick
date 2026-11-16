import {rpc} from './supabase';
import {admin,user,requireUser,refreshIdentity} from './auth';
import {date,el,input,message,node,friendly} from './ui';
type ManagedUser={user_id:string;email:string;nickname:string;is_admin:boolean;is_master:boolean;is_self:boolean;state:'active'|'forced'|'withdrawn';revision:number;purge_at:string|null;reason:string;can_force:boolean;can_restore:boolean;blocked_reason:string};
let version=0,offset=0,busy=false,identity='';
const states={active:'이용 중',forced:'강제 탈퇴',withdrawn:'탈퇴 유예 중'};
export function adminUsersMarkup(){return `<details id="admin-users-section" class="surface account-details"><summary><h2>사용자 계정 관리</h2></summary><p class="helper">회원을 검색해 강제 탈퇴하거나, 7일 이내에 강제 탈퇴를 취소할 수 있어요.</p><form id="admin-user-search-form" class="admin-user-search-form"><label class="grow">회원 이메일 또는 닉네임<input id="admin-user-query" type="search" minlength="2" maxlength="254" required placeholder="이메일이나 닉네임으로 검색" autocomplete="off"></label><label>계정 상태<select id="admin-user-state"><option value="all">전체</option><option value="active">이용 중</option><option value="forced">강제 탈퇴</option><option value="withdrawn">탈퇴 유예 중</option></select></label><button id="admin-user-search" type="submit">회원 검색</button></form><p id="admin-user-status" class="form-status" role="status"></p><div id="admin-user-results" class="admin-users-results"></div><div class="button-row"><button id="admin-user-prev" type="button" class="secondary" hidden>이전</button><button id="admin-user-next" type="button" class="secondary" hidden>다음</button></div></details>`;}
function setBusy(value:boolean){busy=value;el('admin-users-section').querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('input,select,textarea,button').forEach(e=>e.disabled=value||e.dataset.allowed==='false');}
function clearResults(){version++;el('admin-user-results').replaceChildren();el('admin-user-prev').hidden=el('admin-user-next').hidden=true;}
async function moderate(row:ManagedUser,mode:'force'|'restore',reason=''){
  if(busy||!admin)return;const actor=requireUser().id;
  if(!confirm(mode==='force'?`${row.nickname} (${row.email}) 계정을 강제 탈퇴시킬까요? 즉시 계정 이용이 중단되고 탈퇴 신청일로부터 7일 뒤 영구 삭제됩니다.`:`${row.nickname} (${row.email}) 계정의 강제 탈퇴를 취소할까요? 회원은 다시 로그인해야 합니다.`))return;
  setBusy(true);message('admin-user-status','계정 상태를 변경하고 있어요.');
  try{
    await rpc('admin_moderate_user',{p_user_id:row.user_id,p_action:mode,p_reason:reason,p_expected_revision:row.revision,p_expected_actor:actor});
    if(user?.id!==actor||!admin)return;await searchUsers();message('admin-user-status',mode==='force'?'강제 탈퇴 처리했습니다.':'강제 탈퇴를 취소했습니다. 회원은 다시 로그인할 수 있어요.');
    window.dispatchEvent(new Event('admin-user-moderation-changed'));window.dispatchEvent(new Event('site-activity-changed'));
  }catch(error){if(user?.id===actor){message('admin-user-status',friendly(error));if(String((error as {code?:string}).code)==='42501')await refreshIdentity();}}
  finally{setBusy(false);}
}
async function searchUsers(){
  const mine=++version,actor=user?.id,term=input('admin-user-query'),state=input('admin-user-state');el('admin-user-results').replaceChildren();el('admin-user-prev').hidden=el('admin-user-next').hidden=true;
  if(!admin||!actor)return;if(term.length<2){message('admin-user-status','이메일이나 닉네임을 2자 이상 입력해 주세요.');return;}
  message('admin-user-status','회원을 찾고 있어요.');
  try{
    const rows=await rpc<ManagedUser[]>('admin_search_users',{p_query:term,p_state:state,p_offset:offset});
    if(mine!==version||user?.id!==actor||!admin||term!==input('admin-user-query')||state!==input('admin-user-state'))return;
    for(const row of rows){
      const card=node('article','','list-card admin-managed-user'),head=node('div','','section-head'),details=node('div','','admin-user-details');card.dataset.memberId=row.user_id;
      details.append(node('h3',row.nickname),node('p',row.email));head.append(details,node('span',row.is_master?'마스터':row.is_admin?'관리자':states[row.state],'status-badge'));card.append(head);
      if(row.reason)card.append(node('p','탈퇴 사유: '+row.reason,'review-note'));
      if(row.purge_at)card.append(node('p',date(row.purge_at)+' 이후 영구 삭제 예정','helper'));
      if(row.blocked_reason)card.append(node('p',row.blocked_reason,'helper'));
      const buttons=node('div','','button-row');
      if(row.can_restore){const restore=node('button','강제 탈퇴 취소','secondary');restore.type='button';restore.onclick=()=>void moderate(row,'restore');buttons.append(restore);}
      else if(row.state!=='forced'){
        const force=node('button','강제 탈퇴','secondary danger');force.type='button';force.disabled=!row.can_force;force.dataset.allowed=String(row.can_force);buttons.append(force);
        if(row.can_force){
          const form=node('form','','portal-form moderation-editor');form.hidden=true;const label=node('label','탈퇴 사유'),reason=node('textarea');reason.rows=3;reason.minLength=2;reason.maxLength=500;reason.required=true;reason.placeholder='회원에게 안내할 처리 사유를 입력해 주세요.';label.append(reason);
          const apply=node('button','탈퇴 처리','danger');apply.type='submit';form.append(label,apply);force.onclick=()=>{form.hidden=!form.hidden;if(!form.hidden)reason.focus();};
          form.onsubmit=event=>{event.preventDefault();void moderate(row,'force',reason.value.trim());};card.append(form);
        }
      }
      card.append(buttons);el('admin-user-results').append(card);
    }
    el('admin-user-prev').hidden=offset===0;el('admin-user-next').hidden=rows.length<20;message('admin-user-status',rows.length?`검색 결과 ${offset+1}~${offset+rows.length}명`:'일치하는 회원이 없어요.');
    if(busy)setBusy(true);
  }catch(error){if(mine===version&&user?.id===actor)message('admin-user-status',friendly(error));}
}
export function initAdminUsers(){
  el<HTMLFormElement>('admin-user-search-form').onsubmit=event=>{event.preventDefault();if(!busy){offset=0;void searchUsers();}};
  el('admin-user-query').oninput=()=>{clearResults();message('admin-user-status','');};el('admin-user-state').onchange=()=>{offset=0;void searchUsers();};
  el('admin-user-prev').onclick=()=>{if(!busy){offset=Math.max(0,offset-20);void searchUsers();}};el('admin-user-next').onclick=()=>{if(!busy){offset+=20;void searchUsers();}};
  window.addEventListener('identity-changed',()=>{const next=(user?.id??'')+':'+admin;if(next===identity)return;identity=next;clearResults();el<HTMLInputElement>('admin-user-query').value='';message('admin-user-status','');el<HTMLDetailsElement>('admin-users-section').open=false;});
  window.addEventListener('admin-membership-changed',()=>{clearResults();if(admin&&input('admin-user-query').length>=2)void searchUsers();});
}
