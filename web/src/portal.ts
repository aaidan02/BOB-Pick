import {initAuth,user,admin} from './auth';
import {initCommunity,loadPosts} from './community';
import {initFavorites,loadFavorites} from './favorites';
import {initRequests,loadRequests,loadAdmin} from './requests';
import {el} from './ui';

export async function initPortal(){
  el('service-view').innerHTML=`
  <section id="account-panel" class="service-panel filters" hidden>
    <div class="section-head"><h2>내 계정</h2></div>
    <div id="auth-box"><div class="button-row"><button type="button" data-auth-mode="login" class="secondary">로그인</button><button type="button" data-auth-mode="signup" class="secondary">회원가입</button><button type="button" data-auth-mode="reset" class="secondary">비밀번호 찾기</button></div>
      <form id="auth-form" class="portal-form">
        <label id="auth-email-row">이메일<input id="auth-email" type="email" autocomplete="email" required maxlength="254"></label>
        <label id="auth-password-row">비밀번호<input id="auth-password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></label>
        <label id="auth-nickname-row" hidden>닉네임<input id="auth-nickname" autocomplete="nickname" minlength="2" maxlength="40"></label>
        <button id="auth-submit" type="submit">로그인</button>
      </form><p id="auth-status" class="form-status" role="status"></p>
    </div>
    <div id="member-box" hidden><h3 id="member-name"></h3><form id="profile-form" class="portal-form"><label>닉네임<input id="profile-nickname" minlength="2" maxlength="40" required></label><button id="profile-save">닉네임 저장</button></form><button id="logout" type="button" class="secondary">로그아웃</button><p id="member-status" class="form-status" role="status"></p></div>
  </section>
  <section id="favorites-panel" class="service-panel filters" hidden>
    <div class="section-head"><div><p class="section-eyebrow">내가 고른 메뉴</p><h2>내 찜 목록</h2></div></div>
    <p id="favorite-status" role="status"></p><div id="favorite-list" class="portal-grid"></div><button id="favorite-more" type="button" class="secondary" hidden>더 보기</button>
  </section>
  <section id="community-panel" class="service-panel filters" hidden>
    <div class="section-head"><div><p class="section-eyebrow">함께 나누는 한 끼</p><h2>밥픽 커뮤니티</h2></div></div>
    <div class="button-row"><label class="grow">게시글 검색<input id="post-search" type="search" maxlength="120" placeholder="제목이나 내용으로 검색"></label><label class="checkbox"><input id="post-mine" type="checkbox">내 글만 보기</label></div>
    <p id="post-list-status" role="status"></p><div id="post-list"></div><div class="button-row"><button id="post-prev" type="button" class="secondary" hidden>이전</button><button id="post-next" type="button" class="secondary" hidden>다음</button></div>
    <div id="post-editor" hidden><h3>글 작성</h3><form id="post-form" class="portal-form"><label>제목<input id="post-title" maxlength="120" required></label><label>내용<textarea id="post-body" rows="7" maxlength="10000" required></textarea></label><div class="button-row"><button id="post-save">글 작성</button><button id="post-cancel" type="button" class="secondary" hidden>수정 취소</button></div></form></div><p id="post-status" class="form-status" role="status"></p>
  </section>
  <section id="requests-panel" class="service-panel filters" hidden>
    <div class="section-head"><h2>문의·신청</h2></div>
    <p id="request-login">로그인하면 문의와 신청을 남길 수 있어요. <a href="#account">로그인하기</a></p>
    <form id="request-form" class="portal-form" hidden>
      <label>신청 종류<select id="request-kind"><option value="correction">정보 수정 문의</option><option value="registration">음식점 등록</option><option value="promotion">홍보 신청</option></select></label>
      <label id="request-target-row">음식점<select id="request-target" required><option value="">음식점을 선택하세요</option></select></label>
      <fieldset id="request-details"><legend>음식점 정보</legend>
        <div class="portal-grid"><label>음식점 이름<input id="request-name" maxlength="200"></label><label>주소<input id="request-address" maxlength="500"></label><label>전화번호<input id="request-phone" type="tel" maxlength="100"></label><label>위도<input id="request-latitude" type="number" step="any" min="-90" max="90"></label><label>경도<input id="request-longitude" type="number" step="any" min="-180" max="180"></label></div>
        <label id="request-category-row" hidden>음식 종류<select id="request-category"></select></label>
        <label class="checkbox"><input id="request-hours-enabled" type="checkbox">매일 같은 영업시간 입력</label><div id="request-hours-row" class="portal-grid" hidden><label>영업 시작<input id="request-open" type="time" value="09:00"></label><label>영업 종료<input id="request-close" type="time" value="22:00"></label></div>
        <div id="registration-menus" hidden><h3>메뉴</h3><div id="request-menu-rows"></div><button id="request-add-menu" type="button" class="secondary">메뉴 추가</button></div>
        <div id="correction-menu"><label>가격 수정할 메뉴<select id="request-menu"><option value="">메뉴 가격은 변경하지 않음</option></select></label><div class="portal-grid"><label>변경 가격 (원)<input id="request-menu-price" type="number" min="0" step="1000"></label><label class="checkbox"><input id="request-menu-variable" type="checkbox">변동가격</label></div></div>
      </fieldset>
      <fieldset id="promotion-details" hidden><legend>홍보 내용</legend><label>제목<input id="promotion-title" maxlength="120"></label><label>내용<textarea id="promotion-content" maxlength="3000" rows="5"></textarea></label><label>종료 날짜<input id="promotion-end" type="date"></label></fieldset>
      <label>전달할 내용<textarea id="request-message" rows="4" maxlength="3000" placeholder="확인할 내용이나 신청 이유를 적어주세요"></textarea></label>
      <button id="request-submit">신청하기</button>
    </form><p id="request-status" class="form-status" role="status"></p><h3>내 신청 내역</h3><div id="request-list"></div>
  </section>
  <section id="admin-panel" class="service-panel filters" hidden>
    <div class="section-head"><h2>관리자</h2><button id="admin-reload" type="button" class="secondary">새로고침</button></div>
    <p id="admin-status" role="status"></p><div id="admin-content" hidden><h3>승인 대기</h3><div id="admin-pending"></div><h3>처리 내역</h3><div id="admin-reviews"></div><h3>변경 이력</h3><div id="admin-logs"></div></div>
  </section>`;
  initCommunity();initFavorites();initRequests();
  function route(){
    const page=location.hash.slice(1),service=['account','favorites','community','requests','admin'].includes(page);
    el('home-view').hidden=service;el('service-view').hidden=!service;
    document.querySelectorAll<HTMLElement>('.service-panel').forEach(panel=>panel.hidden=panel.id!==page+'-panel');
    if(page==='community')void loadPosts();if(page==='favorites')void loadFavorites();if(page==='requests')void loadRequests();if(page==='admin')void loadAdmin();
    if(service)el('service-view').scrollIntoView({block:'start'});
    document.querySelectorAll<HTMLAnchorElement>('.service-nav a').forEach(link=>link.setAttribute('aria-current',link.hash===location.hash?'page':'false'));
  }
  window.addEventListener('hashchange',route);
  window.addEventListener('identity-changed',()=>{
    el('request-login').hidden=!!user;el('request-form').hidden=!user;el('post-editor').hidden=!user;
    el('admin-content').hidden=!admin;if(location.hash==='#admin')void loadAdmin();
  });
  route();await initAuth();
}
