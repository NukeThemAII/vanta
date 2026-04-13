export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class BootstrapError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BootstrapError";
  }
}

export class ExecutionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExecutionError";
  }
}

export class ExecutionGateError extends ExecutionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExecutionGateError";
  }
}

export class OrderFormattingError extends ExecutionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OrderFormattingError";
  }
}
