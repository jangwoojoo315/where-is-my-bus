import { getFavorites, getArrivals, getApiKey } from "./api.js";

const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");

function fmtMin(min) {
  if (min == null || min === "") return null;
  const m = Number(min);
  if (Number.isNaN(m)) return null;
  if (m <= 0) return "곧 도착";
  return `${m}분 후`;
}

function openOptions(e) {
  e?.preventDefault?.();
  chrome.runtime.openOptionsPage();
}

function showNotice(html) {
  listEl.innerHTML = "";
  statusEl.innerHTML = html;
  const link = document.getElementById("opt");
  if (link) link.onclick = openOptions;
}

async function render() {
  const key = await getApiKey();
  if (!key) {
    showNotice(`API 키가 필요합니다. <a id="opt">옵션 열기</a>`);
    return;
  }

  const favs = await getFavorites();
  if (favs.length === 0) {
    showNotice(`등록된 정류장이 없습니다. <a id="opt">정류장 추가</a>`);
    return;
  }

  statusEl.textContent = "불러오는 중...";

  // 같은 (제공자+정류장)은 한 번만 호출하도록 묶기
  const stationKey = (f) => `${f.provider || "gyeonggi"}:${f.stationId}`;
  const stations = {};
  for (const f of favs) stations[stationKey(f)] = f;
  const arrivalsByStation = {};
  await Promise.all(
    Object.entries(stations).map(async ([key, f]) => {
      try {
        arrivalsByStation[key] = await getArrivals(f.provider || "gyeonggi", f.stationId);
      } catch (e) {
        arrivalsByStation[key] = { error: e.message };
      }
    })
  );

  listEl.innerHTML = "";
  for (const f of favs) {
    const arr = arrivalsByStation[stationKey(f)];
    let info;

    if (arr && arr.error) {
      info = `<span class="err">${arr.error}</span>`;
    } else {
      const match = (arr || []).find(
        (a) => String(a.routeId) === String(f.routeId)
      );
      if (!match) {
        info = `<span class="muted">운행 정보 없음</span>`;
      } else {
        const parts = [];
        const t1 = fmtMin(match.predictTime1);
        if (t1) {
          const cnt =
            match.locationNo1 != null && match.locationNo1 !== ""
              ? ` <span class="muted">(${match.locationNo1}정거장 전)</span>`
              : "";
          parts.push(`<b>${t1}</b>${cnt}`);
        }
        const t2 = fmtMin(match.predictTime2);
        if (t2) parts.push(`<b>${t2}</b>`);
        info = parts.length ? parts.join(" · ") : `<span class="muted">도착 정보 없음</span>`;
      }
    }

    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="row-main">
        <div class="bus">${f.routeName}번</div>
        <div class="arr">${info}</div>
      </div>
      <div class="stop">${f.stationName}${
      f.mobileNo ? ` · ${f.mobileNo}` : ""
    } <span class="muted">(${f.regionName || "경기"})</span></div>`;
    listEl.appendChild(row);
  }

  statusEl.textContent = `업데이트: ${new Date().toLocaleTimeString("ko-KR")}`;
}

document.getElementById("refresh").onclick = render;
document.getElementById("settings").onclick = openOptions;

render();
setInterval(render, 30000);
