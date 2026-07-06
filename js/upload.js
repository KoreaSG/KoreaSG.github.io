// 이미지 업로드 파이프라인 (전역)
// 의존: db.js (sb, STORAGE_BUCKET)

/**
 * (내부) 이미지 압축: 긴 변 최대 1280px 리사이즈 후 WebP(0.8) 인코딩.
 * WebP 미지원 브라우저는 JPEG(0.85)로 폴백.
 * @returns {Promise<{blob: Blob, contentType: string}>}
 */
function compressImage(file) {
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();

    img.onload = function () {
      URL.revokeObjectURL(url);
      try {
        var MAX = 1280;
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        if (w > MAX || h > MAX) {
          var scale = MAX / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }

        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);

        canvas.toBlob(function (webpBlob) {
          if (webpBlob && webpBlob.type === "image/webp") {
            resolve({ blob: webpBlob, contentType: "image/webp" });
            return;
          }
          // WebP 미지원 → JPEG 폴백
          canvas.toBlob(function (jpegBlob) {
            if (jpegBlob) {
              resolve({ blob: jpegBlob, contentType: "image/jpeg" });
            } else {
              reject(new Error("이미지 인코딩에 실패했습니다."));
            }
          }, "image/jpeg", 0.85);
        }, "image/webp", 0.8);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 불러올 수 없습니다."));
    };

    img.src = url;
  });
}

/**
 * 이미지 여러 장 압축 후 Storage 업로드.
 * 경로: items/${uuid}/${index}.webp (bucket: item-images)
 * @param {FileList|File[]} fileList 최대 8장
 * @param {function=} onProgress (done, total) 콜백
 * @returns {Promise<string[]>} 업로드된 storage 경로 배열
 * @throws 실패 시 이미 업로드된 파일을 정리한 뒤 에러를 던짐
 */
async function uploadImages(fileList, onProgress) {
  var files = Array.prototype.slice.call(fileList || []);
  if (files.length === 0) return [];
  if (files.length > 8) {
    throw new Error("이미지는 최대 8장까지 업로드할 수 있습니다.");
  }
  if (!sb) {
    throw new Error("서비스가 아직 설정되지 않았습니다.");
  }

  var groupId = crypto.randomUUID();
  var uploaded = [];

  try {
    for (var i = 0; i < files.length; i++) {
      var result = await compressImage(files[i]);
      var path = "items/" + groupId + "/" + i + ".webp";

      var res = await sb.storage
        .from(STORAGE_BUCKET)
        .upload(path, result.blob, { contentType: result.contentType });

      if (res.error) throw res.error;

      uploaded.push(path);
      if (typeof onProgress === "function") onProgress(uploaded.length, files.length);
    }
    return uploaded;
  } catch (err) {
    await removeImages(uploaded);
    throw err;
  }
}

/**
 * Storage 이미지 삭제 (best-effort, 실패해도 무시)
 */
async function removeImages(paths) {
  if (!sb || !paths || paths.length === 0) return;
  try {
    await sb.storage.from(STORAGE_BUCKET).remove(paths);
  } catch (err) {
    // best-effort: 정리 실패는 무시
  }
}

/**
 * Storage 경로 → 공개 URL. 경로가 없으면 플레이스홀더 이미지.
 */
function publicUrl(path) {
  if (!path) return "assets/no-image.svg";
  if (!sb) return "assets/no-image.svg";
  return sb.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
