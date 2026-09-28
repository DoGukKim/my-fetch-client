import type FetchClientError from "./fetchClientError";

export interface FetchClientConfig {
  baseURL?: string;
  headers?: HeadersInit;
  hooks?: FetchClientHooks;
  timeout?: number | false;
  retry?: number | false | RetryOptions;
}

export type ResponseType =
  | "json"
  | "text"
  | "blob"
  | "arrayBuffer"
  | "formData";
export type RequestMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "OPTIONS"
  | "HEAD";
export interface FetchClientRequestOptions<TBody = unknown>
  extends Omit<RequestInit, "body" | "method"> {
  method?: RequestMethod;
  body?: TBody;
  responseType?: ResponseType;
  params?: URLSearchParams | Record<string, unknown>;
  paramsSerializer?: (params: Record<string, unknown>) => string;
  timeout?: number | false;
  retry?: number | false | RetryOptions;
}
export type FetchClientMergedConfig = Omit<
  FetchClientConfig & FetchClientRequestOptions,
  "headers"
> & {
  headers: Headers;
};

export type FetchClientErrorType =
  | "URL_BUILD_ERROR"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT_ERROR"
  | "ABORT_ERROR"
  | "PARSE_ERROR";

export interface RetryOptions {
  limit?: number;
  methods?: RequestMethod[];
  statusCodes?: number[];
  delay?: (attempt: number) => number;
  maxDelay?: number;
  shouldRetry?: (context: RetryContext) => boolean | Promise<boolean>;
}

export interface RetryContext {
  error: FetchClientError;
  attempt: number;
  config: FetchClientMergedConfig;
}

export interface FetchClientHooks {
  beforeRequest?: ((
    config: FetchClientMergedConfig
  ) => FetchClientMergedConfig | Promise<FetchClientMergedConfig>)[];
  afterResponse?: ((
    response: Response,
    config: FetchClientMergedConfig
  ) => Response | Promise<Response>)[];
  beforeRetry?: ((context: RetryContext) => void | Promise<void>)[];
  onResponseError?: ((
    error: FetchClientError,
    response: Response,
    config: FetchClientMergedConfig
  ) => void | Promise<void>)[];
  onRequestError?: ((
    error: Error,
    config: FetchClientMergedConfig
  ) => void | Promise<void>)[];
}
