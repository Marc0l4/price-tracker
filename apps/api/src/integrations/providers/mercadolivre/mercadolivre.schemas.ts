import { z } from "zod";

const attributeSchema = z.object({
  id: z.string(),
  value_name: z.string().nullable().optional(),
});

export const mercadoLivreSearchSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      price: z.number().nonnegative(),
      currency_id: z.string(),
      permalink: z.string().url(),
      thumbnail: z.string().url().optional(),
      available_quantity: z.number().nonnegative().optional(),
      shipping: z.object({ free_shipping: z.boolean().optional() }).optional(),
      seller: z.object({ nickname: z.string().optional() }).optional(),
      attributes: z.array(attributeSchema).optional(),
    }).passthrough(),
  ),
}).passthrough();

export type MercadoLivreSearchResponse = z.infer<typeof mercadoLivreSearchSchema>;
export type MercadoLivreSearchItem = MercadoLivreSearchResponse["results"][number];
