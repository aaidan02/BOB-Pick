import {admin,user,requireUser} from './auth';
import {rpc} from './supabase';
import {action,date,el,input,message,node,friendly} from './ui';
type AdminPost={id:string;user_id:string;title:string;body:string;author_name:string;created_at:string;updated_at:string;deleted_at:string|null;revision:number};
let offset=0,version=0,selected:AdminPost|null=null,owner:string|null=null,tab='inquiries';
export function adminCommunityMarkup(){return `
  <section class="surface"><div class="section-head"><h3>커뮤니티 내역</h3><button id="admin-post-reload" class="secondary" type="button">새로고침</button></div>
    <div class="portal-grid"><label>게시글 검색<input id="admin-post-search" type="search" maxlength="120" placeholder="제목·내용·작성자로 검색"></label><label>공개 상태<select id="admin-post-state"><option value="all">전체 게시글</option><option value="published">게시 중</option><option value="deleted">삭제됨</option></select></label></div>
    <p id="admin-post-status" class="form-status" role="status"></p>
    <form id="admin-post-editor" class="portal-form moderation-editor" hidden><h3>게시글 수정</h3><p id="admin-post-editor-hint" class="helper"></p><label>제목<input id="admin-post-title" maxlength="120" required></label><label>내용<textarea id="admin-post-body" maxlength="10000" rows="6" required></textarea></label><div class="button-row"><button id="admin-post-save">수정 저장</button><button id="admin-post-cancel" type="button" class="secondary">취소</button></div></form>
    <div id="admin-post-list"></div><div class="button-row"><button id="admin-post-prev" type="button" class="secondary" hidden>이전</button><button id="admin-post-next" type="button" class="secondary" hidden>다음</button></div>
  </section>`;}
function clearEditor(){selected=null;el<HTMLFormElement>('admin-post-editor').reset();el('admin-post-editor').hidden=true;}
function selectTab(next:string){
  tab=next;
  for(const name of ['inquiries','community']){el('admin-records-'+name).hidden=name!==next;el('admin-tab-'+name).setAttribute('aria-selected',String(name===next));}
  if(next==='community')void loadAdminPosts();
}
export async function loadAdminPosts(){
  const mine=++version,who=user?.id;el('admin-post-list').replaceChildren();if(!admin||!who)return;
  message('admin-post-status','게시글을 불러오고 있어요.');
  try{
    const rows=await rpc<AdminPost[]>('admin_search_posts',{p_query:input('admin-post-search'),p_state:input('admin-post-state'),p_offset:offset});
    if(mine!==version||!admin||user?.id!==who)return;
    for(const row of rows){
      const card=node('details','','list-card post-card admin-post-card'),summary=node('summary'),head=node('div','','section-head');
      head.append(node('h3',row.title),node('span',row.deleted_at?'삭제됨':'게시 중','status-badge'));summary.append(head,node('small',row.author_name+' · '+date(row.updated_at)));
      const body=node('div','','post-body');body.append(node('p',row.body));const buttons=node('div','','button-row'),edit=node('button','내용 수정','secondary'),visibility=node('button',row.deleted_at?'복원':'삭제',row.deleted_at?'secondary':'danger secondary');edit.type=visibility.type='button';
      edit.onclick=()=>{selected=row;el<HTMLInputElement>('admin-post-title').value=row.title;el<HTMLTextAreaElement>('admin-post-body').value=row.body;message('admin-post-editor-hint',row.deleted_at?'삭제된 글입니다. 수정해도 공개되지 않으며, 복원을 눌러야 다시 공개됩니다.':'게시 중인 글입니다. 수정 내용이 커뮤니티에 반영됩니다.');el('admin-post-editor').hidden=false;el('admin-post-editor').scrollIntoView({behavior:'smooth',block:'start'});el('admin-post-title').focus({preventScroll:true});};
      visibility.onclick=()=>{
        if(!confirm(row.deleted_at?'이 게시글을 다시 공개할까요?':'이 게시글을 삭제할까요? 관리자 내역에 보관됩니다.'))return;
        void action(visibility,'admin-post-status',async()=>{const actor=requireUser().id;await rpc('set_post_visibility',{p_id:row.id,p_deleted:!row.deleted_at,p_expected_revision:row.revision,p_expected_actor:actor});if(user?.id!==actor)return;clearEditor();await loadAdminPosts();message('admin-post-status',row.deleted_at?'게시글을 복원했습니다.':'게시글을 삭제했습니다.');});
      };
      buttons.append(edit,visibility);body.append(buttons);card.append(summary,body);el('admin-post-list').append(card);
    }
    el('admin-post-prev').hidden=offset===0;el('admin-post-next').hidden=rows.length<20;message('admin-post-status',rows.length?'':'조건에 맞는 게시글이 없어요.');
  }catch(error){if(mine===version&&user?.id===who)message('admin-post-status',friendly(error));}
}
export function initAdminRecords(){
  for(const name of ['inquiries','community'])el('admin-tab-'+name).onclick=()=>selectTab(name);
  document.querySelector('.moderation-tabs')!.addEventListener('keydown',event=>{const key=(event as KeyboardEvent).key;if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return;event.preventDefault();const next=key==='Home'?'inquiries':key==='End'?'community':tab==='inquiries'?'community':'inquiries';selectTab(next);el('admin-tab-'+next).focus();});
  let timer:ReturnType<typeof setTimeout>;el('admin-post-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{offset=0;void loadAdminPosts();},250);};el('admin-post-state').onchange=()=>{offset=0;void loadAdminPosts();};
  el('admin-post-reload').onclick=()=>void loadAdminPosts();el('admin-post-prev').onclick=()=>{offset=Math.max(0,offset-20);void loadAdminPosts();};el('admin-post-next').onclick=()=>{offset+=20;void loadAdminPosts();};el('admin-post-cancel').onclick=clearEditor;
  el('admin-reload').addEventListener('click',()=>{if(tab==='community')void loadAdminPosts();});
  el<HTMLFormElement>('admin-post-editor').onsubmit=event=>{event.preventDefault();void action(el('admin-post-save'),'admin-post-status',async()=>{if(!selected)throw Error('수정할 글을 선택해 주세요.');const actor=requireUser().id;await rpc('admin_edit_post',{p_id:selected.id,p_title:input('admin-post-title'),p_body:input('admin-post-body'),p_expected_revision:selected.revision,p_expected_actor:actor});if(user?.id!==actor)return;clearEditor();await loadAdminPosts();message('admin-post-status','게시글을 수정했습니다.');});};
  window.addEventListener('identity-changed',()=>{const who=admin?user?.id??null:null;if(owner!==who){owner=who;version++;offset=0;clearEditor();el('admin-post-list').replaceChildren();selectTab('inquiries');}});
}
