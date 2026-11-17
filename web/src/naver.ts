export interface MapPlace {
  name:string;
  latitude:number|null;
  longitude:number|null;
  address?:string;
}

export function hasMapCoordinates(place:MapPlace):boolean {
  return typeof place.latitude==='number'&&Number.isFinite(place.latitude)&&Math.abs(place.latitude)<=85.05112878
    &&typeof place.longitude==='number'&&Number.isFinite(place.longitude)&&Math.abs(place.longitude)<=180;
}

export function directionsUrl(place:MapPlace):string {
  if(!hasMapCoordinates(place)){
    return 'https://map.naver.com/p/search/'+encodeURIComponent([place.address,place.name].filter(Boolean).join(' ').trim());
  }
  const radians=Math.PI/180,radius=6378137;
  const x=radius*place.longitude!*radians;
  const y=radius*Math.log(Math.tan(Math.PI/4+place.latitude!*radians/2));
  // A coordinate-only destination has no Naver place ID. PLACE_POI requires one.
  const destination=`${x.toFixed(3)},${y.toFixed(3)},${encodeURIComponent(place.name)},,SIMPLE_POI`;
  // Leave the origin empty; do not substitute an inferred location.
  return `https://map.naver.com/p/directions/-/${destination}/-/transit?c=15.00,0,0,0,dh`;
}
