import {rpc} from './supabase';
import {admin,user,refreshIdentity,requireUser} from './auth';
import {el,friendly,input,message,node} from './ui';

type AdminAccount={user_id:string;email:string;nickname:string;is_self:boolean;can_remove:boolean};
type SearchAccount={user_id:string;email:string;nickname:string;email_confirmed:boolean;is_admin:boolean;can_grant:boolean};
let listVersion=0,searchVersion=0,busy=false,identity:string|null=null,rechecking:Promise<void>|null=null;

function setBusy(value:boolean){
  busy=value;el<HTMLButtonElement>('admin-account-search-submit').disabled=value;
  el<HTMLInputElement>('admin-account-search').disabled=value;
  document.querySelectorAll<HTMLButtonElement>('[data-admin-account-action]').forEach(button=>button.disabled=value||button.dataset.allowed!=='true');
}
function clearAccounts(){
  listVersion++;searchVersion++;
  el('admin-account-list').replaceChildren();el('admin-account-results').replaceChildren();message('admin-account-count','0');
}
async function showError(error:unknown,statusId:string){
  message(statusId,friendly(error));
  if(['42501','PGRST301'].includes(String((error as {code?:string})?.code))){
    clearAccounts();
    if(!rechecking)rechecking=refreshIdentity().finally(()=>{rechecking=null;});
    try{await rechecking;}catch{message(statusId,'로그인 상태와 관리자 권한을 확인해 주세요.');}
  }
}
function accountRow(account:{user_id:string;email:string;nickname:string}){
  const row=node('div','','admin-user-row'),details=node('div','','admin-user-details');
  details.id='admin-account-'+account.user_id;
  details.append(node('strong',account.nickname),node('p',account.email));row.append(details);
  return {row,details};
}
function roleButton(account:{user_id:string;email:string;nickname:string},enabled:boolean,allowed:boolean){
  const button=node('button',enabled?'권한 추가':'권한 해제',enabled?'':'secondary danger');button.type='button';
  button.dataset.adminAccountAction='true';button.dataset.allowed=String(allowed);button.disabled=busy||!allowed;
  button.setAttribute('aria-describedby','admin-account-'+account.user_id);
  if(!allowed&&!enabled)button.title='마지막 관리자는 해제할 수 없습니다.';
  button.onclick=()=>void changeMembership(account,enabled);
  return button;
}
export async function loadAdminAccounts(){
  const mine=++listVersion,who=user?.id;el('admin-account-list').replaceChildren();
  if(!admin||!who)return;
  message('admin-account-list-status','관리자 목록을 불러오고 있어요.');
  try{
    const rows=await rpc<AdminAccount[]>('admin_list_accounts');
    if(mine!==listVersion||user?.id!==who||!admin)return;
    for(const account of rows){
      const {row,details}=accountRow(account);
      if(account.is_self)details.append(node('span','내 계정','status-badge'));
      row.append(roleButton(account,false,account.can_remove));el('admin-account-list').append(row);
    }
    message('admin-account-count',String(rows.length));
    message('admin-account-list-status',rows.length===1?'마지막 관리자는 다른 관리자를 먼저 추가한 뒤 해제할 수 있어요.':'');
  }catch(error){if(mine===listVersion)await showError(error,'admin-account-list-status');}
}
async function searchAccounts(){
  const mine=++searchVersion,who=user?.id,term=input('admin-account-search');el('admin-account-results').replaceChildren();
  if(!admin||!who)return;
  if(term.length<2){message('admin-account-search-status','이메일이나 닉네임을 2자 이상 입력해 주세요.');return;}
  message('admin-account-search-status','회원을 찾고 있어요.');
  try{
    const rows=await rpc<SearchAccount[]>('admin_search_accounts',{p_query:term});
    if(mine!==searchVersion||user?.id!==who||!admin||input('admin-account-search')!==term)return;
    for(const account of rows){
      const {row,details}=accountRow(account);
      // The same member can appear in both lists; give each description a unique ID.
      details.id='admin-search-'+account.user_id;
      if(account.is_admin)row.append(node('span','관리자','status-badge'));
      else{
        if(!account.can_grant)details.append(node('small',account.email_confirmed?'계정 상태 확인 필요':'이메일 확인 필요','helper'));
        const button=roleButton(account,true,account.can_grant);button.setAttribute('aria-describedby',details.id);row.append(button);
      }
      el('admin-account-results').append(row);
    }
    message('admin-account-search-status',rows.length?`검색 결과 ${rows.length}명${rows.length===20?' · 최대 20명까지 표시합니다.':''}`:'일치하는 회원이 없어요. 가입한 이메일이나 닉네임을 확인해 주세요.');
  }catch(error){if(mine===searchVersion)await showError(error,'admin-account-search-status');}
}
async function changeMembership(account:{user_id:string;email:string;nickname:string},enabled:boolean){
  if(busy||!admin)return;
  const own=account.user_id===user?.id;
  const prompt=enabled?`${account.email} 계정에 관리자 권한을 추가할까요?`:
    own?'본인의 관리자 권한을 해제할까요? 해제 후에는 관리자 메뉴를 사용할 수 없습니다.':`${account.email} 계정의 관리자 권한을 해제할까요?`;
  if(!confirm(prompt))return;
  setBusy(true);message('admin-account-status','권한을 변경하고 있어요.');
  try{
    requireUser();const result=await rpc<{changed:boolean}>('admin_set_membership',{p_user_id:account.user_id,p_enabled:enabled});
    if(own&&!enabled){
      await refreshIdentity();location.hash='account';message('member-status','관리자 권한을 해제했습니다.');return;
    }
    window.dispatchEvent(new Event('admin-membership-changed'));
    if(input('admin-account-search').length>=2)await searchAccounts();
    message('admin-account-status',result.changed?(enabled?'관리자 권한을 추가했습니다.':'관리자 권한을 해제했습니다.'):'이미 해당 권한 상태입니다.');
  }catch(error){await showError(error,'admin-account-status');if(admin)void loadAdminAccounts();}
  finally{setBusy(false);}
}
export function initAdminAccounts(){
  el<HTMLFormElement>('admin-account-search-form').onsubmit=event=>{event.preventDefault();if(!busy)void searchAccounts();};
  el('admin-account-search').oninput=()=>{searchVersion++;el('admin-account-results').replaceChildren();message('admin-account-search-status','');};
  window.addEventListener('identity-changed',()=>{
    clearAccounts();message('admin-account-list-status','');message('admin-account-search-status','');message('admin-account-status','');
    if(identity!==user?.id||!admin)el<HTMLInputElement>('admin-account-search').value='';
    identity=user?.id??null;
  });
}
