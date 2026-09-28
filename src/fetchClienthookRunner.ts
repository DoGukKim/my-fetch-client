import type FetchClientError from "./fetchClientError";
import {
  FetchClientHooks,
  FetchClientMergedConfig,
  RetryContext,
} from "./types";

class FetchClientHookRunner {
  constructor(private readonly hooks: FetchClientHooks = {}) {}

  async runBeforeRequest(
    config: FetchClientMergedConfig
  ): Promise<FetchClientMergedConfig> {
    if (!this.hooks.beforeRequest?.length) return config;

    let interceptedConfig: FetchClientMergedConfig = config;
    for (const hook of this.hooks.beforeRequest) {
      interceptedConfig = await hook(interceptedConfig);
    }

    return interceptedConfig;
  }

  async runAfterResponse(
    response: Response,
    config: FetchClientMergedConfig
  ): Promise<Response> {
    if (!this.hooks.afterResponse?.length) return response;

    let interceptedResponse = response;
    for (const hook of this.hooks.afterResponse) {
      interceptedResponse = await hook(interceptedResponse, config);
    }

    return interceptedResponse;
  }

  async runBeforeRetry(context: RetryContext): Promise<void> {
    if (!this.hooks.beforeRetry) return;

    for (const hook of this.hooks.beforeRetry) {
      await hook(context);
    }
  }

  async runOnResponseError(
    error: FetchClientError,
    response: Response,
    config: FetchClientMergedConfig
  ): Promise<void> {
    if (!this.hooks.onResponseError) return;

    for (const hook of this.hooks.onResponseError) {
      await hook(error, response, config);
    }
  }

  async runOnRequestError(
    error: Error,
    config: FetchClientMergedConfig
  ): Promise<void> {
    if (!this.hooks.onRequestError) return;

    for (const hook of this.hooks.onRequestError) {
      await hook(error, config);
    }
  }
}

export default FetchClientHookRunner;
