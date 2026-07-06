// 커뮤니티 게시글 상세 페이지
// 의존: config.js → supabase-js → db.js → util.js → auth.js
// is_mine은 호출자 JWT 기준 → initAuth()로 세션 복원 후 데이터 조회

(function () {
  renderHeader("board");

  var noticeEl = document.getElementById("board-notice");
  var postContainer = document.getElementById("post-container");
  var commentsSection = document.getElementById("comments-section");
  var commentList = document.getElementById("comment-list");
  var commentCountLabel = document.getElementById("comment-count-label");
  var commentForm = document.getElementById("comment-form");
  var commentContentInput = document.getElementById("comment-content");
  var commentAnonymousInput = document.getElementById("comment-anonymous");
  var commentSubmitBtn = document.getElementById("comment-submit-btn");

  if (!APP_CONFIGURED) {
    noticeEl.hidden = false;
    noticeEl.textContent = "서비스 준비중입니다";
    postContainer.innerHTML = "";
    initAuth();
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

  function isAdmin() {
    var profile = getProfile();
    return !!(profile && profile.is_admin);
  }

  // 조회수 증가 — 세션당 1회, 실패해도 무시 (fire-and-forget)
  function trackView() {
    var key = "viewed_post_" + postId;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch (e) {
      // sessionStorage 사용 불가 환경 — 그냥 1회 호출
    }
    try {
      sb.rpc("increment_view", { p_kind: "post", p_id: postId }).then(null, function () {});
    } catch (e) {
      // 절대 페이지를 막지 않음
    }
  }

  function renderPost(post) {
    document.title = post.title + " - KoreaSG";
    var commentCount = Number(post.comment_count) || 0;
    var likeCount = Number(post.like_count) || 0;
    var viewCount = Number(post.view_count) || 0;

    var actions = "";
    if (post.is_mine) {
      actions += '<button type="button" class="btn" id="edit-btn">수정</button>';
    }
    if (post.is_mine || isAdmin()) {
      actions += '<button type="button" class="btn btn-danger" id="delete-btn">삭제</button>';
    }

    // 익명 글은 익명성 보호를 위해 쪽지 버튼을 아예 표시하지 않음
    var messageBtnHtml = "";
    if (!post.is_anonymous && !post.is_mine) {
      messageBtnHtml = ' <button type="button" id="message-author-btn" class="btn btn-ghost btn-sm">쪽지 보내기</button>';
    }

    // 신고 버튼 — 작성자 본인이 아닌 경우 노출 (미로그인 시 클릭하면 로그인 유도)
    var reportBtnHtml = "";
    if (!post.is_mine) {
      reportBtnHtml = ' <button type="button" id="report-post-btn" class="btn btn-ghost btn-sm">🚩 신고</button>';
    }

    // 이미지 갤러리 (메인 + 썸네일)
    var paths = post.image_paths || [];
    var galleryHtml = "";
    if (paths.length > 0) {
      galleryHtml =
        '<div class="post-gallery">' +
          '<img id="gallery-main" class="gallery-main" src="' +
            escapeHtml(publicUrl(paths[0])) + '" alt="첨부 이미지">';
      if (paths.length > 1) {
        galleryHtml += '<div class="gallery-thumbs" id="gallery-thumbs">';
        paths.forEach(function (p, i) {
          galleryHtml +=
            '<img src="' + escapeHtml(publicUrl(p)) + '" data-index="' + i + '"' +
            (i === 0 ? ' class="is-active"' : "") +
            ' alt="첨부 이미지 ' + (i + 1) + '" loading="lazy">';
        });
        galleryHtml += "</div>";
      }
      galleryHtml += "</div>";
    }

    postContainer.innerHTML =
      '<article class="post-view">' +
        '<h1 class="post-title">' + escapeHtml(post.title) + "</h1>" +
        '<div class="post-meta">' +
          escapeHtml(post.author_display) + " · " +
          formatDate(post.created_at) + " · " +
          "조회 " + viewCount + " · " +
          "댓글 " + commentCount +
          messageBtnHtml +
          reportBtnHtml +
        "</div>" +
        '<div class="post-content">' + escapeHtml(post.content) + "</div>" +
        galleryHtml +
        '<div class="post-like-wrap">' +
          '<button type="button" id="like-btn" class="post-like-btn' +
            (post.liked_by_me ? " is-liked" : "") + '" aria-pressed="' +
            (post.liked_by_me ? "true" : "false") + '">♥ 좋아요 ' + likeCount + "</button>" +
        "</div>" +
      "</article>" +
      '<div class="post-actions">' +
        actions +
        '<a class="btn btn-ghost" href="board.html">목록</a>' +
      "</div>";

    var editBtn = document.getElementById("edit-btn");
    var deleteBtn = document.getElementById("delete-btn");
    if (editBtn) editBtn.addEventListener("click", onEdit);
    if (deleteBtn) deleteBtn.addEventListener("click", onDelete);

    var likeBtn = document.getElementById("like-btn");
    if (likeBtn) likeBtn.addEventListener("click", onLikeToggle);

    var messageBtn = document.getElementById("message-author-btn");
    if (messageBtn) {
      messageBtn.addEventListener("click", function () {
        if (!getProfile()) {
          var next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = "login.html?next=" + next;
          return;
        }
        openMessageModal({ postId: postId, title: post.title });
      });
    }

    var reportBtn = document.getElementById("report-post-btn");
    if (reportBtn) {
      reportBtn.addEventListener("click", function () {
        if (!getProfile()) {
          var next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = "login.html?next=" + next;
          return;
        }
        openReportModal("post", postId);
      });
    }

    // 갤러리 썸네일 클릭 → 메인 이미지 교체
    var thumbsEl = document.getElementById("gallery-thumbs");
    var mainImg = document.getElementById("gallery-main");
    if (thumbsEl && mainImg) {
      thumbsEl.addEventListener("click", function (e) {
        var t = e.target.closest("img[data-index]");
        if (!t) return;
        mainImg.src = t.src;
        thumbsEl.querySelectorAll("img").forEach(function (img) {
          img.classList.toggle("is-active", img === t);
        });
      });
    }
  }

  /**
   * 신고 모달 — 사유 선택 + 선택적 상세 내용
   * @param {string} targetType 'post' | 'post_comment'
   * @param {string} targetId
   */
  function openReportModal(targetType, targetId) {
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<h3 class="modal-title">신고하기</h3>' +
        '<div class="report-field">' +
          '<label for="report-reason">신고 사유</label>' +
          '<select id="report-reason">' +
            '<option value="스팸">스팸</option>' +
            '<option value="욕설">욕설</option>' +
            '<option value="부적절한 내용">부적절한 내용</option>' +
            '<option value="기타">기타</option>' +
          "</select>" +
        "</div>" +
        '<div class="report-field">' +
          '<label for="report-note">상세 내용 (선택)</label>' +
          '<textarea id="report-note" rows="3" maxlength="500" placeholder="추가 설명을 입력해주세요"></textarea>' +
        "</div>" +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn-ghost modal-cancel">취소</button>' +
          '<button type="button" class="btn btn-primary modal-ok">신고</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(backdrop);

    var reasonSel = backdrop.querySelector("#report-reason");
    var noteEl = backdrop.querySelector("#report-note");
    var okBtn = backdrop.querySelector(".modal-ok");

    function close() {
      document.removeEventListener("keydown", onKeydown);
      backdrop.remove();
    }
    function onKeydown(e) {
      if (e.key === "Escape") close();
    }

    okBtn.addEventListener("click", function () {
      var reason = reasonSel.value;
      var note = noteEl.value.trim();
      setBusy(okBtn, true);
      sb.rpc("create_report", {
        p_target_type: targetType,
        p_target_id: targetId,
        p_reason: reason,
        p_note: note || null
      }).then(function (res) {
        if (res.error) {
          setBusy(okBtn, false);
          showToast(mapRpcError(res.error), "error");
          return;
        }
        close();
        showToast("신고가 접수되었습니다.", "success");
      });
    });
    backdrop.querySelector(".modal-cancel").addEventListener("click", close);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close();
    });
    document.addEventListener("keydown", onKeydown);
    reasonSel.focus();
  }

  function onLikeToggle() {
    var btn = document.getElementById("like-btn");
    if (!btn) return;

    if (!getProfile()) {
      var next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = "login.html?next=" + next;
      return;
    }

    setBusy(btn, true);
    sb.rpc("toggle_post_like", { p_post_id: postId }).then(function (res) {
      setBusy(btn, false);
      if (res.error) {
        showToast(mapRpcError(res.error), "error");
        return;
      }
      var data = res.data || {};
      var liked = !!data.liked;
      var count = Number(data.like_count) || 0;
      btn.classList.toggle("is-liked", liked);
      btn.setAttribute("aria-pressed", liked ? "true" : "false");
      btn.textContent = "♥ 좋아요 " + count;
    });
  }

  function onEdit() {
    window.location.href = "board-new.html?id=" + encodeURIComponent(postId);
  }

  function onDelete() {
    var deleteBtn = document.getElementById("delete-btn");
    confirmDialog("정말 삭제하시겠습니까?").then(function (ok) {
      if (!ok) return;
      setBusy(deleteBtn, true);
      sb.rpc("delete_post", { p_id: postId }).then(function (res) {
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
      var canDelete = c.is_mine || isAdmin();
      // 본인 댓글이 아니면 신고 링크 노출 (미로그인 시 클릭하면 로그인 유도)
      var reportLink = !c.is_mine
        ? '<button type="button" class="comment-report" data-id="' +
            escapeHtml(c.id) + '" title="신고" aria-label="댓글 신고">🚩</button>'
        : "";
      html +=
        '<div class="comment-item">' +
          '<div class="comment-meta">' +
            '<span class="comment-author">' + escapeHtml(c.author_display) + "</span>" +
            '<span class="comment-date">' + formatDate(c.created_at) + "</span>" +
            reportLink +
            (canDelete
              ? '<button type="button" class="btn btn-ghost btn-sm comment-delete" data-id="' +
                escapeHtml(c.id) + '">삭제</button>'
              : "") +
          "</div>" +
          '<div class="comment-body">' + escapeHtml(c.content) + "</div>" +
        "</div>";
    });
    commentList.innerHTML = html;
  }

  function loadComments() {
    sb.from("post_comments_view")
      .select("id, post_id, author_display, is_anonymous, content, created_at, is_mine")
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
    var reportBtn = e.target.closest(".comment-report");
    if (reportBtn) {
      if (!getProfile()) {
        var next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = "login.html?next=" + next;
        return;
      }
      openReportModal("post_comment", reportBtn.dataset.id);
      return;
    }

    var btn = e.target.closest(".comment-delete");
    if (!btn) return;
    var commentId = btn.dataset.id;

    confirmDialog("댓글을 삭제하시겠습니까?").then(function (ok) {
      if (!ok) return;
      setBusy(btn, true);
      sb.rpc("delete_post_comment", { p_id: commentId }).then(function (res) {
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

    var content = commentContentInput.value.trim();
    if (!content) {
      showToast("내용을 입력해주세요.", "error");
      return;
    }

    setBusy(commentSubmitBtn, true);
    sb.rpc("add_post_comment", {
      p_post_id: postId,
      p_content: content,
      p_is_anonymous: commentAnonymousInput.checked
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

  // 로그아웃 상태면 댓글 폼을 로그인 안내로 교체
  function renderCommentFormState() {
    if (getProfile()) return;
    var next = encodeURIComponent(window.location.pathname + window.location.search);
    var notice = document.createElement("p");
    notice.className = "comment-login-notice";
    notice.innerHTML =
      '댓글을 작성하려면 <a href="login.html?next=' + escapeHtml(next) + '">로그인</a>이 필요합니다.';
    commentForm.replaceWith(notice);
  }

  function loadPost() {
    sb.from("posts_view")
      .select("id, title, content, author_display, is_anonymous, created_at, updated_at, comment_count, is_mine, like_count, view_count, liked_by_me, image_paths")
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
        trackView();
        commentsSection.hidden = false;
        loadComments();
      });
  }

  // 세션 복원(initAuth) 후 조회해야 is_mine이 올바르게 계산됨
  initAuth().then(function () {
    if (!postId) {
      showNotFound();
      return;
    }
    renderCommentFormState();
    loadPost();
  });
})();
