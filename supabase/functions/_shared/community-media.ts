export const PHOTO_LIMIT=5*1024*1024;
export class MediaError extends Error{constructor(message:string,public status=400){super(message);}}
type Rpc=(name:string,args?:Record<string,unknown>)=>Promise<any>;
export type MediaDependencies={actor:()=>Promise<{rpc:Rpc;userId:string|null}>;service:Rpc;ensureBucket:()=>Promise<void>;upload:(key:string,bytes:Uint8Array,mime:string)=>Promise<void>;download:(key:string)=>Promise<Blob>;remove:(keys:string[])=>Promise<void>};
async function bounded(req:Request,max:number){
  if(Number(req.headers.get('content-length')??0)>max)throw new MediaError('사진은 한 장에 5MB까지 첨부할 수 있어요.',413);
  const reader=req.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader)try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new MediaError('사진은 한 장에 5MB까지 첨부할 수 있어요.',413);}chunks.push(value);}}finally{reader.releaseLock();}
  const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;
}
export function imageMime(bytes:Uint8Array):string|null{
  if(bytes.length>=12&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
  if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
  if(bytes.length>=20&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';return null;
}
export async function communityMedia(req:Request,deps:MediaDependencies):Promise<Response>{
  const url=new URL(req.url),json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  try{
    if(url.searchParams.has('cleanup')){
      if(req.method!=='POST')throw new MediaError('지원하지 않는 요청입니다.',405);
      const input=JSON.parse(new TextDecoder().decode(await bounded(req,1024)));
      if(typeof input.ticket!=='string'||!/^[0-9a-f-]{36}$/.test(input.ticket))throw new MediaError('정리 요청을 확인할 수 없습니다.',403);
      let batch;try{batch=await deps.service('claim_media_cleanup',{p_ticket:input.ticket});}catch{throw new MediaError('정리 요청을 확인할 수 없습니다.',403);}
      // The first authorized maintenance call provisions the private bucket too.
      await deps.ensureBucket();if(batch.keys.length)await deps.remove(batch.keys);
      await deps.service('ack_media_cleanup',{p_lease:batch.lease});return json({ok:true,removed:batch.keys.length});
    }
    const actor=await deps.actor();
    if(req.method==='GET'){
      const id=url.searchParams.get('id');if(!id||!/^[0-9a-f-]{36}$/.test(id))throw new MediaError('사진을 볼 수 없어요.',404);
      let photo;try{photo=await actor.rpc('post_photo_access',{p_id:id});}catch{throw new MediaError('사진을 볼 수 없어요.',403);}
      const blob=await deps.download(photo.object_key);return new Response(blob,{headers:{'Content-Type':photo.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(req.method!=='POST')throw new MediaError('지원하지 않는 요청입니다.',405);
    if(!actor.userId)throw new MediaError('로그인 후 이용해 주세요.',401);
    if(!req.headers.get('content-type')?.startsWith('multipart/form-data;'))throw new MediaError('첨부할 사진을 선택해 주세요.');
    const body=await bounded(req,PHOTO_LIMIT+16384),form=await new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')!},body:body.buffer as ArrayBuffer}).formData(),file=form.get('photo');
    if(!(file instanceof File)||form.getAll('photo').length!==1||!file.size||file.size>PHOTO_LIMIT)throw new MediaError('사진은 한 장에 5MB까지 첨부할 수 있어요.');
    const bytes=new Uint8Array(await file.arrayBuffer()),mime=imageMime(bytes);if(!mime||mime!==file.type)throw new MediaError('JPG·PNG·WebP 사진 파일을 선택해 주세요.');
    const photo=await actor.rpc('reserve_post_photo',{p_mime:mime,p_size:file.size});
    try{await deps.ensureBucket();await deps.upload(photo.object_key,bytes,mime);await deps.service('finish_post_photo',{p_id:photo.id});}
    catch(error){try{await actor.rpc('discard_post_photo',{p_id:photo.id});}catch{/* Unattached reservations expire via maintenance. */}throw error;}
    return json({id:photo.id},201);
  }catch(error){
    if(error instanceof MediaError)return json({error:error.message},error.status);
    const msg=String((error as {message?:string})?.message??'');
    return json({error:/^(로그인 후|사진은|첨부 대기)/.test(msg)?msg:'사진을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'},400);
  }
}
