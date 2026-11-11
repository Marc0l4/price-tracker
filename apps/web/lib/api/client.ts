export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "ApiError"; }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${publicApiBaseUrl()}${path}`, { signal, headers: { Accept: "application/json" } });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "object" && body.error !== null && "message" in body.error && typeof body.error.message === "string"
      ? body.error.message : "Não foi possível carregar os dados.";
    throw new ApiError(response.status, message);
  }
  return body as T;
}
import { publicApiBaseUrl } from "../environment";
