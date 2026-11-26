// Types for the tests that drive the import CLI's exported helpers.
export type ImportArgs = { apply: boolean; file: string; serverUrl: string; tokenFile: string; team: string; batchBytes: number };
export type ImportThread = Record<string, unknown> & { import_id: string; message: string; replies: Record<string, unknown>[] };
export type ParsedExport = { channels: Record<string, unknown>[]; threads: ImportThread[]; summary: Record<string, unknown> };
export type ImportBatch = { channels: unknown[]; posts: unknown[] };
export type ImportTotals = Record<string, number> & { unmapped_users: string[] };

export function main(argv: string[], env: Record<string, string | undefined>): Promise<unknown>;
export function parseArgs(values: string[]): ImportArgs;
export function readToken(args: Pick<ImportArgs, 'tokenFile'>, env: Record<string, string | undefined>): Promise<string>;
export function readExport(file: string, options?: { team?: string }): Promise<ParsedExport>;
export function toBatches(parsed: Pick<ParsedExport, 'channels' | 'threads'> | { channels: unknown[]; threads: unknown[] }, batchBytes?: number): ImportBatch[];
export function sendBatches(
  url: URL,
  token: string,
  batches: ImportBatch[],
  dryRun: boolean,
  fetchImpl?: (url: URL, init: RequestInit) => Promise<Response> | Response
): Promise<ImportTotals>;
