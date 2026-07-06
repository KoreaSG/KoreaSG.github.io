// 커뮤니티 목록 페이지
// 의존: config.js → supabase-js → db.js → util.js

(function () {
  renderHeader("board");

  var noticeEl = document.getElementById("board-notice");
  var listEl = document.getElementById("board-list");
  var paginationEl = document.getElementById("board-pagination");
  var searchInput = document.getElementById("search-input");
  var searchBtn = document.getElementById("search-btn");

  // 검색어에서 % 와 , 제거 (ilike 필터 안전 처리)
  function sanitizeQuery(str) {
    return String(str || "").replace(/[%,]/g, "").trim();
  }

  var q = sanitizeQuery(getParam("q"));
  var page = parseInt(getParam("page"), 10);
  if (!page || page < 1) page = 1;

  searchInput.value = q;

  function makeHref(p, query) {
    var params = new URLSearchParams();
    if (query) params.set("q", query);
    if (p > 1) params.set("page", String(p));
    var qs = params.toString();
    return "board.html" + (qs ? "?" + qs : "");
  }

  function goSearch() {
    window.location.href = makeHref(1, sanitizeQuery(searchInput.value));
  }

  searchBtn.addEventListener("click", goSearch);
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      goSearch();
    }
  });

  if (!APP_CONFIGURED) {
    noticeEl.hidden = false;
    noticeEl.textContent = "서비스 준비중입니다";
    listEl.innerHTML = "";
    return;
  }

  function renderList(rows) {
    if (!rows || rows.length === 0) {
      listEl.innerHTML =
        '<div class="empty-state"><div class="empty-icon">💬</div>' +
        (q ? "검색 결과가 없습니다." : "아직 게시글이 없습니다. 첫 글을 작성해보세요!") +
        "</div>";
      return;
    }

    var html = '<div class="board-table">';
    rows.forEach(function (row) {
      var count = Number(row.comment_count) || 0;
      html +=
        '<div class="board-row">' +
          '<a class="board-row-title" href="board-view.html?id=' + encodeURIComponent(row.id) + '">' +
            escapeHtml(row.title) +
            (count > 0 ? '<span class="comment-count">[' + count + "]</span>" : "") +
          "</a>" +
          '<span class="board-row-author">' + escapeHtml(row.author_name) + "</span>" +
          '<span class="board-row-date">' + formatDate(row.created_at) + "</span>" +
        "</div>";
    });
    html += "</div>";
    listEl.innerHTML = html;
  }

  function load() {
    var from = (page - 1) * PAGE_SIZE_BOARD;
    var to = from + PAGE_SIZE_BOARD - 1;

    var query = sb
      .from("posts_view")
      .select("id, title, author_name, created_at, comment_count", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (q) {
      query = query.ilike("title", "%" + q + "%");
    }

    query.then(function (res) {
      if (res.error) {
        showToast(mapRpcError(res.error), "error");
        listEl.innerHTML =
          '<div class="empty-state"><div class="empty-icon">⚠️</div>목록을 불러오지 못했습니다.</div>';
        return;
      }
      renderList(res.data);
      renderPagination(paginationEl, page, res.count || 0, PAGE_SIZE_BOARD, function (p) {
        return makeHref(p, q);
      });
    });
  }

  load();
})();
