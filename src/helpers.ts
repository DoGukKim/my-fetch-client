import FetchClientError from "./fetchClientError";
import {
  FetchClientConfig,
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
  defaultConfig: FetchClientConfig
) => {
  return {
    ...defaultConfig,
    ...requestOptions,
    headers: mergeHeaders(requestOptions.headers, defaultConfig.headers),
  };
};

const isAbsoluteURL = (url: string) => {
  return url.startsWith("https://") || url.startsWith("http://");
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
  paramsSerializer?: (params: Record<string, unknown>) => string
) => {
  try {
    const fullURL = isAbsoluteURL(requestURL)
      ? new URL(requestURL)
      : new URL(requestURL, baseURL);

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
      { cause: error }
    );
  }
};

export const getContentType = (
  body: unknown,
  headers: Headers
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

export const serializeBody = (body: unknown) => {
  if (body == null) return null;

  if (
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof ReadableStream ||
    ArrayBuffer.isView(body) ||
    typeof body === "string"
  ) {
    return body;
  }

  if (typeof body === "object") {
    return JSON.stringify(body);
  }

  return null;
};

export const parseResponse = async (
  response: Response,
  responseType: ResponseType
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
    } catch {
      throw new Error(`Failed to parse JSON response: ${text.slice(0, 100)}`);
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
