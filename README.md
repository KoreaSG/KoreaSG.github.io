# KoreaSG — 싱가포르 한인 커뮤니티

싱가포르 한인들을 위한 중고거래 · 커뮤니티 사이트입니다.
https://koreasg.github.io/

## 아키텍처

- **프론트엔드**: 순수 HTML/CSS/JS (빌드 없음, 모듈 없음) — GitHub Pages 정적 호스팅
- **백엔드**: Supabase (PostgreSQL + Storage)
- **인증 모델**: 회원가입 없음. 글/매물마다 숫자 4자리 비밀번호를 설정하고,
  수정·삭제 등 모든 쓰기 작업은 **비밀번호를 검증하는 RPC 함수**를 통해서만 수행됩니다.
- `js/config.js`의 **anon key는 공개용 키**이므로 커밋해도 안전합니다.
  실제 보안은 RLS 정책과 RPC가 담당합니다.
- **`service_role` 키와 GitHub PAT는 절대 커밋 금지.**

## 로컬 개발

```bash
npx serve .
```

브라우저에서 표시된 주소(기본 http://localhost:3000)로 접속합니다.

## 배포

`main` 브랜치에 push하면 GitHub Pages가 자동으로 배포합니다.

## Supabase 설정

`supabase/*.sql` 파일을 Supabase SQL Editor에서 **01 → 04 순서대로** 실행한 뒤,
`js/config.js`의 `SUPABASE_URL` / `SUPABASE_ANON_KEY` 값을 프로젝트 값으로 교체합니다.

## 알려진 제한

- 숫자 4자리 비밀번호는 **가벼운 수정 방지 수단**입니다.
  강력한 보안이 필요한 용도가 아닌, 캐주얼한 편집 보호 목적입니다.

## SEO / 검색 등록

사이트에는 페이지별 title·description·canonical·Open Graph 태그, `robots.txt`, `sitemap.xml`, 홈의 JSON-LD(WebSite) 스키마가 적용되어 있습니다. 검색 노출을 위해 아래 등록 작업을 한 번 수행해야 합니다.

### Google Search Console

1. https://search.google.com/search-console 접속 → **URL 접두어(URL-prefix)** 속성으로 `https://koreasg.github.io/` 추가
2. 소유권 확인은 **HTML 태그** 방식 권장:
   - Search Console이 발급하는 `content="..."` 토큰 값을 받아
     `index.html`의 `<head>`에 `<meta name="google-site-verification" content="발급받은토큰">` 형태로 추가 후 push
   - 또는 발급받은 **HTML 파일을 저장소 루트에 업로드**하는 방식도 가능
3. 확인 완료 후 **Sitemaps 메뉴**에서 `sitemap.xml` 제출

### Naver Search Advisor (네이버 서치어드바이저)

교민 대상 사이트 특성상 네이버 검색 유입도 중요합니다.

1. https://searchadvisor.naver.com 접속 → 웹마스터 도구에서 `https://koreasg.github.io/` 사이트 등록
2. 소유권 확인: **HTML 태그** 방식으로 발급받은
   `<meta name="naver-site-verification" content="발급받은토큰">`을 `index.html`의 `<head>`에 추가 (또는 HTML 파일 루트 업로드)
3. 등록 완료 후 **요청 → 사이트맵 제출**에서 `https://koreasg.github.io/sitemap.xml` 제출
