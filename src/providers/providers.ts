import { BciScraper } from "../scrapers/bci.scraper";
import { BancoChileScraper } from "../scrapers/bancochile.scraper";
import { CencosudScotiaScraper } from "../scrapers/cencosudscotia.scraper";
import { FalabellaScraper } from "../scrapers/falabella.scraper";
import { ItauScraper } from "../scrapers/itau.scraper";
import { ScotiabankScraper } from "../scrapers/scotiabank.scraper";
import { SantanderScraper } from "../scrapers/santander.scraper";
import { TenpoScraper } from "../scrapers/tenpo.scraper";
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
    slug: "itau",
    name: "Itaú",
    bankName: "Itaú",
    country: "CL",
    sourceUrl: "https://itaubeneficios.cl/beneficios/",
    expectedMinRawBenefits: 120,
    minSafePersistRatio: 0.7,
    scraper: new ItauScraper(),
  },
  {
    slug: "scotiabank",
    name: "Scotiabank",
    bankName: "Scotiabank",
    country: "CL",
    sourceUrl: "https://www.scotiarewards.cl/scclubfront/categoria/mundos/descuentos",
    expectedMinRawBenefits: 110,
    minSafePersistRatio: 0.7,
    scraper: new ScotiabankScraper(),
  },
  {
    slug: "santander",
    name: "Santander",
    bankName: "Santander",
    country: "CL",
    sourceUrl: "https://banco.santander.cl/beneficios",
    expectedMinRawBenefits: 250,
    minSafePersistRatio: 0.75,
    scraper: new SantanderScraper(),
  },
  {
    slug: "tenpo",
    name: "Tenpo",
    bankName: "Tenpo",
    country: "CL",
    sourceUrl: "https://www.tenpo.cl/beneficios",
    expectedMinRawBenefits: 40,
    minSafePersistRatio: 0.7,
    scraper: new TenpoScraper(),
  },
];

export const findProviderBySlug = (providerSlug: string): Provider | undefined =>
  providers.find((provider) => provider.slug === providerSlug);
