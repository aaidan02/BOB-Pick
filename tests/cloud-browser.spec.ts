import {test,expect} from '@playwright/test';
import {legacyRecommendation} from '../supabase/functions/_shared/recommendation';
import {naverMapSdkFixture} from './naver-sdk-fixture';
import {hasMapCoordinates} from '../web/src/naver';

test('administrator records split inquiries from community, edit hidden posts without republishing and explicitly restore them',async({page,browser})=>{
  await signupMember(page,'moderation-post@example.test');await page.locator('.service-nav a[href="#community"]').click();await page.locator('#post-compose').click();await page.locator('#post-title').fill('삭제 원문 관리자 편집');await page.locator('#post-body').fill('보관할 원문');await page.locator('#post-save').click();await expect(page.locator('#post-status')).toHaveText('게시글을 저장했습니다.');
  const card=page.locator('#post-list .post-card').filter({hasText:'삭제 원문 관리자 편집'});await card.locator('summary').click();page.once('dialog',d=>d.accept());await card.getByRole('button',{name:'삭제',exact:true}).click();await expect(card).toHaveCount(0);
  const context=await browser.newContext(),staff=await context.newPage();try{
    await staff.route('https://oapi.map.naver.com/**',r=>r.abort());await login(staff,'admin@example.test');await staff.locator('#admin-link').click();
    await expect(staff.locator('#admin-records-inquiries')).toBeVisible();await staff.getByRole('tab',{name:'커뮤니티 내역'}).click();await expect(staff.locator('#admin-records-inquiries')).toBeHidden();
    await staff.locator('#admin-post-state').selectOption('deleted');await staff.locator('#admin-post-search').fill('삭제 원문 관리자 편집');
    const entry=staff.locator('#admin-post-list .admin-post-card');await expect(entry).toHaveCount(1);await entry.locator('summary').click();await entry.getByRole('button',{name:'내용 수정'}).click();
    await expect(staff.locator('#admin-post-editor-hint')).toContainText('수정해도 공개되지 않으며');await staff.locator('#admin-post-title').fill('관리자가 정정한 삭제글');await staff.locator('#admin-post-body').fill('<img src=x onerror=alert(1)> 안전한 정정 내용');
    await staff.locator('#admin-post-save').click();await expect(staff.locator('#admin-post-status')).toHaveText('게시글을 수정했습니다.');
    await page.locator('#post-reload').click();await page.locator('#post-search').fill('관리자가 정정한 삭제글');await expect(page.locator('#post-list .post-card')).toHaveCount(0);
    await staff.locator('#admin-post-search').fill('관리자가 정정한 삭제글');await expect(entry).toContainText('삭제됨');await entry.locator('summary').click();await expect(entry.locator('img')).toHaveCount(0);
    for(const width of [390,320]){await staff.setViewportSize({width,height:844});expect(await staff.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}await staff.screenshot({path:'build/admin-records-mobile.png',fullPage:true});
    staff.once('dialog',d=>d.accept());await entry.getByRole('button',{name:'복원',exact:true}).click();await expect(staff.locator('#admin-post-status')).toHaveText('게시글을 복원했습니다.');await expect(entry).toHaveCount(0);
    await page.locator('#post-reload').click();const publicCard=page.locator('#post-list .post-card');await expect(publicCard).toContainText('관리자가 정정한 삭제글');await publicCard.locator('summary').click();await expect(publicCard.locator('.post-body')).toContainText('안전한 정정 내용');await expect(publicCard.locator('img')).toHaveCount(0);
    await staff.getByRole('tab',{name:'문의 내역'}).click();await expect(staff.locator('#admin-records-inquiries')).toBeVisible();await expect(staff.locator('#admin-records-community')).toBeHidden();
  }finally{await context.close();}
});

test('administrator edits a rejected inquiry and reason, reopens it and applies the amended catalog only on approval',async({page,browser})=>{
  await signupMember(page,'moderation-inquiry@example.test');await page.locator('.service-nav a[href="#requests"]').click();await page.locator('#request-search').fill('15779');await expect(page.locator('#request-target option')).toHaveCount(2);await page.locator('#request-target').selectOption('15779');await page.locator('#request-phone').fill('042-EDIT-BEFORE');await page.locator('#request-message').fill('반려 수정 재승인 테스트');await page.locator('#request-submit').click();await expect(page.locator('#request-status')).toHaveText('신청을 접수했습니다.');
  const context=await browser.newContext(),staff=await context.newPage();try{
    await staff.route('https://oapi.map.naver.com/**',r=>r.abort());await login(staff,'admin@example.test');await staff.locator('#admin-link').click();
    const pending=staff.locator('#admin-pending .list-card').filter({hasText:'반려 수정 재승인 테스트'});await pending.locator('textarea').fill('처음 반려 이유');await pending.getByRole('button',{name:'반려',exact:true}).click();await expect(staff.locator('#admin-status')).toHaveText('처리했습니다.');
    const rejected=staff.locator('#admin-reviews .list-card').filter({hasText:'반려 수정 재승인 테스트'});await rejected.getByRole('button',{name:'내용 수정'}).click();await rejected.getByRole('textbox',{name:'전화번호',exact:true}).fill('042-EDIT-AFTER');await rejected.getByRole('textbox',{name:'처리 사유',exact:true}).fill('정정된 반려 사유');await rejected.getByRole('button',{name:'수정 저장'}).click();await expect(staff.locator('#admin-status')).toHaveText('문의 내용을 수정했습니다.');
    await page.locator('#request-reload').click();const own=page.locator('#request-list .list-card').filter({hasText:'반려 수정 재승인 테스트'});await expect(own).toContainText('정정된 반려 사유');await expect(own).toContainText('반려');
    await rejected.getByRole('button',{name:'승인 대기로 돌리기'}).click();await expect(staff.locator('#admin-status')).toHaveText('승인 대기로 변경했습니다.');await expect(pending).toBeVisible();await pending.getByRole('button',{name:'승인',exact:true}).click();await expect(staff.locator('#admin-status')).toHaveText('처리했습니다.');
    const applied=await (await page.request.get('http://127.0.0.1:54329/rest/v1/restaurants?id=eq.15779&select=phone')).json();expect(applied[0].phone).toBe('042-EDIT-AFTER');await page.locator('#request-reload').click();await expect(own).toContainText('승인');
  }finally{await context.close();}
});

test('popularity stays in the left gutter without adding page height and collapses into an accessible panel on smaller screens',async({page})=>{
  const signed=page.waitForResponse(r=>r.url().includes('/auth/v1/signup'));await signupMember(page,'popularity-ui@example.test');const token=(await (await signed).json()).access_token,api='http://127.0.0.1:54329/rest/v1',headers={Authorization:'Bearer '+token};
  const member=await (await page.request.get('http://127.0.0.1:54329/auth/v1/user',{headers})).json();
  const menus=await (await page.request.get(api+'/menus?restaurant_id=eq.15779&select=id&limit=2')).json();
  for(let i=0;i<6;i++){const saved=await page.request.post(api+'/rpc/save_recommendation_history',{headers,data:{p_event_id:crypto.randomUUID(),p_source:'manual',p_filter:{checkHours:false},p_items:[{restaurantId:'15779',menuId:menus[0].id}]}});expect(saved.ok()).toBe(true);}
  await page.request.post(api+'/favorites',{headers,data:{user_id:member.id,menu_id:menus[0].id}});
  await page.locator('#account-tab-history').click();const history=page.locator('#history-list .history-card').filter({hasText:'미향일식'}).first();await history.getByRole('button',{name:'다녀왔어요',exact:true}).click();
  await page.setViewportSize({width:1920,height:900});await page.locator('.brand').click();await page.locator('#popularity-reload').click();await expect(page.locator('#popularity-status')).toHaveText('');
  for(const id of ['popular-searches','popular-visits','popular-favorites']){await expect(page.locator('#'+id)).toContainText('미향일식');const link=page.locator('#'+id+' a').filter({hasText:'미향일식'});await expect(link).toHaveAttribute('target','_blank');expect(await link.getAttribute('href')).toContain('map.naver.com');}
  await expect(page.locator('#popular-started')).toContainText('부터 검색 집계');await expect(page.locator('#popular-searches .popular-total').first()).toContainText('회');
  const sidebar=page.locator('#popularity-panel'),toggle=page.locator('#popularity-toggle');await expect(sidebar).toBeVisible();await expect(toggle).toBeHidden();
  const panel=(await sidebar.boundingBox())!,main=(await page.locator('#home-view>.content').boundingBox())!;expect(panel.x+panel.width).toBeLessThanOrEqual(main.x-16);expect(panel.width).toBeLessThanOrEqual(240);
  expect(await page.locator('#home-view').evaluate(home=>{const before=home.getBoundingClientRect().height,sidebar=document.getElementById('popular-restaurants')!;sidebar.style.display='none';const after=home.getBoundingClientRect().height;sidebar.style.removeProperty('display');return before===after;})).toBe(true);
  await page.screenshot({path:'build/popularity-desktop.png'});
  for(const width of [1500,1280,390,320]){
    await page.setViewportSize({width,height:844});await expect(toggle).toBeVisible();if(await sidebar.isVisible())await page.locator('#popularity-close').click();await expect(sidebar).toBeHidden();
    await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(sidebar).toBeVisible();const rect=(await sidebar.boundingBox())!;expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);expect(rect.y).toBeGreaterThanOrEqual(75);expect(rect.y+rect.height).toBeLessThan(844-(width<=820?90:20));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await toggle.press('Escape');await expect(sidebar).toBeHidden();await expect(toggle).toBeFocused();
  }
  await toggle.click();await page.screenshot({path:'build/popularity-mobile.png'});
  await page.route('**/rest/v1/rpc/site_popularity',r=>r.fulfill({status:500,json:{message:'internal data'}}));await page.locator('#popularity-reload').click();await expect(page.locator('#popularity-status')).toContainText('불러오지 못했어요');await expect(page.locator('#popular-searches')).toContainText('미향일식');await expect(page.locator('#pick')).toBeEnabled();
  await page.locator('.service-nav a[href="#community"]').click();await expect(toggle).toBeHidden();await page.locator('.brand').click();await expect(sidebar).toBeHidden();
});
test.beforeEach(async({page})=>{
  await page.route('https://oapi.map.naver.com/**',route=>route.abort());
  // Existing feature flows start after onboarding. Guide tests use clean contexts.
  await page.addInitScript(()=>localStorage.setItem('bob-pick:help-seen:v1','1'));
});

