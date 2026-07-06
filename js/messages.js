// 쪽지함 페이지 — 채팅형 대화 UI + 사용자 차단
// 의존: config.js → supabase-js → db.js → util.js → auth.js → messages-send.js
//
// 대화 모델: my_messages_view 전체를 counterpart_username 기준으로 그룹핑하여
//   대화(conversation) 목록을 만들고, 선택된 대화를 말풍선 스레드로 렌더링한다.
// 딥링크: ?with=<username> 로 특정 대화를 선택/공유. history 로 뒤로가기 지원.

(function () {
  renderHeader(null);

  var DEACTIVATED = "(탈퇴)";
  var REPLY_MAX_LEN = 2000;

  var noticeEl = document.getElementById("messages-notice");
  var chatEl = document.getElementById("msg-chat");
  var convItemsEl = document.getElementById("conv-items");
  var threadEl = document.getElementById("thread");
  var threadEmptyEl = document.getElementById("thread-empty");

  var conversations = [];        // [{key, username, isDeactivated, messages[], lastAt, unread}]
  var convByKey = {};            // key -> conversation
  var selectedKey = null;        // 현재 선택된 대화 key (= counterpart_username)
  var blockedSet = null;         // Set<string> 차단한 사용자명 (최초 1회 로드 후 캐시)
  var sending = false;

  if (!APP_CONFIGURED) {
    noticeEl.hidden = false;
    noticeEl.textContent = "서비스 준비중입니다.";
    convItemsEl.innerHTML = "";
    initAuth();
    return;
  }

  init();

  async function init() {
    await initAuth();
    await requireLogin();
    // 대화 데이터 + 차단 목록을 병렬 로드
    await Promise.all([loadMessages(), loadBlocks()]);
    applyFromUrl(); // ?with= 반영
    window.addEventListener("popstate", applyFromUrl);
  }

  // ===== 데이터 로드 =====

  async function loadMessages() {
    try {
      var res = await sb
        .from("my_messages_view")
        .select("id, direction, counterpart_username, content, context_type, context_id, context_title, read_at, created_at")
        .order("created_at", { ascending: true })
        .limit(500);
      if (res.error) throw res.error;
      buildConversations(res.data || []);
      renderConvList();
    } catch (err) {
      showToast(mapRpcError(err), "error");
      convItemsEl.innerHTML = '<div class="empty-state">쪽지를 불러오지 못했습니다.</div>';
    }
  }

  async function loadBlocks() {
    try {
      var res = await sb.rpc("my_blocks");
      if (res.error) throw res.error;
      var arr = Array.isArray(res.data) ? res.data : [];
      blockedSet = new Set(arr.map(function (u) { return String(u); }));
    } catch (err) {
      // 차단 목록 실패 시에도 페이지는 동작하도록 빈 셋으로 처리
      blockedSet = new Set();
    }
  }

  function buildConversations(rows) {
    conversations = [];
    convByKey = {};
    rows.forEach(function (m) {
      var key = m.counterpart_username || DEACTIVATED;
      var conv = convByKey[key];
      if (!conv) {
        conv = {
          key: key,
          username: m.counterpart_username || null,
          isDeactivated: !m.counterpart_username,
          messages: [],
          lastAt: 0,
          unread: 0
        };
        convByKey[key] = conv;
        conversations.push(conv);
      }
      conv.messages.push(m);
      var t = new Date(m.created_at).getTime();
      if (t > conv.lastAt) conv.lastAt = t;
      if (m.direction === "in" && !m.read_at) conv.unread++;
    });
    // 최근 대화 순 정렬
    conversations.sort(function (a, b) { return b.lastAt - a.lastAt; });
  }

  // ===== 대화 목록 렌더링 =====

  function renderConvList() {
    if (conversations.length === 0) {
      convItemsEl.innerHTML =
        '<div class="empty-state"><div class="empty-icon">✉️</div>주고받은 쪽지가 없습니다.</div>';
      return;
    }
    var html = "";
    conversations.forEach(function (conv) {
      var last = conv.messages[conv.messages.length - 1];
      var name = conv.username || DEACTIVATED;
      var initial = conv.username ? conv.username.charAt(0) : "?";
      var active = conv.key === selectedKey;
      html +=
        '<button type="button" class="msg-conv-item' + (active ? " is-active" : "") +
          '" data-key="' + escapeHtml(conv.key) + '">' +
          '<span class="msg-conv-avatar">' + escapeHtml(initial) + "</span>" +
          '<span class="msg-conv-main">' +
            '<span class="msg-conv-top">' +
              '<span class="msg-conv-name">' + escapeHtml(name) + "</span>" +
              '<span class="msg-conv-time">' + escapeHtml(formatDate(last.created_at)) + "</span>" +
            "</span>" +
            '<span class="msg-conv-preview">' +
              (last.direction === "out" ? "나: " : "") + escapeHtml(last.content) +
            "</span>" +
          "</span>" +
          (conv.unread > 0
            ? '<span class="msg-conv-unread">' + (conv.unread > 99 ? "99+" : conv.unread) + "</span>"
            : "") +
        "</button>";
    });
    convItemsEl.innerHTML = html;
  }

  convItemsEl.addEventListener("click", function (e) {
    var item = e.target.closest(".msg-conv-item");
    if (!item) return;
    selectConversation(item.dataset.key, true);
  });

  // ===== URL(?with=) 연동 =====

  function applyFromUrl() {
    var withUser = getParam("with");
    if (withUser && convByKey[withUser]) {
      selectConversation(withUser, false);
    } else {
      selectConversation(null, false);
    }
  }

  function pushWith(key) {
    var url = key
      ? "messages.html?with=" + encodeURIComponent(key)
      : "messages.html";
    history.pushState({ with: key || null }, "", url);
  }

  // ===== 대화 선택 / 스레드 렌더링 =====

  function selectConversation(key, push) {
    var conv = key ? convByKey[key] : null;
    selectedKey = conv ? key : null;

    if (push) pushWith(selectedKey);

    // 모바일: 선택 시 스레드 전체화면
    if (selectedKey) chatEl.classList.add("thread-open");
    else chatEl.classList.remove("thread-open");

    renderConvList();
    renderThread();

    if (conv && conv.unread > 0) markConversationRead(conv);
  }

  function renderThread() {
    var conv = selectedKey ? convByKey[selectedKey] : null;

    if (!conv) {
      // 활성 스레드 제거, 안내 표시
      var oldActive = threadEl.querySelector(".msg-thread-active");
      if (oldActive) oldActive.remove();
      threadEmptyEl.hidden = false;
      return;
    }

    threadEmptyEl.hidden = true;

    var name = conv.username || DEACTIVATED;
    var blocked = conv.username && blockedSet && blockedSet.has(conv.username);

    // --- 헤더 (뒤로 / 이름 / 차단 버튼) ---
    var headHtml =
      '<div class="msg-thread-head">' +
        '<button type="button" class="msg-back-btn" id="thread-back" aria-label="뒤로">&larr;</button>' +
        '<span class="msg-thread-title">' + escapeHtml(name) + "</span>" +
        (conv.isDeactivated
          ? ""
          : '<button type="button" class="btn btn-ghost btn-sm msg-block-btn" id="thread-block">' +
              (blocked ? "차단해제" : "차단") + "</button>") +
      "</div>";

    // --- 본문 (말풍선) ---
    var bodyHtml = '<div class="msg-thread-body" id="thread-body">';
    conv.messages.forEach(function (m) {
      var dir = m.direction === "out" ? "out" : "in";
      bodyHtml +=
        '<div class="msg-bubble-row ' + dir + '" data-id="' + escapeHtml(m.id) + '">' +
          contextChipHtml(m) +
          '<div class="msg-bubble">' + escapeHtml(m.content) + "</div>" +
          '<div class="msg-bubble-meta">' +
            '<span>' + escapeHtml(formatDate(m.created_at)) + "</span>" +
            '<button type="button" class="msg-bubble-del" data-id="' + escapeHtml(m.id) + '">삭제</button>' +
          "</div>" +
        "</div>";
    });
    bodyHtml += "</div>";

    // --- 입력 영역 ---
    var inputHtml = '<div class="msg-thread-input">';
    if (conv.isDeactivated) {
      inputHtml += '<div class="msg-input-note">탈퇴한 사용자에게는 쪽지를 보낼 수 없습니다.</div>';
    } else if (blocked) {
      inputHtml += '<div class="msg-input-note">차단한 상대입니다. 차단을 해제하면 쪽지를 보낼 수 있습니다.</div>';
    } else {
      inputHtml +=
        '<div class="msg-input-row">' +
          '<textarea class="msg-input-field" id="reply-input" maxlength="' + REPLY_MAX_LEN +
            '" placeholder="메시지를 입력하세요" rows="1"></textarea>' +
          '<button type="button" class="btn btn-primary msg-input-send" id="reply-send">보내기</button>' +
        "</div>";
    }
    inputHtml += "</div>";

    var oldActive = threadEl.querySelector(".msg-thread-active");
    if (oldActive) oldActive.remove();
    var active = document.createElement("div");
    active.className = "msg-thread-active";
    active.style.display = "flex";
    active.style.flexDirection = "column";
    active.style.flex = "1 1 auto";
    active.style.minHeight = "0";
    active.innerHTML = headHtml + bodyHtml + inputHtml;
    threadEl.appendChild(active);

    wireThread(conv);
    scrollThreadToBottom();
  }

  function wireThread(conv) {
    var backBtn = document.getElementById("thread-back");
    if (backBtn) {
      backBtn.addEventListener("click", function () { selectConversation(null, true); });
    }

    var blockBtn = document.getElementById("thread-block");
    if (blockBtn) {
      blockBtn.addEventListener("click", function () { onToggleBlock(conv, blockBtn); });
    }

    var sendBtn = document.getElementById("reply-send");
    var input = document.getElementById("reply-input");
    if (sendBtn && input) {
      sendBtn.addEventListener("click", function () { onSendReply(conv, input, sendBtn); });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSendReply(conv, input, sendBtn);
        }
      });
    }

    var body = document.getElementById("thread-body");
    if (body) {
      body.addEventListener("click", function (e) {
        if (e.target.closest("a.msg-context-chip")) return; // 링크는 기본 동작
        var delBtn = e.target.closest(".msg-bubble-del");
        if (delBtn) onDeleteMessage(conv, delBtn.dataset.id);
      });
    }
  }

  function contextChipHtml(m) {
    if (!m.context_title) return "";
    var prefix = m.context_type === "item" ? "[중고] " : "[글] ";
    var href = m.context_type === "item"
      ? "market-view.html?id=" + encodeURIComponent(m.context_id)
      : "board-view.html?id=" + encodeURIComponent(m.context_id);
    return '<a class="msg-context-chip msg-bubble-ctx" href="' + escapeHtml(href) + '">' +
      escapeHtml(prefix + m.context_title) + "</a>";
  }

  function scrollThreadToBottom() {
    var body = document.getElementById("thread-body");
    if (body) body.scrollTop = body.scrollHeight;
  }

  // ===== 읽음 처리 =====

  function markConversationRead(conv) {
    var unreadMsgs = conv.messages.filter(function (m) {
      return m.direction === "in" && !m.read_at;
    });
    if (unreadMsgs.length === 0) return;

    // 낙관적 갱신
    conv.unread = 0;
    renderConvList();

    var now = new Date().toISOString();
    var promises = unreadMsgs.map(function (m) {
      return sb.rpc("mark_message_read", { p_id: m.id }).then(function (res) {
        if (!res.error) m.read_at = now;
      });
    });
    Promise.all(promises).then(function () {
      if (typeof refreshUnreadBadge === "function") refreshUnreadBadge();
    });
  }

  // ===== 답장 보내기 =====

  async function onSendReply(conv, input, sendBtn) {
    if (sending) return;
    if (conv.isDeactivated) return;
    var content = input.value.trim();
    if (!content) {
      input.focus();
      return;
    }
    if (content.length > REPLY_MAX_LEN) {
      showToast("쪽지는 " + REPLY_MAX_LEN + "자 이내로 작성해주세요.", "error");
      return;
    }

    sending = true;
    setBusy(sendBtn, true);
    try {
      var res = await sb.rpc("send_message_to_user", {
        p_username: conv.username,
        p_content: content
      });
      if (res.error) throw res.error;
      input.value = "";
      await loadMessages();        // 서버 기준으로 스레드 재구성
      renderThread();              // 선택 대화 유지한 채 갱신
      var newInput = document.getElementById("reply-input");
      if (newInput) newInput.focus();
    } catch (err) {
      var msg = (err && err.message) || "";
      if (msg.indexOf("forbidden") !== -1) {
        showToast("차단된 상대에게는 보낼 수 없습니다.", "error");
      } else {
        showToast(mapRpcError(err), "error");
      }
      setBusy(sendBtn, false);
    } finally {
      sending = false;
    }
  }

  // ===== 차단 / 차단해제 =====

  async function onToggleBlock(conv, btn) {
    if (!conv.username || conv.isDeactivated) return;
    var isBlocked = blockedSet && blockedSet.has(conv.username);

    if (isBlocked) {
      setBusy(btn, true);
      try {
        var r1 = await sb.rpc("unblock_user", { p_username: conv.username });
        if (r1.error) throw r1.error;
        blockedSet.delete(conv.username);
        showToast("차단을 해제했습니다.", "success");
        renderThread();
      } catch (err) {
        showToast(mapRpcError(err), "error");
        setBusy(btn, false);
      }
      return;
    }

    var ok = await confirmDialog("이 사용자를 차단하시겠습니까? 상대가 나에게 쪽지를 보낼 수 없게 됩니다.");
    if (!ok) return;
    setBusy(btn, true);
    try {
      var r2 = await sb.rpc("block_user", { p_username: conv.username });
      if (r2.error) throw r2.error;
      blockedSet.add(conv.username);
      showToast("차단했습니다.", "success");
      renderThread();
    } catch (err) {
      showToast(mapRpcError(err), "error");
      setBusy(btn, false);
    }
  }

  // ===== 쪽지 삭제 (소프트, 내 쪽만) =====

  function onDeleteMessage(conv, id) {
    if (!id) return;
    confirmDialog("이 쪽지를 삭제하시겠습니까?").then(function (ok) {
      if (!ok) return;
      sb.rpc("delete_message", { p_id: id }).then(function (res) {
        if (res.error) {
          showToast(mapRpcError(res.error), "error");
          return;
        }
        showToast("쪽지가 삭제되었습니다.", "success");
        loadMessages().then(function () {
          // 대화가 비었으면 목록으로, 아니면 스레드 유지
          if (selectedKey && !convByKey[selectedKey]) {
            selectConversation(null, true);
          } else {
            renderThread();
          }
        });
      });
    });
  }
})();
