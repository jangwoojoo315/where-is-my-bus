// 버스정보 API 연동 모듈 — 경기(GBIS) + 서울(TOPIS) 두 제공자를 함께 다룹니다.
// 정류소 검색 / 정류소 경유노선 / 버스 도착정보를 공통 형태로 정규화해 반환합니다.
// 두 제공자 모두 공공데이터포털(data.go.kr)에서 발급한 동일한 인증키를 사용합니다.

const GBIS_BASE = "https://apis.data.go.kr/6410000"; // 경기도 버스정보(GBIS), 제공기관 6410000
const SEOUL_BASE = "http://ws.bus.go.kr/api/rest"; // 서울 TOPIS (https 미지원, http 전용)

// ---- 저장소 헬퍼 ---------------------------------------------------------

export async function getApiKey() {
  // 1) git에 올리지 않는 config.js 에 키가 있으면 그것을 사용
  try {
    const { API_KEY } = await import("./config.js");
    if (API_KEY) return API_KEY;
  } catch {
    // config.js 가 없으면 무시하고 저장소 값으로 진행
  }
  // 2) 없으면 저장소 값 사용
  const { apiKey } = await chrome.storage.sync.get("apiKey");
  return apiKey || "";
}

export async function getFavorites() {
  const { favorites } = await chrome.storage.sync.get("favorites");
  return favorites || [];
}

export async function setFavorites(favorites) {
  await chrome.storage.sync.set({ favorites });
}

// ---- 공통 유틸 -----------------------------------------------------------

// 결과가 1건이면 객체로 올 수 있어 배열로 정규화
function toArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

async function requireKey() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("API 키가 설정되지 않았습니다. config.js 에서 키를 입력하세요.");
  }
  return apiKey;
}

// ---- 경기(GBIS) 호출 -----------------------------------------------------

