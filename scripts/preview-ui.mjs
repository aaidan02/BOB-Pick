/** A local-only design preview. No production credentials or API calls are used. */
import {spawn} from 'node:child_process';
import {createServer,normalizePath} from 'vite';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=spawn(process.execPath,['--import','tsx','tests/cloud-fixture-server.ts'],{
  cwd:root,stdio:['ignore','pipe','inherit'],env:{...process.env,BOB_PICK_FIXTURE_PORT:'54330'}
});
let server,stopping=false;
async function seedPreviewData(){
  const api='http://127.0.0.1:54330';
  const login=async email=>(await (await fetch(api+'/auth/v1/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'test-password'})})).json()).access_token;
  const member=await login('a@example.test'),staff=await login('admin@example.test');
  async function write(path,body,token=member){
    const response=await fetch(api+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
    if(!response.ok)throw Error('Could not prepare local preview data: '+path);
    const text=await response.text();return text?JSON.parse(text):null;
  }
  for(const [title,body] of [
    ['점심시간에 혼밥하기 좋은 곳, 어디 있나요?','시청 근처에서 혼자 편하게 먹을 수 있는 가게를 찾고 있어요. 밥친구들의 추천을 기다립니다!'],
    ['쌀쌀한 날에는 뜨끈한 국밥 한 그릇','오늘 점심은 국밥으로 정했어요. 여러분은 어떤 메뉴를 골랐나요?'],
    ['우리 동네 카페 이야기 나눠요 ☕','주말에 쉬어가기 좋은 조용한 카페를 찾고 있어요. 마음에 드는 공간이 있다면 알려주세요.'],
    ['메뉴 고르기 어려울 때 밥픽해봤어요','늘 먹던 메뉴 대신 새로운 메뉴를 골라봤어요. 가끔은 랜덤 추천으로 새로운 취향을 발견하는 것도 좋네요.']
  ])await write('/rest/v1/posts',{user_id:'00000000-0000-4000-8000-000000000001',title,body});
  const batch=await write('/rest/v1/rpc/pick_restaurants',{p_filter:{checkHours:false,min:1},p_size:3,p_locked:[],p_prior:{}});
  for(const item of batch.restaurants)if(item.selected)await write('/rest/v1/favorites',{user_id:'00000000-0000-4000-8000-000000000001',menu_id:item.selected.id});
  const request={p_kind:'correction',p_restaurant_id:batch.restaurants[0].restaurant.id,p_payload:{phone:'042-123-4567'},p_message:'음식점 연락처를 확인해 주세요. 로컬 시안의 예시 문의입니다.'};
  await write('/rest/v1/rpc/submit_request',request);
  const reviewed=await write('/rest/v1/rpc/submit_request',{...request,p_restaurant_id:batch.restaurants[1].restaurant.id,p_message:'가게 전화번호 수정 신청입니다. 로컬 시안의 처리 완료 예시예요.'});
  await write('/rest/v1/rpc/review_request',{p_request_id:reviewed,p_decision:'approved',p_note:'가게 연락처를 확인해 반영했어요.'},staff);
}
async function stop(){
  if(stopping)return;stopping=true;
  await server?.close();fixture.kill('SIGTERM');
}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
fixture.on('exit',code=>{if(!stopping){console.error('Local preview data server stopped.',code);void stop();process.exitCode=1;}});
try{
  await new Promise((done,fail)=>{
    fixture.stdout.on('data',chunk=>{if(chunk.toString().includes('facade ready'))done();});
    fixture.once('error',fail);fixture.once('exit',()=>fail(Error('Could not start local preview data.')));
  });
  await seedPreviewData();
  server=await createServer({
    configFile:false,root:resolve(root,'web'),envDir:false,
    define:{
      'import.meta.env.VITE_SUPABASE_URL':'window.location.origin + "/__local-api"',
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('local-preview-publishable-key'),
      'import.meta.env.VITE_NAVER_MAP_CLIENT_ID':JSON.stringify('')
    },
    plugins:[{name:'bob-pick-local-ui-preview',
      transform(code,id){
        if(!id.endsWith('/web/src/legacy.js'))return;
        const mount='document.head.append(sdk);';
        if(!code.includes(mount))throw Error('Update the local preview SDK isolation before starting.');
        return {code:code.replace(mount,'window.navermap_authFailure();'),map:null};
      },
      transformIndexHtml(){return [
      {tag:'script',children:'document.documentElement.classList.add("preview-ui")',injectTo:'head-prepend'},
      {tag:'link',attrs:{rel:'stylesheet',href:`/@fs/${normalizePath(resolve(root,'ui-previews/emart-style/theme.css'))}`},injectTo:'head'},
      {tag:'script',attrs:{type:'module',src:`/@fs/${normalizePath(resolve(root,'ui-previews/emart-style/preview.js'))}`},injectTo:'body'},
      {tag:'div',attrs:{id:'preview-toolbar'},children:'<span><b>LOCAL DESIGN</b> 밥픽 전체 화면 시안 <small>· AI와 지도는 예시</small></span><div><label>화면 역할 <select id="preview-role"><option value="visitor">방문자</option><option value="member">회원</option><option value="admin">관리자</option><option value="master">마스터</option></select></label><button type="button" id="preview-first-visit">첫 방문 다시 보기</button><span id="preview-state" role="status"></span></div>',injectTo:'body-prepend'}
    ];}}],
    server:{host:'0.0.0.0',port:4175,strictPort:true,fs:{allow:[root]},proxy:{
      '/__local-api':{target:'http://127.0.0.1:54330',rewrite:path=>path.replace(/^\/__local-api/,'')}
    }}
  });
  await server.listen();
  console.log('\n밥픽 전체 화면 로컬 시안: http://localhost:4175\n종료: Ctrl+C\n');
}catch(error){console.error(error.message);process.exitCode=1;await stop();}
