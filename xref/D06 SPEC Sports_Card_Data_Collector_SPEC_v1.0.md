# Sports Card Data Collector — 기술명세서

버전: 1.0 · 작성일: 2026-10-06 · 작성: NextPlatform · 용도: 바이브코딩 6일차 실습 및 코딩 에이전트 구현

## 1. 제품 정의

eBay 공식 Browse API로 스포츠 카드의 현재 판매 매물을 검색하고, 허용된 범위에서 정제·임시 저장하여 탐색할 수 있는 웹앱을 만든다. 거래를 실행하기 전에 상품 데이터 구조, 데이터 품질, API 연결 및 수집 운영을 검증하는 단계다.

**핵심 흐름:** 검색 조건 설정 → eBay 매물 조회 → 선택 데이터 수집 → 카드 속성 정제 → 저장 목록 탐색 → eBay 원문 확인.

- 기술스택: React/Vite + TypeScript, Vercel Functions(Node.js), Neon Postgres.
- 백엔드 작업은 `/api` 서버에서 수행한다. 외부 비밀키와 DB 연결 문자열은 브라우저에 노출하지 않는다.
- 초기 시장은 `EBAY_US`, 응답 언어는 `en-US`, UI는 한국어로 제한한다.
- 본 SPEC의 수량·시간·예산은 제품 설계값이다. eBay가 보장하는 범위나 요금으로 해석하지 않는다.

## 2. 목표와 구현 범위

### 2.1 MVP 목표

1. 선수명·브랜드·연도·카드 번호 등의 검색어로 스포츠 카드 매물을 조회한다.
2. 선택 매물 또는 지정 수량을 수집하고 작업 상태를 기록한다.
3. 출처가 있는 상품 속성과 제목에서 추정한 속성을 구분한다.
4. 누락·중복·묶음 매물·판본 차이를 사용자가 확인하도록 한다.
5. 승인 대기 중에도 독립 제작한 샘플 데이터로 전체 화면과 저장 기능을 실습한다.

### 2.2 기능 우선순위

| 우선순위 | 기능 | 완료 기준 |
|---|---|---|
| P0 | 샘플/실데이터 모드 | 전 화면에 출처 모드 표시, 서로 다른 데이터 영역 사용 |
| P0 | 관리자 로그인 | 비로그인 사용자의 API 호출·DB 조회·수정 차단 |
| P0 | 매물 검색 | 검색어·가격·상태·정렬·페이지 이동 지원 |
| P0 | 수집·저장 | 선택 수집과 최대 200건 작업, 중복 upsert |
| P0 | 목록·상세 | 카드 이미지, 등록 가격, 출처 URL, 수집 시각, 누락 표시 |
| P0 | 정제 | 주요 속성 추출, 출처 기록, 불확실 값은 null 처리 |
| P0 | 작업 기록 | 성공·일부 성공·실패·중단·재개 및 호출 수 확인 |
| P0 | 검색 조건 저장 | 저장 조건으로 다시 검색; 자동 정기 수집은 제외 |
| P0 | 데이터 만료 처리 | 만료 데이터 조회·내보내기 차단 및 삭제 |
| P1 | 기술 품질 요약 | 속성 누락률·중복률·정제 성공률 |
| P1 | CSV/JSON 내보내기 | 샘플에서 기본 지원, 실데이터는 허용 조건 확인 후 활성화 |
| 추후 | 가격 이력·판매 완료·AI | 별도 접근 권한·이용 조건·SPEC 확인 후 추가 |

이번 버전은 결제, 주문, 입찰, 판매 등록, 자동 매매, 차익거래, 가격 추천, 수익 예측, 실거래 시세 차트를 구현하지 않는다. Apify와 웹 스크래핑은 연결하지 않는다. API 실패 시 스크래핑으로 전환하지 않는다.

## 3. eBay 접근과 이용 조건

### 3.1 API 선택

- 현재 매물 검색: Browse API `GET /buy/browse/v1/item_summary/search`.
- 선택 매물 상세: Browse API `GET /buy/browse/v1/item/{item_id}`.
- 인증: Application access token, OAuth client credentials grant.
- 토큰 요청: `POST https://api.ebay.com/identity/v1/oauth2/token`.
- scope: `https://api.ebay.com/oauth/api_scope`.
- Sandbox와 Production 키·호스트를 섞지 않는다. Sandbox는 실제 스포츠 카드 시장 데이터가 아니다.
- 신규 개발자가 Marketplace Insights API를 사용할 수 있다고 가정하지 않는다. Browse 검색에 존재하지 않는 `sold=true` 같은 파라미터를 만들지 않는다.

