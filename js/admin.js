// 관리자 페이지 (주제 관리 + 신고 처리)
// 의존: config.js → supabase-js → db.js → util.js → auth.js
// 로드 순서: config → supabase → db → util → auth → admin.js
//
// UI 게이팅만 담당(is_admin). 실제 권한 검증은 서버(RPC 내부 _is_admin)에서 수행.

(function () {
  renderHeader(null);

  var gateEl = document.getElementById("admin-gate");
  var contentEl = document.getElementById("admin-content");
  var communityListEl = document.getElementById("community-list");
  var createForm = document.getElementById("community-create-form");
  var reportsBodyEl = document.getElementById("reports-body");
  var reportTabsEl = document.getElementById("report-tabs");

  var SLUG_RE = /^[a-z0-9-]{2,30}$/;
  var reportStatus = "open"; // 'open' | 'resolved'

  var TARGET_LABELS = {
    post: "게시글",
    item: "매물",
    comment: "댓글",
    message: "쪽지"
  };

  function showGate(message) {
    contentEl.hidden = true;
    gateEl.hidden = false;
    gateEl.innerHTML =
      '<div class="notice-box">' + escapeHtml(message) + "</div>" +
      '<p class="admin-gate-home"><a class="nav-link" href="index.html">홈으로 돌아가기</a></p>';
  }

  async function init() {
    await initAuth();

    var profile = getProfile();
    if (!profile || !profile.is_admin) {
      // 미로그인 또는 비관리자 — RPC 호출하지 않고 중단
      showGate("접근 권한이 없습니다.");
      return;
    }
    if (!APP_CONFIGURED || !sb) {
      showGate("서비스 준비중입니다.");
      return;
    }

    gateEl.hidden = true;
    contentEl.hidden = false;

    bindCreateForm();
    bindReportTabs();
    loadCommunities();
    loadReports();
  }

  // ===== A. 주제 관리 =====

  function loadCommunities() {
    communityListEl.innerHTML = '<div class="empty-state">불러오는 중…</div>';
    sb.from("communities_view")
      .select("id, slug, name, description, sort_order")
      .order("sort_order", { ascending: true })
      .then(function (res) {
        if (res.error) {
          communityListEl.innerHTML =
            '<div class="empty-state">목록을 불러오지 못했습니다.</div>';
          showToast(mapRpcError(res.error), "error");
          return;
        }
        renderCommunities(res.data || []);
      });
  }

  function renderCommunities(rows) {
    if (!rows.length) {
      communityListEl.innerHTML =
        '<div class="empty-state">등록된 주제가 없습니다.</div>';
      return;
    }
    communityListEl.innerHTML = rows.map(communityCardHtml).join("");
    communityListEl.querySelectorAll(".admin-card").forEach(bindCommunityCard);
  }

  function communityCardHtml(row) {
    var sortVal = row.sort_order == null ? 0 : row.sort_order;
    return (
      '<div class="admin-card" data-id="' + escapeHtml(String(row.id)) + '">' +
        '<div class="admin-card-head">' +
          "<b>" + escapeHtml(row.name) + "</b>" +
          '<code class="admin-slug">' + escapeHtml(row.slug) + "</code>" +
        "</div>" +
        '<div class="form-group">' +
          "<label>이름</label>" +
          '<input type="text" class="c-name" value="' + escapeHtml(row.name) + '">' +
        "</div>" +
        '<div class="form-group">' +
          "<label>설명</label>" +
          '<textarea class="c-desc" rows="2">' + escapeHtml(row.description || "") + "</textarea>" +
        "</div>" +
        '<div class="admin-inline">' +
          '<div class="form-group admin-inline-sort">' +
            "<label>정렬 순서</label>" +
            '<input type="number" class="c-sort" value="' + escapeHtml(String(sortVal)) + '">' +
          "</div>" +
          '<label class="admin-check"><input type="checkbox" class="c-active" checked> 활성</label>' +
          '<button type="button" class="btn btn-primary btn-sm c-save">저장</button>' +
        "</div>" +
      "</div>"
    );
  }

  function bindCommunityCard(card) {
    var id = card.dataset.id;
    var btn = card.querySelector(".c-save");
    btn.addEventListener("click", function () {
      var name = card.querySelector(".c-name").value.trim();
      var desc = card.querySelector(".c-desc").value.trim();
      var sort = parseInt(card.querySelector(".c-sort").value, 10);
      var active = card.querySelector(".c-active").checked;

      if (!name) {
        showToast("이름을 입력해주세요.", "error");
        return;
      }
      if (isNaN(sort)) sort = 0;

      setBusy(btn, true);
      sb.rpc("update_community", {
        p_id: id,
        p_name: name,
        p_description: desc,
        p_sort_order: sort,
        p_is_active: active
      }).then(function (res) {
        setBusy(btn, false);
        if (res.error) {
          showToast(mapRpcError(res.error), "error");
          return;
        }
        showToast(active ? "저장되었습니다." : "비활성화되어 목록에서 제외됩니다.", "success");
        loadCommunities();
      });
    });
  }

  function bindCreateForm() {
    var slugInput = document.getElementById("nc-slug");
    var nameInput = document.getElementById("nc-name");
    var descInput = document.getElementById("nc-desc");
    var sortInput = document.getElementById("nc-sort");
    var submitBtn = document.getElementById("nc-submit");

    createForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var slug = slugInput.value.trim().toLowerCase();
      var name = nameInput.value.trim();
      var desc = descInput.value.trim();
      var sort = parseInt(sortInput.value, 10);
      if (isNaN(sort)) sort = 0;

      if (!SLUG_RE.test(slug)) {
        showToast("슬러그 형식이 올바르지 않습니다. (영문 소문자·숫자·-, 2~30자)", "error");
        slugInput.focus();
        return;
      }
      if (!name) {
        showToast("이름을 입력해주세요.", "error");
        nameInput.focus();
        return;
      }

      setBusy(submitBtn, true);
      sb.rpc("create_community", {
        p_slug: slug,
        p_name: name,
        p_description: desc,
        p_sort_order: sort
      }).then(function (res) {
        setBusy(submitBtn, false);
        if (res.error) {
          showToast(mapRpcError(res.error), "error");
          return;
        }
        showToast("새 주제가 생성되었습니다.", "success");
        createForm.reset();
        loadCommunities();
      });
    });
  }

  // ===== B. 신고 처리 =====

  function bindReportTabs() {
    reportTabsEl.addEventListener("click", function (e) {
      var tab = e.target.closest("[data-status]");
      if (!tab) return;
      var status = tab.getAttribute("data-status");
      if (status === reportStatus) return;
      reportStatus = status;
      updateReportTabs();
      loadReports();
    });
    updateReportTabs();
  }

  function updateReportTabs() {
    reportTabsEl.querySelectorAll("[data-status]").forEach(function (t) {
      t.classList.toggle("is-active", t.getAttribute("data-status") === reportStatus);
    });
  }

  function loadReports() {
    reportsBodyEl.innerHTML =
      '<tr><td colspan="6" class="admin-empty">불러오는 중…</td></tr>';
    sb.rpc("admin_reports", { p_status: reportStatus }).then(function (res) {
      if (res.error) {
        reportsBodyEl.innerHTML =
          '<tr><td colspan="6" class="admin-empty">불러오지 못했습니다.</td></tr>';
        showToast(mapRpcError(res.error), "error");
        return;
      }
      renderReports(res.data || []);
    });
  }

  function targetCellHtml(type, targetId) {
    if (type === "post") {
      return '<a href="board-view.html?id=' + encodeURIComponent(targetId) + '">게시글 보기</a>';
    }
    if (type === "item") {
      return '<a href="market-view.html?id=' + encodeURIComponent(targetId) + '">매물 보기</a>';
    }
    return '<span class="admin-mono">' + escapeHtml(String(targetId)) + "</span>";
  }

  function renderReports(rows) {
    if (!rows.length) {
      reportsBodyEl.innerHTML =
        '<tr><td colspan="6" class="admin-empty">' +
        (reportStatus === "open" ? "미처리 신고가 없습니다." : "처리된 신고가 없습니다.") +
        "</td></tr>";
      return;
    }

    reportsBodyEl.innerHTML = rows
      .map(function (r) {
        var label = TARGET_LABELS[r.target_type] || r.target_type || "";
        var actionCell =
          reportStatus === "open"
            ? '<button type="button" class="btn btn-sm btn-danger r-resolve" data-id="' +
              escapeHtml(String(r.id)) +
              '">처리 완료</button>'
            : '<span class="admin-badge">처리됨</span>';
        return (
          "<tr>" +
            "<td>" +
              '<div class="admin-target-label">' + escapeHtml(label) + "</div>" +
              '<div class="admin-target">' + targetCellHtml(r.target_type, r.target_id) + "</div>" +
            "</td>" +
            "<td>" + escapeHtml(r.reason || "") + "</td>" +
            "<td>" + escapeHtml(r.note || "") + "</td>" +
            "<td>" + escapeHtml(r.reporter_username || "") + "</td>" +
            "<td>" + escapeHtml(formatDate(r.created_at)) + "</td>" +
            "<td>" + actionCell + "</td>" +
          "</tr>"
        );
      })
      .join("");

    reportsBodyEl.querySelectorAll(".r-resolve").forEach(function (btn) {
      btn.addEventListener("click", function () {
        resolveReport(btn.getAttribute("data-id"), btn);
      });
    });
  }

  function resolveReport(id, btn) {
    setBusy(btn, true);
    sb.rpc("resolve_report", { p_id: id }).then(function (res) {
      setBusy(btn, false);
      if (res.error) {
        showToast(mapRpcError(res.error), "error");
        return;
      }
      showToast("신고를 처리했습니다.", "success");
      loadReports();
    });
  }

  init();
})();
