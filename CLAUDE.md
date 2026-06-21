# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

등록한 **서울·경기** 정류장의 버스가 **몇 분 뒤 도착하는지**를 보여주는 크롬 확장 프로그램(MV3). 매일 지정 시각 알림 기능이 있다. **확장은 인증키를 갖지 않고, 키를 보관·캐싱하는 프록시(`proxy/`, Cloudflare Worker)를 통해서만** 공공 API를 호출한다.
- 프록시 → **경기**: 경기 버스정보(GBIS), `https://apis.data.go.kr/6410000`, `format=json`
- 프록시 → **서울**: 서울 TOPIS, `http://ws.bus.go.kr/api/rest`, `resultType=json` (https 미지원이라 http 전용; 프록시가 서버에서 호출하므로 확장은 http 권한 불필요)
- data.go.kr 인증키 1개로 두 지역 모두 호출. 키는 Worker 시크릿 `DATA_GO_KR_KEY`로만 존재한다.

## 빌드 / 테스트 / 실행

빌드 단계, 번들러, 패키지 매니저, 테스트가 **없다**. 순수 ES 모듈 + 정적 파일로 동작한다.

- **실행/디버그**: `chrome://extensions` → 개발자 모드 켜기 → "압축해제된 확장 프로그램을 로드" → 이 폴더 선택.
- **변경 반영**: 확장 프로그램 카드의 새로고침 버튼을 누르면 코드 변경이 반영된다. 팝업/옵션은 다시 열어야 한다.
- **로그 확인**: 팝업은 팝업을 우클릭 → "검사", 옵션 페이지는 일반 DevTools로 디버깅한다.

## 아키텍처

진입점(팝업·옵션·백그라운드)이 모두 `api.js`를 ES 모듈로 import하는 단순 구조다.

- **`api.js`** — 유일한 데이터 계층이자 **제공자 추상화 계층**. `fetchProxy()`로 프록시를 호출하고 `callGbis()`/`callSeoul()`이 각 제공자 응답을 검증, 공개 함수 `searchStations`/`getStationRoutes(provider, …)`/`getArrivals(provider, …)`가 **공통 형태로 정규화**해 반환한다. 상단 `PROXY_BASE` 상수가 Worker 주소. 저장소 헬퍼(`getFavorites`/`setFavorites`)도 여기 있다. 새 제공자/엔드포인트는 여기 + `proxy/src/worker.js`에 추가한다.
- **`proxy/src/worker.js`** — Cloudflare Worker 프록시. data.go.kr 키(`env.DATA_GO_KR_KEY` 시크릿)를 주입하고 화이트리스트 엔드포인트(`/gbis/*`, `/seoul/*`)만 상류로 전달, **메모리 캐시**(도착 15초, 정류장/노선 1일)로 일일 한도를 보호한다. CORS 허용.
- **`popup.js`** (`popup.html`) — 툴바 아이콘 팝업. 등록된 즐겨찾기의 도착정보를 표시. 열릴 때 + 30초마다(`setInterval`) 갱신.
- **`options.js`** (`options.html`) — 정류장 검색 → 노선 선택 → 즐겨찾기 등록/삭제 + 자동 알림 시각 설정 화면.
- **`background.js`** — 백그라운드 서비스 워커(ES 모듈). `chrome.alarms`로 사용자가 지정한 시각(매일)에 깨어나 **알림 방식(`alertMode`)에 따라 분기**한다: `"inbrowser"`(기본)는 배지를 표시하고 **`chrome.action.openPopup()`(진짜 툴바 팝업)을 먼저 시도 → 실패 시 `chrome.windows.create`로 작은 팝업 창 대체**, `"os"`는 `getArrivals`로 조회한 텍스트를 `chrome.notifications`로 띄운다. `api.js`를 그대로 import해 재사용한다.

### 핵심 흐름과 규칙

