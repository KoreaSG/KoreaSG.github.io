// 회원가입 페이지
// 의존: config.js, supabase-js, db.js, util.js, auth.js

(function () {
  renderHeader("home");
  initAuth();

  var form = document.getElementById("signup-form");
  var usernameInput = document.getElementById("signup-username");
  var passwordInput = document.getElementById("signup-password");
  var password2Input = document.getElementById("signup-password2");
  var regionSelect = document.getElementById("signup-region");
  var submitBtn = document.getElementById("signup-submit");
  var usernameMsg = document.getElementById("username-msg");
  var password2Msg = document.getElementById("password2-msg");
  var loginLink = document.getElementById("login-link");

  var next = getParam("next");

  // 오픈 리다이렉트 방지: '/'로 시작하거나 상대 페이지 이름만 허용
  function safeNext() {
    if (!next) return "index.html";
    if (next.indexOf("//") !== -1 || next.indexOf(":") !== -1 || next.indexOf("\\") !== -1) {
      return "index.html";
    }
    if (next.charAt(0) === "/") return next;
    if (/^[\w./-]+\.html(\?.*)?$/.test(next)) return next;
    return "index.html";
  }

  // 로그인 링크에 ?next= 전달
  if (next && loginLink) {
    loginLink.href = "login.html?next=" + encodeURIComponent(next);
  }

  // 지역 select 채우기
  var regionHtml = '<option value="">지역 선택</option>';
  REGIONS.forEach(function (r) {
    regionHtml += '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + "</option>";
  });
  regionSelect.innerHTML = regionHtml;

  function setFieldMsg(el, message, type) {
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.className = "field-msg";
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.className = "field-msg " + (type === "ok" ? "is-ok" : "is-error");
  }

  // --- 아이디: 실시간 소문자 변환 + 사용 가능 여부 확인 ---
  var checkTimer = null;
  var checkSeq = 0;

  usernameInput.addEventListener("input", function () {
    var lower = usernameInput.value.toLowerCase();
    if (lower !== usernameInput.value) {
      var pos = usernameInput.selectionStart;
      usernameInput.value = lower;
      try { usernameInput.setSelectionRange(pos, pos); } catch (e) {}
    }
    setFieldMsg(usernameMsg, "", "");
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkUsername, 500);
  });

  usernameInput.addEventListener("blur", function () {
    clearTimeout(checkTimer);
    checkUsername();
  });

  async function checkUsername() {
    var value = usernameInput.value.trim();
    if (!value) {
      setFieldMsg(usernameMsg, "", "");
      return;
    }
    if (!USERNAME_RE.test(value)) {
      setFieldMsg(usernameMsg, "아이디는 영문 소문자/숫자/_ 3~20자입니다.", "error");
      return;
    }
    if (!APP_CONFIGURED || !sb) return;

    var seq = ++checkSeq;
    try {
      var res = await sb.rpc("username_available", { p_username: value });
      // 입력이 바뀌었으면 결과 무시
      if (seq !== checkSeq || value !== usernameInput.value.trim()) return;
      if (res.error) {
        setFieldMsg(usernameMsg, mapRpcError(res.error), "error");
        return;
      }
      if (res.data) {
        setFieldMsg(usernameMsg, "사용 가능한 아이디입니다.", "ok");
      } else {
        setFieldMsg(usernameMsg, "이미 사용 중인 아이디입니다.", "error");
      }
    } catch (err) {
      if (seq === checkSeq) setFieldMsg(usernameMsg, "", "");
    }
  }

  // --- 비밀번호 확인 일치 검사 ---
  function checkPasswordMatch() {
    if (!password2Input.value) {
      setFieldMsg(password2Msg, "", "");
      return;
    }
    if (passwordInput.value === password2Input.value) {
      setFieldMsg(password2Msg, "비밀번호가 일치합니다.", "ok");
    } else {
      setFieldMsg(password2Msg, "비밀번호가 일치하지 않습니다.", "error");
    }
  }
  passwordInput.addEventListener("input", checkPasswordMatch);
  password2Input.addEventListener("input", checkPasswordMatch);

  // --- 제출 ---
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (!APP_CONFIGURED) {
      showToast("서비스 준비중입니다.", "error");
      return;
    }

    var username = usernameInput.value.trim();
    var password = passwordInput.value;
    var password2 = password2Input.value;
    var region = regionSelect.value;

    if (!USERNAME_RE.test(username)) {
      showToast("아이디는 영문 소문자/숫자/_ 3~20자입니다.", "error");
      usernameInput.focus();
      return;
    }
    if (password.length < 6) {
      showToast("비밀번호는 6자 이상이어야 합니다.", "error");
      passwordInput.focus();
      return;
    }
    if (password !== password2) {
      showToast("비밀번호가 일치하지 않습니다.", "error");
      password2Input.focus();
      return;
    }
    if (!region) {
      showToast("지역을 선택해주세요.", "error");
      regionSelect.focus();
      return;
    }

    setBusy(submitBtn, true);
    try {
      await signupUser(username, password, region);
      showToast("가입 완료!", "success");
      setTimeout(function () {
        window.location.href = safeNext();
      }, 600);
    } catch (err) {
      showToast((err && err.message) || "가입에 실패했습니다.", "error");
      setBusy(submitBtn, false);
    }
  });
})();
