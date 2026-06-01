import { createHash, randomUUID } from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  msg: string;
  service?: string;
  correlationId?: string;
  route?: string;
  tool?: string;
  userIdHash?: string;
  [key: string]: unknown;
}

/** One-way hash of a user ID so logs are traceable without leaking PII. */
export function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

export function generateCorrelationId(): string {
  return randomUUID();
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  private readonly ctx: Record<string, unknown>;
  private readonly minLevel: number;

  constructor(ctx: Record<string, unknown> = {}) {
    this.ctx = ctx;
    const envLevel = (process.env.LOG_LEVEL ?? "info") as LogLevel;
    this.minLevel = LEVEL_RANK[envLevel] ?? LEVEL_RANK.info;
  }

  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.ctx, ...extra });
  }

  private write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < this.minLevel) return;
    const record: LogRecord = { timestamp: new Date().toISOString(), level, ...this.ctx, ...extra, msg };
    const line = JSON.stringify(record) + "\n";
    if (level === "error") process.stderr.write(line);
    else process.stdout.write(line);
  }

  debug(msg: string, extra?: Record<string, unknown>): void { this.write("debug", msg, extra); }
  info(msg: string, extra?: Record<string, unknown>): void { this.write("info", msg, extra); }
  warn(msg: string, extra?: Record<string, unknown>): void { this.write("warn", msg, extra); }
  error(msg: string, extra?: Record<string, unknown>): void { this.write("error", msg, extra); }
}

export function createLogger(ctx: Record<string, unknown> = {}): Logger {
  return new Logger({ service: "truerate", ...ctx });
}
