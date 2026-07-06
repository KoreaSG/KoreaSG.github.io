// 커뮤니티 게시글 상세 페이지
// 의존: config.js → supabase-js → db.js → util.js

(function () {
  renderHeader("board");

  var noticeEl = document.getElementById("board-notice");
  var postContainer = document.getElementById("post-container");
  var commentsSection = document.getElementById("comments-section");
  var commentList = document.getElementById("comment-list");
  var commentCountLabel = document.getElementById("comment-count-label");
  var commentForm = document.getElementById("comment-form");
  var commentAuthorInput = document.getElementById("comment-author");
  var commentContentInput = document.getElementById("comment-content");
  var commentPasswordInput = document.getElementById("comment-password");
  var commentSubmitBtn = document.getElementById("comment-submit-btn");

  if (!APP_CONFIGURED) {
    noticeEl.hidden = false;
    noticeEl.textContent = "서비스 준비중입니다";
    postContainer.innerHTML = "";
    return;
  }

  var postId = getParam("id");

  function showNotFound() {
    postContainer.innerHTML =
      '<div class="empty-state"><div class="empty-icon">📄</div>' +
      '게시글을 찾을 수 없습니다.<br><br>' +
      '<a class="btn btn-ghost" href="board.html">목록으로</a></div>';
    commentsSection.hidden = true;
  }

  if (!postId) {
    showNotFound();
    return;
  }

  function renderPost(post) {
    document.title = post.title + " - KoreaSG";
    var commentCount = Number(post.comment_count) || 0;

    postContainer.innerHTML =
      '<article class="post-view">' +
        '<h1 class="post-title">' + escapeHtml(post.title) + "</h1>" +
        '<div class="post-meta">' +
          escapeHtml(post.author_name) + " · " +
          formatDate(post.created_at) + " · " +
          "댓글 " + commentCount +
        "</div>" +
        '<div class="post-content">' + escapeHtml(post.content) + "</div>" +
      "</article>" +
      '<div class="post-actions">' +
        '<button type="button" class="btn" id="edit-btn">수정</button>' +
        '<button type="button" class="btn btn-danger" id="delete-btn">삭제</button>' +
        '<a class="btn btn-ghost" href="board.html">목록</a>' +
      "</div>";

    document.getElementById("edit-btn").addEventListener("click", onEdit);
    document.getElementById("delete-btn").addEventListener("click", onDelete);
  }

  function onEdit() {
    var editBtn = document.getElementById("edit-btn");
    promptPassword("게시글 비밀번호 확인").then(function (pw) {
      if (pw === null) return;
      setBusy(editBtn, true);
      sb.rpc("verify_post_password", { p_id: postId, p_password: pw }).then(function (res) {
        setBusy(editBtn, false);
        if (res.error) {
          showToast(mapRpcError(res.error), "error");
          return;
        }
        sessionStorage.setItem("edit_pw_post_" + postId, pw);
        window.location.href = "board-new.html?id=" + encodeURIComponent(postId);
      });
    });
  }

  function onDelete() {
    var deleteBtn = document.getElementById("delete-btn");
    promptPassword("게시글 비밀번호 확인").then(function (pw) {
      if (pw === null) return;
      confirmDialog("정말 삭제하시겠습니까?").then(function (ok) {
        if (!ok) return;
        setBusy(deleteBtn, true);
        sb.rpc("delete_post", { p_id: postId, p_password: pw }).then(function (res) {
          if (res.error) {
            setBusy(deleteBtn, false);
            showToast(mapRpcError(res.error), "error");
            return;
          }
          showToast("게시글이 삭제되었습니다.", "success");
          setTimeout(function () {
            window.location.href = "board.html";
          }, 600);
        });
      });
    });
  }

  function renderComments(rows) {
    commentCountLabel.textContent = rows.length;

    if (rows.length === 0) {
      commentList.innerHTML =
        '<div class="empty-state">첫 댓글을 남겨보세요.</div>';
      return;
    }

    var html = "";
    rows.forEach(function (c) {
      html +=
        '<div class="comment-item">' +
          '<div class="comment-meta">' +
            '<span class="comment-author">' + escapeHtml(c.author_name) + "</span>" +
            '<span class="comment-date">' + formatDate(c.created_at) + "</span>" +
            '<button type="button" class="btn btn-ghost btn-sm comment-delete" data-id="' +
              escapeHtml(c.id) + '">삭제</button>' +
          "</div>" +
          '<div class="comment-body">' + escapeHtml(c.content) + "</div>" +
        "</div>";
    });
    commentList.innerHTML = html;
  }

  function loadComments() {
    sb.from("post_comments_view")
      .select("id, post_id, author_name, content, created_at, has_password")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .then(function (res) {
        if (res.error) {
          showToast(mapRpcError(res.error), "error");
          commentList.innerHTML =
            '<div class="empty-state">댓글을 불러오지 못했습니다.</div>';
          return;
        }
        renderComments(res.data || []);
      });
  }

  commentList.addEventListener("click", function (e) {
    var btn = e.target.closest(".comment-delete");
    if (!btn) return;
    var commentId = btn.dataset.id;

    promptPassword("댓글 비밀번호 (또는 글 비밀번호)").then(function (pw) {
      if (pw === null) return;
      setBusy(btn, true);
      sb.rpc("delete_post_comment", { p_id: commentId, p_password: pw }).then(function (res) {
        if (res.error) {
          setBusy(btn, false);
          showToast(mapRpcError(res.error), "error");
          return;
        }
        showToast("댓글이 삭제되었습니다.", "success");
        loadComments();
      });
    });
  });

  commentForm.addEventListener("submit", function (e) {
    e.preventDefault();

    var author = commentAuthorInput.value.trim();
    var content = commentContentInput.value.trim();
    var password = commentPasswordInput.value.trim();

    if (!author || !content) {
      showToast("이름과 내용을 입력해주세요.", "error");
      return;
    }
    if (password && !/^\d{4}$/.test(password)) {
      showToast("비밀번호는 숫자 4자리여야 합니다.", "error");
      commentPasswordInput.focus();
      return;
    }

    setBusy(commentSubmitBtn, true);
    sb.rpc("add_post_comment", {
      p_post_id: postId,
      p_author_name: author,
      p_content: content,
      p_password: password || null
    }).then(function (res) {
      setBusy(commentSubmitBtn, false);
      if (res.error) {
        showToast(mapRpcError(res.error), "error");
        return;
      }
      commentForm.reset();
      showToast("댓글이 등록되었습니다.", "success");
      loadComments();
    });
  });

  // 게시글 로드
  sb.from("posts_view")
    .select("id, title, content, author_name, created_at, updated_at, comment_count")
    .eq("id", postId)
    .maybeSingle()
    .then(function (res) {
      if (res.error) {
        showToast(mapRpcError(res.error), "error");
        showNotFound();
        return;
      }
      if (!res.data) {
        showNotFound();
        return;
      }
      renderPost(res.data);
      commentsSection.hidden = false;
      loadComments();
    });
})();
