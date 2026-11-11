import { z } from "zod";

export const scavioAmazonSearchSchema = z.object({
  data: z.object({
    products: z.array(z.object({
      asin: z.string().min(1),
      title: z.string().min(1),
      url: z.string().url(),
      image: z.string().url().nullish(),
      price: z.number().nonnegative().nullish(),
      currency: z.string().min(1).nullish(),
    })),
  }),
});

export type ScavioAmazonSearch = z.infer<typeof scavioAmazonSearchSchema>;
export type ScavioAmazonItem = ScavioAmazonSearch["data"]["products"][number];
