import type {User} from '@supabase/supabase-js';
import {client,db,rpc} from './supabase';
import {action,el,input,message} from './ui';
export let user:User|null=null;
export let admin=false;
let mode='login',recovery=false,identityVersion=0;
export function requireUser(){if(!user){location.hash='account';throw Error('로그인 후 이용해 주세요.');}return user;}
export async function refreshIdentity(){
  const mine=++identityVersion;
  const {data:{session},error}=await client().auth.getSession();if(error)throw error;
  const who=session?.user??null;let isAdmin=false,nickname='';
  if(who){
    try{isAdmin=await rpc<boolean>('is_admin');}catch{isAdmin=false;}
    const {data}=await client().from('profiles').select('nickname').eq('id',who.id).single();nickname=data?.nickname??'';
  }
  if(mine!==identityVersion)return;
  user=who;admin=isAdmin;
  el('account-link').textContent=user?'내 계정':'로그인';el('admin-link').hidden=!admin;
  el('auth-box').hidden=!!user&&!recovery;el('member-box').hidden=!user;
  if(user){
    el<HTMLInputElement>('profile-nickname').value=nickname;
    message('member-name',(nickname||'밥친구')+'님');
  }else{message('member-name','');el<HTMLInputElement>('profile-nickname').value='';}
  window.dispatchEvent(new Event('identity-changed'));
}
function setMode(next:string){
  mode=next;recovery=next==='password';
  el('auth-nickname-row').hidden=mode!=='signup';el('auth-password-row').hidden=mode==='reset';el('auth-email-row').hidden=mode==='password';
  el<HTMLInputElement>('auth-email').required=mode!=='password';el<HTMLInputElement>('auth-password').required=mode!=='reset';
  el<HTMLInputElement>('auth-nickname').required=mode==='signup';
  el('auth-submit').textContent=({login:'로그인',signup:'회원가입',reset:'재설정 메일 받기',password:'새 비밀번호 저장'} as Record<string,string>)[mode];
  message('auth-status','');el('auth-box').hidden=false;
}
export async function initAuth(){
  document.querySelectorAll<HTMLButtonElement>('[data-auth-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.authMode!));
  el<HTMLFormElement>('auth-form').onsubmit=event=>{
    event.preventDefault();void action(el('auth-submit'),'auth-status',async()=>{
      const email=input('auth-email'),password=el<HTMLInputElement>('auth-password').value,redirectTo=location.origin+'/#account';
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
        recovery=false;history.replaceState(null,'',location.pathname+'#account');setMode('login');await refreshIdentity();message('member-status','비밀번호를 변경했습니다.');
      }
      el<HTMLInputElement>('auth-password').value='';
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
    el<HTMLButtonElement>('chat-reset').click();await refreshIdentity();message('member-status','로그아웃했습니다.');
  });
  if(!db){message('auth-status','Supabase 연결 설정이 필요합니다.');return;}
  db.auth.onAuthStateChange((event,session)=>{
    user=session?.user??null;
    if(!user){identityVersion++;admin=false;el('admin-link').hidden=true;el('admin-content').hidden=true;window.dispatchEvent(new Event('identity-changed'));}
    if(event==='PASSWORD_RECOVERY'){setMode('password');location.hash='account';}
    // Avoid awaiting another Auth call inside the Auth callback's lock.
    setTimeout(()=>void refreshIdentity().catch(()=>message('auth-status','로그인 연결을 확인해 주세요.')),0);
  });
  if(new URLSearchParams(location.search).get('recovery')==='1')setMode('password');
  await refreshIdentity();
}
