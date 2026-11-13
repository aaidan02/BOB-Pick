import {user,admin,requireUser} from './auth';
import {client,rpc} from './supabase';
import {el,node,message,action,friendly,date} from './ui';
let version=0,adminVersion=0;
const categories:Record<string,string>={general:'일반 문의',account:'계정·개인정보',recommendation:'추천·이용 횟수',bug:'오류 신고'};
export function supportMarkup(){return `
  <div class="page-heading"><p class="section-eyebrow">밥픽 고객센터</p><h1 id="support-heading">무엇을 도와드릴까요?</h1><p>자주 묻는 질문을 확인하고, 해결되지 않으면 문의를 남겨주세요.</p></div>
  <div class="support-shortcuts"><a class="surface" href="#requests"><strong>음식점 정보 문의·신청</strong><span>정보 수정 · 음식점 등록 · 가게 홍보 →</span></a><a class="surface" href="#account"><strong>내 정보 관리</strong><span>음식 취향 · 비밀번호 · 회원 탈퇴 →</span></a></div>
  <section class="surface support-faq" aria-labelledby="support-faq-heading"><h2 id="support-faq-heading">자주 묻는 질문</h2>
    <details><summary>AI 추천 횟수는 언제 줄어드나요?</summary><p>가게 추천이 정상적으로 완료된 경우에만 1회 사용됩니다. 오류, 조건 확인 질문, 후보가 없는 검색은 차감하지 않습니다. 일반 회원은 하루 20회이며 한국 시간 자정에 초기화됩니다.</p></details>
    <details><summary>메뉴를 못 정하겠어요.</summary><p>‘아무거나 추천해줘’, ‘몰라, 네가 골라줘’라고 말해보세요. 선택한 취향과 제외 조건을 반영해 골라드려요.</p></details>
    <details><summary>최근에 다녀온 가게를 빼고 싶어요.</summary><p>내 정보의 추천·방문 기록에서 ‘다녀왔어요’를 표시하고, 내 취향에서 제외 기간을 선택하세요. 추천만 받은 가게는 방문한 것으로 처리하지 않아요.</p></details>
    <details><summary>가게 고정과 메뉴 찜은 다른가요?</summary><p>‘마음에 들어요’는 현재 추천 카드를 고정합니다. ‘메뉴 찜하기’는 계정에 저장해 다음에도 볼 수 있어요.</p></details>
    <details><summary>비밀번호 변경이나 회원 탈퇴는 어디에서 하나요?</summary><p>로그인한 뒤 내 정보에서 변경할 수 있습니다. 현재 비밀번호를 잊었다면 로그인 화면에서 재설정 메일을 요청하세요.</p></details>
    <details><summary>탈퇴한 계정을 복원할 수 있나요?</summary><p>탈퇴 후 7일 안에 기존 이메일·비밀번호로 로그인하면 복원 화면이 열립니다. 비밀번호를 다시 확인하면 취향·찜·기록·작성한 글을 복원합니다. 7일이 지나거나 이미 영구 삭제된 계정은 복원할 수 없습니다.</p></details>
  </section>
  <section class="surface" aria-labelledby="support-write-heading"><h2 id="support-write-heading">1:1 문의</h2><p id="support-login" class="empty-state">로그인하면 문의를 남기고 답변을 확인할 수 있어요. <a href="#account">로그인하기 →</a></p>
    <form id="support-form" class="portal-form" hidden><label>문의 종류<select id="support-category"><option value="general">일반 문의</option><option value="account">계정·개인정보</option><option value="recommendation">추천·이용 횟수</option><option value="bug">오류 신고</option></select></label><label>제목<input id="support-subject" maxlength="120" required placeholder="어떤 도움이 필요한가요?"></label><label>내용<textarea id="support-body" rows="5" maxlength="5000" required placeholder="문제 상황을 알려주세요. 비밀번호나 API 키는 적지 마세요."></textarea></label><button id="support-submit">문의 보내기</button><p id="support-status" class="form-status" role="status"></p></form>
  </section>
  <section id="support-history" class="surface" hidden aria-labelledby="support-history-heading"><div class="section-head"><h2 id="support-history-heading">내 문의 내역</h2><button id="support-reload" type="button" class="secondary">새로고침</button></div><p id="support-list-status" class="empty-state" role="status"></p><div id="support-list"></div></section>`;}
