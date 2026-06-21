// 슬슬나가 프록시 (Cloudflare Worker)
// - data.go.kr 인증키를 서버에 숨기고(환경변수 DATA_GO_KR_KEY)
// - 응답을 짧게 캐싱해 상류(data.go.kr/ws.bus.go.kr) 호출 수를 줄여 일일 한도를 보호한다.
// 확장(extension)은 이 Worker의 화이트리스트 엔드포인트만 호출한다.

const GBIS = "https://apis.data.go.kr/6410000"; // 경기 GBIS
const SEOUL = "http://ws.bus.go.kr/api/rest"; // 서울 TOPIS (http 전용)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// 엔드포인트별 캐시 TTL(초). 도착정보는 자주 바뀌므로 짧게, 정류장/노선은 거의 고정이라 길게.
const TTL = {
  "/gbis/stations": 86400,
  "/gbis/routes": 86400,
  "/gbis/arrivals": 15,
  "/seoul/stations": 86400,
  "/seoul/station": 15, // 노선+도착정보 동시 제공 → 도착 기준으로 짧게
};

// 같은 Worker 아이솔레이트 내 메모리 캐시 (workers.dev 에서도 동작).
const memCache = new Map();
function getCache(key) {
  const e = memCache.get(key);
  if (e && e.exp > Date.now()) return e;
  if (e) memCache.delete(key);
  return null;
}
function setCache(key, value, ttl) {
  if (memCache.size > 1000) memCache.clear(); // 단순 상한
  memCache.set(key, { ...value, exp: Date.now() + ttl * 1000 });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function isId(v) {
  return /^\d+$/.test(v || "");
}

// IP별 레이트리밋 (메모리 기반, 1분 고정 윈도우).
// 정상 사용자는 분당 한 자릿수라 안 걸리고, 한 IP의 한도 소진 공격을 억제한다.
const RATE_LIMIT = 60; // IP당 분당 허용 요청 수
const RATE_WINDOW = 60 * 1000;
const rateMap = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const e = rateMap.get(ip);
  if (!e || now - e.start >= RATE_WINDOW) {
    if (rateMap.size > 5000) rateMap.clear(); // 단순 상한
    rateMap.set(ip, { start: now, count: 1 });
    return false;
  }
  e.count += 1;
  return e.count > RATE_LIMIT;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) {
      return json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }, 429);
    }

    const key = env.DATA_GO_KR_KEY;
    if (!key) return json({ error: "서버에 API 키(DATA_GO_KR_KEY)가 설정되지 않았습니다." }, 500);

    const url = new URL(request.url);
    const path = url.pathname;
    const q = url.searchParams;
    const ttl = TTL[path];
    if (!ttl) return json({ error: "알 수 없는 경로입니다." }, 404);

    // 상류 URL 구성 (+ 파라미터 검증)
    let upstream;
    try {
      const keyword = q.get("keyword");
      const stationId = q.get("stationId");
      const arsId = q.get("arsId");

      if (path === "/gbis/stations") {
        if (!keyword) throw new Error("keyword 누락");
        upstream = gbisUrl(key, "busstationservice/v2/getBusStationListv2", { keyword });
      } else if (path === "/gbis/routes") {
        if (!isId(stationId)) throw new Error("stationId 오류");
        upstream = gbisUrl(key, "busstationservice/v2/getBusStationViaRouteListv2", { stationId });
      } else if (path === "/gbis/arrivals") {
        if (!isId(stationId)) throw new Error("stationId 오류");
        upstream = gbisUrl(key, "busarrivalservice/v2/getBusArrivalListv2", { stationId });
      } else if (path === "/seoul/stations") {
        if (!keyword) throw new Error("keyword 누락");
        upstream = seoulUrl(key, "stationinfo/getStationByName", { stSrch: keyword });
      } else if (path === "/seoul/station") {
        if (!isId(arsId)) throw new Error("arsId 오류");
        upstream = seoulUrl(key, "stationinfo/getStationByUid", { arsId });
      }
    } catch (e) {
      return json({ error: e.message }, 400);
    }

    // 캐시 키는 키를 제외한 클라이언트 경로+쿼리
    const cacheKey = path + "?" + q.toString();
    const hit = getCache(cacheKey);
    if (hit) {
      return new Response(hit.body, {
        status: hit.status,
        headers: { "Content-Type": hit.ct, "Cache-Control": `public, max-age=${ttl}`, "X-Cache": "HIT", ...CORS },
      });
    }

    const upRes = await fetch(upstream);
    const body = await upRes.text();
    const ct = upRes.headers.get("Content-Type") || "application/json; charset=utf-8";

    // 정상 응답만 캐싱 (5xx 는 캐싱하지 않음)
    if (upRes.status < 500) setCache(cacheKey, { body, status: upRes.status, ct }, ttl);

    return new Response(body, {
      status: upRes.status,
      headers: { "Content-Type": ct, "Cache-Control": `public, max-age=${ttl}`, "X-Cache": "MISS", ...CORS },
    });
  },
};

function gbisUrl(key, p, params) {
  const usp = new URLSearchParams({ serviceKey: key, format: "json", ...params });
  return `${GBIS}/${p}?${usp}`;
}

function seoulUrl(key, p, params) {
  const usp = new URLSearchParams({ serviceKey: key, resultType: "json", ...params });
  return `${SEOUL}/${p}?${usp}`;
}