- **인증키는 프록시에만**: 확장 코드/패키지에는 키가 전혀 없다. 키는 Worker 시크릿 `DATA_GO_KR_KEY`(Decoding 키)로만 존재하고, Worker가 `URLSearchParams`로 인코딩해 상류에 붙인다(이중 인코딩 주의 — 인코딩 키 금지). 경기·서울이 같은 키를 공유한다. **키를 절대 확장/레포에 넣지 말 것.**
- **프록시 오류 처리**: 프록시는 파라미터 오류·서버 키 미설정 시 `{ "error": "..." }` JSON을 반환한다. `callGbis()`/`callSeoul()`은 파싱 후 `data.error`가 있으면 그 메시지로 throw한다.
- **제공자 구분(`provider`)**: 각 즐겨찾기와 검색 결과는 `provider`(`"gyeonggi"` | `"seoul"`) 필드를 가진다. `provider`가 없는 기존 데이터는 어디서나 `"gyeonggi"`로 폴백한다(하위호환). 서울은 `arsId`(정류소 고유번호)를 `stationId`로 쓴다.
- **공통 정규화 형태**: 정류소 `{ provider, stationId, stationName, mobileNo, regionName }`, 노선 `{ routeId, routeName, routeTypeName }`, 도착 `{ routeId, predictTime1(분), locationNo1(남은 정거장), predictTime2(분) }`. 모든 ID는 문자열로 정규화하고, 단건/다건 응답은 `toArray()`로 배열화한다.
- **서울 도착 메시지 파싱**: 서울 API는 분 단위 숫자 대신 `arrmsg1`/`arrmsg2` 문자열("3분5초후[2번째 전]", "곧 도착", "운행종료")만 준다. `parseSeoulMsg()`가 분·정거장 수를 추출하고, 운행종료/출발대기 등은 `null`로 만든다. 서울은 `getStationByUid` 하나로 경유노선·도착정보를 모두 얻는다.
- **응답 코드 규칙**: 경기(GBIS) `resultCode` / 서울(TOPIS) `headerCd` 모두 `0`=정상, `4`=결과 없음(정상 처리), 그 외는 오류로 throw. HTTP 401/403과 XML 오류 응답은 `callGbis()`에서 한국어 메시지로 변환한다.
- **검색은 두 제공자 동시 호출**: `searchStations()`는 `Promise.allSettled`로 경기·서울을 함께 조회해 결과를 합친다. 한쪽만 실패하면 나머지로 진행하고, **둘 다 실패할 때만** 오류를 던진다.
- **도착정보 매칭**: 팝업은 `provider:stationId`로 묶어 정류장당 한 번만 호출한 뒤, 즐겨찾기의 `routeId`와 응답의 `routeId`를 문자열 비교로 매칭한다.

### 권한 / 외부 의존성

- `manifest.json`의 `host_permissions`는 **프록시 Worker 주소 하나뿐**(`PROXY_BASE`와 동일하게 유지). 프록시 주소를 바꾸면 `api.js`의 `PROXY_BASE`와 manifest 둘 다 고쳐야 한다.
- `permissions`: `storage`(즐겨찾기·알림 설정), `alarms`(지정 시각 트리거), `notifications`(도착 알림). content script는 없다.
- **알림 스케줄링**: 설정값 `alertEnabled`/`alertTime`("HH:MM")/`alertMode`(`"inbrowser"` 기본 | `"os"`)는 `chrome.storage.sync`에 저장된다. `background.js`는 `storage.onChanged`·`onInstalled`·`onStartup`에서 알람을 다시 잡고, 알람이 울리면 `triggerAlert()`를 실행한 뒤 **다음 날로 재예약**한다(드리프트 방지를 위해 `periodInMinutes` 대신 매번 `nextOccurrence()`로 재계산). 크롬이 완전히 종료돼 있으면 알람은 울리지 않는다. **OS 알림은 `notifications.create`가 성공해도(콜백에 id 반환) OS/집중모드가 화면 표시를 막을 수 있으므로** 기본값을 권한이 필요 없는 `"inbrowser"`로 둔다. 배지는 팝업이 열릴 때(`popup.js` 로드 시) 지운다.

## 작성 언어

코드 주석, 사용자 노출 문자열, 오류 메시지는 모두 **한국어**다. 새 코드도 이 관례를 따른다.
