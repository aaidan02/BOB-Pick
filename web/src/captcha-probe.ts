export type CaptchaProbeResult='rejected'|'accepted'|'limited'|'unknown';
/** Anonymous, intentionally invalid credentials: never use the current user's login client. */
export async function probeCaptcha(config:{url:string;key:string},captchaToken?:string,signal?:AbortSignal,send:typeof fetch=fetch):Promise<CaptchaProbeResult>{
  if(!config.url||!config.key)throw Error('인증 서버 연결 설정을 확인해 주세요.');
  const response=await send(config.url.replace(/\/$/,'')+'/auth/v1/token?grant_type=password',{
    method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]),
    body:JSON.stringify({email:'bobpick-security-check-'+crypto.randomUUID()+'@example.invalid',password:crypto.randomUUID(),...(captchaToken===undefined?{}:{gotrue_meta_security:{captcha_token:captchaToken}})})
  });
  if(response.status===429){await response.body?.cancel();return 'limited';}
  // No successful login response is expected or persisted, even if the server misbehaves.
  if(response.status!==400){await response.body?.cancel();return 'unknown';}
  let packet:{code?:string;error_code?:string;msg?:string;error_description?:string};try{packet=await response.json();}catch{return 'unknown';}
  const code=packet?.code??packet?.error_code;
  if(code==='captcha_failed')return 'rejected';
  if(code==='invalid_credentials'||packet?.msg==='Invalid login credentials'||packet?.error_description==='Invalid login credentials')return 'accepted';
  return 'unknown';
}
