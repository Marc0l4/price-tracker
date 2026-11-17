import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { createReadApiServer } from "../../src/http/read-api.server.js";
import { ReadApiError } from "../../src/read/read-errors.js";

async function serverFor(trustProxy: boolean, capture: (address: string) => void) {
  const server = createReadApiServer({} as PrismaClient, {
    corsOrigin: "http://localhost:3000",
    onDemandTrustProxy: trustProxy,
    onDemandSearch: {
      async search(_query, _page, _limit, _currency, _sort, address) {
        capture(address);
        throw new ReadApiError(429, "on_demand_rate_limited", "Rate limit.", 60);
      },
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server unavailable.");
  return { server, url: `http://127.0.0.1:${address.port}/products?query=playstation%205` };
}

describe("trusted client address", () => {
  it("uses CF-Connecting-IP instead of a spoofable X-Forwarded-For chain on Render", async () => {
    let clientAddress = "";
    const { server, url } = await serverFor(true, (address) => { clientAddress = address; });
    try {
      const response = await fetch(url, { headers: {
        "X-Forwarded-For": "203.0.113.99, 10.0.0.1",
        "CF-Connecting-IP": "198.51.100.24",
      } });
      expect(response.status).toBe(429);
      expect(clientAddress).toBe("198.51.100.24");
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it("ignores client-provided proxy headers when trust proxy is disabled", async () => {
    let clientAddress = "";
    const { server, url } = await serverFor(false, (address) => { clientAddress = address; });
    try {
      const response = await fetch(url, { headers: {
        "X-Forwarded-For": "203.0.113.99",
        "CF-Connecting-IP": "198.51.100.24",
      } });
      expect(response.status).toBe(429);
      expect(clientAddress).not.toBe("203.0.113.99");
      expect(clientAddress).not.toBe("198.51.100.24");
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
