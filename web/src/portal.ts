import {accountMarkup,initAccount,loadAccountOverview} from './account';
import {supportMarkup,initSupport,loadSupport,loadAdminSupport} from './support';
import {initAuth,user,admin,accountRecovery} from './auth';
import {initCommunity,loadPosts} from './community';
import {initFavorites,loadFavorites} from './favorites';
import {initRequests,loadRequests,loadAdmin} from './requests';
import {el} from './ui';
import {isLegalPage,showLegalPage} from './legal';
import {initAdminAccounts} from './admin-accounts';
import {adminCommunityMarkup,initAdminRecords,refreshAdminRecords} from './admin-records';

export async function initPortal(){
  el('service-view').innerHTML=`
  <section id="account-panel" class="service-panel" hidden aria-labelledby="account-heading">
    <div class="page-heading"><p class="section-eyebrow">나의 밥픽</p><h1 id="account-heading">반가워요, 밥친구!</h1><p>찜한 메뉴와 동네 이야기를 한곳에서 만나요.</p></div>
    <aside id="account-art" class="account-art" aria-label="밥픽 소개"><h2>취향이 쌓이면,<br>한 끼가 더 즐거워져요.</h2><p>나만의 메뉴를 찜하고<br>밥친구들과 이야기를 나눠보세요.</p></aside>
    <div id="auth-box" class="surface account-surface">
      <div class="segmented" aria-label="계정 메뉴"><button type="button" data-auth-mode="login" aria-pressed="true">로그인</button><button type="button" data-auth-mode="signup" aria-pressed="false">회원가입</button></div>
      <p id="auth-hint" class="helper">이메일로 로그인하고 마음에 드는 메뉴를 저장해요.</p>
      <form id="auth-form" class="portal-form">
        <label id="auth-email-row">이메일<input id="auth-email" type="email" autocomplete="email" required maxlength="254" placeholder="이메일 주소"></label>
        <label id="auth-password-row">비밀번호<input id="auth-password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required placeholder="8자 이상 입력해 주세요"></label>
        <label id="auth-password-confirm-row" hidden>비밀번호 확인<input id="auth-password-confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" disabled></label>
        <label id="auth-nickname-row" hidden>닉네임<input id="auth-nickname" autocomplete="nickname" minlength="2" maxlength="40" placeholder="동네에서 사용할 이름"></label>
        <button id="auth-submit" type="submit">로그인</button>
      </form><button type="button" data-auth-mode="reset" class="text-button">비밀번호를 잊으셨나요?</button><p id="auth-status" class="form-status" role="status"></p>
    </div>
    <div id="member-box" hidden>${accountMarkup()}</div>
    <div id="account-recovery-box" class="surface account-surface" hidden><p class="section-eyebrow">계정 복원</p><h2 id="account-recovery-title">다시 함께할까요?</h2><p id="account-recovery-email" class="helper"></p><p id="account-recovery-deadline"></p><p id="account-recovery-detail" class="helper">복원하면 취향·찜·추천 및 방문 기록·작성한 글을 다시 이용할 수 있어요.</p><form id="account-restore-form" class="portal-form"><label>현재 비밀번호<input id="account-restore-password" type="password" autocomplete="current-password" maxlength="128" required></label><button id="account-restore">탈퇴 취소하고 계정 복원</button><p id="account-restore-status" class="form-status" role="status"></p></form><button id="account-recovery-logout" type="button" class="text-button">로그아웃</button></div>
  </section>
  <section id="support-panel" class="service-panel" hidden aria-labelledby="support-heading">${supportMarkup()}</section>
  <section id="favorites-panel" class="service-panel" hidden aria-labelledby="favorites-heading">
    <div class="page-heading"><p class="section-eyebrow">다음에 또 먹고 싶은</p><h1 id="favorites-heading">내 찜 목록</h1><p>마음에 드는 메뉴를 모아두고 다시 찾아보세요.</p></div>
    <div class="surface"><p id="favorite-status" class="empty-state" role="status"></p><div id="favorite-list" class="portal-grid"></div><button id="favorite-more" type="button" class="secondary" hidden>찜한 메뉴 더 보기</button><a class="inline-link" href="#filters">메뉴 찾으러 가기 →</a></div>
  </section>
  <section id="community-panel" class="service-panel" hidden aria-labelledby="community-heading">
    <div class="page-heading heading-actions"><div><p class="section-eyebrow">둔산동 밥친구들과</p><h1 id="community-heading">동네 이야기</h1><p>맛집 후기부터 오늘의 한 끼 고민까지.</p></div><button id="post-compose" type="button" aria-controls="post-editor" aria-expanded="false">＋ 글쓰기</button></div>
    <div id="post-editor" class="surface" hidden><h2 id="post-editor-title">동네 이야기를 들려주세요</h2><form id="post-form" class="portal-form"><label>제목<input id="post-title" maxlength="120" required placeholder="어떤 이야기를 나누고 싶나요?"></label><label>내용<textarea id="post-body" rows="7" maxlength="10000" required placeholder="밥친구들에게 들려줄 이야기를 적어주세요"></textarea></label><div class="button-row"><button id="post-save">등록하기</button><button id="post-cancel" type="button" class="secondary">취소</button></div></form></div>
    <div class="surface community-feed">
      <div class="community-tools"><label class="grow search-field"><span class="sr-only">게시글 검색</span><input id="post-search" type="search" maxlength="120" placeholder="제목이나 내용으로 검색"></label><label class="checkbox"><input id="post-mine" type="checkbox" disabled>내 글만</label><button id="post-reload" type="button" class="secondary compact">새로고침</button></div>
      <p id="post-list-status" class="empty-state" role="status"></p><div id="post-list"></div><div class="button-row pagination"><button id="post-prev" type="button" class="secondary" hidden>이전</button><button id="post-next" type="button" class="secondary" hidden>다음</button></div>
      <p id="post-status" class="form-status" role="status"></p>
    </div>
  </section>
  <section id="requests-panel" class="service-panel" hidden aria-labelledby="requests-heading">
    <div class="page-heading"><p class="section-eyebrow">함께 만드는 밥픽</p><h1 id="requests-heading">무엇을 도와드릴까요?</h1><p>가게 정보 수정, 새 음식점 등록, 홍보를 신청해요. <a href="#support">사이트·계정 문의는 고객센터 →</a></p></div>
    <p id="request-login" class="surface empty-state">로그인하면 문의와 신청을 남길 수 있어요. <a class="inline-link" href="#account">로그인하기 →</a></p>
    <div class="request-layout">
    <form id="request-form" class="portal-form surface" hidden>
      <div class="form-section-title"><span class="step-number">1</span><h2>신청할 내용을 골라주세요</h2></div>
      <label>신청 종류<select id="request-kind"><option value="correction">정보 수정 문의</option><option value="registration">새 음식점 등록</option><option value="promotion">가게 홍보 신청</option></select></label>
      <div id="request-target-row" class="restaurant-selector">
        <label>어느 음식점인가요?<input id="request-search" type="search" maxlength="120" placeholder="음식점 이름 또는 주소로 검색" autocomplete="off" aria-controls="request-target" aria-describedby="request-search-status"></label>
        <label>검색한 음식점 선택<select id="request-target" required><option value="">음식점을 선택하세요</option></select></label>
        <p id="request-search-status" role="status" aria-live="polite"></p>
      </div>
      <fieldset id="request-details"><legend>음식점 정보</legend><p id="request-details-hint" class="helper">바꾸려는 정보만 입력해 주세요.</p>
        <div class="portal-grid"><label>음식점 이름<input id="request-name" maxlength="200" placeholder="가게 이름"></label><label>주소<input id="request-address" maxlength="500" placeholder="도로명 또는 지번 주소"></label><label>전화번호<input id="request-phone" type="tel" maxlength="100" placeholder="예: 042-123-4567"></label></div>
        <label id="request-category-row" hidden>음식 종류<select id="request-category"></select></label>
        <details class="optional-fields"><summary>지도 좌표 입력 <span class="helper">선택</span></summary><div class="portal-grid"><label>위도<input id="request-latitude" type="number" step="any" min="-90" max="90"></label><label>경도<input id="request-longitude" type="number" step="any" min="-180" max="180"></label></div></details>
        <label class="checkbox"><input id="request-hours-enabled" type="checkbox">영업시간 입력</label><div id="request-hours-row" class="portal-grid" hidden><label>영업 시작<input id="request-open" type="time" value="09:00"></label><label>영업 종료<input id="request-close" type="time" value="22:00"></label></div>
        <div id="registration-menus" hidden><h3>메뉴 추가</h3><div id="request-menu-rows"></div><button id="request-add-menu" type="button" class="secondary">＋ 메뉴 추가</button></div>
        <div id="correction-menu"><label>가격 수정할 메뉴<select id="request-menu"><option value="">메뉴 가격은 변경하지 않음</option></select></label><div class="portal-grid"><label>변경 가격 (원)<input id="request-menu-price" type="number" min="0" step="1000" placeholder="예: 8000"></label><label class="checkbox"><input id="request-menu-variable" type="checkbox">변동가격</label></div></div>
      </fieldset>
      <fieldset id="promotion-details" hidden><legend>홍보 내용</legend><label>제목<input id="promotion-title" maxlength="120"></label><label>내용<textarea id="promotion-content" maxlength="3000" rows="5"></textarea></label><label>종료 날짜<input id="promotion-end" type="date"></label></fieldset>
      <div class="form-section-title"><span class="step-number">2</span><h2>자세한 내용을 알려주세요</h2></div>
      <label>전달할 내용 <span class="helper">선택</span><textarea id="request-message" rows="4" maxlength="3000" placeholder="확인할 내용이나 신청 이유를 적어주세요"></textarea></label>
      <button id="request-submit">신청 보내기</button><p id="request-status" class="form-status" role="status"></p>
    </form>
    <section class="surface request-history" aria-labelledby="request-history-heading"><div class="section-head"><h2 id="request-history-heading">내 신청 내역</h2><button id="request-reload" class="secondary compact" type="button">새로고침</button></div><p id="request-list-status" class="empty-state" role="status"></p><div id="request-list"></div></section>
    </div>
  </section>
  <section id="admin-panel" class="service-panel" hidden aria-labelledby="admin-heading">
    <div class="page-heading heading-actions"><div><p class="section-eyebrow">밥픽 운영</p><h1 id="admin-heading">관리자</h1><p>신청을 검토하고 관리자 권한을 관리해요.</p></div><button id="admin-reload" type="button" class="secondary">새로고침</button></div>
    <p id="admin-status" class="form-status" role="status"></p><div id="admin-content" hidden>
      <div class="admin-summary" role="group" aria-label="관리 현황">
        <div class="admin-stat"><small>현재 관리자</small><strong id="admin-summary-members">—</strong></div>
        <div class="admin-stat"><small>최근 대기 신청</small><strong id="admin-summary-pending">—</strong></div>
        <div class="admin-stat"><small>최근 변경 기록</small><strong id="admin-summary-changes">—</strong></div>
      </div>
      <section class="surface" aria-labelledby="admin-accounts-heading">
        <div class="section-head"><h2 id="admin-accounts-heading">관리자 계정 관리 <span id="admin-account-count" class="status-badge">0</span></h2></div>
        <h3>현재 관리자</h3><p id="admin-account-list-status" class="helper" role="status"></p><div id="admin-account-list"></div>
        <div class="admin-account-search-section"><h3>관리자 추가</h3><p class="helper">회원가입과 이메일 확인을 마친 계정에 관리자 권한을 추가할 수 있어요.</p>
          <form id="admin-account-search-form" class="admin-account-search-form"><label class="grow">회원 이메일 또는 닉네임<input id="admin-account-search" type="search" minlength="2" maxlength="254" required autocomplete="off" placeholder="이메일이나 닉네임으로 검색" aria-describedby="admin-account-search-status"></label><button id="admin-account-search-submit" type="submit">회원 검색</button></form>
          <p id="admin-account-search-status" class="helper" role="status"></p><div id="admin-account-results"></div>
        </div><p id="admin-account-status" class="form-status" role="status"></p>
      </section>
      <div class="admin-records"><h2>승인 및 처리 내역</h2><div class="moderation-tabs account-tabs" role="tablist" aria-label="관리 내역"><button id="admin-tab-inquiries" type="button" role="tab" aria-selected="true" aria-controls="admin-records-inquiries">문의 내역</button><button id="admin-tab-community" type="button" role="tab" aria-selected="false" aria-controls="admin-records-community">커뮤니티 내역</button></div>
      <div class="admin-records-grid"><section id="admin-records-inquiries" class="admin-record-column" role="region" aria-labelledby="admin-inquiries-heading">
      <div class="admin-record-heading"><h3 id="admin-inquiries-heading">문의 내역</h3><button id="admin-inquiries-reload" type="button" class="secondary">새로고침</button></div><div id="admin-inquiries-scroll" class="admin-record-scroll" tabindex="0" role="region" aria-label="문의 내역 목록">
      <section class="surface"><div class="section-head"><h2>승인 대기 <span id="admin-pending-count" class="status-badge">0</span></h2></div><div id="admin-pending"></div></section>
      <section class="surface"><h2>처리 내역</h2><div id="admin-reviews"></div></section>
      <section class="surface"><div class="section-head"><h2>고객센터 문의</h2><button id="admin-support-reload" type="button" class="secondary">새로고침</button></div><p id="admin-support-status" class="form-status" role="status"></p><div id="admin-support-list"></div></section>
      </div></section><section id="admin-records-community" class="admin-record-column" role="region" aria-labelledby="admin-community-heading" hidden>${adminCommunityMarkup()}</section></div></div>
      <details class="surface audit-section"><summary>변경 이력 보기</summary><div id="admin-logs"></div></details>
    </div>
  </section>`;
  el('account-art').prepend(document.querySelector('.hero-art')!.cloneNode(true));
  initAccount();initSupport();
  initCommunity();initFavorites();initRequests();initAdminAccounts();initAdminRecords();
  function route(){
    let page=location.hash.slice(1);
    if(isLegalPage(page)){showLegalPage(page);return;}
    if(accountRecovery&&page!=='account'){history.replaceState(null,'','#account');page='account';}
    el('legal-view').hidden=true;
    const service=['account','favorites','community','requests','admin','support'].includes(page);
    const returningHome=el('home-view').hidden&&!service;
    el('home-view').hidden=service;el('service-view').hidden=!service;
    document.querySelectorAll<HTMLElement>('.service-panel').forEach(panel=>panel.hidden=panel.id!==page+'-panel');
    if(page==='community')void loadPosts();if(page==='favorites')void loadFavorites();if(page==='requests')void loadRequests();if(page==='admin'){void loadAdmin();void loadAdminSupport();refreshAdminRecords();}if(page==='support')void loadSupport();if(page==='account')void loadAccountOverview();
    if(service)el('service-view').scrollIntoView({block:'start'});
    if(returningHome)requestAnimationFrame(()=>{
      if(el('home-view').hidden||location.hash.slice(1)!==page)return;
      (document.getElementById(page)??el('home-view')).scrollIntoView({block:'start',behavior:'instant'});
    });
    document.querySelectorAll<HTMLAnchorElement>('.service-nav a').forEach(link=>{
      const active=link.hash===location.hash||(!service&&link.hash==='#filters');
      if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    });
    const titles:Record<string,string>={account:'나의 밥픽',favorites:'내 찜 목록',community:'동네 이야기',requests:'문의·신청',admin:'관리자',support:'고객센터'};
    document.title=service?titles[page]+' · 밥픽':'밥픽 · 오늘은 뭘 먹을까요?';
  }
  window.addEventListener('hashchange',route);
  let adminIdentity='';
  window.addEventListener('identity-changed',()=>{
    if(accountRecovery)route();
    el('request-login').hidden=!!user;el('request-form').hidden=!user;
    el('request-reload').hidden=!user;el('admin-content').hidden=!admin;
    const identity=(user?.id??'')+':'+admin;if(location.hash==='#admin'&&adminIdentity!==identity){void loadAdmin();void loadAdminSupport();refreshAdminRecords();}adminIdentity=identity;
  });
  route();await initAuth();
}
