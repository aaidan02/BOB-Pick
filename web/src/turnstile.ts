// Public site key only. Supabase Auth validates each one-use token with Cloudflare.
const siteKey=(import.meta.env.VITE_TURNSTILE_SITE_KEY??'').trim();
const sdkUrl='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
type Options={sitekey:string;callback:(token:string)=>void;'error-callback':()=>void;'expired-callback':()=>void;'timeout-callback':()=>void;'before-interaction-callback':()=>void;execution:'execute';appearance:'interaction-only';size:'flexible'|'compact';theme:'light';language:'ko';retry:'never';'refresh-expired':'manual';'response-field':false};
interface Turnstile{render:(element:HTMLElement,options:Options)=>string;execute:(id:string)=>void;remove:(id:string)=>void;}
declare global{interface Window{turnstile?:Turnstile;}}
let loading:Promise<Turnstile>|undefined;
const active=new Map<HTMLElement,AbortController>();
const cancelled=()=>Error('보안 확인이 취소됐습니다. 다시 시도해 주세요.');
export function cancelCaptcha(form:HTMLElement){active.get(form)?.abort();}
window.addEventListener('hashchange',()=>{for(const controller of active.values())controller.abort();});
function loadSdk():Promise<Turnstile>{
  if(window.turnstile)return Promise.resolve(window.turnstile);
  if(loading)return loading;
  loading=new Promise<Turnstile>((resolve,reject)=>{
    const script=document.createElement('script');script.src=sdkUrl;script.async=true;script.defer=true;
    const fail=()=>{clearTimeout(timer);script.remove();loading=undefined;reject(Error('보안 확인을 불러오지 못했습니다. 네트워크나 광고 차단 설정을 확인한 뒤 다시 시도해 주세요.'));};
    const timer=window.setTimeout(fail,15000);
    script.onerror=fail;script.onload=()=>{if(!window.turnstile){fail();return;}clearTimeout(timer);resolve(window.turnstile);};
    document.head.append(script);
  });return loading;
}
export async function withCaptcha<T>(form:HTMLElement,work:(captchaToken?:string)=>Promise<T>):Promise<T>{
  // Local development can omit the public key. Server CAPTCHA remains authoritative.
  if(!siteKey)return work();
  if(active.has(form))throw Error('진행 중인 보안 확인을 완료해 주세요.');
  const controller=new AbortController();active.set(form,controller);
  const box=document.createElement('div'),hint=document.createElement('p'),slot=document.createElement('div');
  box.className='turnstile-check';hint.className='helper';hint.setAttribute('role','status');hint.textContent='보안 확인 중입니다…';box.append(hint,slot);
  const submit=form.querySelector('button[type="submit"],button:not([type])');if(submit)submit.before(box);else form.append(box);
  let api:Turnstile|undefined,id:string|undefined;
  try{
    api=await loadSdk();if(controller.signal.aborted||!form.isConnected||!form.getClientRects().length)throw cancelled();
    const token=await new Promise<string>((resolve,reject)=>{
      const finish=(value?:string,error?:Error)=>{clearTimeout(timer);controller.signal.removeEventListener('abort',abort);if(error)reject(error);else if(value&&value.length<=2048)resolve(value);else reject(Error('보안 확인에 실패했습니다. 다시 시도해 주세요.'));};
      const abort=()=>finish(undefined,cancelled());
      const timer=window.setTimeout(()=>finish(undefined,Error('보안 확인 시간이 지났습니다. 다시 시도해 주세요.')),120000);
      controller.signal.addEventListener('abort',abort,{once:true});
      try{
        id=api!.render(slot,{sitekey:siteKey,execution:'execute',appearance:'interaction-only',size:form.clientWidth<300?'compact':'flexible',theme:'light',language:'ko',retry:'never','refresh-expired':'manual','response-field':false,
          callback:value=>finish(value),'error-callback':()=>finish(undefined,Error('보안 확인에 실패했습니다. 다시 시도해 주세요.')),
          'expired-callback':()=>finish(undefined,Error('보안 확인이 만료됐습니다. 다시 시도해 주세요.')),
          'timeout-callback':()=>finish(undefined,Error('보안 확인 시간이 지났습니다. 다시 시도해 주세요.')),
          'before-interaction-callback':()=>{hint.textContent='아래 보안 확인을 완료해 주세요.';box.scrollIntoView({block:'nearest'});}});
        api!.execute(id);
      }catch{finish(undefined,Error('보안 확인을 시작하지 못했습니다. 다시 시도해 주세요.'));}
    });
    if(controller.signal.aborted)throw cancelled();
    return await work(token);
  }finally{
    if(id!==undefined)try{api?.remove(id);}catch{/* The SDK may already have removed a failed widget. */}
    box.remove();if(active.get(form)===controller)active.delete(form);
  }
}
