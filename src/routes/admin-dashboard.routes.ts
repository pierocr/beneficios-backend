import { NextFunction, Request, Response, Router } from "express";
import { env } from "../config/env";
import { AdminDashboardData, adminDashboardService } from "../services/admin-dashboard.service";

export const adminDashboardRouter = Router();

adminDashboardRouter.use(requireAdminDashboardAccess);

adminDashboardRouter.get("/dashboard/data", async (_req, res, next) => {
  try {
    const data = await adminDashboardService.getDashboardData();
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
});

adminDashboardRouter.get("/dashboard", async (_req, res, next) => {
  try {
    const data = await adminDashboardService.getDashboardData();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'");
    res.status(200).send(renderDashboard(data));
  } catch (error) {
    next(error);
  }
});

function requireAdminDashboardAccess(req: Request, res: Response, next: NextFunction): void {
  const configuredToken = env.ADMIN_DASHBOARD_TOKEN;

  if (configuredToken) {
    const providedToken = getProvidedToken(req);

    if (providedToken === configuredToken) {
      next();
      return;
    }

    res.status(401).send(renderUnauthorized("Token requerido o invalido."));
    return;
  }

  if (isLocalRequest(req)) {
    next();
    return;
  }

  res.status(403).send(renderUnauthorized("Configura ADMIN_DASHBOARD_TOKEN para acceder fuera de localhost."));
}

function getProvidedToken(req: Request): string | undefined {
  const authorization = req.header("authorization");

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  const headerToken = req.header("x-admin-token");
  if (headerToken) {
    return headerToken;
  }

  const queryToken = req.query.token;
  return typeof queryToken === "string" ? queryToken : undefined;
}

function isLocalRequest(req: Request): boolean {
  const ip = req.ip || req.socket.remoteAddress || "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip) || ip.endsWith("127.0.0.1");
}

function renderDashboard(data: AdminDashboardData): string {
  const maxProviderCount = Math.max(...data.providers.map((provider) => provider.activeCount), 1);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="300">
  <title>Dashboard Beneficios</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --surface: #ffffff;
      --text: #14171f;
      --muted: #69707d;
      --line: #dde2ea;
      --accent: #0f7b6c;
      --accent-soft: #dff3ef;
      --warn: #a45d00;
      --warn-soft: #fff1d6;
      --bad: #a83c3c;
      --bad-soft: #ffe2e2;
      --good: #21734f;
      --good-soft: #dff4e9;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 18px 48px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-end;
      margin-bottom: 22px;
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: clamp(28px, 4vw, 42px); line-height: 1.05; letter-spacing: 0; }
    h2 { font-size: 20px; margin-bottom: 12px; }
    h3 { font-size: 14px; color: var(--muted); font-weight: 650; }
    .muted { color: var(--muted); }
    .timestamp { text-align: right; font-size: 13px; color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    .metric-value {
      margin-top: 8px;
      font-size: 30px;
      line-height: 1;
      font-weight: 760;
      letter-spacing: 0;
    }
    .metric-note { margin-top: 8px; color: var(--muted); font-size: 13px; }
    .section {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      margin-top: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      padding: 11px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: middle;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .04em;
      font-weight: 700;
    }
    tr:last-child td { border-bottom: 0; }
    .bank {
      display: grid;
      gap: 5px;
      min-width: 180px;
    }
    .slug { color: var(--muted); font-size: 12px; }
    .bar {
      height: 8px;
      min-width: 70px;
      border-radius: 99px;
      background: #edf0f4;
      overflow: hidden;
    }
    .bar > span {
      display: block;
      height: 100%;
      width: var(--w);
      background: var(--accent);
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #edf0f4;
      color: #333b48;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }
    .pill.good { background: var(--good-soft); color: var(--good); }
    .pill.warn { background: var(--warn-soft); color: var(--warn); }
    .pill.bad { background: var(--bad-soft); color: var(--bad); }
    .charts {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(260px, .75fr);
      gap: 14px;
      margin-top: 14px;
    }
    .chart-title {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 14px;
    }
    .chart-title h2 { margin-bottom: 0; }
    .hbar-list {
      display: grid;
      gap: 11px;
    }
    .hbar-row {
      display: grid;
      grid-template-columns: minmax(120px, .75fr) minmax(160px, 1.25fr) 64px;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }
    .hbar-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 650;
    }
    .hbar-track {
      height: 13px;
      border-radius: 99px;
      overflow: hidden;
      background: #edf0f4;
    }
    .hbar-fill {
      display: block;
      height: 100%;
      width: var(--w);
      border-radius: inherit;
      background: var(--c, var(--accent));
    }
    .hbar-value {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--muted);
    }
    .donut-wrap {
      display: grid;
      grid-template-columns: 180px minmax(0, 1fr);
      align-items: center;
      gap: 14px;
    }
    .donut {
      width: 180px;
      height: 180px;
    }
    .donut text {
      fill: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 760;
    }
    .legend {
      display: grid;
      gap: 10px;
    }
    .legend-row {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      font-size: 13px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--c);
    }
    .mini-charts {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
      margin-top: 14px;
    }
    .sparkline {
      display: grid;
      grid-template-columns: repeat(20, minmax(4px, 1fr));
      align-items: end;
      gap: 4px;
      height: 92px;
      padding-top: 8px;
    }
    .sparkbar {
      min-height: 4px;
      height: var(--h);
      border-radius: 5px 5px 2px 2px;
      background: var(--accent);
    }
    .freshness-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-top: 4px;
    }
    .freshness-item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .freshness-bank {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 700;
      font-size: 13px;
    }
    .two-col {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
    }
    .list {
      display: grid;
      gap: 10px;
    }
    .list-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
    }
    .list-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .runs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .run {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      display: grid;
      gap: 6px;
    }
    @media (max-width: 920px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .charts, .mini-charts, .two-col, .runs { grid-template-columns: 1fr; }
      .freshness-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      header { align-items: flex-start; flex-direction: column; }
      .timestamp { text-align: left; }
    }
    @media (max-width: 640px) {
      main { padding: 20px 12px 36px; }
      .grid { grid-template-columns: 1fr; }
      .donut-wrap { grid-template-columns: 1fr; justify-items: center; }
      .hbar-row { grid-template-columns: minmax(0, 1fr) 58px; }
      .hbar-track { grid-column: 1 / -1; grid-row: 2; }
      .freshness-grid { grid-template-columns: 1fr; }
      .table-wrap { overflow-x: auto; }
      table { min-width: 920px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Dashboard Beneficios</h1>
        <p class="muted">Mes en curso: ${escapeHtml(data.currentMonthLabel)}. La pagina se refresca cada 5 minutos.</p>
      </div>
      <p class="timestamp">Generado: ${formatDateTime(data.generatedAt, data.timezone)}<br>Zona horaria: ${escapeHtml(data.timezone)}</p>
    </header>

    <section class="grid" aria-label="Resumen general">
      ${metricCard("Activos", data.totals.activeBenefits, `${data.totals.providersWithActiveBenefits} bancos con beneficios activos`)}
      ${metricCard("Mes en curso", data.totals.currentMonthActiveBenefits, `${data.totals.newThisMonthBenefits} nuevos vistos por primera vez este mes`)}
      ${metricCard("Para hoy", data.totals.todayBenefits, `${data.totals.onlineBenefits} online / ${data.totals.inPersonBenefits} presencial`)}
      ${metricCard("Revision", data.totals.needsReviewBenefits, `${data.totals.validBenefits} validos / ${data.totals.invalidBenefits} invalidos`)}
    </section>

    <section class="charts">
      ${providerDistributionChart(data)}
      ${validationDonutChart(data)}
    </section>

    <section class="mini-charts">
      ${rankedBarChart("Categorias principales", data.topCategories)}
      ${rankedBarChart("Tipos de beneficio", data.benefitTypes)}
    </section>

    <section class="section">
      <div class="chart-title">
        <h2>Frescura por banco</h2>
        <span class="muted">Segun ultima corrida completada</span>
      </div>
      <div class="freshness-grid">
        ${data.providers.map((provider) => freshnessCard(provider)).join("")}
      </div>
    </section>

    <section class="section">
      <h2>Bancos</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Banco</th>
              <th>Activos</th>
              <th>Mes</th>
              <th>Nuevos</th>
              <th>Hoy</th>
              <th>Revision</th>
              <th>Categoria top</th>
              <th>Desc.</th>
              <th>Ultima actualizacion</th>
              <th>Ultima corrida</th>
            </tr>
          </thead>
          <tbody>
            ${data.providers.map((provider) => providerRow(provider, maxProviderCount, data.timezone)).join("")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="two-col">
      ${listSection("Categorias principales", data.topCategories)}
      ${listSection("Metodos de pago", data.paymentMethods)}
      ${listSection("Tipos de beneficio", data.benefitTypes)}
      ${listSection("Estados de validacion", data.validationStatuses)}
    </section>

    <section class="section">
      <h2>Corridas recientes</h2>
      <div class="runs">
        ${data.recentRuns.map((run) => runCard(run, data.timezone)).join("")}
      </div>
    </section>
  </main>
</body>
</html>`;
}

function metricCard(label: string, value: number, note: string): string {
  return `<article class="card">
    <h3>${escapeHtml(label)}</h3>
    <div class="metric-value">${formatNumber(value)}</div>
    <p class="metric-note">${escapeHtml(note)}</p>
  </article>`;
}

function providerDistributionChart(data: AdminDashboardData): string {
  const maxCount = Math.max(...data.providers.map((provider) => provider.activeCount), 1);

  return `<section class="section">
    <div class="chart-title">
      <h2>Distribucion por banco</h2>
      <span class="muted">${formatNumber(data.totals.activeBenefits)} activos</span>
    </div>
    <div class="hbar-list">
      ${data.providers
        .map((provider, index) =>
          horizontalBar({
            label: provider.bankName,
            value: provider.activeCount,
            maxValue: maxCount,
            color: chartColor(index),
          }),
        )
        .join("")}
    </div>
  </section>`;
}

function validationDonutChart(data: AdminDashboardData): string {
  const items = [
    { name: "Validos", count: data.totals.validBenefits, color: "#21734f" },
    { name: "Revision", count: data.totals.needsReviewBenefits, color: "#a45d00" },
    { name: "Invalidos", count: data.totals.invalidBenefits, color: "#a83c3c" },
  ];
  const total = Math.max(items.reduce((sum, item) => sum + item.count, 0), 1);
  const radius = 74;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const circles = items
    .map((item) => {
      const dash = (item.count / total) * circumference;
      const circle = `<circle cx="100" cy="100" r="${radius}" fill="none" stroke="${item.color}" stroke-width="24" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)" />`;
      offset += dash;
      return circle;
    })
    .join("");

  return `<section class="section">
    <div class="chart-title">
      <h2>Validacion</h2>
      <span class="muted">${formatNumber(total)} revisados</span>
    </div>
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 200 200" role="img" aria-label="Distribucion de estados de validacion">
        <circle cx="100" cy="100" r="${radius}" fill="none" stroke="#edf0f4" stroke-width="24" />
        ${circles}
        <text x="100" y="94" text-anchor="middle" font-size="30">${Math.round((data.totals.validBenefits / total) * 100)}%</text>
        <text x="100" y="118" text-anchor="middle" font-size="13" fill="#69707d">validos</text>
      </svg>
      <div class="legend">
        ${items
          .map(
            (item) => `<div class="legend-row">
              <span class="dot" style="--c:${item.color}"></span>
              <span>${escapeHtml(item.name)}</span>
              <strong>${formatNumber(item.count)}</strong>
            </div>`,
          )
          .join("")}
      </div>
    </div>
  </section>`;
}