test('AI resolves registered names and typo confirmations, and noisy food clues use real menu forms',async({page})=>{
  await signupMember(page,'ai-name-regression@example.test');await page.locator('.service-nav a[href="#filters"]').click();
  await page.locator('#chat-input').fill('감성키친 서구점 영업시간 무시');await page.locator('#chat-send').click();await expect(page.locator('#name')).toHaveText('감성키친 서구점');await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 19/20회');
  await page.locator('#chat-reset').click();await page.locator('#chat-input').fill('미향일');await page.locator('#chat-send').click();await expect(page.locator('#chat-log')).toContainText('미향일식(대전광역시 서구 둔산동 1315)');await expect(page.locator('#chat-log')).toContainText('어느 곳인가요');await expect(page.locator('#chat-log')).not.toContainText('ID');await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 19/20회');
  await page.locator('#chat-reset').click();await page.locator('#chat-input').fill('바밥ㅂ바밥ㅂ밥밥ㅂ');await page.locator('#chat-send').click();await expect(page.locator('.restaurant-card:visible')).not.toHaveCount(0);for(const tag of await page.locator('.restaurant-card:visible .tags').allTextContents())expect(tag).toContain('밥');await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 18/20회');
});

test('AI searches both directions around a named cafe or restaurant, displays straight-line distance and preserves the origin on retry',async({page})=>{
  await signupMember(page,'ai-nearby-regression@example.test');await page.locator('.service-nav a[href="#filters"]').click();
  const catalog=await (await page.request.get('http://127.0.0.1:54329/rest/v1/restaurants?select=id,name,categories,latitude,longitude')).json(),cafe=catalog.find((r:any)=>r.categories.includes('카페·디저트')&&r.latitude!=null&&r.longitude!=null&&catalog.filter((other:any)=>other.name.replace(/\s/g,'')===r.name.replace(/\s/g,'')).length===1);
  for(const [text,anchor,wantCafe]of [['미향일식 근처 카페 영업시간 무시','15779',true],[cafe.name+'와 가까운 음식점 영업시간 무시',cafe.id,false]] as const){
    await page.locator('#chat-reset').click();await page.locator('#chat-input').fill(text);const completed=page.waitForResponse(r=>r.url().includes('/functions/v1/ai-recommend'));await page.locator('#chat-send').click();const result=await (await completed).json();expect(result.filter.nearRestaurantId).toBe(anchor);await expect(page.locator('.restaurant-card:visible')).toHaveCount(3);
    for(const card of await page.locator('.restaurant-card:visible').all()){await expect(card.locator('.nearby-distance')).toContainText('직선');expect((await card.locator('.tags').textContent())!.includes('카페')).toBe(wantCafe);expect(await card.getAttribute('data-restaurant-id')).not.toBe(anchor);}
    const repeated=page.waitForRequest(r=>r.url().endsWith('/rpc/pick_restaurants'));await page.locator('#result-retry').click();expect((await repeated).postDataJSON().p_filter).toEqual(result.filter);await expect(page.locator('#result-retry')).toBeEnabled();
  }
  await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 18/20회');
});

