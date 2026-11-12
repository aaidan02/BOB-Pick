import type {User} from '@supabase/supabase-js';
import {client,db,rpc} from './supabase';
import {action,el,input,message,date} from './ui';
export let user:User|null=null;
export let admin=false;
export let accountRecovery:{userId:string;canRestore:boolean;restoreUntil:string}|null=null;
let mode='login',recovery=false,identityVersion=0;
export function requireUser(){if(!user){location.hash='account';throw Error('로그인 후 이용해 주세요.');}return user;}
export async function refreshIdentity(){
  const mine=++identityVersion;
  const {data:{session},error}=await client().auth.getSession();if(error)throw error;
  let who=session?.user??null;let isAdmin=false,nickname='',pending:typeof accountRecovery=null;
  if(who){
    const state=await rpc<{pending:boolean;missing:boolean;active:boolean;canRestore:boolean;restoreUntil:string}>('account_recovery_status');
    if(mine!==identityVersion)return;
    if(state.missing||(!state.pending&&!state.active)){await client().auth.signOut({scope:'local'});who=null;}
    else if(state.pending)pending={userId:who.id,canRestore:state.canRestore,restoreUntil:state.restoreUntil};
  }
  if(who&&!pending){
    try{isAdmin=await rpc<boolean>('is_admin');}catch{isAdmin=false;}
    const {data}=await client().from('profiles').select('nickname').eq('id',who.id).single();nickname=data?.nickname??'';
  }
  if(mine!==identityVersion)return;
  user=pending?null:who;admin=isAdmin;accountRecovery=pending;
  el('account-nav-label').textContent=pending?'계정 복원':user?'내 정보':'로그인';el('admin-link').hidden=!admin;
  el('auth-box').hidden=!recovery&&(!!pending||!!user);el('member-box').hidden=!user||recovery;
  el('account-recovery-box').hidden=!pending||recovery;el('account-restore-form').hidden=!pending?.canRestore;
  if(pending){message('account-recovery-email',who?.email??'');message('account-recovery-title',pending.canRestore?'다시 함께할까요?':'복원 기간이 지났어요');message('account-recovery-detail',pending.canRestore?'복원하면 취향·찜·추천 및 방문 기록·작성한 글을 다시 이용할 수 있어요.':'개인정보를 영구 삭제한 뒤에는 계정을 복원할 수 없습니다.');message('account-recovery-deadline',pending.canRestore?date(pending.restoreUntil)+'까지 복원할 수 있어요.':'복원 가능한 7일이 지나 영구 삭제를 처리하고 있습니다.');}
  el('account-heading').textContent=pending?'탈퇴한 계정입니다':user?'내 정보':'반가워요, 밥친구!';
  if(user){
    el<HTMLInputElement>('profile-nickname').value=nickname;
    message('member-name',(nickname||'밥친구')+'님');
  }else{message('member-name','');el<HTMLInputElement>('profile-nickname').value='';}
  window.dispatchEvent(new Event('identity-changed'));
}
function setMode(next:string){
  mode=next;recovery=next==='password';
  el('auth-nickname-row').hidden=mode!=='signup';
  el('auth-password-confirm-row').hidden=!['signup','password'].includes(mode);
  const confirm=el<HTMLInputElement>('auth-password-confirm');confirm.disabled=!['signup','password'].includes(mode);confirm.required=!confirm.disabled;
  el<HTMLInputElement>('auth-nickname').disabled=mode!=='signup';el<HTMLInputElement>('auth-password').disabled=mode==='reset';el<HTMLInputElement>('auth-email').disabled=mode==='password';el('auth-password-row').hidden=mode==='reset';el('auth-email-row').hidden=mode==='password';
  el<HTMLInputElement>('auth-email').required=mode!=='password';el<HTMLInputElement>('auth-password').required=mode!=='reset';
  el<HTMLInputElement>('auth-nickname').required=mode==='signup';
  el('auth-submit').textContent=({login:'로그인',signup:'회원가입',reset:'재설정 메일 받기',password:'새 비밀번호 저장'} as Record<string,string>)[mode];
  el<HTMLInputElement>('auth-password').autocomplete=mode==='login'?'current-password':'new-password';
  document.querySelectorAll<HTMLButtonElement>('[data-auth-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.authMode===mode)));
  message('auth-hint',({login:'이메일로 로그인하고 마음에 드는 메뉴를 저장해요.',signup:'가입 후 이메일의 확인 링크를 눌러주세요.',reset:'가입한 이메일로 비밀번호 재설정 링크를 보내드려요.',password:'새로 사용할 비밀번호를 입력해 주세요.'} as Record<string,string>)[mode]);
  message('auth-status','');el('auth-box').hidden=false;
}
export async function initAuth(){
  document.querySelectorAll<HTMLButtonElement>('[data-auth-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.authMode!));
  el<HTMLFormElement>('auth-form').onsubmit=event=>{
    event.preventDefault();void action(el('auth-submit'),'auth-status',async()=>{
      const email=input('auth-email'),password=el<HTMLInputElement>('auth-password').value,redirectTo=location.origin+'/#account';
      if(['signup','password'].includes(mode)&&password!==el<HTMLInputElement>('auth-password-confirm').value)throw Error('비밀번호가 일치하지 않습니다.');
      if(mode==='login'){
        const {error}=await client().auth.signInWithPassword({email,password});if(error)throw error;
        message('auth-status','로그인했습니다.');await refreshIdentity();
      }else if(mode==='signup'){
        const nickname=input('auth-nickname');if(nickname.length<2||nickname.length>40)throw Error('닉네임은 2~40자로 입력해 주세요.');
        const {data,error}=await client().auth.signUp({email,password,options:{data:{nickname},emailRedirectTo:redirectTo}});if(error)throw error;
        message('auth-status',data.session?'회원가입했습니다.':'이메일로 보낸 가입 확인 링크를 눌러 주세요.');await refreshIdentity();
      }else if(mode==='reset'){
        const {error}=await client().auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/?recovery=1#account'});if(error)throw error;
        message('auth-status','가입한 이메일이면 비밀번호 재설정 메일이 발송됩니다.');
      }else{
        const {error}=await client().auth.updateUser({password});if(error)throw error;
        recovery=false;history.replaceState(null,'',location.pathname+'#account');setMode('login');await refreshIdentity();message(accountRecovery?'account-restore-status':'member-status',accountRecovery?'비밀번호를 변경했습니다. 새 비밀번호로 계정을 복원해 주세요.':'비밀번호를 변경했습니다.');
      }
      el<HTMLInputElement>('auth-password').value='';el<HTMLInputElement>('auth-password-confirm').value='';
    });
  };
  el<HTMLFormElement>('profile-form').onsubmit=event=>{
    event.preventDefault();void action(el('profile-save'),'member-status',async()=>{
      const who=requireUser(),nickname=input('profile-nickname');
      if(nickname.length<2||nickname.length>40)throw Error('닉네임은 2~40자로 입력해 주세요.');
      const {error}=await client().from('profiles').update({nickname}).eq('id',who.id);if(error)throw error;
      await refreshIdentity();message('member-status','닉네임을 저장했습니다.');
    });
  };
  el<HTMLButtonElement>('logout').onclick=()=>void action(el('logout'),'member-status',async()=>{
    const {error}=await client().auth.signOut();if(error)throw error;
    setMode('login');await refreshIdentity();message('member-status','로그아웃했습니다.');
  });
  el<HTMLButtonElement>('account-recovery-logout').onclick=()=>void action(el('account-recovery-logout'),'account-restore-status',async()=>{await client().auth.signOut({scope:'local'});await refreshIdentity();});
  el<HTMLFormElement>('account-restore-form').onsubmit=event=>{
    event.preventDefault();void action(el('account-restore'),'account-restore-status',async()=>{
      const pending=accountRecovery;if(!pending?.canRestore)throw Error('복원 가능한 7일이 지났습니다.');
      const {data,error}=await client().functions.invoke('delete-account',{body:{action:'restore',confirm:true,expectedUserId:pending.userId,password:el<HTMLInputElement>('account-restore-password').value}});
      if(error){let text='복원하지 못했습니다. 잠시 후 다시 시도해 주세요.';if(error.context instanceof Response)try{text=(await error.context.json()).error??text;}catch{}throw Error(text);}
      if(!data?.restored||!data.session)throw Error('복원 결과를 확인하지 못했습니다.');
      const updated=await client().auth.setSession(data.session);if(updated.error)throw updated.error;
      el<HTMLFormElement>('account-restore-form').reset();await refreshIdentity();message('member-status','계정을 복원했습니다.');location.hash='account';
    });
  };
  setMode('login');
  if(!db){message('auth-status','Supabase 연결 설정이 필요합니다.');return;}
  db.auth.onAuthStateChange((event,session)=>{
    const previous=user?.id??accountRecovery?.userId,incoming=session?.user;
    if(!incoming||previous!==incoming.id){identityVersion++;user=null;accountRecovery=null;admin=false;el('admin-link').hidden=true;el('admin-content').hidden=true;if(previous)el<HTMLButtonElement>('chat-reset').click();window.dispatchEvent(new Event('identity-changed'));el<HTMLFormElement>('account-restore-form').reset();}
    if(event==='SIGNED_OUT'){
      setMode('login');for(const id of ['auth-email','auth-password','auth-password-confirm','auth-nickname'])el<HTMLInputElement>(id).value='';
    }
    if(event==='PASSWORD_RECOVERY'){setMode('password');location.hash='account';}
    // Avoid awaiting another Auth call inside the Auth callback's lock.
    setTimeout(()=>void refreshIdentity().catch(()=>message('auth-status','로그인 연결을 확인해 주세요.')),0);
  });
  if(new URLSearchParams(location.search).get('recovery')==='1')setMode('password');
  await refreshIdentity();
  window.addEventListener('focus',()=>void refreshIdentity().catch(()=>{}));
}