### 3.2 운영 접근 조건

개발자 계정 생성·Production 키 활성화·해당 Buy API의 운영 접근 조건 및 앱 사용 목적을 확인한다. 단순 키 생성이 운영 사용 승인 완료를 의미하지 않는다. 연결 진단은 토큰 발급과 최소 검색 요청을 각각 검사해 결과를 표시한다.

서비스 목적은 사용자가 eBay 스포츠 카드 매물을 찾아 eBay에서 확인하도록 돕는 것이다. 별도 거래 플랫폼이나 경쟁 데이터 판매 서비스로 확대할 때 기존 API 권한이 그대로 적용된다고 가정하지 않는다.

### 3.3 저장·갱신·내보내기 정책

현재 공개 API 라이선스는 필요한 중간 복사와 최신 정보 표시를 규정하며, 매물 표시 정보는 eBay 정보보다 6시간 이상 오래되어서는 안 된다고 명시한다. 이 6시간은 표시 최신성 조건이며 모든 데이터의 보관 허가 기간을 의미하지 않는다.

- 실데이터의 기본 저장은 앱 사용에 필요한 임시 캐시다. 장기 가격 아카이브는 기본 비활성화한다.
- 설계 기본값: `LIVE_CACHE_TTL_SECONDS=18000`(5시간). 더 짧은 승인 조건이 있으면 그 값을 사용한다.
- TTL 만료 시 데이터를 숨기고 재조회 버튼을 제공한다. 오래된 매물을 단순히 '오래됨' 배지로 계속 노출하지 않는다.
- 목록·상세·다운로드 모두 서버에서 만료를 검사한다. 클라이언트가 열려 있어도 만료 시 화면에서 제거한다.
- 인증된 삭제 작업과 Vercel Cron을 연결해 캐시를 정리한다. Cron 주기는 배포 플랜에서 허용되는 간격으로 설정하고, 조회 차단을 Cron 실행 여부에 의존시키지 않는다.
- 상품을 갱신하면 현재 캐시를 교체한다. 과거 실데이터 가격은 기본적으로 누적하지 않는다.
- 실데이터 대량 CSV/JSON 다운로드는 기본 비활성화한다. 해당 사용 목적의 허용 근거를 운영자가 확인한 뒤 서버 설정으로 활성화한다. 파일 생성도 승인 범위와 만료 규칙을 따른다.
- 판매자 이메일·주소·연락처는 수집하지 않는다. seller username 등도 기본 저장·내보내기에서 제외한다.
- account deletion/closure notification의 적용 여부 또는 공식 면제 조건을 확인하고 필요한 경우 처리 엔드포인트를 배포한다. '읽기 API니까 적용 안 됨'이라고 단정하지 않는다.
- eBay 데이터를 AI 학습에 사용하지 않는다. 향후 OpenAI 분석 연결은 이용 조건과 데이터 전송 범위를 별도로 검토한다.

## 4. 사용자와 화면

MVP는 관리자 1명이 사용하는 단일 워크스페이스다. 강의에서는 학습자별 별도 배포·키를 사용하거나 관리자 화면을 시연한다. 공개 회원가입·다중 고객 서비스는 후속 범위다.

| 화면 | 주요 구성 |
|---|---|
| 로그인 | 관리자 비밀번호, 오류 및 시도 제한 안내 |
| 검색·수집 | 모드 배지, 검색어, 필터, 연결 상태, 예산, 결과 표, 수집 버튼 |
| 저장 데이터 | 필터·정렬·페이지 이동, 만료 제외, 선택 삭제, 내보내기 |
| 카드 상세 | 이미지, 원문 제목, 등록 가격, 상품 속성, 속성 출처, eBay 링크 |
| 수집 작업 | 진행 건수, 호출 수, 누락·실패 건수, 중단·재개 버튼 |
| 설정 | API 연결 진단, 저장 조건, 캐시 정책, 기능 활성화 상태 |

디자인: 밝은 배경, 네이비·블루 강조색, 데스크톱 표 중심. 모바일에서는 결과를 세로 카드로 전환한다. 상단에 '등록 가격 기준 · 판매 완료 이력 미포함'을 표시한다. 버튼과 테이블은 키보드로 조작 가능해야 한다.

