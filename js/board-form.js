// 커뮤니티 글 작성/수정 페이지
// 의존: config.js → supabase-js → db.js → util.js
// 수정 모드: board-view.html에서 비밀번호 검증 후 sessionStorage("edit_pw_post_<id>")를 설정해야 진입 가능

(function () {
  renderHeader("board");

  var noticeEl = document.getElementById("board-notice");
  var form = document.getElementById("post-form");
  var pageTitle = document.getElementById("page-title");
  var titleInput = document.getElementById("post-title");
  var authorGroup = document.getElementById("author-group");
  var authorInput = document.getElementById("post-author");
  var contentInput = document.getElementById("post-content");
  var passwordGroup = document.getElementById("password-group");
  var passwordInput = document.getElementById("post-password");
  var submitBtn = document.getElementById("submit-btn");
  var cancelLink = document.getElementById("cancel-link");

  if (!APP_CONFIGURED) {
    noticeEl.hidden = false;
    noticeEl.textContent = "서비스 준비중입니다";
    form.hidden = true;
    return;
  }

  var postId = getParam("id");
  var isEdit = !!postId;
  var editPw = null;

  if (isEdit) {
    editPw = sessionStorage.getItem("edit_pw_post_" + postId);
    if (!editPw) {
      // 비밀번호 검증 없이 진입한 경우 상세 페이지로 되돌림
      window.location.replace("board-view.html?id=" + encodeURIComponent(postId));
      return;
    }

    document.title = "글 수정 - KoreaSG";
    pageTitle.textContent = "글 수정";
    submitBtn.textContent = "수정";
    cancelLink.href = "board-view.html?id=" + encodeURIComponent(postId);
    // 작성자 이름은 수정 불가, 비밀번호는 이미 검증됨 → 두 필드 숨김
    authorGroup.hidden = true;
    passwordGroup.hidden = true;

    sb.from("posts_view")
      .select("id, title, content")
      .eq("id", postId)
      .maybeSingle()
      .then(function (res) {
        if (res.error || !res.data) {
          showToast(res.error ? mapRpcError(res.error) : "대상을 찾을 수 없습니다.", "error");
          window.location.replace("board.html");
          return;
        }
        titleInput.value = res.data.title || "";
        contentInput.value = res.data.content || "";
      });
  } else {
    passwordInput.required = true;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var title = titleInput.value.trim();
    var content = contentInput.value.trim();
    if (!title || !content) {
      showToast("제목과 내용을 입력해주세요.", "error");
      return;
    }

    if (isEdit) {
      setBusy(submitBtn, true);
      sb.rpc("update_post", {
        p_id: postId,
        p_password: editPw,
        p_title: title,
        p_content: content
      }).then(function (res) {
        if (res.error) {
          setBusy(submitBtn, false);
          showToast(mapRpcError(res.error), "error");
          return;
        }
        sessionStorage.removeItem("edit_pw_post_" + postId);
        window.location.href = "board-view.html?id=" + encodeURIComponent(postId);
      });
      return;
    }

    var password = passwordInput.value.trim();
    if (!/^\d{4}$/.test(password)) {
      showToast("비밀번호는 숫자 4자리여야 합니다.", "error");
      passwordInput.focus();
      return;
    }

    var params = {
      p_title: title,
      p_content: content,
      p_password: password
    };
    var author = authorInput.value.trim();
    if (author) params.p_author_name = author;

    setBusy(submitBtn, true);
    sb.rpc("create_post", params).then(function (res) {
      if (res.error) {
        setBusy(submitBtn, false);
        showToast(mapRpcError(res.error), "error");
        return;
      }
      window.location.href = "board-view.html?id=" + encodeURIComponent(res.data);
    });
  });
})();
