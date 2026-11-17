import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probeCaptcha} from '../web/src/captcha-probe.ts';
const config={url:'https://project.example.test/',key:'test-public-key'};
function transport(status:number,body:unknown):typeof fetch{return (async()=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})) as typeof fetch;}
test('security probes use disposable invalid credentials and an anonymous request without storing a login session',async()=>{
  const sent:any[]=[];
  const send=(async(url:any,request:any)=>{sent.push({url,request,body:JSON.parse(request.body)});return new Response(JSON.stringify({code:'invalid_credentials'}),{status:400});}) as typeof fetch;
  assert.equal(await probeCaptcha(config,'fresh-proof',undefined,send),'accepted');assert.equal(await probeCaptcha(config,undefined,undefined,send),'accepted');
  for(const item of sent){assert.equal(item.url,'https://project.example.test/auth/v1/token?grant_type=password');assert.equal(item.request.headers.apikey,'test-public-key');assert.equal(item.request.headers.Authorization,undefined);assert.equal(item.request.method,'POST');assert.match(item.body.email,/^bobpick-security-check-[0-9a-f-]+@example\.invalid$/);assert.match(item.body.password,/^[0-9a-f-]{36}$/);}
  assert.notEqual(sent[0].body.email,sent[1].body.email);assert.notEqual(sent[0].body.password,sent[1].body.password);assert.equal(sent[0].body.gotrue_meta_security.captcha_token,'fresh-proof');assert.equal(sent[1].body.gotrue_meta_security,undefined);
});
test('a probe distinguishes CAPTCHA rejection, credential processing, throttling and unexpected responses',async()=>{
  assert.equal(await probeCaptcha(config,undefined,undefined,transport(400,{code:'captcha_failed'})),'rejected');
  assert.equal(await probeCaptcha(config,undefined,undefined,transport(400,{error_code:'captcha_failed'})),'rejected');
  assert.equal(await probeCaptcha(config,undefined,undefined,transport(400,{error_description:'Invalid login credentials'})),'accepted');
  assert.equal(await probeCaptcha(config,undefined,undefined,transport(429,{code:'over_request_rate_limit'})),'limited');
  for(const status of [200,401,403,500])assert.equal(await probeCaptcha(config,undefined,undefined,transport(status,{access_token:'never-persist-this',code:'captcha_failed'})),'unknown');
  assert.equal(await probeCaptcha(config,undefined,undefined,transport(400,{message:'unexpected'})),'unknown');
});
test('probe failures and abort signals cannot be reported as successful checks',async()=>{
  const c=new AbortController();c.abort();
  const send=(async(_url:any,r:any)=>{assert.equal(r.signal.aborted,true);throw new DOMException('Stopped','AbortError');}) as typeof fetch;
  await assert.rejects(()=>probeCaptcha(config,'token',c.signal,send),{name:'AbortError'});
  await assert.rejects(()=>probeCaptcha({url:'',key:''},undefined,undefined,transport(400,{code:'captcha_failed'})),/설정/);
  const malformed=(async()=>new Response('not json',{status:400})) as typeof fetch;assert.equal(await probeCaptcha(config,undefined,undefined,malformed),'unknown');
});