test('first-visit help opens once per browser, remains accessible manually, and fits mobile',async({browser})=>{
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const context=await browser.newContext({viewport}),page=await context.newPage();
    try{
      await page.route('https://oapi.map.naver.com/**',route=>route.abort());
      await page.goto('/');
      const guide=page.getByRole('dialog',{name:'밥픽, 이렇게 사용해요'}),toggle=page.getByRole('button',{name:'사이트 사용법'});
      await expect(guide).toBeVisible();await expect(toggle).toHaveAttribute('aria-expanded','true');
      await expect(page.getByRole('button',{name:'사용법 닫기'})).toBeFocused();
      expect(await guide.evaluate(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;})).toBe(true);
      await page.keyboard.press('Escape');await expect(guide).toBeHidden();await expect(toggle).toBeFocused();
      await page.reload();await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(guide).toBeHidden();
      await toggle.click();await expect(guide).toBeVisible();
      await page.getByRole('button',{name:'사용법 닫기'}).click();await expect(toggle).toBeFocused();await expect(guide).toBeHidden();
      await toggle.click();await page.locator('.brand').click();await expect(guide).toBeHidden();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }finally{await context.close();}
  }
});

test('first-visit help waits for the homepage when the first link is an account or legal page',async({browser})=>{
  const context=await browser.newContext(),page=await context.newPage();
  try{
    await page.route('https://oapi.map.naver.com/**',route=>route.abort());
    await page.goto('/#account');await expect(page.locator('#auth-box')).toBeVisible();await expect(page.locator('#site-help')).toBeHidden();
    expect(await page.evaluate(()=>localStorage.getItem('bob-pick:help-seen:v1'))).toBeNull();
    await page.locator('.site-footer a[href="#terms"]').click();await expect(page.locator('#legal-heading')).toHaveText('이용약관');await expect(page.locator('#site-help')).toBeHidden();
    await page.locator('.service-nav a[href="#filters"]').click();await expect(page.locator('#site-help')).toBeVisible();
    await page.locator('.service-nav a[href="#community"]').click();await expect(page.locator('#site-help')).toBeHidden();
    await page.locator('.brand').click();await expect(page.locator('#site-help')).toBeHidden();
    await page.reload();await expect(page.locator('#site-help-toggle')).toHaveAttribute('aria-expanded','false');
  }finally{await context.close();}
});

