// 공용 유틸리티 함수 (전역)
// 의존: 없음 (renderHeader는 #site-header 요소 필요)

/**
 * 사용자 입력 콘텐츠를 렌더링할 때 반드시 사용.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 7일 미만: 상대 시간("방금 전","5분 전","3시간 전","2일 전")
 * 그 외: "YYYY.MM.DD" (Asia/Singapore 기준)
 */
function formatDate(iso) {
  if (!iso) return "";
  var date = new Date(iso);
  if (isNaN(date.getTime())) return "";

  var diffMs = Date.now() - date.getTime();
  var minute = 60 * 1000;
  var hour = 60 * minute;
  var day = 24 * hour;

  if (diffMs >= 0 && diffMs < 7 * day) {
    if (diffMs < minute) return "방금 전";
    if (diffMs < hour) return Math.floor(diffMs / minute) + "분 전";
    if (diffMs < day) return Math.floor(diffMs / hour) + "시간 전";
    return Math.floor(diffMs / day) + "일 전";
  }

  var parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date); // "YYYY-MM-DD"
  return parts.replace(/-/g, ".");
}

/**
 * 0 → "무료나눔", 그 외 "S$" + 천단위 콤마
 */
function formatPrice(n) {
  var num = Number(n);
  if (!num) return "무료나눔";
  return "S$" + num.toLocaleString("en-US");
}

/**
 * URL 쿼리스트링 파라미터 조회
 */
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * 번호형 페이지네이션 렌더링 (5개 윈도우 + 이전/다음)
 * makeHref(page) → 해당 페이지 URL 문자열
 */
function renderPagination(container, page, totalCount, pageSize, makeHref) {
  if (!container) return;
  var totalPages = Math.max(1, Math.ceil((totalCount || 0) / pageSize));
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  page = Math.min(Math.max(1, page), totalPages);

  var windowSize = 5;
  var start = Math.max(1, page - Math.floor(windowSize / 2));
  var end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  var html = '<nav class="pagination" aria-label="페이지 이동">';

  if (page > 1) {
    html += '<a class="page-link page-prev" href="' + escapeHtml(makeHref(page - 1)) + '" aria-label="이전 페이지">&laquo;</a>';
  } else {
    html += '<span class="page-link page-prev is-disabled" aria-hidden="true">&laquo;</span>';
  }

  for (var p = start; p <= end; p++) {
    if (p === page) {
      html += '<span class="page-link is-current" aria-current="page">' + p + "</span>";
    } else {
      html += '<a class="page-link" href="' + escapeHtml(makeHref(p)) + '">' + p + "</a>";
    }
  }

  if (page < totalPages) {
    html += '<a class="page-link page-next" href="' + escapeHtml(makeHref(page + 1)) + '" aria-label="다음 페이지">&raquo;</a>';
  } else {
    html += '<span class="page-link page-next is-disabled" aria-hidden="true">&raquo;</span>';
  }

  html += "</nav>";
  container.innerHTML = html;
}

/**
 * 모달 공통 골격 생성
 */
function _createModal(innerHtml) {
  var backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + innerHtml + "</div>";
  document.body.appendChild(backdrop);
  return backdrop;
}

/**
 * 4자리 숫자 비밀번호 입력 모달
 * @returns {Promise<string|null>} 확인 → 비밀번호, 취소/Esc → null
 */
function promptPassword(title) {
  return new Promise(function (resolve) {
    var backdrop = _createModal(
      '<h3 class="modal-title">' + escapeHtml(title || "비밀번호 확인") + "</h3>" +
      '<p class="modal-desc">숫자 4자리 비밀번호를 입력해주세요.</p>' +
      '<input type="password" class="modal-password-input" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••">' +
      '<p class="modal-error" hidden>비밀번호는 숫자 4자리여야 합니다.</p>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost modal-cancel">취소</button>' +
      '<button type="button" class="btn btn-primary modal-ok">확인</button>' +
      "</div>"
    );

    var input = backdrop.querySelector(".modal-password-input");
    var errorEl = backdrop.querySelector(".modal-error");

    function close(result) {
      document.removeEventListener("keydown", onKeydown);
      backdrop.remove();
      resolve(result);
    }

    function submit() {
      var value = input.value.trim();
      if (!/^\d{4}$/.test(value)) {
        errorEl.hidden = false;
        input.focus();
        return;
      }
      close(value);
    }

    function onKeydown(e) {
      if (e.key === "Escape") close(null);
    }

    backdrop.querySelector(".modal-ok").addEventListener("click", submit);
    backdrop.querySelector(".modal-cancel").addEventListener("click", function () { close(null); });
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close(null);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    input.addEventListener("input", function () {
      input.value = input.value.replace(/\D/g, "").slice(0, 4);
      errorEl.hidden = true;
    });
    document.addEventListener("keydown", onKeydown);

    input.focus();
  });
}

/**
 * 확인 다이얼로그 (window.confirm 대체)
 * @returns {Promise<boolean>}
 */
