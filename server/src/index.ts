import { app } from "./app.js";
import { ensureRemarkAttachmentTable } from "./services/remarkAttachments.js";

const port = Number(process.env.PORT ?? 4000);

ensureRemarkAttachmentTable()
  .then(() => app.listen(port, () => console.log(`Server running at http://localhost:${port}`)))
  .catch(error => {
    console.error("Unable to initialize database", error);
    process.exit(1);
  });
