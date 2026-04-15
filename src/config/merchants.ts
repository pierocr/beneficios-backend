import { BenefitCategory } from "../types/benefit.types";

export interface MerchantCatalogEntry {
  slug: string;
  canonicalName: string;
  categoryName: BenefitCategory;
  aliases: string[];
}

export const MERCHANT_CATALOG: MerchantCatalogEntry[] = [
  {
    slug: "juan-maestro",
    canonicalName: "Juan Maestro",
    categoryName: "comida_rapida",
    aliases: ["juan maestro"],
  },
  {
    slug: "dominos-pizza",
    canonicalName: "Domino's Pizza",
    categoryName: "comida_rapida",
    aliases: ["domino's pizza", "dominos pizza", "domino"],
  },
  {
    slug: "caffe-pascucci",
    canonicalName: "Caffe Pascucci",
    categoryName: "cafeterias",
    aliases: ["caffe pascucci", "pascucci"],
  },
  {
    slug: "mcdonalds",
    canonicalName: "McDonald's",
    categoryName: "comida_rapida",
    aliases: ["mcdonald's", "mcdonalds", "mc donalds"],
  },
  {
    slug: "doggis",
    canonicalName: "Doggis",
    categoryName: "comida_rapida",
    aliases: ["doggis"],
  },
  {
    slug: "metro-tren-nos",
    canonicalName: "Metro y Tren Nos",
    categoryName: "movilidad",
    aliases: ["metro", "tren nos", "metro y tren nos"],
  },
  {
    slug: "disney-on-ice",
    canonicalName: "Disney On Ice",
    categoryName: "entretencion",
    aliases: ["disney on ice"],
  },
  {
    slug: "hasbro-family-fest",
    canonicalName: "Hasbro Family Fest",
    categoryName: "entretencion",
    aliases: ["hasbro family fest", "hasbro"],
  },
  {
    slug: "leyendas-luces-y-baile",
    canonicalName: "Leyendas: Luces y Baile",
    categoryName: "entretencion",
    aliases: ["leyendas: luces y baile", "leyendas luces y baile", "leyendas"],
  },
  {
    slug: "starbucks",
    canonicalName: "Starbucks",
    categoryName: "cafeterias",
    aliases: ["starbucks"],
  },
  {
    slug: "mercado-libre",
    canonicalName: "Mercado Libre",
    categoryName: "retail",
    aliases: ["mercado libre"],
  },
  {
    slug: "papa-johns",
    canonicalName: "Papa John's",
    categoryName: "comida_rapida",
    aliases: ["papa john's", "papa johns"],
  },
  {
    slug: "viajes-bci",
    canonicalName: "Viajes Bci",
    categoryName: "viajes",
    aliases: ["viajes bci"],
  },
  {
    slug: "china-365",
    canonicalName: "China 365",
    categoryName: "restaurantes",
    aliases: ["china 365"],
  },
];
