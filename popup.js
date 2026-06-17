import { getFavorites, getArrivals, getApiKey } from "./api.js";

const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");

function fmtArr(sec) {
  if (sec == null || sec === "") return null;
  const s = Number(sec);
  if (Number.isNaN(s)) return null;
  if (s < 60) return "곧 도착";
  return `${Math.floor(s / 60)}분 후`;
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

  // 같은 정류장은 한 번만 호출하도록 묶기
  const groups = {};
  for (const f of favs) {
    const k = `${f.cityCode}|${f.nodeId}`;
    (groups[k] ||= { cityCode: f.cityCode, nodeId: f.nodeId }).k = k;
  }

  const arrivalsByGroup = {};
  await Promise.all(
    Object.entries(groups).map(async ([k, g]) => {
      try {
        arrivalsByGroup[k] = await getArrivals(g.cityCode, g.nodeId);
      } catch (e) {
        arrivalsByGroup[k] = { error: e.message };
      }
    })
  );

  listEl.innerHTML = "";
  for (const f of favs) {
    const k = `${f.cityCode}|${f.nodeId}`;
    const arr = arrivalsByGroup[k];
    let info;

    if (arr && arr.error) {
      info = `<span class="err">${arr.error}</span>`;
    } else {
      const matches = (arr || [])
        .filter((a) => String(a.routeno).trim() === String(f.routeNo).trim())
        .sort((a, b) => Number(a.arrtime) - Number(b.arrtime));

      if (matches.length === 0) {
        info = `<span class="muted">운행 정보 없음</span>`;
      } else {
        info = matches
          .slice(0, 2)
          .map((m) => {
            const t = fmtArr(m.arrtime) || "-";
            const cnt =
              m.arrprevstationcnt != null && m.arrprevstationcnt !== ""
                ? ` <span class="muted">(${m.arrprevstationcnt}정거장 전)</span>`
                : "";
            return `<b>${t}</b>${cnt}`;
          })
          .join(" · ");
      }
    }

    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="row-main">
        <div class="bus">${f.routeNo}번</div>
        <div class="arr">${info}</div>
      </div>
      <div class="stop">${f.nodeNm}${
      f.nodeNo ? ` · ${f.nodeNo}` : ""
    } <span class="muted">(${f.cityName || f.cityCode})</span></div>`;
    listEl.appendChild(row);
  }

  statusEl.textContent = `업데이트: ${new Date().toLocaleTimeString("ko-KR")}`;
}

document.getElementById("refresh").onclick = render;
document.getElementById("settings").onclick = openOptions;

render();
setInterval(render, 30000);
