// 버스정보 API 연동 모듈
// 인증키는 클라이언트에 두지 않고, 키를 보관·캐싱하는 프록시(Cloudflare Worker)를 호출한다.
// 프록시 배포 후 아래 PROXY_BASE 를 본인 Worker 주소로 바꾸세요. (proxy/ 폴더 참고)

const PROXY_BASE = "https://where-is-my-bus-proxy.sunjang315.workers.dev";

// ---- 저장소 헬퍼 ---------------------------------------------------------

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

async function fetchProxy(group, path, params) {
  const usp = new URLSearchParams(params);
  const res = await fetch(`${PROXY_BASE}/${group}/${path}?${usp}`);
  const text = await res.text();
  return { res, text };
}

// ---- 경기(GBIS) 호출 -----------------------------------------------------

async function callGbis(path, params) {
  const { res, text } = await fetchProxy("gbis", path, params);
  if (res.status === 401) throw new Error("키가 거부됨(401). 서버 키 설정을 확인하세요.");
  if (res.status === 403)
    throw new Error("접근 거부(403). 경기 버스 API 활용신청/승인 상태를 확인하세요.");

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const m =
      text.match(/<returnAuthMsg>(.*?)<\/returnAuthMsg>/) ||
      text.match(/<resultMessage>(.*?)<\/resultMessage>/) ||
      text.match(/<errMsg>(.*?)<\/errMsg>/);
    throw new Error(m ? `API 오류: ${m[1]}` : "응답을 해석할 수 없습니다.");
  }
  if (data?.error) throw new Error(data.error); // 프록시 자체 오류
  if (!res.ok) throw new Error(`요청 실패 (HTTP ${res.status})`);

  const header = data?.response?.msgHeader;
  const body = data?.response?.msgBody;
  const code = header?.resultCode;
  // GBIS resultCode: 0 = 정상, 4 = 결과 없음. 그 외는 오류.
  if (code != null && Number(code) !== 0 && Number(code) !== 4) {
    throw new Error(`API 오류: ${header?.resultMessage || code}`);
  }
  return body || {};
}

// ---- 서울(TOPIS) 호출 ----------------------------------------------------

async function callSeoul(path, params) {
  const { res, text } = await fetchProxy("seoul", path, params);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("응답을 해석할 수 없습니다.");
  }
  if (data?.error) throw new Error(data.error); // 프록시 자체 오류
  if (!res.ok) throw new Error(`요청 실패 (HTTP ${res.status})`);

  const header = data?.msgHeader;
  const code = header?.headerCd;
  // TOPIS headerCd: 0 = 정상, 4 = 결과 없음. 그 외(7=키오류 등)는 오류.
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
  const body = await callGbis("stations", { keyword });
  return toArray(body.busStationList).map((s) => ({
    provider: "gyeonggi",
    stationId: String(s.stationId),
    stationName: s.stationName,
    mobileNo: (s.mobileNo || "").toString().trim(),
    regionName: s.regionName || "경기",
  }));
}

async function searchSeoul(keyword) {
  const items = await callSeoul("stations", { keyword });
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

  // 둘 다 실패한 경우에만 오류를 노출
  if (gg.status === "rejected" && seoul.status === "rejected") {
    throw new Error(gg.reason?.message || seoul.reason?.message || "검색 실패");
  }
  return out;
}

// 특정 정류소를 경유하는 노선 목록
export async function getStationRoutes(provider, stationId) {
  if (provider === "seoul") {
    const items = await callSeoul("station", { arsId: stationId });
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

  const body = await callGbis("routes", { stationId });
  return toArray(body.busRouteList).map((r) => ({
    routeId: String(r.routeId),
    routeName: r.routeName,
    routeTypeName: r.routeTypeName || "",
  }));
}

// 특정 정류소의 버스 도착정보
export async function getArrivals(provider, stationId) {
  if (provider === "seoul") {
    const items = await callSeoul("station", { arsId: stationId });
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

  const body = await callGbis("arrivals", { stationId });
  return toArray(body.busArrivalList).map((a) => ({
    routeId: String(a.routeId),
    predictTime1: a.predictTime1,
    locationNo1: a.locationNo1,
    predictTime2: a.predictTime2,
  }));
}
