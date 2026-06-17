import {
  getApiKey,
  setApiKey,
  getFavorites,
  setFavorites,
  getCityCodes,
  searchStops,
} from "./api.js";

// ---- API 키 -------------------------------------------------------------

const keyInput = document.getElementById("apiKey");
const keyStatus = document.getElementById("keyStatus");

getApiKey().then((k) => {
  keyInput.value = k;
  if (k) initCities();
});

document.getElementById("saveKey").onclick = async () => {
  await setApiKey(keyInput.value.trim());
  keyStatus.textContent = "저장되었습니다.";
  setTimeout(() => (keyStatus.textContent = ""), 2000);
  initCities();
};

// ---- 도시 목록 ----------------------------------------------------------

const citySel = document.getElementById("city");

async function initCities() {
  if (citySel.dataset.loaded) return;
  citySel.innerHTML = `<option>불러오는 중...</option>`;
  try {
    let { cityCodes } = await chrome.storage.local.get("cityCodes");
    if (!cityCodes || !cityCodes.length) {
      cityCodes = await getCityCodes();
      await chrome.storage.local.set({ cityCodes });
    }
    cityCodes.sort((a, b) =>
      String(a.cityname).localeCompare(String(b.cityname), "ko")
    );
    citySel.innerHTML = cityCodes
      .map((c) => `<option value="${c.citycode}">${c.cityname}</option>`)
      .join("");
    citySel.dataset.loaded = "1";
  } catch (e) {
    citySel.innerHTML = `<option>불러오기 실패</option>`;
    document.getElementById("searchStatus").textContent = e.message;
  }
}

// ---- 정류장 검색 --------------------------------------------------------

const stopResults = document.getElementById("stopResults");
const addArea = document.getElementById("addArea");
const busInput = document.getElementById("busNo");
const selectedLabel = document.getElementById("selectedStop");
const searchStatus = document.getElementById("searchStatus");

let selectedStop = null;

document.getElementById("searchStop").onclick = doSearch;
document.getElementById("stopName").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});

async function doSearch() {
  const name = document.getElementById("stopName").value.trim();
  const cityCode = citySel.value;
  const cityName = citySel.options[citySel.selectedIndex]?.text || "";

  if (!cityCode || citySelInvalid()) {
    searchStatus.textContent = "먼저 API 키를 저장하고 도시를 선택하세요.";
    return;
  }
  if (!name) {
    searchStatus.textContent = "정류장 이름을 입력하세요.";
    return;
  }

  searchStatus.textContent = "검색 중...";
  stopResults.innerHTML = "";
  selectedStop = null;
  addArea.hidden = true;

  try {
    const stops = await searchStops(cityCode, name);
    if (!stops.length) {
      searchStatus.textContent = "검색 결과가 없습니다.";
      return;
    }
    searchStatus.textContent = `${stops.length}개 결과`;
    for (const s of stops) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "stop-item";
      b.innerHTML = `${s.nodenm} <span class="muted">${
        s.nodeno ? `· ${s.nodeno}` : ""
      }</span>`;
      b.onclick = () =>
        selectStop(
          {
            cityCode,
            cityName,
            nodeId: s.nodeid,
            nodeNm: s.nodenm,
            nodeNo: s.nodeno,
          },
          b
        );
      stopResults.appendChild(b);
    }
  } catch (e) {
    searchStatus.textContent = e.message;
  }
}

function citySelInvalid() {
  return !citySel.dataset.loaded;
}

function selectStop(stop, btn) {
  selectedStop = stop;
  [...stopResults.children].forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  selectedLabel.textContent = `${stop.nodeNm}${
    stop.nodeNo ? ` (${stop.nodeNo})` : ""
  }`;
  addArea.hidden = false;
  busInput.value = "";
  busInput.focus();
}

// ---- 즐겨찾기 추가 / 목록 -----------------------------------------------

document.getElementById("addFav").onclick = addFav;
busInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addFav();
});

async function addFav() {
  if (!selectedStop) return;
  const routeNo = busInput.value.trim();
  if (!routeNo) {
    searchStatus.textContent = "버스 번호를 입력하세요.";
    return;
  }

  const favs = await getFavorites();
  const fav = { id: Date.now().toString(36), routeNo, ...selectedStop };

  if (
    favs.some(
      (f) =>
        f.nodeId === fav.nodeId &&
        f.cityCode === fav.cityCode &&
        String(f.routeNo) === routeNo
    )
  ) {
    searchStatus.textContent = "이미 등록된 항목입니다.";
    return;
  }

  favs.push(fav);
  await setFavorites(favs);
  renderFavs();
  addArea.hidden = true;
  busInput.value = "";
  searchStatus.textContent = "추가되었습니다.";
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
    row.innerHTML = `<div><b>${f.routeNo}번</b> · ${f.nodeNm}${
      f.nodeNo ? ` (${f.nodeNo})` : ""
    } <span class="muted">${f.cityName || f.cityCode}</span></div>`;
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
