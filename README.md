# FetchClient

> 타입 안전하고 확장 가능한 HTTP 클라이언트 라이브러리

네이티브 `fetch` API 기반의 경량 HTTP 클라이언트입니다. TypeScript 우선 설계와 Hook 시스템을 통해 유연하고 타입 안전한 API 통신을 제공합니다.

## ✨ 주요 기능

- **타입 안전성** - 제네릭을 활용한 요청/응답 타입 추론
- **Hook 시스템** - 요청 전/후 인터셉터를 통한 확장성 (인증, 로깅 등)
- **자동 직렬화** - JSON, FormData, URLSearchParams 등 자동 변환
- **타임아웃** - 기본 10초, 요청별로 조정하거나 끌 수 있음
- **취소** - `AbortController`의 `signal`로 요청과 재시도 대기를 즉시 중단
- **자동 재시도** - 멱등 메서드의 일시적 실패를 지수 백오프로 재시도 (`Retry-After` 지원)
- **커스텀 에러** - 네트워크, 타임아웃, 취소, HTTP, 파싱 등 에러 유형별 분류 및 상세 정보 제공
- **제로 의존성** - 외부 라이브러리 없이 네이티브 API만 사용

## 🚀 Quick Start

```typescript
import FetchClient from "my-fetch-client";

const client = new FetchClient({
  baseURL: "https://api.example.com",
  timeout: 5_000, // 기본값 10초
  retry: 3, // 기본값 2회 (멱등 메서드만)
  hooks: {
    beforeRequest: [
      (config) => {
        config.headers.set("Authorization", `Bearer ${token}`);
        return config;
      },
    ],
  },
});

// GET - 타입 안전한 응답
const user = await client.get<User>("/users/1");

// POST - 요청/응답 타입 지정
const newUser = await client.post<CreateUserBody, User>("/users", {
  body: { name: "John", email: "john@example.com" },
});

// DELETE
await client.delete("/users/1");
```

## 🏗 아키텍처

```
FetchClient
├── request()               # 설정 병합, 재시도 루프, 최종 에러 처리
│   ├── mergeConfig         # 설정 병합 (헤더, retry 옵션)
│   ├── send()              # 한 번의 시도
│   │   ├── buildFullURL    # URL 생성 + 쿼리 파라미터
│   │   ├── buildRequest    # 본문 직렬화 + Request 생성
│   │   └── combineSignals  # 타임아웃 signal + 사용자 signal
│   └── retry               # 재시도 판단, 백오프/Retry-After 대기
│
└── FetchClientHookRunner
    ├── beforeRequest       # 요청 전 인터셉터
    ├── afterResponse       # 응답 후 인터셉터
    ├── beforeRetry         # 재시도 직전 인터셉터
    ├── onRequestError      # HTTP 외 에러 처리 (네트워크, 타임아웃 등)
    └── onResponseError     # HTTP 에러 처리
```

| 컴포넌트                | 역할                                                |
| ----------------------- | --------------------------------------------------- |
| `FetchClient`           | 메인 클래스. 요청 생성, 재시도, 응답 처리 조율      |
| `FetchClientHookRunner` | Hook 실행 관리. 요청 라이프사이클 제어              |
| `FetchClientError`      | 커스텀 에러. 유형 분류 및 컨텍스트 보존             |
| `retry`                 | 재시도 판단, 대기 시간 계산, 취소 가능한 대기       |
| `helpers`               | URL 빌드, Content-Type 추론, 직렬화/파싱, 에러 분류 |

## 📖 API

### Methods

| 메서드    | 시그니처                                  |
| --------- | ----------------------------------------- |
| `get`     | `get<TResponse>(url, options?)`           |
| `post`    | `post<TBody, TResponse>(url, options?)`   |
| `put`     | `put<TBody, TResponse>(url, options?)`    |
| `patch`   | `patch<TBody, TResponse>(url, options?)`  |
| `delete`  | `delete<TBody, TResponse>(url, options?)` |
| `head`    | `head<TResponse>(url, options?)`          |
| `options` | `options<TResponse>(url, options?)`       |

### 타임아웃

```typescript
const client = new FetchClient({ timeout: 5_000 }); // 지정하지 않으면 10초

await client.get("/reports", { timeout: 60_000 }); // 요청별로 조정
await client.post("/upload", { body: file, timeout: false }); // 타임아웃 끄기
```

- 타임아웃은 시도마다 새로 적용됩니다. 재시도를 포함한 전체 시간을 제한하려면 `signal: AbortSignal.timeout(ms)`를 함께 넘기세요.
- 시간이 초과되면 `TIMEOUT_ERROR`가 발생하고, 멱등 메서드라면 재시도합니다.

### 취소

```typescript
const controller = new AbortController();
const request = client.get<User[]>("/users", { signal: controller.signal });

controller.abort();

try {
  await request;
} catch (error) {
  if (error instanceof FetchClientError && error.type === "ABORT_ERROR") {
    // 의도한 취소이므로 무시
  }
}
```

- 요청 중이든 재시도 대기 중이든 즉시 중단됩니다.
- `ABORT_ERROR`는 재시도하지 않고, `onRequestError`와 `onResponseError` 훅도 호출하지 않습니다.

### 리트라이

```typescript
const client = new FetchClient({
  retry: { limit: 3, statusCodes: [429, 503] },
});

await client.get("/users", { retry: false }); // 요청별로 끄기
await client.post("/orders", { body, retry: { methods: ["POST"] } }); // POST 재시도 허용
```