이미지는 원격 URL로 표시하고 실패 시 중립 플레이스홀더를 사용한다. 이미지 바이너리를 자체 저장하지 않는다. 외부 링크는 API에서 받은 eBay URL의 허용 호스트를 검증하고 새 창에서 연다. HTML 설명은 MVP에서 표시하지 않는다.

## 5. 검색·필터 정책

### 5.1 검색 입력

- 검색어: 2~200자. 예시 `Shohei Ohtani Topps Chrome 2024`, `Stephen Curry Panini Prizm PSA 10`.
- 스포츠 종목·선수·브랜드·연도는 사용자 입력을 조합해 검색어를 만드는 보조 입력이다. 제목 검색만으로 정확한 판본을 보장하지 않는다.
- 가격: 0 이상의 min/max, min ≤ max. 검색 가격 통화는 USD로 제한한다.
- 정렬: 기본 관련도, 가격순, 신규 등록순, 종료 임박순. 실제 Browse API 허용 enum으로 매핑한다.
- 매물 상태: 전체·등급 있음·미등급. category별 실제 condition 값으로 매핑하며 Mint/PSA 10을 일반 condition enum처럼 전송하지 않는다.
- MVP 구매 방식: 고정가 우선. `buyingOptions:{FIXED_PRICE}`로 제한해 가격 비교 의미를 명확히 한다. 경매 수집은 후속 기능이다.
- 페이지 기본 50건, 앱 최대 100건. eBay가 허용하는 페이지·결과 한도는 현재 공식 문서로 확인하고 어댑터 상수에 기록한다. 전체 eBay 시장 수집을 보장하지 않는다.

스포츠 카드 카테고리는 marketplace별 category tree에서 확인한다. Category ID를 다른 국가에 재사용하지 않는다. 초기 배포에는 검증된 EBAY_US 카테고리 allowlist와 확인일을 설정 파일에 기록하고, 확인되지 않으면 live 검색을 막는다. taxonomy API 연동은 초기 설정 도구로 선택 구현할 수 있다.

### 5.2 두 종류의 필터

- 서버 검색 필터: eBay가 실제 지원하는 category, price, condition, buyingOptions 등.
- 저장 데이터 필터: 정제된 선수·브랜드·연도·grader·grade·카드 번호·품질 상태.
- eBay aspect 필터는 해당 category에서 확인된 aspect 이름·값만 사용한다. 불가능한 조건은 검색어 또는 저장 데이터 필터임을 UI에 표시한다.

## 6. 데이터 모델·정제 규칙

### 6.1 Listing 필드

| 필드 | 형식 | 규칙 |
|---|---|---|
| id | UUID | 앱 내부 식별자 |
| source_mode | enum | mock / live / sandbox |
| marketplace_id, ebay_item_id | text | 출처 시장 + Browse itemId; itemId는 문자열 그대로 보존 |
| legacy_item_id | nullable text | API에 있으면 저장; 숫자형 변환 금지 |
| title, item_url, image_url | text | 원문 제목과 검증된 URL |
| category_id, condition_id, condition_label | nullable text | API 반환값 |
| buying_options | jsonb | API 반환 구매 방식 |
| asking_price, currency | numeric(18,4), text | 등록 가격과 원래 통화; 금융 계산에 float 사용 금지 |
| shipping_cost, shipping_currency | nullable numeric/text | 반환된 배송 옵션의 해당 금액; 없으면 null |
| shipping_context | nullable jsonb | 배송 국가·우편번호·선택 서비스; 이용 조건에 필요한 최소값만 |
| location_country | nullable text | 상품 위치 국가 |
| sport, player, team, manufacturer | nullable text | 명시된 상품 속성 우선 |
| set_name, card_number, season_year | nullable text | 제목의 숫자를 연도·번호로 무조건 해석하지 않음 |
| parallel_variant, language | nullable text | 판본 구분; 누락 시 동일 카드 확정 금지 |
| graded, grader, grade, certification_number | nullable | grade는 문자열, graded는 true/false/null |
| is_lot, is_reprint, match_status | boolean/enum | 묶음·복각·확인 필요 여부 |
| aspects, condition_descriptors | jsonb | 허용된 속성·상태 원문 구조 |
| field_provenance, normalization_warnings | jsonb | 필드별 출처와 충돌·누락 기록 |
| detail_status | enum | not_requested / pending / complete / failed |
| observed_at, expires_at | timestamptz | 마지막 관측과 표시 만료 |

