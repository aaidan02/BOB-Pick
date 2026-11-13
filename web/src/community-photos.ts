import {client,rpc} from './supabase';
import {user,admin} from './auth';
import {node,friendly} from './ui';
const endpoint=import.meta.env.VITE_SUPABASE_URL+'/functions/v1/community-media',key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const MAX=5*1024*1024;
async function media(path:string,init:RequestInit={}){
  const {data}=await client().auth.getSession(),headers=new Headers(init.headers);headers.set('apikey',key);
  if(data.session)headers.set('Authorization','Bearer '+data.session.access_token);
  const response=await fetch(endpoint+path,{...init,headers});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error??'사진을 불러오지 못했어요.');}return response;
}
const galleries=new Map<()=>void,HTMLElement>();
export function clearPhotoGalleries(root?:HTMLElement){for(const [dispose,host]of galleries)if(!root||root.contains(host))dispose();}
export function renderPhotoGallery(host:HTMLElement,ids:string[]=[]){
  const abort=new AbortController(),urls:string[]=[];let alive=true;
  const dispose=()=>{alive=false;abort.abort();for(const url of urls)URL.revokeObjectURL(url);host.replaceChildren();galleries.delete(dispose);};galleries.set(dispose,host);
  host.classList.add('post-photo-gallery');
  for(const [index,id]of ids.entries()){
    const box=node('div','','photo-frame'),status=node('span','사진을 불러오는 중…','helper');box.append(status);host.append(box);
    void media('?id='+encodeURIComponent(id),{signal:abort.signal}).then(r=>r.blob()).then(blob=>{
      if(!alive)return;const url=URL.createObjectURL(blob);urls.push(url);const img=node('img');img.src=url;img.alt=`첨부 사진 ${index+1}`;img.loading='lazy';box.replaceChildren(img);
    }).catch(error=>{if(alive)status.textContent=error.message;});
  }
  return dispose;
}
export function mountPostPhotos(card:HTMLDetailsElement,body:HTMLElement,ids:string[]=[]){
  if(!ids.length)return;
  const host=node('div');body.prepend(host);let dispose:(()=>void)|undefined;
  const toggle=()=>{dispose?.();dispose=undefined;if(card.open)dispose=renderPhotoGallery(host,ids);};card.addEventListener('toggle',toggle);
}
async function prepare(file:File):Promise<File>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('JPG·PNG·WebP 사진을 선택해 주세요.');
  if(!file.size||file.size>MAX)throw Error('사진은 한 장에 5MB까지 첨부할 수 있어요.');
  const image=await createImageBitmap(file);
  try{
    if(image.width*image.height>40000000)throw Error('사진 해상도가 너무 커요. 크기를 줄여 다시 첨부해 주세요.');
    const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('사진을 변환하지 못했어요.')),'image/webp',0.85));
    return new File([blob],'photo.'+(blob.type==='image/webp'?'webp':'png'),{type:blob.type});
  }finally{image.close();}
}
type Attachment={id?:string;file?:File;url?:string;attached:boolean;dispose?:()=>void};
export class PhotoEditor{
  private items:Attachment[]=[];private generation=0;private processing:Promise<void>=Promise.resolve();private busy=false;
  constructor(private field:HTMLInputElement,private host:HTMLElement,private status:HTMLElement){
    field.onchange=()=>{const files=Array.from(field.files??[]),generation=this.generation;field.value='';
      this.processing=this.processing.then(async()=>{
        for(const file of files){
          if(generation!==this.generation)return;
          if(this.items.length>=3){this.status.textContent='사진은 최대 3장까지 첨부할 수 있어요.';break;}
          try{const converted=await prepare(file);if(generation!==this.generation)return;this.items.push({file:converted,url:URL.createObjectURL(converted),attached:false});this.draw();this.status.textContent='';}
          catch(error){this.status.textContent=friendly(error);}
        }
      });
    };
  }
  reset(ids:string[]=[]){
    this.generation++;for(const item of this.items){if(item.url)URL.revokeObjectURL(item.url);item.dispose?.();if(item.id&&!item.attached)void rpc('discard_post_photo',{p_id:item.id}).catch(()=>{});}
    this.items=ids.map(id=>({id,attached:true}));this.field.value='';this.status.textContent='';this.draw();
  }
  private draw(){
    for(const item of this.items)item.dispose?.();this.host.replaceChildren();
    for(const [index,item]of this.items.entries()){
      const box=node('div','','photo-editor-item'),preview=node('div','','photo-preview'),remove=node('button','×','photo-remove');remove.type='button';remove.setAttribute('aria-label',`첨부 사진 ${index+1} 삭제`);
      if(item.url){const img=node('img');img.src=item.url;img.alt=`첨부 사진 ${index+1}`;preview.append(img);}else if(item.id)item.dispose=renderPhotoGallery(preview,[item.id]);
      remove.onclick=()=>{if(this.busy)return;const i=this.items.indexOf(item);if(i<0)return;this.items.splice(i,1);item.dispose?.();if(item.url)URL.revokeObjectURL(item.url);if(item.id&&!item.attached)void rpc('discard_post_photo',{p_id:item.id}).catch(()=>{});this.draw();};
      box.append(preview,remove);this.host.append(box);
    }
    this.field.disabled=this.busy||this.items.length>=3;
  }
  async upload(){
    const who=user?.id,generation=this.generation;if(!who)throw Error('로그인 후 이용해 주세요.');
    this.busy=true;this.field.disabled=true;await this.processing;
    if(generation!==this.generation||user?.id!==who){this.busy=false;throw Error('계정이 변경되었습니다. 다시 시도해 주세요.');}
    this.field.disabled=true;this.host.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
    try{
      for(const item of this.items){
        if(item.id)continue;
        const data=new FormData();data.set('photo',item.file!);const response=await media('',{method:'POST',body:data}),body=await response.json();
        if(generation!==this.generation||user?.id!==who){void rpc('discard_post_photo',{p_id:body.id}).catch(()=>{});throw Error('계정이 변경되었습니다. 다시 시도해 주세요.');}
        item.id=body.id;
      }
      return this.items.map(item=>item.id!);
    }finally{this.busy=false;this.field.disabled=this.items.length>=3;this.host.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}
  }
  committed(){for(const item of this.items)item.attached=true;}
}
let photoIdentity='';
window.addEventListener('identity-changed',()=>{const next=(user?.id??'')+':'+admin;if(next!==photoIdentity){photoIdentity=next;clearPhotoGalleries();}});
