import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directionsUrl,hasMapCoordinates} from '../web/src/naver.ts';

test('coordinate-only route uses SIMPLE_POI, an empty origin and the exact restaurant coordinates',()=>{
  const place={name:'미향일식',latitude:36.35,longitude:127.38};
  const url=new URL(directionsUrl(place)),parts=url.pathname.split('/'),point=parts[4].split(',');
  assert.equal(url.origin,'https://map.naver.com');
  assert.deepEqual(parts.slice(0,4),['','p','directions','-']);
  assert.deepEqual(parts.slice(5),['-','transit']);
  assert.equal(decodeURIComponent(point[2]),place.name);assert.equal(point[3],'');assert.equal(point[4],'SIMPLE_POI');
  assert(Math.abs(Number(point[0])/6378137*180/Math.PI-place.longitude)<1e-7);
  assert(Math.abs((2*Math.atan(Math.exp(Number(point[1])/6378137))-Math.PI/2)*180/Math.PI-place.latitude)<1e-7);
});
test('names with route separators remain a single encoded destination field',()=>{
  const place={name:'식당 /, "A" ? # <script>',latitude:36.35,longitude:127.38};
  const url=new URL(directionsUrl(place)),parts=url.pathname.split('/');
  assert.equal(parts.length,7);assert.equal(parts[4].split(',').length,5);
  assert.equal(decodeURIComponent(parts[4].split(',')[2]),place.name);assert.equal(url.hash,'');
});
test('missing or invalid coordinates fall back to address/name search rather than a broken route',()=>{
  for(const value of [null,NaN,Infinity,90]){
    const place={name:'위치 미확인 식당',address:'대전 둔산동',latitude:value,longitude:127.38};
    assert.equal(hasMapCoordinates(place),false);
    const url=new URL(directionsUrl(place));assert.equal(decodeURIComponent(url.pathname),'/p/search/대전 둔산동 위치 미확인 식당');
  }
  assert.equal(hasMapCoordinates({name:'원점',latitude:0,longitude:0}),true);
});