| 옵션          | 기본값                                    | 설명                                                          |
| ------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `limit`       | `2`                                       | 최대 재시도 횟수 (첫 요청 제외)                               |
| `methods`     | `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE` | 재시도할 메서드                                               |
| `statusCodes` | `408`, `429`, `500`, `502`, `503`, `504`  | 재시도할 HTTP 상태 코드                                       |
| `delay`       | 300ms 기준 지수 백오프 + 지터             | `(attempt) => ms` 형태의 대기 시간 계산 함수                  |
| `maxDelay`    | `10000`                                   | 대기 시간 상한. `Retry-After`가 이보다 길면 재시도하지 않음   |
| `shouldRetry` | 없음                                      | `(context) => boolean`. 지정하면 메서드/상태 코드 규칙을 대체 |

- `retry: 3`은 `{ limit: 3 }`과 같고, `retry: false`는 재시도를 끕니다.
- 요청별 `retry` 객체는 클라이언트 기본값과 깊게 병합됩니다.
- 네트워크 오류와 타임아웃도 재시도합니다. 사용자 취소와 `ReadableStream` body는 재시도하지 않습니다.
- `URL_BUILD_ERROR`, `REQUEST_BUILD_ERROR`, `PARSE_ERROR`처럼 다시 보내도 결과가 같은 에러는 재시도하지 않습니다.
- 응답에 `Retry-After` 헤더가 있으면 `delay`보다 우선합니다.

### 에러 처리

| 타입                  | 발생 상황                                                       | 호출되는 훅       |
| --------------------- | --------------------------------------------------------------- | ----------------- |
| `HTTP_ERROR`          | 2xx가 아닌 응답 (`status`, `response` 포함)                     | `onResponseError` |
| `NETWORK_ERROR`       | 연결 실패 등 네트워크 오류                                      | `onRequestError`  |
| `TIMEOUT_ERROR`       | `timeout` 초과                                                  | `onRequestError`  |
| `ABORT_ERROR`         | 사용자가 `signal`로 취소                                        | 없음              |
| `PARSE_ERROR`         | 응답 본문 처리 실패 (JSON 파싱, `responseType` 불일치 등)       | `onRequestError`  |
| `URL_BUILD_ERROR`     | 잘못된 URL                                                      | `onRequestError`  |
| `REQUEST_BUILD_ERROR` | 요청을 만들 수 없음 (GET 요청의 body, 직렬화할 수 없는 body 등) | `onRequestError`  |

- 에러 훅은 재시도가 모두 끝난 뒤 최종 실패 때 한 번만 호출됩니다.
- `HTTP_ERROR`의 `cause`에는 에러 응답 본문이 담깁니다. JSON이면 파싱한 값, 아니면 원문 텍스트입니다.
- 그 밖의 에러는 원인이 된 에러(네트워크 `TypeError` 등)를 `cause`로 확인할 수 있습니다.

### Hooks

| Hook              | 시점                  | 용도                                |
| ----------------- | --------------------- | ----------------------------------- |
| `beforeRequest`   | 요청 전               | 헤더 추가, 인증 토큰 삽입           |
| `afterResponse`   | 응답 후               | 응답 변환, 로깅                     |
| `beforeRetry`     | 재시도 직전           | 토큰 갱신 후 헤더 교체, 재시도 로깅 |
| `onRequestError`  | 최종 실패 (HTTP 외)   | 네트워크, 타임아웃 에러 처리        |
| `onResponseError` | 최종 실패 (HTTP 에러) | 4xx/5xx 응답 처리                   |

#### 401 응답 후 토큰 갱신

`shouldRetry`로 401 응답을 한 번 재시도하게 하고, `beforeRetry`에서 토큰을 갱신합니다.

```typescript
const client = new FetchClient({
  retry: {
    shouldRetry: ({ error, attempt }) => error.status === 401 && attempt === 1,
  },
  hooks: {
    beforeRetry: [
      async ({ config }) => {
        const token = await refreshToken();
        config.headers.set("Authorization", `Bearer ${token}`);
      },
    ],
  },
});
```

`shouldRetry`를 지정하면 기본 규칙(메서드, 상태 코드, 네트워크 오류)을 대체하므로, 다른 재시도 조건이 필요하면 함께 적어야 합니다.

## 💡 기술적 하이라이트

### 자동 Content-Type 추론

```typescript
FormData        → multipart/form-data (브라우저 자동 설정)
URLSearchParams → application/x-www-form-urlencoded
Blob            → blob.type 또는 application/octet-stream
object          → application/json
string          → text/plain
```

### 안전한 응답 파싱

- 204 No Content, Content-Length: 0 → `null` 반환
- 상태 코드를 먼저 확인하므로, HTML 에러 페이지를 주는 502 같은 응답도 `HTTP_ERROR`로 분류
- JSON 파싱 실패 시 `PARSE_ERROR`와 상세 에러 메시지 제공

### 설정 병합

- 요청 헤더가 클라이언트 기본 헤더보다 우선합니다.
- `baseURL`의 경로를 유지합니다. `https://api.example.com/v1`에서 `/users`를 요청하면 `https://api.example.com/v1/users`가 됩니다.

### Hook 체이닝

여러 Hook이 순차 실행되며, 각 Hook의 결과가 다음 Hook으로 전달됩니다.

## 📁 프로젝트 구조

```
src/
├── fetchClient.ts            # 메인 클래스 (요청 흐름, 재시도 루프)
├── fetchClienthookRunner.ts  # Hook 실행 관리자
├── fetchClientError.ts       # 커스텀 에러 클래스
├── retry.ts                  # 재시도 판단, 대기 시간 계산
├── helpers.ts                # 유틸리티 함수
├── types.ts                  # TypeScript 타입 정의
└── index.ts                  # 엔트리 포인트
test/                         # vitest 단위 테스트 (pnpm test)
```
