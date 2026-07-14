export class ApplicationError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 503,
    readonly code: string,
    readonly title: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'ApplicationError';
  }
}