`sold_price`, `sold_at`, `sales_volume`, `market_value`는 이번 스키마에 넣지 않는다. 등록 가격 관측만으로 판매량·시세·판매 완료를 만들어내지 않는다.

### 6.2 정제 순서

1. `getItem`에서 반환되는 `localizedAspects`, `conditionDescriptors`를 우선 사용한다. 필드가 없는 응답도 정상 처리한다.
2. 구조화된 값이 없을 때만 제한된 사전·정규식으로 제목을 분석한다.
3. 각 값에 `api_aspect`, `api_condition`, `title_rule`, `manual` 출처를 기록한다. 제목 추정은 UI에서 '추정'으로 표시한다.
4. 상충하면 원문을 유지하고 `needs_review` 처리한다. PSA/BGS/SGC/CGC 등 기관명과 등급·인증번호를 구분한다.
5. lot, bulk, box, pack, reprint, replica 같은 후보를 표시한다. 제목 규칙은 확정 판정이 아니므로 검토 가능해야 한다.
6. `PSA 10`이라는 제목을 독립적인 진품·등급 인증으로 간주하지 않는다. eBay 판매자의 기술 정보와 기관 검증은 다르다.

단일 상품 식별은 `(source_mode, marketplace_id, ebay_item_id)` UNIQUE로 처리한다. 동일 카드의 여러 판매 매물은 삭제하지 않는다. 카드 그룹 키는 선수·세트·연도·번호·판본·언어·상태·기관·등급이 충분할 때만 생성하며, 그룹도 후보임을 표시한다.

배송비 미반환은 무료 배송이 아니다. 같은 통화와 배송 목적지가 확인될 때만 `asking_price + shipping_cost`를 '상품+표시 배송비'로 표시한다. 세금·관세·환전·최종 결제금액은 포함하지 않는다.

## 7. Neon DB 구조

Drizzle ORM + SQL migrations를 사용한다. 런타임은 Neon의 서버리스 연결 방식에 맞추고, DB 접근은 서버에서만 한다.

| 테이블 | 역할·핵심 제약 |
|---|---|
| saved_searches | 검색 조건 JSON, 이름, source_mode, 생성·수정 시각 |
| listings | 위 매물 모델; 출처 복합 UNIQUE, 모드·만료·가격 인덱스 |
| collection_jobs | 조건 스냅샷, 상태, max_items, cursor, 호출·저장·실패 건수, lease, next_retry_at |
| collection_job_items | job_id + listing_id UNIQUE; 처리 결과·간략 오류 코드 |
| api_usage_daily | provider + API family + UTC date UNIQUE; 원자적 예산 예약·호출 집계 |
| admin_sessions | 해시된 세션 식별자, 만료 시각; 비밀 원문 금지 |

job 상태: `queued → running → completed / partial / failed / cancelled` 및 `paused`.
매물 삭제·만료 시 연결 테이블과 job 오류 메시지에 남은 상품 내용도 정리한다. 오래된 작업에는 집계·오류 코드만 유지한다. 원본 API 전체 JSON, 비밀키, OAuth 토큰, seller 개인정보는 로그·DB에 통째로 보관하지 않는다.

## 8. API 서버 계약

모든 데이터 API는 관리자 세션을 확인한다. 입력은 Zod로 검증한다. DB 결과 페이지 기본 50건·최대 100건. 브라우저에서 eBay API를 직접 호출하지 않는다.

