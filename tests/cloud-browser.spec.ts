import {test,expect} from '@playwright/test';
import {legacyRecommendation} from '../supabase/functions/_shared/recommendation';
test.beforeEach(async({page})=>{await page.route('https://oapi.map.naver.com/**',route=>route.abort());});
async function login(page:any,email='a@example.test'){
  await page.goto('/#account');await page.locator('#auth-email').fill(email);await page.locator('#auth-password').fill('test-password');await page.locator('#auth-submit').click();await expect(page.locator('#member-box')).toBeVisible();
}
test('manual recommendation keeps filters, three cards, locks, price labels and menu favorites',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await login(page);
  await page.locator('.service-nav a[href="#filters"]').click();
  await page.locator('#time-enabled').uncheck();await expect(page.locator('#pick')).toBeEnabled();
  await page.locator('#pick').click();await expect(page.locator('.restaurant-card:visible')).toHaveCount(1);
  await page.locator('#category').selectOption('한식');await page.locator('#min').fill('1000');await expect(page.locator('#pick')).toBeEnabled();
  await page.locator('#pick').click();await expect(page.locator('.restaurant-card:visible')).toHaveCount(3);
  const locked=page.locator('.restaurant-card:visible').nth(1),id=await locked.getAttribute('data-restaurant-id');
  await locked.locator('.like').check();await page.locator('#pick').click();await expect(locked).toHaveAttribute('data-restaurant-id',id!);await expect(locked.locator('.like')).toBeChecked();
  const favorite=locked.locator(':scope > .save-menu');await favorite.click();await expect(favorite).toHaveAttribute('aria-pressed','true');
  await page.locator('.service-nav a[href="#favorites"]').click();await expect(page.locator('#favorite-list .list-card')).toHaveCount(1);
  await page.reload();await expect(page.locator('#favorite-list .list-card')).toHaveCount(1);
  await page.locator('#favorite-list .save-menu').click();await expect(page.locator('#favorite-list .list-card')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});
test('community create, search, edit and delete; profile ownership and logout persist',async({page})=>{
  await login(page);await page.locator('#profile-nickname').fill('밥픽 테스트 회원');await page.locator('#profile-save').click();await expect(page.locator('#member-status')).toHaveText('닉네임을 저장했습니다.');
  await page.locator('.service-nav a[href="#community"]').click();await page.locator('#post-title').fill('둔산동 대구탕 후기');await page.locator('#post-body').fill('<img src=x onerror=alert(1)> 실제 메뉴 후기');await page.locator('#post-save').click();
  await expect(page.locator('#post-status')).toHaveText('게시글을 저장했습니다.');await page.locator('#post-search').fill('대구탕');
  const card=page.locator('#post-list .list-card');await expect(card).toHaveCount(1);await card.locator('.post-title').click();await expect(card.locator('img')).toHaveCount(0);
  await card.getByRole('button',{name:'수정',exact:true}).click();await page.locator('#post-title').fill('수정된 대구탕 후기');await page.locator('#post-save').click();await expect(card.locator('.post-title')).toHaveText('수정된 대구탕 후기');
  await card.locator('.post-title').click();page.once('dialog',dialog=>dialog.accept());await card.getByRole('button',{name:'삭제',exact:true}).click();await expect(page.locator('#post-list .list-card')).toHaveCount(0);
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
  await page.route('**/functions/v1/ai-recommend',async route=>{
    calls++;const request=route.request(),input=request.postDataJSON();
    expect(request.headers().authorization).toMatch(/^Bearer /);expect(input.history.at(-1).text).toBe('미향일식 대구탕 추천해줘');expect(input).not.toHaveProperty('max');expect(input).not.toHaveProperty('filter');
    const response=await page.request.post('http://127.0.0.1:54329/rest/v1/rpc/pick_restaurants',{data:{p_filter:{checkHours:false,restaurantTerms:['미향일식'],menuTerms:['대구탕']},p_size:1,p_locked:[],p_prior:{}}});
    const batch=await response.json();
    await route.fulfill({contentType:'application/json',body:JSON.stringify({count:batch.count,restaurants:batch.restaurants.map((item:any)=>legacyRecommendation(item,batch.count)),message:'대구탕을 골랐어요.',needsClarification:false})});
  });
  await page.locator('.service-nav a[href="#filters"]').click();await page.locator('#max').fill('1');await expect(page.locator('#pick')).toBeDisabled();
  await page.locator('#chat-input').fill('미향일식 대구탕 추천해줘');await page.locator('#chat-send').click();
  await expect(page.locator('#menu')).toHaveText('대구탕');await expect(page.locator('#price')).toHaveText('30,000원');await expect(page.locator('#success-toast')).toBeVisible();
  await expect.poll(async()=>(await page.locator('#results-grid').boundingBox())?.y??999).toBeLessThan(100);
  await expect(page.locator('#success-toast')).toBeHidden({timeout:4500});expect(calls).toBe(1);
  await page.screenshot({path:'build/cloud-app-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:'build/cloud-app-mobile.png',fullPage:true});
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
    expect(await page.evaluate(()=>(window as any).mapCreated)).toBe(true);
  }finally{release();}
});
