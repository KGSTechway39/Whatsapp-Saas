type LogLevel = "info" | "warn" | "error" | "debug";

interface LogContext {
  userId?:  string;
  route?:   string;
  method?:  string;
  status?:  number;
  duration?: number;
  [key: string]: unknown;
}

function log(level: LogLevel, message: string, context?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    env: process.env.NODE_ENV,
    ...context,
  };

  // In production you'd ship this to Datadog / Sentry / Logtail
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(entry));
}

export const logger = {
  info:  (msg: string, ctx?: LogContext) => log("info",  msg, ctx),
  warn:  (msg: string, ctx?: LogContext) => log("warn",  msg, ctx),
  error: (msg: string, ctx?: LogContext) => log("error", msg, ctx),
  debug: (msg: string, ctx?: LogContext) => {
    if (process.env.NODE_ENV !== "production") log("debug", msg, ctx);
  },
};

/** Wrap an unknown error into a loggable string */
export function errorMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}
