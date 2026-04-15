import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";

app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`, {
    nodeEnv: env.NODE_ENV,
  });
});
