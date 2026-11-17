import {admin,user} from './auth';
import {rpc} from './supabase';
import {el,friendly} from './ui';
import {withCaptcha,cancelCaptcha} from './turnstile';
import {probeCaptcha,type CaptchaProbeResult} from './captcha-probe';
const checks=[
  ['live','실제 인증 확인','Turnstile을 통과한 요청은 검증하고, 인증 없이 보낸 요청은 거부하는지 확인해요.','실제 검사 실행'],
  ['missing','인증 없는 요청 차단','인증 토큰 없이 보낸 요청을 서버가 거부하면 통과예요.','토큰 없이 확인'],
  ['invalid','잘못된 인증 차단','유효하지 않은 토큰을 서버가 거부하면 통과예요.','잘못된 토큰 확인'],
  ['replay','인증 재사용 차단','한 번 사용한 인증 토큰으로 다시 요청하면 거부되는지 확인해요.','재사용 차단 확인']
] as const;
type Kind=typeof checks[number][0];
export function securityCheckMarkup(){return `<section id="security-check-panel" class="service-panel" hidden aria-labelledby="security-check-heading">
  <div class="page-heading heading-actions"><div><p class="section-eyebrow">밥픽 운영</p><h1 id="security-check-heading">보안 검사</h1><p>Turnstile이 제대로 동작하는지 직접 확인해요.</p></div><a class="button-link secondary" href="#admin">관리자로 돌아가기</a></div>
  <p id="security-check-guard" class="surface empty-state">관리자 로그인 후 사용할 수 있어요. <a href="#account">로그인하기 →</a></p>
  <div id="security-check-content" hidden><div class="surface security-check-intro"><h2>실제 서버 검사</h2><p>실제 회원 정보 대신 매번 새로 만든 테스트 정보를 사용합니다. 회원가입·메일 발송·계정 변경·AI 사용량 차감은 발생하지 않아요.</p><p id="security-check-summary" role="status">통과 0 / 4</p><p id="security-check-cooldown" class="helper" role="status"></p></div>
  <div class="security-check-grid">${checks.map(([kind,title,detail,label])=>`<form id="security-check-${kind}" class="surface portal-form security-check-card" data-check-state="idle"><h2>${title}</h2><p>${detail}</p><button type="submit" data-security-check="${kind}">${label}</button><p id="security-check-result-${kind}" class="security-check-result" role="status">아직 실행하지 않았어요.</p></form>`).join('')}</div>
  <section class="surface security-check-preview"><p class="section-eyebrow">화면 예시</p><h2>실패·만료 안내 미리보기</h2><p>서버 요청 없이 안내 문구만 보여줍니다. 위의 실제 검사 결과에는 포함되지 않아요.</p><div class="button-row"><button type="button" class="secondary" data-security-preview="error">실패 예시</button><button type="button" class="secondary" data-security-preview="expired">만료 예시</button><button type="button" class="text-button" data-security-preview="clear">초기화</button></div><p id="security-check-preview-status" class="form-status" role="status"></p></section></div></section>`;}
