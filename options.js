import {
  getFavorites,
  setFavorites,
  searchStations,
  getStationRoutes,
} from "./api.js";

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
      b.innerHTML = `<span class="badge">${s.regionName || ""}</span> ${
        s.stationName
      } <span class="muted">${s.mobileNo ? `· ${s.mobileNo}` : ""}</span>`;
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
      b.innerHTML = `${r.routeName}번 <span class="muted">${
        r.routeTypeName || ""
      }</span>`;
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
    row.innerHTML = `<div><b>${f.routeName}번</b> · ${f.stationName}${
      f.mobileNo ? ` (${f.mobileNo})` : ""
    } <span class="muted">${f.regionName || "경기"}</span></div>`;
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