function confirmDialog(message) {
  return new Promise(function (resolve) {
    var backdrop = _createModal(
      '<p class="modal-message">' + escapeHtml(message) + "</p>" +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost modal-cancel">취소</button>' +
      '<button type="button" class="btn btn-primary modal-ok">확인</button>' +
      "</div>"
    );

    function close(result) {
      document.removeEventListener("keydown", onKeydown);
      backdrop.remove();
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    }

    backdrop.querySelector(".modal-ok").addEventListener("click", function () { close(true); });
    backdrop.querySelector(".modal-cancel").addEventListener("click", function () { close(false); });
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close(false);
    });
    document.addEventListener("keydown", onKeydown);

    backdrop.querySelector(".modal-ok").focus();
  });
}

/**
 * 토스트 알림 (3초 후 자동 제거)
 * @param {string} type 'success' | 'error'
 */
function showToast(message, type) {
  var toast = document.createElement("div");
  toast.className = "toast " + (type === "error" ? "toast-error" : "toast-success");
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.appendChild(toast);

  // 진입 애니메이션
  requestAnimationFrame(function () {
    toast.classList.add("toast-show");
  });

  setTimeout(function () {
    toast.classList.remove("toast-show");
    setTimeout(function () { toast.remove(); }, 300);
  }, 3000);
}

/**
 * Supabase RPC 에러 → 한국어 메시지
 */
function mapRpcError(error) {
  var msg = (error && error.message) || "";
  if (msg.indexOf("auth_required") !== -1) return "로그인이 필요합니다.";
  if (msg.indexOf("forbidden") !== -1) return "권한이 없습니다.";
  if (msg.indexOf("wrong_password") !== -1) return "비밀번호가 일치하지 않습니다.";
  if (msg.indexOf("rate_limited") !== -1) return "요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.";
  if (msg.indexOf("not_found") !== -1) return "대상을 찾을 수 없습니다.";
  if (msg.indexOf("invalid_input") !== -1) return "입력값이 올바르지 않습니다.";
  if (msg.indexOf("invalid_password_format") !== -1) return "비밀번호는 숫자 4자리여야 합니다.";
  return "오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
}

/**
 * 버튼 로딩 상태 토글 (비활성화 + "처리중…" 라벨)
 */
function setBusy(button, busy) {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "처리중…";
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel !== undefined) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
  }
}

/**
 * 공용 헤더/네비 렌더링 (#site-header에 주입)
 * @param {string} active 'home' | 'market' | 'board'
 */
function renderHeader(active) {
  var mount = document.getElementById("site-header");
  if (!mount) return;

  function navClass(key) {
    return "nav-link" + (active === key ? " is-active" : "");
  }

  mount.innerHTML =
    '<header class="site-header">' +
      '<div class="header-inner container">' +
        '<a class="site-logo" href="index.html">🦁 KoreaSG</a>' +
        '<button type="button" class="nav-toggle" aria-label="메뉴 열기" aria-expanded="false">' +
          "<span></span><span></span><span></span>" +
        "</button>" +
        '<nav class="site-nav">' +
          '<a class="' + navClass("home") + '" href="index.html">홈</a>' +
          '<a class="' + navClass("market") + '" href="market.html">중고거래</a>' +
          '<a class="' + navClass("board") + '" href="board.html">커뮤니티</a>' +
          '<div class="nav-account" id="nav-account"></div>' +
        "</nav>" +
      "</div>" +
    "</header>";

  var toggle = mount.querySelector(".nav-toggle");
  var nav = mount.querySelector(".site-nav");
  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

/**
 * 오늘 날짜 키 (Asia/Singapore 기준 YYYY-MM-DD)
 */
function _todayKeySG() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

/**
 * 방문자 통계 푸터 렌더링 (전 페이지 공용)
 * - record_visit(): 브라우저 세션당 하루 1회만 호출 (sessionStorage 가드), 실패해도 무시
 * - visit_stats(): {total, today} → "누적 방문 N · 오늘 N"
 * - #visitor-stats 요소가 있으면 채우고, 없으면 <body> 하단에 작은 바를 추가
 */
function renderVisitorStats() {
  if (!APP_CONFIGURED || !sb) return;

  var slot = document.getElementById("visitor-stats");
  if (!slot) {
    slot = document.createElement("div");
    slot.id = "visitor-stats";
    slot.className = "visitor-stats";
    document.body.appendChild(slot);
  }

  function paint(stats) {
    if (!stats) return;
    var total = Number(stats.total) || 0;
    var today = Number(stats.today) || 0;
    slot.innerHTML =
      "누적 방문 <b>" + escapeHtml(total.toLocaleString()) + "</b> · " +
      "오늘 <b>" + escapeHtml(today.toLocaleString()) + "</b>";
  }

  function loadStats() {
    sb.rpc("visit_stats").then(function (res) {
      if (res.error) return;
      paint(res.data);
    });
  }

  var key = "visited_" + _todayKeySG();
  var visited = false;
  try {
    visited = sessionStorage.getItem(key) === "1";
  } catch (e) {}

  if (!visited) {
    try {
      sessionStorage.setItem(key, "1");
    } catch (e) {}
    // record_visit 은 절대 에러를 던지지 않지만, 실패해도 통계는 표시
    sb.rpc("record_visit").then(loadStats, loadStats);
  } else {
    loadStats();
  }
}
