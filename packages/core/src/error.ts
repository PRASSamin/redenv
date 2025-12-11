export type RedenvErrorCode =
  // Configuration Errors
  | "MISSING_CONFIG"
  | "INVALID_CONFIG"
  | "INVALID_TOKEN_ID"
  | "PROJECT_NOT_FOUND"
  // Cryptography Errors
  | "MISSING_KEY"
  | "DECRYPTION_FAILED"
  | "ENCRYPTION_FAILED"
  | "INVALID_KEY_FORMAT"
  // Network/Server Errors
  | "NETWORK_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "SERVER_ERROR"
  // Data Errors
  | "SECRET_NOT_FOUND"
  | "INVALID_SECRET_VALUE"
  // plugin errors
  | "BROKEN_PLUGIN"
  // Generic
  | "PROMPT_CANCELLED"
  | "UNKNOWN_ERROR";

export class RedenvError extends Error {
  public code: RedenvErrorCode;
  public context?: Record<string, any>;

  constructor(
    message: string,
    code: RedenvErrorCode = "UNKNOWN_ERROR",
    context?: Record<string, any>
  ) {
    super(message);
    this.name = "RedenvError";
    this.code = code;
    this.context = context;

    // Restore prototype chain for proper instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack,
    };
  }
}
