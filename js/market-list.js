// 중고거래 목록 페이지
// 의존: config.js, supabase-js, db.js, util.js, auth.js, upload.js(publicUrl)

(function () {
  renderHeader("market");
  initAuth();

  var gridEl = document.getElementById("item-grid");
  var paginationEl = document.getElementById("pagination");
  var searchForm = document.getElementById("search-form");
  var searchInput = document.getElementById("search-input");
  var chipsEl = document.getElementById("category-chips");

  var q = getParam("q") || "";
  var cat = getParam("cat") || "";
  var page = parseInt(getParam("page"), 10);
  if (isNaN(page) || page < 1) page = 1;

  if (searchInput) searchInput.value = q;

  /**
   * 목록 URL 생성 (q/cat/page 상태 유지)
   */
  function makeHref(overrides) {
    var params = new URLSearchParams();
    var nextQ = overrides.q !== undefined ? overrides.q : q;
    var nextCat = overrides.cat !== undefined ? overrides.cat : cat;
    var nextPage = overrides.page !== undefined ? overrides.page : page;
    if (nextQ) params.set("q", nextQ);
    if (nextCat) params.set("cat", nextCat);
    if (nextPage > 1) params.set("page", String(nextPage));
    var qs = params.toString();
    return "market.html" + (qs ? "?" + qs : "");
  }

  renderChips();

  if (searchForm) {
    searchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      window.location.href = makeHref({ q: searchInput.value.trim(), page: 1 });
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

  function renderChips() {
    if (!chipsEl) return;
    var html =
      '<a class="chip' + (cat === "" ? " is-active" : "") + '" href="' +
      escapeHtml(makeHref({ cat: "", page: 1 })) + '">전체</a>';
    CATEGORIES.forEach(function (c) {
      html +=
        '<a class="chip' + (cat === c ? " is-active" : "") + '" href="' +
        escapeHtml(makeHref({ cat: c, page: 1 })) + '">' + escapeHtml(c) + "</a>";
    });
    chipsEl.innerHTML = html;
  }

  async function loadItems() {
    if (!gridEl) return;
    try {
      var from = (page - 1) * PAGE_SIZE_MARKET;
      var to = from + PAGE_SIZE_MARKET - 1;

      var query = sb.from("items_view").select("*", { count: "exact" });

      if (cat) query = query.eq("category", cat);

      // PostgREST or() 구문 파괴 방지: 콤마/퍼센트/괄호 제거
      var safeQ = q.replace(/[,%()]/g, "").trim();
      if (safeQ) {
        query = query.or("title.ilike.%" + safeQ + "%,description.ilike.%" + safeQ + "%");
      }

      var res = await query.order("created_at", { ascending: false }).range(from, to);
      if (res.error) throw res.error;

      var items = res.data || [];
      var totalCount = res.count || 0;

      if (items.length === 0) {
        gridEl.innerHTML =
          '<div class="empty-state"><div class="empty-icon">🛒</div>' +
          (safeQ || cat ? "검색 결과가 없습니다." : "등록된 매물이 없습니다.") +
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
        html +=
          '<a class="card" href="market-view.html?id=' + encodeURIComponent(item.id) + '">' +
            '<img class="card-thumb" src="' + escapeHtml(thumb) + '" alt="" loading="lazy">' +
            '<div class="card-body">' +
              '<div class="card-title">' + badge + escapeHtml(item.title) + "</div>" +
              '<div class="card-price">' + escapeHtml(formatPrice(item.price)) + "</div>" +
              '<div class="card-meta">' +
                "<span>" + escapeHtml(item.seller_username || "알수없음") + "</span>" +
                (item.seller_region ? "<span>" + escapeHtml(item.seller_region) + "</span>" : "") +
              "</div>" +
              '<div class="card-meta">' +
                "<span>" + escapeHtml(item.category) + "</span>" +
                "<span>" + escapeHtml(formatDate(item.created_at)) + "</span>" +
                "<span>댓글 " + commentCount + "</span>" +
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
