import FetchClientError from "./fetchClientError";
import { mergeRetryOptions } from "./retry";
import {
  FetchClientConfig,
  FetchClientMergedConfig,
  FetchClientRequestOptions,
  ResponseType,
} from "./types";

const mergeHeaders = (...headrsList: (HeadersInit | undefined)[]) => {
  const mergedHeaders = new Headers();

  for (const headers of headrsList) {
    if (!headers) continue;

    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        mergedHeaders.set(key, value);
      });
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        mergedHeaders.set(key, value);
      });
    } else {
      Object.entries(headers).forEach(([key, value]) => {
        mergedHeaders.set(key, value);
      });
    }
  }

  return mergedHeaders;
};

export const mergeConfig = (
  requestOptions: FetchClientRequestOptions,
  defaultConfig: FetchClientConfig,
): FetchClientMergedConfig => {
  return {
    ...defaultConfig,
    ...requestOptions,
    headers: mergeHeaders(defaultConfig.headers, requestOptions.headers),
    retry: mergeRetryOptions(defaultConfig.retry, requestOptions.retry),
  };
};

const isAbsoluteURL = (url: string) => {
  return url.startsWith("https://") || url.startsWith("http://");
};

const joinURL = (baseURL: string, path: string) => {
  if (!path) return baseURL;

  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
};

const defaultSerializeParams = (params: Record<string, unknown>): string => {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;

    if (Array.isArray(value)) {
      value.forEach((v) => v != null && searchParams.append(key, String(v)));
    } else {
      searchParams.set(key, String(value));
    }
  }

  return searchParams.toString();
};

export const buildFullURL = (
  requestURL: string,
  baseURL?: string,
  params?: URLSearchParams | Record<string, unknown>,
  paramsSerializer?: (params: Record<string, unknown>) => string,
) => {
  try {
    const fullURL = new URL(
      isAbsoluteURL(requestURL) || !baseURL
        ? requestURL
        : joinURL(baseURL, requestURL),
    );

    if (params) {
      const newSearchParamsString =
        params instanceof URLSearchParams
          ? params.toString()
          : !!paramsSerializer
            ? paramsSerializer(params)
            : defaultSerializeParams(params);

      const newParams = new URLSearchParams(newSearchParamsString);
      newParams.forEach((value, key) => {
        fullURL.searchParams.append(key, value);
      });
    }

    return fullURL.toString();
  } catch (error) {
    throw new FetchClientError(
      "유효하지 않은 URL 형식입니다.",
      "URL_BUILD_ERROR",
      undefined,
      undefined,
      { cause: error },
    );
  }
};

export const getContentType = (
  body: unknown,
  headers: Headers,
): string | null => {
  if (headers.has("Content-Type") || body == null || body instanceof FormData) {
    return null;
  }

  if (body instanceof URLSearchParams) {
    return "application/x-www-form-urlencoded;charset=UTF-8";
  }

  if (body instanceof Blob) {
    return body.type || "application/octet-stream";
  }

  if (
    body instanceof ArrayBuffer ||
    body instanceof ReadableStream ||
    ArrayBuffer.isView(body)
  ) {
    return "application/octet-stream";
  }

  if (typeof body === "string") {
    return "text/plain;charset=UTF-8";
  }

  if (typeof body === "object") {
    return "application/json;charset=UTF-8";
  }

  return null;
};

export const serializeBody = (body: unknown): BodyInit | null => {
  if (body == null) return null;

  if (ArrayBuffer.isView(body)) {
    return body as ArrayBufferView<ArrayBuffer>;
  }

  if (
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof ReadableStream ||
    typeof body === "string"
  ) {
    return body;
  }

  if (typeof body === "object") {
    return JSON.stringify(body);
  }

  return null;
};

