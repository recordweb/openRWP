// Error with a machine-readable code; the server maps codes to HTTP statuses.
export class CoreError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CoreError';
    this.code = code;
    this.detail = detail;
  }
}