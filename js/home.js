// 홈 페이지: 최근 매물 5건 + 최근 글 5건
// 의존: config.js, supabase-js, db.js, util.js, auth.js, upload.js

(function () {
  renderHeader("home");
  initAuth();

  var itemsEl = document.getElementById("recent-items");
  var postsEl = document.getElementById("recent-posts");

  if (!APP_CONFIGURED) {
    var notice = document.getElementById("home-notice");
    if (notice) {
      notice.hidden = false;
      notice.textContent = "서비스 준비중입니다.";
    }
    if (itemsEl) itemsEl.innerHTML = '<div class="empty-state">서비스 준비중입니다.</div>';
    if (postsEl) postsEl.innerHTML = '<div class="empty-state">서비스 준비중입니다.</div>';
    return;
  }

  loadRecentItems();
  loadRecentPosts();
  loadPopularPosts();

  async function loadRecentItems() {
    if (!itemsEl) return;
    try {
      var res = await sb
        .from("items_view")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      if (res.error) throw res.error;

      var items = res.data || [];
      if (items.length === 0) {
        itemsEl.innerHTML = '<div class="empty-state">등록된 매물이 없습니다.</div>';
        return;
      }

      var html = '<ul class="recent-list">';
      items.forEach(function (item) {
        var thumb = publicUrl(item.image_paths && item.image_paths[0]);
        html +=
          '<li class="recent-item">' +
            '<a href="market-view.html?id=' + encodeURIComponent(item.id) + '">' +
              '<img class="recent-thumb" src="' + escapeHtml(thumb) + '" alt="" loading="lazy">' +
              '<div class="recent-info">' +
                '<div class="recent-title">' + escapeHtml(item.title) + "</div>" +
                '<div class="recent-sub">' +
                  '<span class="price">' + escapeHtml(formatPrice(item.price)) + "</span>" +
                  "<span>" + escapeHtml(formatDate(item.created_at)) + "</span>" +
                "</div>" +
              "</div>" +
            "</a>" +
          "</li>";
      });
      html += "</ul>";
      itemsEl.innerHTML = html;
    } catch (err) {
      itemsEl.innerHTML = '<div class="empty-state">' + escapeHtml(mapRpcError(err)) + "</div>";
    }
  }

  // 인기 글 TOP 5 (최근 7일 좋아요 기준) — 없으면 섹션 자체를 숨김 유지
  async function loadPopularPosts() {
    var sectionEl = document.getElementById("popular-posts-section");
    var listEl = document.getElementById("popular-posts");
    if (!sectionEl || !listEl) return;
    try {
      var res = await sb
        .from("posts_view")
        .select("id, title, author_display, recent_like_count, created_at")
        .gt("recent_like_count", 0)
        .order("recent_like_count", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5);
      if (res.error) throw res.error;

      var posts = res.data || [];
      if (posts.length === 0) return;

      var html = '<ul class="recent-list">';
      posts.forEach(function (post) {
        html +=
          '<li class="recent-item">' +
            '<a href="board-view.html?id=' + encodeURIComponent(post.id) + '">' +
              '<span class="popular-like">♥ ' + (Number(post.recent_like_count) || 0) + "</span>" +
              '<div class="recent-info">' +
                '<div class="recent-title">' + escapeHtml(post.title) + "</div>" +
              "</div>" +
              '<span class="popular-author">' + escapeHtml(post.author_display) + "</span>" +
            "</a>" +
          "</li>";
      });
      html += "</ul>";
      listEl.innerHTML = html;
      sectionEl.hidden = false;
    } catch (err) {
      // 인기 글 로드 실패 시 섹션을 숨긴 채로 둠 (홈 화면을 막지 않음)
    }
  }

  async function loadRecentPosts() {
    if (!postsEl) return;
    try {
      var res = await sb
        .from("posts_view")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      if (res.error) throw res.error;

      var posts = res.data || [];
      if (posts.length === 0) {
        postsEl.innerHTML = '<div class="empty-state">등록된 글이 없습니다.</div>';
        return;
      }

      var html = '<ul class="recent-list">';
      posts.forEach(function (post) {
        var commentCount = post.comment_count
          ? ' <span class="comment-count">[' + Number(post.comment_count) + "]</span>"
          : "";
        html +=
          '<li class="recent-item">' +
            '<a href="board-view.html?id=' + encodeURIComponent(post.id) + '">' +
              '<div class="recent-info">' +
                '<div class="recent-title">' + escapeHtml(post.title) + commentCount + "</div>" +
                '<div class="recent-sub"><span>' + escapeHtml(formatDate(post.created_at)) + "</span></div>" +
              "</div>" +
            "</a>" +
          "</li>";
      });
      html += "</ul>";
      postsEl.innerHTML = html;
    } catch (err) {
      postsEl.innerHTML = '<div class="empty-state">' + escapeHtml(mapRpcError(err)) + "</div>";
    }
  }
})();