function ticket(row:any){
  const card=node('details','','list-card support-card'),summary=node('summary'),head=node('div','','support-ticket-heading');
  head.append(node('span',categories[row.category]??'문의','helper'),node('span',row.status==='answered'?'답변 완료':'접수 완료','status-badge'));
  summary.append(head,node('h3',row.subject),node('small',date(row.created_at)));card.append(summary);
  const body=node('div','','support-ticket-body');body.append(node('p',row.body));
  if(row.reply){const reply=node('div','','support-reply');reply.append(node('strong','밥픽 답변'),node('p',row.reply));body.append(reply);}
  card.append(body);return {card,body};
}
export async function loadSupport(){
  const mine=++version,who=user?.id;
  el('support-login').hidden=!!who;el('support-form').hidden=!who;el('support-history').hidden=!who;el('support-list').replaceChildren();
  if(!who)return;message('support-list-status','문의를 불러오고 있어요.');
  try{
    const {data,error}=await client().from('support_tickets').select('*').eq('user_id',who).order('created_at',{ascending:false}).limit(50);if(error)throw error;
    if(mine!==version||user?.id!==who)return;
    for(const row of data??[])el('support-list').append(ticket(row).card);
    message('support-list-status',data?.length?'':'아직 남긴 문의가 없어요.');
  }catch(error){if(mine===version&&user?.id===who)message('support-list-status',friendly(error));}
}
export async function loadAdminSupport(){
  const mine=++adminVersion;if(!admin){el('admin-support-list').replaceChildren();return;}
  message('admin-support-status','고객센터 문의를 불러오고 있어요.');
  try{
    const {data,error}=await client().from('support_tickets').select('*').order('created_at',{ascending:false}).limit(50);if(error)throw error;if(mine!==adminVersion||!admin)return;
    el('admin-support-list').replaceChildren();
    for(const row of data??[]){
      const {card,body}=ticket(row),label=node('label','답변'),input=node('textarea'),button=node('button',row.reply?'답변 수정':'답변 보내기');
      input.value=row.reply;input.maxLength=5000;input.rows=4;input.setAttribute('aria-label','고객센터 답변');label.append(input);button.type='button';
      button.onclick=()=>void action(button,'admin-support-status',async()=>{requireUser();await rpc('reply_support_ticket',{p_id:row.id,p_reply:input.value.trim()});await loadAdminSupport();message('admin-support-status','답변을 저장했습니다.');});
      body.append(label,button);el('admin-support-list').append(card);
      const edit=node('button','문의 수정','secondary'),host=node('div');edit.type='button';body.append(edit,host);
      edit.onclick=()=>{
        if(host.children.length){host.hidden=!host.hidden;return;}
        const form=node('form','','portal-form moderation-editor'),categoryLabel=node('label','문의 종류'),category=node('select');
        for(const [value,text]of Object.entries(categories)){const option=node('option',text);option.value=value;category.append(option);}category.value=row.category;categoryLabel.append(category);
        const subjectLabel=node('label','문의 제목'),subject=node('input'),contentLabel=node('label','문의 본문'),content=node('textarea'),save=node('button','수정 저장');subject.value=row.subject;subject.maxLength=120;subject.required=true;content.value=row.body;content.maxLength=5000;content.rows=5;content.required=true;subjectLabel.append(subject);contentLabel.append(content);form.append(categoryLabel,subjectLabel,contentLabel,save);
        form.onsubmit=event=>{event.preventDefault();void action(save,'admin-support-status',async()=>{const actor=requireUser().id;await rpc('admin_edit_support_ticket',{p_id:row.id,p_category:category.value,p_subject:subject.value,p_body:content.value,p_expected_revision:row.revision,p_expected_actor:actor});await loadAdminSupport();message('admin-support-status','문의 내용을 수정했습니다.');});};host.append(form);host.hidden=false;
      };
    }
    message('admin-support-status',data?.length?'':'접수된 고객센터 문의가 없어요.');
  }catch(error){if(mine===adminVersion&&admin)message('admin-support-status',friendly(error));}
}
export function initSupport(){
  let identity='';
  (el('support-form') as HTMLFormElement).onsubmit=event=>{
    event.preventDefault();void action(el('support-submit'),'support-status',async()=>{
      const who=requireUser().id,subject=(el('support-subject') as HTMLInputElement).value.trim(),body=(el('support-body') as HTMLTextAreaElement).value.trim();
      if(!subject||!body)throw Error('제목과 내용을 입력해 주세요.');
      const {error}=await client().from('support_tickets').insert({user_id:who,category:(el('support-category') as HTMLSelectElement).value,subject,body});if(error)throw error;if(user?.id!==who)return;
      (el('support-form') as HTMLFormElement).reset();await loadSupport();message('support-status','문의를 접수했습니다. 답변은 내 문의 내역에서 확인해 주세요.');
    });
  };
  el('support-reload').onclick=()=>void loadSupport();el('admin-support-reload').onclick=()=>void loadAdminSupport();
  window.addEventListener('identity-changed',()=>{const next=(user?.id??'')+':'+admin;if(identity===next)return;identity=next;version++;adminVersion++;el('support-list').replaceChildren();el('admin-support-list').replaceChildren();if(!user){(el('support-form') as HTMLFormElement).reset();message('support-status','');}if(location.hash==='#support')void loadSupport();});
}
