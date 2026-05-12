export type LogLevel = "debug" | "info" | "warn" | "error";

export function log(level: LogLevel, msg: string): void {
  process.stderr.write(`[${level}] ${msg}\n`);
}
