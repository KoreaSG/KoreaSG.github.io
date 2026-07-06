// 커뮤니티 글 작성/수정 페이지
// 의존: config.js → supabase-js → db.js → util.js → auth.js
// 로그인 필수 — 수정 모드(?id=)는 본인 글(is_mine)만 진입 가능

(function () {
  renderHeader("board");
  initAuth();

  var noticeEl = document.getElementById("board-notice");
  var form = document.getElementById("post-form");
  var pageTitle = document.getElementById("page-title");
  var titleInput = document.getElementById("post-title");
  var contentInput = document.getElementById("post-content");
  var anonymousInput = document.getElementById("post-anonymous");
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

  init();

  async function init() {
    await requireLogin();

    if (!isEdit) return;

    document.title = "글 수정 - KoreaSG";
    pageTitle.textContent = "글 수정";
    submitBtn.textContent = "수정";
    cancelLink.href = "board-view.html?id=" + encodeURIComponent(postId);

    var res = await sb
      .from("posts_view")
      .select("id, title, content, is_anonymous, is_mine")
      .eq("id", postId)
      .maybeSingle();

    if (res.error || !res.data) {
      showToast(res.error ? mapRpcError(res.error) : "대상을 찾을 수 없습니다.", "error");
      window.location.replace("board.html");
      return;
    }
    if (!res.data.is_mine) {
      showToast("권한이 없습니다.", "error");
      window.location.replace("board-view.html?id=" + encodeURIComponent(postId));
      return;
    }

    titleInput.value = res.data.title || "";
    contentInput.value = res.data.content || "";
    anonymousInput.checked = !!res.data.is_anonymous;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var title = titleInput.value.trim();
    var content = contentInput.value.trim();
    if (!title || !content) {
      showToast("제목과 내용을 입력해주세요.", "error");
      return;
    }
    var isAnonymous = anonymousInput.checked;

    setBusy(submitBtn, true);

    if (isEdit) {
      sb.rpc("update_post", {
        p_id: postId,
        p_title: title,
        p_content: content,
        p_is_anonymous: isAnonymous
      }).then(function (res) {
        if (res.error) {
          setBusy(submitBtn, false);
          showToast(mapRpcError(res.error), "error");
          return;
        }
        window.location.href = "board-view.html?id=" + encodeURIComponent(postId);
      });
      return;
    }

    sb.rpc("create_post", {
      p_title: title,
      p_content: content,
      p_is_anonymous: isAnonymous
    }).then(function (res) {
      if (res.error) {
        setBusy(submitBtn, false);
        showToast(mapRpcError(res.error), "error");
        return;
      }
      window.location.href = "board-view.html?id=" + encodeURIComponent(res.data);
    });
  });
})();