| Method / 경로 | 요청·응답 |
|---|---|
| POST /api/auth/login | password → HttpOnly 세션 쿠키 |
| POST /api/auth/logout | 세션 폐기 |
| GET /api/status | 모드, 연결 상태, 기능 플래그, 호출 예산; 비밀 제외 |
| POST /api/ebay/connection-test | 토큰·검색 진단; 결과 캐시, 관리자 전용 |
| POST /api/ebay/search | 검색 조건·페이지 → item summaries, totalHint, nextPage, warnings |
| GET /api/listings | 모드·필터·페이지 → 저장 매물 목록 |
| GET /api/listings/:id | 유효한 캐시 상세 |
| POST /api/listings/:id/refresh | 매물 상세 갱신, 비활성/삭제/권한 오류 구분 |
| POST /api/collection-jobs | 조건 또는 선택 ID, maxItems, idempotency key → jobId |
| GET /api/collection-jobs/:id | 진행 상태·카운터 |
| POST /api/collection-jobs/:id/step | 제한된 수집 단위 실행 → 상태와 다음 처리 정보 |
| POST /api/collection-jobs/:id/cancel | 중단 요청, 이미 저장된 결과 유지 |
| POST /api/collection-jobs/:id/resume | 만료 lease 회수·중단 지점부터 재개 |
| GET/POST/DELETE /api/saved-searches | 저장 검색 관리; DELETE에는 id 명시 |
| POST /api/exports | 필터·format → 허용된 데이터 CSV/JSON; 금지 시 403 |
| DELETE /api/listings/:id | 저장 캐시 삭제 |
| POST /api/maintenance/purge | Cron secret 검증 후 만료 데이터 삭제 |

성공 형식: `{ data, meta: { sourceMode, observedAt, requestId }, warnings }`.
오류 형식: `{ error: { code, message, retryable }, requestId }`.
code 예: `AUTH_REQUIRED`, `EBAY_ACCESS_NOT_READY`, `EBAY_RATE_LIMITED`, `ITEM_UNAVAILABLE`, `CACHE_EXPIRED`, `EXPORT_NOT_ENABLED`, `VALIDATION_ERROR`.

DB id로 상세를 조회한다. 외부 itemId를 URL 경로에 사용할 때는 인코딩하고 임의 호스트·URL을 받지 않는다. 필터·정렬은 allowlist로 매핑하고 SQL 문자열에 사용자 값을 직접 연결하지 않는다.

## 9. 수집 실행과 운영 안정성

### 9.1 실행 설계

Vercel 요청이 끝난 뒤 메모리에서 계속 실행되는 백그라운드 작업을 만들지 않는다.

1. job 생성 시 maxItems 기본 50, 최대 200; 브라우저별 임의 무제한 수집 금지.
2. 화면은 `step`을 순차 호출한다. 서버는 각 요청에서 검색 페이지 1개 또는 상세 최대 5건을 처리한다.
3. 상세는 제한 동시성 2로 조회한다. 요청 시간 예산은 배포 함수 제한보다 짧게 설정하며 초기 목표는 20초다.
4. DB의 원자적 lease로 동일 job의 동시 실행을 막는다. lease 만료 후 재개 가능하다.
5. 결과 upsert·job_item 생성·cursor 확정은 DB 트랜잭션으로 처리한다. 동일 step 재요청은 동일 결과로 수렴한다.
6. summary 저장 이후 상세 실패는 해당 항목만 failed 처리하고 원문 summary를 보존한다. 일부 실패는 partial로 마친다.
7. 브라우저 종료 시 처리를 멈추고 paused로 표시한다. 다시 열면 재개한다. 자동 무인 지속 실행은 후속 큐·worker 범위다.

일단 페이지를 수집해 검색 결과 ID를 확정한 뒤 상세 처리를 한다. 실시간 검색의 offset 이동 중 매물이 변할 수 있으므로 중복 제거는 해도 완전한 시장 스냅샷이라고 표현하지 않는다.

### 9.2 OAuth·호출 예산

- OAuth의 `expires_in`을 사용하고 만료 60초 전에 새 토큰을 발급한다.
- 메모리 캐시는 최적화일 뿐이다. 서버리스 새 인스턴스에서는 재발급 가능해야 하며 영속 메모리를 가정하지 않는다.
- 401은 토큰 갱신 후 1회 재시도. 403은 운영 권한·앱 상태 오류로 표시하고 반복하지 않는다.
- 429는 Retry-After를 존중하고 job에 next_retry_at을 기록한다. 장시간 함수 안에서 대기하지 않는다.
- 5xx·네트워크 오류는 지수 백오프·jitter, 최대 2회 추가 시도. 모든 시도를 예산에 반영한다.
- 초기 앱 내부 Browse 예산 500회/UTC일. eBay 승인된 실제 한도보다 낮게 설정하고, 검색·상세·진단·재시도를 합산한다.
- 분산 함수의 예산 집계는 Neon에서 원자적으로 예약한다. 외부 사용량은 eBay 실제 한도에 별도 반영될 수 있으므로 앱 집계를 공식 잔여량으로 표현하지 않는다.
- 50건 수집: 검색 1회 + 상세 50회 = 약 51회. 200건·검색 페이지 100건: 약 202회. OAuth·taxonomy·재시도는 별도 고려한다.
- 앱 페이지 캐시 5분을 적용하되 전체 표시 TTL을 넘기지 않는다. 검색 매물 total은 '검색 결과 참고치', 수집 건수는 '실제 확보 건수'로 구분한다.

