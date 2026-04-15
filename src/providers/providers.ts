import { BciScraper } from "../scrapers/bci.scraper";
import { BancoChileScraper } from "../scrapers/bancochile.scraper";
import { CencosudScotiaScraper } from "../scrapers/cencosudscotia.scraper";
import { FalabellaScraper } from "../scrapers/falabella.scraper";
import { SantanderScraper } from "../scrapers/santander.scraper";
import { Provider } from "./provider.types";

export const providers: Provider[] = [
  {
    slug: "cencosudscotia",
    name: "Tarjeta Cencosud Scotiabank",
    bankName: "Tarjeta Cencosud Scotiabank",
    country: "CL",
    sourceUrl: "https://www.tarjetacencosud.cl/publico/beneficios/landing/inicio",
    expectedMinRawBenefits: 120,
    minSafePersistRatio: 0.75,
    scraper: new CencosudScotiaScraper(),
  },
  {
    slug: "bancochile",
    name: "Banco de Chile",
    bankName: "Banco de Chile",
    country: "CL",
    sourceUrl: "https://sitiospublicos.bancochile.cl/personas/beneficios/categoria#todos",
    expectedMinRawBenefits: 700,
    minSafePersistRatio: 0.8,
    scraper: new BancoChileScraper(),
  },
  {
    slug: "bci",
    name: "Bci",
    bankName: "Bci",
    country: "CL",
    sourceUrl: "https://www.bci.cl/beneficios/beneficios-bci/todas",
    expectedMinRawBenefits: 180,
    minSafePersistRatio: 0.7,
    scraper: new BciScraper(),
  },
  {
    slug: "falabella",
    name: "Banco Falabella",
    bankName: "Banco Falabella",
    country: "CL",
    sourceUrl: "https://www.bancofalabella.cl/descuentos",
    expectedMinRawBenefits: 120,
    minSafePersistRatio: 0.7,
    scraper: new FalabellaScraper(),
  },
  {
    slug: "santander",
    name: "Santander",
    bankName: "Santander",
    country: "CL",
    sourceUrl: "https://banco.santander.cl/beneficios/promociones/",
    // Santander now uses a local monthly PDF, so the expected raw volume is lower than the old web scrape.
    expectedMinRawBenefits: 60,
    minSafePersistRatio: 0.5,
    scraper: new SantanderScraper(),
  },
];

export const findProviderBySlug = (providerSlug: string): Provider | undefined =>
  providers.find((provider) => provider.slug === providerSlug);
