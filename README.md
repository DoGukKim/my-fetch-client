# FetchClient

> 타입 안전하고 확장 가능한 HTTP 클라이언트 라이브러리

네이티브 `fetch` API 기반의 경량 HTTP 클라이언트입니다. TypeScript 우선 설계와 Hook 시스템을 통해 유연하고 타입 안전한 API 통신을 제공합니다.

## ✨ 주요 기능

- **타입 안전성** - 제네릭을 활용한 요청/응답 타입 추론
- **Hook 시스템** - 요청 전/후 인터셉터를 통한 확장성 (인증, 로깅 등)
- **자동 직렬화** - JSON, FormData, URLSearchParams 등 자동 변환
- **커스텀 에러** - 에러 유형별 분류 및 상세 정보 제공
- **제로 의존성** - 외부 라이브러리 없이 네이티브 API만 사용

## 🚀 Quick Start

```typescript
import FetchClient from "my-fetch-client";

const client = new FetchClient({
  baseURL: "https://api.example.com",
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
├── request()           # 핵심 요청 로직
│   ├── mergeConfig     # 설정 병합
│   ├── buildFullURL    # URL 생성 + 쿼리 파라미터
│   └── serializeBody   # 본문 직렬화
│
└── FetchClientHookRunner
    ├── beforeRequest   # 요청 전 인터셉터
    ├── afterResponse   # 응답 후 인터셉터
    ├── onRequestError  # 네트워크 에러 처리
    └── onResponseError # HTTP 에러 처리
```

| 컴포넌트                | 역할                                     |
| ----------------------- | ---------------------------------------- |
| `FetchClient`           | 메인 클래스. 요청 생성 및 응답 처리 조율 |
| `FetchClientHookRunner` | Hook 실행 관리. 요청 라이프사이클 제어   |
| `FetchClientError`      | 커스텀 에러. 유형 분류 및 컨텍스트 보존  |
| `helpers`               | URL 빌드, Content-Type 추론, 직렬화/파싱 |

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

### Hooks

| Hook              | 시점      | 용도                         |
| ----------------- | --------- | ---------------------------- |
| `beforeRequest`   | 요청 전   | 헤더 추가, 인증 토큰 삽입    |
| `afterResponse`   | 응답 후   | 응답 변환, 로깅              |
| `onRequestError`  | 요청 실패 | 네트워크 에러 처리           |
| `onResponseError` | HTTP 에러 | 4xx/5xx 응답 처리, 토큰 갱신 |

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
- JSON 파싱 실패 시 상세 에러 메시지 제공

### Hook 체이닝

여러 Hook이 순차 실행되며, 각 Hook의 결과가 다음 Hook으로 전달됩니다.

## 📁 프로젝트 구조

```
src/
├── fetchClient.ts            # 메인 클래스 (~160 LOC)
├── fetchClientHookRunner.ts  # Hook 실행 관리자
├── fetchClientError.ts       # 커스텀 에러 클래스
├── helpers.ts                # 유틸리티 함수
├── types.ts                  # TypeScript 타입 정의
└── index.ts                  # 엔트리 포인트
```