async function callGbis(path, params) {
  const apiKey = await requireKey();
  const usp = new URLSearchParams({
    serviceKey: apiKey, // 디코딩 키 입력 시 URLSearchParams가 인코딩 처리
    format: "json",
    ...params,
  });

  const res = await fetch(`${GBIS_BASE}/${path}?${usp.toString()}`);
  if (res.status === 401) throw new Error("키가 거부됨(401). 키가 정확한지 확인하세요.");
  if (res.status === 403)
    throw new Error("접근 거부(403). 경기도 버스 API 활용신청/승인 상태를 확인하세요.");
  if (!res.ok) throw new Error(`요청 실패 (HTTP ${res.status})`);

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

// ---- 서울(TOPIS) 호출 ----------------------------------------------------

async function callSeoul(path, params) {
  const apiKey = await requireKey();
  const usp = new URLSearchParams({
    serviceKey: apiKey,
    resultType: "json",
    ...params,
  });

  const res = await fetch(`${SEOUL_BASE}/${path}?${usp.toString()}`);
  if (!res.ok) throw new Error(`요청 실패 (HTTP ${res.status})`);

  const data = await res.json();
  const header = data?.msgHeader;
  const code = header?.headerCd;
  // TOPIS headerCd: 0 = 정상, 4 = 결과 없음. 그 외(7=키오류 등)는 오류로 처리.
  if (code != null && String(code) !== "0" && String(code) !== "4") {
    throw new Error(`API 오류: ${header?.headerMsg || code}`);
  }

  return toArray(data?.msgBody?.itemList);
}

// 서울 도착 메시지 파싱: "3분5초후[2번째 전]" / "곧 도착" / "운행종료" 등
// 반환: { min, stops } 또는 운행정보 없으면 null
function parseSeoulMsg(msg) {
  if (!msg) return null;
  const s = String(msg);
  if (s.includes("곧 도착") || s.includes("곧도착")) return { min: 0, stops: null };
  if (s.includes("운행종료") || s.includes("출발대기") || s.includes("운행정보 없음")) return null;
  const mMin = s.match(/(\d+)\s*분/);
  if (!mMin) return null;
  const mStop = s.match(/\[(\d+)\s*번째/);
  return { min: Number(mMin[1]), stops: mStop ? Number(mStop[1]) : null };
}

// ---- 공개 API (제공자 구분) ----------------------------------------------
// 공통 형태:
//   정류소: { provider, stationId, stationName, mobileNo, regionName }
//   노선  : { routeId, routeName, routeTypeName }
//   도착  : { routeId, predictTime1(분), locationNo1(남은 정거장), predictTime2(분) }

async function searchGyeonggi(keyword) {
  const body = await callGbis("busstationservice/v2/getBusStationListv2", { keyword });
  return toArray(body.busStationList).map((s) => ({
    provider: "gyeonggi",
    stationId: String(s.stationId),
    stationName: s.stationName,
    mobileNo: (s.mobileNo || "").toString().trim(),
    regionName: s.regionName || "경기",
  }));
}

async function searchSeoul(keyword) {
  const items = await callSeoul("stationinfo/getStationByName", { stSrch: keyword });
  return items
    .filter((s) => s.arsId && String(s.arsId) !== "0") // 가상정류소(arsId 0) 제외
    .map((s) => ({
      provider: "seoul",
      stationId: String(s.arsId), // 서울은 arsId(정류소 고유번호)를 키로 사용
      stationName: s.stNm,
      mobileNo: String(s.arsId),
      regionName: "서울",
    }));
}

// 정류소 이름 검색 — 경기/서울 동시 검색 후 합쳐서 반환
export async function searchStations(keyword) {
  const [gg, seoul] = await Promise.allSettled([
    searchGyeonggi(keyword),
    searchSeoul(keyword),
  ]);

  const out = [];
  if (gg.status === "fulfilled") out.push(...gg.value);
  if (seoul.status === "fulfilled") out.push(...seoul.value);

  // 둘 다 실패한 경우에만 오류를 노출 (한쪽만 실패하면 나머지 결과로 진행)
  if (gg.status === "rejected" && seoul.status === "rejected") {
    throw new Error(gg.reason?.message || seoul.reason?.message || "검색 실패");
  }
  return out;
}

// 특정 정류소를 경유하는 노선 목록
export async function getStationRoutes(provider, stationId) {
  if (provider === "seoul") {
    const items = await callSeoul("stationinfo/getStationByUid", { arsId: stationId });
    const seen = new Set();
    const routes = [];
    for (const it of items) {
      const id = String(it.busRouteId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      routes.push({
        routeId: id,
        routeName: it.rtNm,
        routeTypeName: it.adirection ? `${it.adirection} 방면` : "",
      });
    }
    return routes;
  }

  const body = await callGbis("busstationservice/v2/getBusStationViaRouteListv2", {
    stationId,
  });
  return toArray(body.busRouteList).map((r) => ({
    routeId: String(r.routeId),
    routeName: r.routeName,
    routeTypeName: r.routeTypeName || "",
  }));
}

// 특정 정류소의 버스 도착정보
export async function getArrivals(provider, stationId) {
  if (provider === "seoul") {
    const items = await callSeoul("stationinfo/getStationByUid", { arsId: stationId });
    return items.map((it) => {
      const a1 = parseSeoulMsg(it.arrmsg1);
      const a2 = parseSeoulMsg(it.arrmsg2);
      return {
        routeId: String(it.busRouteId),
        predictTime1: a1 ? a1.min : null,
        locationNo1: a1 ? a1.stops : null,
        predictTime2: a2 ? a2.min : null,
      };
    });
  }

  const body = await callGbis("busarrivalservice/v2/getBusArrivalListv2", { stationId });
  return toArray(body.busArrivalList).map((a) => ({
    routeId: String(a.routeId),
    predictTime1: a.predictTime1,
    locationNo1: a.locationNo1,
    predictTime2: a.predictTime2,
  }));
}
