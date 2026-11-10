# 밥픽 · BOB Pick

Vercel의 웹 화면과 Supabase의 Auth·PostgreSQL·Edge Functions로 운영하는 음식점·메뉴 추천 서비스입니다. 별도의 Java 서버는 필요하지 않습니다. 기존 Java 코드와 실행 방법은 [기존 버전 문서](docs/legacy-java.md)에 보존했습니다.

운영 사이트: **https://bob-pick.vercel.app**

지금까지의 작업은 [프로젝트 정리](docs/project-summary-2026-11-09.md), [개발 과정 메모장](docs/development-history-2026-11-09.txt), [Windows 실행 방법](docs/windows-quick-start.txt)에 정리했습니다.

## 구현한 기능

- 수동 추천: 기본 설정은 한 곳, 조건을 지정하면 최대 세 곳. 가게 고정과 나머지 새로고침.
- 전체 메뉴 기준 가격·음식 종류·음식 형태·한국 방문 일시 검색. 형태와 가격이 같은 메뉴에서 모두 일치해야 합니다.
- 별도 AI 채팅: 실제 DB 후보만 선택하고 서버가 음식점·메뉴 ID를 검증합니다. 로그인 후 사용하며 계정별 하루 20회 제한이 있습니다.
- 조건 검색과 AI 채팅을 좌우에 배치하고 좁은 화면에서는 세로로 표시합니다. ‘오늘의 메뉴 뽑기’는 상단에, 조건 항목은 ‘자세히 보기’ 안에 표시합니다.
- 채팅 안의 ‘랜덤 빠른 추천’: 작은 원형 버튼 2개를 누르면 예시 문장을 전송하며 두 버튼이 사라집니다. ‘새 대화’는 진행 중 요청을 취소하고 빠른 추천을 다시 표시합니다.
- 회원가입·로그인·로그아웃·비밀번호 재설정·닉네임 변경.
- 계정별 메뉴 찜 추가·해제·목록. 추천 화면의 ‘마음에 들어요’ 카드 고정과는 별도입니다.
- 커뮤니티 글 작성·검색·조회·본인 글 수정·삭제, 관리자에 의한 다른 회원 글 삭제. 게시글 줄 전체를 누르면 내용이 펼쳐집니다.
- 음식점 이름·주소 검색과 선택, 정보·메뉴 가격 수정 문의, 음식점 등록, 홍보 신청과 내 처리 내역.
- 관리자 승인·반려, 원자적인 정보 반영·처리 사유·변경 전후 이력. 승인한 홍보는 홈의 가게 소식에 표시합니다.
- 관리자 계정 관리: 이메일·닉네임으로 가입 회원을 검색해 관리자 권한 추가·해제. 마스터 한 계정의 권한은 본인·다른 관리자가 해제할 수 없으며, 마지막 관리자 해제 차단과 권한 변경 이력을 제공합니다.
- 모바일 하단 메뉴, 검색을 먼저 보여주는 홈, 둔산동 옆 `?` 사용법 말풍선, 신청 상태 표시와 한국어 오류 안내를 제공합니다.
- 하단 링크에서 이용약관·개인정보처리방침·데이터 출처 화면으로 이동합니다. 정책 화면은 로그인 없이 열고 직접 URL로 접속할 수 있습니다.
- 네이버 지도·출발지를 비워 둔 길찾기, 결과 자동 스크롤, AI 성공 알림 3초 표시, 모바일 화면.

## 실행

Node.js 22.12 이상(권장 24)이 필요합니다. 프로젝트 루트에서 실행합니다.

```sh
npm ci
cp .env.example .env.local
# .env.local의 Supabase 공개 키와 네이버 지도 클라이언트 ID를 설정
npm run dev
```

주소는 `http://localhost:5173`입니다. PowerShell 복사 명령은 `Copy-Item .env.example .env.local`입니다.

| 브라우저 공개 설정 | 용도 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase API URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 공개용 publishable 키(legacy anon도 가능) |
| `VITE_NAVER_MAP_CLIENT_ID` | 네이버 지도 공개 클라이언트 ID |

Gemini 키와 Supabase service-role 키를 `VITE_` 변수·웹 소스에 넣지 않습니다. AI 키는 Supabase **Edge Functions → Secrets**의 `GEMINI_API_KEY`로 등록합니다. 선택 설정은 `GEMINI_MODEL`, `ALLOWED_ORIGINS`(쉼표로 구분한 접속 origin)입니다.

## DB·배포

연결 대상은 Supabase **BOB-Pick**, ref `rllfxdybuncooswotccs`입니다. 기존 CSV에서 음식점 808곳·메뉴 5,086개를 분리했습니다. CSV 원문은 변경하지 않았으며 기존 열의 값은 `restaurants.source_fields`에 보존하고 검색 필드는 별도 컬럼으로 저장합니다.

설치·회원키 관계·관리자 지정·Auth 리디렉션·지도 도메인은 [배포 문서](docs/cloud-deployment.md)에 정리했습니다.

Vercel Root Directory는 **프로젝트 루트**, Framework는 Vite, Build Command는 `npm run build`, Output Directory는 `dist`입니다. `web`을 Root Directory로 설정하지 않습니다.

## 코드 구성

| 경로 | 역할 |
| --- | --- |
| `web/src/legacy.js`, `style.css` | 기존 추천·지도·고정·스크롤·알림 화면 이전 |
| `web/src/bridge.ts` | 화면 요청을 Supabase RPC·AI 서버에 연결 |
| `web/src/auth.ts`, `favorites.ts`, `community.ts`, `requests.ts` | 회원·찜·커뮤니티·신청·관리자 UI |
| `supabase/migrations` | 테이블·권한·추천·승인·이력 함수 |
| `supabase/seed.sql` | 초기 CSV 데이터. 기존 행은 덮어쓰지 않음 |
| `supabase/functions/ai-recommend` | 로그인 검증·사용량 제한·Gemini 조건 해석·후보 선택 |
| `scripts/export_cloud.py`, `CloudExport.java` | Java의 실제 메뉴 파서를 사용하는 이전 도구 |

가격은 앞에서부터 메뉴와 연결하며 부족한 뒤쪽은 ‘가격 표시 없음’입니다. ‘변동’이 있으면 숫자가 붙어도 ‘변동가격’으로 표시하고 가격 조건에서 제외합니다. 종류는 CSV 등록값, 형태는 등록 형태 안에서 개별 메뉴에 연결한 값을 유지합니다. 영업시간은 기존 Java와 동일하게 휴게시간·익일 마감·정기휴무·공휴일을 처리합니다.

## 검증

```sh
npm run build
npm run check:edge
npm test
npm run test:browser
```

DB 테스트는 PostgreSQL 엔진 PGlite에서 마이그레이션과 원본 데이터를 실행합니다. 계정 간 권한, 관리자 작업 거부, 승인·이력의 원자성, 실제 미향일식·태평소국밥 사례를 확인합니다. 영업시간은 JDK 21로 기존 Java와 24,420개 경우를 비교합니다. Java는 이전·비교 테스트에 사용하며 웹 빌드에는 필요하지 않습니다.

브라우저 테스트는 로컬 Auth/PostgREST 대역과 PostgreSQL/RLS를 연결합니다. 실제 메일 발송·Gemini 응답·지도 인증은 서비스 설정 후 별도로 확인합니다. Playwright 브라우저가 없으면 `npx playwright install chromium`을 먼저 실행합니다.