function rankedBarChart(title: string, items: Array<{ name: string; count: number }>): string {
  const maxValue = Math.max(...items.map((item) => item.count), 1);

  return `<section class="section">
    <div class="chart-title">
      <h2>${escapeHtml(title)}</h2>
      <span class="muted">Top ${items.length}</span>
    </div>
    <div class="hbar-list">
      ${items
        .map((item, index) =>
          horizontalBar({
            label: item.name,
            value: item.count,
            maxValue,
            color: chartColor(index + 2),
          }),
        )
        .join("")}
    </div>
  </section>`;
}

function horizontalBar(input: { label: string; value: number; maxValue: number; color: string }): string {
  const width = Math.max(3, Math.round((input.value / input.maxValue) * 100));

  return `<div class="hbar-row">
    <span class="hbar-label" title="${escapeHtml(input.label)}">${escapeHtml(input.label)}</span>
    <span class="hbar-track" aria-hidden="true"><span class="hbar-fill" style="--w:${width}%; --c:${input.color}"></span></span>
    <span class="hbar-value">${formatNumber(input.value)}</span>
  </div>`;
}

function freshnessCard(provider: AdminDashboardData["providers"][number]): string {
  const freshnessClass =
    provider.hoursSinceLastRun === null
      ? "bad"
      : provider.hoursSinceLastRun <= 24
        ? "good"
        : provider.hoursSinceLastRun <= 72
          ? "warn"
          : "bad";

  return `<article class="freshness-item">
    <span class="freshness-bank">${escapeHtml(provider.bankName)}</span>
    <span class="pill ${freshnessClass}">${formatRelativeHours(provider.hoursSinceLastRun)}</span>
    <span class="slug">${formatNumber(provider.lastRunRawCount ?? 0)} raw · ${formatNumber(provider.activeCount)} activos</span>
  </article>`;
}

