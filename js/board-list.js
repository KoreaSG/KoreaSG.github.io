// 커뮤니티 목록 페이지
// 의존: config.js → supabase-js → db.js → util.js → auth.js → upload.js

(function () {
  renderHeader("board");
  initAuth();

  var noticeEl = document.getElementById("board-notice");
  var listEl = document.getElementById("board-list");
  var paginationEl = document.getElementById("board-pagination");
  var searchInput = document.getElementById("search-input");
  var searchBtn = document.getElementById("search-btn");
  var sortTabsEl = document.getElementById("sort-tabs");
  var topicTabsEl = document.getElementById("topic-tabs");

  // 검색어에서 % 와 , 제거 (ilike 필터 안전 처리)
  function sanitizeQuery(str) {
    return String(str || "").replace(/[%,]/g, "").trim();
  }

  var q = sanitizeQuery(getParam("q"));
  var sort = getParam("sort") === "popular" ? "popular" : "new";
  var topic = getParam("topic") || ""; // 커뮤니티 slug ('' = 전체)
  var page = parseInt(getParam("page"), 10);
  if (!page || page < 1) page = 1;

  var communities = [];
  var selectedCommunity = null;

  searchInput.value = q;

  function makeHref(p, query, sortKey, topicSlug) {
    var params = new URLSearchParams();
    if (topicSlug) params.set("topic", topicSlug);
    if (query) params.set("q", query);
    if (sortKey === "popular") params.set("sort", "popular");
    if (p > 1) params.set("page", String(p));
    var qs = params.toString();
    return "board.html" + (qs ? "?" + qs : "");
  }

  function goSearch() {
    window.location.href = makeHref(1, sanitizeQuery(searchInput.value), sort, topic);
  }

  function renderSortTabs() {
    if (!sortTabsEl) return;
    sortTabsEl.innerHTML =
      '<a class="sort-tab' + (sort === "new" ? " is-active" : "") + '" href="' +
        escapeHtml(makeHref(1, q, "new", topic)) + '">최신순</a>' +
      '<a class="sort-tab' + (sort === "popular" ? " is-active" : "") + '" href="' +
        escapeHtml(makeHref(1, q, "popular", topic)) + '">인기순</a>';
  }

  function renderTopicTabs() {
    if (!topicTabsEl) return;
    var html =
      '<a class="chip' + (!topic ? " is-active" : "") + '" href="' +
        escapeHtml(makeHref(1, q, sort, "")) + '">전체</a>';
    communities.forEach(function (c) {
      html +=
        '<a class="chip' + (topic === c.slug ? " is-active" : "") + '" href="' +
          escapeHtml(makeHref(1, q, sort, c.slug)) + '">' + escapeHtml(c.name) + "</a>";
    });
    topicTabsEl.innerHTML = html;
  }

  renderSortTabs();

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
      var likeCount = Number(row.like_count) || 0;
      var viewCount = Number(row.view_count) || 0;
      var photoIcon = row.has_image
        ? ' <span class="board-row-photo" title="사진 있음" aria-label="사진 있음">📷</span>'
        : "";
      var topicChip = row.community_name
        ? '<span class="board-row-topic">' + escapeHtml(row.community_name) + "</span>"
        : "";
      html +=
        '<div class="board-row">' +
          '<a class="board-row-title" href="board-view.html?id=' + encodeURIComponent(row.id) + '">' +
            escapeHtml(row.title) +
            photoIcon +
            (count > 0 ? '<span class="comment-count">[' + count + "]</span>" : "") +
          "</a>" +
          topicChip +
          '<span class="board-row-stats">' +
            (likeCount > 0 ? '<span class="like-count">♥ ' + likeCount + "</span>" : "") +
            "조회 " + viewCount +
          "</span>" +
          '<span class="board-row-author">' + escapeHtml(row.author_display) + "</span>" +
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
      .select(
        "id, title, author_display, created_at, comment_count, like_count, view_count, community_id, community_name, has_image",
        { count: "exact" }
      );

    if (selectedCommunity) {
      query = query.eq("community_id", selectedCommunity.id);
    }

    if (sort === "popular") {
      query = query
        .order("recent_like_count", { ascending: false })
        .order("created_at", { ascending: false });
    } else {
      query = query.order("created_at", { ascending: false });
    }

    query = query.range(from, to);

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
        return makeHref(p, q, sort, topic);
      });
    });
  }

  // 주제 탭용 커뮤니티 목록을 먼저 불러온 뒤 목록 렌더링
  sb.from("communities_view")
    .select("id, slug, name, sort_order")
    .order("sort_order", { ascending: true })
    .then(function (res) {
      if (!res.error && res.data) {
        communities = res.data;
      }
      if (topic) {
        communities.forEach(function (c) {
          if (c.slug === topic) selectedCommunity = c;
        });
      }
      renderTopicTabs();
      load();
    });
})();
