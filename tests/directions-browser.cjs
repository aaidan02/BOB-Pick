const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),net=require("node:net");
const {spawn,spawnSync}=require("node:child_process");
async function main(){
 const root=path.resolve(__dirname,".."),folder=fs.mkdtempSync(path.join(os.tmpdir(),"bob-directions-")),csv=path.join(folder,"sample.csv");
 const specialId="id /?&",specialName='식당 /, "A" </script><script>window.injected=1</script>';
 const prepared=spawnSync("python3",["-c",String.raw`
import csv,sys,json
with open('관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv',encoding='cp949',newline='') as f:
 reader=csv.DictReader(f);columns=reader.fieldnames
 original=next(row for row in reader if row['음식점아이디']=='15779')
hours=' | '.join(day+'=00:00~24:00' for day in '월화수목금토일')
extra={'음식점아이디':sys.argv[2],'음식점명':sys.argv[3],'대표메뉴명':'비빔밥','음식 종류':'한식','음식 형태':'밥','메뉴한글명':'[비빔밥]','메뉴금액':'[8000]','위도':'36.36','경도':'127.39','주소':'대전','최종대조판정':'미확정','영업 시간대':hours}
missing={**extra,'음식점아이디':'missing','음식점명':'위치 미확인 식당','위도':'','경도':''}
with open(sys.argv[1],'w',encoding='cp949',newline='') as f:
 w=csv.DictWriter(f,fieldnames=columns);w.writeheader();w.writerows([original,extra,missing])
print(json.dumps({k:original[k] for k in ['음식점명','위도','경도']},ensure_ascii=False))
`,csv,specialId,specialName],{cwd:root,encoding:"utf8"});assert.equal(prepared.status,0,prepared.stderr);
 const restaurant=JSON.parse(prepared.stdout),origin={latitude:36.3504,longitude:127.3845};
 const listener=net.createServer();await new Promise(r=>listener.listen(0,"127.0.0.1",r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const server=spawn("java",["-cp","build","FoodPickerWeb",csv,String(port)],{cwd:root});
 server.stdin.end();
 let output="";server.stdout.on("data",x=>output+=x);server.stderr.on("data",x=>output+=x);
 let browser;
 try{
  const base="http://127.0.0.1:"+port;let ready=false;
  for(let i=0;i<120;i++){if(server.exitCode!==null)throw new Error(output);try{ready=(await fetch(base+"/api/count?time=all")).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}
  assert(ready,output);
  browser=await chromium.launch({executablePath:"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
  const errors=[],redirects=[];let locationRequests=0;
  async function context(options={}){
   const result=await browser.newContext({locale:"ko-KR",timezoneId:"Asia/Seoul",...options});
   result.on("page",p=>p.on("pageerror",e=>errors.push(e.message)));
   await result.exposeFunction("recordLocationRequest",()=>locationRequests++);
   await result.addInitScript(()=>{
    if(navigator.geolocation)navigator.geolocation.getCurrentPosition=()=>{
     window.recordLocationRequest();throw new Error("GPS 출처를 확인할 수 없는 위치는 요청하지 않아야 합니다.");
    };
   });
   await result.route("https://oapi.map.naver.com/**",r=>r.abort());
   // 실제 서버의 302 Location을 확인하고 외부 서비스 이동만 테스트 대역으로 처리합니다.
   await result.route("**/directions?**",async r=>{
    const response=await r.fetch({maxRedirects:0});
    assert.equal(response.status(),302);redirects.push(response.headers().location);
    await r.fulfill({status:200,contentType:"text/html; charset=utf-8",body:"<!doctype html><meta charset=utf-8><title>길찾기 연결 검증</title>"});
   });
   await result.route("https://map.naver.com/**",r=>r.fulfill({contentType:"text/html; charset=utf-8",body:"<!doctype html><meta charset=utf-8><title>네이버 길찾기 테스트</title>"}));
   return result;
  }
  function assertPoint(segment,latitude,longitude,name){
   const parts=segment.split(","),x=Number(parts[0]),y=Number(parts[1]);
   const actualLng=x/6378137*180/Math.PI,actualLat=(2*Math.atan(Math.exp(y/6378137))-Math.PI/2)*180/Math.PI;
   assert(Math.abs(actualLat-latitude)<1e-7);assert(Math.abs(actualLng-longitude)<1e-7);
   assert.equal(decodeURIComponent(parts[2]),name);assert.equal(parts[3],"");assert.equal(parts[4],"SIMPLE_POI");
  }
  function assertRoute(url,destination=restaurant){
   const parsed=new URL(url),parts=parsed.pathname.split("/");
   assert.equal(parsed.origin,"https://map.naver.com");assert.equal(parts[2],"directions");
   assert.equal(parts[3],"-");
   assertPoint(parts[4],Number(destination.위도),Number(destination.경도),destination.음식점명);
   assert.equal(parts[5],"-");assert.equal(parts[6],"transit");assert.equal(parsed.searchParams.get("c"),"15.00,0,0,0,dh");
  }
  const granted=await context({geolocation:origin,permissions:["geolocation"]});
  const app=await granted.newPage();await app.goto(base);
  await app.waitForFunction(()=>!document.getElementById("pick").disabled);
  await app.locator("#time-enabled").uncheck();await app.locator("#category").selectOption("일식");
  await app.locator("#form").selectOption("국·탕·찌개");
  await app.waitForFunction(()=>document.getElementById("count").textContent.includes("조건에 맞는 1곳"));
  await app.locator("#pick").click();await app.waitForFunction(()=>!document.getElementById("result").hidden);
  assert.equal(await app.locator("#name").textContent(),"미향일식");
  assert.equal(await app.locator("#link").getAttribute("href"),"/directions?restaurant=15779");
  const popup=app.waitForEvent("popup");await app.locator("#link").click();const route=await popup;
  await route.waitForLoadState();assertRoute(redirects.at(-1));
  assert(await app.locator("#result").isVisible());assert.equal(await app.locator("#menu").textContent(),"대구탕");
  assert.equal(await route.evaluate(()=>window.opener),null);
  console.log("PASS: 위치 API가 허용된 환경에서도 출처를 추정하지 않고 출발지는 비움, 새 탭·목적지·추천 유지");

  for(const mode of ["denied","unsupported"]){
   const manual=await context();
   if(mode==="unsupported")await manual.addInitScript(()=>Object.defineProperty(navigator,"geolocation",{value:undefined}));
   const p=await manual.newPage();await p.goto(base+"/directions?restaurant=15779");
   assert.equal(await p.title(),"길찾기 연결 검증");assertRoute(redirects.at(-1));
   await manual.close();
  }
  assert.equal(locationRequests,0);
  console.log("PASS: 위치 미허용·미지원에서도 위치 요청 없이 목적지만 설정");

  const special=await granted.newPage();await special.goto(base+"/directions?restaurant="+encodeURIComponent(specialId));
  assert.equal(await special.title(),"길찾기 연결 검증");
  assert.equal(await special.evaluate(()=>window.injected),undefined);
  assertRoute(redirects.at(-1),{위도:36.36,경도:127.39,음식점명:specialName});
  const missing=await granted.newPage();await missing.goto(base+"/directions?restaurant=missing");
  assert.equal(await missing.title(),"길찾기 연결 검증");assert(new URL(redirects.at(-1)).pathname.startsWith("/p/search/"));
  const redirect=await fetch(base+"/directions?restaurant=15779&gps=true&lat=36.35&lng=127.38",{redirect:"manual"});
  assert.equal(redirect.status,302);assertRoute(redirect.headers.get("location"));
  assert.equal(redirect.headers.get("Cache-Control"),"no-store");
  assert.equal((await fetch(base+"/directions?restaurant=unknown")).status,404);
  assert.equal((await fetch(base+"/directions?restaurant=15779&restaurant=missing")).status,400);
  assert.equal(locationRequests,0);
  console.log("PASS: 임의 출발지 매개변수 무시, 음식점 ID·이름 인코딩, 목적지 좌표 누락·잘못된 요청 처리");
  assert.deepEqual(errors,[]);
 }finally{
  if(browser)await browser.close();server.kill("SIGTERM");await new Promise(r=>server.exitCode!==null?r():server.once("exit",r));
  fs.rmSync(folder,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
