import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FetchClient, { FetchClientError } from "../src";

const ENDPOINT = "https://api.example.com/items";
const noDelay = { delay: () => 0 };

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const statusResponse = (status: number, headers?: Record<string, string>) =>
  new Response(null, { status, headers });

const hangingFetch: typeof fetch = (input) =>
  new Promise((_, reject) => {
    const { signal } = input as Request;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });

const requests = () => fetchMock.mock.calls.map(([input]) => input as Request);
const lastRequest = () => fetchMock.mock.calls.at(-1)?.[0] as Request;

const captureError = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as FetchClientError;
  }
  throw new Error("요청이 실패해야 합니다.");
};

describe("버그 회귀", () => {
  it("요청 헤더가 클라이언트 기본 헤더보다 우선한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const client = new FetchClient({
      headers: { "X-Mode": "default", "X-Client": "web" },
    });

    await client.get(ENDPOINT, { headers: { "X-Mode": "request" } });

    const { headers } = lastRequest();
    expect(headers.get("X-Mode")).toBe("request");
    expect(headers.get("X-Client")).toBe("web");
  });

  it("baseURL의 경로를 유지한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const client = new FetchClient({ baseURL: "https://api.example.com/v1" });

    await client.get("/users");

    expect(lastRequest().url).toBe("https://api.example.com/v1/users");
  });

  it("HTML 본문의 502 응답도 HTTP_ERROR로 분류하고 원문을 cause에 담는다", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      })
    );
    const client = new FetchClient({ retry: false });

    const error = await captureError(client.get(ENDPOINT));

    expect(error).toBeInstanceOf(FetchClientError);
    expect(error.type).toBe("HTTP_ERROR");
    expect(error.status).toBe(502);
    expect(error.cause).toBe("<html>Bad Gateway</html>");
  });

  it("URL_BUILD_ERROR는 onResponseError가 아니라 onRequestError로 전달된다", async () => {
    const onRequestError = vi.fn();
    const onResponseError = vi.fn();
    const client = new FetchClient({
      hooks: {
        onRequestError: [onRequestError],
        onResponseError: [onResponseError],
      },
    });

    const error = await captureError(client.get("/users"));

    expect(error.type).toBe("URL_BUILD_ERROR");
    expect(onRequestError).toHaveBeenCalledOnce();
    expect(onResponseError).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("에러 분류", () => {
  it("네트워크 오류는 NETWORK_ERROR로 감싼다", async () => {
    const networkError = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(networkError);
    const client = new FetchClient({ retry: false });

    const error = await captureError(client.get(ENDPOINT));

    expect(error.type).toBe("NETWORK_ERROR");
    expect(error.cause).toBe(networkError);
  });

  it.each([
    {
      name: "GET 요청의 body",
      send: (client: FetchClient) => client.get(ENDPOINT, { body: { q: 1 } }),
    },
    {
      name: "JSON으로 직렬화할 수 없는 body",
      send: (client: FetchClient) => client.put(ENDPOINT, { body: { id: 1n } }),
    },
    {
      name: "SharedArrayBuffer 기반 body",
      send: (client: FetchClient) =>
        client.put(ENDPOINT, { body: new Uint8Array(new SharedArrayBuffer(4)) }),
    },
  ])(
    "$name는 REQUEST_BUILD_ERROR로 분류하고 요청을 보내지 않는다",
    async ({ send }) => {
      const client = new FetchClient({ retry: noDelay });

      const error = await captureError(send(client));

      expect(error.type).toBe("REQUEST_BUILD_ERROR");
      expect(error.cause).toBeInstanceOf(TypeError);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("잘못된 JSON 응답은 PARSE_ERROR로 분류하고 재시도하지 않는다", async () => {
    fetchMock.mockImplementation(
      async () => new Response("not json", { status: 200 })
    );
    const client = new FetchClient({ retry: noDelay });

    const error = await captureError(client.get(ENDPOINT));

    expect(error.type).toBe("PARSE_ERROR");
    expect(error.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("responseType과 맞지 않는 응답은 PARSE_ERROR로 분류하고 재시도하지 않는다", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
    const client = new FetchClient({ retry: noDelay });

    const error = await captureError(
      client.get(ENDPOINT, { responseType: "formData" })
    );

    expect(error.type).toBe("PARSE_ERROR");
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("afterResponse 훅이 본문을 먼저 읽으면 PARSE_ERROR로 분류하고 재시도하지 않는다", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
    const client = new FetchClient({
      retry: noDelay,
      hooks: {
        afterResponse: [
          async (response) => {
            await response.json();
            return response;
          },
        ],
      },
    });

    const error = await captureError(client.get(ENDPOINT));

    expect(error.type).toBe("PARSE_ERROR");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("응답 본문을 받다가 연결이 끊기면 NETWORK_ERROR로 분류하고 재시도한다", async () => {
    const disconnectedResponse = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("terminated"));
          },
        })
      );
    fetchMock
      .mockImplementationOnce(async () => disconnectedResponse())
      .mockImplementationOnce(async () => jsonResponse({ id: 1 }));
    const beforeRetry = vi.fn();
    const client = new FetchClient({
      retry: noDelay,
      hooks: { beforeRetry: [beforeRetry] },
    });

    await expect(client.get(ENDPOINT)).resolves.toEqual({ id: 1 });
    expect(beforeRetry.mock.calls[0][0].error.type).toBe("NETWORK_ERROR");
  });

  it("HTTP 에러의 JSON 본문을 cause에 담는다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "invalid" }, 400));
    const client = new FetchClient();

    const error = await captureError(client.post(ENDPOINT, { body: {} }));

    expect(error.type).toBe("HTTP_ERROR");
    expect(error.cause).toEqual({ message: "invalid" });
  });

  it("사용자 훅이 던진 에러는 그대로 전파하고 재시도하지 않는다", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}));
    const hookError = new Error("hook failed");
    const client = new FetchClient({
      retry: noDelay,
      hooks: {
        afterResponse: [
          () => {
            throw hookError;
          },
        ],
      },
    });

    await expect(client.get(ENDPOINT)).rejects.toBe(hookError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("타임아웃", () => {
  it("응답이 없으면 TIMEOUT_ERROR를 던진다", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const client = new FetchClient({ retry: false });

    const error = await captureError(client.get(ENDPOINT, { timeout: 20 }));

    expect(error.type).toBe("TIMEOUT_ERROR");
  });

  it("기본으로 10초 타임아웃을 적용하고, timeout: false면 적용하지 않는다", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const client = new FetchClient();

    await client.get(ENDPOINT);
    expect(timeoutSpy).toHaveBeenCalledExactlyOnceWith(10_000);

    timeoutSpy.mockClear();
    await client.get(ENDPOINT, { timeout: false });
    expect(timeoutSpy).not.toHaveBeenCalled();

    timeoutSpy.mockRestore();
  });

  it("타임아웃은 시도마다 새로 적용되고 멱등 메서드에서 재시도한다", async () => {
    let retrySignalAborted: boolean | undefined;
    fetchMock
      .mockImplementationOnce(hangingFetch)
      .mockImplementationOnce(async (input) => {
        retrySignalAborted = (input as Request).signal.aborted;
        return jsonResponse({ ok: true });
      });
    const client = new FetchClient({ timeout: 20, retry: noDelay });

    await expect(client.get(ENDPOINT)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requests()[0].signal.aborted).toBe(true);
    expect(retrySignalAborted).toBe(false);
  });
});

describe("취소", () => {
  it("요청 중에 취소하면 ABORT_ERROR를 던지고 재시도와 에러 훅을 건너뛴다", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const onRequestError = vi.fn();
    const onResponseError = vi.fn();
    const client = new FetchClient({
      retry: noDelay,
      hooks: {
        onRequestError: [onRequestError],
        onResponseError: [onResponseError],
      },
    });
    const controller = new AbortController();

    const promise = client.get(ENDPOINT, { signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    controller.abort();
    const error = await captureError(promise);

    expect(error.type).toBe("ABORT_ERROR");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(onRequestError).not.toHaveBeenCalled();
    expect(onResponseError).not.toHaveBeenCalled();
  });

  it("이미 취소된 signal로 요청하면 ABORT_ERROR를 던진다", async () => {
    fetchMock.mockImplementation(hangingFetch);
    const client = new FetchClient();

    const error = await captureError(
      client.get(ENDPOINT, { signal: AbortSignal.abort() })
    );

    expect(error.type).toBe("ABORT_ERROR");
  });

  it("백오프 대기 중에 취소해도 바로 ABORT_ERROR를 던진다", async () => {
    fetchMock.mockImplementation(async () => statusResponse(503));
    const client = new FetchClient({ retry: { delay: () => 5_000 } });
    const controller = new AbortController();
    const startedAt = Date.now();

    const promise = client.get(ENDPOINT, { signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    const error = await captureError(promise);

    expect(error.type).toBe("ABORT_ERROR");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe("리트라이", () => {
  it("503 이후 성공하면 데이터를 반환한다", async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(503))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }));
    const client = new FetchClient({ retry: noDelay });

    await expect(client.get(ENDPOINT)).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("네트워크 오류도 재시도한다", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }));
    const client = new FetchClient({ retry: noDelay });

    await expect(client.get(ENDPOINT)).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("기본 limit만큼만 재시도한다 (재시도 2회, 총 3회 요청)", async () => {
    fetchMock.mockImplementation(async () => statusResponse(503));
    const client = new FetchClient({ retry: noDelay });

    const error = await captureError(client.get(ENDPOINT));

    expect(error.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("POST는 기본적으로 재시도하지 않는다", async () => {
    fetchMock.mockImplementation(async () => statusResponse(503));
    const client = new FetchClient({ retry: noDelay });

    const error = await captureError(
      client.post(ENDPOINT, { body: { name: "item" } })
    );

    expect(error.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("재시도 대상이 아닌 상태 코드(404)는 재시도하지 않는다", async () => {
    fetchMock.mockImplementation(async () => statusResponse(404));
    const client = new FetchClient({ retry: noDelay });

    const error = await captureError(client.get(ENDPOINT));

    expect(error.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("요청 옵션의 retry: false로 재시도를 끌 수 있다", async () => {
    fetchMock.mockImplementation(async () => statusResponse(503));
    const client = new FetchClient({ retry: noDelay });

    await captureError(client.get(ENDPOINT, { retry: false }));

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("Retry-After 헤더를 delay보다 우선한다", async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(429, { "Retry-After": "0" }))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }));
    const client = new FetchClient({
      retry: { delay: () => 60_000, maxDelay: 60_000 },
    });

    await expect(client.get(ENDPOINT)).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Retry-After가 maxDelay보다 길면 재시도하지 않는다", async () => {
    fetchMock.mockImplementation(async () =>
      statusResponse(503, { "Retry-After": "120" })
    );
    const client = new FetchClient({ retry: noDelay });

    const error = await captureError(client.get(ENDPOINT));

    expect(error.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ReadableStream body는 다시 보낼 수 없으므로 재시도하지 않는다", async () => {
    fetchMock.mockImplementation(async () => statusResponse(503));
    const client = new FetchClient({ retry: noDelay });
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data"));
        controller.close();
      },
    });

    const error = await captureError(client.put(ENDPOINT, { body }));

    expect(error.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("beforeRetry는 재시도마다, onResponseError는 최종 실패 때 한 번만 호출한다", async () => {
    fetchMock.mockImplementation(async () => statusResponse(503));
    const beforeRetry = vi.fn();
    const onResponseError = vi.fn();
    const client = new FetchClient({
      retry: noDelay,
      hooks: {
        beforeRetry: [beforeRetry],
        onResponseError: [onResponseError],
      },
    });

    await captureError(client.get(ENDPOINT));

    expect(beforeRetry.mock.calls.map(([context]) => context.attempt)).toEqual(
      [1, 2]
    );
    expect(onResponseError).toHaveBeenCalledOnce();
  });

  it("shouldRetry와 beforeRetry로 401 이후 토큰을 갱신해 다시 요청한다", async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(401))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }));
    const client = new FetchClient({
      headers: { Authorization: "Bearer expired" },
      retry: {
        delay: () => 0,
        shouldRetry: ({ error, attempt }) =>
          error.status === 401 && attempt === 1,
      },
      hooks: {
        beforeRetry: [
          ({ config }) => {
            config.headers.set("Authorization", "Bearer refreshed");
          },
        ],
      },
    });

    await expect(client.post(ENDPOINT, { body: {} })).resolves.toEqual({
      id: 1,
    });

    const authorizations = requests().map((request) =>
      request.headers.get("Authorization")
    );
    expect(authorizations).toEqual(["Bearer expired", "Bearer refreshed"]);
  });
});