export function initSecurityCheck(){
  let owner='',busy=false,version=0,timer:number|undefined,controller:AbortController|undefined;
  const outcomes=new Map<Kind,string>(),config={url:import.meta.env.VITE_SUPABASE_URL,key:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY};
  const buttons=()=>document.querySelectorAll<HTMLButtonElement>('[data-security-check]');
  function sync(){
    const identity=admin&&user?user.id:'';el('security-check-guard').hidden=!!identity;el('security-check-content').hidden=!identity;
    if(identity===owner)return;
    owner=identity;version++;controller?.abort();for(const [kind]of checks)cancelCaptcha(el('security-check-'+kind));clearTimeout(timer);timer=undefined;busy=false;outcomes.clear();
    for(const [kind]of checks){el('security-check-'+kind).dataset.checkState='idle';el('security-check-result-'+kind).textContent='아직 실행하지 않았어요.';}
    el('security-check-summary').textContent='통과 0 / 4';el('security-check-preview-status').textContent='';el('security-check-cooldown').textContent='';buttons().forEach(b=>b.disabled=false);
  }
  function show(kind:Kind,state:string,text:string){outcomes.set(kind,state);el('security-check-'+kind).dataset.checkState=state;el('security-check-result-'+kind).textContent=text;el('security-check-summary').textContent='통과 '+[...outcomes.values()].filter(x=>x==='passed').length+' / 4';}
  function assertResult(result:CaptchaProbeResult){if(result==='limited')throw Error('요청이 많습니다. 잠시 후 다시 시도해 주세요.');if(result==='unknown')throw Error('서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
  for(const [kind]of checks)el<HTMLFormElement>('security-check-'+kind).onsubmit=event=>{
    event.preventDefault();if(busy||timer!==undefined)return;
    void(async()=>{
      const mine=version,actor=owner;if(!actor||!admin||user?.id!==actor)return;busy=true;controller=new AbortController();const signal=controller.signal;buttons().forEach(b=>b.disabled=true);show(kind,'running','검사 중입니다…');
      try{
        if(!await rpc<boolean>('is_admin')||version!==mine)throw Error('현재 관리자만 검사할 수 있어요.');
        let result:CaptchaProbeResult;
        if(kind==='missing'||kind==='invalid')result=await probeCaptcha(config,kind==='missing'?undefined:'not-a-valid-turnstile-token',signal);
        else result=await withCaptcha(el('security-check-'+kind),async token=>{
          if(!token)throw Error('보안 검사 사이트 키가 연결되지 않았습니다.');
          if(version!==mine||signal.aborted)throw Error('검사가 취소됐습니다.');
          const first=await probeCaptcha(config,token,signal);assertResult(first);if(first!=='accepted')throw Error('실제 인증 검증에 실패했습니다. 사이트 키·등록 도메인·Supabase 보호 설정을 확인해 주세요.');
          return probeCaptcha(config,kind==='replay'?token:undefined,signal);
        });
        if(version!==mine||signal.aborted)return;assertResult(result);
        if(result==='rejected')show(kind,'passed','통과 · '+(kind==='live'?'정상 인증은 확인하고 인증 없는 요청은 거부했어요.':kind==='replay'?'사용한 인증 토큰의 재사용을 거부했어요.':kind==='missing'?'인증 없는 요청을 거부했어요.':'잘못된 인증 토큰을 거부했어요.'));
        else show(kind,'failed','확인 필요 · 인증이 없는 요청도 다음 단계로 넘어갔어요. Supabase의 CAPTCHA 보호 설정을 확인해 주세요.');
      }catch(error){if(version===mine&&!signal.aborted)show(kind,'failed',friendly(error));}
      finally{if(version===mine){busy=false;controller=undefined;el('security-check-cooldown').textContent='연속 요청을 줄이기 위해 5초 후 다시 검사할 수 있어요.';timer=window.setTimeout(()=>{timer=undefined;el('security-check-cooldown').textContent='';buttons().forEach(b=>b.disabled=false);},5000);}}
    })();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-security-preview]').forEach(button=>button.onclick=()=>{el('security-check-preview-status').textContent=button.dataset.securityPreview==='clear'?'':button.dataset.securityPreview==='expired'?'보안 확인이 만료됐습니다. 다시 시도해 주세요.':'보안 확인에 실패했습니다. 다시 시도해 주세요.';});
  window.addEventListener('identity-changed',sync);sync();
  window.addEventListener('hashchange',()=>{
    if(location.hash==='#security-check'||!controller)return;
    version++;controller.abort();controller=undefined;busy=false;clearTimeout(timer);timer=undefined;
    for(const [kind]of checks){cancelCaptcha(el('security-check-'+kind));if(outcomes.get(kind)==='running')show(kind,'cancelled','검사를 취소했습니다. 다시 실행할 수 있어요.');}
    el('security-check-cooldown').textContent='';buttons().forEach(b=>b.disabled=false);
  });
}