## 10. 보안과 데이터 내보내기

- 관리자 비밀번호는 강한 해시로 서버에 저장하고 로그인 IP·세션 시도 제한을 적용한다.
- 세션 쿠키는 HttpOnly, Secure(배포), SameSite=Lax. 변경 API는 Origin 검증과 CSRF 방어를 적용한다.
- 공개 GET 조회를 포함한 모든 관리 데이터 API에 인증·만료 검사를 적용한다.
- key·token·Authorization·cookie·DB URL은 로그에서 마스킹한다.
- 결과 텍스트는 React 기본 escaping으로 렌더링한다. `dangerouslySetInnerHTML`을 사용하지 않는다.
- CSV는 UTF-8 BOM, 적절한 quoting, `=`, `+`, `-`, `@`로 시작하는 텍스트의 수식 삽입 방어를 적용한다. JSON은 정규화된 필드만 제공한다.
- 내보내기는 서버에서 기능 플래그와 데이터 허용 기간을 다시 검사한다. API 전체 원본 dump와 판매자 개인정보는 제외한다.
- 샘플·실데이터 사이 전환 시 Query 캐시를 분리한다. sample 자료가 eBay 실시간 결과로 보이지 않게 한다.

## 11. 기술스택·프로젝트 구조

| 영역 | 선택 |
|---|---|
| 프론트 | React, Vite, TypeScript |
| UI | Tailwind CSS, shadcn/ui 선택, lucide-react |
| 상태·조회 | TanStack Query, React 상태; job 상태는 DB가 기준 |
| 백엔드 | Vercel Node.js Functions, 로컬 Vercel dev |
| 검증·DB | Zod, Drizzle ORM, Neon Postgres |
| 숫자·날짜 | decimal.js 또는 정확한 decimal 연산, UTC 저장·Asia/Seoul 표시 |
| 테스트 | Vitest, 핵심 수집 경로 통합 테스트 |
| 배포 | GitHub 소스, Vercel 실행, Neon DB |

```text
api/                     # thin HTTP handlers; Vercel routing에 맞게 파일 배치
src/
  app/                   # 화면 라우팅·provider
  features/
    auth/
    search/
    listings/
    collections/
    settings/
  components/
  lib/api-client.ts
  types/
server/
  auth/
  ebay/                  # oauth, browse, mapping, retry, category config
  collections/           # lease, cursor, step runner
  db/                    # schema, queries
  normalization/
  policies/              # mode, retention, exports
  mocks/                 # 독립 제작 fixtures
drizzle/                 # migrations
tests/
docs/
.env.example
vercel.json
```

server 디렉토리는 브라우저 번들에서 import하지 않는다. TypeScript 경로·tsconfig를 구분하고 번들 검사로 비밀 모듈 포함을 확인한다. `/api`에는 SPA rewrite를 적용하지 않고, 화면 경로에만 index.html fallback을 설정한다.

## 12. 환경변수·샘플·로컬 실행

```dotenv
DATABASE_URL=
ADMIN_PASSWORD_HASH=
SESSION_SECRET=
CRON_SECRET=
DATA_MODE=mock
EBAY_ENV=production
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_SPORTS_CATEGORY_IDS=
EBAY_DAILY_BUDGET=500
LIVE_CACHE_TTL_SECONDS=18000
ENABLE_LIVE_EXPORT=false
```

API base와 scope는 서버 allowlist 상수로 관리한다. 위 비밀값에는 `VITE_` 접두사를 붙이지 않는다. `.env.example`에 실제 값은 넣지 않는다.

샘플 60건: 야구·농구·축구 각 20건. 서로 다른 가격·상태·기관·등급·판본·배송 누락·묶음·속성 충돌을 포함한다. 가상의 제목·가격·ID를 독립 작성하고 eBay 원문을 변형해 샘플을 만들지 않는다. 로컬 플레이스홀더 이미지와 `source_mode=mock`를 사용한다. 샘플에서는 실제 eBay item 링크를 만들지 않는다.

