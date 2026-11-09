import {client,rpc} from './supabase';
import {user,requireUser} from './auth';
import {action,date,el,input,message,node} from './ui';
let offset=0,version=0,editing:string|null=null;
export async function loadPosts(){
  const mine=++version;
  try{
    const rows=await rpc<any[]>('search_posts',{p_query:input('post-search'),p_offset:offset,p_mine:el<HTMLInputElement>('post-mine').checked});
    if(mine!==version)return;
    el('post-list').replaceChildren();
    for(const row of rows){
      const card=node('article','','list-card'),title=node('button',row.title,'post-title'),body=node('div','','post-body');
      body.hidden=true;body.append(node('p',row.body),node('small',row.author_name+' · '+date(row.created_at)));
      title.onclick=()=>{body.hidden=!body.hidden;};card.append(title,body);
      if(row.user_id===user?.id){
        const edit=node('button','수정','secondary'),remove=node('button','삭제','secondary');
        edit.onclick=()=>{editing=row.id;el<HTMLInputElement>('post-title').value=row.title;el<HTMLTextAreaElement>('post-body').value=row.body;el('post-save').textContent='수정 저장';el('post-cancel').hidden=false;el('post-editor').scrollIntoView({behavior:'smooth'});};
        remove.onclick=()=>{if(!confirm('이 게시글을 삭제할까요?'))return;void action(remove,'post-status',async()=>{
          requireUser();const {error}=await client().from('posts').delete().eq('id',row.id).eq('user_id',user!.id);if(error)throw error;
          if(editing===row.id)clearEditor();await loadPosts();message('post-status','게시글을 삭제했습니다.');
        });};body.append(edit,remove);
      }
      el('post-list').append(card);
    }
    el('post-prev').hidden=offset===0;el('post-next').hidden=rows.length<20;
    message('post-list-status',rows.length?'':'게시글이 없습니다.');
  }catch(error){if(mine===version)message('post-list-status',error instanceof Error?error.message:'게시글을 불러오지 못했습니다.');}
}
function clearEditor(){editing=null;el<HTMLFormElement>('post-form').reset();el('post-save').textContent='글 작성';el('post-cancel').hidden=true;}
export function initCommunity(){
  let timer:ReturnType<typeof setTimeout>;
  el('post-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{offset=0;void loadPosts();},250);};
  el('post-mine').onchange=()=>{offset=0;void loadPosts();};
  el('post-prev').onclick=()=>{offset=Math.max(0,offset-20);void loadPosts();};el('post-next').onclick=()=>{offset+=20;void loadPosts();};
  el('post-cancel').onclick=clearEditor;
  el<HTMLFormElement>('post-form').onsubmit=event=>{
    event.preventDefault();void action(el('post-save'),'post-status',async()=>{
      const who=requireUser(),values={title:input('post-title'),body:input('post-body')};
      if(!values.title||!values.body)throw Error('제목과 내용을 입력해 주세요.');
      const result=editing?await client().from('posts').update(values).eq('id',editing).eq('user_id',who.id):await client().from('posts').insert({...values,user_id:who.id});
      if(result.error)throw result.error;clearEditor();offset=0;await loadPosts();message('post-status','게시글을 저장했습니다.');
    });
  };
  window.addEventListener('identity-changed',()=>{clearEditor();el('post-editor').hidden=!user;if(location.hash==='#community')void loadPosts();});
}
