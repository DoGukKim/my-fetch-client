import type FetchClientError from "./fetchClientError";
import { RetryContext, RetryOptions } from "./types";

type RetryConfig = number | false | RetryOptions;

type ResolvedRetryOptions = Required<Omit<RetryOptions, "shouldRetry">> &
  Pick<RetryOptions, "shouldRetry">;

export const DEFAULT_RETRY: ResolvedRetryOptions = {
  limit: 2,
  methods: ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"],
  statusCodes: [408, 429, 500, 502, 503, 504],
  delay: (attempt) => {
    const backoff = 300 * 2 ** (attempt - 1);
    return backoff / 2 + Math.random() * (backoff / 2);
  },
  maxDelay: 10_000,
};

const toRetryOptions = (retry?: RetryConfig): RetryOptions => {
  if (retry === undefined) return {};
  if (retry === false) return { limit: 0 };
  if (typeof retry === "number") return { limit: retry };

  return Object.fromEntries(
    Object.entries(retry).filter(([, value]) => value !== undefined)
  );
};

export const mergeRetryOptions = (
  defaultRetry?: RetryConfig,
  requestRetry?: RetryConfig
): RetryOptions => ({
  ...toRetryOptions(defaultRetry),
  ...toRetryOptions(requestRetry),
});

export const resolveRetryOptions = (
  retry?: RetryConfig
): ResolvedRetryOptions => ({
  ...DEFAULT_RETRY,
  ...toRetryOptions(retry),
});

export const shouldRetryRequest = async (
  context: RetryContext,
  options: ResolvedRetryOptions
): Promise<boolean> => {
  const { error, attempt, config } = context;

  if (attempt > options.limit) return false;
  if (error.type === "ABORT_ERROR" || config.signal?.aborted) return false;
  if (config.body instanceof ReadableStream) return false;

  if (options.shouldRetry) return options.shouldRetry(context);

  if (!options.methods.includes(config.method ?? "GET")) return false;
  if (error.type === "NETWORK_ERROR" || error.type === "TIMEOUT_ERROR") {
    return true;
  }

  return (
    error.type === "HTTP_ERROR" &&
    error.status !== undefined &&
    options.statusCodes.includes(error.status)
  );
};

export const parseRetryAfter = (
  value: string | null | undefined
): number | undefined => {
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;

  return Math.max(0, date - Date.now());
};

export const getRetryDelay = (
  error: FetchClientError,
  attempt: number,
  options: ResolvedRetryOptions
): number | undefined => {
  const retryAfter = parseRetryAfter(
    error.response?.headers.get("Retry-After")
  );
  if (retryAfter !== undefined) {
    return retryAfter <= options.maxDelay ? retryAfter : undefined;
  }

  return Math.min(options.delay(attempt), options.maxDelay);
};

export const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
