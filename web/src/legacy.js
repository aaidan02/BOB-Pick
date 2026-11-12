import {appFetch,directionsUrl,manualFilter} from './bridge';
import {hasMapCoordinates} from './naver';
import {friendly} from './ui';
import {activePreferenceFilter,preferencesLoading} from './preference-state';

  const el=id=>document.getElementById(id);
  function showDetail(node,value){
    const text=(value||'').trim();
    node.textContent=text;node.parentElement.hidden=!text;
  }
  let total=0,matched=0,previous=null,previousMenu=null,current=null,map=null,mapError=false,version=0;
  const markers=new Map();
  let mapSdkReady=false,mapLayoutFrame=0,mapWasVisible=false,mapWidth=0,mapHeight=0,mapPixelRatio=window.devicePixelRatio||1;
  let mapNeedsPosition=false,mapForceRefresh=false;
  let timer,countController=null,pickController=null;
  let autoTime=true,lastDate='',picking=false,countReady=false,clockVersion=0,selectedClockVersion=-1;
  let resultSource='manual',displayVersion=0,activeSource='manual';
  let chatHistory=[],chatPicking=false,chatController=null,chatVersion=0,chatMatched=0,chatReady=false,chatClock=-1;
  let lastRecommendation=null,retrying=false,retryController=null;
  let successToastTimer=null;
  const quickPrompts=[
    {label:'따뜻한 국물',icon:'🥘',text:'만 원 이하로 따뜻한 국물 요리 추천해줘.'},
    {label:'든든한 밥',icon:'🍚',text:'8천 원 이하로 든든한 밥 메뉴 골라줘.'},
    {label:'후루룩 면 요리',icon:'🍜',text:'만 원 이하로 면 요리 추천해줘.'},
    {label:'오늘은 한식',icon:'🍲',text:'만 5천 원 이하로 한식 메뉴 추천해줘.'},
    {label:'바삭한 튀김',icon:'🍤',text:'바삭한 튀김 요리가 먹고 싶어. 추천해줘.'},
    {label:'일식 한 끼',icon:'🍣',text:'일식 가게에서 먹을 밥 메뉴 추천해줘.'},
    {label:'중식 면 요리',icon:'🥡',text:'중식 가게에서 면 요리 추천해줘.'},
    {label:'양식이 당겨요',icon:'🍝',text:'만 5천 원 이하로 양식 메뉴 추천해줘.'},
    {label:'치킨 먹는 날',icon:'🍗',text:'치킨이 먹고 싶어. 둔산동 가게 추천해줘.'},
    {label:'피자 한 판',icon:'🍕',text:'피자가 먹고 싶어. 가게랑 메뉴 골라줘.'},
    {label:'달콤한 디저트',icon:'🍰',text:'카페에서 먹을 디저트 메뉴 추천해줘.'},
    {label:'가볍게 분식',icon:'🍢',text:'분식 가게에서 만 원 이하 메뉴 추천해줘.'},
  ];
  let visibleQuickPrompts=[];
  function shuffleQuickPrompts(){
    if(chatPicking)return;
    const pool=quickPrompts.filter(prompt=>!visibleQuickPrompts.includes(prompt));
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    visibleQuickPrompts=pool.slice(0,2);
    el('chat-quick-options').replaceChildren(...visibleQuickPrompts.map(prompt=>{
      const button=document.createElement('button'),icon=document.createElement('span'),label=document.createElement('span');
      button.type='button';button.dataset.prompt=prompt.text;button.setAttribute('aria-label',prompt.text);button.title=prompt.text;
      icon.className='quick-prompt-icon';icon.textContent=prompt.icon;icon.setAttribute('aria-hidden','true');
      label.textContent=prompt.label;button.append(icon,label);
      button.onclick=()=>{
        if(chatPicking)return;
        el('chat-input').value=prompt.text;el('chat-input').dispatchEvent(new Event('input',{bubbles:true}));
        el('chat-form').requestSubmit();
      };
      return button;
    }));
    el('chat-quick').hidden=false;
  }
  function hideSuccessToast(){clearTimeout(successToastTimer);successToastTimer=null;el('success-toast').hidden=true;}
  function showSuccessToast(){
    hideSuccessToast();el('success-toast').hidden=false;
    successToastTimer=setTimeout(()=>{el('success-toast').hidden=true;successToastTimer=null;},3000);
  }
  function revealResults(display){
    requestAnimationFrame(()=>{
      if(document.getElementById('home-view').hidden)return;
      if(display!==displayVersion||!slots.some(slot=>slot.data))return;
      el('results-grid').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
    });
  }
  function recordRecommendation(){
    if(!lastRecommendation)return;
    const items=slots.filter(slot=>slot.data).map(slot=>({restaurantId:slot.data.get('음식점아이디'),menuId:slot.data.get('_menuId')||null}));
    if(items.length)window.dispatchEvent(new CustomEvent('recommendation-shown',{detail:{eventId:crypto.randomUUID(),source:lastRecommendation.source==='chat'?'ai':'manual',filter:lastRecommendation.filter,items}}));
  }
  function appendChat(role,text){
    if(role==='user')el('chat-quick').hidden=true;
    const message={role,text:text.slice(0,1000)};
    const replaceReply=role==='assistant'&&chatHistory.at(-1)?.role==='assistant';
    if(replaceReply)chatHistory[chatHistory.length-1]=message;
    else chatHistory.push(message);
    chatHistory=chatHistory.slice(-8);
    while(chatHistory.reduce((sum,item)=>sum+item.text.length,0)>5500)chatHistory.shift();
    const bubble=document.createElement('div'),label=document.createElement('strong'),body=document.createElement('span');
    bubble.className='chat-message '+role;label.textContent=role==='user'?'나':'밥픽';body.textContent=text;
    bubble.append(label,body);
    if(replaceReply&&el('chat-log').lastElementChild?.classList.contains('assistant'))el('chat-log').lastElementChild.replaceWith(bubble);
    else el('chat-log').append(bubble);
    el('chat-log').hidden=false;
    while(el('chat-log').children.length>8)el('chat-log').firstElementChild.remove();
    el('chat-log').scrollTop=el('chat-log').scrollHeight;
  }
  function resultBusy(){return preferencesLoading()||retrying||(activeSource==='manual'?picking:chatPicking);}
  function clearResults(source){
    lastRecommendation=null;retryController?.abort();retryController=null;retrying=false;
    el('result-retry').hidden=true;el('result-retry-status').textContent='';
    resultSource=source;current=null;clearMarker();mapNeedsPosition=false;
    el('results-grid').dataset.source=source;
    slots.forEach(slot=>{slot.data=null;slot.locked=false;renderCard(slot);});
    el('results-grid').classList.toggle('multiple',source==='chat'||multipleMode());
    scheduleMapLayout();
    el('empty-pick').hidden=false;
    if(!mapError)el('map-status').textContent=map?'음식점을 뽑으면 위치를 표시합니다.':'지도를 불러오는 중입니다.';
  }
  const slots=Array.from({length:3},(_,index)=>{
    const node=index===0?el('result'):el('result').cloneNode(true);
    if(index>0){node.id='result-'+index;node.querySelectorAll('[id]').forEach(child=>child.removeAttribute('id'));el('restaurant-cards').append(node);}
    node.dataset.slot=index;
    const slot={node,data:null,locked:false};
    node.querySelector('.like').addEventListener('change',event=>{
      slot.locked=event.target.checked;
      node.classList.toggle('is-locked',slot.locked);node.querySelector('.lock-state').hidden=!slot.locked;
      updatePickButton();showPickStatus();
    });
    return slot;
  });
  function multipleMode(){
    return ['min','max','category','form'].some(key=>el(key).value.trim()!=='')||(!autoTime&&el('time-enabled').checked);
  }
  function renderCard(slot){
    const {node,data,locked}=slot;
    node.hidden=!data;node.classList.toggle('is-locked',locked);
    node.querySelector('.like').checked=locked;node.querySelector('.like').disabled=resultBusy();
    node.querySelector('.card-head').hidden=resultSource==='manual'&&!multipleMode();node.querySelector('.lock-state').hidden=!locked;
    if(!data){delete node.dataset.restaurantId;return;}
    node.dataset.restaurantId=data.get('음식점아이디');
    node.setAttribute('aria-label',data.get('음식점명'));
    node.querySelector('.menu').textContent=data.get('_menu')||'메뉴 정보가 없어요';
    node.querySelector('.name').textContent=data.get('음식점명');
    const price=data.get('_price');
    node.querySelector('.price').textContent=data.get('_priceLabel')||(price?Number(price).toLocaleString('ko-KR')+'원':'가격 표시 없음');
    const menus=JSON.parse(data.get('_matchedMenus'));
    node.querySelector('.matching-title').hidden=menus.length===0;node.querySelector('.matching-menus').hidden=menus.length===0;
    node.querySelector('.matching-title').textContent='조건에 맞는 메뉴 '+menus.length+'개';
    node.querySelector('.matching-menus').replaceChildren(...menus.map(menu=>{
      const item=document.createElement('li');
      item.dataset.menuId=menu.id||'';item.textContent=menu.name+' · '+(menu.priceLabel||(menu.price===null?'가격 표시 없음':menu.price.toLocaleString('ko-KR')+'원'));if(menu.id){const save=document.createElement('button');save.type='button';save.className='save-menu secondary';save.dataset.menuId=menu.id;save.textContent='메뉴 찜하기 ♡';item.append(save);}return item;
    }));
    showDetail(node.querySelector('.tags'),[data.get('_categories'),data.get('_menuForms')].filter(Boolean).join(' / '));
    showDetail(node.querySelector('.address'),[data.get('주소'),data.get('상세주소')].filter(Boolean).join(' '));
    showDetail(node.querySelector('.phone'),data.get('전화번호'));showDetail(node.querySelector('.hours'),data.get('운영시간정보'));
    node.querySelector('.map-link').href=directionsUrl({name:data.get('음식점명'),address:data.get('주소'),latitude:data.get('위도')===''?null:Number(data.get('위도')),longitude:data.get('경도')===''?null:Number(data.get('경도'))});
const save=node.querySelector('.save-menu');save.hidden=!data.get('_menuId');save.dataset.menuId=data.get('_menuId');window.dispatchEvent(new Event('recommendations-rendered'));
  }
  function showPickStatus(){
    const shown=slots.filter(slot=>slot.data);
    el('results-grid').classList.toggle('multiple',shown.length>1);
    scheduleMapLayout();
    if(resultSource==='chat'){
      el('chat-status').textContent=shown.length&&shown.every(slot=>slot.locked)?'고정을 해제하면 다시 추천받을 수 있어요.':'';return;
    }
    if(multipleMode()){
      const allLocked=shown.length>0&&shown.every(slot=>slot.locked);
      el('status').textContent=allLocked&&(shown.length===3||matched<=shown.length)
        ?'고정한 가게를 해제하면 다시 뽑을 수 있어요.'
        :shown.length>0&&shown.length<3?'조건에 맞는 가게가 '+shown.length+'곳이라 '+shown.length+'곳만 보여드려요.':'';
    }else{
      const menus=Number(current?.get('_matchedMenuCount'));
      el('status').textContent=current&&matched===1?'현재 조건에 맞는 음식점이 한 곳입니다.'+(menus>1?' 다시 누르면 같은 가게에서 다른 메뉴를 뽑습니다.':''):'';
    }
  }
  function showCount(count){
    matched=count;countReady=true;
    el('count').textContent='전체 '+total.toLocaleString('ko-KR')+'곳 중 조건에 맞는 '+count.toLocaleString('ko-KR')+'곳';
  }
  function updatePickButton(){
    const visible=slots.filter(slot=>slot.data),shown=resultSource==='manual'?visible:[],locked=shown.filter(slot=>slot.locked).length;
    const chatShown=resultSource==='chat'?visible:[],chatLocked=chatShown.filter(slot=>slot.locked).length;
    el('chat-send').disabled=preferencesLoading()||chatPicking||retrying||!el('chat-input').value.trim();
    el('chat-quick').querySelectorAll('button').forEach(button=>{button.disabled=preferencesLoading()||chatPicking||retrying;});
    el('chat-form').setAttribute('aria-busy',String(chatPicking));
    el('chat-conversation').dataset.busy=String(chatPicking);
    el('chat-refresh').hidden=!chatHistory.some(message=>message.role==='user');
    el('chat-refresh').disabled=chatPicking||retrying||chatLocked===3||(chatReady&&chatMatched===0)
      ||(chatShown.length>0&&chatLocked===chatShown.length&&chatMatched<=chatLocked&&chatClock===clockVersion);
    slots.forEach(slot=>{slot.node.querySelector('.like').disabled=resultBusy();});
    const fixed=visible.filter(slot=>slot.locked).length;
    el('result-retry').hidden=!lastRecommendation||visible.length===0;
    el('result-retry').disabled=picking||chatPicking||retrying||(visible.length>0&&visible.every(slot=>slot.locked)&&(fixed>=lastRecommendation?.size||fixed>=lastRecommendation?.count));
    el('result-retry').textContent=retrying?'재검색 중…':'같은 조건으로 재검색 ↻';
    if(multipleMode()){
      const allLocked=shown.length>0&&locked===shown.length;
      el('pick').disabled=preferencesLoading()||picking||retrying||!countReady||matched===0||locked===3
        ||(allLocked&&matched<=locked&&selectedClockVersion===clockVersion);
      el('pick').textContent=shown.length?'새로고침':'조건 검색';return;
    }
    const manualCurrent=resultSource==='manual'?current:null;
    const moreMenus=Number(manualCurrent?.get('_matchedMenuCount'))>1;
    const sameTime=selectedClockVersion===clockVersion;
    el('pick').disabled=preferencesLoading()||picking||retrying||!countReady||matched===0||(matched===1&&manualCurrent!==null&&sameTime&&!moreMenus);
    el('pick').textContent=manualCurrent===null?'오늘의 메뉴 뽑기':matched===1
      ?(!sameTime?'다시 추천받기':moreMenus?'다른 메뉴 뽑기':'추천 완료'):'다른 음식점 뽑기';
  }
  function clearMarker(){markers.forEach(marker=>marker.setMap(null));markers.clear();}
  function failMap(message){mapError=true;clearMarker();el('map-status').textContent=message;}
  // The SDK caches its viewport. SPA visibility and CSS-grid changes do not
  // necessarily produce a browser resize event, so synchronize after layout.
  function scheduleMapLayout(force=false){
    mapForceRefresh=mapForceRefresh||force;
    if(mapLayoutFrame)return;
    mapLayoutFrame=requestAnimationFrame(()=>{
      mapLayoutFrame=0;
      const node=el('map'),width=node.clientWidth,height=node.clientHeight;
      if(el('home-view').hidden||!width||!height){mapWasVisible=false;return;}
      if(mapError||mapAuthFailed)return;
      if(!mapSdkReady){if(mapNeedsPosition)renderMapPosition();return;}
      try{
        if(!map){
          map=new naver.maps.Map('map',{center:new naver.maps.LatLng(36.3504,127.3845),zoom:14,zoomControl:true});
          if(mapError||mapAuthFailed)return;
          mapNeedsPosition=true;el('map-status').textContent='음식점을 뽑으면 위치를 표시합니다.';
        }
        const sizeChanged=width!==mapWidth||height!==mapHeight,pixelRatio=window.devicePixelRatio||1;
        const refresh=mapForceRefresh||!mapWasVisible||pixelRatio!==mapPixelRatio;
        if(sizeChanged||refresh){
          const center=map.getCenter?.();
          // Keep the percentage-based CSS sizing; setSize would pin pixel sizes.
          map.autoResize?.();
          if(center)map.setCenter?.(center);
          if(refresh)map.refresh?.(true);
        }
        mapWidth=width;mapHeight=height;mapPixelRatio=pixelRatio;mapWasVisible=true;mapForceRefresh=false;
        // Fit selected places only after the new viewport has been measured.
        if(mapNeedsPosition||(sizeChanged&&markers.size>1)){
          mapNeedsPosition=false;renderMapPosition();
        }
      }catch{failMap('지도 크기를 조정하지 못했습니다. 네이버 길찾기를 이용해 주세요.');}
    });
  }
  function showPosition(){mapNeedsPosition=true;scheduleMapLayout();}
  function renderMapPosition(){
    if(mapError)return;
    const shown=slots.filter(slot=>slot.data),valid=shown.filter(({data})=>{
      const a=data.get('위도'),b=data.get('경도'),lat=Number(a),lng=Number(b);
      return a?.trim()&&b?.trim()&&hasMapCoordinates({name:data.get('음식점명'),latitude:lat,longitude:lng});
    });
    const ids=new Set(valid.map(({data})=>data.get('음식점아이디')));
    markers.forEach((marker,id)=>{if(!ids.has(id)){marker.setMap(null);markers.delete(id);}});
    if(!shown.length)return;
    if(!valid.length){
      el('map-status').textContent='좌표 정보가 없습니다. 네이버 길찾기에서 음식점을 확인해 주세요.';return;
    }
    if(!map){el('map-status').textContent='지도가 준비되면 선택한 음식점 위치를 표시합니다.';return;}
    try{
      const positions=valid.map(({data})=>{
        const id=data.get('음식점아이디'),position=new naver.maps.LatLng(Number(data.get('위도')),Number(data.get('경도')));
        if(!markers.has(id))markers.set(id,new naver.maps.Marker({map,position,title:data.get('음식점명')}));
        return position;
      });
      if(positions.length>1&&naver.maps.LatLngBounds&&map.fitBounds){
        const bounds=new naver.maps.LatLngBounds();positions.forEach(position=>bounds.extend(position));map.fitBounds(bounds,40);
      }else{map.setCenter(positions[0]);map.setZoom(positions.length>1?14:16);}
      el('map-status').textContent=valid.length===1?valid[0].data.get('음식점명')+'의 위치를 표시했습니다.'
        :'추천 가게 '+valid.length+'곳의 위치를 표시했습니다.';
    }catch{failMap('위치 표시 실패. 네이버 길찾기를 이용해 주세요.');}
  }
  let mapAuthFailed=false;
  const mapTimeout=setTimeout(()=>failMap('지도 연결이 지연됩니다. 네이버 길찾기를 이용해 주세요.'),12000);
  window.navermap_authFailure=()=>{
    mapAuthFailed=true;
    clearTimeout(mapTimeout);failMap('지도를 불러오지 못했습니다. 네이버 길찾기를 이용해 주세요.');
  };
  const sdk=document.createElement('script');
  sdk.src='https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId='+encodeURIComponent(import.meta.env.VITE_NAVER_MAP_CLIENT_ID||'');
  sdk.onload=()=>{
    clearTimeout(mapTimeout);if(mapAuthFailed)return;
    mapError=false;mapSdkReady=true;mapNeedsPosition=true;
    el('map-status').textContent='음식점을 뽑으면 위치를 표시합니다.';scheduleMapLayout();
  };
  sdk.onerror=()=>{clearTimeout(mapTimeout);failMap('지도 연결 실패. 네이버 길찾기를 이용해 주세요.');};
  if(typeof ResizeObserver==='function'){
    const observer=new ResizeObserver(()=>scheduleMapLayout());observer.observe(el('map'));
  }
  window.addEventListener('resize',()=>scheduleMapLayout());
  window.addEventListener('hashchange',()=>{if(el('home-view').hidden)mapWasVisible=false;scheduleMapLayout();});
  window.addEventListener('pageshow',()=>scheduleMapLayout(true));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')scheduleMapLayout(true);});
  document.head.append(sdk);
  async function getText(url,signal,options={}){
    const timeout=AbortSignal.timeout(options.method==='POST'?120000:10000);
    const response=await appFetch(url,{...options,cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout});
    const text=await response.text();if(!response.ok)throw new Error(text);return text;
  }
  function filterQuery(freezeTime=false){
    const query=new URLSearchParams();
    if(!el('time-enabled').checked)query.set('time','all');
    else if(!autoTime||freezeTime){
      const date=autoTime?seoulDate():el('date').value,time=autoTime?seoulTime():el('time').value;
      if(!date||!time)throw new Error('방문 날짜와 시각을 입력해 주세요.');
      query.set('date',date);query.set('time',time);
    }
    for(const key of ['min','max']){
      const text=el(key).value.trim();
      if(text){
        const value=Number(text);
        if(!Number.isInteger(value)||value<0||value>2147483647)throw new Error('가격은 0 이상의 정수로 입력해 주세요.');
        query.set(key,String(value));
      }
    }
    if(query.has('min')&&query.has('max')&&Number(query.get('min'))>Number(query.get('max')))throw new Error('최소 가격이 최대 가격보다 큽니다.');
    if(el('category').value)query.set('category',el('category').value);
    if(el('form').value)query.set('form',el('form').value);
    if(!el('manual-taste-row').hidden&&el('manual-taste').checked)query.set('taste','on');
    return query;
  }
  function changed(delay=0){
    version++;const mine=version;clearTimeout(timer);countController?.abort();pickController?.abort();
    countController=null;pickController=null;picking=false;countReady=false;
    if(resultSource==='manual')clearResults('manual');
    el('pick').disabled=true;el('pick').textContent=multipleMode()?'조건 검색':'오늘의 메뉴 뽑기';
    el('count').textContent='조건에 맞는 음식점을 확인하고 있습니다.';
    el('status').textContent='';
    timer=setTimeout(()=>refreshCount(mine),delay);
  }
  async function refreshCount(mine){
    const controller=new AbortController();
    countController?.abort();countController=controller;
    try{
      const query=filterQuery();
      const count=Number(await getText('/api/count?'+query,controller.signal));
      if(mine!==version||countController!==controller||picking)return;
      if(!Number.isInteger(count)||count<0)throw new Error('음식점 수를 확인하지 못했습니다.');
      showCount(count);updatePickButton();
      el('status').textContent=count===0
        ?(slots.some(slot=>slot.data)?'새로 추천할 음식점이 없습니다.':'조건에 맞는 음식점이 없습니다. 조건을 변경해 주세요.') :'';
    }catch(error){
      if(mine!==version||countController!==controller||controller.signal.aborted||picking)return;
      el('pick').disabled=true;el('count').textContent='조건을 확인해 주세요.';
      el('status').textContent=friendly(error);
    }finally{
      if(countController===controller)countController=null;
    }
  }
  for(const key of ['min','max'])el(key).addEventListener('input',()=>changed(200));
  for(const key of ['category','form'])el(key).addEventListener('change',()=>changed());
  function seoulTime(){
    return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  }
  function seoulDate(){
    return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  }
  function setNow(){
    autoTime=true;el('time-enabled').checked=true;el('date').disabled=false;el('time').disabled=false;
    el('date').value=seoulDate();el('time').value=seoulTime();lastDate=seoulDate();
  }
  el('time').addEventListener('input',()=>{autoTime=false;el('time-enabled').checked=true;changed();});
  el('date').addEventListener('input',()=>{autoTime=false;el('time-enabled').checked=true;changed();});
  el('time-enabled').addEventListener('change',()=>{
    el('date').disabled=!el('time-enabled').checked;el('time').disabled=!el('time-enabled').checked;
    if(el('time-enabled').checked&&autoTime)setNow();changed();
  });
  el('now').onclick=()=>{setNow();changed();};
  el('reset').onclick=()=>{for(const key of ['min','max','category','form'])el(key).value='';setNow();changed();};
  setInterval(()=>{
    const day=seoulDate(),clock=seoulTime();
    if(el('time-enabled').checked&&autoTime&&(el('time').value!==clock||lastDate!==day)){
      el('date').value=day;el('time').value=clock;lastDate=day;clockVersion++;
      // 시각·후보 수 자동 갱신은 사용자가 고른 메뉴와 지도 마커를 지우지 않습니다.
      if(!picking){clearTimeout(timer);timer=setTimeout(()=>refreshCount(version),0);}
    }
  },15000);
  el('pick').onclick=async()=>{
    if(picking||retrying)return;
    const mine=version,pickedClockVersion=clockVersion,multiple=multipleMode(),display=++displayVersion;
    activeSource='manual';
    if(resultSource!=='manual')clearResults('manual');
    picking=true;clearTimeout(timer);countController?.abort();countController=null;
    updatePickButton();el('status').textContent='고르는 중입니다.';
    try{
      const query=filterQuery(true),savedFilter=manualFilter(query);
      const controller=new AbortController();pickController=controller;
      if(multiple){
        const unlocked=slots.filter(slot=>!slot.locked),locked=slots.filter(slot=>slot.locked);
        if(!unlocked.length)return;
        query.set('size',String(unlocked.length));
        locked.forEach((slot,i)=>query.set('exclude'+i,slot.data.get('음식점아이디')));
        unlocked.forEach((slot,i)=>{if(slot.data){query.set('prior'+i,slot.data.get('음식점아이디'));query.set('menu'+i,slot.data.get('_menuIndex'));}});
        const batch=JSON.parse(await getText('/api/picks?'+query,controller.signal));
        if(mine!==version||pickController!==controller||display!==displayVersion)return;
        const data=batch.restaurants.map(item=>new URLSearchParams(item));
        unlocked.forEach((slot,i)=>{slot.data=data[i]||null;renderCard(slot);});
        showCount(batch.count);
      }else{
        if(previous!==null)query.set('previous',previous);
        if(previousMenu!==null)query.set('previousMenu',previousMenu);
        const data=new URLSearchParams(await getText('/api/pick?'+query,controller.signal));
        if(mine!==version||pickController!==controller||display!==displayVersion)return;
        slots[0].data=data;renderCard(slots[0]);showCount(Number(data.get('_count')));
      }
      current=slots[0].data;
      if(current){previous=current.get('음식점아이디');previousMenu=current.get('_menuIndex');}
      selectedClockVersion=pickedClockVersion;
      lastRecommendation=slots.some(slot=>slot.data)?{source:'manual',filter:savedFilter,size:multiple?3:1,count:matched,clock:pickedClockVersion}:null;
      el('empty-pick').hidden=slots.some(slot=>slot.data);
      showPosition();
      showPickStatus();
      if(matched>0){revealResults(display);recordRecommendation();}
      if(matched===0)el('status').textContent='새로 추천할 음식점이 없습니다.';
    }catch(error){if(mine===version)el('status').textContent=friendly(error);}
    finally{
      if(mine===version){
        picking=false;pickController=null;updatePickButton();
        if(display!==displayVersion&&el('status').textContent==='고르는 중입니다.')el('status').textContent='';
        if(pickedClockVersion!==clockVersion&&autoTime&&el('time-enabled').checked){
          timer=setTimeout(()=>refreshCount(version),0);
        }
      }
    }
  };
  async function recommendChat(newMessage=false){
    if(preferencesLoading()||chatPicking||retrying||!chatHistory.some(message=>message.role==='user'))return;
    const mine=++chatVersion,display=++displayVersion,pickedClock=clockVersion;
    hideSuccessToast();
    activeSource='chat';chatPicking=true;
    if(newMessage){chatReady=false;if(resultSource==='chat')clearResults('chat');}
    const query=new URLSearchParams();
    const useCurrent=resultSource==='chat',unlocked=useCurrent?slots.filter(slot=>!slot.locked):[...slots],locked=useCurrent?slots.filter(slot=>slot.locked):[];
    if(!unlocked.length){chatPicking=false;updatePickButton();return;}
    query.set('size',String(unlocked.length));query.set('history',JSON.stringify(chatHistory));
    if(!el('chat-taste-row').hidden&&el('chat-taste').checked)query.set('taste','on');
    locked.forEach((slot,i)=>query.set('exclude'+i,slot.data.get('음식점아이디')));
    unlocked.forEach((slot,i)=>{if(useCurrent&&slot.data){query.set('prior'+i,slot.data.get('음식점아이디'));query.set('menu'+i,slot.data.get('_menuIndex'));}});
    const controller=new AbortController();chatController=controller;
    el('chat-status').textContent='원하는 메뉴를 찾고 있어요.';updatePickButton();
    try{
      const batch=JSON.parse(await getText('/api/chat',controller.signal,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:query.toString()}));
      if(mine!==chatVersion||chatController!==controller)return;
      appendChat('assistant',batch.message);
      if(batch.needsClarification){el('chat-status').textContent='';return;}
      chatMatched=batch.count;chatReady=true;chatClock=pickedClock;
      el('chat-count').textContent='채팅에 맞는 가게 '+batch.count.toLocaleString('ko-KR')+'곳';
      el('chat-status').textContent='';
      if(batch.restaurants.length>0)showSuccessToast();
      if(display!==displayVersion)return;
      if(resultSource!=='chat')clearResults('chat');
      const data=batch.restaurants.map(item=>new URLSearchParams(item));
      unlocked.forEach((slot,i)=>{slot.data=data[i]||null;renderCard(slot);});
      lastRecommendation=batch.restaurants.length&&batch.filter?{source:'chat',filter:batch.filter,size:3,count:batch.count,clock:pickedClock}:null;
      el('empty-pick').hidden=slots.some(slot=>slot.data);showPosition();showPickStatus();
      if(batch.restaurants.length>0){revealResults(display);recordRecommendation();}
    }catch(error){
      if(mine===chatVersion&&!controller.signal.aborted)el('chat-status').textContent=friendly(error);
    }finally{
      if(mine===chatVersion){chatPicking=false;chatController=null;updatePickButton();}
    }
  }
  el('result-retry').onclick=async()=>{
    if(!lastRecommendation||picking||chatPicking||retrying||el('result-retry').disabled)return;
    const saved=lastRecommendation,display=++displayVersion,controller=new AbortController();
    const considered=saved.size===1?slots.slice(0,1):slots,unlocked=considered.filter(slot=>!slot.locked),locked=considered.filter(slot=>slot.locked&&slot.data);
    if(!unlocked.length)return;
    retrying=true;retryController=controller;activeSource=saved.source;hideSuccessToast();updatePickButton();
    el('result-retry-status').textContent='같은 조건으로 다시 고르고 있어요.';
    const prior=Object.fromEntries(unlocked.filter(slot=>slot.data).map(slot=>[slot.data.get('음식점아이디'),slot.data.get('_menuIndex')]));
    try{
      const batch=JSON.parse(await getText('/api/retry',controller.signal,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filter:saved.filter,size:unlocked.length,locked:locked.map(slot=>slot.data.get('음식점아이디')),prior})}));
      if(controller!==retryController||lastRecommendation!==saved||display!==displayVersion)return;
      unlocked.forEach((slot,i)=>{slot.data=batch.restaurants[i]?new URLSearchParams(batch.restaurants[i]):null;renderCard(slot);});
      saved.count=batch.count;current=slots[0].data;
      if(saved.source==='manual'){
        showCount(batch.count);selectedClockVersion=saved.clock;
        if(current){previous=current.get('음식점아이디');previousMenu=current.get('_menuIndex');}
      }else{chatMatched=batch.count;chatReady=true;chatClock=saved.clock;el('chat-count').textContent='채팅에 맞는 가게 '+batch.count.toLocaleString('ko-KR')+'곳';}
      el('empty-pick').hidden=slots.some(slot=>slot.data);showPosition();showPickStatus();
      el('result-retry-status').textContent=slots.some(slot=>slot.data)?'':'조건에 맞는 음식점이 없습니다.';
      if(slots.some(slot=>slot.data)){revealResults(display);recordRecommendation();}
    }catch(error){if(controller===retryController&&!controller.signal.aborted)el('result-retry-status').textContent=friendly(error);}
    finally{if(controller===retryController){retrying=false;retryController=null;updatePickButton();}}
  };
  el('chat-input').addEventListener('input',()=>{el('chat-send').disabled=preferencesLoading()||chatPicking||retrying||!el('chat-input').value.trim();});
  el('chat-input').addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!el('chat-send').disabled)el('chat-form').requestSubmit();}
  });
  el('chat-form').onsubmit=async event=>{
    event.preventDefault();const text=el('chat-input').value.trim();if(!text||chatPicking||retrying)return;
    appendChat('user',text);el('chat-input').value='';await recommendChat(true);
  };
  shuffleQuickPrompts();
  el('chat-refresh').onclick=()=>lastRecommendation?.source==='chat'?el('result-retry').click():recommendChat();
  el('chat-reset').onclick=()=>{
    hideSuccessToast();
    chatVersion++;chatController?.abort();chatController=null;chatPicking=false;chatReady=false;chatMatched=0;chatHistory=[];
    el('chat-input').value='';el('chat-log').replaceChildren();el('chat-log').hidden=true;el('chat-status').textContent='';el('chat-count').textContent='';
    shuffleQuickPrompts();
    if(activeSource==='chat'){displayVersion++;activeSource='manual';}
    if(resultSource==='chat')clearResults('manual');updatePickButton();
  };
  function syncTaste(){
    const prefs=activePreferenceFilter();
    for(const key of ['min','max'])if(el(key).dataset.fromTaste==='true'){el(key).value='';delete el(key).dataset.fromTaste;}
    if(el('manual-taste').checked&&!el('manual-taste-row').hidden&&!el('min').value&&!el('max').value){
      for(const key of ['min','max'])if(typeof prefs[key]==='number'){el(key).value=String(prefs[key]);el(key).dataset.fromTaste='true';}
    }
    if(!el('date').value)setNow();changed();
  }
  el('manual-taste').addEventListener('change',syncTaste);
  for(const key of ['min','max'])el(key).addEventListener('input',()=>delete el(key).dataset.fromTaste);
  window.addEventListener('food-preferences-changed',syncTaste);
  window.addEventListener('food-preferences-loading',updatePickButton);
  if(!el('manual-taste-row').hidden)syncTaste();
  getText('/api/count?time=all').then(text=>{
    total=Number(text);
    if(!Number.isInteger(total)||total<1)throw new Error('추첨할 음식점이 없습니다.');
    if(version===0){setNow();changed();}
    else if(countReady)showCount(matched);
  }).catch(error=>{el('count').textContent='서버 연결을 확인해 주세요.';el('status').textContent=friendly(error);});
