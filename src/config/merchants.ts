import { BenefitCategory } from "../types/benefit.types";

export interface MerchantCatalogEntry {
  slug: string;
  canonicalName: string;
  categoryName: BenefitCategory;
  aliases: string[];
}

export const MERCHANT_CATALOG: MerchantCatalogEntry[] = [
  {
    slug: "burger-king",
    canonicalName: "Burger King",
    categoryName: "comida_rapida",
    aliases: ["burger king", "bk"],
  },
  {
    slug: "kfc",
    canonicalName: "KFC",
    categoryName: "comida_rapida",
    aliases: ["kfc", "kentucky fried chicken"],
  },
  {
    slug: "subway",
    canonicalName: "Subway",
    categoryName: "comida_rapida",
    aliases: ["subway"],
  },
  {
    slug: "pizza-hut",
    canonicalName: "Pizza Hut",
    categoryName: "comida_rapida",
    aliases: ["pizza hut"],
  },
  {
    slug: "telepizza",
    canonicalName: "Telepizza",
    categoryName: "comida_rapida",
    aliases: ["telepizza"],
  },
  {
    slug: "little-caesars",
    canonicalName: "Little Caesars",
    categoryName: "comida_rapida",
    aliases: ["little caesars", "little caesar's"],
  },
  {
    slug: "wendys",
    canonicalName: "Wendy's",
    categoryName: "comida_rapida",
    aliases: ["wendy's", "wendys"],
  },
  {
    slug: "taco-bell",
    canonicalName: "Taco Bell",
    categoryName: "comida_rapida",
    aliases: ["taco bell"],
  },
  {
    slug: "melt-pizzas",
    canonicalName: "Melt Pizzas",
    categoryName: "comida_rapida",
    aliases: ["melt pizzas", "melt"],
  },
  {
    slug: "tommy-beans",
    canonicalName: "Tommy Beans",
    categoryName: "comida_rapida",
    aliases: ["tommy beans"],
  },
  {
    slug: "dunkin",
    canonicalName: "Dunkin'",
    categoryName: "cafeterias",
    aliases: ["dunkin", "dunkin'"],
  },
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
