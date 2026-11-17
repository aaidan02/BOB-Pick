const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),net=require("node:net");
const {spawn,spawnSync}=require("node:child_process");
const sdk=String.raw`
window.markers=[];
window.naver={maps:{
 LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},
 Map:class{setCenter(){}setZoom(){}},
 Marker:class{constructor(options){this.item={title:options.title,removed:false};window.markers.push(this.item);}setMap(value){this.item.removed=value===null;}}
}};
`;
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
async function main(){
 const root=path.resolve(__dirname,".."),folder=fs.mkdtempSync(path.join(os.tmpdir(),"bob-retention-")),csv=path.join(folder,"sample.csv");
 const prepared=spawnSync("python3",["-c",String.raw`
import csv,sys
columns=['음식점아이디','음식점명','대표메뉴명','주소','위도','경도','메뉴한글명','메뉴금액','음식 종류','음식 형태','영업 시간대']
hours=' | '.join(day+'=00:00~24:00' for day in '월화수목금토일')
with open(sys.argv[1],'w',encoding='cp949',newline='') as f:
 w=csv.writer(f);w.writerow(columns)
 w.writerow(['a','냉면 식당','냉면','대전','36.35','127.38','[냉면]','[5000]','한식','면',hours])
 w.writerow(['b','칼국수 식당','칼국수','대전','36.36','127.39','[칼국수]','[9000]','한식','면',hours])
`,csv],{encoding:"utf8"});assert.equal(prepared.status,0,prepared.stderr);
 const listener=net.createServer();await new Promise(r=>listener.listen(0,"127.0.0.1",r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const server=spawn("java",["-cp","build","FoodPickerWeb",csv,String(port)],{cwd:root});
 server.stdin.end();
 let output="";server.stdout.on("data",x=>output+=x);server.stderr.on("data",x=>output+=x);
 let browser;const releases=[];
 try{
  const url="http://127.0.0.1:"+port;let ready=false;
  for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error(output);try{ready=(await fetch(url+"/api/count?time=all")).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}
  assert(ready,output);
  browser=await chromium.launch({executablePath:"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
  const errors=[];
  async function createPage(time="2026-11-04T12:59:50+09:00"){
   const page=await browser.newPage({timezoneId:"Asia/Seoul"});
   page.on("pageerror",e=>errors.push(e.message));
   await page.clock.install({time:new Date(time)});
   await page.route("https://oapi.map.naver.com/**",r=>r.fulfill({contentType:"text/javascript",body:sdk}));
   return page;
  }
  const count=async(page,n)=>page.waitForFunction(n=>document.getElementById("count").textContent.includes("조건에 맞는 "+n+"곳"),n);
  async function load(page){await page.goto(url);await count(page,2);await page.waitForFunction(()=>window.markers);}
  async function pick(page){
   const response=page.waitForResponse(r=>/\/api\/picks?\?/.test(r.url()));await page.locator("#pick").click();
   const r=await response;
   const result=r.headers()["content-type"].includes("json")?new URLSearchParams((await r.json()).restaurants[0]):new URLSearchParams(await r.text());
   await page.waitForFunction(name=>!document.getElementById("result").hidden&&document.getElementById("name").textContent===name,result.get("음식점명"));
   return result;
  }
  async function unchanged(page,before,expected=1){
   assert(await page.locator("#result").isVisible());assert(await page.locator("#empty-pick").isHidden());
   assert.equal(await page.locator("#menu").textContent(),before.get("_menu"));
   assert.equal(await page.locator("#name").textContent(),before.get("음식점명"));
   assert.equal(await page.locator("#price").textContent(),Number(before.get("_price")).toLocaleString("ko-KR")+"원");
   const markers=await page.evaluate(()=>window.markers);
   assert.equal(markers.filter(m=>!m.removed).length,expected);assert(markers.some(m=>!m.removed&&m.title===before.get("음식점명")));
  }

  const page=await createPage();await load(page);const first=await pick(page);
  let remaining=1;
  await page.route("**/api/count*",r=>r.fulfill({contentType:"text/plain",body:String(remaining)}));
  await page.clock.fastForward(20000);await count(page,1);
  assert.equal(await page.locator("#time").inputValue(),"13:00");await unchanged(page,first);
  assert(await page.locator("#pick").isEnabled());assert.equal(await page.locator("#pick").textContent(),"다시 추천받기");
  remaining=0;await page.clock.fastForward(60000);await count(page,0);await unchanged(page,first);assert(await page.locator("#pick").isDisabled());
  assert.equal((await page.evaluate(()=>window.markers)).length,1);
  console.log("PASS: 분 변경과 후보 수 변경·0건 갱신 후에도 메뉴·가격·지도 마커 유지");
  await page.locator("#max").fill("1000");await page.clock.runFor(250);await count(page,0);
  assert(await page.locator("#result").isHidden());assert(await page.locator("#empty-pick").isVisible());
  assert((await page.evaluate(()=>window.markers)).every(m=>m.removed));
  console.log("PASS: 사용자가 조건을 직접 수정하면 이전 결과·마커 초기화");await page.close();

  const midnight=await createPage("2026-11-04T23:59:50+09:00");await load(midnight);const night=await pick(midnight);
  const midnightCount=midnight.waitForResponse(r=>r.url().includes("/api/count"));
  await midnight.clock.fastForward(20000);await midnightCount;
  assert.equal(await midnight.locator("#date").inputValue(),"2026-11-05");assert.equal(await midnight.locator("#time").inputValue(),"00:00");
  await unchanged(midnight,night);console.log("PASS: 자정 날짜 변경에도 추천 결과 유지");await midnight.close();

  const pending=await createPage();await load(pending);
  const held=gate(),seen=gate();releases.push(held.release);let pickFailures=0;
  pending.on("requestfailed",r=>{if(r.url().includes("/api/pick"))pickFailures++;});
  await pending.route("**/api/pick?**",async r=>{const response=await r.fetch();seen.release();await held.promise;await r.fulfill({response});});
  await pending.clock.fastForward(9000);
  const slowPick=pick(pending);slowPick.catch(()=>{});await seen.promise;
  await pending.clock.fastForward(7000);assert(await pending.locator("#pick").isDisabled());held.release();
  const delayed=await slowPick;await unchanged(pending,delayed);assert.equal(pickFailures,0);
  console.log("PASS: 추천 응답 대기 중 분이 바뀌어도 요청 취소·결과 소실 없음");await pending.close();

  const stale=await createPage();await load(stale);const old=await pick(stale);
  const staleHeld=gate(),staleSeen=gate(),staleDone=gate();releases.push(staleHeld.release);
  await stale.route("**/api/count*",async r=>{staleSeen.release();await staleHeld.promise;try{await r.fulfill({contentType:"text/plain",body:"0"});}catch{}finally{staleDone.release();}});
  await stale.clock.fastForward(20000);await staleSeen.promise;
  const fresh=await pick(stale);assert.notEqual(fresh.get("음식점아이디"),old.get("음식점아이디"));
  staleHeld.release();await staleDone.promise;await stale.clock.runFor(50);
  await unchanged(stale,fresh);await count(stale,2);assert(await stale.locator("#pick").isEnabled());
  console.log("PASS: 늦은 자동 후보 수 응답이 새 추천 결과·버튼 상태를 덮어쓰지 않음");await stale.close();

  const initial=await createPage();const initialHeld=gate(),initialSeen=gate();releases.push(initialHeld.release);
  await initial.route("**/api/count*",async r=>{
   if(new URL(r.request().url()).searchParams.get("time")==="all"){initialSeen.release();await initialHeld.promise;}
   try{await r.continue();}catch{}
  });
  await initial.goto(url);await initialSeen.promise;await initial.locator("#form").selectOption("면");await count(initial,2);
  const early=await pick(initial);initialHeld.release();
  await initial.waitForFunction(()=>document.getElementById("count").textContent.startsWith("전체 2곳"));
  await unchanged(initial,early,2);console.log("PASS: 최초 데이터 로딩 응답이 늦어도 이미 선택한 추천 유지");await initial.close();
  assert.deepEqual(errors,[]);
 }finally{
  releases.forEach(r=>r());if(browser)await browser.close();
  server.kill("SIGTERM");await new Promise(r=>server.exitCode!==null?r():server.once("exit",r));
  fs.rmSync(folder,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
