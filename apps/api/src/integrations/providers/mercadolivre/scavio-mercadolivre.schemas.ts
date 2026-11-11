import { z } from "zod";

export const scavioMercadoLivreSearchSchema = z.object({
  data: z.object({
    results: z.array(z.object({
      item_id: z.string().min(1), product_id: z.string().min(1).nullish(),
      title: z.string().min(1), url: z.string().url(),
      price: z.number().nonnegative().nullish(), currency: z.string().min(1).nullish(),
      image: z.string().url().nullish(), thumbnail: z.string().url().nullish(), brand: z.string().nullish(),
      seller: z.object({ name: z.string().nullish() }).nullish(),
      free_shipping: z.boolean().nullish(),
    })),
  }),
});

export type ScavioMercadoLivreItem = z.infer<typeof scavioMercadoLivreSearchSchema>["data"]["results"][number];
