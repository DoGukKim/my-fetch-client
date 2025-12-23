import { FetchClientErrorType } from "./types";

class FetchClientError extends Error {
  constructor(
    message: string,
    readonly type: FetchClientErrorType,
    readonly response?: Response,
    readonly status?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.type = type;
    this.response = response;
    this.status = status;
  }
}

export default FetchClientError;
