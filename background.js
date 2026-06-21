// 백그라운드 서비스 워커
// 사용자가 옵션에서 지정한 시각(매일 반복)에 알람이 울리면,
// 선택한 방식으로 도착정보를 알린다.
//   - "inbrowser"(기본): 팝업 창 + 툴바 아이콘 배지 (OS 권한 불필요)
//   - "os": 크롬(OS) 알림 (크롬이 백그라운드여도 표시되지만 OS 알림 설정 필요)

import { getFavorites, getArrivals } from "./api.js";

const ALARM_NAME = "busAlert";

// ---- 알람 예약 -----------------------------------------------------------

// "HH:MM" 문자열로 다음 발생 시각(타임스탬프)을 계산. 이미 지난 시각이면 다음 날.
function nextOccurrence(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const next = new Date();
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

async function scheduleAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
  const { alertEnabled, alertTime } = await chrome.storage.sync.get([
    "alertEnabled",
    "alertTime",
  ]);
  if (!alertEnabled || !alertTime) return; // 비활성화 상태면 예약하지 않음
  chrome.alarms.create(ALARM_NAME, { when: nextOccurrence(alertTime) });
}

// 설치/크롬 시작 시, 그리고 설정이 바뀔 때마다 알람을 다시 잡는다.
chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(scheduleAlarm);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.alertEnabled || changes.alertTime)) {
    scheduleAlarm();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await triggerAlert();
  await scheduleAlarm(); // 다음 날 같은 시각으로 재예약
});

// OS 알림 본문 클릭 시 옵션 페이지를 연다(상세 확인용).
chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith("bus-")) chrome.runtime.openOptionsPage();
});

// ---- 알림 동작 -----------------------------------------------------------

// 선택된 방식에 따라 분기. 옵션 화면의 "지금 테스트" 버튼도 이 함수를 export 없이
// 동일 로직(options.js 에서 직접 호출)으로 재현한다.
export async function triggerAlert() {
  const { alertMode } = await chrome.storage.sync.get("alertMode");
  if (alertMode === "os") {
    await notifyOs();
  } else {
    await openInBrowser();
  }
}

// 브라우저 안에서: 아이콘 배지를 표시하고,
// 먼저 진짜 확장 팝업(openPopup)을 시도 → 실패하면 작은 팝업 창으로 대체한다.
async function openInBrowser() {
  await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
  await chrome.action.setBadgeText({ text: "!" });
  try {
    // 크롬 창이 떠 있고 포커스일 때만 성공 (툴바 아이콘 밑 팝업)
    await chrome.action.openPopup();
  } catch {
    await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      width: 380,
      height: 520,
      focused: true,
    });
  }
}

// OS 알림: 도착정보를 조회해 한 건의 알림으로 표시한다.
async function notifyOs() {
  const lines = await buildArrivalLines();
  chrome.notifications.create(
    `bus-${Date.now()}`,
    {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "슬슬나가 — 버스 도착 정보",
      message: lines.join("\n"),
      priority: 2,
    },
    () => {
      if (chrome.runtime.lastError) {
        console.warn("[슬슬나가] OS 알림 생성 실패:", chrome.runtime.lastError.message);
      }
    }
  );
}

// ---- 도착정보 → 텍스트 줄 ------------------------------------------------

function fmtMin(min) {
  if (min == null || min === "") return null;
  const m = Number(min);
  if (Number.isNaN(m)) return null;
  return m <= 0 ? "곧 도착" : `${m}분 후`;
}

function fmtArrival(match) {
  if (!match) return "운행 정보 없음";
  const t1 = fmtMin(match.predictTime1);
  if (!t1) return "도착 정보 없음";
  const cnt =
    match.locationNo1 != null && match.locationNo1 !== ""
      ? ` (${match.locationNo1}정거장 전)`
      : "";
  return `${t1}${cnt}`;
}

async function buildArrivalLines() {
  try {
    const favs = await getFavorites();
    if (!favs.length) return ["등록된 정류장이 없습니다."];

    // 같은 (제공자+정류장)은 한 번만 호출
    const key = (f) => `${f.provider || "gyeonggi"}:${f.stationId}`;
    const stations = {};
    for (const f of favs) stations[key(f)] = f;

    const arrivalsByKey = {};
    await Promise.all(
      Object.entries(stations).map(async ([k, f]) => {
        try {
          arrivalsByKey[k] = await getArrivals(f.provider || "gyeonggi", f.stationId);
        } catch (e) {
          arrivalsByKey[k] = { error: e.message };
        }
      })
    );

    return favs.map((f) => {
      const arr = arrivalsByKey[key(f)];
      if (arr && arr.error) return `${f.routeName}번 · ${arr.error}`;
      const match = (arr || []).find((a) => String(a.routeId) === String(f.routeId));
      return `${f.routeName}번 · ${fmtArrival(match)}`;
    });
  } catch (e) {
    return [e.message];
  }
}
