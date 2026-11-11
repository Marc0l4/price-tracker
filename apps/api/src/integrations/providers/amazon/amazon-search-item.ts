/** Dados da busca Amazon necessários ao provider, independentes do cliente externo. */
export interface AmazonSearchItem {
  externalId: string;
  name: string;
  productUrl: string;
  imageUrl?: string;
  price?: number;
  currency?: string;
}
