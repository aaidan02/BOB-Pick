import {test,expect} from '@playwright/test';
import {legacyRecommendation} from '../supabase/functions/_shared/recommendation';
import {naverMapSdkFixture} from './naver-sdk-fixture';
test.beforeEach(async({page})=>{await page.route('https://oapi.map.naver.com/**',route=>route.abort());});
async function login(page:any,email='a@example.test'){
  await page.goto('/#account');await page.locator('#auth-email').fill(email);await page.locator('#auth-password').fill('test-password');
  const signed=page.waitForResponse((r:any)=>r.url().includes('/auth/v1/token'));
  await page.locator('#auth-submit').click();await expect(page.locator('#member-box')).toBeVisible();return (await (await signed).json()).access_token;
}
async function expectResultsRevealed(page:any){
  // Verify the information the visitor needs, including after layout changes.
  await expect(page.locator('#menu')).toBeInViewport({ratio:1});
  await expect(page.locator('#name')).toBeInViewport({ratio:1});
  await expect(page.locator('#price')).toBeInViewport({ratio:1});
}
test('manual recommendation keeps filters, three cards, locks, price labels and menu favorites',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await login(page);
  await page.locator('.service-nav a[href="#filters"]').click();
  await expect(page.locator('#min')).toBeHidden();await expect(page.locator('#pick')).toBeVisible();
  await page.locator('#filter-details summary').focus();await page.keyboard.press('Enter');await expect(page.locator('#min')).toBeVisible();
  await page.locator('#time-enabled').uncheck();await expect(page.locator('#pick')).toBeEnabled();
  await page.locator('#pick').click();await expect(page.locator('.restaurant-card:visible')).toHaveCount(1);
  await page.locator('#category').selectOption('한식');await page.locator('#min').fill('1000');await expect(page.locator('#pick')).toBeEnabled();
  const original=page.waitForRequest(r=>r.url().endsWith('/rpc/pick_restaurants'));
  await page.locator('#pick').click();const filter=(await original).postDataJSON().p_filter;await expect(page.locator('.restaurant-card:visible')).toHaveCount(3);
  const locked=page.locator('.restaurant-card:visible').nth(1),id=await locked.getAttribute('data-restaurant-id');
  await locked.locator('.like').check();const repeated=page.waitForRequest(r=>r.url().endsWith('/rpc/pick_restaurants'));
  await page.locator('#result-retry').click();const retry=(await repeated).postDataJSON();expect(retry.p_filter).toEqual(filter);expect(retry.p_locked).toEqual([id]);
  await expect(locked).toHaveAttribute('data-restaurant-id',id!);await expect(locked.locator('.like')).toBeChecked();
  await expect(page.locator('#result-retry')).toBeEnabled();
  const favorite=locked.locator(':scope > .save-menu');await favorite.click();await expect(favorite).toHaveAttribute('aria-pressed','true');
  await page.locator('.service-nav a[href="#favorites"]').click();await expect(page.locator('#favorite-list .list-card')).toHaveCount(1);
  await page.reload();await expect(page.locator('#favorite-list .list-card')).toHaveCount(1);
  await page.locator('#favorite-list .save-menu').click();await expect(page.locator('#favorite-list .list-card')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
test('community create, search, edit and delete; profile ownership and logout persist',async({page})=>{
  await login(page);await page.locator('#profile-nickname').fill('밥픽 테스트 회원');await page.locator('#profile-save').click();await expect(page.locator('#member-status')).toHaveText('닉네임을 저장했습니다.');
  await page.locator('.service-nav a[href="#community"]').click();await expect(page.locator('#post-editor')).toBeHidden();await page.locator('#post-compose').click();await page.locator('#post-title').fill('둔산동 대구탕 후기');await page.locator('#post-body').fill('<img src=x onerror=alert(1)> 실제 메뉴 후기');await page.locator('#post-save').click();
  await expect(page.locator('#post-status')).toHaveText('게시글을 저장했습니다.');await page.locator('#post-search').fill('대구탕');
  const card=page.locator('#post-list .list-card');await expect(card).toHaveCount(1);
  const bar=card.locator('summary'),box=(await bar.boundingBox())!;await bar.click({position:{x:box.width-35,y:box.height/2}});
  await expect(card.locator('.post-body')).toBeVisible();await expect(card.locator('img')).toHaveCount(0);
  await bar.focus();await page.keyboard.press('Space');await expect(card.locator('.post-body')).toBeHidden();await page.keyboard.press('Enter');await expect(card.locator('.post-body')).toBeVisible();
  await card.getByRole('button',{name:'수정',exact:true}).click();await page.locator('#post-title').fill('수정된 대구탕 후기');await page.locator('#post-save').click();await expect(card.locator('.post-title')).toHaveText('수정된 대구탕 후기');
  await expect(card.locator('.post-body')).toBeVisible();page.once('dialog',dialog=>dialog.accept());await card.getByRole('button',{name:'삭제',exact:true}).click();await expect(page.locator('#post-list .list-card')).toHaveCount(0);
  await page.locator('.service-nav a[href="#account"]').click();await page.locator('#logout').click();await expect(page.locator('#auth-box')).toBeVisible();await page.reload();await expect(page.locator('#member-box')).toBeHidden();
});
test('member submits registration; admin approves; member sees immutable result and new catalog',async({page,browser})=>{
  await login(page);await page.locator('.service-nav a[href="#requests"]').click();await page.locator('#request-kind').selectOption('registration');
  await page.locator('#request-name').fill('밥픽 신규 테스트 식당');await page.locator('#request-address').fill('대전 둔산동 테스트 주소');await page.locator('#request-category').selectOption('한식');
  await page.locator('.new-menu-name').fill('테스트 비빔밥');await page.locator('.new-menu-price').fill('8000');await page.locator('.new-menu-form').selectOption('밥');
  await page.locator('#request-hours-enabled').check();await page.locator('#request-open').fill('00:00');await page.locator('#request-close').fill('00:00');
  await page.locator('#request-submit').click();await expect(page.locator('#request-status')).toHaveText('신청을 접수했습니다.');await expect(page.locator('#request-list')).toContainText('음식점 등록 · 대기');
  const context=await browser.newContext();const staff=await context.newPage();await staff.route('https://oapi.map.naver.com/**',r=>r.abort());await login(staff,'admin@example.test');
  await staff.locator('#admin-link').click();const pending=staff.locator('#admin-pending .list-card').filter({hasText:'밥픽 신규 테스트 식당'});await pending.locator('textarea').fill('정보 확인 완료');await pending.getByRole('button',{name:'승인',exact:true}).click();await expect(staff.locator('#admin-status')).toHaveText('처리했습니다.');
  await expect(staff.locator('#admin-reviews')).toContainText('음식점 등록 · 승인');await expect(staff.locator('#admin-logs')).toContainText('밥픽 신규 테스트 식당');
  await page.reload();await expect(page.locator('#request-list')).toContainText('음식점 등록 · 승인');await expect(page.locator('#request-list')).toContainText('정보 확인 완료');await expect(page.locator('#admin-link')).toBeHidden();
  await context.close();
});
test('AI uses chat rather than manual filters, scrolls results and shows a three-second success toast',async({page})=>{
  await login(page);let calls=0;
  const savedFilter={checkHours:false,restaurantTerms:['미향일식'],menuTerms:['대구탕'],date:'2026-11-10',time:'12:00'};
  await page.route('**/functions/v1/ai-recommend',async route=>{
    calls++;const request=route.request(),input=request.postDataJSON();
    expect(request.headers().authorization).toMatch(/^Bearer /);expect(input.history.at(-1).text).toBe('미향일식 대구탕 추천해줘');expect(input).not.toHaveProperty('max');expect(input).not.toHaveProperty('filter');
    await page.request.post('http://127.0.0.1:54329/rest/v1/rpc/consume_ai_quota',{headers:{Authorization:request.headers().authorization},data:{}});
    const response=await page.request.post('http://127.0.0.1:54329/rest/v1/rpc/pick_restaurants',{data:{p_filter:savedFilter,p_size:1,p_locked:[],p_prior:{}}});
    const batch=await response.json();
    await route.fulfill({contentType:'application/json',body:JSON.stringify({count:batch.count,restaurants:batch.restaurants.map((item:any)=>legacyRecommendation(item,batch.count)),filter:savedFilter,message:'대구탕을 골랐어요.',needsClarification:false})});
  });
  await page.locator('.service-nav a[href="#filters"]').click();await page.locator('#filter-details summary').click();await page.locator('#max').fill('1');await expect(page.locator('#pick')).toBeDisabled();
  await page.locator('#chat-input').fill('미향일식 대구탕 추천해줘');await page.locator('#chat-send').click();
  await expect(page.locator('#menu')).toHaveText('대구탕');await expect(page.locator('#price')).toHaveText('30,000원');await expect(page.locator('#success-toast')).toBeVisible();
  await expect(page.locator('#results-grid')).not.toHaveClass(/multiple/);
  await expectResultsRevealed(page);
  await expect(page.locator('#success-toast')).toBeHidden({timeout:4500});expect(calls).toBe(1);
  await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 19/20회');
  // Edited manual fields cannot override the AI's frozen category/menu/time filter.
  await page.locator('#max').fill('2');const repeated=page.waitForRequest(r=>r.url().endsWith('/rpc/pick_restaurants'));
  await page.locator('#result-retry').click();expect((await repeated).postDataJSON().p_filter).toEqual(savedFilter);
  await expect(page.locator('#result-retry')).toBeEnabled();await expect(page.locator('#menu')).toHaveText('대구탕');
  await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 19/20회');expect(calls).toBe(1);
  await page.screenshot({path:'build/cloud-app-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'build/cloud-app-mobile.png',fullPage:true});
});
test('two compact quick prompts hide on send, block duplicates and return with a new chat',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let calls=0,expectedPrompt='';
  let release:()=>void=()=>{};const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/functions/v1/ai-recommend',async route=>{
    calls++;const input=route.request().postDataJSON();
    expect(input.history.at(-1)).toEqual({role:'user',text:expectedPrompt});
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if(calls===1){await pending;await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'AI 추천에 실패했습니다. 다시 시도해 주세요.'})});return;}
    const response=await page.request.post('http://127.0.0.1:54329/rest/v1/rpc/pick_restaurants',{data:{p_filter:{checkHours:false},p_size:1,p_locked:[],p_prior:{}}});
    const batch=await response.json();
    await route.fulfill({contentType:'application/json',body:JSON.stringify({count:batch.count,restaurants:batch.restaurants.map((item:any)=>legacyRecommendation(item,batch.count)),filter:{checkHours:false},message:'요청한 메뉴를 골랐어요.',needsClarification:false})});
  });
  await page.goto('/#ai-chat');const options=page.locator('#chat-quick-options button');await expect(options).toHaveCount(2);
  await options.first().click();await expect(page.locator('#chat-quick')).toBeHidden();await expect(page.locator('#chat-status')).toHaveText('AI 추천은 로그인 후 사용할 수 있습니다.');expect(calls).toBe(0);
  await login(page);await page.locator('.service-nav a[href="#filters"]').click();await page.locator('.hero a[href="#ai-chat"]').click();
  const before=await options.evaluateAll(buttons=>buttons.map(button=>(button as HTMLButtonElement).dataset.prompt));
  await page.locator('#chat-reset').click();await expect(page.locator('#chat-quick')).toBeVisible();await expect(options).toHaveCount(2);
  const after=await options.evaluateAll(buttons=>buttons.map(button=>(button as HTMLButtonElement).dataset.prompt));
  expect(after.every(prompt=>!before.includes(prompt))).toBeTruthy();expect(calls).toBe(0);
  const circle=await options.first().boundingBox();expect(circle!.width).toBeLessThanOrEqual(104);expect(Math.abs(circle!.width-circle!.height)).toBeLessThan(1);
  await page.screenshot({path:'build/quick-ai-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('#ai-chat').screenshot({path:'build/quick-ai-mobile.png'});
  await page.setViewportSize({width:320,height:568});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.locator('#chat-input').fill('작성 중인 문장');expectedPrompt=(await options.first().getAttribute('data-prompt'))!;
  await options.first().focus();await page.keyboard.press('Enter');
  try{
    await expect.poll(()=>calls).toBe(1);await expect(page.locator('#chat-log .user')).toHaveCount(1);
    await expect(page.locator('#chat-log .user span')).toHaveText(expectedPrompt);await expect(page.locator('#chat-input')).toHaveValue('');
    await expect(page.locator('#chat-form')).toHaveAttribute('aria-busy','true');
    await expect(page.locator('#chat-quick')).toBeHidden();await expect(page.locator('#chat-conversation')).toHaveAttribute('data-busy','true');
    await expect(page.locator('#chat-quick button:disabled')).toHaveCount(2);
    await options.nth(1).evaluate(button=>(button as HTMLButtonElement).click());expect(calls).toBe(1);
  }finally{release();}
  await expect(page.locator('#chat-status')).toHaveText('AI 추천에 실패했습니다. 다시 시도해 주세요.');
  await expect(page.locator('#chat-quick')).toBeHidden();await expect(page.locator('#chat-conversation')).toHaveAttribute('data-busy','false');
  await page.locator('#chat-reset').click();await expect(page.locator('#chat-quick')).toBeVisible();
  expectedPrompt=(await options.nth(1).getAttribute('data-prompt'))!;await options.nth(1).click();
  await expect(page.locator('#chat-log .user')).toHaveCount(1);await expect(page.locator('.restaurant-card:visible')).toHaveCount(1);
  await expect(page.locator('#success-toast')).toBeVisible();await expect(page.locator('#chat-form')).toHaveAttribute('aria-busy','false');expect(calls).toBe(2);
  await expectResultsRevealed(page);
  await expect(page.locator('#chat-quick')).toBeHidden();
  await page.locator('#chat-reset').click();await expect(page.locator('#chat-log')).toBeHidden();await expect(page.locator('#chat-quick')).toBeVisible();await expect(options).toHaveCount(2);
  expect(errors).toEqual([]);
});
test('new chat cancels pending AI work and restores the two quick prompts',async({page})=>{
  await login(page);await page.locator('.service-nav a[href="#filters"]').click();
  let release:()=>void=()=>{},finished:()=>void=()=>{};
  const pending=new Promise<void>(resolve=>{release=resolve;}),done=new Promise<void>(resolve=>{finished=resolve;});
  await page.route('**/functions/v1/ai-recommend',async route=>{
    await pending;
    try{await route.fulfill({contentType:'application/json',body:JSON.stringify({count:0,restaurants:[],message:'취소한 대화의 응답',needsClarification:true})});}
    catch(error){if(!route.request().failure())throw error;}
    finally{finished();}
  });
  const requested=page.waitForRequest(request=>request.url().includes('/functions/v1/ai-recommend'));
  await page.locator('#chat-quick-options button').first().click();await requested;
  await expect(page.locator('#chat-conversation')).toHaveAttribute('data-busy','true');
  const aborted=page.waitForEvent('requestfailed',request=>request.url().includes('/functions/v1/ai-recommend'));
  try{
    await page.locator('#chat-reset').click();expect((await aborted).failure()?.errorText).toContain('ABORTED');
    await expect(page.locator('#chat-quick')).toBeVisible();await expect(page.locator('#chat-quick-options button')).toHaveCount(2);
    await expect(page.locator('#chat-log')).toBeHidden();await expect(page.locator('#chat-conversation')).toHaveAttribute('data-busy','false');
  }finally{release();await done;}
  await expect(page.locator('#chat-log')).toBeHidden();await expect(page.locator('#chat-status')).toBeEmpty();
  await expect(page.locator('body')).not.toContainText('취소한 대화의 응답');
});
test('quota display follows the signed-in account and exempts administrators',async({page})=>{
  const token=await login(page,'b@example.test');await page.locator('.service-nav a[href="#filters"]').click();
  await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 20/20회');
  await page.request.post('http://127.0.0.1:54329/rest/v1/rpc/consume_ai_quota',{headers:{Authorization:'Bearer '+token},data:{}});
  await page.reload();await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 19/20회');
  await page.locator('.service-nav a[href="#account"]').click();await page.locator('#logout').click();await expect(page.locator('#auth-box')).toBeVisible();
  await page.locator('.service-nav a[href="#filters"]').click();await expect(page.locator('#ai-quota')).toHaveText('로그인 후 AI 추천을 이용할 수 있어요.');
  await login(page,'admin@example.test');await page.locator('.service-nav a[href="#filters"]').click();
  await expect(page.locator('#ai-quota')).toHaveText('관리자 · AI 추천 무제한');
});
test('initial desktop view keeps the AI send button visible with compact quick prompts',async({page})=>{
  await page.setViewportSize({width:1920,height:912});await page.goto('/');await expect(page.locator('#pick')).toBeEnabled();
  for(const viewport of [{width:1920,height:912},{width:1280,height:800}]){
    await page.setViewportSize(viewport);await page.evaluate(()=>scrollTo(0,0));
    const box=(await page.locator('#chat-send').boundingBox())!;expect(box.y).toBeGreaterThan(0);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
  }
  await page.setViewportSize({width:1920,height:912});await page.screenshot({path:'build/initial-ai-visible.png'});
  await page.setViewportSize({width:320,height:700});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('request restaurant search supports name, address and IDs and clears stale menu selections',async({page})=>{
  let submitted=0;page.on('request',r=>{if(r.url().endsWith('/rpc/submit_request'))submitted++;});
  await login(page);await page.locator('.service-nav a[href="#requests"]').click();
  const search=page.locator('#request-search'),target=page.locator('#request-target'),menus=page.locator('#request-menu');
  await expect.poll(()=>target.locator('option').count()).toBeGreaterThan(500);
  await search.fill('미 향 일 식');await expect(target.locator('option')).toHaveCount(2);
  await expect(target.locator('option[value="15779"]')).toContainText('미향일식');
  await target.selectOption('15779');await expect(menus.locator('option')).toContainText(['메뉴 가격은 변경하지 않음','미향정식']);
  await expect(menus).toContainText('대구탕');
  await menus.selectOption({label:'대구탕'});await page.locator('#request-menu-price').fill('35000');
  await search.press('Enter');await expect(target).toBeFocused();expect(submitted).toBe(0);
  await search.fill('태평소국밥');await expect(target).toHaveValue('');await expect(menus.locator('option')).toHaveCount(1);await expect(page.locator('#request-menu-price')).toHaveValue('');
  await target.selectOption('16122');await expect(menus).toContainText('소국밥');
  const records=await (await page.request.get('http://127.0.0.1:54329/rest/v1/restaurants?id=eq.15779')).json();
  await search.fill(records[0].address);await expect(target.locator('option[value="15779"]')).toHaveCount(1);
  await search.fill('<없는식당 / ? >');await expect(target.locator('option')).toHaveCount(1);await expect(page.locator('#request-search-status')).toHaveText('검색 결과 0곳');await expect(target).toHaveValue('');
  await page.locator('#request-kind').selectOption('registration');await expect(search).toBeHidden();
  await page.locator('#request-kind').selectOption('promotion');await expect(search).toBeVisible();
  await search.fill('15779');await expect(target.locator('option')).toHaveCount(2);await target.selectOption('15779');
  await page.locator('#request-kind').selectOption('correction');await page.locator('#request-phone').fill('042-SEARCH-TEST');
  const pending=page.waitForRequest(r=>r.url().endsWith('/rpc/submit_request'));await page.locator('#request-submit').click();
  expect((await pending).postDataJSON().p_restaurant_id).toBe('15779');await expect(page.locator('#request-status')).toHaveText('신청을 접수했습니다.');
  await expect(search).toHaveValue('');await expect.poll(()=>target.locator('option').count()).toBeGreaterThan(500);await expect(menus.locator('option')).toHaveCount(1);
  expect(submitted).toBe(1);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.screenshot({path:'build/request-search-mobile.png',fullPage:true});
});
test('map viewport follows grid changes, hidden views, mobile sizes and zoom pixel ratios',async({page})=>{
  await page.unroute('https://oapi.map.naver.com/**');
  await page.route('https://oapi.map.naver.com/**',route=>route.fulfill({contentType:'text/javascript',body:naverMapSdkFixture}));
  await page.goto('/');await expect(page.locator('.test-map-tiles')).toBeVisible();
  async function filled(){await expect.poll(()=>page.evaluate(()=>{
    const node=document.getElementById('map')!,tiles=node.querySelector('.test-map-tiles') as HTMLElement;
    return !!tiles&&tiles.offsetWidth===node.clientWidth&&tiles.offsetHeight===node.clientHeight;
  })).toBe(true);}
  await filled();await page.locator('#filter-details summary').click();await page.locator('#time-enabled').uncheck();await page.locator('#category').selectOption('한식');
  await expect(page.locator('#results-grid')).toHaveClass(/multiple/);await filled();
  await expect(page.locator('#pick')).toBeEnabled();await page.locator('#pick').click();await expect(page.locator('.restaurant-card:visible')).toHaveCount(3);
  await expect.poll(()=>page.evaluate(()=>(window as any).mapTest.fits.length)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>(window as any).mapTest.fits.every((fit:any)=>fit.width===fit.container&&fit.points===3))).toBe(true);
  await page.setViewportSize({width:390,height:844});await filled();await page.setViewportSize({width:1280,height:720});await filled();
  await page.locator('#category').selectOption('');await expect(page.locator('#results-grid')).not.toHaveClass(/multiple/);await filled();
  await page.evaluate(()=>{const map=(window as any).testNaverMap;map.setCenter({lat:36.42,lng:127.48});map.setZoom(18);});
  await page.locator('.service-nav a[href="#community"]').click();await expect(page.locator('#map')).toBeHidden();
  await page.setViewportSize({width:1024,height:768});await page.locator('.service-nav a[href="#filters"]').click();await filled();
  await page.locator('.site-footer a[href="#privacy"]').click();await expect(page.locator('#map')).toBeHidden();await page.locator('.service-nav a[href="#filters"]').click();await filled();
  const before=await page.evaluate(()=>(window as any).mapTest.refreshes);
  const session=await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride',{width:1024,height:768,deviceScaleFactor:2,mobile:false});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await expect.poll(()=>page.evaluate(()=>(window as any).mapTest.refreshes)).toBeGreaterThan(before);
  const state=await page.evaluate(()=>({instances:(window as any).mapTest.instances,center:(window as any).testNaverMap.getCenter(),zoom:(window as any).testNaverMap.getZoom(),sizes:(window as any).mapTest.resizes}));
  expect(state.instances).toBe(1);expect(state.center).toEqual({lat:36.42,lng:127.48});expect(state.zoom).toBe(18);expect(state.sizes.every((s:any)=>s.width>0&&s.height>0)).toBe(true);
});
test('map creation waits until a previously hidden home view has a usable size',async({page})=>{
  await page.unroute('https://oapi.map.naver.com/**');await page.route('https://oapi.map.naver.com/**',route=>route.fulfill({contentType:'text/javascript',body:naverMapSdkFixture}));
  await page.goto('/#account');await page.waitForFunction(()=>!!(window as any).naver);
  expect(await page.evaluate(()=>(window as any).mapTest.instances)).toBe(0);
  await page.locator('.service-nav a[href="#filters"]').click();await expect(page.locator('.test-map-tiles')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).mapTest.instances)).toBe(1);
});
test('a map script that arrives after the delay message still initializes successfully',async({page})=>{
  await page.clock.install();
  let release!:()=>void,requested!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve),seen=new Promise<void>(resolve=>requested=resolve);
  await page.unroute('https://oapi.map.naver.com/**');
  await page.route('https://oapi.map.naver.com/**',async route=>{
    requested();await gate;
    await route.fulfill({contentType:'text/javascript',body:'window.naver={maps:{LatLng:class{constructor(lat,lng){}},Map:class{constructor(){window.mapCreated=true;}}}};'});
  });
  await page.goto('/#account',{waitUntil:'domcontentloaded'});await seen;
  try{
    await page.clock.runFor(13000);await expect(page.locator('#map-status')).toContainText('지연');
    release();await expect(page.locator('#map-status')).toHaveText('음식점을 뽑으면 위치를 표시합니다.');
    expect(await page.evaluate(()=>(window as any).mapCreated??false)).toBe(false);
    await page.locator('.service-nav a[href="#filters"]').click();await expect(page.locator('#map')).toBeVisible();
    await expect.poll(async()=>{await page.clock.runFor(32);return page.evaluate(()=>(window as any).mapCreated);}).toBe(true);
  }finally{release();}
});
test('admins can delete another member post while other members cannot edit or delete it',async({page,browser})=>{
  await login(page);await page.locator('.service-nav a[href="#community"]').click();await page.locator('#post-compose').click();
  await page.locator('#post-title').fill('관리자 삭제 권한 확인');await page.locator('#post-body').fill('회원이 쓴 게시글입니다.');await page.locator('#post-save').click();
  await expect(page.locator('#post-status')).toHaveText('게시글을 저장했습니다.');
  const otherContext=await browser.newContext(),other=await otherContext.newPage();await other.route('https://oapi.map.naver.com/**',r=>r.abort());await login(other,'b@example.test');
  await other.locator('.service-nav a[href="#community"]').click();await other.locator('#post-search').fill('관리자 삭제 권한 확인');
  const otherCard=other.locator('#post-list .post-card');await expect(otherCard).toHaveCount(1);await otherCard.locator('summary').click();
  await expect(otherCard.getByRole('button',{name:/수정|삭제/})).toHaveCount(0);await expect(other.locator('#admin-link')).toBeHidden();
  const staffContext=await browser.newContext(),staff=await staffContext.newPage();await staff.route('https://oapi.map.naver.com/**',r=>r.abort());await login(staff,'admin@example.test');
  await staff.locator('.service-nav a[href="#community"]').click();await staff.locator('#post-search').fill('관리자 삭제 권한 확인');
  const card=staff.locator('#post-list .post-card');await expect(card).toHaveCount(1);await card.locator('summary').click();
  await expect(card.getByRole('button',{name:'수정',exact:true})).toHaveCount(0);
  await staff.setViewportSize({width:390,height:844});await staff.screenshot({path:'build/community-admin-mobile.png'});
  staff.once('dialog',dialog=>dialog.accept());await card.getByRole('button',{name:'관리자 삭제',exact:true}).click();
  await expect(staff.locator('#post-status')).toHaveText('게시글을 삭제했습니다.');await expect(card).toHaveCount(0);
  await page.reload();await page.locator('#post-search').fill('관리자 삭제 권한 확인');await expect(page.locator('#post-list .post-card')).toHaveCount(0);
  await otherContext.close();await staffContext.close();
});
test('rejected inquiry renders an object review and restaurant name for admin and owner',async({page,browser})=>{
  await login(page);await page.locator('.service-nav a[href="#requests"]').click();await page.locator('#request-search').fill('15779');await expect(page.locator('#request-target option')).toHaveCount(2);
  await page.locator('#request-target').selectOption('15779');await page.locator('#request-phone').fill('042-REVIEW-TEST');await page.locator('#request-message').fill('반려 내역 표시 확인');await page.locator('#request-submit').click();
  await expect(page.locator('#request-status')).toHaveText('신청을 접수했습니다.');
  const pending=page.locator('#request-list .list-card').filter({hasText:'반려 내역 표시 확인'});await expect(pending).toContainText('미향일식');await expect(pending).toContainText('대기');
  const context=await browser.newContext(),staff=await context.newPage();await staff.route('https://oapi.map.naver.com/**',r=>r.abort());await login(staff,'admin@example.test');await staff.locator('#admin-link').click();
  const card=staff.locator('#admin-pending .list-card').filter({hasText:'반려 내역 표시 확인'});await card.locator('textarea').fill('정확한 전화번호를 다시 알려주세요.');await card.getByRole('button',{name:'반려',exact:true}).click();
  await expect(staff.locator('#admin-status')).toHaveText('처리했습니다.');await expect(staff.locator('#admin-reviews')).toContainText('정확한 전화번호를 다시 알려주세요.');
  const response=page.waitForResponse(r=>r.request().method()==='GET'&&r.url().includes('/rest/v1/requests?'));await page.reload();
  const data=await (await response).json(),reviewed=data.find((r:any)=>r.message==='반려 내역 표시 확인');expect(reviewed.request_reviews.decision).toBe('rejected');expect(Array.isArray(reviewed.request_reviews)).toBe(false);
  await expect(page.locator('#request-list')).toContainText('정확한 전화번호를 다시 알려주세요.');await expect(page.locator('#request-list')).toContainText('정보 수정 · 반려');
  await expect(page.locator('body')).not.toContainText('object is not iterable');await expect(staff.locator('body')).not.toContainText('object is not iterable');await context.close();
});
test('internal errors use Korean guidance and lists recover after retry',async({page})=>{
  await login(page,'admin@example.test');
  const broken='object is not iterable (cannot read property Symbol(Symbol.iterator))';
  await page.route('**/rest/v1/requests?**',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:broken})}));
  await page.locator('#admin-link').click();await expect(page.locator('#admin-status')).toHaveText('처리하지 못했어요. 잠시 후 다시 시도해 주세요.');await expect(page.locator('body')).not.toContainText(broken);
  await page.locator('.service-nav a[href="#requests"]').click();await expect(page.locator('#request-list-status')).toHaveText('처리하지 못했어요. 잠시 후 다시 시도해 주세요.');await expect(page.locator('body')).not.toContainText(broken);
  await page.unroute('**/rest/v1/requests?**');await page.locator('#request-reload').click();await expect(page.locator('#request-list-status')).toHaveText('아직 신청 내역이 없어요.');
  await page.route('**/rest/v1/rpc/search_posts',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:broken})}));
  await page.locator('.service-nav a[href="#community"]').click();await expect(page.locator('#post-list-status')).toHaveText('처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  await page.unroute('**/rest/v1/rpc/search_posts');await page.locator('#post-reload').click();await expect(page.locator('#post-list-status')).not.toContainText('처리하지 못했어요');
  await page.locator('#admin-link').click();await expect(page.locator('#admin-status')).toHaveText('');await expect(page.locator('#admin-reviews .list-card')).not.toHaveCount(0);
});
test('mobile navigation and main pages remain usable without horizontal scrolling',async({page})=>{
  await page.setViewportSize({width:390,height:844});await login(page,'admin@example.test');
  for(const hash of ['#filters','#community','#favorites','#requests','#admin','#account']){
    const link=page.locator('.service-nav a[href="'+hash+'"]');await link.click();await expect(link).toHaveAttribute('aria-current','page');
    const box=(await link.boundingBox())!;expect(box.y).toBeGreaterThan(700);expect(box.y+box.height).toBeLessThanOrEqual(844);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(hash==='#community')await page.screenshot({path:'build/community-mobile.png',fullPage:true});
    if(hash==='#admin')await page.screenshot({path:'build/admin-mobile.png',fullPage:true});
  }
  await page.setViewportSize({width:320,height:700});await page.locator('.service-nav a[href="#requests"]').click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('admins manage accounts while a pinned master cannot be revoked by self or other admins',async({page,browser})=>{
  test.setTimeout(90000);
  const staffToken=await login(page,'admin@example.test'),context=await browser.newContext(),member=await context.newPage();
  await member.route('https://oapi.map.naver.com/**',r=>r.abort());
  const memberToken=await login(member,'b@example.test');
  const call=(token:string,name:string,data:Record<string,unknown>={})=>page.request.post('http://127.0.0.1:54329/rest/v1/rpc/'+name,{headers:{Authorization:'Bearer '+token},data});
  const staffId='00000000-0000-4000-8000-000000000003',memberId='00000000-0000-4000-8000-000000000002',masterId='00000000-0000-4000-8000-000000000005';
  async function search(who:any,term:string){await who.locator('#admin-account-search').fill(term);await who.locator('#admin-account-search-submit').click();await expect(who.locator('#admin-account-results .admin-user-row')).toHaveCount(1);}
  async function grant(who:any,email:string){await search(who,email);who.once('dialog',(d:any)=>d.accept());await who.locator('#admin-account-results').getByRole('button',{name:'권한 추가',exact:true}).click();await expect(who.locator('#admin-account-status')).toHaveText('관리자 권한을 추가했습니다.');await expect(who.locator('#admin-account-count')).toHaveText('3');}
  try{
    const forbidden=await call(memberToken,'admin_search_accounts',{p_query:'admin'});expect((await forbidden.json()).code).toBe('42501');
    await expect(member.locator('#admin-link')).toBeHidden();await page.locator('#admin-link').click();
    await expect(page.locator('#admin-account-count')).toHaveText('2');
    const masterRow=page.locator('#admin-account-list .admin-user-row').filter({hasText:'master@example.test'});
    await expect(masterRow).toContainText('마스터');await expect(masterRow.getByRole('button',{name:'권한 해제',exact:true})).toBeDisabled();
    const blocked=await call(staffToken,'admin_set_membership',{p_user_id:masterId,p_enabled:false});expect((await blocked.json()).message).toContain('마스터 계정');
    await search(page,'pending@example.test');await expect(page.locator('#admin-account-results')).toContainText('이메일 확인 필요');await expect(page.locator('#admin-account-results button')).toBeDisabled();
    await grant(page,'B@EXAMPLE.TEST');await expect(page.locator('#admin-account-list')).toContainText('b@example.test');
    await member.reload();await expect(member.locator('#admin-link')).toBeVisible();await member.locator('#admin-link').click();await expect(member.locator('#admin-account-count')).toHaveText('3');
    page.once('dialog',d=>d.accept());await page.locator('#admin-account-list .admin-user-row').filter({hasText:'b@example.test'}).getByRole('button',{name:'권한 해제',exact:true}).click();await expect(page.locator('#admin-account-status')).toHaveText('관리자 권한을 해제했습니다.');await expect(page.locator('#admin-account-count')).toHaveText('2');
    const revoked=await call(memberToken,'admin_set_membership',{p_user_id:memberId,p_enabled:true});expect((await revoked.json()).code).toBe('42501');
    await member.locator('#admin-reload').click();await expect(member.locator('#admin-link')).toBeHidden();await expect(member.locator('#admin-content')).toBeHidden();
    await member.locator('.service-nav a[href="#account"]').click();await expect(member.locator('#member-box')).toBeVisible();
    await grant(page,'b@example.test');
    page.once('dialog',d=>d.accept());await page.locator('#admin-account-list .admin-user-row').filter({hasText:'admin@example.test'}).getByRole('button',{name:'권한 해제',exact:true}).click();
    await expect(page).toHaveURL(/#account$/);await expect(page.locator('#member-status')).toHaveText('관리자 권한을 해제했습니다.');await expect(page.locator('#admin-link')).toBeHidden();
    await member.reload();await member.locator('#admin-link').click();await expect(member.locator('#admin-account-count')).toHaveText('2');
    await grant(member,'admin@example.test');
    member.once('dialog',d=>d.accept());await member.locator('#admin-account-list .admin-user-row').filter({hasText:'b@example.test'}).getByRole('button',{name:'권한 해제',exact:true}).click();await expect(member).toHaveURL(/#account$/);await expect(member.locator('#member-box')).toBeVisible();
    await page.reload();await page.locator('#admin-link').click();await expect(page.locator('#admin-account-count')).toHaveText('2');await expect(page.locator('#admin-logs')).toContainText('관리자 권한 · 추가');await expect(page.locator('#admin-logs')).toContainText('관리자 권한 · 해제');
    await page.setViewportSize({width:390,height:844});await page.locator('section[aria-labelledby="admin-accounts-heading"]').screenshot({path:'build/admin-accounts-mobile.png'});
    await page.setViewportSize({width:320,height:700});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await member.locator('#logout').click();await expect(member.locator('#auth-box')).toBeVisible();
    const masterToken=await login(member,'master@example.test');await member.locator('#admin-link').click();
    const ownMaster=member.locator('#admin-account-list .admin-user-row').filter({hasText:'master@example.test'});
    await expect(ownMaster).toContainText('내 계정');await expect(ownMaster.getByRole('button',{name:'권한 해제',exact:true})).toBeDisabled();
    const ownBlocked=await call(masterToken,'admin_set_membership',{p_user_id:masterId,p_enabled:false});expect((await ownBlocked.json()).message).toContain('마스터 계정');
    await expect(member.locator('#admin-account-list-status')).toHaveText('마스터 계정의 관리자 권한은 해제할 수 없어요.');
  }finally{
    // Restore fixture roles through the same guarded API, even if a UI assertion fails.
    for(const token of [staffToken,memberToken]){const result=await call(token,'admin_set_membership',{p_user_id:staffId,p_enabled:true});if(result.ok())break;}
    await call(staffToken,'admin_set_membership',{p_user_id:memberId,p_enabled:false});await context.close();
  }
});
