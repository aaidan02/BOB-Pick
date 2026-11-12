import {readPreferenceForm,renderPreferenceForm} from './preference-form';
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
  el('account-nav-label').textContent=user?'내 정보':'로그인';el('admin-link').hidden=!admin;
  el('auth-box').hidden=!!user&&!recovery;el('member-box').hidden=!user||recovery;
  el('account-heading').textContent=user?'내 정보':'반가워요, 밥친구!';
  if(user){
    el<HTMLInputElement>('profile-nickname').value=nickname;
    message('member-name',(nickname||'밥친구')+'님');
  }else{message('member-name','');el<HTMLInputElement>('profile-nickname').value='';}
  window.dispatchEvent(new Event('identity-changed'));
}
function setMode(next:string){
  mode=next;recovery=next==='password';
  el('auth-nickname-row').hidden=mode!=='signup';
  el('signup-taste').hidden=mode!=='signup';(el('signup-taste-fields') as HTMLFieldSetElement).disabled=mode!=='signup';
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
        const {data,error}=await client().auth.signUp({email,password,options:{data:{nickname,food_preferences:readPreferenceForm('signup-taste')},emailRedirectTo:redirectTo}});if(error)throw error;
        message('auth-status',data.session?'회원가입했습니다.':'이메일로 보낸 가입 확인 링크를 눌러 주세요.');await refreshIdentity();
        renderPreferenceForm('signup-taste');(el('signup-taste') as HTMLDetailsElement).open=false;
      }else if(mode==='reset'){
        const {error}=await client().auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/?recovery=1#account'});if(error)throw error;
        message('auth-status','가입한 이메일이면 비밀번호 재설정 메일이 발송됩니다.');
      }else{
        const {error}=await client().auth.updateUser({password});if(error)throw error;
        recovery=false;history.replaceState(null,'',location.pathname+'#account');setMode('login');await refreshIdentity();message('member-status','비밀번호를 변경했습니다.');
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
    el<HTMLButtonElement>('chat-reset').click();setMode('login');await refreshIdentity();message('member-status','로그아웃했습니다.');
  });
  setMode('login');
  if(!db){message('auth-status','Supabase 연결 설정이 필요합니다.');return;}
  db.auth.onAuthStateChange((event,session)=>{
    const previous=user?.id;user=session?.user??null;
    if(!user||previous!==user.id){identityVersion++;admin=false;el('admin-link').hidden=true;el('admin-content').hidden=true;window.dispatchEvent(new Event('identity-changed'));}
    if(event==='SIGNED_OUT'){
      setMode('login');for(const id of ['auth-email','auth-password','auth-password-confirm','auth-nickname'])el<HTMLInputElement>(id).value='';
      renderPreferenceForm('signup-taste');(el('signup-taste') as HTMLDetailsElement).open=false;
    }
    if(event==='PASSWORD_RECOVERY'){setMode('password');location.hash='account';}
    // Avoid awaiting another Auth call inside the Auth callback's lock.
    setTimeout(()=>void refreshIdentity().catch(()=>message('auth-status','로그인 연결을 확인해 주세요.')),0);
  });
  if(new URLSearchParams(location.search).get('recovery')==='1')setMode('password');
  await refreshIdentity();
}
