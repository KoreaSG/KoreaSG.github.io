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
