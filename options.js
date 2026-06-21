import {
  getFavorites,
  setFavorites,
  searchStations,
  getStationRoutes,
} from "./api.js";

// 외부(공공 API) 문자열을 innerHTML 에 넣기 전에 HTML 이스케이프
function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---- 정류장 검색 --------------------------------------------------------

const stopResults = document.getElementById("stopResults");
const routeArea = document.getElementById("routeArea");
const routeResults = document.getElementById("routeResults");
const selectedLabel = document.getElementById("selectedStop");
const searchStatus = document.getElementById("searchStatus");
const routeStatus = document.getElementById("routeStatus");

document.getElementById("searchStop").onclick = doSearch;
document.getElementById("stopName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});

async function doSearch() {
  const keyword = document.getElementById("stopName").value.trim();
  if (!keyword) {
    searchStatus.textContent = "정류장 이름을 입력하세요.";
    return;
  }

  searchStatus.textContent = "검색 중...";
  stopResults.innerHTML = "";
  routeArea.hidden = true;

  try {
    const stations = await searchStations(keyword);
    if (!stations.length) {
      searchStatus.textContent = "검색 결과가 없습니다.";
      return;
    }
    searchStatus.textContent = `${stations.length}개 결과`;
    for (const s of stations) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "stop-item";
      b.innerHTML = `<span class="badge">${esc(s.regionName || "")}</span> ${esc(
        s.stationName
      )} <span class="muted">${s.mobileNo ? `· ${esc(s.mobileNo)}` : ""}</span>`;
      b.onclick = () =>
        selectStop(
          {
            provider: s.provider,
            stationId: s.stationId,
            stationName: s.stationName,
            mobileNo: s.mobileNo || "",
            regionName: s.regionName,
          },
          b
        );
      stopResults.appendChild(b);
    }
  } catch (e) {
    searchStatus.textContent = e.message;
  }
}

async function selectStop(stop, btn) {
  [...stopResults.children].forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  selectedLabel.textContent = `${stop.stationName}${
    stop.mobileNo ? ` (${stop.mobileNo})` : ""
  }`;
  routeArea.hidden = false;
  routeResults.innerHTML = "";
  routeStatus.textContent = "노선 불러오는 중...";

  try {
    const routes = await getStationRoutes(stop.provider, stop.stationId);
    if (!routes.length) {
      routeStatus.textContent = "이 정류장의 노선 정보를 찾을 수 없습니다.";
      return;
    }
    routeStatus.textContent = "";
    for (const r of routes) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "stop-item";
      b.innerHTML = `${esc(r.routeName)}번 <span class="muted">${esc(
        r.routeTypeName || ""
      )}</span>`;
      b.onclick = () =>
        addFav({
          ...stop,
          routeId: r.routeId,
          routeName: r.routeName,
        });
      routeResults.appendChild(b);
    }
  } catch (e) {
    routeStatus.textContent = e.message;
  }
}

// ---- 즐겨찾기 추가 / 목록 -----------------------------------------------

async function addFav(stop) {
  const favs = await getFavorites();
  if (
    favs.some(
      (f) =>
        (f.provider || "gyeonggi") === stop.provider &&
        f.stationId === stop.stationId &&
        String(f.routeId) === String(stop.routeId)
    )
  ) {
    routeStatus.textContent = "이미 등록된 항목입니다.";
    return;
  }
  favs.push({ id: Date.now().toString(36), ...stop });
  await setFavorites(favs);
  renderFavs();
  routeArea.hidden = true;
  searchStatus.textContent = `추가됨: ${stop.routeName}번 · ${stop.stationName}`;
}

const favList = document.getElementById("favList");

async function renderFavs() {
  const favs = await getFavorites();
  if (!favs.length) {
    favList.innerHTML = `<p class="muted">등록된 항목이 없습니다.</p>`;
    return;
  }
  favList.innerHTML = "";
  for (const f of favs) {
    const row = document.createElement("div");
    row.className = "fav-row";
    row.innerHTML = `<div><b>${esc(f.routeName)}번</b> · ${esc(f.stationName)}${
      f.mobileNo ? ` (${esc(f.mobileNo)})` : ""
    } <span class="muted">${esc(f.regionName || "경기")}</span></div>`;
    const del = document.createElement("button");
    del.textContent = "삭제";
    del.className = "del";
    del.onclick = async () => {
      const cur = await getFavorites();
      await setFavorites(cur.filter((x) => x.id !== f.id));
      renderFavs();
    };
    row.appendChild(del);
    favList.appendChild(row);
  }
}

renderFavs();

// ---- 자동 알림 시간 -----------------------------------------------------

const alertEnabled = document.getElementById("alertEnabled");
const alertTime = document.getElementById("alertTime");
const alertStatus = document.getElementById("alertStatus");
const osHint = document.getElementById("osHint");

function selectedMode() {
  const r = document.querySelector('input[name="alertMode"]:checked');
  return r ? r.value : "inbrowser";
}

function syncOsHint() {
  osHint.hidden = selectedMode() !== "os";
}

chrome.storage.sync.get(["alertEnabled", "alertTime", "alertMode"]).then((s) => {
  alertEnabled.checked = !!s.alertEnabled;
  alertTime.value = s.alertTime || "17:00";
  const mode = s.alertMode || "inbrowser"; // 기본값: 브라우저 안에서
  const radio = document.querySelector(`input[name="alertMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  syncOsHint();
});

document.querySelectorAll('input[name="alertMode"]').forEach((r) => {
  r.addEventListener("change", syncOsHint);
});

document.getElementById("saveAlert").onclick = async () => {
  if (alertEnabled.checked && !alertTime.value) {
    alertStatus.textContent = "알림 시각을 입력하세요.";
    return;
  }
  // background.js 가 storage 변경을 감지해 알람을 다시 예약한다.
  await chrome.storage.sync.set({
    alertEnabled: alertEnabled.checked,
    alertTime: alertTime.value,
    alertMode: selectedMode(),
  });
  alertStatus.textContent = alertEnabled.checked
    ? `저장됨 — 매일 ${alertTime.value}에 알림`
    : "알림을 껐습니다.";
  setTimeout(() => (alertStatus.textContent = ""), 2500);
};

// 현재 선택한 방식 그대로 즉시 한 번 실행해 본다.
document.getElementById("testAlert").onclick = async () => {
  if (selectedMode() === "os") {
    alertStatus.textContent = "OS 알림 테스트 중...";
    chrome.notifications.create(`bus-test-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "슬슬나가 — 테스트",
      message: "이 알림이 보이면 OS 알림은 정상입니다.",
      priority: 2,
    }, () => {
      alertStatus.textContent = chrome.runtime.lastError
        ? `알림 차단됨: ${chrome.runtime.lastError.message} — 시스템 알림 설정 확인`
        : "OS 알림 표시됨. 안 보이면 시스템 알림 설정/집중모드를 확인하세요.";
      setTimeout(() => (alertStatus.textContent = ""), 5000);
    });
  } else {
    await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
    await chrome.action.setBadgeText({ text: "!" });
    try {
      await chrome.action.openPopup(); // 진짜 확장 팝업
      alertStatus.textContent = "확장 팝업을 열고 아이콘에 배지를 표시했습니다.";
    } catch {
      await chrome.windows.create({
        url: chrome.runtime.getURL("popup.html"),
        type: "popup",
        width: 380,
        height: 520,
        focused: true,
      });
      alertStatus.textContent = "팝업 창을 열었습니다(포커스 없어 작은 창으로 대체).";
    }
    setTimeout(() => (alertStatus.textContent = ""), 4000);
  }
};
