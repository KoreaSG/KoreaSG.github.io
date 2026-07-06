// 커뮤니티 글 작성/수정 페이지
// 의존: config.js → supabase-js → db.js → util.js → auth.js → upload.js
// 로그인 필수 — 수정 모드(?id=)는 본인 글(is_mine)만 진입 가능

(function () {
  renderHeader("board");
  initAuth();

  var MAX_IMAGES = 8;

  var noticeEl = document.getElementById("board-notice");
  var form = document.getElementById("post-form");
  var pageTitle = document.getElementById("page-title");
  var titleInput = document.getElementById("post-title");
  var communitySelect = document.getElementById("post-community");
  var contentInput = document.getElementById("post-content");
  var anonymousInput = document.getElementById("post-anonymous");
  var imageInput = document.getElementById("image-input");
  var previewsEl = document.getElementById("img-previews");
  var progressEl = document.getElementById("upload-progress");
  var submitBtn = document.getElementById("submit-btn");
  var cancelLink = document.getElementById("cancel-link");

  // 이미지 상태: { kind: 'existing', path } | { kind: 'new', file, previewUrl }
  var images = [];
  var originalPaths = [];

  if (!APP_CONFIGURED) {
    noticeEl.hidden = false;
    noticeEl.textContent = "서비스 준비중입니다";
    form.hidden = true;
    return;
  }

  var postId = getParam("id");
  var isEdit = !!postId;
  var topicParam = getParam("topic") || "";

  init();

  async function init() {
    await requireLogin();
    await loadCommunities();

    if (!isEdit) return;

    document.title = "글 수정 - KoreaSG";
    pageTitle.textContent = "글 수정";
    submitBtn.textContent = "수정";
    cancelLink.href = "board-view.html?id=" + encodeURIComponent(postId);

    var res = await sb
      .from("posts_view")
      .select("id, title, content, is_anonymous, is_mine, community_id, image_paths")
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
    if (res.data.community_id) communitySelect.value = res.data.community_id;

    originalPaths = (res.data.image_paths || []).slice();
    images = originalPaths.map(function (p) {
      return { kind: "existing", path: p };
    });
    renderPreviews();
  }

  // 주제(커뮤니티) 옵션 채우기 — 기본 자유게시판, 생성 모드에서 ?topic= 우선
  async function loadCommunities() {
    var res = await sb
      .from("communities_view")
      .select("id, slug, name, sort_order")
      .order("sort_order", { ascending: true });

    if (res.error || !res.data || res.data.length === 0) {
      communitySelect.innerHTML = '<option value="">주제를 불러오지 못했습니다</option>';
      return;
    }

    var html = "";
    var defaultId = "";
    res.data.forEach(function (c) {
      html += '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + "</option>";
      if (c.slug === "free") defaultId = c.id;
      if (!isEdit && topicParam && c.slug === topicParam) defaultId = c.id;
    });
    communitySelect.innerHTML = html;
    communitySelect.value = defaultId || res.data[0].id;
  }

  imageInput.addEventListener("change", function () {
    var files = Array.prototype.slice.call(imageInput.files || []);
    imageInput.value = "";
    if (files.length === 0) return;

    var room = MAX_IMAGES - images.length;
    if (files.length > room) {
      showToast("이미지는 최대 " + MAX_IMAGES + "장까지 등록할 수 있습니다.", "error");
      files = files.slice(0, Math.max(0, room));
    }
    files.forEach(function (file) {
      images.push({ kind: "new", file: file, previewUrl: URL.createObjectURL(file) });
    });
    renderPreviews();
  });

  previewsEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".img-remove");
    if (!btn) return;
    var idx = Number(btn.dataset.index);
    var removed = images.splice(idx, 1)[0];
    if (removed && removed.kind === "new") URL.revokeObjectURL(removed.previewUrl);
    renderPreviews();
  });

  function renderPreviews() {
    var html = "";
    images.forEach(function (img, i) {
      var src = img.kind === "existing" ? publicUrl(img.path) : img.previewUrl;
      html +=
        '<div class="img-preview">' +
          '<img src="' + escapeHtml(src) + '" alt="첨부 이미지 ' + (i + 1) + '">' +
          '<button type="button" class="img-remove" data-index="' + i + '" aria-label="이미지 삭제">✕</button>' +
        "</div>";
    });
    previewsEl.innerHTML = html;
  }

  function setProgress(text) {
    if (!progressEl) return;
    if (text) {
      progressEl.hidden = false;
      progressEl.textContent = text;
    } else {
      progressEl.hidden = true;
      progressEl.textContent = "";
    }
  }

  function readFields() {
    var title = titleInput.value.trim();
    var content = contentInput.value.trim();
    if (!title || !content) {
      showToast("제목과 내용을 입력해주세요.", "error");
      return null;
    }
    var communityId = communitySelect.value || null;
    if (!communityId) {
      showToast("주제를 선택해주세요.", "error");
      communitySelect.focus();
      return null;
    }
    return {
      title: title,
      content: content,
      isAnonymous: anonymousInput.checked,
      communityId: communityId
    };
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (isEdit) {
      submitEdit();
    } else {
      submitCreate();
    }
  });

  async function submitCreate() {
    var fields = readFields();
    if (!fields) return;

    var newFiles = images.map(function (img) { return img.file; });

    setBusy(submitBtn, true);
    var uploaded = [];
    try {
      uploaded = await uploadImages(newFiles, function (done, total) {
        setProgress("이미지 업로드 중… (" + done + "/" + total + ")");
      }, "posts");
      setProgress("");

      var res = await sb.rpc("create_post", {
        p_title: fields.title,
        p_content: fields.content,
        p_is_anonymous: fields.isAnonymous,
        p_community_id: fields.communityId,
        p_image_paths: uploaded
      });
      if (res.error) {
        await removeImages(uploaded);
        throw res.error;
      }

      window.location.href = "board-view.html?id=" + encodeURIComponent(res.data);
    } catch (err) {
      setProgress("");
      showToast(mapRpcError(err), "error");
      setBusy(submitBtn, false);
    }
  }

  async function submitEdit() {
    var fields = readFields();
    if (!fields) return;

    var newFiles = images
      .filter(function (img) { return img.kind === "new"; })
      .map(function (img) { return img.file; });

    setBusy(submitBtn, true);
    var uploaded = [];
    try {
      uploaded = await uploadImages(newFiles, function (done, total) {
        setProgress("이미지 업로드 중… (" + done + "/" + total + ")");
      }, "posts");
      setProgress("");

      // 최종 이미지 경로: 남긴 기존 경로 + 새로 올린 경로 (표시 순서 유지)
      var j = 0;
      var finalPaths = images.map(function (img) {
        return img.kind === "existing" ? img.path : uploaded[j++];
      });

      var res = await sb.rpc("update_post", {
        p_id: postId,
        p_title: fields.title,
        p_content: fields.content,
        p_is_anonymous: fields.isAnonymous,
        p_community_id: fields.communityId,
        p_image_paths: finalPaths
      });
      if (res.error) {
        await removeImages(uploaded);
        throw res.error;
      }

      // 제거된 기존 이미지 정리 (best-effort)
      var kept = {};
      finalPaths.forEach(function (p) { kept[p] = true; });
      var removedPaths = originalPaths.filter(function (p) { return !kept[p]; });
      await removeImages(removedPaths);

      window.location.href = "board-view.html?id=" + encodeURIComponent(postId);
    } catch (err) {
      setProgress("");
      showToast(mapRpcError(err), "error");
      setBusy(submitBtn, false);
    }
  }
})();
