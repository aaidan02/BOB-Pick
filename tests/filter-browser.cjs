const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),net=require("node:net");
const {spawn,spawnSync}=require("node:child_process");
const root=path.resolve(__dirname,"..");
const sdk=String.raw`
window.calls=[];
window.naver={maps:{
 LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},
 Map:class{setCenter(){}setZoom(){}},
 Marker:class{constructor(options){this.record={...options,removed:false};delete this.record.map;window.calls.push(this.record);}setMap(value){this.record.removed=value===null;}}
}};
`;
async function main(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"bob-filter-browser-"));
 const csvPath=path.join(folder,"sample.csv");
 const fixture=String.raw`
import csv,sys
columns=['음식점아이디','음식점명','대표메뉴명','주소','상세주소','위도','경도','업종정보','메뉴한글명','메뉴금액','최종대조판정','영업 시간대','음식 종류','음식 형태']
cases=[
['noodle','국수 식당','칼국수','대전','','36.35','127.38','한식',"['공깃밥'; '칼국수']",'[1000,9000]','미확정'],
['rice','밥 식당','비빔밥','대전','','36.36','127.39','한식','[비빔밥]','[8000]','미확인'],
['cafe','커피 식당','아메리카노','대전','','36.35','127.38','카페·디저트','[아메리카노]','[4000]','미확정'],
['dessert','디저트 식당','마카롱','대전','','36.35','127.38','카페·디저트','[마카롱]','[2500]','미확정'],
['pizza','피자 식당','치즈피자','대전','','36.35','127.38','양식','[치즈피자R]','[16000]','미확정'],
['unknown','미등록 식당','특별메뉴','대전','','36.35','127.38','기타','','','미확정'],
['fried','일식 식당','돈까스','대전','','36.35','127.38','일식','[돈까스]','[12000]','미확인'],
['grill','고깃집','삼겹살','대전','','36.35','127.38','한식','[삼겹살,냉면,비빔냉면 <img src=x onerror=alert(1)>,공깃밥]','[12000,5000,5500,1000]','미확정'],
['closed','폐업 식당','칼국수','대전','','36.35','127.38','한식','[칼국수]','[1000]','폐업']]
tags={'noodle':('한식','면 | 밥'),'rice':('한식','밥'),'cafe':('카페·디저트','음료'),'dessert':('카페·디저트','디저트'),'pizza':('양식 | 피자','빵'),'unknown':('기타','미분류'),'fried':('일식','튀김'),'grill':('한식','면 | 밥 | 구이'),'closed':('한식','면')}
for row in cases:
 row.append(' | '.join(day+'=00:00~24:00' for day in '월화수목금토일'))
 row.extend(tags[row[0]])
with open(sys.argv[1],'w',encoding='cp949',newline='') as f:
 writer=csv.writer(f);writer.writerow(columns);writer.writerows(cases)
`;
 const prepared=spawnSync("python3",["-c",fixture,csvPath],{encoding:"utf8"});
 assert.equal(prepared.status,0,prepared.stderr);
 const listener=net.createServer();await new Promise(r=>listener.listen(0,"127.0.0.1",r));
 const port=listener.address().port;await new Promise(r=>listener.close(r));
 const processServer=spawn("java",["-cp","build","FoodPickerWeb",csvPath,String(port)],{cwd:root});
 processServer.stdin.end();
 let output="";processServer.stdout.on("data",x=>output+=x);processServer.stderr.on("data",x=>output+=x);
 let browser;
 try{
  const url="http://127.0.0.1:"+port;
  let ready=false;
  for(let i=0;i<150;i++){
   if(processServer.exitCode!==null)throw new Error(output);
   try{ready=(await fetch(url+"/api/count")).ok;}catch{}
   if(ready)break;await new Promise(r=>setTimeout(r,50));
  }
  assert(ready,output);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
  const errors=[];
  async function pageWith(fail=false,viewport={width:1280,height:1000}){
   const page=await browser.newPage({viewport});page.on("pageerror",e=>errors.push(e.message));
   await page.route("https://oapi.map.naver.com/**",route=>fail?route.abort():route.fulfill({contentType:"text/javascript",body:sdk}));
   await page.goto(url);
   await page.waitForFunction(()=>!document.getElementById("pick").disabled);
   return page;
  }
  async function count(page,n){
   await page.waitForFunction(n=>document.getElementById("count").textContent.includes("조건에 맞는 "+n+"곳"),n);
  }
  async function pick(page){
   const response=page.waitForResponse(r=>/\/api\/picks?\?/.test(r.url()));
   await page.locator("#pick").click();
   const result=await response;
   const fields=result.headers()["content-type"].includes("json")?new URLSearchParams((await result.json()).restaurants[0]):new URLSearchParams(await result.text());
   await page.waitForFunction(({name,menu})=>document.getElementById("name").textContent===name&&document.getElementById("menu").textContent===menu,{name:fields.get("음식점명"),menu:fields.get("_menu")||"메뉴 정보가 없어요"});
   return fields;
  }
  const page=await pageWith();
  await count(page,8);
  for(const id of ["min","max","category","form"])assert.equal(await page.locator("#"+id).inputValue(),"");
  assert.equal(await page.locator("#category option").count(),7);
  assert.equal(await page.locator("#form option").count(),9);
  assert.deepEqual(await page.locator("#category option").evaluateAll(xs=>xs.map(x=>x.value)),["","한식","양식","일식","카페·디저트","기타","피자"]);
  await page.waitForFunction(()=>window.calls);
  const first=await pick(page);
  assert.equal(await page.locator("#price").textContent(),first.get("_price")?Number(first.get("_price")).toLocaleString("ko-KR")+"원":"가격 표시 없음");
  let calls=await page.evaluate(()=>window.calls);
  assert.equal(calls.at(-1).title,first.get("음식점명"));
  assert.equal(calls.at(-1).position.lat,Number(first.get("위도")));
  console.log("PASS: 기본 랜덤, 전체 8곳, CSV의 종류·형태 선택지, 표시 메뉴·가격과 지도 일치");
  await page.locator("#category").selectOption("한식");
  await page.locator("#form").selectOption("밥");
  await count(page,3);
  await page.locator("#form").selectOption("면");await count(page,2);
  await page.locator("#min").fill("9000");await page.locator("#max").fill("9000");await count(page,1);
  const noodle=await pick(page);assert.equal(noodle.get("음식점아이디"),"noodle");
  assert.equal(noodle.get("_forms"),"면 · 밥");
  await page.locator("#reset").click();await count(page,8);
  await page.locator("#category").selectOption("한식");
  assert(await page.locator("#result").isHidden());
  assert((await page.evaluate(()=>window.calls)).every(x=>x.removed));
  await page.locator("#form").selectOption("밥");
  await page.locator("#min").fill("8000");
  await page.locator("#max").fill("8500");
  await count(page,1);
  const selected=await pick(page);
  assert.equal(selected.get("음식점아이디"),"rice");
  assert.equal(await page.locator("#price").textContent(),"8,000원");
  assert(await page.locator("#pick").isEnabled());
  assert((await page.locator("#status").textContent()).includes("1곳"));
  console.log("PASS: 가격+종류+형태 교집합, 이전 결과·마커 제거, 단일 후보 안내");
  await page.locator("#reset").click();await count(page,8);
  await page.locator("#category").selectOption("한식");
  await page.locator("#form").selectOption("면");
  await page.locator("#min").fill("5000");await page.locator("#max").fill("6000");await count(page,1);
  const grill=await pick(page);
  assert.equal(grill.get("음식점아이디"),"grill");
  assert.notEqual(grill.get("_menu"),grill.get("대표메뉴명"));
  assert.equal(grill.get("_matchedMenuCount"),"2");
  assert.equal(await page.locator("#matching-menus li").count(),2);
  assert.equal(await page.locator("#matching-menus img").count(),0);
  assert((await page.locator("#matching-menus").textContent()).includes("냉면 · 5,000원"));
  assert(!((await page.locator("#matching-menus").textContent()).includes("삼겹살")));
  assert(await page.locator("#pick").isEnabled());
  assert.equal(await page.locator("#pick").textContent(),"새로고침");
  const other=await pick(page);
  assert.equal(other.get("음식점아이디"),"grill");
  assert.notEqual(other.get("_menuIndex"),grill.get("_menuIndex"));
  assert.equal(await page.locator("#price-source").count(),0);
  assert.equal(await page.locator("#menu").textContent(),other.get("_menu"));
  assert.equal(await page.locator("#price").textContent(),Number(other.get("_price")).toLocaleString("ko-KR")+"원");
  assert.equal(await page.locator("#tags").textContent(),"한식 / 면");
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1280,height:1000});
  console.log("PASS: 전체 메뉴에서 비대표 메뉴 추천, 같은 메뉴의 형태·가격 일치, 목록 표시와 한 가게의 다른 메뉴 재추첨");
  await page.locator("#reset").click();await count(page,8);
  for(const id of ["min","max","category","form"])assert.equal(await page.locator("#"+id).inputValue(),"");
  assert(await page.locator("#pick").isEnabled());
  await page.locator("#min").fill("0");await count(page,7);
  await page.locator("#max").fill("1000");
  await page.locator("#form").selectOption("면");await count(page,0);
  assert(await page.locator("#pick").isDisabled());
  assert((await page.locator("#status").textContent()).includes("조건에 맞는 음식점이 없습니다"));
  await page.locator("#min").fill("10000");
  await page.waitForFunction(()=>document.getElementById("status").textContent.includes("최소 가격"));
  assert(await page.locator("#pick").isDisabled());
  console.log("PASS: 조건 초기화, 가격 미확인 처리, 반찬 가격 오용 방지, 빈 결과·잘못된 가격 안내");
  await page.locator("#reset").click();await count(page,8);
  let release,intercept;
  const gate=new Promise(r=>release=r),seen=new Promise(r=>intercept=r);
  const handler=async route=>{
   const response=await route.fetch();intercept();await gate;
   try{await route.fulfill({response});}catch{}
  };
  await page.route("**/api/pick?**",handler);
  await page.locator("#pick").click();await seen;
  await page.locator("#category").selectOption("피자");
  release();await count(page,1);
  assert(await page.locator("#result").isHidden());
  await page.unroute("**/api/pick?**",handler);
  const pizza=await pick(page);assert.equal(pizza.get("음식점아이디"),"pizza");
  assert.equal(await page.locator("#price").textContent(),"16,000원");
  console.log("PASS: 추첨 응답 대기 중 조건 변경 시 오래된 결과 표시 방지");
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,"build","filters-mobile.png"),fullPage:true});
  await page.setViewportSize({width:1280,height:1000});
  await page.screenshot({path:path.join(root,"build","filters-desktop.png"),fullPage:true});
  const failed=await pageWith(true);
  await failed.locator("#category").selectOption("카페·디저트");
  await failed.locator("#form").selectOption("음료");await count(failed,1);
  const coffee=await pick(failed);assert.equal(coffee.get("음식점아이디"),"cafe");
  assert.equal(await failed.locator("#link").getAttribute("href"),"/directions?restaurant="+encodeURIComponent(coffee.get("음식점아이디")));
  assert((await failed.locator("#map-status").textContent()).includes("지도 연결 실패"));
  assert.deepEqual(errors,[]);
  console.log("PASS: 모바일 가로 넘침 없음, 지도 SDK 실패 시 필터·추천·지도 링크 유지");
 }finally{
  if(browser)await browser.close();
  processServer.kill("SIGTERM");
  await new Promise(r=>{if(processServer.exitCode!==null)r();else processServer.once("exit",r);});
  fs.rmSync(folder,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
