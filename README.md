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
- `GET /benefits/home`
- `GET /benefits`
- `GET /benefits/search`
- `GET /benefits/:providerSlug/:merchantSlug`
- `POST /benefit-reports`
- `GET /benefits/raw/:providerSlug`
- `GET /admin/dashboard` dashboard personal de metricas, protegido por `ADMIN_DASHBOARD_TOKEN` o limitado a localhost si no se configura token.

Nota: `GET /benefits/raw/:providerSlug` es solo para desarrollo. En produccion, el scraping debe ejecutarse como job o cron y no desde requests publicas.
Sin `PUBLIC_SCRAPE_TOKEN`, ese endpoint solo responde desde localhost y fuera de produccion.

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

Ejecuta `src/db/schemas/001_initial_schema.sql` en el SQL Editor de Supabase para crear:

- `providers`
- `scraping_runs`
- `benefits`

Luego ejecuta `src/db/schemas/002_mvp_user_data_and_indexes.sql` para agregar:

- indices de busqueda/filtros para el catalogo MVP
- `profiles`
- `user_wallet_items`
- `user_favorite_merchants`
- `user_saved_benefits`
- `user_preferences`
- `benefit_reports`

Ese mismo script deja `RLS` activado con esta base:

- `providers`: lectura publica para `anon` y `authenticated`
- `benefits`: lectura publica solo para beneficios activos y no invalidos
- `scraping_runs`: sin lectura publica

Las escrituras quedan reservadas al backend usando `SUPABASE_SERVICE_ROLE_KEY`.
Las tablas de billetera, favoritos y preferencias usan RLS por `auth.uid()`. No almacenan numeros de tarjeta ni datos bancarios sensibles.

### Variables de entorno para escribir en BD

Para escrituras desde backend usa:

```env
PERSIST_RESULTS_TO_DB=true
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_DASHBOARD_TOKEN=change-this-local-secret
PUBLIC_SCRAPE_TOKEN=change-this-if-you-enable-raw-scraping
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

La `publishable key` no es suficiente para este job backend si quieres escritura confiable sin depender de politicas RLS.

### Tests y seguridad

```bash
npm test
npm audit --omit=dev
```

`npm test` compila TypeScript y ejecuta pruebas unitarias sobre normalizacion/validacion de beneficios no porcentuales.

### Dashboard personal

Con la API corriendo, abre:

```text
http://localhost:3000/admin/dashboard
```

Si configuras `ADMIN_DASHBOARD_TOKEN`, usa:

```text
http://localhost:3001/admin/dashboard?token=sr6PzJXIk6UvI7mStd2ptAv7bQuZY7m0fSVHOdekm4iLdIPTGMEALKy35vkBTDAz
```

El dashboard muestra totales por banco, ultima corrida, beneficios activos del mes en curso, nuevos del mes, beneficios disponibles hoy, estados de validacion, categorias principales y corridas recientes. Tambien existe `GET /admin/dashboard/data` para ver los mismos datos en JSON.

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

## Endpoints MVP

`GET /benefits/home` devuelve solo data optimizada para Home: descuentos de hoy, descuentos de manana, destacados, categorias populares y providers. Evita cargar todo el catalogo en la primera vista.

`GET /benefits` y `GET /benefits/search` aceptan `q`/`search`, `provider`, `providerSlug`, `bank`, `walletProviders`, `category`, `day`, `paymentMethod`, `channel`, `modality`, `sort`, `sortBy`, `limit`, `page` y `offset`.

`POST /benefit-reports` guarda reportes de informacion incorrecta en Supabase para revision posterior.

## Notas de arquitectura

- `RawBenefit` representa el texto extraido tal como viene desde la fuente.
- `NormalizedBenefit` aplica una interpretacion inicial para detectar porcentaje, cashback, cuotas, dias, comercio canonico y categoria simple.
- `categoryName` y `categorySource` quedan persistidos en el JSON de salida para facilitar filtros y futura carga a base de datos.
- `merchantCanonicalName`, `merchantSlug`, `merchantSource` y `merchantMatchedAlias` quedan persistidos para compartir catalogo entre bancos.
- `ValidationService` marca registros como `valid`, `needs_review` o `invalid`.
- La persistencia actual esta preparada para crecimiento: mismo comercio entre bancos, beneficios versionados por corrida y actualizacion idempotente sin duplicados.
- Los archivos en `output/` son artefactos locales de scraping y no son parte del runtime web. Se mantienen fuera de git.
