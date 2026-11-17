const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const sdk=String.raw`
window.markerRecords=[];
window.naver={maps:{
 LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},
 LatLngBounds:class{constructor(){this.positions=[];}extend(p){this.positions.push(p);}},
 Map:class{setCenter(){}setZoom(){}fitBounds(bounds){window.boundsCount=bounds.positions.length;}},
 Marker:class{constructor(o){this.record={title:o.title,removed:false};window.markerRecords.push(this.record);}setMap(map){this.record.removed=map===null;}}
}};`;
async function main(){
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'bob-three-')),csv=path.join(dir,'sample.csv');
 const prepared=spawnSync('python3',['-c',String.raw`
import csv,sys
with open('관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv',encoding='cp949',newline='') as f:
 r=csv.DictReader(f);columns=r.fieldnames;original=next(x for x in r if x['음식점아이디']=='15779')
hours=' | '.join(x+'=00:00~24:00' for x in '월화수목금토일')
rows=[]
for i in range(6):
 rows.append({'음식점아이디':f'r{i}', '음식점명':f'국수 식당 {i}', '대표메뉴명':'비빔밥', '메뉴한글명':'[비빔밥,냉면,비빔냉면]', '메뉴금액':'[20000,5000,6000]', '음식 종류':'한식', '음식 형태':'밥 | 면', '위도':str(36.35+i*.001), '경도':str(127.38+i*.001), '주소':'대전', '최종대조판정':'미확정','영업 시간대':hours})
for i in range(2):
 rows.append({'음식점아이디':f'c{i} /?&', '음식점명':f'커피 {i} <img src=x onerror=alert(1)>', '대표메뉴명':'커피', '메뉴한글명':'[아메리카노]', '메뉴금액':'[4000]', '음식 종류':'카페·디저트','음식 형태':'음료','위도':'36.35','경도':'127.38','최종대조판정':'미확인','영업 시간대':hours})
original['영업 시간대']=hours;rows.append(original)
rows.append({**rows[0],'음식점아이디':'closed','최종대조판정':'폐업'})
with open(sys.argv[1],'w',encoding='cp949',newline='') as f:
 w=csv.DictWriter(f,fieldnames=columns);w.writeheader();w.writerows(rows)
`,csv],{cwd:root,encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr);
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const server=spawn('java',['-cp','build','FoodPickerWeb',csv,String(port)],{cwd:root});
 server.stdin.end();
 let output='';server.stdout.on('data',x=>output+=x);server.stderr.on('data',x=>output+=x);
 let browser;const releases=[];
 try{
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error(output);try{ready=(await fetch(base+'/api/count?time=all')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}
  assert(ready,output);
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Asia/Seoul'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-05T12:59:50+09:00')});
  await page.route('https://oapi.map.naver.com/**',r=>r.fulfill({contentType:'text/javascript',body:sdk}));
  const count=async n=>page.waitForFunction(n=>document.getElementById('count').textContent.includes('조건에 맞는 '+n+'곳'),n);
  const cards=page.locator('.restaurant-card:visible');
  const ids=()=>cards.evaluateAll(xs=>xs.map(x=>x.dataset.restaurantId));
  async function pick(){
   const response=page.waitForResponse(r=>/\/api\/picks?\?/.test(r.url()));await page.locator('#pick').click();
   const r=await response;assert(r.ok(),await r.text());
   const result=r.headers()['content-type'].includes('json')?await r.json():new URLSearchParams(await r.text());
   await page.waitForFunction(()=>!document.getElementById('status').textContent.includes('고르는 중'));
   return result;
  }
  await page.goto(base);await count(9);
  await pick();assert.equal(await cards.count(),1);assert.equal(await page.locator('.card-head:visible').count(),0);
  assert.equal(await page.locator('#results-grid').getAttribute('class'),'results-grid');
  console.log('PASS: 기본 현재 시각 그대로면 기존 단일 가게 추천');

  await page.locator('#form').selectOption('면');await count(6);
  await page.locator('#min').fill('5000');await page.locator('#max').fill('6000');await page.clock.runFor(250);await count(6);
  const first=await pick();assert.equal(first.restaurants.length,3);assert.equal(await cards.count(),3);
  const before=await ids();assert.equal(new Set(before).size,3);
  for(const item of first.restaurants){assert(['냉면','비빔냉면'].includes(item._menu));assert([5000,6000].includes(Number(item._price)));}
  assert.equal(await page.locator('.card-head:visible').count(),3);
  assert.equal(await page.evaluate(()=>window.boundsCount),3);
  assert.equal(await page.evaluate(()=>window.markerRecords.filter(m=>!m.removed).length),3);
  console.log('PASS: 조건 입력 시 중복 없는 3곳, 전체 메뉴의 형태·가격 교집합, 지도 마커 3개');

  const fixed=page.locator('[data-slot="1"]');await fixed.locator('.like').check();
  await fixed.evaluate(node=>window.fixedCard=node);const fixedHtml=await fixed.innerHTML();
  const markerCount=await page.evaluate(()=>window.markerRecords.length);
  await pick();const second=await ids();
  assert.equal(second[1],before[1]);assert(before.filter((_,i)=>i!==1).every(id=>!second.includes(id)));
  assert.equal(await fixed.innerHTML(),fixedHtml);assert(await fixed.evaluate(node=>node===window.fixedCard));
  assert.equal(await page.evaluate(()=>window.markerRecords.length),markerCount+2);
  assert.equal(await fixed.locator('.lock-state').textContent(),'고정됨');
  console.log('PASS: 체크한 카드의 위치·메뉴·가격·DOM·마커 유지, 나머지 두 곳만 새 가게로 교체');

  await page.locator('[data-slot="0"] .like').check();const twoFixed=await ids();
  await pick();const third=await ids();assert.deepEqual(third.slice(0,2),twoFixed.slice(0,2));assert.notEqual(third[2],twoFixed[2]);
  await page.locator('[data-slot="2"] .like').check();assert(await page.locator('#pick').isDisabled());
  await page.locator('[data-slot="0"] .like').uncheck();assert(await page.locator('#pick').isEnabled());
  const allBefore=await ids();await pick();const allAfter=await ids();assert.deepEqual(allAfter.slice(1),allBefore.slice(1));assert.notEqual(allAfter[0],allBefore[0]);
  console.log('PASS: 여러 가게 동시 고정, 전체 고정 시 새로고침 중지, 해제한 카드만 교체');

  const clockIds=await ids(),clockHtml=await fixed.innerHTML(),clockMarkers=await page.evaluate(()=>window.markerRecords.length);
  await page.clock.fastForward(20000);await count(6);
  assert.equal(await page.locator('#time').inputValue(),'13:00');assert.deepEqual(await ids(),clockIds);assert.equal(await fixed.innerHTML(),clockHtml);
  assert.equal(await page.evaluate(()=>window.markerRecords.length),clockMarkers);
  console.log('PASS: 자동 분 변경에도 3개 카드와 고정 상태·지도 유지');

  const failed=async route=>route.fulfill({status:503,body:'추천을 다시 시도해 주세요.'});
  await page.route('**/api/picks?**',failed);
  await page.locator('#pick').click();await page.waitForFunction(()=>document.getElementById('status').textContent.includes('다시 시도'));
  assert.deepEqual(await ids(),clockIds);assert(await fixed.locator('.like').isChecked());assert(await page.locator('#pick').isEnabled());
  await page.unroute('**/api/picks?**',failed);
  console.log('PASS: 새로고침 통신 실패 시 고정·기존 추천 보존 및 재시도');

  let release,seen;const gate=new Promise(r=>release=r),intercepted=new Promise(r=>seen=r);releases.push(release);
  const slow=async route=>{const response=await route.fetch();seen();await gate;try{await route.fulfill({response});}catch{}};
  await page.route('**/api/picks?**',slow);await page.locator('#pick').click();await intercepted;
  assert(await fixed.locator('.like').isDisabled());await page.locator('#category').selectOption('카페·디저트');
  await page.locator('#min').fill('');await page.locator('#max').fill('');await page.locator('#form').selectOption('');
  release();await page.unroute('**/api/picks?**',slow);await count(2);
  assert.equal(await cards.count(),0);assert.equal(await page.locator('.like:checked').count(),0);
  assert((await page.evaluate(()=>window.markerRecords)).every(m=>m.removed));
  await pick();assert.equal(await cards.count(),2);assert.equal(new Set(await ids()).size,2);assert.equal(await cards.locator('img').count(),0);
  await cards.nth(1).locator('.like').check();const cafeFixed=(await ids())[1];await pick();assert.equal((await ids())[1],cafeFixed);
  assert.equal(await page.locator('#status').textContent(),'조건에 맞는 가게가 2곳이라 2곳만 보여드려요.');
  assert((await cards.first().locator('.map-link').getAttribute('href')).includes('%2F%3F%26'));
  console.log('PASS: 대기 중 조건 변경의 늦은 응답 차단, 고정 초기화, 2곳만 추천, 특수 문자·HTML 안전 표시');

  await page.locator('#category').selectOption('일식');await page.locator('#form').selectOption('국·탕·찌개');await count(1);
  await pick();assert.equal(await cards.count(),1);assert.equal(await page.locator('#name').textContent(),'미향일식');assert.equal(await page.locator('#menu').textContent(),'대구탕');
  assert.equal(await page.locator('#price').textContent(),'30,000원');
  await page.locator('#reset').click();await count(9);await pick();assert.equal(await cards.count(),1);assert.equal(await page.locator('.like:checked').count(),0);
  await page.locator('#time-enabled').uncheck();await count(9);await pick();assert.equal(await cards.count(),1);
  await page.locator('#now').click();await count(9);await page.locator('#time').fill('14:00');await count(9);await pick();assert.equal(await cards.count(),3);
  console.log('PASS: 실제 미향일식 대구탕 검색, 초기화·시간 해제 시 기본 1곳, 방문 시각 직접 입력 시 3곳');

  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await cards.count(),3);await page.screenshot({path:path.join(root,'build','three-restaurants-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(root,'build','three-restaurants-desktop.png'),fullPage:true});
  await page.locator('#max').fill('1');await page.clock.runFor(250);await count(0);assert.equal(await cards.count(),0);assert(await page.locator('#pick').isDisabled());
  assert.deepEqual(errors,[]);console.log('PASS: 모바일 가로 넘침 없음, 0개 후보 처리, 브라우저 오류 없음');
 }finally{
  releases.forEach(r=>r());if(browser)await browser.close();server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
