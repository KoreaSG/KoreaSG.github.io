// 중고거래 상세 페이지
// 의존: config.js, supabase-js, db.js, util.js, upload.js

(function () {
  renderHeader("market");

  var itemId = getParam("id");

  var containerEl = document.getElementById("item-container");
  var commentsSection = document.getElementById("comments-section");
  var commentsHeading = document.getElementById("comments-heading");
  var commentListEl = document.getElementById("comment-list");
  var commentForm = document.getElementById("comment-form");
  var commentAuthor = document.getElementById("comment-author");
  var commentPassword = document.getElementById("comment-password");
  var commentContent = document.getElementById("comment-content");
  var commentSubmit = document.getElementById("comment-submit");

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

  loadItem();

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
      renderItem(res.data);
      commentsSection.hidden = false;
      loadComments();
    } catch (err) {
      showToast(mapRpcError(err), "error");
      renderNotFound();
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

    containerEl.innerHTML =
      '<article class="item-detail">' +
        galleryHtml +
        '<h1 class="item-title">' + badgeHtml + escapeHtml(item.title) + "</h1>" +
        '<div class="item-price">' + escapeHtml(formatPrice(item.price)) + "</div>" +
        '<div class="item-meta">' +
          "<span>" + escapeHtml(item.category) + "</span>" +
          "<span>·</span>" +
          "<span>" + escapeHtml(formatDate(item.created_at)) + "</span>" +
        "</div>" +
        '<div class="item-desc">' + escapeHtml(item.description) + "</div>" +
        '<div class="item-actions">' +
          '<button type="button" id="edit-btn" class="btn">수정</button>' +
          '<button type="button" id="delete-btn" class="btn btn-danger">삭제</button>' +
          '<a class="btn btn-ghost" href="market.html">목록</a>' +
        "</div>" +
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

    document.getElementById("edit-btn").addEventListener("click", onEdit);
    document.getElementById("delete-btn").addEventListener("click", onDelete);
  }

  async function onEdit(e) {
    var btn = e.currentTarget;
    var pw = await promptPassword("비밀번호 확인");
    if (pw === null) return;

    setBusy(btn, true);
    try {
      var res = await sb.rpc("verify_item_password", { p_id: itemId, p_password: pw });
      if (res.error) throw res.error;
      sessionStorage.setItem("edit_pw_item_" + itemId, pw);
      window.location.href = "market-new.html?id=" + encodeURIComponent(itemId);
    } catch (err) {
      showToast(mapRpcError(err), "error");
      setBusy(btn, false);
    }
  }

  async function onDelete(e) {
    var btn = e.currentTarget;
    var pw = await promptPassword("비밀번호 확인");
    if (pw === null) return;

    var ok = await confirmDialog("정말 삭제하시겠습니까?");
    if (!ok) return;

    setBusy(btn, true);
    try {
      var res = await sb.rpc("delete_item", { p_id: itemId, p_password: pw });
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

      var html = "";
      comments.forEach(function (c) {
        html +=
          '<div class="comment-item">' +
            '<div class="comment-meta">' +
              '<span class="comment-author">' + escapeHtml(c.author_name) + "</span>" +
              '<span class="comment-date">' + escapeHtml(formatDate(c.created_at)) + "</span>" +
              '<button type="button" class="btn btn-ghost btn-sm comment-delete" data-id="' + escapeHtml(c.id) + '">삭제</button>' +
            "</div>" +
            '<div class="comment-body">' + escapeHtml(c.content) + "</div>" +
          "</div>";
      });
      commentListEl.innerHTML = html;
    } catch (err) {
      showToast(mapRpcError(err), "error");
    }
  }

  commentListEl.addEventListener("click", async function (e) {
    var btn = e.target.closest(".comment-delete");
    if (!btn) return;

    var pw = await promptPassword("댓글 비밀번호 (또는 글 비밀번호)");
    if (pw === null) return;

    setBusy(btn, true);
    try {
      var res = await sb.rpc("delete_item_comment", { p_id: btn.dataset.id, p_password: pw });
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

    var author = commentAuthor.value.trim();
    var content = commentContent.value.trim();
    var pw = commentPassword.value.trim();

    if (!author) {
      showToast("이름을 입력해주세요.", "error");
      commentAuthor.focus();
      return;
    }
    if (!content) {
      showToast("내용을 입력해주세요.", "error");
      commentContent.focus();
      return;
    }
    if (pw && !/^\d{4}$/.test(pw)) {
      showToast("비밀번호는 숫자 4자리여야 합니다.", "error");
      commentPassword.focus();
      return;
    }

    setBusy(commentSubmit, true);
    try {
      var res = await sb.rpc("add_item_comment", {
        p_item_id: itemId,
        p_author_name: author,
        p_content: content,
        p_password: pw || null
      });
      if (res.error) throw res.error;
      commentContent.value = "";
      commentPassword.value = "";
      await loadComments();
    } catch (err) {
      showToast(mapRpcError(err), "error");
    } finally {
      setBusy(commentSubmit, false);
    }
  });
})();
