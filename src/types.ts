export interface FetchClientConfig {
  baseURL?: string;
  headers?: HeadersInit;
  hooks?: FetchClientHooks;
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
}
export type FetchClientMergedConfig = FetchClientConfig &
  FetchClientRequestOptions;

export type FetchClientErrorType =
  | "URL_BUILD_ERROR"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT_ERROR";

export interface FetchClientHooks {
  beforeRequest?: ((
    config: FetchClientMergedConfig
  ) => FetchClientMergedConfig | Promise<FetchClientMergedConfig>)[];
  afterResponse?: ((
    response: Response,
    config: FetchClientMergedConfig
  ) => Response | Promise<Response>)[];
  onResponseError?: ((
    error: Error,
    response: Response,
    config: FetchClientMergedConfig
  ) => Promise<void>)[];
  onRequestError?: ((
    error: Error,
    config: FetchClientMergedConfig
  ) => Promise<void>)[];
}
