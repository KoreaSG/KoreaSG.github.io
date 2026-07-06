// 쪽지함 페이지 (로그인 필수)
// 의존: config.js → supabase-js → db.js → util.js → auth.js → messages-send.js

(function () {
  renderHeader(null);

  var noticeEl = document.getElementById("messages-notice");
  var listEl = document.getElementById("msg-list");
  var tabInBtn = document.getElementById("tab-in");
  var tabOutBtn = document.getElementById("tab-out");

  var allMessages = [];
  var currentTab = "in"; // 'in' | 'out'
  var expandedId = null;

  if (!APP_CONFIGURED) {
    noticeEl.hidden = false;
    noticeEl.textContent = "서비스 준비중입니다.";
    listEl.innerHTML = "";
    initAuth();
    return;
  }

  init();

  async function init() {
    await initAuth();
    await requireLogin();
    await loadMessages();
  }

  async function loadMessages() {
    try {
      var res = await sb
        .from("my_messages_view")
        .select("id, direction, counterpart_username, content, context_type, context_id, context_title, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (res.error) throw res.error;
      allMessages = res.data || [];
      renderList();
    } catch (err) {
      showToast(mapRpcError(err), "error");
      listEl.innerHTML = '<div class="empty-state">쪽지를 불러오지 못했습니다.</div>';
    }
  }

  function contextChipHtml(m) {
    if (!m.context_title) return "";
    var prefix = m.context_type === "item" ? "[중고] " : "[글] ";
    var href = m.context_type === "item"
      ? "market-view.html?id=" + encodeURIComponent(m.context_id)
      : "board-view.html?id=" + encodeURIComponent(m.context_id);
    return '<a class="msg-context-chip" href="' + escapeHtml(href) + '">' +
      escapeHtml(prefix + m.context_title) + "</a>";
  }

  function renderList() {
    var rows = allMessages.filter(function (m) { return m.direction === currentTab; });

    if (rows.length === 0) {
      listEl.innerHTML =
        '<div class="msg-empty empty-state"><div class="empty-icon">✉️</div>' +
        (currentTab === "in" ? "받은 쪽지가 없습니다." : "보낸 쪽지가 없습니다.") +
        "</div>";
      return;
    }

    var dirLabel = currentTab === "in" ? "보낸사람" : "받는사람";
    var html = "";
    rows.forEach(function (m) {
      var unread = m.direction === "in" && !m.read_at;
      var expanded = expandedId === m.id;
      var canReply = m.counterpart_username && m.counterpart_username !== "(탈퇴)";

      html +=
        '<div class="msg-row' + (unread ? " unread" : "") + '" data-id="' + escapeHtml(m.id) + '">' +
          '<div class="msg-row-head">' +
            (unread ? '<span class="msg-dot" aria-label="읽지 않음"></span>' : "") +
            '<span class="msg-dir-label">' + dirLabel + "</span>" +
            '<span class="msg-counterpart">' + escapeHtml(m.counterpart_username || "(탈퇴)") + "</span>" +
            contextChipHtml(m) +
            '<span class="msg-date">' + escapeHtml(formatDate(m.created_at)) + "</span>" +
          "</div>" +
          '<div class="msg-preview">' + escapeHtml(m.content) + "</div>" +
          '<div class="msg-detail"' + (expanded ? "" : " hidden") + ">" +
            '<div class="msg-detail-content">' + escapeHtml(m.content) + "</div>" +
            '<div class="msg-detail-actions">' +
              (canReply
                ? '<button type="button" class="btn btn-sm msg-reply-btn" data-username="' + escapeHtml(m.counterpart_username) + '">답장</button>'
                : "") +
              '<button type="button" class="btn btn-ghost btn-sm msg-delete-btn">삭제</button>' +
            "</div>" +
          "</div>" +
        "</div>";
    });
    listEl.innerHTML = html;
  }

  function markRead(m, rowEl) {
    sb.rpc("mark_message_read", { p_id: m.id }).then(function (res) {
      if (res.error) return; // 읽음 처리 실패는 조용히 무시
      m.read_at = new Date().toISOString();
      if (rowEl) {
        rowEl.classList.remove("unread");
        var dot = rowEl.querySelector(".msg-dot");
        if (dot) dot.remove();
      }
      if (typeof refreshUnreadBadge === "function") refreshUnreadBadge();
    });
  }

  listEl.addEventListener("click", function (e) {
    // 컨텍스트 칩(링크)은 기본 동작 유지
    if (e.target.closest("a.msg-context-chip")) return;

    var row = e.target.closest(".msg-row");
    if (!row) return;
    var id = row.dataset.id;
    var msg = null;
    for (var i = 0; i < allMessages.length; i++) {
      if (allMessages[i].id === id) { msg = allMessages[i]; break; }
    }
    if (!msg) return;

    // 답장 버튼
    var replyBtn = e.target.closest(".msg-reply-btn");
    if (replyBtn) {
      openMessageModal({ toUsername: replyBtn.dataset.username });
      return;
    }

    // 삭제 버튼
    var deleteBtn = e.target.closest(".msg-delete-btn");
    if (deleteBtn) {
      confirmDialog("쪽지를 삭제하시겠습니까?").then(function (ok) {
        if (!ok) return;
        setBusy(deleteBtn, true);
        sb.rpc("delete_message", { p_id: id }).then(function (res) {
          if (res.error) {
            setBusy(deleteBtn, false);
            showToast(mapRpcError(res.error), "error");
            return;
          }
          showToast("쪽지가 삭제되었습니다.", "success");
          expandedId = null;
          loadMessages();
        });
      });
      return;
    }

    // 행 클릭 → 상세 토글
    var detail = row.querySelector(".msg-detail");
    var willOpen = detail.hidden;
    // 다른 행 접기
    listEl.querySelectorAll(".msg-detail").forEach(function (d) { d.hidden = true; });
    detail.hidden = !willOpen;
    expandedId = willOpen ? id : null;

    if (willOpen && msg.direction === "in" && !msg.read_at) {
      markRead(msg, row);
    }
  });

  function switchTab(tab) {
    if (currentTab === tab) return;
    currentTab = tab;
    expandedId = null;
    tabInBtn.classList.toggle("is-active", tab === "in");
    tabOutBtn.classList.toggle("is-active", tab === "out");
    tabInBtn.setAttribute("aria-selected", tab === "in" ? "true" : "false");
    tabOutBtn.setAttribute("aria-selected", tab === "out" ? "true" : "false");
    renderList();
  }

  tabInBtn.addEventListener("click", function () { switchTab("in"); });
  tabOutBtn.addEventListener("click", function () { switchTab("out"); });
})();
