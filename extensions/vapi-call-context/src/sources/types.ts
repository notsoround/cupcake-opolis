export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SourceContext = {
  fetchImpl: FetchLike;
  signal: AbortSignal;
  nowMs: number;
};

export class SourceDisabledError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SourceDisabledError";
  }
}

export async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${label} responded HTTP ${response.status}`);
  }
  return (await response.json()) as unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}
