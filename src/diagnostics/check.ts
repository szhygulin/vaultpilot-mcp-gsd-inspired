export interface RunCheckOptions {
  json: boolean;
}

export function runCheck(_opts: RunCheckOptions): Promise<number> {
  throw new Error("runCheck not yet implemented — lands in plan 01-03");
}
