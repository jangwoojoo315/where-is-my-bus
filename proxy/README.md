# 슬슬나가 프록시 (Cloudflare Worker)

확장 프로그램이 직접 data.go.kr/ws.bus.go.kr 을 호출하면 인증키가 노출되고 일일 한도에 걸립니다.
이 Worker가 **키를 서버에 숨기고 응답을 캐싱**해 그 문제를 해결합니다.

```
확장  →  이 Worker(키 보관 + 캐싱)  →  data.go.kr / ws.bus.go.kr
```

## 배포

```bash
cd proxy
npm i -g wrangler          # 또는 npx wrangler ...
wrangler login             # Cloudflare 계정 로그인
wrangler secret put DATA_GO_KR_KEY   # data.go.kr 일반 인증키(Decoding) 입력
wrangler deploy
```

배포되면 `https://where-is-my-bus-proxy.<서브도메인>.workers.dev` 주소가 나옵니다.
그 주소를 확장의 `api.js` 상단 `PROXY_BASE` 에 넣으세요.

## 엔드포인트 (확장이 호출)

| 경로 | 상류 | 캐시 |
|------|------|------|
| `/gbis/stations?keyword=` | 경기 정류소 검색 | 1일 |
| `/gbis/routes?stationId=` | 경기 경유 노선 | 1일 |
| `/gbis/arrivals?stationId=` | 경기 도착정보 | 15초 |
| `/seoul/stations?keyword=` | 서울 정류소 검색 | 1일 |
| `/seoul/station?arsId=` | 서울 경유노선+도착정보 | 15초 |

## 일일 한도 메모

- 캐싱 덕분에 상류 호출 수는 "사용자 수"가 아니라 "조회되는 정류장 수"에 비례합니다.
- 그래도 부족하면 data.go.kr 마이페이지에서 각 API를 **활용(운영) 단계로 전환** 신청해 일일 한도를 상향하세요.
- 로컬 테스트: `wrangler dev` 후 `http://localhost:8787/gbis/stations?keyword=수원역` 확인.
