import './legal.css';
import {el} from './ui';

const titles={terms:'이용약관',privacy:'개인정보처리방침',sources:'데이터 출처'} as const;
type LegalPage=keyof typeof titles;
const operator={name:'밥픽 운영팀',email:'aaidantest@gmail.com'};
const mapsTerms='https://xv-ncloud.pstatic.net/images/provision/%5B%EB%AF%BC%EA%B0%84%5DMaps%EC%84%9C%EB%B9%84%EC%8A%A4%EC%9D%B4%EC%9A%A9%EC%95%BD%EA%B4%80_v0.4_(CLEAN)_1742433558704.pdf';

export function isLegalPage(page:string):page is LegalPage{
  return Object.hasOwn(titles,page);
}
export function showLegalPage(page:LegalPage){
  const view=el('legal-view'),changed=view.hidden||view.dataset.page!==page;
  view.querySelector<HTMLElement>('.legal-panel')!.id=page;
  view.hidden=false;view.dataset.page=page;el('home-view').hidden=true;el('service-view').hidden=true;
  el('legal-heading').textContent=titles[page];document.title=titles[page]+' · 밥픽';
  view.querySelectorAll<HTMLElement>('[data-legal-document]').forEach(article=>article.hidden=article.dataset.legalDocument!==page);
  document.querySelectorAll<HTMLAnchorElement>('.legal-tabs a,.site-footer nav a').forEach(link=>{
    if(link.hash==='#'+page)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('.service-nav a').forEach(link=>link.removeAttribute('aria-current'));
  if(changed)requestAnimationFrame(()=>{
    if(view.hidden||view.dataset.page!==page)return;
    view.scrollIntoView({behavior:'instant',block:'start'});el('legal-heading').focus({preventScroll:true});
  });
}
export function initLegal(){
  el('legal-view').innerHTML=`
  <div class="legal-panel">
    <div class="page-heading"><p class="section-eyebrow">밥픽 운영 안내</p><h1 id="legal-heading" tabindex="-1">이용약관</h1><p class="legal-intro">서비스 이용과 개인정보 처리, 자료 출처를 확인하세요.</p></div>
    <nav class="legal-tabs" aria-label="약관 안내"><a href="#terms">이용약관</a><a href="#privacy">개인정보처리방침</a><a href="#sources">데이터 출처</a></nav>

    <article class="surface legal-document" data-legal-document="terms" aria-label="밥픽 이용약관" hidden>
      <p class="legal-date">게시일: 2026년 11월 10일</p>
      <section><h2>1. 밥픽 서비스</h2><p>밥픽은 대전 둔산동 음식점과 메뉴를 검색하고 추천받는 포트폴리오 웹 서비스입니다. 수동 추천, AI 채팅 추천, 메뉴 찜, 커뮤니티, 음식점 정보 수정·등록·홍보 신청을 제공합니다.</p></section>
      <section><h2>2. 계정과 이용</h2><p>수동 추천과 공개 게시글은 로그인 없이 이용할 수 있습니다. 메뉴 찜, 글 작성, 문의·신청과 AI 추천에는 로그인이 필요합니다. 다른 사람의 계정을 무단으로 사용하거나 비밀번호를 공유하지 마세요.</p><p>AI 추천은 Google Gemini API의 이용 조건을 따릅니다. Gemini API에는 만 18세 미만을 대상으로 하거나 이들이 접근할 것으로 예상되는 서비스에 관한 이용 제한이 있습니다.</p></section>
      <section><h2>3. 추천·저장·신청</h2><ul><li>기본 설정에서는 가게 한 곳, 조건을 직접 지정하면 최대 세 곳을 추천합니다.</li><li>‘마음에 들어요’는 현재 추천 카드를 고정합니다. 계정별로 저장하는 ‘메뉴 찜’과는 별도 기능입니다.</li><li>가게 정보 수정·등록·홍보 신청은 운영자의 검토와 승인을 거쳐 반영됩니다.</li></ul></section>
      <section><h2>4. 게시글과 권리 보호</h2><p>게시글의 권리는 작성자 또는 해당 권리자에게 있습니다. 타인의 권리를 침해하거나 다른 사람의 개인정보를 허락 없이 공개하는 글, 불법·스팸·서비스 운영을 방해하는 글을 게시하지 마세요.</p><p>작성자는 본인 글을 수정·삭제할 수 있으며, 관리자는 운영과 권리 보호를 위해 게시글을 삭제할 수 있습니다. 게시글을 작성하면 제목·내용과 닉네임이 다른 방문자에게 공개됩니다.</p></section>
      <section><h2>5. 외부 서비스 이용</h2><p>지도와 길찾기는 네이버 지도, AI 채팅 추천은 Google Gemini를 이용합니다. 지도에 표시되는 제공자 로고와 권리 표시는 해당 제공자의 정책을 따릅니다. 외부 서비스의 이용 조건은 아래 원문에서 확인할 수 있습니다.</p><div class="legal-links"><a href="${mapsTerms}" target="_blank" rel="noopener noreferrer">네이버 클라우드 Maps 이용약관</a><a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Gemini API 추가 이용약관</a><a href="https://developers.google.com/terms?hl=ko" target="_blank" rel="noopener noreferrer">Google API 서비스 약관</a></div></section>
      <section><h2>6. 운영 문의</h2><p>음식점 정보 수정·등록·홍보는 <a href="#requests">문의·신청</a>에서 접수할 수 있습니다.</p><p>운영: <span data-legal-operator></span><span data-legal-contact hidden> · 문의: <a data-legal-email></a></span></p></section>
    </article>

    <article class="surface legal-document" data-legal-document="privacy" aria-label="밥픽 개인정보처리방침" hidden>
      <p class="legal-date">게시일: 2026년 11월 10일</p>
      <section><h2>1. 처리하는 정보와 목적</h2><div class="legal-table-wrap"><table><thead><tr><th scope="col">구분</th><th scope="col">처리 정보</th><th scope="col">이용 목적</th></tr></thead><tbody>
        <tr><td>회원</td><td>이메일, 회원 식별자, 닉네임, 인증·권한 정보</td><td>가입·로그인, 계정·운영 권한 관리</td></tr>
        <tr><td>메뉴 찜</td><td>회원·메뉴 식별자, 저장 시각</td><td>계정별 찜 목록 제공</td></tr>
        <tr><td>커뮤니티</td><td>제목·내용, 작성자 연결 정보, 작성·수정 시각</td><td>게시글 공개·검색·수정·삭제</td></tr>
        <tr><td>문의·신청</td><td>요청 내용, 음식점·메뉴 정보, 처리 결과·사유·이력</td><td>신청 검토와 정보 수정, 운영 이력 관리</td></tr>
        <tr><td>AI 추천</td><td>입력한 대화와 검색 조건, 추천 후보, 계정별 사용량</td><td>AI 추천과 이용 횟수 관리</td></tr>
      </tbody></table></div></section>
      <section><h2>2. 외부 처리 서비스</h2><h3>Supabase · Vercel</h3><p>회원 인증과 찜·게시글·신청 데이터의 저장 및 AI 요청 처리는 Supabase를, 웹사이트 제공은 Vercel을 이용합니다. 관련 정보는 해외 클라우드 인프라에서 처리될 수 있습니다.</p><h3>Google Gemini</h3><p>AI 추천을 요청하면 대화 내용·검색 조건·음식점 및 메뉴 후보가 추천 처리를 위해 Google로 전송됩니다. 일반 수동 검색은 Gemini를 호출하지 않습니다.</p><p>Google의 무료 서비스 조건이 적용되는 경우 입력·응답이 제품과 모델 개선에 사용되고 담당자가 검토할 수 있습니다. 유료 서비스에는 해당 유료 서비스의 데이터 처리 조건이 적용됩니다. 대화에 민감한 개인정보를 입력하지 마세요.</p><h3>네이버 지도</h3><p>지도를 이용하는 과정에서 클라이언트 ID, 지도 요청·사용량 등 서비스 이용정보가 네이버클라우드와 네이버에 제공·보관되고 서비스 운영 및 품질 개선에 활용될 수 있습니다. 자세한 범위와 조건은 <a href="${mapsTerms}" target="_blank" rel="noopener noreferrer">Maps 이용약관 제7조</a>를 참고하세요.</p></section>
      <section><h2>3. 보관과 화면 공개</h2><p>회원정보·메뉴 찜·게시글·신청과 처리 이력은 해당 기능을 제공하는 동안 서버에 저장됩니다. 찜 해제와 본인 글 삭제는 각 화면에서 할 수 있습니다. 계정 삭제 시에도 공개 게시글·신청의 본문이나 처리 이력이 별도로 남을 수 있어, 해당 정보의 삭제가 필요하면 함께 요청해 주세요.</p><p>AI 대화는 현재 페이지의 대화 이력으로 관리하며, 대화 초기화 또는 페이지 새로고침 시 화면 내 이력이 지워집니다. Google 측의 처리·보관은 Google 정책에 따릅니다.</p><p>로그인 유지를 위해 브라우저 저장소에 인증 세션을 보관합니다. 공유 기기에서는 이용 후 로그아웃해 주세요.</p></section>
      <section><h2>4. 개인정보 관련 요청</h2><p>본인 정보의 열람·정정·삭제·처리 정지를 요청할 수 있습니다. 요청 내용과 본인 여부를 확인한 뒤 관련 법령에 따라 처리합니다.</p><p>운영: <span data-legal-operator></span><span data-legal-contact hidden> · 문의: <a data-legal-email></a></span></p></section>
      <section><h2>5. 제공자 개인정보 안내</h2><div class="legal-links"><a href="https://policies.google.com/privacy?hl=ko" target="_blank" rel="noopener noreferrer">Google 개인정보처리방침</a><a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">Supabase 개인정보 안내</a><a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">Vercel 개인정보처리방침</a></div></section>
    </article>

    <article class="surface legal-document" data-legal-document="sources" aria-label="밥픽 데이터 출처" hidden>
      <p class="legal-date">게시일: 2026년 11월 10일</p>
      <section><h2>1. 음식점·메뉴 자료</h2><p>음식점 정보는 공공데이터포털을 통해 대학생의 비상업 포트폴리오 목적으로 제공받은 자료를 기초로 구성했습니다. 개별 자료의 상세 페이지·제공기관·이용허락 유형은 확인 후 추가합니다.</p><p>밥픽은 제공받은 음식점·메뉴 정보에 검색용 음식 종류·형태·영업시간 정보를 연결해 추천 기능에 활용합니다. 개별 자료의 이용과 재배포에는 원자료의 이용허락 조건이 적용됩니다.</p><div class="legal-links"><a href="https://www.data.go.kr/" target="_blank" rel="noopener noreferrer">공공데이터포털</a></div></section>
      <section><h2>2. 지도</h2><p>지도 표시는 NAVER Maps를 이용하고, 길찾기는 네이버 지도 화면으로 연결합니다. 지도와 관련 자료의 권리는 각 제공자에게 있으며 지도 내부의 NAVER 로고와 권리 표시를 유지합니다.</p><div class="legal-links"><a href="${mapsTerms}" target="_blank" rel="noopener noreferrer">네이버 클라우드 Maps 이용약관</a><a href="https://navermaps.github.io/maps.js.ncp/docs/tutorial-Controls.html" target="_blank" rel="noopener noreferrer">네이버 지도 표시·컨트롤 안내</a></div></section>
      <section><h2>3. AI 추천과 서비스 기반</h2><p>AI 추천에는 Google Gemini API를 사용하며 제공된 음식점·메뉴 후보에서 선택합니다. 회원·데이터 처리는 Supabase, 웹 배포는 Vercel을 이용합니다.</p><p>서비스의 화면과 추천 기능은 밥픽 포트폴리오 프로젝트에서 개발했습니다. 외부 자료의 이용 조건은 해당 제공자의 약관과 이용허락 범위를 따릅니다.</p></section>
    </article>
    <a class="legal-home" href="#filters">← 메뉴 찾기로 돌아가기</a>
  </div>`;
  document.querySelectorAll<HTMLElement>('[data-legal-operator]').forEach(node=>node.textContent=operator.name);
  if(operator.email){
    document.querySelectorAll<HTMLElement>('[data-legal-contact]').forEach(node=>node.hidden=false);
    document.querySelectorAll<HTMLAnchorElement>('[data-legal-email]').forEach(link=>{link.textContent=operator.email;link.href='mailto:'+operator.email;});
  }
  function route(){
    const page=location.hash.slice(1);
    if(isLegalPage(page)){showLegalPage(page);return;}
    document.querySelectorAll('.site-footer nav a').forEach(link=>link.removeAttribute('aria-current'));
    if(!el('legal-view').hidden){
      el('legal-view').hidden=true;el('home-view').hidden=false;el('service-view').hidden=true;document.title='밥픽 · 오늘은 뭘 먹을까요?';
      requestAnimationFrame(()=>{
        if(location.hash.slice(1)!==page||el('home-view').hidden)return;
        const target=document.getElementById(page);
        if(target)target.scrollIntoView({block:'start'});else window.scrollTo({top:0,behavior:'instant'});
      });
    }
  }
  window.addEventListener('hashchange',route);route();
}