필수 npm scripts: `dev`, `build`, `preview`, `typecheck`, `test`, `db:generate`, `db:migrate`, `seed:mock`.

- `npm run dev`: 프론트 화면 개발. `/api`가 필요한 전체 실행은 `npx vercel dev`로 안내한다.
- 서버 env를 로컬 파일과 Vercel Preview/Production에 각각 설정한다.
- `npm run db:migrate` 후 `npm run seed:mock` 실행.
- `npm run typecheck`, `npm test`, `npm run build`를 통과한 후 배포한다.
- 운영 승인 준비가 완료되면 DATA_MODE=live로 전환한다. 실데이터 오류를 자동 mock 성공으로 대체하지 않는다.

## 13. 핵심 검증·인수 기준

| 검증 | 통과 조건 |
|---|---|
| 샘플 시나리오 | 비밀키 없이 검색·수집·재개·저장·내보내기가 작동하고 샘플 표시 |
| API 인증 | 토큰 오류·운영 접근 미승인을 구분; 키가 브라우저·로그에 없음 |
| 검색 | 유효한 category·filters 사용, 빈 결과·API 누락값 정상 처리 |
| 정제 | 구조화 속성 우선, 제목 추정 표시, 상충·묶음 검토 표시 |
| 중복 | 동일 job step을 두 번 실행해도 매물·작업 항목 중복 없음 |
| 서버리스 재개 | 인스턴스·브라우저 재시작 후 cursor·lease로 재개 가능 |
| 호출 제한 | 동시 수집에서 예산 초과 차단, 429 재시도 시점 저장 |
| 만료 | 만료 데이터가 목록·상세·다운로드·열려 있는 화면에 노출되지 않음 |
| 권한 | 로그인 없이 조회·수집·삭제·다운로드 불가 |
| 가격 | 등록 가격 명시, 배송 미상은 null, 통화 다른 합산 차단 |
| 실데이터 내보내기 | 기본 403; 허용 설정과 기간 검사 후에만 생성 |
| 배포 | Vercel API/SPA 경로 정상, Neon migration 적용, Preview 환경 분리 |

테스트는 응답 매핑, 정책·인증, 수집 idempotency·재개·예산 예약처럼 실패 시 영향이 있는 경로에 집중한다. 라이브 API 테스트는 승인된 환경에서 관리자 검색 1회·상세 1회·소량 수집으로 제한하고 자동 CI에서 호출하지 않는다.

## 14. 구현 순서와 산출물

1. 프로젝트·DB·관리자 인증·환경변수 설정.
2. 샘플 어댑터와 검색·목록·상세 UI.
3. OAuth·Browse 어댑터와 연결 진단.
4. 상품 속성 정제·저장·만료 정책.
5. 수집 job·step·중단·재개·사용량 예산.
6. 검색 조건 저장·품질 요약·조건부 내보내기.
7. 핵심 테스트·README·GitHub·Vercel 배포.

코딩 에이전트는 전체 실행 가능한 소스, SQL migrations, 샘플 seed, `.env.example`, README, API 예시, 테스트를 제공한다. 미승인 live 기능·disabled 기능은 README에 상태와 활성화 조건을 기록한다. OpenAI·판매 완료·매매 기능을 임의로 추가하지 않는다.

제품 footer: `Developed by Jun · NextPlatform | React · Vite · TypeScript · Vercel / Built with Codex · SPEC with ChatGPT | Version 1.0.0 · © 2026`.

## 15. 공식 참고문서

2026-10-06 확인. 배포 전 현재 문서·승인 조건을 다시 확인한다.

- Browse API: https://developer.ebay.com/api-docs/buy/api-browse.html
- Search reference: https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
- getItem reference: https://developer.ebay.com/api-docs/buy/browse/resources/item/methods/getItem
- OAuth authorization: https://developer.ebay.com/develop/guides/sell/authorization
- Buy API requirements: https://developer.ebay.com/api-docs/buy/buy-requirements.html
- API call limits: https://developer.ebay.com/develop/get-started/api-call-limits
- Marketplace Insights access restriction: https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html
- API license agreement: https://developer.ebay.com/join/api-license-agreement
- Marketplace account deletion setup: https://developer.ebay.com/support/knowledge-base/5196

실제 API 구현에서는 본 문서의 설계값과 공식 API의 현재 제한을 구분하고, 최신 공식 명세를 기준으로 파라미터와 응답 필드를 검증한다.