function providerRow(
  provider: AdminDashboardData["providers"][number],
  maxProviderCount: number,
  timezone: string,
): string {
  const width = Math.max(4, Math.round((provider.activeCount / maxProviderCount) * 100));
  const freshnessClass =
    provider.hoursSinceLastRun === null ? "bad" : provider.hoursSinceLastRun <= 24 ? "good" : provider.hoursSinceLastRun <= 72 ? "warn" : "bad";

  return `<tr>
    <td>
      <div class="bank">
        <strong>${escapeHtml(provider.bankName)}</strong>
        <span class="slug">${escapeHtml(provider.slug)}</span>
      </div>
    </td>
    <td>
      <strong>${formatNumber(provider.activeCount)}</strong>
      <div class="bar" aria-hidden="true"><span style="--w:${width}%"></span></div>
      <span class="slug">${formatNumber(provider.inactiveCount)} inactivos</span>
    </td>
    <td>${formatNumber(provider.currentMonthActiveCount)}</td>
    <td>${formatNumber(provider.newThisMonthCount)}</td>
    <td>${formatNumber(provider.todayCount)}</td>
    <td><span class="pill ${provider.needsReviewCount > 0 ? "warn" : "good"}">${formatNumber(provider.needsReviewCount)}</span></td>
    <td>${escapeHtml(provider.topCategory ?? "Sin datos")}</td>
    <td>${provider.averageDiscount === null ? "Sin datos" : `${provider.averageDiscount}% prom. / ${provider.maxDiscount}% max.`}</td>
    <td>${provider.lastSeenAt ? formatDateTime(provider.lastSeenAt, timezone) : "Sin datos"}</td>
    <td>
      <span class="pill ${freshnessClass}">${provider.lastRunStatus ? escapeHtml(provider.lastRunStatus) : "sin corrida"}</span>
      <div class="slug">${provider.lastRunAt ? `${formatRelativeHours(provider.hoursSinceLastRun)} · ${formatNumber(provider.lastRunRawCount ?? 0)} raw` : ""}</div>
    </td>
  </tr>`;
}

