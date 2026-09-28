import FetchClientError from "./fetchClientError";
import FetchClientHookRunner from "./fetchClienthookRunner";
import {
  buildFullURL,
  mergeConfig,
  getContentType,
  serializeBody,
  parseResponse,
  readErrorBody,
  combineSignals,
  toRequestError,
} from "./helpers";
import {
  getRetryDelay,
  resolveRetryOptions,
  shouldRetryRequest,
  sleep,
} from "./retry";
import {
  FetchClientConfig,
  FetchClientMergedConfig,
  FetchClientRequestOptions,
} from "./types";

const DEFAULT_TIMEOUT = 10_000;

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
    let config = mergeConfig(options, this.defaultConfig);

    try {
      config = await this.hooks.runBeforeRequest(config);
      const retryOptions = resolveRetryOptions(config.retry);

      for (let attempt = 1; ; attempt++) {
        try {
          return await this.send<TResponse>(url, config);
        } catch (error) {
          if (!(error instanceof FetchClientError)) throw error;

          const context = { error, attempt, config };
          if (!(await shouldRetryRequest(context, retryOptions))) throw error;

          const delay = getRetryDelay(error, attempt, retryOptions);
          if (delay === undefined) throw error;

          await sleep(delay, config.signal);
          await this.hooks.runBeforeRetry(context);
        }
      }
    } catch (error) {
      const finalError = config.signal?.aborted
        ? toRequestError(error, config.signal)
        : error;

      if (finalError instanceof FetchClientError) {
        if (finalError.type === "HTTP_ERROR") {
          await this.hooks.runOnResponseError(
            finalError,
            finalError.response!,
            config
          );
        } else if (finalError.type !== "ABORT_ERROR") {
          await this.hooks.runOnRequestError(finalError, config);
        }
      } else if (finalError instanceof Error) {
        await this.hooks.runOnRequestError(finalError, config);
      }

      throw finalError;
    }
  }

  private async send<TResponse>(
    url: string,
    config: FetchClientMergedConfig
  ): Promise<TResponse> {
    const {
      baseURL,
      params,
      paramsSerializer,
      responseType = "json",
      body,
      headers,
      hooks: _hooks,
      retry: _retry,
      timeout = DEFAULT_TIMEOUT,
      signal,
      ...restConfig
    } = config;
    const fullURL = buildFullURL(url, baseURL, params, paramsSerializer);

    const requestHeaders = new Headers(headers);
    const contentType = getContentType(body, requestHeaders);
    if (contentType) {
      requestHeaders.set("Content-Type", contentType);
    }

    const serializedBody = serializeBody(body) as any;
    const timeoutSignal = timeout ? AbortSignal.timeout(timeout) : undefined;

    let rawResponse: Response;
    try {
      rawResponse = await fetch(fullURL, {
        ...restConfig,
        body: serializedBody,
        headers: requestHeaders,
        signal: combineSignals(signal, timeoutSignal),
      });
    } catch (error) {
      throw toRequestError(error, signal, timeoutSignal);
    }

    const response = await this.hooks.runAfterResponse(rawResponse, config);

    if (!response.ok) {
      throw new FetchClientError(
        `HTTP Error ${response.status}`,
        "HTTP_ERROR",
        response,
        response.status,
        { cause: await readErrorBody(response) }
      );
    }

    try {
      return (await parseResponse(response, responseType)) as TResponse;
    } catch (error) {
      if (error instanceof FetchClientError) throw error;
      throw toRequestError(error, signal, timeoutSignal);
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
