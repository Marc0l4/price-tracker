type PublicEnvironment = Record<string, string | undefined>;

export function publicApiBaseUrl(environment?: PublicEnvironment): string {
  // Next.js only inlines NEXT_PUBLIC_* when the property is accessed directly.
  const value = environment === undefined
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : environment.NEXT_PUBLIC_API_BASE_URL;
  if (!value?.trim()) throw new Error("NEXT_PUBLIC_API_BASE_URL é obrigatória.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("NEXT_PUBLIC_API_BASE_URL deve ser uma URL HTTP válida."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("NEXT_PUBLIC_API_BASE_URL deve usar HTTP ou HTTPS.");
  return url.toString().replace(/\/$/, "");
}