function listSection(title: string, items: Array<{ name: string; count: number }>): string {
  return `<section class="section">
    <h2>${escapeHtml(title)}</h2>
    <div class="list">
      ${items
        .map(
          (item) => `<div class="list-row">
            <span class="list-name">${escapeHtml(item.name)}</span>
            <strong>${formatNumber(item.count)}</strong>
          </div>`,
        )
        .join("")}
    </div>
  </section>`;
}

function runCard(run: AdminDashboardData["recentRuns"][number], timezone: string): string {
  return `<article class="run">
    <strong>${escapeHtml(run.providerSlug)}</strong>
    <span class="muted">${run.completedAt ? formatDateTime(run.completedAt, timezone) : "Sin completar"}</span>
    <span>${formatNumber(run.rawCount)} raw · ${formatNumber(run.validCount)} validos · ${formatNumber(run.needsReviewCount)} revision</span>
  </article>`;
}

function renderUnauthorized(message: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Acceso restringido</title><style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f9;color:#14171f}.box{background:white;border:1px solid #dde2ea;border-radius:8px;padding:24px;max-width:420px}code{background:#edf0f4;padding:2px 5px;border-radius:4px}</style></head><body><main class="box"><h1>Acceso restringido</h1><p>${escapeHtml(message)}</p><p>Usa <code>/admin/dashboard?token=...</code> o header <code>Authorization: Bearer ...</code>.</p></main></body></html>`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-CL").format(value);
}

function formatDateTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRelativeHours(hours: number | null): string {
  if (hours === null) {
    return "sin datos";
  }

  if (hours < 1) {
    return "hace menos de 1 h";
  }

  if (hours < 24) {
    return `hace ${hours} h`;
  }

  return `hace ${Math.round(hours / 24)} d`;
}

function chartColor(index: number): string {
  const colors = ["#0f7b6c", "#3f6fb5", "#8b5e9f", "#c06b35", "#587a35", "#9a4d63", "#2f7f9f", "#6d6f2f"];
  return colors[index % colors.length] ?? colors[0]!;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
