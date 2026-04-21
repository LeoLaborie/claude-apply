export class AddCompanyError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'AddCompanyError';
    this.code = code;
    this.details = details;
  }
}
