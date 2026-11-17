import type {Page} from '@playwright/test';
const installed=new WeakSet<Page>();
/** Test-only transport substitute. Production never loads this script or accepts these tokens. */
export const turnstileSdkFixture=`(()=>{
  const widgets=new Map();
  const state=window.__turnstileTest={mode:window.__turnstileMode||'pass',tokens:[],sizes:[]};
  window.turnstile={
    render(element,options){const id=crypto.randomUUID();widgets.set(id,{element,options});state.sizes.push(options.size);return id;},
    execute(id){const entry=widgets.get(id),o=entry.options;
      const success=()=>{const token='test-captcha-'+crypto.randomUUID();state.tokens.push(token);o.callback(token);};
      queueMicrotask(()=>{
        if(!widgets.has(id))return;
        if(state.mode==='error'){o['error-callback']('300030');return;}
        if(state.mode==='expired'){o['expired-callback']();return;}
        if(state.mode==='manual'){o['before-interaction-callback']();const button=document.createElement('button');button.type='button';button.textContent='테스트 보안 확인';button.onclick=()=>{button.disabled=true;success();};entry.element.append(button);return;}
        success();
      });
    },
    remove(id){const entry=widgets.get(id);if(entry)entry.element.replaceChildren();widgets.delete(id);}
  };
})();`;
export async function installTurnstile(page:Page){
  if(installed.has(page))return;installed.add(page);
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',route=>route.fulfill({contentType:'application/javascript',body:turnstileSdkFixture}));
}
