export type CaptchaProbeResult='rejected'|'accepted'|'limited'|'unknown';
/** Anonymous, intentionally invalid credentials: never use the current user's login client. */
export async function probeCaptcha(config:{url:string;key:string},captchaToken?:string,signal?:AbortSignal,send:typeof fetch=fetch):Promise<CaptchaProbeResult>{
  if(!config.url||!config.key)throw Error('인증 서버 연결 설정을 확인해 주세요.');
  const response=await send(config.url.replace(/\/$/,'')+'/auth/v1/token?grant_type=password',{
    method:'POST',headers:{apikey:config.key,'Content-Type':'application/json','X-Supabase-Api-Version':'2024-01-01'},signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]),
    body:JSON.stringify({email:'bobpick-security-check-'+crypto.randomUUID()+'@example.invalid',password:crypto.randomUUID(),...(captchaToken===undefined?{}:{gotrue_meta_security:{captcha_token:captchaToken}})})
  });
  if(response.status===429){await response.body?.cancel();return 'limited';}
  // No successful login response is expected or persisted, even if the server misbehaves.
  if(response.status!==400){await response.body?.cancel();return 'unknown';}
  let raw:unknown;try{raw=await response.json();}catch{return 'unknown';}
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return 'unknown';
  const packet=raw as Record<string,unknown>;
  // Hosted Auth's legacy `code` can be the numeric HTTP status, not an error name.
  const code=typeof packet.code==='string'?packet.code:typeof packet.error_code==='string'?packet.error_code:undefined;
  const message=typeof packet.msg==='string'?packet.msg:typeof packet.error_description==='string'?packet.error_description:'';
  if(code==='captcha_failed'||(!code&&/^captcha protection: request disallowed\b/.test(message)))return 'rejected';
  if(code==='invalid_credentials'||(!code&&message==='Invalid login credentials'))return 'accepted';
  return 'unknown';
}
