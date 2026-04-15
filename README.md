# beneficios-cl

Backend en Node.js + TypeScript para scraping y procesamiento de beneficios bancarios en Chile. La arquitectura parte con Banco Falabella y queda preparada para agregar nuevos providers como BCI, Santander, Scotiabank, Itau o Banco de Chile sin rehacer el proyecto.

## Instalacion

```bash
npm install
cp .env.example .env
```

## Correr la API

```bash
npm run dev
```

Endpoints disponibles:

- `GET /health`
- `GET /providers`
- `GET /benefits/raw/:providerSlug`

Nota: `GET /benefits/raw/:providerSlug` es solo para desarrollo. En produccion, el scraping debe ejecutarse como job o cron y no desde requests publicas.

## Correr un scraper

```bash
npm run scrape:all
npm run scrape:bancochile
npm run scrape:cencosudscotia
npm run scrape:falabella
npm run scrape:bci
npm run scrape:santander
```

Tambien puedes ejecutar cualquier provider registrado:

```bash
npm run scrape falabella
```

Y para ejecutar todos los providers registrados en `src/providers/providers.ts` en una sola pasada:

```bash
npm run scrape:all
```

El resultado se guarda en `output/` con timestamp.

## Persistencia en Supabase

El proyecto queda preparado para persistir sin duplicar beneficios. La tabla `benefits` usa una clave unica por `provider_slug + provider_benefit_key`, por lo que cada corrida hace `upsert` y actualiza registros existentes en vez de crear duplicados.

Ademas, los beneficios que ya no aparezcan en una corrida se marcan con `is_active = false`.

### Esquema SQL

Ejecuta [src/db/schemas/001_initial_schema.sql](/c:/Users/piero/beneficios-cl/src/db/schemas/001_initial_schema.sql) en el SQL Editor de Supabase para crear:

- `providers`
- `scraping_runs`
- `benefits`

Ese mismo script deja `RLS` activado con esta base:

- `providers`: lectura publica para `anon` y `authenticated`
- `benefits`: lectura publica solo para beneficios activos y no invalidos
- `scraping_runs`: sin lectura publica

Las escrituras quedan reservadas al backend usando `SUPABASE_SERVICE_ROLE_KEY`.

### Variables de entorno para escribir en BD

Para escrituras desde backend usa:

```env
PERSIST_RESULTS_TO_DB=true
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

La `publishable key` no es suficiente para este job backend si quieres escritura confiable sin depender de politicas RLS.

### Flujo de persistencia

1. Se registra o actualiza el `provider`.
2. Se crea un registro en `scraping_runs`.
3. Se hace `upsert` masivo sobre `benefits`.
4. Los beneficios no vistos en la corrida actual se desactivan.

### Guardas de seguridad

- Los scrapers de Banco de Chile, Tarjeta Cencosud Scotiabank, Falabella, Bci y Santander reintentan automaticamente ante cargas parciales o resultados sospechosos.
- Antes de persistir, el job compara el resultado actual contra el historico activo del provider.
- Si el volumen scrapeado cae por debajo del umbral seguro, se bloquea la actualizacion de la BD para evitar dejar beneficios en cero por una caida parcial del sitio.

## Estructura del proyecto

```text
src/
  app.ts
  server.ts
  config/
    categories.ts
    merchants.ts
    env.ts
  jobs/
    run-scraper.ts
  providers/
    provider.types.ts
    providers.ts
  routes/
    benefits.routes.ts
    health.routes.ts
    providers.routes.ts
  scrapers/
    bci.scraper.ts
    bancochile.scraper.ts
    cencosudscotia.scraper.ts
    falabella.scraper.ts
    santander.scraper.ts
    scraper.types.ts
  services/
    category mapping via config/categories.ts
    normalization.service.ts
    scraping.service.ts
    validation.service.ts
  types/
    benefit.types.ts
  utils/
    logger.ts
    text.ts
```

## Flujo

`provider -> scraper -> raw benefits -> normalizer -> validator -> output JSON`

## Como agregar un nuevo banco/provider

1. Crear un scraper en `src/scrapers/` que implemente `BenefitScraper`.
2. Registrar el provider en `src/providers/providers.ts` con `slug`, `name`, `bankName`, `country`, `sourceUrl` y `scraper`.
3. Ejecutar `npm run scrape <providerSlug>` para validar el flujo end-to-end.

## Notas de arquitectura

- `RawBenefit` representa el texto extraido tal como viene desde la fuente.
- `NormalizedBenefit` aplica una interpretacion inicial para detectar porcentaje, cashback, cuotas, dias, comercio canonico y categoria simple.
- `categoryName` y `categorySource` quedan persistidos en el JSON de salida para facilitar filtros y futura carga a base de datos.
- `merchantCanonicalName`, `merchantSlug`, `merchantSource` y `merchantMatchedAlias` quedan persistidos para compartir catalogo entre bancos.
- `ValidationService` marca registros como `valid`, `needs_review` o `invalid`.
- No hay base de datos todavia, pero la separacion `scraper -> normalization -> validation` deja listo el proyecto para persistir resultados luego en Supabase o Postgres.
- La persistencia actual esta preparada para crecimiento: mismo comercio entre bancos, beneficios versionados por corrida y actualizacion idempotente sin duplicados.
