// 로그인 페이지
// 의존: config.js, supabase-js, db.js, util.js, auth.js

(function () {
  renderHeader("home");
  initAuth();

  var form = document.getElementById("login-form");
  var usernameInput = document.getElementById("login-username");
  var passwordInput = document.getElementById("login-password");
  var submitBtn = document.getElementById("login-submit");
  var signupLink = document.getElementById("signup-link");

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

  // 회원가입 링크에 ?next= 전달
  if (next && signupLink) {
    signupLink.href = "signup.html?next=" + encodeURIComponent(next);
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (!APP_CONFIGURED) {
      showToast("서비스 준비중입니다.", "error");
      return;
    }

    var username = usernameInput.value.trim();
    var password = passwordInput.value;
    if (!username || !password) {
      showToast("아이디와 비밀번호를 입력해주세요.", "error");
      return;
    }

    setBusy(submitBtn, true);
    try {
      await loginUser(username, password);
      window.location.href = safeNext();
    } catch (err) {
      showToast((err && err.message) || "로그인에 실패했습니다.", "error");
      setBusy(submitBtn, false);
    }
  });
})();
