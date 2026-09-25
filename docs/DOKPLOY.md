# Deploy with Dokploy

For an Application service with a separate MySQL service, follow [Application deployment](DOKPLOY-APPLICATION.md). The instructions below are for Docker Compose.

## 1. Fix the domain DNS

In the DNS manager for `bmpc.cloud`, create an A record named `collection` pointing to the public IPv4 address of the server running this deployment's Dokploy proxy. Do not enter a URL or port as the record value.

Check from PowerShell:

```powershell
Resolve-DnsName collection.bmpc.cloud -Type A -Server 1.1.1.1
```

`queryA ENOTFOUND` means DNS resolution failed. Application code and container port changes cannot create the missing DNS record. Wait for the DNS update to resolve before retrying domain validation.

## 2. Configure the Compose service

Create a Docker Compose service in your Dokploy project, connected to:

- Repository: `aibmpcit/Collection-Monitoring`
- Branch: `main`
- Compose path: `compose.dokploy.yaml`
- Leave **Isolated Deployments** disabled with this configuration. The file explicitly connects `app` to the external `dokploy-network` for routing, and both `app` and `db` to the project-scoped `backend` network for database access.

In Preview Compose, verify that `app` retains both networks and `db` retains `backend`. If only `app` joins `dokploy-network` while `db` has no explicit network, database hostname resolution can fail with `getaddrinfo EAI_AGAIN db`. Redeploy after updating the configuration; keep the existing database volume.

The Dokploy Compose file exposes container port 4000 internally without publishing host port 8080. MySQL data remains in the `mysql_data` named volume. The schema is copied into the database image to avoid a bind mount into the Git checkout. Initialization happens only on an empty database volume; existing Laragon data is not automatically transferred.

## 3. Environment

In the Compose service's Environment tab, set:

```dotenv
MYSQL_PASSWORD=REPLACE_WITH_RANDOM_HEX_PASSWORD
MYSQL_ROOT_PASSWORD=REPLACE_WITH_DIFFERENT_RANDOM_HEX_PASSWORD
JWT_SECRET=REPLACE_WITH_DIFFERENT_RANDOM_HEX_SECRET
```

Generate each value separately on your computer:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Do not commit these values. Use hexadecimal passwords because the app password is embedded in the database URL. The database hostname is `db`, not `localhost` or the public domain.

## 4. Domain

In the Compose service's Domains tab, configure:

| Setting | Value |
| --- | --- |
| Host | `collection.bmpc.cloud` |
| Service | `app` |
| Container port | `4000` |
| Path | `/` |
| HTTPS | Enabled, with Let's Encrypt |

Use Preview Compose to confirm the generated routing configuration. Deploy or redeploy after changing a Compose domain. Ensure the proxy's HTTP and HTTPS ports (80 and 443) are reachable.

## 5. Create the initial administrator

After both containers are healthy, open the `app` container terminal using `/bin/bash`, then run:

```bash
read -r -p 'Admin username: ' ADMIN_USERNAME
read -r -s -p 'Admin password (at least 8 characters): ' ADMIN_PASSWORD
printf '\n'
export ADMIN_USERNAME ADMIN_PASSWORD
node server/dist/scripts/create-admin.js
unset ADMIN_USERNAME ADMIN_PASSWORD
```

This resets the password if the username already exists. Sign in at `https://collection.bmpc.cloud` and check `https://collection.bmpc.cloud/api/health` for `{"ok":true}`.

Keep the Compose service/project identity and database volume stable when redeploying. Do not delete the volume to troubleshoot DNS. Changing environment passwords does not update an already initialized database's credentials.

References: [Dokploy Compose](https://docs.dokploy.com/docs/core/docker-compose), [Compose domains](https://docs.dokploy.com/docs/core/docker-compose/domains), [Domains](https://docs.dokploy.com/docs/core/domains).
