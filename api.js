// 공공데이터포털(국토교통부 TAGO) 전국 버스정보 API 연동 모듈
// 서울·경기를 포함한 전국 정류장 검색 / 도착정보 조회를 단일 키로 처리합니다.

const BASE = "https://apis.data.go.kr/1613000";

// ---- 저장소 헬퍼 ---------------------------------------------------------

export async function getApiKey() {
  // 1) git에 올리지 않는 config.js 에 키가 있으면 그것을 사용
  try {
    const { API_KEY } = await import("./config.js");
    if (API_KEY) return API_KEY;
  } catch {
    // config.js 가 없으면 무시하고 저장소 값으로 진행
  }
  // 2) 없으면 옵션 화면에서 입력한 저장소 값 사용
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  return apiKey || "";
}

export async function setApiKey(apiKey) {
  await chrome.storage.sync.set({ apiKey });
}

export async function getFavorites() {
  const { favorites } = await chrome.storage.sync.get("favorites");
  return favorites || [];
}

export async function setFavorites(favorites) {
  await chrome.storage.sync.set({ favorites });
}

// ---- API 호출 ------------------------------------------------------------

// 공공데이터 응답은 결과 1건이면 객체, 여러 건이면 배열, 0건이면 ""로 옵니다.
function toArray(items) {
  if (!items || items === "") return [];
  const item = items.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

async function call(path, params) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("API 키가 설정되지 않았습니다. 옵션에서 키를 입력하세요.");
  }

  const usp = new URLSearchParams({
    serviceKey: apiKey, // 디코딩된 키 입력 시 URLSearchParams가 인코딩 처리
    _type: "json",
    numOfRows: "1000",
    pageNo: "1",
    ...params,
  });

  const res = await fetch(`${BASE}/${path}?${usp.toString()}`);
  if (!res.ok) throw new Error(`요청 실패 (HTTP ${res.status})`);

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // 키 오류 등은 XML로 내려오는 경우가 많음
    const m =
      text.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/) ||
      text.match(/<errMsg>(.*?)<\/errMsg>/);
    throw new Error(
      m
        ? `API 오류: ${m[1]}`
        : "응답을 해석할 수 없습니다. API 키와 활용신청 상태를 확인하세요.",
    );
  }

  const header = data?.response?.header;
  if (header && header.resultCode && header.resultCode !== "00") {
    throw new Error(`API 오류: ${header.resultMsg || header.resultCode}`);
  }

  return toArray(data?.response?.body?.items);
}

// 도시 코드 목록: { citycode, cityname }
export function getCityCodes() {
  return call("BusSttnInfoInqireService/getCtyCodeList", {});
}

// 정류장 이름으로 검색: { nodeid, nodenm, nodeno, gpslati, gpslong }
export function searchStops(cityCode, nodeNm) {
  return call("BusSttnInfoInqireService/getSttnNoList", { cityCode, nodeNm });
}

// 특정 정류장의 도착정보: { routeno, arrtime(초), arrprevstationcnt, nodenm, ... }
export function getArrivals(cityCode, nodeId) {
  return call("ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList", {
    cityCode,
    nodeId,
  });
}
