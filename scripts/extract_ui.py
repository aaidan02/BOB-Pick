"""One-time UI extraction; production builds do not require Java."""
import json,re,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
data=json.loads((root/'build/cloud-export.json').read_text())
html=data['html']
css=re.search(r'<style>(.*?)</style>',html,re.S).group(1)
js=re.search(r'<script>(.*?)</script>',html,re.S).group(1)
html=re.sub(r'<style>.*?</style>','',html,flags=re.S)
html=re.sub(r'<script>.*?</script>','<script type="module" src="/src/main.ts"></script>',html,flags=re.S)
for token in ['__CATEGORIES__','__FORMS__','__TODAY__','__NOW__']:html=html.replace(token,'')
html=html.replace('</header>','</header><nav class="service-nav shell" aria-label="서비스 메뉴"><a href="#filters">메뉴 찾기</a><a href="#community">커뮤니티</a><a href="#favorites">내 찜</a><a href="#requests">문의·신청</a><a href="#account" id="account-link">로그인</a><a href="#admin" id="admin-link" hidden>관리자</a></nav>')
html=html.replace('<main>','<main id="home-view">',1)
html=html.replace('<p id="price" class="price"></p>','<p id="price" class="price"></p><button class="save-menu secondary" type="button" hidden>메뉴 찜하기 ♡</button>')
html=html.replace('<div id="success-toast"','<main id="service-view" class="shell content" hidden></main><div id="success-toast"',1)
js="import {appFetch,directionsUrl} from './bridge';\n"+js
js=js.replace('fetch(url,','appFetch(url,').replace('__AI_TIMEOUT__','120000')
js=js.replace("requestAnimationFrame(()=>{\n      if(display", "requestAnimationFrame(()=>{\n      if(document.getElementById('home-view').hidden)return;\n      if(display")
js=js.replace("sdk.src='https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=__MAP_KEY__';","sdk.src='https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId='+encodeURIComponent(import.meta.env.VITE_NAVER_MAP_CLIENT_ID||'');")
js=js.replace("node.querySelector('.map-link').href='/directions?restaurant='+encodeURIComponent(data.get('음식점아이디'));", "node.querySelector('.map-link').href=directionsUrl({name:data.get('음식점명'),latitude:data.get('위도')===''?null:Number(data.get('위도')),longitude:data.get('경도')===''?null:Number(data.get('경도'))});\nconst save=node.querySelector('.save-menu');save.hidden=!data.get('_menuId');save.dataset.menuId=data.get('_menuId');window.dispatchEvent(new Event('recommendations-rendered'));")
js=js.replace("item.textContent=menu.name+' · '","item.dataset.menuId=menu.id||'';item.textContent=menu.name+' · '")
js=js.replace("원'));return item;", "원'));if(menu.id){const save=document.createElement('button');save.type='button';save.className='save-menu secondary';save.dataset.menuId=menu.id;save.textContent='메뉴 찜하기 ♡';item.append(save);}return item;")
js=js.replace("data.get('경도')===''?null:Number(data.get('경도'))});", "data.get('경도')===''?null:Number(data.get('경도'))});")
(root/'web/index.html').write_text(html,encoding='utf-8')
(root/'web/src/legacy.js').write_text(js,encoding='utf-8')
(root/'web/src/style.css').write_text(css,encoding='utf-8')
(root/'web/public').mkdir(exist_ok=True)
(root/'web/public/location-test.html').write_text(data['location'],encoding='utf-8')
print('Extracted original UI, map, card locking, scroll, and success toast.')
