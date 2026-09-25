# Dokploy Application deployment

Use one Application for the frontend and API (the root Dockerfile serves both) and a separate Dokploy MySQL database in the same environment and server.

## Database

Create a MySQL service, preferably MySQL 8.4, with database `collection_monitoring` and user `collection_app`. Deploy it and obtain its Internal Connection URL from Dokploy. The old Compose hostname `db` does not identify this new service. No public database port is needed.

For existing data, export the old database and restore it into this service before switching traffic. Keep the old Compose service and its volume until data and login have been verified. A new MySQL service does not automatically reuse the Compose volume.

For a fresh empty database, import `database/schema.mysql.sql` with a MySQL client or database management tool using an account allowed to create the schema tables. Creating the Dokploy database alone does not create application tables. Do not initialize a fresh database in place of restoring existing data you need.

## Application

Create an Application in the same environment and server:

| Setting | Value |
| --- | --- |
| Repository | `git@github.com:aibmpcit/Collection-Monitoring.git` |
| Branch | `main` |
| Build path | `/` |
| Build type | Dockerfile |
| Dockerfile | `Dockerfile` at the repository root |
| Docker build context | `.` (repository root) |
| Container port | `4000` |

Do not use `database/Dockerfile` for the Application. Do not configure a Compose path. Leave the start command at the Dockerfile default.

Set these Application runtime environment variables:

```dotenv
NODE_ENV=production
PORT=4000
SERVE_CLIENT=true
API_BODY_LIMIT=25mb
DATABASE_URL=mysql://collection_app:URL_ENCODED_PASSWORD@ACTUAL_INTERNAL_MYSQL_HOST:3306/collection_monitoring
JWT_SECRET=REPLACE_WITH_YOUR_SECRET
RUN_DATA_RESET_MIGRATION=false
```

Use the real internal connection URL supplied by the MySQL service, including its actual user and password. URL-encode special characters in credentials. The Application reads `DATABASE_URL` and `JWT_SECRET`; the three-variable Compose environment file is not sufficient for this deployment mode.

The application container runs pending database migrations before starting the server. For the one-time revised collection schema reset, copy `dokploy.env.example`, replace its placeholders, and deploy with `RUN_DATA_RESET_MIGRATION=true`. This deletes members, loans, payments, remarks, and attachments while retaining users and branches. After the deployment succeeds, change the flag to `false`. The migration is recorded in `schema_migrations`, so it cannot reset the data a second time.

Deploy, then check the Application terminal:

```sh
node -e "fetch('http://127.0.0.1:4000/api/health').then(async r=>console.log(r.status,await r.text())).catch(console.error)"
```

This health endpoint checks HTTP availability, not database connectivity. Verify login separately after restoring data or creating the initial admin.

For a fresh installation, use the administrator creation commands in `DOKPLOY.md` after importing the schema. That script resets an existing username's password, so only use it intentionally.

## Domain cutover

Remove the domain assignment from the old Compose service and redeploy that service to remove its old proxy route. Keep its database volume. Assign `collectionmonitoring.barbazampc.cloud` to the new Application with container port `4000`, path `/`, and HTTPS enabled. Deploy the Application after saving. Avoid two services routing the same hostname at once.

Verify the login page, login, and existing records before retiring the old deployment. DNS can stay unchanged when both deployments use the same server.

References: https://docs.dokploy.com/docs/core/applications and https://docs.dokploy.com/docs/core/databases/connection
