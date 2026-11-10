// Models the SDK's cached viewport. Layout changes require its documented APIs.
export const naverMapSdkFixture=String.raw`
(()=>{
window.mapTest={instances:0,resizes:[],refreshes:0,fits:[],markers:[]};
class LatLng{constructor(lat,lng){this.lat=lat;this.lng=lng;}}
class LatLngBounds{constructor(){this.points=[];}extend(point){this.points.push(point);}}
class Map{
  constructor(id,options){
    this.node=document.getElementById(id);this.center=options.center;this.zoom=options.zoom;
    this.tiles=document.createElement('div');this.tiles.className='test-map-tiles';
    this.tiles.style.cssText='background:repeating-linear-gradient(45deg,#e3ede4,#e3ede4 30px,#f0f4ec 30px,#f0f4ec 60px)';
    this.node.append(this.tiles);this.resize();window.mapTest.instances++;window.testNaverMap=this;
  }
  resize(){const width=this.node.clientWidth,height=this.node.clientHeight;this.tiles.style.width=width+'px';this.tiles.style.height=height+'px';this.size={width,height};}
  autoResize(){
    const size={width:this.node.clientWidth,height:this.node.clientHeight};
    window.mapTest.resizes.push(size);if(!size.width||!size.height)throw Error('Map resized while hidden');this.resize();
  }
  refresh(){window.mapTest.refreshes++;}
  getCenter(){return this.center;}setCenter(value){this.center=value;}
  getZoom(){return this.zoom;}setZoom(value){this.zoom=value;}
  fitBounds(bounds){window.mapTest.fits.push({width:this.size.width,container:this.node.clientWidth,points:bounds.points.length});}
}
class Marker{constructor(options){this.title=options.title;this.map=options.map;window.mapTest.markers.push(this);}setMap(map){this.map=map;}}
window.naver={maps:{Map,LatLng,LatLngBounds,Marker}};
})();
`;
