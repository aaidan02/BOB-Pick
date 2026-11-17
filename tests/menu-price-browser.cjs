const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');

async function main(){
 const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'bob-menu-price-'));
 const csvPath=path.join(folder,'data.csv');
 const prepared=spawnSync('python3',['-c',String.raw`
import csv,sys
with open('관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv',encoding='cp949',newline='') as f:
 reader=csv.DictReader(f);columns=reader.fieldnames
 row=next(r for r in reader if r['음식점아이디']=='16122')
with open(sys.argv[1],'w',encoding='cp949',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=columns);writer.writeheader();writer.writerow(row)
`,csvPath],{cwd:root,encoding:'utf8'});
 assert.equal(prepared.status,0,prepared.stderr);
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
 const port=listener.address().port;await new Promise(r=>listener.close(r));
 const server=spawn('java',['-cp','build','FoodPickerWeb',csvPath,String(port)],{cwd:root});server.stdin.end();
 let output='',browser;server.stdout.on('data',x=>output+=x);server.stderr.on('data',x=>output+=x);
 try{
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let i=0;i<120;i++){
   if(server.exitCode!==null)throw new Error(output);
   try{ready=(await fetch(base+'/api/count?time=all')).ok;}catch{}
   if(ready)break;await new Promise(r=>setTimeout(r,50));
  }
  assert(ready,output);
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900},timezoneId:'Asia/Seoul'}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://oapi.map.naver.com/**',route=>route.abort());
  await page.goto(base);
  const count=async value=>page.waitForFunction(value=>document.getElementById('count').textContent.includes('조건에 맞는 '+value+'곳'),value);
  async function pick(){
   const pending=page.waitForResponse(r=>/\/api\/picks?\?/.test(r.url()));await page.locator('#pick').click();
   const response=await pending;
   const data=response.headers()['content-type'].includes('json')?(await response.json()).restaurants[0]:Object.fromEntries(new URLSearchParams(await response.text()));
   await page.waitForFunction(name=>document.getElementById('menu').textContent===name&&!document.getElementById('result').hidden,data._menu);
   return data;
  }
  await count(1);await pick();
  assert.deepEqual(await page.locator('#matching-menus li').allTextContents(),[
   '소국밥 · 7,000원','한우 육사시미 · 변동가격','매운소갈비찜 중 · 변동가격','한우 육회 · 7,000원',
   '특 내장탕 · 17,000원','한우 설렁탕 · 가격 표시 없음','소머리수육 · 가격 표시 없음'
  ]);
  await page.locator('#form').selectOption('찜·삶음');await count(1);
  const seen=new Set();
  for(let i=0;i<2;i++){
   const data=await pick();seen.add(data._menu);
   assert.equal(await page.locator('#price').textContent(),data._priceLabel||'가격 표시 없음');
   assert.equal(data._price,'');
  }
  assert.deepEqual(seen,new Set(['매운소갈비찜 중','소머리수육']));
  console.log('PASS: 실제 태평소국밥 앞 5개 가격 연결, 변동가격 숫자 미사용, 뒤 2개 가격 표시 없음, 카드·메뉴 목록 표시');
  await page.locator('#min').fill('0');await count(0);assert(await page.locator('#pick').isDisabled());
  await page.locator('#form').selectOption('국·탕·찌개');
  await page.locator('#min').fill('17000');await page.locator('#max').fill('17000');await count(1);
  assert.equal((await pick())._menu,'특 내장탕');assert.equal(await page.locator('#price').textContent(),'17,000원');
  console.log('PASS: 변동·누락 가격 메뉴는 가격 조건에서 제외, 숫자로 연결한 메뉴는 가격·형태 교집합으로 추천');
  let aiData;
  for(let i=0;i<4;i++){
   const query=new URLSearchParams({time:'all',form:'찜·삶음'});
   if(aiData){query.set('previous','16122');query.set('previousMenu',aiData._menuIndex);}
   aiData=Object.fromEntries(new URLSearchParams(await (await fetch(base+'/api/pick?'+query)).text()));
   if(aiData._priceLabel)break;
  }
  assert.equal(aiData._priceLabel,'변동가격');
  await page.route('**/api/chat',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({count:1,restaurants:[aiData],needsClarification:false,message:'요청에 맞는 메뉴를 골랐어요.'})}));
  await page.locator('#chat-input').fill('태평소국밥 갈비찜 추천해줘');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/chat'));await page.locator('#chat-send').click();await response;
  await page.waitForFunction(()=>document.getElementById('results-grid').dataset.source==='chat');
  assert.equal(await page.locator('#price').textContent(),'변동가격');
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,'build','menu-price-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: AI 결과에서도 변동가격 표시, 모바일 배치·브라우저 오류 없음 (AI 응답은 로컬 대역)');
 }finally{
  if(browser)await browser.close();server.kill('SIGTERM');
  await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));fs.rmSync(folder,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
