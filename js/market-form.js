// 중고거래 작성/수정 페이지
// 의존: config.js, supabase-js, db.js, util.js, upload.js

(function () {
  renderHeader("market");

  var MAX_IMAGES = 8;

  var itemId = getParam("id");
  var isEdit = !!itemId;
  var pwKey = isEdit ? "edit_pw_item_" + itemId : null;
  var storedPassword = isEdit ? sessionStorage.getItem(pwKey) : null;

  var form = document.getElementById("item-form");
  var pageTitle = document.getElementById("page-title");
  var imageInput = document.getElementById("image-input");
  var previewsEl = document.getElementById("img-previews");
  var progressEl = document.getElementById("upload-progress");
  var titleInput = document.getElementById("title-input");
  var categorySelect = document.getElementById("category-select");
  var priceInput = document.getElementById("price-input");
  var descInput = document.getElementById("desc-input");
  var statusGroup = document.getElementById("status-group");
  var statusSelect = document.getElementById("status-select");
  var passwordGroup = document.getElementById("password-group");
  var passwordInput = document.getElementById("password-input");
  var submitBtn = document.getElementById("submit-btn");

  // 이미지 상태: { kind: 'existing', path } | { kind: 'new', file, previewUrl }
  var images = [];
  var originalPaths = [];

  if (!APP_CONFIGURED) {
    var notice = document.getElementById("market-notice");
    if (notice) {
      notice.hidden = false;
      notice.textContent = "서비스 준비중입니다.";
    }
    return;
  }

  // 수정 모드인데 검증된 비밀번호가 없으면 상세로 돌려보냄
  if (isEdit && !storedPassword) {
    window.location.replace("market-view.html?id=" + encodeURIComponent(itemId));
    return;
  }

  // 분류 옵션 채우기
  CATEGORIES.forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    categorySelect.appendChild(opt);
  });

  if (isEdit) {
    document.title = "상품 수정 - KoreaSG";
    pageTitle.textContent = "상품 수정";
    submitBtn.textContent = "수정하기";
    statusGroup.hidden = false;
    passwordGroup.hidden = true;
    loadItem();
  } else {
    form.hidden = false;
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

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (isEdit) {
      submitEdit();
    } else {
      submitCreate();
    }
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

  /**
   * 공통 입력 검증. 통과 시 값 객체, 실패 시 null
   */
  function readFields() {
    var title = titleInput.value.trim();
    var category = categorySelect.value;
    var price = Math.floor(Number(priceInput.value));
    var description = descInput.value.trim();

    if (!title) {
      showToast("제목을 입력해주세요.", "error");
      titleInput.focus();
      return null;
    }
    if (!category) {
      showToast("분류를 선택해주세요.", "error");
      categorySelect.focus();
      return null;
    }
    if (isNaN(price) || price < 0 || price > 1000000) {
      showToast("가격은 0~1,000,000 사이 숫자여야 합니다.", "error");
      priceInput.focus();
      return null;
    }
    if (!description) {
      showToast("내용을 입력해주세요.", "error");
      descInput.focus();
      return null;
    }
    return { title: title, category: category, price: price, description: description };
  }

  async function submitCreate() {
    var fields = readFields();
    if (!fields) return;

    var password = passwordInput.value.trim();
    if (!/^\d{4}$/.test(password)) {
      showToast("비밀번호는 숫자 4자리여야 합니다.", "error");
      passwordInput.focus();
      return;
    }

    var newFiles = images.map(function (img) { return img.file; });

    setBusy(submitBtn, true);
    var uploaded = [];
    try {
      uploaded = await uploadImages(newFiles, function (done, total) {
        setProgress("이미지 업로드 중… (" + done + "/" + total + ")");
      });
      setProgress("");

      var res = await sb.rpc("create_item", {
        p_title: fields.title,
        p_category: fields.category,
        p_price: fields.price,
        p_description: fields.description,
        p_password: password,
        p_image_paths: uploaded
      });
      if (res.error) {
        await removeImages(uploaded);
        throw res.error;
      }

      window.location.href = "market-view.html?id=" + encodeURIComponent(res.data);
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
      });
      setProgress("");

      // 최종 이미지 경로: 남긴 기존 경로 + 새로 올린 경로 (표시 순서 유지)
      var j = 0;
      var finalPaths = images.map(function (img) {
        return img.kind === "existing" ? img.path : uploaded[j++];
      });

      var res = await sb.rpc("update_item", {
        p_id: itemId,
        p_password: storedPassword,
        p_title: fields.title,
        p_category: fields.category,
        p_price: fields.price,
        p_description: fields.description,
        p_image_paths: finalPaths,
        p_status: statusSelect.value
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

      sessionStorage.removeItem(pwKey);
      window.location.href = "market-view.html?id=" + encodeURIComponent(itemId);
    } catch (err) {
      setProgress("");
      showToast(mapRpcError(err), "error");
      setBusy(submitBtn, false);
    }
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
        showToast("대상을 찾을 수 없습니다.", "error");
        window.location.replace("market.html");
        return;
      }

      var item = res.data;
      titleInput.value = item.title || "";
      categorySelect.value = item.category || "";
      priceInput.value = item.price != null ? item.price : "";
      descInput.value = item.description || "";
      if (ITEM_STATUS[item.status]) statusSelect.value = item.status;
      passwordInput.required = false;

      originalPaths = (item.image_paths || []).slice();
      images = originalPaths.map(function (p) {
        return { kind: "existing", path: p };
      });
      renderPreviews();

      form.hidden = false;
    } catch (err) {
      showToast(mapRpcError(err), "error");
    }
  }
})();
