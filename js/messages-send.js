// 쪽지 보내기 공용 모달 (전역 함수)
// 의존: config.js, supabase-js(UMD), db.js, util.js, auth.js
// 로드 순서: config → supabase → db → util → auth → messages-send → page.js
//
// 공개 API:
//   openMessageModal({toUsername=null, itemId=null, postId=null, title=''})
//     - toUsername: 특정 사용자에게 보내기 (send_message_to_user)
//     - itemId:     매물 판매자에게 보내기 (send_message_to_item)
//     - postId:     게시글 작성자에게 보내기 (send_message_to_post)
//     - title:      매물/게시글 제목 (안내용 표시)

var MESSAGE_MAX_LEN = 2000;

function openMessageModal(opts) {
  opts = opts || {};
  var toUsername = opts.toUsername || null;
  var itemId = opts.itemId || null;
  var postId = opts.postId || null;
  var title = opts.title || "";

  if (!APP_CONFIGURED || !sb) {
    showToast("서비스 준비중입니다.", "error");
    return;
  }
  if (!toUsername && !itemId && !postId) return;

  var recipientHtml;
  if (toUsername) {
    recipientHtml = "받는 사람: <b>" + escapeHtml(toUsername) + "</b>";
  } else if (itemId) {
    recipientHtml = "판매자에게 쪽지";
  } else {
    recipientHtml = "글쓴이에게 쪽지";
  }
  if (title) {
    recipientHtml +=
      '<span class="msg-context-chip">' +
      escapeHtml((itemId ? "[중고] " : postId ? "[글] " : "") + title) +
      "</span>";
  }

  var backdrop = _createModal(
    '<h3 class="modal-title">쪽지 보내기</h3>' +
    '<p class="modal-desc msg-modal-recipient">' + recipientHtml + "</p>" +
    '<textarea class="msg-modal-textarea" maxlength="' + MESSAGE_MAX_LEN + '" placeholder="내용을 입력해주세요 (최대 ' + MESSAGE_MAX_LEN + '자)"></textarea>' +
    '<div class="msg-modal-counter">0 / ' + MESSAGE_MAX_LEN + "</div>" +
    '<div class="modal-actions">' +
    '<button type="button" class="btn btn-ghost modal-cancel">취소</button>' +
    '<button type="button" class="btn btn-primary modal-ok">보내기</button>' +
    "</div>"
  );

  var textarea = backdrop.querySelector(".msg-modal-textarea");
  var counter = backdrop.querySelector(".msg-modal-counter");
  var sendBtn = backdrop.querySelector(".modal-ok");
  var sending = false;

  function close() {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
  }

  function onKeydown(e) {
    if (e.key === "Escape" && !sending) close();
  }

  function updateCounter() {
    counter.textContent = textarea.value.length + " / " + MESSAGE_MAX_LEN;
  }

  async function send() {
    if (sending) return;
    var content = textarea.value.trim();
    if (!content) {
      showToast("내용을 입력해주세요.", "error");
      textarea.focus();
      return;
    }
    if (content.length > MESSAGE_MAX_LEN) {
      showToast("쪽지는 " + MESSAGE_MAX_LEN + "자 이내로 작성해주세요.", "error");
      return;
    }

    sending = true;
    setBusy(sendBtn, true);
    try {
      var res;
      if (itemId) {
        res = await sb.rpc("send_message_to_item", { p_item_id: itemId, p_content: content });
      } else if (postId) {
        res = await sb.rpc("send_message_to_post", { p_post_id: postId, p_content: content });
      } else {
        res = await sb.rpc("send_message_to_user", { p_username: toUsername, p_content: content });
      }
      if (res.error) throw res.error;
      showToast("쪽지를 보냈습니다.", "success");
      close();
    } catch (err) {
      showToast(mapRpcError(err), "error");
      setBusy(sendBtn, false);
      sending = false;
    }
  }

  textarea.addEventListener("input", updateCounter);
  sendBtn.addEventListener("click", send);
  backdrop.querySelector(".modal-cancel").addEventListener("click", function () {
    if (!sending) close();
  });
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop && !sending) close();
  });
  document.addEventListener("keydown", onKeydown);

  textarea.focus();
}
