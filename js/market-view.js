// 중고거래 상세 페이지
// 의존: config.js, supabase-js, db.js, util.js, auth.js, upload.js

(function () {
  renderHeader("market");

  var itemId = getParam("id");

  var containerEl = document.getElementById("item-container");
  var commentsSection = document.getElementById("comments-section");
  var commentsHeading = document.getElementById("comments-heading");
  var commentListEl = document.getElementById("comment-list");
  var commentForm = document.getElementById("comment-form");
  var commentContent = document.getElementById("comment-content");
  var commentSubmit = document.getElementById("comment-submit");

  var currentItem = null;

  if (!APP_CONFIGURED) {
    var notice = document.getElementById("market-notice");
    if (notice) {
      notice.hidden = false;
      notice.textContent = "서비스 준비중입니다.";
    }
    if (containerEl) containerEl.innerHTML = '<div class="empty-state">서비스 준비중입니다.</div>';
    return;
  }

  if (!itemId) {
    renderNotFound();
    return;
  }

  init();

  // 세션 복원(initAuth) 후 조회해야 is_mine이 올바르게 계산됨
  async function init() {
    await initAuth();
    setupCommentForm();
    loadItem();
  }

  function renderNotFound() {
    containerEl.innerHTML =
      '<div class="empty-state"><div class="empty-icon">🔍</div>' +
      '매물을 찾을 수 없습니다.<br><br>' +
      '<a class="btn btn-ghost" href="market.html">목록으로</a></div>';
  }

  async function loadItem() {
    try {
      var res = await sb
        .from("items_view")
        .select("*")
        .eq("id", itemId)
        .maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) {
        renderNotFound();
        return;
      }
      currentItem = res.data;
      renderItem(currentItem);
      trackView();
      commentsSection.hidden = false;
      loadComments();
    } catch (err) {
      showToast(mapRpcError(err), "error");
      renderNotFound();
    }
  }

  // 조회수 증가 — 세션당 1회, 실패해도 무시 (fire-and-forget)
  function trackView() {
    var key = "viewed_item_" + itemId;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch (e) {
      // sessionStorage 사용 불가 환경 — 그냥 1회 호출
    }
    try {
      sb.rpc("increment_view", { p_kind: "item", p_id: itemId }).then(null, function () {});
    } catch (e) {
      // 절대 페이지를 막지 않음
    }
  }

  function renderItem(item) {
    var paths = item.image_paths || [];

    var galleryHtml = "";
    if (paths.length > 0) {
      galleryHtml =
        '<img id="gallery-main" class="gallery-main" src="' + escapeHtml(publicUrl(paths[0])) + '" alt="상품 이미지">';
      if (paths.length > 1) {
        galleryHtml += '<div class="gallery-thumbs" id="gallery-thumbs">';
        paths.forEach(function (p, i) {
          galleryHtml +=
            '<img src="' + escapeHtml(publicUrl(p)) + '" data-index="' + i + '"' +
            (i === 0 ? ' class="is-active"' : "") + ' alt="상품 이미지 ' + (i + 1) + '" loading="lazy">';
        });
        galleryHtml += "</div>";
      }
    }

    var badgeHtml = "";
    if (ITEM_STATUS[item.status]) {
      badgeHtml =
        '<span class="badge ' + escapeHtml(item.status) + '">' +
        escapeHtml(ITEM_STATUS[item.status]) + "</span> ";
    }

    var sellerHtml =
      "판매자: " + escapeHtml(item.seller_username || "알수없음") +
      (item.seller_region ? " (" + escapeHtml(item.seller_region) + ")" : "");
    if (!item.is_mine) {
      sellerHtml += ' <button type="button" id="message-seller-btn" class="btn btn-sm">판매자에게 쪽지</button>';
    }

    var profile = getProfile();
    var canEdit = !!item.is_mine;
    var canDelete = item.is_mine || (profile && profile.is_admin);
    var isLoggedIn = !!profile;

    var actionsHtml = "";
    if (canEdit) actionsHtml += '<button type="button" id="edit-btn" class="btn">수정</button>';
    if (canDelete) actionsHtml += '<button type="button" id="delete-btn" class="btn btn-danger">삭제</button>';
    actionsHtml += '<a class="btn btn-ghost" href="market.html">목록</a>';

    var locationHtml = item.location
      ? "<span>·</span><span>거래지역: " + escapeHtml(item.location) + "</span>"
      : "";

    // 소유자 전용 상태 변경 세그먼트 (수정 버튼과 별개)
    var statusControlHtml = "";
    if (item.is_mine) {
      var segBtns = "";
      Object.keys(ITEM_STATUS).forEach(function (key) {
        segBtns +=
          '<button type="button" class="status-seg-btn' +
          (item.status === key ? " is-active" : "") + '" data-status="' + escapeHtml(key) + '">' +
          escapeHtml(ITEM_STATUS[key]) + "</button>";
      });
      statusControlHtml =
        '<div class="status-control">' +
          '<span class="status-label">상태 변경</span>' +
          '<div class="status-seg" id="status-seg">' + segBtns + "</div>" +
        "</div>";
    }

    // 좋아요 (로그인한 모든 사용자) + 신고 (로그인한 비소유자)
    var likeCount = Number(item.like_count) || 0;
    var liked = !!item.liked_by_me_item;
    var reportHtml = "";
    if (isLoggedIn && !item.is_mine) {
      reportHtml = '<button type="button" id="report-btn" class="item-report-btn">🚩 신고</button>';
    }
    var likeWrapHtml =
      '<div class="item-like-wrap">' +
        '<button type="button" id="like-btn" class="item-like-btn' +
          (liked ? " is-liked" : "") + '" aria-pressed="' + (liked ? "true" : "false") +
          '">♥ ' + likeCount + "</button>" +
        reportHtml +
      "</div>";

    containerEl.innerHTML =
      '<article class="item-detail">' +
        galleryHtml +
        '<h1 class="item-title">' + badgeHtml + escapeHtml(item.title) + "</h1>" +
        '<div class="item-price">' + escapeHtml(formatPrice(item.price)) + "</div>" +
        '<div class="item-meta">' +
          "<span>" + sellerHtml + "</span>" +
          "<span>·</span>" +
          "<span>" + escapeHtml(item.category) + "</span>" +
          locationHtml +
          "<span>·</span>" +
          "<span>" + escapeHtml(formatDate(item.created_at)) + "</span>" +
          "<span>·</span>" +
          "<span>조회 " + (Number(item.view_count) || 0) + "</span>" +
        "</div>" +
        '<div class="item-desc">' + escapeHtml(item.description) + "</div>" +
        likeWrapHtml +
        statusControlHtml +
        '<div class="item-actions">' + actionsHtml + "</div>" +
      "</article>";

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

    var editBtn = document.getElementById("edit-btn");
    var deleteBtn = document.getElementById("delete-btn");
    if (editBtn) editBtn.addEventListener("click", onEdit);
    if (deleteBtn) deleteBtn.addEventListener("click", onDelete);

    var likeBtn = document.getElementById("like-btn");
    if (likeBtn) likeBtn.addEventListener("click", onLikeToggle);

    var reportBtn = document.getElementById("report-btn");
    if (reportBtn) {
      reportBtn.addEventListener("click", function () {
        openReportModal("item", itemId);
      });
    }

    var statusSeg = document.getElementById("status-seg");
    if (statusSeg) {
      statusSeg.addEventListener("click", function (e) {
        var btn = e.target.closest(".status-seg-btn");
        if (!btn || btn.classList.contains("is-active")) return;
        onStatusChange(btn.dataset.status);
      });
    }

    var messageBtn = document.getElementById("message-seller-btn");
    if (messageBtn) {
      messageBtn.addEventListener("click", function () {
        if (!getProfile()) {
          var next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.href = "login.html?next=" + next;
          return;
        }
        openMessageModal({ itemId: itemId, title: item.title });
      });
    }
  }

  function onEdit() {
    window.location.href = "market-new.html?id=" + encodeURIComponent(itemId);
  }

  // 좋아요 토글 — 로그인한 모든 사용자(소유자 포함)
  function onLikeToggle() {
    var btn = document.getElementById("like-btn");
    if (!btn) return;

    if (!getProfile()) {
      var next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = "login.html?next=" + next;
      return;
    }

    setBusy(btn, true);
    sb.rpc("toggle_item_like", { p_item_id: itemId }).then(function (res) {
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
      btn.textContent = "♥ " + count;
      if (currentItem) {
        currentItem.liked_by_me_item = liked;
        currentItem.like_count = count;
      }
    });
  }

  // 소유자 원클릭 상태 변경 (판매중/예약중/판매완료)
  async function onStatusChange(status) {
    if (!ITEM_STATUS[status]) return;
    var seg = document.getElementById("status-seg");
    var btns = seg ? seg.querySelectorAll(".status-seg-btn") : [];
    btns.forEach(function (b) { b.disabled = true; });
    try {
      var res = await sb.rpc("set_item_status", { p_id: itemId, p_status: status });
      if (res.error) throw res.error;

      // 세그먼트 활성 상태 갱신
      btns.forEach(function (b) {
        b.classList.toggle("is-active", b.dataset.status === status);
      });
      // 제목 배지 in-place 갱신
      var titleEl = document.querySelector(".item-title");
      if (titleEl) {
        var oldBadge = titleEl.querySelector(".badge");
        if (oldBadge) oldBadge.remove();
        var span = document.createElement("span");
        span.className = "badge " + status;
        span.textContent = ITEM_STATUS[status];
        titleEl.insertBefore(document.createTextNode(" "), titleEl.firstChild);
        titleEl.insertBefore(span, titleEl.firstChild);
      }
      if (currentItem) currentItem.status = status;
      showToast("상태가 '" + ITEM_STATUS[status] + "'(으)로 변경되었습니다.", "success");
    } catch (err) {
      showToast(mapRpcError(err), "error");
    } finally {
      btns.forEach(function (b) { b.disabled = false; });
    }
  }

  // 신고 모달 — target_type: 'item' | 'item_comment'
  function openReportModal(targetType, targetId) {
    if (!getProfile()) {
      var next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = "login.html?next=" + next;
      return;
    }

    var REASONS = ["스팸", "사기의심", "부적절한 내용", "기타"];
    var title = targetType === "item_comment" ? "댓글 신고" : "매물 신고";
    var reasonOptions = REASONS.map(function (r) {
      return '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + "</option>";
    }).join("");

    var backdrop = _createModal(
      '<h3 class="modal-title">' + escapeHtml(title) + "</h3>" +
      '<div class="report-field">' +
        '<label for="report-reason">신고 사유</label>' +
        '<select id="report-reason">' + reasonOptions + "</select>" +
      "</div>" +
      '<div class="report-field">' +
        '<label for="report-note">상세 내용 (선택)</label>' +
        '<textarea id="report-note" maxlength="500" placeholder="추가 설명을 입력하세요" style="min-height:80px"></textarea>' +
      "</div>" +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost modal-cancel">취소</button>' +
        '<button type="button" class="btn btn-primary modal-ok">신고하기</button>' +
      "</div>"
    );

    var reasonSelect = backdrop.querySelector("#report-reason");
    var noteInput = backdrop.querySelector("#report-note");
    var okBtn = backdrop.querySelector(".modal-ok");

    function close() {
      document.removeEventListener("keydown", onKeydown);
      backdrop.remove();
    }
    function onKeydown(e) {
      if (e.key === "Escape") close();
    }

    okBtn.addEventListener("click", async function () {
      setBusy(okBtn, true);
      try {
        var res = await sb.rpc("create_report", {
          p_target_type: targetType,
          p_target_id: targetId,
          p_reason: reasonSelect.value,
          p_note: noteInput.value.trim()
        });
        if (res.error) throw res.error;
        showToast("신고가 접수되었습니다.", "success");
        close();
      } catch (err) {
        setBusy(okBtn, false);
        showToast(mapRpcError(err), "error");
      }
    });
    backdrop.querySelector(".modal-cancel").addEventListener("click", close);
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close();
    });
    document.addEventListener("keydown", onKeydown);
    reasonSelect.focus();
  }

  async function onDelete(e) {
    var btn = e.currentTarget;

    var ok = await confirmDialog("정말 삭제하시겠습니까?");
    if (!ok) return;

    setBusy(btn, true);
    try {
      var res = await sb.rpc("delete_item", { p_id: itemId });
      if (res.error) throw res.error;
      await removeImages(res.data || []);
      showToast("삭제되었습니다.", "success");
      window.location.href = "market.html";
    } catch (err) {
      showToast(mapRpcError(err), "error");
      setBusy(btn, false);
    }
  }

  async function loadComments() {
    try {
      var res = await sb
        .from("item_comments_view")
        .select("*")
        .eq("item_id", itemId)
        .order("created_at", { ascending: true });
      if (res.error) throw res.error;

      var comments = res.data || [];
      commentsHeading.textContent = "댓글 " + comments.length;

      if (comments.length === 0) {
        commentListEl.innerHTML = "";
        return;
      }

      var profile = getProfile();
      var isAdmin = !!(profile && profile.is_admin);
      var isOwner = !!(currentItem && currentItem.is_mine);
      var isLoggedIn = !!profile;

      var html = "";
      comments.forEach(function (c) {
        var canDelete = c.is_mine || isOwner || isAdmin;
        var canReport = isLoggedIn && !c.is_mine;
        html +=
          '<div class="comment-item">' +
            '<div class="comment-meta">' +
              '<span class="comment-author">' + escapeHtml(c.author_username || "알수없음") + "</span>" +
              '<span class="comment-date">' + escapeHtml(formatDate(c.created_at)) + "</span>" +
              (canReport
                ? '<button type="button" class="comment-report" data-id="' + escapeHtml(c.id) + '" aria-label="댓글 신고">🚩</button>'
                : "") +
              (canDelete
                ? '<button type="button" class="btn btn-ghost btn-sm comment-delete" data-id="' + escapeHtml(c.id) + '">삭제</button>'
                : "") +
            "</div>" +
            '<div class="comment-body">' + escapeHtml(c.content) + "</div>" +
          "</div>";
      });
      commentListEl.innerHTML = html;
    } catch (err) {
      showToast(mapRpcError(err), "error");
    }
  }

  /**
   * 댓글 작성 폼: 미로그인 시 로그인 안내로 대체
   */
  function setupCommentForm() {
    if (getProfile()) return;
    var next = encodeURIComponent(window.location.pathname + window.location.search);
    var noticeEl = document.createElement("p");
    noticeEl.className = "comment-login-notice";
    noticeEl.innerHTML =
      '댓글을 작성하려면 <a href="login.html?next=' + escapeHtml(next) + '">로그인</a>이 필요합니다.';
    commentForm.replaceWith(noticeEl);
  }

  commentListEl.addEventListener("click", async function (e) {
    var reportBtn = e.target.closest(".comment-report");
    if (reportBtn) {
      openReportModal("item_comment", reportBtn.dataset.id);
      return;
    }

    var btn = e.target.closest(".comment-delete");
    if (!btn) return;

    var ok = await confirmDialog("정말 삭제하시겠습니까?");
    if (!ok) return;

    setBusy(btn, true);
    try {
      var res = await sb.rpc("delete_item_comment", { p_id: btn.dataset.id });
      if (res.error) throw res.error;
      showToast("댓글이 삭제되었습니다.", "success");
      await loadComments();
    } catch (err) {
      showToast(mapRpcError(err), "error");
      setBusy(btn, false);
    }
  });

  commentForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    var content = commentContent.value.trim();
    if (!content) {
      showToast("내용을 입력해주세요.", "error");
      commentContent.focus();
      return;
    }

    setBusy(commentSubmit, true);
    try {
      var res = await sb.rpc("add_item_comment", {
        p_item_id: itemId,
        p_content: content
      });
      if (res.error) throw res.error;
      commentContent.value = "";
      await loadComments();
    } catch (err) {
      showToast(mapRpcError(err), "error");
    } finally {
      setBusy(commentSubmit, false);
    }
  });
})();
