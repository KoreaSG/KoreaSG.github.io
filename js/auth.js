// 인증 공용 모듈 (전역 함수)
// 의존: config.js, supabase-js(UMD), db.js, util.js
// 로드 순서: config → supabase → db → util → auth → [upload] → page.js
//
// 공개 API:
//   initAuth()                          → Promise<profile|null>
//   getProfile()                        → profile|null (캐시)
//   requireLogin()                      → Promise<profile> (미로그인 시 login.html로 리다이렉트)
//   signupUser(username, password, region) → Promise<profile>
//   loginUser(username, password)       → Promise<profile>
//   logoutUser()                        → Promise (로그아웃 후 index.html 이동)

var _authSubscribed = false;

/**
 * 캐시된 프로필 반환 ({id, username, region, is_admin} 또는 null)
 */
function getProfile() {
  return window.currentProfile || null;
}

/**
 * 세션 확인 후 get_my_profile RPC로 프로필 로드 → window.currentProfile 캐시
 * @returns {Promise<Object|null>}
 */
async function _loadProfile() {
  if (!APP_CONFIGURED || !sb) {
    window.currentProfile = null;
    return null;
  }
  try {
    var sess = await sb.auth.getSession();
    var session = sess && sess.data && sess.data.session;
    if (!session) {
      window.currentProfile = null;
      return null;
    }
    var res = await sb.rpc("get_my_profile");
    if (res.error) {
      window.currentProfile = null;
      return null;
    }
    window.currentProfile = res.data || null;
  } catch (err) {
    window.currentProfile = null;
  }
  return window.currentProfile;
}

/**
 * 헤더 계정 영역(#nav-account) 렌더링
 * 로그아웃 상태: 로그인 · 회원가입 링크 / 로그인 상태: username님 + 로그아웃 버튼
 */
function _renderAccountArea() {
  var slot = document.getElementById("nav-account");
  if (!slot) return;

  var profile = getProfile();
  if (profile) {
    slot.innerHTML =
      '<span class="nav-user"><b>' + escapeHtml(profile.username) + "</b>님</span>" +
      '<button type="button" class="nav-logout-btn">로그아웃</button>';
    slot.querySelector(".nav-logout-btn").addEventListener("click", function () {
      logoutUser();
    });
  } else {
    slot.innerHTML =
      '<a class="nav-link" href="login.html">로그인</a>' +
      '<a class="nav-link" href="signup.html">회원가입</a>';
  }
}

/**
 * 페이지 진입 시 인증 초기화 — renderHeader() 이후 매 페이지에서 호출
 * 프로필 로드 + 계정 영역 렌더링 + 인증 상태 변화 구독
 * @returns {Promise<Object|null>} 프로필 또는 null
 */
async function initAuth() {
  if (!APP_CONFIGURED || !sb) {
    _renderAccountArea();
    return null;
  }

  var profile = await _loadProfile();
  _renderAccountArea();

  if (!_authSubscribed) {
    _authSubscribed = true;
    sb.auth.onAuthStateChange(function (event, session) {
      // 콜백 내 supabase 호출 데드락 방지를 위해 비동기로 처리
      setTimeout(function () {
        if (!session) {
          window.currentProfile = null;
          _renderAccountArea();
          return;
        }
        var cached = getProfile();
        if (cached && session.user && cached.id === session.user.id) {
          _renderAccountArea();
          return;
        }
        _loadProfile().then(_renderAccountArea);
      }, 0);
    });
  }

  return profile;
}

/**
 * 로그인 필수 페이지용 — 미로그인 시 login.html?next=현재경로 로 이동
 * @returns {Promise<Object>} 프로필 (미로그인 시 resolve되지 않음)
 */
function requireLogin() {
  return new Promise(function (resolve) {
    var cached = getProfile();
    var p = cached ? Promise.resolve(cached) : _loadProfile();
    p.then(function (profile) {
      if (profile) {
        resolve(profile);
        return;
      }
      var next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = "login.html?next=" + next;
      // 리다이렉트 — 의도적으로 resolve하지 않음
    });
  });
}

/**
 * 회원가입: 입력 검증 → 아이디 중복 확인 → signUp → 프로필 로드
 * 실패 시 한국어 메시지의 Error를 throw
 * @returns {Promise<Object>} 프로필
 */
async function signupUser(username, password, region) {
  username = String(username || "").trim().toLowerCase();
  password = String(password || "");
  region = String(region || "");

  if (!USERNAME_RE.test(username)) {
    throw new Error("아이디는 영문 소문자/숫자/_ 3~20자입니다.");
  }
  if (password.length < 6) {
    throw new Error("비밀번호는 6자 이상이어야 합니다.");
  }
  if (!region || REGIONS.indexOf(region) === -1) {
    throw new Error("지역을 선택해주세요.");
  }
  if (!APP_CONFIGURED || !sb) {
    throw new Error("서비스 준비중입니다.");
  }

  var avail = await sb.rpc("username_available", { p_username: username });
  if (avail.error) throw new Error(mapRpcError(avail.error));
  if (!avail.data) throw new Error("이미 사용 중인 아이디입니다.");

  var res = await sb.auth.signUp({
    email: username + "@" + AUTH_EMAIL_DOMAIN,
    password: password,
    options: { data: { username: username, region: region } }
  });
  if (res.error) {
    var msg = res.error.message || "";
    if (msg.indexOf("already registered") !== -1 || msg.indexOf("Database error") !== -1) {
      throw new Error("이미 사용 중인 아이디입니다.");
    }
    throw new Error("가입에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }

  var profile = await _loadProfile();
  _renderAccountArea();
  if (!profile) {
    throw new Error("가입은 완료되었으나 프로필을 불러오지 못했습니다. 다시 로그인해주세요.");
  }
  return profile;
}

/**
 * 로그인: signInWithPassword → 프로필 로드
 * 실패 시 한국어 메시지의 Error를 throw
 * @returns {Promise<Object>} 프로필
 */
async function loginUser(username, password) {
  username = String(username || "").trim().toLowerCase();
  password = String(password || "");

  if (!APP_CONFIGURED || !sb) {
    throw new Error("서비스 준비중입니다.");
  }
  if (!username || !password) {
    throw new Error("아이디와 비밀번호를 입력해주세요.");
  }

  var res = await sb.auth.signInWithPassword({
    email: username + "@" + AUTH_EMAIL_DOMAIN,
    password: password
  });
  if (res.error) {
    throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
  }

  var profile = await _loadProfile();
  _renderAccountArea();
  if (!profile) {
    throw new Error("프로필을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
  return profile;
}

/**
 * 로그아웃: signOut → 캐시 초기화 → index.html 이동
 */
async function logoutUser() {
  try {
    if (sb) await sb.auth.signOut();
  } catch (err) {
    // 로그아웃 실패해도 로컬 상태는 초기화하고 이동
  }
  window.currentProfile = null;
  window.location.href = "index.html";
}
