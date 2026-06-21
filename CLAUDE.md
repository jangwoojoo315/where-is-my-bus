# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

등록한 경기도 정류장의 버스가 **몇 분 뒤 도착하는지**만 보여주는 크롬 확장 프로그램(MV3). 알림/알람 등 부가 기능은 없다. 서울은 미지원 — 공공데이터포털의 **경기도 버스정보(GBIS)** API(제공기관 코드 6410000)만 사용한다.

## 빌드 / 테스트 / 실행

빌드 단계, 번들러, 패키지 매니저, 테스트가 **없다**. 순수 ES 모듈 + 정적 파일로 동작한다.

- **실행/디버그**: `chrome://extensions` → 개발자 모드 켜기 → "압축해제된 확장 프로그램을 로드" → 이 폴더 선택.
- **변경 반영**: 확장 프로그램 카드의 새로고침 버튼을 누르면 코드 변경이 반영된다. 팝업/옵션은 다시 열어야 한다.
- **로그 확인**: 팝업은 팝업을 우클릭 → "검사", 옵션 페이지는 일반 DevTools로 디버깅한다.

## 아키텍처

세 개의 진입점이 모두 `api.js`를 ES 모듈로 import하는 단순 구조다.

- **`api.js`** — 유일한 데이터 계층. GBIS API 호출 3종(`searchStations`, `getStationRoutes`, `getArrivals`)과 저장소 헬퍼(`getApiKey`/`setApiKey`, `getFavorites`/`setFavorites`)를 모두 담는다. 새 API 호출이나 저장 로직은 여기에 추가한다.
- **`popup.js`** (`popup.html`) — 툴바 아이콘 팝업. 등록된 즐겨찾기의 도착정보를 표시. 열릴 때 + 30초마다(`setInterval`) 갱신.
- **`options.js`** (`options.html`) — 정류장 검색 → 노선 선택 → 즐겨찾기 등록/삭제 화면.

### 핵심 흐름과 규칙

- **API 키 우선순위**: `getApiKey()`는 먼저 `config.js`의 `API_KEY`를 동적 import로 시도하고, 없으면 `chrome.storage.sync`의 값을 쓴다. 키는 반드시 공공데이터포털의 **Decoding(디코딩) 키**여야 하며, `api.js`의 `call()`이 `URLSearchParams`로 인코딩을 처리한다 (이중 인코딩 주의 — 인코딩 키를 넣으면 안 됨).
- **`config.js`는 .gitignore 처리**되며 실제 키를 담는다. 템플릿은 `config.example.js`. 키 관련 작업 시 `config.js`를 커밋하지 말 것.
- **GBIS 응답 정규화**: 결과가 1건이면 객체로, 여러 건이면 배열로 오기 때문에 `toArray()`로 항상 배열화한다. 새 호출을 추가할 때도 동일하게 처리한다.
- **resultCode 규칙**: `0` = 정상, `4` = 결과 없음(빈 목록, 정상 처리). 그 외는 오류로 throw. HTTP 401/403과 XML 오류 응답(JSON 파싱 실패 시)도 `call()`에서 한국어 메시지로 변환한다.
- **즐겨찾기 데이터 모델**: `{ id, stationId, stationName, mobileNo, regionName, routeId, routeName }`. `chrome.storage.sync`에 저장되어 같은 크롬 계정 간 동기화된다. 정류장+노선 조합으로 중복을 막는다.
- **도착정보 매칭**: 팝업은 같은 정류장을 한 번만 호출(`stationId` 중복 제거)한 뒤, 즐겨찾기의 `routeId`와 응답의 `routeId`를 문자열 비교로 매칭한다. `predictTime1`(분), `locationNo1`(남은 정거장 수)을 표시한다.

### 권한 / 외부 의존성

- `manifest.json`의 `host_permissions`는 `https://apis.data.go.kr/*`. 다른 도메인 호출은 여기에 추가해야 한다.
- `permissions`는 `storage`뿐. 백그라운드 서비스 워커나 content script는 없다.

## 작성 언어

코드 주석, 사용자 노출 문자열, 오류 메시지는 모두 **한국어**다. 새 코드도 이 관례를 따른다.