test('first-visit help still works without browser storage or a ready catalog API',async({browser})=>{
  const context=await browser.newContext(),page=await context.newPage();
  try{
    await page.route('https://oapi.map.naver.com/**',route=>route.abort());
    await page.addInitScript(()=>{
      const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
      Storage.prototype.getItem=function(key){if(key==='bob-pick:help-seen:v1')throw new DOMException('Storage blocked','SecurityError');return get.call(this,key);};
      Storage.prototype.setItem=function(key,value){if(key==='bob-pick:help-seen:v1')throw new DOMException('Storage blocked','SecurityError');set.call(this,key,value);};
    });
    await page.route('**/rest/v1/rpc/catalog_options',()=>{});
    await page.goto('/');await expect(page.locator('#site-help')).toBeVisible();
    await page.locator('#site-help-close').click();await page.locator('.service-nav a[href="#community"]').click();
    await page.locator('.brand').click();await expect(page.locator('#site-help')).toBeHidden();
    await page.locator('#site-help-toggle').click();await expect(page.locator('#site-help')).toBeVisible();
  }finally{await context.close();}
});
async function login(page:any,email='a@example.test'){
  await page.goto('/#account');await page.locator('[data-auth-mode="login"]').click();await page.locator('#auth-email').fill(email);await page.locator('#auth-password').fill('test-password');
  const signed=page.waitForResponse((r:any)=>r.url().includes('/auth/v1/token'));
  await page.locator('#auth-submit').click();await expect(page.locator('#member-box')).toBeVisible();return (await (await signed).json()).access_token;
}
async function signupMember(page:any,email:string,configure?:()=>Promise<void>){
  await page.goto('/#account');await page.locator('[data-auth-mode="signup"]').click();
  await page.locator('#auth-email').fill(email);await page.locator('#auth-password').fill('test-password');await page.locator('#auth-password-confirm').fill('test-password');await page.locator('#auth-nickname').fill('새로운 밥친구');
  await expect(page.locator('#auth-form .taste-section')).toHaveCount(0);await expect(page.locator('#taste-onboarding')).not.toBeVisible();
  const registered=page.waitForRequest((r:any)=>r.url().includes('/auth/v1/signup'));
  await page.locator('#auth-submit').click();expect((await registered).postDataJSON().data).toEqual({nickname:'새로운 밥친구'});
  await expect(page.locator('#taste-onboarding')).toBeVisible();
  if(configure){await configure();await page.locator('#onboarding-save').click();}else await page.locator('#onboarding-skip').click();
  await expect(page.locator('#taste-onboarding')).not.toBeVisible();await page.locator('.service-nav a[href="#account"]').click();
  await expect(page.locator('#member-box')).toBeVisible();await expect(page.locator('#member-email')).toHaveText(email);await expect(page.locator('#manual-taste-row')).not.toHaveAttribute('hidden');
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
  await page.route('**/rpc/pick_restaurants',async route=>{
    const response=await route.fetch(),batch=await response.json();
    // Exercise a valid registration without coordinates on every run.
    batch.restaurants[0].restaurant.latitude=null;
    await route.fulfill({response,json:batch});
  });
  await page.goto('/');await expect(page.locator('.test-map-tiles')).toBeVisible();
  async function filled(){await expect.poll(()=>page.evaluate(()=>{
    const node=document.getElementById('map')!,tiles=node.querySelector('.test-map-tiles') as HTMLElement;
    return !!tiles&&tiles.offsetWidth===node.clientWidth&&tiles.offsetHeight===node.clientHeight;
  })).toBe(true);}
  await filled();await page.locator('#filter-details summary').click();await page.locator('#time-enabled').uncheck();await page.locator('#category').selectOption('한식');
  await expect(page.locator('#results-grid')).toHaveClass(/multiple/);await filled();
  await expect(page.locator('#pick')).toBeEnabled();const picked=page.waitForResponse(r=>r.url().endsWith('/rpc/pick_restaurants'));await page.locator('#pick').click();await expect(page.locator('.restaurant-card:visible')).toHaveCount(3);
  // Restaurant registrations may omit coordinates. Only valid
  // selected locations belong in the map bounds, regardless of the random draw.
  const batch=await (await picked).json(),points=batch.restaurants.filter((item:any)=>hasMapCoordinates(item.restaurant)).length;
  await expect.poll(()=>page.evaluate(()=>(window as any).mapTest.markers.filter((marker:any)=>marker.map).length)).toBe(points);
  if(points>1)await expect.poll(()=>page.evaluate(()=>(window as any).mapTest.fits.length)).toBeGreaterThan(0);
  expect(await page.evaluate(expected=>(window as any).mapTest.fits.every((fit:any)=>fit.width===fit.container&&fit.points===expected),points)).toBe(true);
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

test('preferences are collected after signup, persist once completed and manual search uses soft likes with hard exclusions',async({page})=>{
  await signupMember(page,'taste-new@example.test',async()=>{
    const korean=page.locator('#onboarding-taste-categories .taste-row').filter({hasText:'한식'});
    await korean.getByRole('button',{name:/좋아요/}).click();await korean.getByRole('button',{name:/피할래요/}).click();await expect(korean.getByRole('button',{name:/좋아요/})).toHaveAttribute('aria-pressed','false');
    await korean.getByRole('button',{name:/좋아요/}).click();await page.locator('#onboarding-taste-categories .taste-row').filter({hasText:'중식'}).getByRole('button',{name:/피할래요/}).click();
    await page.locator('#onboarding-taste-forms').getByRole('button',{name:'밥',exact:true}).click();await page.locator('#onboarding-taste-menus').getByRole('button',{name:'짜장면',exact:true}).click();
    await page.locator('#onboarding-taste-min').fill('5000');await page.locator('#onboarding-taste-max').fill('10000');await page.locator('#onboarding-taste-days').getByRole('button',{name:'14일',exact:true}).click();
  });
  await page.getByRole('tab',{name:'내 취향',exact:true}).click();
  await expect(page.locator('#member-taste-categories .taste-row').filter({hasText:'한식'}).getByRole('button',{name:/좋아요/})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#member-taste-categories .taste-row').filter({hasText:'중식'}).getByRole('button',{name:/피할래요/})).toHaveAttribute('aria-pressed','true');await expect(page.locator('#member-taste-min')).toHaveValue('5000');
  await page.reload();await expect(page.locator('#taste-onboarding')).not.toBeVisible();await page.getByRole('tab',{name:'내 취향',exact:true}).click();await expect(page.locator('#member-taste-max')).toHaveValue('10000');await expect(page.locator('#member-taste-days').getByRole('button',{name:'14일',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('.service-nav a[href="#filters"]').click();await page.locator('#filter-details summary').click();await expect(page.locator('#min')).toHaveValue('5000');await page.locator('#time-enabled').uncheck();await expect(page.locator('#pick')).toBeEnabled();
  const searching=page.waitForRequest(r=>r.url().endsWith('/rpc/pick_restaurants'));await page.locator('#pick').click();const filter=(await searching).postDataJSON().p_filter;
  expect(filter.preferredCategories).toEqual(['한식']);expect(filter.excludedCategories).toEqual(['중식']);expect(filter.excludedTerms).toEqual(['짜장면']);expect(filter.min).toBe(5000);expect(filter.max).toBe(10000);
  await expect(page.locator('.restaurant-card:visible')).toHaveCount(3);
});

test('history records shown recommendations, marks real visits, excludes them on later searches and stays account-private',async({page})=>{
  await signupMember(page,'history-new@example.test');await page.locator('.service-nav a[href="#filters"]').click();await page.locator('#filter-details summary').click();await page.locator('#time-enabled').uncheck();await expect(page.locator('#pick')).toBeEnabled();
  const stored=page.waitForResponse(r=>r.url().endsWith('/rpc/save_recommendation_history'));await page.locator('#pick').click();await expect(page.locator('.restaurant-card:visible')).toHaveCount(1);const restaurant=await page.locator('#result').getAttribute('data-restaurant-id');await stored;
  await page.locator('.service-nav a[href="#account"]').click();await page.getByRole('tab',{name:'추천·방문 기록'}).click();await expect(page.locator('#history-list .history-card')).toHaveCount(1);
  const visit=page.locator('#history-list').getByRole('button',{name:'다녀왔어요',exact:true});await visit.click();await expect(page.locator('#history-list button[aria-pressed=true]')).toHaveText('✓ 다녀왔어요');
  await page.locator('.service-nav a[href="#filters"]').click();await expect(page.locator('#pick')).toBeEnabled();const next=page.waitForRequest(r=>r.url().endsWith('/rpc/pick_restaurants'));await page.locator('#pick').click();expect((await next).postDataJSON().p_filter.excludedRestaurantIds).toContain(restaurant);
  await page.locator('.service-nav a[href="#account"]').click();await page.locator('#logout').click();await signupMember(page,'history-other@example.test');await page.getByRole('tab',{name:'추천·방문 기록'}).click();await expect(page.locator('#history-status')).toContainText('아직 기록이 없어요');await expect(page.locator('#history-list .history-card')).toHaveCount(0);
});

test('my information changes the password only after matching confirmation and reauthentication',async({page})=>{
  const email='password-new@example.test';await signupMember(page,email);await page.locator('.account-details > summary').filter({hasText:'비밀번호 변경'}).click();
  await page.locator('#password-current').fill('wrong-password');await page.locator('#password-new').fill('new-secure-password');await page.locator('#password-confirm').fill('mismatched-password');await page.locator('#password-save').click();await expect(page.locator('#password-status')).toHaveText('새 비밀번호가 일치하지 않습니다.');
  await page.locator('#password-confirm').fill('new-secure-password');await page.locator('#password-save').click();await expect(page.locator('#password-status')).toHaveText('현재 비밀번호를 확인해 주세요.');
  await page.locator('#password-current').fill('test-password');await page.locator('#password-save').click();await expect(page.locator('#password-status')).toHaveText('비밀번호를 변경했습니다.');
  await page.locator('#logout').click();await page.locator('#auth-email').fill(email);await page.locator('#auth-password').fill('test-password');await page.locator('#auth-submit').click();await expect(page.locator('#auth-status')).toHaveText('이메일과 비밀번호를 확인해 주세요.');
  await page.locator('#auth-password').fill('new-secure-password');await page.locator('#auth-submit').click();await expect(page.locator('#member-box')).toBeVisible();
});

test('customer center accepts private inquiries and the owner sees an administrator reply',async({page,browser})=>{
  await signupMember(page,'support-new@example.test');await page.locator('.site-footer a[href="#support"]').click();
  await expect(page.locator('#support-body')).toHaveAttribute('placeholder','문제 상황을 알려주세요. 비밀번호는 적지 마세요.');await page.locator('#support-category').selectOption('bug');await page.locator('#support-subject').fill('고객센터 답변 테스트');await page.locator('#support-body').fill('<img src=x onerror=alert(1)> 추천 화면 문의');await page.locator('#support-submit').click();await expect(page.locator('#support-status')).toContainText('문의를 접수했습니다.');
  const context=await browser.newContext(),staff=await context.newPage();
  try{
    await staff.route('https://oapi.map.naver.com/**',r=>r.abort());await login(staff,'admin@example.test');await staff.locator('#admin-link').click();
    const ticket=staff.locator('#admin-support-list .support-card').filter({hasText:'고객센터 답변 테스트'});await ticket.locator('summary').click();await ticket.getByRole('textbox',{name:'고객센터 답변'}).fill('오류를 확인하고 수정했습니다.');await ticket.getByRole('button',{name:'답변 보내기'}).click();await expect(staff.locator('#admin-support-status')).toHaveText('답변을 저장했습니다.');
    await page.locator('#support-reload').click();const own=page.locator('#support-list .support-card').filter({hasText:'고객센터 답변 테스트'});await expect(own).toContainText('답변 완료');await own.locator('summary').click();await expect(own.locator('.support-reply')).toContainText('오류를 확인하고 수정했습니다.');await expect(own.locator('img')).toHaveCount(0);
  }finally{await context.close();}
});

test('AI failures and invalid input do not consume usage, while 몰라 아무거나 produces a charged successful result',async({page})=>{
  await signupMember(page,'ai-success-new@example.test');await page.locator('.service-nav a[href="#filters"]').click();await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 20/20회');
  for(const text of ['ㅋㅋㅋㅋ','오늘 날씨 알려줘','존재하지않는메뉴 먹고싶어','테스트 오류 국밥']){
    await page.locator('#chat-reset').click();await page.locator('#chat-input').fill(text);const completed=page.waitForResponse(r=>r.url().includes('/functions/v1/ai-recommend'));await page.locator('#chat-send').click();await completed;await expect(page.locator('#chat-status')).not.toHaveText('원하는 메뉴를 찾고 있어요.');await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 20/20회');
  }
  await page.locator('#chat-reset').click();await page.locator('#chat-input').fill('몰라 아무거나');await page.locator('#chat-send').click();await expect(page.locator('.restaurant-card:visible')).toHaveCount(3);await expect(page.locator('#ai-quota')).toHaveText('오늘 남은 AI 추천 19/20회');await expect(page.locator('#success-toast')).toBeVisible();
});

test('withdrawal blocks member use, hides posts, restores the same account within seven days and protects the master',async({page,browser})=>{
  const email='withdraw-new@example.test';await signupMember(page,email,async()=>{await page.locator('#onboarding-taste-categories .taste-row').filter({hasText:'일식'}).getByRole('button',{name:/좋아요/}).click();});
  await page.locator('.service-nav a[href="#community"]').click();await page.locator('#post-compose').click();await page.locator('#post-title').fill('7일 복원 테스트 글');await page.locator('#post-body').fill('복원 후 유지되는 본문');await page.locator('#post-save').click();await expect(page.locator('#post-status')).toHaveText('게시글을 저장했습니다.');
  await page.locator('.service-nav a[href="#account"]').click();await page.locator('.account-danger > summary').click();await expect(page.locator('#account-delete-form')).toBeVisible();await page.locator('#account-delete-password').fill('wrong-password');await page.locator('#account-delete-confirm').check();await page.locator('#account-delete').click();await expect(page.locator('#account-delete-status')).toHaveText('현재 비밀번호를 확인해 주세요.');await expect(page.locator('#member-box')).toBeVisible();
  await page.locator('#account-delete-password').fill('test-password');await page.locator('#account-delete').click();await expect(page.locator('#auth-box')).toBeVisible();await expect(page.locator('#auth-status')).toContainText('7일 안에 로그인');
  const guestContext=await browser.newContext(),guest=await guestContext.newPage();
  try{
    await guest.route('https://oapi.map.naver.com/**',r=>r.abort());await guest.addInitScript(()=>localStorage.setItem('bob-pick:help-seen:v1','1'));await guest.goto('/#community');await guest.locator('#post-search').fill('7일 복원 테스트 글');await expect(guest.locator('#post-list .post-card')).toHaveCount(0);
    await page.locator('#auth-email').fill(email);await page.locator('#auth-password').fill('test-password');await page.locator('#auth-submit').click();await expect(page.locator('#account-recovery-box')).toBeVisible();await expect(page.locator('#member-box')).toBeHidden();await expect(page.locator('#account-recovery-deadline')).toContainText('까지 복원');
    await page.locator('.service-nav a[href="#favorites"]').click();await expect(page).toHaveURL(/#account$/);await expect(page.locator('#account-recovery-box')).toBeVisible();
    await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'build/account-restore-mobile.png',fullPage:true});
    await page.route('**/rpc/account_recovery_status',async route=>{const response=await route.fetch(),state=await response.json();await route.fulfill({response,json:{...state,canRestore:false}});});
    await page.reload();await expect(page.locator('#account-restore-form')).toBeHidden();await expect(page.locator('#account-recovery-title')).toHaveText('복원 기간이 지났어요');
    await page.locator('.site-footer a[href="#privacy"]').click();await expect(page.locator('[data-legal-document="privacy"]')).toContainText('탈퇴 신청 후 7일');await expect(page.getByRole('columnheader',{name:'보관 기간',exact:true})).toBeVisible();await expect(page.locator('[data-legal-document="privacy"]')).toContainText('최근 30일');
    await page.unroute('**/rpc/account_recovery_status');await page.goto('/#account');await page.reload();await expect(page.locator('#account-restore-form')).toBeVisible();
    await page.locator('#account-restore-password').fill('wrong-password');await page.locator('#account-restore').click();await expect(page.locator('#account-restore-status')).toHaveText('현재 비밀번호를 확인해 주세요.');
    await page.locator('#account-restore-password').fill('test-password');await page.locator('#account-restore').click();await expect(page.locator('#member-box')).toBeVisible();await expect(page.locator('#member-status')).toHaveText('계정을 복원했습니다.');await expect(page.locator('#account-recovery-box')).toBeHidden();
    await page.getByRole('tab',{name:'내 취향',exact:true}).click();await expect(page.locator('#member-taste-categories .taste-row').filter({hasText:'일식'}).getByRole('button',{name:/좋아요/})).toHaveAttribute('aria-pressed','true');
    await guest.locator('#post-reload').click();await expect(guest.locator('#post-list .post-card')).toHaveCount(1);
    await page.getByRole('tab',{name:'내 정보',exact:true}).click();await page.locator('#logout').click();await login(page,'master@example.test');await page.locator('.account-danger > summary').click();await expect(page.locator('#account-delete-reason')).toHaveText('마스터 계정은 탈퇴할 수 없습니다.');await expect(page.locator('#account-delete-form')).toBeHidden();
  }finally{await guestContext.close();}
});

test('account preferences, history and customer center fit mobile screens and preserve keyboard navigation',async({page})=>{
  await signupMember(page,'mobile-settings@example.test');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    for(const name of ['내 정보','내 취향','추천·방문 기록']){await page.getByRole('tab',{name,exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(width===390)await page.screenshot({path:'build/account-'+name+'-mobile.png',fullPage:true});}
    await page.locator('.site-footer a[href="#support"]').click();await expect(page.locator('#support-panel')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('.service-nav a[href="#account"]').click();
  }
  await page.getByRole('tab',{name:'내 정보',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('tab',{name:'내 취향',exact:true})).toHaveAttribute('aria-selected','true');
});

test('skipping the post-signup preference step is remembered and both main-page shortcuts open My Taste without toggling its checkbox',async({page})=>{
  const email='taste-later@example.test';await signupMember(page,email);
  const ready=page.waitForResponse(r=>r.url().endsWith('/rpc/my_food_preferences'));await page.reload();expect((await (await ready).json()).onboardingComplete).toBe(true);await expect(page.locator('#taste-onboarding')).not.toBeVisible();
  await page.locator('#logout').click();const signedIn=page.waitForResponse(r=>r.url().endsWith('/rpc/my_food_preferences'));await login(page,email);expect((await (await signedIn).json()).onboardingComplete).toBe(true);
  await expect(page.locator('#taste-onboarding')).not.toBeVisible();
  for(const width of [1280,390,320]){
    await page.setViewportSize({width,height:844});await page.locator('.service-nav a[href="#filters"]').click();
    for(const prefix of ['manual','chat']){
      const row=page.locator('#'+prefix+'-taste-row'),checkbox=page.locator('#'+prefix+'-taste');await checkbox.uncheck();
      const distance=await row.evaluate(node=>Math.abs(node.querySelector('label')!.getBoundingClientRect().top-node.querySelector('a')!.getBoundingClientRect().top));expect(distance).toBeLessThan(12);
      await row.getByRole('link',{name:'내 취향 설정 →'}).click();await expect(page).toHaveURL(/#account$/);await expect(page.getByRole('tab',{name:'내 취향',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('#taste-form')).toBeVisible();await expect(page.locator('#taste-onboarding')).not.toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.locator('.service-nav a[href="#filters"]').click();await expect(checkbox).not.toBeChecked();
    }
  }
});

test('email confirmation postpones preference collection until the first signed-in session',async({page})=>{
  const email='confirm-taste@example.test';await page.route('**/auth/v1/signup**',async route=>{const response=await route.fetch(),packet=await response.json();await route.fulfill({response,json:packet.user});});
  await page.goto('/#account');await page.locator('[data-auth-mode="signup"]').click();await page.locator('#auth-email').fill(email);await page.locator('#auth-password').fill('test-password');await page.locator('#auth-password-confirm').fill('test-password');await page.locator('#auth-nickname').fill('가입 후 취향');
  await page.locator('#auth-submit').click();await expect(page.locator('#auth-status')).toContainText('가입 확인 링크');await expect(page.locator('#taste-onboarding')).not.toBeVisible();await expect(page.locator('#auth-box')).toBeVisible();
  await login(page,email);await expect(page.locator('#taste-onboarding')).toBeVisible();await expect(page.locator('#taste-onboarding-heading')).toBeFocused();
  await page.goto('/');await expect(page.locator('#account-panel')).toBeHidden();await expect(page.locator('body > #taste-onboarding')).toBeVisible();
  await page.setViewportSize({width:320,height:700});expect(await page.locator('#taste-onboarding').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
  await page.screenshot({path:'build/post-signup-taste-mobile.png'});
  await page.locator('#onboarding-taste-categories .taste-row').filter({hasText:'일식'}).getByRole('button',{name:/좋아요/}).click();await page.locator('#onboarding-save').click();await expect(page.locator('#taste-onboarding')).not.toBeVisible();
  await page.locator('#manual-taste-row [data-taste-settings]').click();await expect(page.locator('#member-taste-categories .taste-row').filter({hasText:'일식'}).getByRole('button',{name:/좋아요/})).toHaveAttribute('aria-pressed','true');
  const ready=page.waitForResponse(r=>r.url().endsWith('/rpc/my_food_preferences'));await page.reload();expect((await (await ready).json()).onboardingComplete).toBe(true);await expect(page.locator('#taste-onboarding')).not.toBeVisible();
});
