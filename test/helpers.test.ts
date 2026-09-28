import { describe, expect, it } from "vitest";
import FetchClientError from "../src/fetchClientError";
import {
  buildFullURL,
  isNetworkError,
  mergeConfig,
  parseResponse,
  readErrorBody,
} from "../src/helpers";

const catchError = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as FetchClientError;
  }
  throw new Error("에러가 발생해야 합니다.");
};

describe("mergeConfig", () => {
  it("요청 헤더가 기본 헤더를 덮어쓴다", () => {
    const config = mergeConfig(
      { headers: { Authorization: "Bearer request" } },
      { headers: { Authorization: "Bearer default", "X-Client": "web" } }
    );

    expect(config.headers.get("Authorization")).toBe("Bearer request");
    expect(config.headers.get("X-Client")).toBe("web");
  });

  it("retry 옵션을 깊게 병합한다", () => {
    const config = mergeConfig(
      { retry: { limit: 5 } },
      { retry: { limit: 1, statusCodes: [503] } }
    );

    expect(config.retry).toEqual({ limit: 5, statusCodes: [503] });
  });

  it("retry의 숫자와 false 축약형을 limit으로 바꿔 병합한다", () => {
    expect(
      mergeConfig({ retry: 3 }, { retry: { statusCodes: [503] } }).retry
    ).toEqual({ limit: 3, statusCodes: [503] });
    expect(mergeConfig({ retry: false }, { retry: 5 }).retry).toEqual({
      limit: 0,
    });
  });
});

describe("buildFullURL", () => {
  it("baseURL의 경로를 유지한다", () => {
    expect(buildFullURL("/users", "https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/users"
    );
    expect(buildFullURL("users", "https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1/users"
    );
  });

  it("절대 URL이면 baseURL을 무시한다", () => {
    expect(
      buildFullURL("https://other.example.com/a", "https://api.example.com/v1")
    ).toBe("https://other.example.com/a");
  });

  it("쿼리 파라미터를 붙이고 null 값은 건너뛴다", () => {
    expect(
      buildFullURL("/users", "https://api.example.com", {
        page: 2,
        tags: ["a", "b"],
        empty: null,
      })
    ).toBe("https://api.example.com/users?page=2&tags=a&tags=b");
  });

  it("baseURL 없이 상대 경로를 주면 URL_BUILD_ERROR를 던진다", () => {
    const error = catchError(() => buildFullURL("/users"));

    expect(error).toBeInstanceOf(FetchClientError);
    expect(error.type).toBe("URL_BUILD_ERROR");
  });
});

describe("parseResponse", () => {
  it("JSON 파싱에 실패하면 PARSE_ERROR를 던진다", async () => {
    const error = await parseResponse(
      new Response("not json", { status: 200 }),
      "json"
    ).then(
      () => {
        throw new Error("에러가 발생해야 합니다.");
      },
      (error: unknown) => error as FetchClientError
    );

    expect(error).toBeInstanceOf(FetchClientError);
    expect(error.type).toBe("PARSE_ERROR");
    expect(error.status).toBe(200);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });
});

describe("readErrorBody", () => {
  it("JSON이면 파싱하고, 아니면 원문을, 비어 있으면 null을 반환한다", async () => {
    expect(await readErrorBody(new Response('{"message":"bad"}'))).toEqual({
      message: "bad",
    });
    expect(await readErrorBody(new Response("<html>502</html>"))).toBe(
      "<html>502</html>"
    );
    expect(await readErrorBody(new Response(""))).toBeNull();
  });
});

describe("isNetworkError", () => {
  it("런타임별 fetch 네트워크 오류 메시지만 네트워크 오류로 본다", () => {
    expect(isNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isNetworkError(new TypeError("terminated"))).toBe(true);
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new TypeError("Failed to fetch (example.com)"))).toBe(
      true
    );

    expect(
      isNetworkError(
        new TypeError("Request with GET/HEAD method cannot have body.")
      )
    ).toBe(false);
    expect(isNetworkError(new Error("fetch failed"))).toBe(false);
  });

  it("Safari의 'Load failed'는 stack이 없을 때만 네트워크 오류로 본다", () => {
    const safariError = Object.assign(new TypeError("Load failed"), {
      stack: undefined,
    });

    expect(isNetworkError(safariError)).toBe(true);
    expect(isNetworkError(new TypeError("Load failed"))).toBe(false);
  });
});
