export class ApplicationError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503,
    readonly code: string,
    readonly title: string,
    readonly detail: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(detail);
    this.name = 'ApplicationError';
  }
}
