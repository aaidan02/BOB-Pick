import {user,requireUser,refreshIdentity} from './auth';
import {client,rpc} from './supabase';
import {el,node,action,message,friendly,price,date} from './ui';
import {directionsUrl} from './naver';
import {preferenceMarkup,renderPreferenceForm,readPreferenceForm} from './preference-form';
import {setActivePreferences,markPreferencesLoading,failPreferences} from './preference-state';
import {emptyPreferences,type FoodPreferences} from '../../supabase/functions/_shared/preferences';

let owner:string|null=null,version=0,historyVersion=0,offset=0,tab='info';
let onboardingBusy=false,onboardingAttempt=0;
export function accountMarkup(){return `
  <dialog id="taste-onboarding" class="taste-onboarding" aria-labelledby="taste-onboarding-heading" aria-describedby="taste-onboarding-intro">
    <p class="section-eyebrow">가입을 환영해요!</p><h2 id="taste-onboarding-heading" tabindex="-1">어떤 음식을 좋아하세요?</h2><p id="taste-onboarding-intro" class="helper">취향에 맞는 한 끼를 골라드릴게요. 나중에는 내 정보에서 바꿀 수 있어요.</p>
    <form id="onboarding-form" class="portal-form"><div id="onboarding-taste">${preferenceMarkup('onboarding-taste')}</div><div class="button-row onboarding-actions"><button id="onboarding-save">저장하고 시작하기</button><button id="onboarding-skip" type="button" class="secondary">나중에 설정하기</button></div><p id="onboarding-status" class="form-status" role="status"></p></form>
  </dialog>
  <div class="surface member-summary"><div class="member-heading"><span class="member-avatar" aria-hidden="true">밥</span><div><p class="helper">오늘도 맛있는 하루 보내세요</p><h2 id="member-name"></h2><p id="member-email" class="helper"></p></div></div>
    <div class="account-metrics"><a href="#favorites"><span>찜한 메뉴</span><strong id="account-favorite-count">—</strong></a><button type="button" data-account-open="history"><span>추천 기록</span><strong id="account-history-count">—</strong></button><a href="#support"><span>고객센터 문의</span><strong id="account-support-count">—</strong></a></div>
  </div>
  <div class="account-tabs" role="tablist" aria-label="내 정보 메뉴"><button type="button" role="tab" id="account-tab-info" aria-controls="account-info" aria-selected="true" data-account-open="info">내 정보</button><button type="button" role="tab" id="account-tab-taste" aria-controls="account-taste" aria-selected="false" data-account-open="taste">내 취향</button><button type="button" role="tab" id="account-tab-history" aria-controls="account-history" aria-selected="false" data-account-open="history">추천·방문 기록</button></div>
  <section id="account-info" role="tabpanel" aria-labelledby="account-tab-info">
    <div class="surface"><h2>내 정보</h2><form id="profile-form" class="portal-form"><label>내 닉네임<input id="profile-nickname" minlength="2" maxlength="40" required></label><button id="profile-save" class="secondary">닉네임 저장</button></form><p id="member-status" class="form-status" role="status"></p></div>
    <details class="surface account-details"><summary>비밀번호 변경</summary><form id="password-form" class="portal-form"><label>현재 비밀번호<input id="password-current" type="password" autocomplete="current-password" required maxlength="128"></label><label>새 비밀번호<input id="password-new" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="8자 이상"></label><label>새 비밀번호 확인<input id="password-confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><button id="password-save">비밀번호 변경</button><p id="password-status" class="form-status" role="status"></p></form></details>
    <details class="surface account-details account-danger"><summary>회원 탈퇴</summary><p class="helper">탈퇴 후 7일 동안 기존 이메일·비밀번호로 로그인해 복원할 수 있어요. 그동안 회원 기능을 이용할 수 없고 게시글은 숨겨집니다. 7일이 지나면 계정·취향·찜·기록·작성한 글·고객센터 문의를 영구 삭제하며 복원할 수 없습니다. 반영된 음식점 정보와 익명 처리 이력은 유지됩니다.</p><p id="account-delete-reason" class="form-status" role="status"></p><form id="account-delete-form" class="portal-form" hidden><label>현재 비밀번호<input id="account-delete-password" type="password" autocomplete="current-password" required maxlength="128"></label><label class="checkbox"><input id="account-delete-confirm" type="checkbox" required>7일 후 영구 삭제되는 것을 확인했고 탈퇴하겠습니다.</label><button id="account-delete" class="danger">회원 탈퇴</button><p id="account-delete-status" class="form-status" role="status"></p></form></details>
  </section>
  <section id="account-taste" role="tabpanel" aria-labelledby="account-tab-taste" hidden><form id="taste-form" class="surface portal-form"><h2>내 취향 설정</h2><div id="member-taste">${preferenceMarkup('member-taste')}</div><div class="button-row"><button id="taste-save">취향 저장</button><button id="taste-reset" type="button" class="secondary">기본값으로</button></div><p id="taste-status" class="form-status" role="status"></p></form></section>
  <section id="account-history" role="tabpanel" aria-labelledby="account-tab-history" hidden><div class="surface"><div class="section-head"><h2>추천·방문 기록</h2><button id="history-clear" type="button" class="secondary compact">기록 삭제</button></div><div class="button-row"><label class="grow"><span class="sr-only">기록 종류</span><select id="history-kind"><option value="all">모든 추천 기록</option><option value="visited">다녀온 가게</option></select></label><button id="history-reload" type="button" class="secondary">새로고침</button></div><p id="history-status" class="empty-state" role="status"></p><div id="history-list" class="history-list"></div><button id="history-more" type="button" class="secondary" hidden>기록 더 보기</button></div></section>
  <div class="button-row account-bottom"><a href="#support" class="inline-link">고객센터 →</a><a href="#requests" class="inline-link">음식점 문의·신청 →</a><button id="logout" type="button" class="text-button">로그아웃</button></div>`;}
