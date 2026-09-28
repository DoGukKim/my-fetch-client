import { describe, expect, it } from "vitest";
import FetchClientError from "../src/fetchClientError";
import {
  DEFAULT_RETRY,
  getRetryDelay,
  parseRetryAfter,
  resolveRetryOptions,
  sleep,
} from "../src/retry";

const httpError = (status: number, headers?: Record<string, string>) =>
  new FetchClientError(
    `HTTP Error ${status}`,
    "HTTP_ERROR",
    new Response(null, { status, headers }),
    status
  );

describe("resolveRetryOptions", () => {
  it("옵션이 없으면 기본값을 쓴다", () => {
    expect(resolveRetryOptions()).toEqual(DEFAULT_RETRY);
  });

  it("축약형을 해석하고 undefined 값은 기본값으로 둔다", () => {
    expect(resolveRetryOptions(false).limit).toBe(0);
    expect(resolveRetryOptions(5).limit).toBe(5);
    expect(resolveRetryOptions({ limit: undefined }).limit).toBe(
      DEFAULT_RETRY.limit
    );
  });
});

describe("parseRetryAfter", () => {
  it("초 단위 값을 ms로 바꾼다", () => {
    expect(parseRetryAfter("3")).toBe(3000);
  });

  it("HTTP 날짜를 남은 ms로 바꾼다", () => {
    const delay = parseRetryAfter(new Date(Date.now() + 5000).toUTCString());

    expect(delay).toBeGreaterThan(3000);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it("값이 없거나 형식이 잘못되면 undefined를 반환한다", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});

describe("getRetryDelay", () => {
  const options = resolveRetryOptions({ delay: () => 1000, maxDelay: 5000 });

  it("Retry-After 헤더가 있으면 그 값을 쓴다", () => {
    expect(
      getRetryDelay(httpError(503, { "Retry-After": "2" }), 1, options)
    ).toBe(2000);
  });

  it("Retry-After가 maxDelay보다 길면 undefined를 반환한다", () => {
    expect(
      getRetryDelay(httpError(429, { "Retry-After": "60" }), 1, options)
    ).toBeUndefined();
  });

  it("Retry-After가 없으면 delay 결과를 maxDelay로 제한한다", () => {
    expect(getRetryDelay(httpError(503), 1, options)).toBe(1000);
    expect(
      getRetryDelay(
        httpError(503),
        1,
        resolveRetryOptions({ delay: () => 60_000, maxDelay: 5000 })
      )
    ).toBe(5000);
  });

  it("기본 delay는 300ms 기준 지수 백오프에 지터를 더한다", () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const backoff = 300 * 2 ** (attempt - 1);
      const delay = DEFAULT_RETRY.delay(attempt);

      expect(delay).toBeGreaterThanOrEqual(backoff / 2);
      expect(delay).toBeLessThanOrEqual(backoff);
    }
  });
});

describe("sleep", () => {
  it("대기 중에 취소되면 signal의 reason으로 즉시 reject한다", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();

    const promise = sleep(10_000, controller.signal);
    controller.abort(new Error("stop"));

    await expect(promise).rejects.toThrow("stop");
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it("이미 취소된 signal이면 바로 reject한다", async () => {
    await expect(sleep(10_000, AbortSignal.abort("stop"))).rejects.toBe(
      "stop"
    );
  });
});
