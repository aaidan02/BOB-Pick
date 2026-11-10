// Loaded only by scripts/preview-ui.mjs. All data stays in the local fixture.
import {db,rpc} from '/src/supabase.ts';
import {legacyRecommendation,seoulNow} from '../../supabase/functions/_shared/recommendation.ts';

const $=id=>document.getElementById(id);
// Keep the preview overrides after the app's development style injections.
document.head.append(document.querySelector('link[href$="/emart-style/theme.css"]'));
const role=$('preview-role'),state=$('preview-state');
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const url=input instanceof Request?input.url:String(input);
  if(!new URL(url,location.href).pathname.endsWith('/functions/v1/ai-recommend'))return originalFetch(input,init);
  const request=new Request(input,init);
  const {data:{user}}=await db.auth.getUser();
  if(!user)return Response.json({error:'로그인 후 이용해 주세요.'},{status:401});
  const {history=[]}=await request.json(),text=history.at(-1)?.text??'';
  const filter={...seoulNow(),checkHours:false};
  if(/한식|국밥|국물|든든/.test(text))filter.categories=['한식'];
  else if(/일식|초밥|돈까스/.test(text))filter.categories=['일식'];
  else if(/양식|파스타/.test(text))filter.categories=['양식'];
  else if(/디저트|달콤|카페/.test(text))filter.categories=['카페·디저트'];
  if(/국물|국밥|탕/.test(text))filter.forms=['국·탕·찌개'];
  else if(/면|파스타|우동/.test(text))filter.forms=['면'];
  else if(/밥|든든/.test(text))filter.forms=['밥'];
  if(/만\s*원|만원|10000/.test(text))filter.max=10000;
  try{await rpc('consume_ai_quota');}catch{return Response.json({error:'오늘의 AI 추천 횟수를 모두 사용했어요.'},{status:429});}
  const batch=await rpc('pick_restaurants',{p_filter:filter,p_size:3,p_locked:[],p_prior:{}});
  return Response.json({count:batch.count,restaurants:batch.restaurants.map(item=>legacyRecommendation(item,batch.count,filter)),filter,message:batch.count?'말씀하신 취향에 어울리는 한 끼를 골랐어요.':'조건에 맞는 메뉴를 찾지 못했어요.',needsClarification:false});
};

$('preview-first-visit').addEventListener('click',()=>{
  localStorage.removeItem('bob-pick:help-seen:v1');location.hash='';location.reload();
});
role.addEventListener('change',async()=>{
  role.disabled=true;state.textContent='전환 중';
  try{
    if(role.value==='visitor')await db.auth.signOut();
    else{
      const email={member:'a@example.test',admin:'admin@example.test',master:'master@example.test'}[role.value];
      const {error}=await db.auth.signInWithPassword({email,password:'test-password'});if(error)throw error;
    }
    if(location.hash==='#admin'&&!['admin','master'].includes(role.value))location.hash='account';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    state.textContent='';
  }catch{state.textContent='전환을 다시 시도해 주세요.';}finally{role.disabled=false;}
});
db.auth.onAuthStateChange((_event,session)=>{
  role.value=({'a@example.test':'member','admin@example.test':'admin','master@example.test':'master'})[session?.user.email]??'visitor';
});

const map=$('map'),pin=document.createElement('span'),mapCaption=document.createElement('span');
pin.className='preview-map-pin';pin.textContent='여기서 맛있는 한 끼';
mapCaption.className='preview-map-caption';mapCaption.textContent='가게 위치 · 지도 배치 예시';map.append(pin,mapCaption);
const mapObserver=new MutationObserver(()=>{pin.textContent=$('result').hidden?'여기서 맛있는 한 끼':$('name').textContent||'여기서 맛있는 한 끼';});
mapObserver.observe($('name'),{childList:true,characterData:true,subtree:true});
mapObserver.observe($('result'),{attributes:true,attributeFilter:['hidden']});
