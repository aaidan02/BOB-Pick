const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
async function main(){
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'bob-chat-')),csv=path.join(dir,'data.csv');
 const fixture=spawnSync('python3',['-c',String.raw`
import csv,sys
columns=['음식점아이디','음식점명','대표메뉴명','메뉴한글명','메뉴금액','음식 종류','음식 형태','위도','경도','영업 시간대']
hours=' | '.join(x+'=00:00~24:00' for x in '월화수목금토일')
with open(sys.argv[1],'w',encoding='cp949',newline='') as f:
 w=csv.writer(f);w.writerow(columns)
 for i in range(6):w.writerow([f'r{i}',f'국수 식당 {i}','비빔밥','[비빔밥,냉면,비빔냉면]','[20000,5000,6000]','한식','밥 | 면','36.35','127.38',hours])
 w.writerow(['15779','미향일식','미향정식','[미향정식,대구탕]','[40000,30000]','일식','국·탕·찌개','36.36','127.39',hours])
`,csv],{encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const server=spawn('java',['-cp','build','FoodPickerWeb',csv,String(port)],{cwd:root});
 server.stdin.end();
 let output='';server.stdout.on('data',x=>output+=x);server.stderr.on('data',x=>output+=x);
 let browser;const releases=[];
 try{
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error(output);try{ready=(await fetch(base+'/api/count?time=all')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert(ready,output);
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'Asia/Seoul'}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-06T12:59:50+09:00')});
  await page.route('https://oapi.map.naver.com/**',r=>r.abort());
  let mode='ok',release,seen;
  await page.route('**/api/chat',async route=>{
   assert.equal(route.request().method(),'POST');
   const values=new URLSearchParams(route.request().postData()),history=JSON.parse(values.get('history'));requests.push({values,history});
   assert(history.some(m=>m.role==='user'));assert(!route.request().url().includes('key='));assert(!values.has('GEMINI_API_KEY'));
   if(mode==='fail'){await route.fulfill({status:503,body:'AI 연결에 실패했습니다. 다시 시도해 주세요.'});return;}
   if(mode==='question'){await route.fulfill({contentType:'application/json',body:JSON.stringify({count:0,restaurants:[],needsClarification:true,message:'몇 시쯤 방문하시나요?'})});return;}
   const query=new URLSearchParams(values);query.delete('history');query.set('time','all');
   const latest=history.filter(m=>m.role==='user').at(-1).text;
   query.set('form',latest.includes('대구탕')?'국·탕·찌개':'면');
   const response=await fetch(base+'/api/picks?'+query);assert(response.ok);const data=await response.json();data.needsClarification=false;data.message='요청에 맞는 '+data.restaurants.length+'곳을 골랐어요.';
   if(mode==='slow'){seen();await new Promise(r=>release=r);}
   try{await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});}catch{}
  });
  const cards=page.locator('.restaurant-card:visible'),ids=()=>cards.evaluateAll(xs=>xs.map(x=>x.dataset.restaurantId));
  const count=async n=>page.waitForFunction(n=>document.getElementById('count').textContent.includes('조건에 맞는 '+n+'곳'),n);
  const chatCount=async n=>page.waitForFunction(n=>document.getElementById('chat-count').textContent.includes('가게 '+n+'곳'),n);
  async function submit(text){
   await page.locator('#chat-input').fill(text);const response=page.waitForResponse(r=>r.url().endsWith('/api/chat'));
   await page.locator('#chat-send').click();await response;await page.waitForFunction(()=>!document.getElementById('chat-send').disabled||document.getElementById('chat-input').value==='');
   await page.waitForFunction(()=>!document.getElementById('chat-status').textContent.includes('찾고 있어요'));
  }
  async function refresh(){const response=page.waitForResponse(r=>r.url().endsWith('/api/chat'));await page.locator('#chat-refresh').click();await response;await page.waitForFunction(()=>!document.getElementById('chat-status').textContent.includes('찾고 있어요'));}
  async function manual(){
   const response=page.waitForResponse(r=>/\/api\/picks?\?/.test(r.url()));await page.locator('#pick').click();await response;
   await page.waitForFunction(()=>document.getElementById('results-grid').dataset.source==='manual'&&!document.getElementById('result').hidden&&!document.getElementById('status').textContent.includes('고르는 중'));
  }
  await page.goto(base);await count(7);
  assert.equal(await page.locator('#filters #chat-form').count(),0);
  assert.equal(await page.locator('#ai-chat #chat-form').count(),1);
  assert(!(await page.locator('#filters').innerText()).includes('AI로 추천받기'));
  await page.locator('#chat-input').fill('아직 전송하지 않은 문장');await manual();assert.equal(await cards.count(),1);assert.equal(requests.length,0);
  await page.locator('#form').selectOption('면');await count(6);await manual();assert.equal(await cards.count(),3);assert.equal(requests.length,0);
  console.log('PASS: 수동 검색과 AI 채팅 별도 영역, 수동 기본 1곳·조건 3곳, AI 호출 0회');

  await page.locator('#max').fill('1');await page.clock.runFor(250);await count(0);assert(await page.locator('#pick').isDisabled());
  await submit('만 원 이하로 면 요리를 추천해줘');assert.equal(await cards.count(),3);await chatCount(6);await count(0);
  assert.equal(new Set(await ids()).size,3);
  for(const name of ['min','max','category','form','date','time'])assert.equal(requests[0].values.has(name),false);
  assert(!(await page.locator('#pick').textContent()).includes('AI'));
  assert.equal(await page.locator('.chat-message.user').count(),1);assert.equal(await page.locator('.chat-message.assistant').count(),1);
  console.log('PASS: 수동 조건이 0건이어도 AI 채팅 사용 가능, 수동 필터·후보 수와 AI 요청 분리');

  await page.locator('[data-slot="1"] .like').check();const before=await ids(),fixedHtml=await page.locator('[data-slot="1"]').innerHTML();
  await refresh();const after=await ids();assert.equal(after[1],before[1]);assert.equal(await page.locator('[data-slot="1"]').innerHTML(),fixedHtml);
  assert(before.filter((_,i)=>i!==1).every(id=>!after.includes(id)));
  assert.equal(requests.at(-1).values.get('exclude0'),before[1]);assert.equal(requests.at(-1).values.get('size'),'2');
  const preserved=await ids();await page.locator('#max').fill('');await page.locator('#form').selectOption('');await count(7);
  assert.deepEqual(await ids(),preserved);assert(await page.locator('[data-slot="1"] .like').isChecked());
  const clockCalls=requests.length;await page.clock.fastForward(20000);await count(7);assert.deepEqual(await ids(),preserved);assert.equal(requests.length,clockCalls);
  for(let i=0;i<8;i++)await refresh();assert(requests.at(-1).history.some(message=>message.role==='user'));assert(requests.at(-1).history.length<=8);
  console.log('PASS: AI 고정·새로고침, 수동 조건 변경·분 변경에도 AI 카드 유지, 반복 재추천 후에도 사용자 대화 보존');

  const retryBefore=await ids();mode='fail';await refresh();assert.deepEqual(await ids(),retryBefore);
  assert((await page.locator('#chat-status').textContent()).includes('다시 시도'));assert(!(await page.locator('#status').textContent()).includes('AI 연결'));
  assert(await page.locator('#pick').isEnabled());mode='ok';
  await manual();assert.equal(await cards.count(),1);assert.equal(await page.locator('#results-grid').getAttribute('data-source'),'manual');
  assert((await page.locator('#chat-log').textContent()).includes('만 원 이하로 면'));
  await refresh();assert.equal(await cards.count(),3);assert.equal(await page.locator('#results-grid').getAttribute('data-source'),'chat');
  console.log('PASS: AI 오류 시 수동 검색 계속 사용, 수동 버튼은 항상 수동 요청, 별도 AI 재추천 버튼으로 전환');

  let notified;const pending=new Promise(r=>notified=r);seen=notified;mode='slow';await page.locator('#chat-refresh').click();await pending;
  const unblock=()=>release&&release();releases.push(unblock);
  assert(await page.locator('#pick').isEnabled());await manual();const manualIds=await ids();assert.equal(manualIds.length,1);
  unblock();mode='ok';await page.waitForFunction(()=>!document.getElementById('chat-refresh').disabled);
  assert.deepEqual(await ids(),manualIds);assert.equal(await page.locator('#results-grid').getAttribute('data-source'),'manual');
  console.log('PASS: AI 응답 대기 중 수동 검색 가능, 늦은 AI 응답은 최신 수동 결과를 덮어쓰지 않음');

  let releaseManual,manualSeen;
  const manualGate=new Promise(r=>releaseManual=r),manualReady=new Promise(r=>manualSeen=r);releases.push(()=>releaseManual());
  const slowManual=async route=>{const response=await route.fetch();manualSeen();await manualGate;try{await route.fulfill({response});}catch{}};
  await page.route('**/api/pick?**',slowManual);await page.locator('#pick').click();await manualReady;
  await submit('면 요리로 다시 추천해줘');const latestAiIds=await ids();releaseManual();
  await page.waitForFunction(()=>!document.getElementById('pick').disabled&&!document.getElementById('status').textContent.includes('고르는 중'));
  assert.deepEqual(await ids(),latestAiIds);assert.equal(await page.locator('#results-grid').getAttribute('data-source'),'chat');await page.unroute('**/api/pick?**',slowManual);
  console.log('PASS: 수동 응답 대기 중 AI 사용 가능, 늦은 수동 응답·상태가 AI 결과를 덮어쓰지 않음');

  await submit('그럼 대구탕으로 바꿔줘');assert.equal(await cards.count(),1);assert.equal(await page.locator('#menu').textContent(),'대구탕');assert.equal(await page.locator('#price').textContent(),'30,000원');
  assert.equal(await page.locator('.like:checked').count(),0);assert.equal(requests.at(-1).history.at(-1).text,'그럼 대구탕으로 바꿔줘');
  await page.locator('#reset').click();await count(7);assert.equal(await page.locator('#menu').textContent(),'대구탕');assert(await page.locator('#chat-log').isVisible());
  console.log('PASS: 후속 채팅·CSV 메뉴 가격, 수동 초기화는 AI 대화와 결과 유지');

  mode='question';await submit('내일 점심');assert.equal(await cards.count(),0);assert((await page.locator('#chat-log').textContent()).includes('몇 시쯤 방문하시나요?'));
  mode='ok';await submit('12시에 면 요리');assert.equal(await cards.count(),3);
  await page.locator('#chat-input').fill('<img src=x onerror=window.chatInjected=1> 면 요리');const composingCount=requests.length;
  await page.locator('#chat-input').dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(requests.length,composingCount);
  const submitted=page.waitForResponse(r=>r.url().endsWith('/api/chat'));await page.locator('#chat-input').press('Enter');await submitted;await page.waitForFunction(()=>!document.getElementById('chat-status').textContent.includes('찾고 있어요'));
  assert.equal(await page.locator('#chat-log img').count(),0);assert.equal(await page.evaluate(()=>window.chatInjected),undefined);
  console.log('PASS: 추가 질문, 한글 조합 중 Enter 전송 방지, 채팅 HTML 안전 표시');

  await manual();const resetBefore=await ids();await page.locator('#chat-reset').click();assert.deepEqual(await ids(),resetBefore);assert(await page.locator('#chat-log').isHidden());
  await submit('면 요리 추천해줘');await page.locator('[data-slot="1"] .like').check();
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,'build','manual-chat-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(root,'build','manual-chat-desktop.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: 대화 초기화는 수동 결과 유지, 모바일 두 영역 배치·브라우저 오류 없음');
 }finally{releases.forEach(r=>r());if(browser)await browser.close();server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