function selectTab(next:string){
  tab=next;
  for(const name of ['info','taste','history']){el('account-'+name).hidden=name!==tab;el('account-tab-'+name).setAttribute('aria-selected',String(name===tab));}
  if(next==='history')void loadHistory(true);
}
export async function loadAccountOverview(){
  const who=user?.id;if(!who)return;
  try{
    const data=await rpc<{favorites:number;history:number;support:number}>('my_account_overview');if(user?.id!==who)return;
    for(const [id,value]of [['favorite',data.favorites],['history',data.history],['support',data.support]] as const)message('account-'+id+'-count',String(value));
  }catch{if(user?.id===who)for(const id of ['favorite','history','support'])message('account-'+id+'-count','—');}
}
async function loadPreferences(force=false){
  const mine=++version,who=user?.id;if(!who)return;
  try{
    const data=await rpc<{settings:FoodPreferences;filter:Record<string,unknown>;onboardingComplete:boolean}>('my_food_preferences');
    if(mine!==version||user?.id!==who)return;
    if(force||el('taste-form').dataset.dirty!=='true'){renderPreferenceForm('member-taste',data.settings??emptyPreferences());el('taste-form').dataset.dirty='false';}
    setActivePreferences(who,data.filter??{});
    const dialog=el<HTMLDialogElement>('taste-onboarding');
    if(data.onboardingComplete===false&&!el('member-box').hidden&&!dialog.open&&!onboardingBusy){
      renderPreferenceForm('onboarding-taste',data.settings??emptyPreferences());message('onboarding-status','');
      dialog.showModal();dialog.scrollTop=0;el('taste-onboarding-heading').focus({preventScroll:true});
    }else if(data.onboardingComplete===true&&dialog.open&&!onboardingBusy)dialog.close();
    const deletion=await rpc<{allowed:boolean;reason?:string}>('account_deletion_status');
    if(mine!==version||user?.id!==who)return;
    el('account-delete-form').hidden=!deletion.allowed;message('account-delete-reason',deletion.reason??'');
  }catch(error){if(mine===version&&user?.id===who){failPreferences(who);message('taste-status',friendly(error));}}
  finally{if(mine===version&&user?.id===who)markPreferencesLoading(false);}
}
async function loadHistory(reset:boolean){
  const mine=++historyVersion,who=user?.id;if(!who)return;
  if(reset){offset=0;el('history-list').replaceChildren();}el('history-more').hidden=true;message('history-status','기록을 불러오고 있어요.');
  try{
    let request=client().from('recommendation_history').select('*').eq('user_id',who).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+19);
    if((el('history-kind') as HTMLSelectElement).value==='visited')request=request.not('visited_at','is',null);
    const {data,error}=await request;if(error)throw error;if(mine!==historyVersion||user?.id!==who)return;
    for(const row of data??[]){
      const card=node('article','','list-card history-card'),header=node('div','','history-heading'),badge=node('span',row.source==='ai'?'AI 추천':'조건 추천','status-badge');
      header.append(badge,node('small',date(row.created_at)));card.append(header,node('h3',row.menu_name),node('p',row.restaurant_name),node('strong',price(row),'history-price'));
      const actions=node('div','','button-row'),visit=node('button',row.visited_at?'✓ 다녀왔어요':'다녀왔어요','secondary'),remove=node('button','삭제','text-button');
      visit.type=remove.type='button';visit.setAttribute('aria-pressed',String(!!row.visited_at));
      visit.onclick=()=>void action(visit,'history-status',async()=>{await rpc('set_history_visit',{p_id:row.id,p_visited:!row.visited_at});if(user?.id!==who)return;await loadHistory(true);await loadPreferences();void loadAccountOverview();});
      remove.onclick=()=>void action(remove,'history-status',async()=>{const {error}=await client().from('recommendation_history').delete().eq('id',row.id).eq('user_id',who);if(error)throw error;if(user?.id!==who)return;await loadHistory(true);await loadPreferences();void loadAccountOverview();});
      const map=node('a','길찾기 ↗','inline-link');map.href=directionsUrl({name:row.restaurant_name,address:row.address,latitude:row.latitude,longitude:row.longitude});map.target='_blank';map.rel='noopener noreferrer';
      actions.append(visit,map,remove);card.append(actions);el('history-list').append(card);
    }
    offset+=data?.length??0;el('history-more').hidden=(data?.length??0)<20;
    message('history-status',el('history-list').children.length?'':'아직 기록이 없어요. 메뉴를 추천받으면 여기에 모아드릴게요.');
  }catch(error){if(mine===historyVersion&&user?.id===who)message('history-status',friendly(error));}
}
export function initAccount(){
  document.body.append(el('taste-onboarding'));
  renderPreferenceForm('member-taste');renderPreferenceForm('onboarding-taste');
  for(const link of document.querySelectorAll<HTMLAnchorElement>('[data-taste-settings]'))link.onclick=event=>{
    event.preventDefault();if(!user){location.hash='account';return;}
    selectTab('taste');location.hash='account';
    requestAnimationFrame(()=>{if(location.hash==='#account'&&tab==='taste')el('account-tab-taste').focus({preventScroll:true});});
  };
  async function finishOnboarding(save:boolean){
    if(onboardingBusy||!user)return;const who=user.id,mine=++onboardingAttempt;onboardingBusy=true;version++;
    el<HTMLButtonElement>('onboarding-save').disabled=el<HTMLButtonElement>('onboarding-skip').disabled=true;message('onboarding-status','저장 중입니다.');
    try{
      if(save)await rpc('save_food_preferences',{p_settings:readPreferenceForm('onboarding-taste'),p_user_id:who});
      else await rpc('complete_food_preference_onboarding',{p_user_id:who});
      if(user?.id!==who||mine!==onboardingAttempt)return;
      await loadPreferences(true);
      if(user?.id===who&&mine===onboardingAttempt){location.hash='filters';el<HTMLDialogElement>('taste-onboarding').close();}
    }catch(error){if(user?.id===who&&mine===onboardingAttempt)message('onboarding-status',friendly(error));}
    finally{if(mine===onboardingAttempt){onboardingBusy=false;el<HTMLButtonElement>('onboarding-save').disabled=el<HTMLButtonElement>('onboarding-skip').disabled=false;if(user?.id===who)markPreferencesLoading(false);}}
  }
  el<HTMLFormElement>('onboarding-form').onsubmit=event=>{event.preventDefault();void finishOnboarding(true);};
  el('onboarding-skip').onclick=()=>void finishOnboarding(false);
  el<HTMLDialogElement>('taste-onboarding').oncancel=event=>{event.preventDefault();void finishOnboarding(false);};
  for(const button of document.querySelectorAll<HTMLButtonElement>('[data-account-open]'))button.onclick=()=>selectTab(button.dataset.accountOpen!);
  document.querySelector('.account-tabs')!.addEventListener('keydown',event=>{
    const key=(event as KeyboardEvent).key,buttons=[...document.querySelectorAll<HTMLButtonElement>('.account-tabs button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(key))return;
    event.preventDefault();const next=key==='Home'?0:key==='End'?buttons.length-1:(index+(key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus();selectTab(buttons[next].dataset.accountOpen!);
  });
  el('taste-form').addEventListener('input',()=>el('taste-form').dataset.dirty='true');
  el('taste-form').addEventListener('click',event=>{if((event.target as Element).closest('.taste-chip'))el('taste-form').dataset.dirty='true';});
  el('taste-reset').onclick=()=>{renderPreferenceForm('member-taste');el('taste-form').dataset.dirty='true';};
  (el('taste-form') as HTMLFormElement).onsubmit=event=>{
    event.preventDefault();void action(el('taste-save'),'taste-status',async()=>{const who=requireUser().id,settings=readPreferenceForm('member-taste');await rpc('save_food_preferences',{p_settings:settings,p_user_id:who});if(user?.id!==who)return;await loadPreferences(true);message('taste-status','취향을 저장했습니다.');});
  };
  el('history-kind').onchange=()=>void loadHistory(true);el('history-reload').onclick=()=>void loadHistory(true);el('history-more').onclick=()=>void loadHistory(false);
  el('history-clear').onclick=()=>{
    if(!confirm('추천·방문 기록을 모두 삭제할까요?'))return;
    void action(el('history-clear'),'history-status',async()=>{const who=requireUser().id;const {error}=await client().from('recommendation_history').delete().eq('user_id',who);if(error)throw error;if(user?.id!==who)return;await loadHistory(true);await loadPreferences();void loadAccountOverview();});
  };
  (el('password-form') as HTMLFormElement).onsubmit=event=>{
    event.preventDefault();void action(el('password-save'),'password-status',async()=>{
      const who=requireUser(),current=(el('password-current') as HTMLInputElement).value,password=(el('password-new') as HTMLInputElement).value;
      if(password!==(el('password-confirm') as HTMLInputElement).value)throw Error('새 비밀번호가 일치하지 않습니다.');
      const {data,error}=await client().auth.signInWithPassword({email:who.email!,password:current});
      if(error||data.user?.id!==who.id)throw Error('현재 비밀번호를 확인해 주세요.');
      const updated=await client().auth.updateUser({password});if(updated.error)throw updated.error;
      (el('password-form') as HTMLFormElement).reset();message('password-status','비밀번호를 변경했습니다.');
    });
  };
  (el('account-delete-form') as HTMLFormElement).onsubmit=event=>{
    event.preventDefault();if(!(el('account-delete-confirm') as HTMLInputElement).checked)return;
    void action(el('account-delete'),'account-delete-status',async()=>{
      const who=requireUser(),{data,error}=await client().functions.invoke('delete-account',{body:{action:'withdraw',retentionDays:7,password:(el('account-delete-password') as HTMLInputElement).value,confirm:true,expectedUserId:who.id}});
      if(error){let text='탈퇴하지 못했습니다. 잠시 후 다시 시도해 주세요.';if(error.context instanceof Response)try{text=(await error.context.json()).error??text;}catch{}throw Error(text);}
      if(!data?.withdrawn)throw Error('탈퇴 결과를 확인하지 못했습니다.');
      await client().auth.signOut({scope:'local'});await refreshIdentity();(el('account-delete-form') as HTMLFormElement).reset();message('auth-status','탈퇴했습니다. 7일 안에 로그인하면 계정을 복원할 수 있어요.');location.hash='account';
    });
  };
  window.addEventListener('identity-changed',()=>{
    const who=user?.id??null;
    if(owner!==who){owner=who;version++;historyVersion++;onboardingAttempt++;onboardingBusy=false;el<HTMLDialogElement>('taste-onboarding').close();el<HTMLButtonElement>('onboarding-save').disabled=el<HTMLButtonElement>('onboarding-skip').disabled=false;renderPreferenceForm('onboarding-taste');offset=0;setActivePreferences(null);markPreferencesLoading(!!who);el('history-list').replaceChildren();el('taste-form').dataset.dirty='false';renderPreferenceForm('member-taste');el('account-delete-form').hidden=true;selectTab('info');}
    message('member-email',user?.email??'');
    if(who){void loadPreferences();void loadAccountOverview();}else{message('history-status','');for(const form of ['password-form','account-delete-form'])(el(form) as HTMLFormElement).reset();}
  });
  window.addEventListener('recommendation-shown',event=>{
    const who=user?.id;if(!who)return;
    const detail=(event as CustomEvent).detail;
    void rpc('save_recommendation_history',{p_event_id:detail.eventId,p_source:detail.source,p_filter:detail.filter,p_items:detail.items,p_user_id:who})
      .then(()=>{if(user?.id===who){void loadAccountOverview();if(tab==='history')void loadHistory(true);}})
      .catch(()=>{if(user?.id===who)message('history-status','추천은 완료했지만 기록을 저장하지 못했어요.');});
  });
}
