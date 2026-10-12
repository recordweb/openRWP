// Error with a stable machine-readable code (used by the CLI for exit messages).
export class ClientError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ClientError';
    this.code = code;
  }
}