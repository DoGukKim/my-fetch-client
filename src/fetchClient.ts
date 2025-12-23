import FetchClientError from "./fetchClientError";
import FetchClientHookRunner from "./fetchClienthookRunner";
import {
  buildFullURL,
  mergeConfig,
  getContentType,
  serializeBody,
  parseResponse,
} from "./helpers";
import {
  FetchClientConfig,
  FetchClientMergedConfig,
  FetchClientRequestOptions,
} from "./types";

class FetchClient {
  private readonly defaultConfig: FetchClientConfig;
  private readonly hooks: FetchClientHookRunner;

  constructor(defaultConfig: FetchClientConfig = {}) {
    this.defaultConfig = defaultConfig;
    this.hooks = new FetchClientHookRunner(this.defaultConfig.hooks);
  }

  private async request<TBody, TResponse>(
    url: string,
    options: FetchClientRequestOptions<TBody>
  ): Promise<TResponse> {
    const mergedConfig = mergeConfig(options, this.defaultConfig);
    let interceptedConfig: FetchClientMergedConfig = mergedConfig;

    try {
      interceptedConfig = await this.hooks.runBeforeRequest(mergedConfig);
      const {
        baseURL,
        params,
        paramsSerializer,
        responseType = "json",
        body,
        headers,
        ...restConfig
      } = interceptedConfig;
      const fullURL = buildFullURL(url, baseURL, params, paramsSerializer);

      const requestHeaders = new Headers(headers);
      const contentType = getContentType(body, requestHeaders);
      if (contentType) {
        requestHeaders.set("Content-Type", contentType);
      }

      const serializedBody = serializeBody(body) as any;

      const rawResponse = await fetch(fullURL, {
        ...restConfig,
        body: serializedBody,
        headers: requestHeaders,
      });

      const hookResponse = await this.hooks.runAfterResponse(
        rawResponse.clone(),
        interceptedConfig
      );

      const parsedResponse = await parseResponse(hookResponse, responseType);

      if (!hookResponse.ok) {
        throw new FetchClientError(
          `HTTP Error ${hookResponse.status}`,
          "HTTP_ERROR",
          hookResponse,
          hookResponse.status,
          { cause: parsedResponse }
        );
      }

      return parsedResponse as TResponse;
    } catch (error) {
      if (error instanceof FetchClientError) {
        await this.hooks.runOnResponseError(
          error,
          error.response!,
          interceptedConfig
        );
      } else if (error instanceof Error) {
        await this.hooks.runOnRequestError(error, interceptedConfig);
      }

      throw error;
    }
  }

  async get<TResponse = unknown>(
    url: string,
    options?: FetchClientRequestOptions
  ) {
    return this.request<unknown, TResponse>(url, { method: "GET", ...options });
  }

  async post<TBody = unknown, TResponse = unknown>(
    url: string,
    options?: FetchClientRequestOptions<TBody>
  ) {
    return this.request<TBody, TResponse>(url, {
      method: "POST",
      ...options,
    });
  }

  async put<TBody = unknown, TResponse = unknown>(
    url: string,
    options?: FetchClientRequestOptions<TBody>
  ) {
    return this.request<TBody, TResponse>(url, {
      method: "PUT",
      ...options,
    });
  }

  async delete<TBody = unknown, TResponse = unknown>(
    url: string,
    options?: FetchClientRequestOptions<TBody>
  ) {
    return this.request<TBody, TResponse>(url, {
      method: "DELETE",
      ...options,
    });
  }

  async patch<TBody = unknown, TResponse = unknown>(
    url: string,
    options?: FetchClientRequestOptions<TBody>
  ) {
    return this.request<TBody, TResponse>(url, {
      method: "PATCH",
      ...options,
    });
  }

  async options<TResponse = unknown>(
    url: string,
    options?: FetchClientRequestOptions
  ) {
    return this.request<unknown, TResponse>(url, {
      method: "OPTIONS",
      ...options,
    });
  }

  async head<TResponse = unknown>(
    url: string,
    options?: FetchClientRequestOptions
  ) {
    return this.request<unknown, TResponse>(url, {
      method: "HEAD",
      ...options,
    });
  }
}

export default FetchClient;
