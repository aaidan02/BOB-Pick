const {chromium}=require("playwright");
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),net=require("node:net");
const {spawn,spawnSync}=require("node:child_process");
async function main(){
 const root=path.resolve(__dirname,".."),folder=fs.mkdtempSync(path.join(os.tmpdir(),"bob-exact-time-")),csv=path.join(folder,"sample.csv");
 const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Seoul",hour:"2-digit",hourCycle:"h23"}).format(new Date()));
 const target=(hour+6)%24,start=String(target).padStart(2,"0")+":00",end=String(target+1).padStart(2,"0")+":00",manual=String(target).padStart(2,"0")+":30";
 const py=String.raw`
import csv,sys
d='월화수목금토일'
columns=['음식점아이디','음식점명','대표메뉴명','주소','위도','경도','업종정보','메뉴한글명','메뉴금액','최종대조판정','영업 시간대','음식 종류','음식 형태']
all_hours=' | '.join(x+'=00:00~24:00' for x in d)
manual=' | '.join(x+'='+sys.argv[2]+'~'+sys.argv[3] for x in d)
closed=' | '.join(x+'=휴무' for x in d)
with open(sys.argv[1],'w',encoding='cp949',newline='') as f:
 w=csv.writer(f);w.writerow(columns)
 for id_,name,price,schedule in [('always','상시 식당',8000,all_hours),('manual','지정시각 식당',9000,manual),('unknown','시간 미확인',7000,'미확인'),('closed','요일 휴무',6000,closed)]:
  w.writerow([id_,name,'비빔밥','대전','36.35','127.38','한식','[비빔밥]','['+str(price)+']','미확정',schedule,'한식','밥'])
`;
 const result=spawnSync("python3",["-c",py,csv,start,end],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);
 const listener=net.createServer();await new Promise(r=>listener.listen(0,"127.0.0.1",r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const server=spawn("java",["-cp","build","FoodPickerWeb",csv,String(port)],{cwd:root});
 server.stdin.end();
 let output="";server.stdout.on("data",x=>output+=x);server.stderr.on("data",x=>output+=x);
 let browser;
 try{
  const url="http://127.0.0.1:"+port;
  let ready=false;
  for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error(output);try{ready=(await fetch(url+"/api/count?time=all")).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}
  assert(ready,output);
  browser=await chromium.launch({executablePath:"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
  const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:"UTC"});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("https://oapi.map.naver.com/**",route=>route.abort());
  await page.goto(url);
  const count=async n=>page.waitForFunction(n=>document.getElementById("count").textContent.includes("조건에 맞는 "+n+"곳"),n);
  await count(1);
  assert(await page.locator("#time-enabled").isChecked());
  assert.match(await page.locator("#date").inputValue(),/^\d{4}-\d{2}-\d{2}$/);
  assert.match(await page.locator("#time").inputValue(),/^[0-2]\d:[0-5]\d$/);
  assert.equal(await page.locator("#date").inputValue(),new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()));
  assert.equal(await page.locator("#time-note").count(),0);
  async function fields(response,id){
   const r=await response;if(!r.headers()["content-type"].includes("json"))return new URLSearchParams(await r.text());
   const data=await r.json();return new URLSearchParams(id?data.restaurants.find(x=>x["음식점아이디"]===id):data.restaurants[0]);
  }
  let pending=page.waitForResponse(r=>/\/api\/picks?\?/.test(r.url()));
  await page.locator("#pick").click();
  let data=await fields(pending);
  assert.equal(data.get("음식점아이디"),"always");assert.equal(data.get("_timeApplied"),"true");
  await page.waitForFunction(()=>!document.getElementById("result").hidden);
  assert.equal(await page.locator("#hours-check").count(),0);
  assert.equal(await page.locator("#business").count(),0);
  assert(!/자료 기준|실시간 정보|CSV 등록값/.test(await page.locator("body").innerText()));
  console.log("PASS: UTC 브라우저에서도 한국 현재 시각 기본값, 시간 미확인·휴무 제외");
  await page.locator("#date").fill("2026-11-07");
  await page.locator("#time").fill(manual);await count(2);
  assert(await page.locator("#result").isHidden());
  pending=page.waitForResponse(r=>/\/api\/picks?\?/.test(r.url()));await page.locator("#pick").click();
  data=await fields(pending,"manual");
  assert.equal(data.get("_searchTime"),manual);
  assert.equal(data.get("_searchDate"),"2026-11-07");
  assert.equal(data.get("음식점아이디"),"manual");
  await page.locator("#now").click();await count(1);
  console.log("PASS: 직접 입력 시각 적용, 현재시각 버튼 복원");
  await page.locator("#date").fill("");
  await page.waitForFunction(()=>document.getElementById("status").textContent.includes("날짜와 시각"));
  await page.locator("#time-enabled").uncheck();await count(4);
  assert(await page.locator("#time").isDisabled());
  assert(await page.locator("#date").isDisabled());
  assert(!/영업시간 조건을 적용하지 않은 추천/.test(await page.locator("body").innerText()));
  await page.locator("#now").click();await count(1);
  await page.locator("#min").fill("9000");await page.locator("#max").fill("9000");await count(0);
  await page.locator("#time").fill(manual);await count(1);
  pending=page.waitForResponse(r=>/\/api\/picks?\?/.test(r.url()));await page.locator("#pick").click();
  data=await fields(pending,"manual");assert.equal(data.get("음식점아이디"),"manual");
  await page.locator("#reset").click();await count(1);
  assert(await page.locator("#time-enabled").isChecked());assert.equal(await page.locator("#min").inputValue(),"");
  console.log("PASS: 시간 조건 해제, 가격 조건과 교집합, 초기화 시 현재 시각 복원");
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,"build","time-mobile.png"),fullPage:true});
  await page.setViewportSize({width:1280,height:1000});
  await page.screenshot({path:path.join(root,"build","time-desktop.png"),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log("PASS: 모바일 화면과 시간 선택 UI, 지도 오류와 독립적인 시간 검색");
 }finally{
  if(browser)await browser.close();
  server.kill("SIGTERM");await new Promise(r=>server.exitCode!==null?r():server.once("exit",r));
  fs.rmSync(folder,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
