// 중고거래 목록 페이지
// 의존: config.js, supabase-js, db.js, util.js, auth.js, upload.js(publicUrl)

(function () {
  renderHeader("market");
  initAuth();

  var gridEl = document.getElementById("item-grid");
  var paginationEl = document.getElementById("pagination");
  var searchForm = document.getElementById("search-form");
  var searchInput = document.getElementById("search-input");
  var catSelect = document.getElementById("filter-cat");
  var locSelect = document.getElementById("filter-loc");
  var sortSelect = document.getElementById("filter-sort");

  // 정렬 옵션 정의: value → { label, column, ascending }
  var SORT_OPTIONS = [
    { value: "latest", label: "최신순", column: "created_at", ascending: false },
    { value: "price_asc", label: "가격낮은순", column: "price", ascending: true },
    { value: "price_desc", label: "가격높은순", column: "price", ascending: false },
    { value: "popular", label: "인기순", column: "popularity", ascending: false }
  ];

  var q = getParam("q") || "";
  var cat = getParam("cat") || "";
  var loc = getParam("loc") || "";
  var sort = getParam("sort") || "latest";
  if (!SORT_OPTIONS.some(function (o) { return o.value === sort; })) sort = "latest";
  var page = parseInt(getParam("page"), 10);
  if (isNaN(page) || page < 1) page = 1;

  if (searchInput) searchInput.value = q;

  /**
   * 목록 URL 생성 (q/cat/loc/sort/page 상태 유지)
   */
  function makeHref(overrides) {
    var params = new URLSearchParams();
    var nextQ = overrides.q !== undefined ? overrides.q : q;
    var nextCat = overrides.cat !== undefined ? overrides.cat : cat;
    var nextLoc = overrides.loc !== undefined ? overrides.loc : loc;
    var nextSort = overrides.sort !== undefined ? overrides.sort : sort;
    var nextPage = overrides.page !== undefined ? overrides.page : page;
    if (nextQ) params.set("q", nextQ);
    if (nextCat) params.set("cat", nextCat);
    if (nextLoc) params.set("loc", nextLoc);
    if (nextSort && nextSort !== "latest") params.set("sort", nextSort);
    if (nextPage > 1) params.set("page", String(nextPage));
    var qs = params.toString();
    return "market.html" + (qs ? "?" + qs : "");
  }

  renderFilters();

  if (searchForm) {
    searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      window.location.href = makeHref({ q: searchInput.value.trim(), page: 1 });
    });
  }

  // 필터 변경 시 page를 1로 리셋하고 나머지 상태 유지
  if (catSelect) {
    catSelect.addEventListener("change", function () {
      window.location.href = makeHref({ cat: catSelect.value, page: 1 });
    });
  }
  if (locSelect) {
    locSelect.addEventListener("change", function () {
      window.location.href = makeHref({ loc: locSelect.value, page: 1 });
    });
  }
  if (sortSelect) {
    sortSelect.addEventListener("change", function () {
      window.location.href = makeHref({ sort: sortSelect.value, page: 1 });
    });
  }

  if (!APP_CONFIGURED) {
    var notice = document.getElementById("market-notice");
    if (notice) {
      notice.hidden = false;
      notice.textContent = "서비스 준비중입니다.";
    }
    if (gridEl) gridEl.innerHTML = '<div class="empty-state">서비스 준비중입니다.</div>';
    return;
  }

  loadItems();

  function fillSelect(selectEl, options, current) {
    if (!selectEl) return;
    var html = "";
    options.forEach(function (o) {
      html +=
        '<option value="' + escapeHtml(o.value) + '"' +
        (o.value === current ? " selected" : "") + ">" + escapeHtml(o.label) + "</option>";
    });
    selectEl.innerHTML = html;
  }

  function renderFilters() {
    var catOptions = [{ value: "", label: "전체 분류" }].concat(
      CATEGORIES.map(function (c) { return { value: c, label: c }; })
    );
    var locOptions = [{ value: "", label: "전체 지역" }].concat(
      REGIONS.map(function (r) { return { value: r, label: r }; })
    );
    fillSelect(catSelect, catOptions, cat);
    fillSelect(locSelect, locOptions, loc);
    fillSelect(sortSelect, SORT_OPTIONS, sort);
  }

  async function loadItems() {
    if (!gridEl) return;
    try {
      var from = (page - 1) * PAGE_SIZE_MARKET;
      var to = from + PAGE_SIZE_MARKET - 1;

      var query = sb.from("items_view").select("*", { count: "exact" });

      if (cat) query = query.eq("category", cat);
      if (loc) query = query.eq("location", loc);

      // PostgREST or() 구문 파괴 방지: 콤마/퍼센트/괄호 제거
      var safeQ = q.replace(/[,%()]/g, "").trim();
      if (safeQ) {
        query = query.or("title.ilike.%" + safeQ + "%,description.ilike.%" + safeQ + "%");
      }

      var sortOpt = SORT_OPTIONS.filter(function (o) { return o.value === sort; })[0] || SORT_OPTIONS[0];
      query = query.order(sortOpt.column, { ascending: sortOpt.ascending });
      // 인기순은 동점 시 최신순으로 정렬 안정화
      if (sortOpt.value === "popular") {
        query = query.order("created_at", { ascending: false });
      }

      var res = await query.range(from, to);
      if (res.error) throw res.error;

      var items = res.data || [];
      var totalCount = res.count || 0;

      if (items.length === 0) {
        gridEl.innerHTML =
          '<div class="empty-state"><div class="empty-icon">🛒</div>' +
          (safeQ || cat || loc ? "검색 결과가 없습니다." : "등록된 매물이 없습니다.") +
          "</div>";
        if (paginationEl) paginationEl.innerHTML = "";
        return;
      }

      var html = '<div class="card-grid">';
      items.forEach(function (item) {
        var thumb = publicUrl(item.image_paths && item.image_paths[0]);
        var badge = "";
        if (item.status !== "selling" && ITEM_STATUS[item.status]) {
          badge =
            '<span class="badge ' + escapeHtml(item.status) + '">' +
            escapeHtml(ITEM_STATUS[item.status]) + "</span> ";
        }
        var commentCount = Number(item.comment_count) || 0;
        var likeCount = Number(item.like_count) || 0;
        var imgCount = (item.image_paths && item.image_paths.length) || 0;

        var metaExtra = "";
        if (likeCount > 0) {
          metaExtra += '<span class="meta-like">♥ ' + likeCount + "</span>";
        }
        if (imgCount > 0) {
          metaExtra += '<span class="meta-photo">📷 ' + imgCount + "</span>";
        }

        html +=
          '<a class="card" href="market-view.html?id=' + encodeURIComponent(item.id) + '">' +
            '<img class="card-thumb" src="' + escapeHtml(thumb) + '" alt="" loading="lazy">' +
            '<div class="card-body">' +
              '<div class="card-title">' + badge + escapeHtml(item.title) + "</div>" +
              '<div class="card-price">' + escapeHtml(formatPrice(item.price)) + "</div>" +
              '<div class="card-meta">' +
                "<span>" + escapeHtml(item.seller_username || "알수없음") + "</span>" +
                (item.location ? "<span>" + escapeHtml(item.location) + "</span>" : "") +
              "</div>" +
              '<div class="card-meta">' +
                "<span>" + escapeHtml(item.category) + "</span>" +
                "<span>" + escapeHtml(formatDate(item.created_at)) + "</span>" +
                "<span>댓글 " + commentCount + "</span>" +
                metaExtra +
              "</div>" +
            "</div>" +
          "</a>";
      });
      html += "</div>";
      gridEl.innerHTML = html;

      renderPagination(paginationEl, page, totalCount, PAGE_SIZE_MARKET, function (p) {
        return makeHref({ page: p });
      });
    } catch (err) {
      showToast(mapRpcError(err), "error");
      gridEl.innerHTML = '<div class="empty-state">' + escapeHtml(mapRpcError(err)) + "</div>";
    }
  }
})();
