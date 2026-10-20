import { app } from "./app.js";
import { ensureSchema } from "./services/schema.js";
import { useDatabaseLoginStore } from "./services/loginLimiter.js";

const port = Number(process.env.PORT ?? 4000);

ensureSchema()
  .then(() => useDatabaseLoginStore())
  .then(() => app.listen(port, () => console.log(`Server running at http://localhost:${port}`)))
  .catch(error => {
    console.error("Unable to initialize database", error);
    process.exit(1);
  });
