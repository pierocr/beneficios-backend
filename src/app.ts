import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { benefitsRouter } from "./routes/benefits.routes";
import { healthRouter } from "./routes/health.routes";
import { providersRouter } from "./routes/providers.routes";
import { logger } from "./utils/logger";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

app.use("/health", healthRouter);
app.use("/providers", providersRouter);
app.use("/benefits", benefitsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  logger.error("Unhandled request error", { message });
  res.status(500).json({ error: message });
});