export const buildRequest = (
  url: string,
  { body, ...init }: Omit<RequestInit, "body"> & { body?: unknown },
): Request => {
  try {
    const requestInit: RequestInit & { duplex?: "half" } = {
      ...init,
      body: serializeBody(body),
    };
    // 스트림 body는 Node와 Chrome에서 duplex를 지정해야 보낼 수 있다. lib.dom 타입에는 아직 없다.
    if (requestInit.body instanceof ReadableStream) {
      requestInit.duplex = "half";
    }

    return new Request(url, requestInit);
  } catch (error) {
    throw new FetchClientError(
      "요청을 생성할 수 없습니다.",
      "REQUEST_BUILD_ERROR",
      undefined,
      undefined,
      { cause: error },
    );
  }
};

export const parseResponse = async (
  response: Response,
  responseType: ResponseType,
): Promise<unknown> => {
  const contentLength = response.headers.get("content-length");
  if (response.status === 204 || contentLength === "0") {
    return null;
  }

  if (responseType === "json" || !responseType) {
    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new FetchClientError(
        `Failed to parse JSON response: ${text.slice(0, 100)}`,
        "PARSE_ERROR",
        response,
        response.status,
        { cause: error },
      );
    }
  }

  switch (responseType) {
    case "text":
      return await response.text();
    case "blob":
      return await response.blob();
    case "arrayBuffer":
      return await response.arrayBuffer();
    case "formData":
      return await response.formData();
    default:
      return await response.text();
  }
};

export const readErrorBody = async (response: Response): Promise<unknown> => {
  try {
    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
};

export const combineSignals = (
  ...signals: (AbortSignal | null | undefined)[]
): AbortSignal | undefined => {
  const activeSignals = signals.filter(
    (signal): signal is AbortSignal => !!signal,
  );
  if (activeSignals.length <= 1) return activeSignals[0];

  return AbortSignal.any(activeSignals);
};

export const toRequestError = (
  error: unknown,
  userSignal?: AbortSignal | null,
  timeoutSignal?: AbortSignal,
): FetchClientError => {
  if (userSignal?.aborted) {
    if (error instanceof FetchClientError && error.type === "ABORT_ERROR") {
      return error;
    }

    return new FetchClientError(
      "요청이 취소되었습니다.",
      "ABORT_ERROR",
      undefined,
      undefined,
      { cause: userSignal.reason },
    );
  }

  if (timeoutSignal?.aborted) {
    return new FetchClientError(
      "요청 시간이 초과되었습니다.",
      "TIMEOUT_ERROR",
      undefined,
      undefined,
      { cause: timeoutSignal.reason },
    );
  }

  return new FetchClientError(
    "네트워크 오류가 발생했습니다.",
    "NETWORK_ERROR",
    undefined,
    undefined,
    { cause: error },
  );
};

const NETWORK_ERROR_MESSAGES = new Set([
  "network error",
  "NetworkError when attempting to fetch resource.",
  "The Internet connection appears to be offline.",
  "Network request failed",
  "fetch failed",
  "terminated",
  " A network error occurred.",
  "Network connection lost",
]);

const matchesMessage = (message: string, expected: string) =>
  message === expected ||
  (message.startsWith(`${expected} (`) && message.endsWith(")"));

export const isNetworkError = (error: unknown): error is TypeError => {
  if (!(error instanceof TypeError)) return false;

  const { message } = error;

  if (matchesMessage(message, "Load failed")) {
    return error.stack === undefined;
  }

  return (
    matchesMessage(message, "Failed to fetch") ||
    message.startsWith("error sending request for url") ||
    NETWORK_ERROR_MESSAGES.has(message)
  );
};

export const toParseError = (
  error: unknown,
  response: Response,
  userSignal?: AbortSignal | null,
  timeoutSignal?: AbortSignal,
): FetchClientError => {
  if (error instanceof FetchClientError) return error;

  if (userSignal?.aborted || timeoutSignal?.aborted || isNetworkError(error)) {
    return toRequestError(error, userSignal, timeoutSignal);
  }

  return new FetchClientError(
    "응답 본문을 처리할 수 없습니다.",
    "PARSE_ERROR",
    response,
    response.status,
    { cause: error },
  );
};
