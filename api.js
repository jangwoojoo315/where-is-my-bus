// 경기도 버스정보(GBIS) API 연동 모듈 — 공공데이터포털 제공기관 6410000
// 정류소 검색 / 정류소 경유노선 / 버스 도착정보를 단일 키로 처리합니다.

const BASE = "https://apis.data.go.kr/6410000";

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

// 결과가 1건이면 객체로 올 수 있어 배열로 정규화
function toArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

async function call(path, params) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("API 키가 설정되지 않았습니다. config.js 또는 옵션에서 키를 입력하세요.");
  }

  const usp = new URLSearchParams({
    serviceKey: apiKey, // 디코딩 키 입력 시 URLSearchParams가 인코딩 처리
    format: "json",
    ...params,
  });

  const res = await fetch(`${BASE}/${path}?${usp.toString()}`);
  if (res.status === 401) {
    throw new Error("키가 거부됨(401). 키가 정확한지 확인하세요.");
  }
  if (res.status === 403) {
    throw new Error("접근 거부(403). 경기도 버스 API 활용신청/승인 상태를 확인하세요.");
  }
  if (!res.ok) {
    throw new Error(`요청 실패 (HTTP ${res.status})`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const m =
      text.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/) ||
      text.match(/<resultMessage>(.*?)<\/resultMessage>/) ||
      text.match(/<errMsg>(.*?)<\/errMsg>/);
    throw new Error(
      m ? `API 오류: ${m[1]}` : "응답을 해석할 수 없습니다. 키와 활용신청 상태를 확인하세요."
    );
  }

  const header = data?.response?.msgHeader;
  const body = data?.response?.msgBody;
  const code = header?.resultCode;
  // GBIS resultCode: 0 = 정상, 4 = 결과 없음(빈 목록). 그 외는 오류로 처리.
  if (code != null && Number(code) !== 0 && Number(code) !== 4) {
    throw new Error(`API 오류: ${header?.resultMessage || code}`);
  }

  return body || {};
}

// 정류소 이름 검색
// 반환: { stationId, stationName, mobileNo(정류소번호), regionName, x, y }
export async function searchStations(keyword) {
  const body = await call("busstationservice/v2/getBusStationListv2", { keyword });
  return toArray(body.busStationList);
}

// 특정 정류소를 경유하는 노선 목록
// 반환: { routeId, routeName(노선번호), routeTypeName, regionName, ... }
export async function getStationRoutes(stationId) {
  const body = await call("busstationservice/v2/getBusStationViaRouteListv2", {
    stationId,
  });
  return toArray(body.busRouteList);
}

// 특정 정류소의 버스 도착정보
// 반환: { routeId, predictTime1(분), locationNo1(남은 정류장 수), flag, ... }
export async function getArrivals(stationId) {
  const body = await call("busarrivalservice/v2/getBusArrivalListv2", {
    stationId,
  });
  return toArray(body.busArrivalList);
}
