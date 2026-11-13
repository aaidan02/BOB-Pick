import {client,rpc} from './supabase';
import {user,admin,requireUser} from './auth';
import {action,date,el,input,message,node,friendly} from './ui';

type Post={id:string;user_id:string;title:string;body:string;author_name:string;created_at:string;revision:number};
let offset=0,version=0,editing:Post|null=null,memberId:string|null=null;
const expanded=new Set<string>();

function clearEditor(){
  editing=null;el<HTMLFormElement>('post-form').reset();el('post-save').textContent='등록하기';
  el('post-editor').hidden=true;el('post-compose').setAttribute('aria-expanded','false');
}
function openEditor(post?:Post){
  editing=post??null;
  el<HTMLInputElement>('post-title').value=post?.title??'';
  el<HTMLTextAreaElement>('post-body').value=post?.body??'';
  el('post-editor-title').textContent=post?'게시글 수정':'동네 이야기를 들려주세요';
  el('post-save').textContent=post?'수정 저장':'등록하기';
  el('post-editor').hidden=false;el('post-compose').setAttribute('aria-expanded','true');
  el('post-editor').scrollIntoView({behavior:'smooth',block:'start'});
  el('post-title').focus({preventScroll:true});message('post-status','');
}
export async function loadPosts(){
  const mine=++version;message('post-list-status','이야기를 불러오고 있어요.');
  try{
    const rows=await rpc<Post[]>('search_posts',{p_query:input('post-search'),p_offset:offset,p_mine:el<HTMLInputElement>('post-mine').checked});
    if(mine!==version)return;
    const cards=rows.map(row=>{
      const card=node('details','','list-card post-card'),toggle=node('summary','','post-toggle');
      const avatar=node('span',(row.author_name||'밥친구').slice(0,1),'post-avatar');avatar.setAttribute('aria-hidden','true');
      const overview=node('div','','post-overview'),meta=node('small',(row.author_name||'밥친구')+' · '+date(row.created_at));
      overview.append(node('h3',row.title,'post-title'),meta);
      if(row.user_id===user?.id)overview.append(node('span','내 글','status-badge'));
      const chevron=node('span','','post-chevron');chevron.setAttribute('aria-hidden','true');
      toggle.append(avatar,overview,chevron);
      const body=node('div','','post-body');body.append(node('p',row.body));
      const actions=node('div','','button-row post-actions');
      if(user&&(row.user_id===user.id||admin)){
        const edit=node('button',row.user_id===user.id?'수정':'관리자 수정','secondary');edit.type='button';edit.onclick=()=>openEditor(row);actions.append(edit);
      }
      if(user&&(row.user_id===user.id||admin)){
        const own=row.user_id===user.id,remove=node('button',own?'삭제':'관리자 삭제','danger secondary');remove.type='button';
        remove.onclick=()=>{
          if(!confirm((own?'이 게시글을 삭제할까요?':'다른 회원의 게시글을 삭제할까요?')+' 삭제한 글은 관리자 처리 내역에 보관됩니다.'))return;
          void action(remove,'post-status',async()=>{
            const who=requireUser();await rpc('set_post_visibility',{p_id:row.id,p_deleted:true,p_expected_revision:row.revision,p_expected_actor:who.id});
            expanded.delete(row.id);if(editing?.id===row.id)clearEditor();await loadPosts();message('post-status','게시글을 삭제했습니다.');
          });
        };actions.append(remove);
      }
      if(actions.children.length)body.append(actions);
      card.append(toggle,body);card.open=expanded.has(row.id);
      card.addEventListener('toggle',()=>{if(card.open)expanded.add(row.id);else expanded.delete(row.id);});
      return card;
    });
    el('post-list').replaceChildren(...cards);
    el('post-prev').hidden=offset===0;el('post-next').hidden=rows.length<20;
    message('post-list-status',rows.length?'':input('post-search')?'검색된 이야기가 없어요. 다른 단어로 찾아보세요.':'아직 이야기가 없어요. 첫 이야기를 남겨보세요.');
  }catch(error){if(mine===version)message('post-list-status',friendly(error));}
}
export function initCommunity(){
  let timer:ReturnType<typeof setTimeout>;
  el('post-compose').onclick=()=>{if(!user){location.hash='account';return;}openEditor();};
  el('post-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{offset=0;void loadPosts();},250);};
  el('post-mine').onchange=()=>{offset=0;void loadPosts();};
  el('post-prev').onclick=()=>{offset=Math.max(0,offset-20);void loadPosts();};el('post-next').onclick=()=>{offset+=20;void loadPosts();};
  el('post-reload').onclick=()=>void loadPosts();
  el('post-cancel').onclick=()=>{clearEditor();el('post-compose').focus();};
  el<HTMLFormElement>('post-form').onsubmit=event=>{
    event.preventDefault();void action(el('post-save'),'post-status',async()=>{
      const who=requireUser(),values={title:input('post-title'),body:input('post-body')};
      if(!values.title||!values.body)throw Error('제목과 내용을 입력해 주세요.');
      if(editing){
        if(editing.user_id!==who.id)await rpc('admin_edit_post',{p_id:editing.id,p_title:values.title,p_body:values.body,p_expected_revision:editing.revision,p_expected_actor:who.id});
        else{const {data,error}=await client().from('posts').update(values).eq('id',editing.id).eq('user_id',who.id).eq('revision',editing.revision).select('id');
          if(error)throw error;if(!data?.length)throw Error('이미 삭제되었거나 변경된 글이에요. 목록을 새로 확인해 주세요.');}
        expanded.add(editing.id);
      }else{
        const {error}=await client().from('posts').insert({...values,user_id:who.id});if(error)throw error;
      }
      clearEditor();offset=0;await loadPosts();message('post-status','게시글을 저장했습니다.');
    });
  };
  window.addEventListener('identity-changed',()=>{
    if(memberId!==(user?.id??null)){memberId=user?.id??null;clearEditor();offset=0;expanded.clear();}
    el<HTMLInputElement>('post-mine').disabled=!user;if(!user)el<HTMLInputElement>('post-mine').checked=false;
    if(location.hash==='#community')void loadPosts();
  });
}
