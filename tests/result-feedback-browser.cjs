const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
async function main(){
 const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'bob-feedback-')),csv=path.join(folder,'data.csv');
 const fixture=spawnSync('python3',['-c',String.raw`
import csv,sys
with open(sys.argv[1],'w',encoding='cp949',newline='') as f:
 w=csv.writer(f);w.writerow(['음식점아이디','음식점명','대표메뉴명','메뉴한글명','메뉴금액','음식 종류','음식 형태','위도','경도','영업 시간대'])
 hours=' | '.join(day+'=00:00~24:00' for day in '월화수목금토일')
 for i in range(6):w.writerow([str(i),'국수집 '+str(i),'냉면','[냉면,비빔냉면]','[5000,6000]','한식','면',str(36.35+i*.001),str(127.38+i*.001),hours])
`,csv],{encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const server=spawn('java',['-cp','build','FoodPickerWeb',csv,String(port)],{cwd:root});server.stdin.end();
 let output='';server.stdout.on('data',x=>output+=x);server.stderr.on('data',x=>output+=x);
 let browser,release;
 try{
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error(output);try{ready=(await fetch(base+'/api/count?time=all')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert(ready,output);
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900},timezoneId:'Asia/Seoul',reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://oapi.map.naver.com/**',r=>r.abort());
  let mode='success',seen;
  await page.route('**/api/chat',async route=>{
   if(mode==='error'){await route.fulfill({status:503,body:'AI 요청 실패'});return;}
   if(mode==='question'||mode==='empty'){
    await route.fulfill({contentType:'application/json',body:JSON.stringify({count:0,restaurants:[],needsClarification:mode==='question',message:mode==='question'?'언제 방문하시나요?':'조건에 맞는 음식점이 없어요.'})});return;
   }
   const query=new URLSearchParams(route.request().postData());query.delete('history');query.set('time','all');query.set('form','면');
   const response=await fetch(base+'/api/picks?'+query);assert(response.ok);const body=await response.json();body.message='추천을 완료했어요.';
   if(mode==='slow'){seen();await new Promise(r=>release=r);}
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.clock.install({time:new Date('2026-11-06T12:00:00+09:00')});await page.goto(base);
  await page.waitForFunction(()=>!document.getElementById('pick').disabled);
  await page.clock.pauseAt(new Date('2026-11-06T12:00:01+09:00'));
  const toast=page.locator('#success-toast');
  await page.evaluate(()=>{window.toastShownAt=[];const node=document.getElementById('success-toast');new MutationObserver(()=>{if(!node.hidden)window.toastShownAt.push(Date.now());}).observe(node,{attributes:true,attributeFilter:['hidden']});});
  async function top(){await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));assert.equal(await page.evaluate(()=>scrollY),0);}
  async function waitPaint(){await page.clock.runFor(70);}
  async function settled(test){
   for(let i=0;i<60;i++){await page.clock.runFor(20);if(await page.evaluate(test)){await waitPaint();return;}}
   throw new Error('화면 응답 처리가 완료되지 않았습니다.');
  }
  async function atResults(){
   const position=await page.locator('#results-grid').evaluate(node=>({top:node.getBoundingClientRect().top,viewport:innerHeight}));
   assert(position.top>=0&&position.top<position.viewport/2,'결과 영역 top='+position.top);assert((await page.evaluate(()=>scrollY))>100);
  }
  async function manual(){
   const done=page.waitForResponse(r=>/\/api\/picks?\?/.test(r.url()));await page.evaluate(()=>document.getElementById('pick').click());await done;await settled(()=>!document.getElementById('status').textContent.includes('고르는 중')&&!document.getElementById('result').hidden);
  }
  async function chat(text){
   const done=page.waitForResponse(r=>r.url().endsWith('/api/chat'));
   await page.evaluate(text=>{const input=document.getElementById('chat-input');input.value=text;input.dispatchEvent(new Event('input'));document.getElementById('chat-form').requestSubmit();},text);
   await done;await settled(()=>!document.getElementById('chat-status').textContent.includes('찾고 있어요'));
  }
  async function refresh(){const done=page.waitForResponse(r=>r.url().endsWith('/api/chat'));await page.evaluate(()=>document.getElementById('chat-refresh').click());await done;await settled(()=>!document.getElementById('chat-status').textContent.includes('찾고 있어요'));}
  await top();await manual();await atResults();assert(await toast.isHidden());
  console.log('PASS: 수동 단일 검색 성공 시 결과 영역으로 자동 스크롤, AI 성공 알림 없음');
  const filtered=page.waitForResponse(r=>r.url().includes('/api/count?')&&new URL(r.url()).searchParams.get('form')==='면');
  await page.evaluate(()=>{const form=document.getElementById('form');form.value='면';form.dispatchEvent(new Event('change'));});await page.clock.runFor(30);await filtered;await waitPaint();
  await top();await manual();await atResults();assert.equal(await page.locator('.restaurant-card:visible').count(),3);
  console.log('PASS: 수동 조건 검색의 세 가게 결과에도 자동 스크롤');

  await top();await chat('면 요리 추천해줘');await atResults();assert(await toast.isVisible());assert((await toast.textContent()).includes('성공!'));
  const style=await toast.evaluate(node=>{const s=getComputedStyle(node);return {position:s.position,color:s.backgroundColor,animation:s.animationName,right:node.getBoundingClientRect().right,bottom:node.getBoundingClientRect().bottom};});
  assert.equal(style.position,'fixed');assert.equal(style.color,'rgb(21, 128, 61)');assert.equal(style.animation,'none');assert(style.right<=1280&&style.right>1200);assert(style.bottom<=900&&style.bottom>840);
  const elapsed=await page.evaluate(()=>Date.now()-window.toastShownAt.at(-1));assert(elapsed<2800);await page.clock.fastForward(2800-elapsed);assert(await toast.isVisible());await page.clock.fastForward(300);assert(await toast.isHidden());
  console.log('PASS: AI 결과 자동 스크롤·우측 하단 초록색 성공 알림, 3초 후 자동 숨김·동작 줄이기 설정');

  await refresh();assert(await toast.isVisible());await page.clock.fastForward(1800);await refresh();
  await page.clock.fastForward(1400);assert(await toast.isVisible());await page.clock.fastForward(1700);assert(await toast.isHidden());
  console.log('PASS: 연속 성공 시 마지막 완료 시점부터 3초 유지');
  for(const value of ['error','question','empty']){
   mode=value;await top();await chat('다른 추천 '+value);assert(await toast.isHidden());assert.equal(await page.evaluate(()=>scrollY),0);
  }
  console.log('PASS: API 오류·추가 질문·빈 추천에는 성공 알림·결과 스크롤 없음');

  mode='success';await chat('다시 면 요리');await page.clock.fastForward(3100);
  mode='slow';const waiting=new Promise(r=>seen=r);
  await page.evaluate(()=>document.getElementById('chat-refresh').click());await waiting;
  await manual();await atResults();await top();const before=await page.locator('#result').getAttribute('data-restaurant-id');
  const ended=page.waitForResponse(r=>r.url().endsWith('/api/chat'));release();await ended;await waitPaint();
  assert.equal(await page.locator('#results-grid').getAttribute('data-source'),'manual');assert.equal(await page.locator('#result').getAttribute('data-restaurant-id'),before);assert.equal(await page.evaluate(()=>scrollY),0);assert(await toast.isVisible());
  console.log('PASS: 늦은 AI 완료는 성공 알림만 표시하고 최신 수동 결과·스크롤을 유지');

  mode='success';await page.setViewportSize({width:390,height:844});await chat('모바일 추천');await atResults();
  assert(await toast.isVisible());assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const rect=await toast.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=390&&rect.y+rect.height<=844);
  await page.screenshot({path:path.join(root,'build','result-feedback-mobile.png'),fullPage:false});
  await page.setViewportSize({width:1440,height:1000});await top();await refresh();await atResults();
  await page.screenshot({path:path.join(root,'build','result-feedback-desktop.png'),fullPage:false});
  assert.deepEqual(errors,[]);console.log('PASS: 모바일 스크롤과 알림 배치, 브라우저 오류 없음');
 }finally{if(release)release();if(browser)await browser.close();server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));fs.rmSync(folder,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
