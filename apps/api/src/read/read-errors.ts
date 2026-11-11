export class ReadApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReadApiError";
  }
}

export const notFound = (resource: "product" | "offer") =>
  new ReadApiError(404, `${resource}_not_found`, `${resource === "product" ? "Produto" : "Oferta"} não encontrado(a).`);
