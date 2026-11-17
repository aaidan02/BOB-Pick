const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),net=require("node:net");
const {spawn,spawnSync}=require("node:child_process");
async function main(){
 const root=path.resolve(__dirname,".."),folder=fs.mkdtempSync(path.join(os.tmpdir(),"bob-location-test-")),csv=path.join(folder,"sample.csv");
 const prepared=spawnSync("python3",["-c",String.raw`
import csv,sys
with open('관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv',encoding='cp949',newline='') as f:
 r=csv.DictReader(f);h=r.fieldnames;row=next(x for x in r if x['음식점아이디']=='15779')
with open(sys.argv[1],'w',encoding='cp949',newline='') as f:
 w=csv.DictWriter(f,fieldnames=h);w.writeheader();w.writerow(row)
`,csv],{cwd:root,encoding:"utf8"});assert.equal(prepared.status,0,prepared.stderr);
 const listener=net.createServer();await new Promise(r=>listener.listen(0,"127.0.0.1",r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const server=spawn("java",["-cp","build","FoodPickerWeb",csv,String(port)],{cwd:root});
 server.stdin.end();
 let output="";server.stdout.on("data",x=>output+=x);server.stderr.on("data",x=>output+=x);
 let browser;
 try{
  const base="http://127.0.0.1:"+port;let ready=false;
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error(output);try{ready=(await fetch(base+"/location-test")).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}
  assert(ready,output);
  const response=await fetch(base+"/location-test"),html=await response.text();
  assert(response.headers.get("content-type").includes("charset=utf-8"));
  assert.equal(response.headers.get("permissions-policy"),"geolocation=(self)");
  browser=await chromium.launch({executablePath:"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
  const errors=[];
  async function page(options={},setup){
   const context=await browser.newContext({locale:"ko-KR",timezoneId:"Asia/Seoul",viewport:{width:390,height:844},...options});
   await context.route("**/location-test",r=>r.fulfill({contentType:"text/html; charset=utf-8",headers:{"Permissions-Policy":"geolocation=(self)"},body:html}));
   if(setup)await context.addInitScript(setup);
   const p=await context.newPage();p.on("pageerror",e=>errors.push(e.message));return p;
  }
  const insecure=await page();await insecure.goto("http://phone-test.invalid/location-test");
  assert.equal(await insecure.evaluate(()=>isSecureContext),false);assert(await insecure.locator("#locate").isDisabled());
  assert((await insecure.locator("#status").textContent()).includes("HTTPS"));
  console.log("PASS: 휴대폰의 일반 HTTP 주소에서는 HTTPS 필요 안내·위치 요청 차단");

  const coords={latitude:36.3504,longitude:127.3845,accuracy:12};
  const secure=await page({geolocation:coords,permissions:["geolocation"]},()=>{
   window.requests=0;const original=navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
   navigator.geolocation.getCurrentPosition=(...args)=>{window.requests++;return original(...args);};
  });
  await secure.goto("https://phone-test.invalid/location-test");
  assert.equal(await secure.evaluate(()=>isSecureContext),true);assert.equal(await secure.evaluate(()=>window.requests),0);
  const network=[];secure.on("request",r=>network.push(r.url()));
  await secure.locator("#locate").click();await secure.waitForFunction(()=>!document.getElementById("values").hidden);
  assert.equal(await secure.locator("#latitude").textContent(),"36.350400");
  assert.equal(await secure.locator("#longitude").textContent(),"127.384500");
  assert.equal(await secure.locator("#accuracy").textContent(),"± 12 m");
  assert.equal(await secure.evaluate(()=>window.requests),1);assert.deepEqual(network,[]);
  assert((await secure.locator("#values").textContent()).includes("브라우저에서 구분 불가"));
  assert(await secure.locator("#locate").isEnabled());assert(await secure.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log("PASS: HTTPS·명시적 버튼 클릭·위치 허용 후 좌표·정확도 표시, 서버 전송 없음·모바일 화면 정상");

  for(const mode of ["denied","timeout","invalid","unsupported"]){
   const p=await page({},()=>{});
   await p.addInitScript(mode=>Object.defineProperty(navigator,"geolocation",{value:mode==="unsupported"?undefined:{getCurrentPosition(success,error){if(mode==="invalid")success({coords:{latitude:NaN,longitude:127},timestamp:Date.now()});else error({code:mode==="denied"?1:3});}}}),mode);
   await p.goto("https://phone-test.invalid/location-test");
   if(mode!=="unsupported")await p.locator("#locate").click();
   assert(await p.locator("#values").isHidden());
   assert.equal(await p.locator("#locate").isDisabled(),mode==="unsupported");
   assert((await p.locator("#status").textContent()).length>0);
  }
  console.log("PASS: 위치 거부·시간 초과·잘못된 좌표·미지원 처리");
  const destination=await fetch(base+"/directions?restaurant=15779",{redirect:"manual"});
  assert.equal(destination.status,302);assert.equal(new URL(destination.headers.get("location")).pathname.split("/")[3],"-");
  assert.equal((await fetch(base+"/location-test",{method:"POST"})).status,405);
  assert.deepEqual(errors,[]);
  console.log("PASS: 위치 테스트를 추가해도 길찾기 출발지는 비어 있음·GET만 허용");
 }finally{
  if(browser)await browser.close();server.kill("SIGTERM");await new Promise(r=>server.exitCode!==null?r():server.once("exit",r));
  fs.rmSync(folder,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
