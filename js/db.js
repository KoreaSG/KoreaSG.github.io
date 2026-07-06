// 전역 Supabase 클라이언트 및 공용 상수
// 로드 순서: config.js → supabase-js(UMD) → db.js

const APP_CONFIGURED = !SUPABASE_URL.includes("__");

const sb = APP_CONFIGURED
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const CATEGORIES = [
  "디지털/가전",
  "가구/인테리어",
  "생활/주방",
  "유아동/장난감",
  "여성패션/잡화",
  "남성패션/잡화",
  "도서/취미/게임",
  "스포츠/레저/골프",
  "뷰티/미용",
  "식품/건강",
  "티켓/상품권",
  "이사/떠나요 세일",
  "기타"
];

const PAGE_SIZE_MARKET = 24;
const PAGE_SIZE_BOARD = 20;

const STORAGE_BUCKET = "item-images";

const ITEM_STATUS = { selling: "판매중", reserved: "예약중", sold: "판매완료" };

// --- 인증(Auth) 공용 상수 ---
const REGIONS = [
  "주롱",
  "부킷티마/클레멘티",
  "우드랜즈/이슌",
  "앙모키오/비샨",
  "세랑군/호우강",
  "풍골/셍캉",
  "탬피니스/파시르리스",
  "베독/이스트코스트",
  "시티/오차드",
  "노비나/토아파요",
  "하버프론트/센토사",
  "기타(싱가포르 내)",
  "싱가포르 외"
];

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const AUTH_EMAIL_DOMAIN = "id.koreasg.app";
