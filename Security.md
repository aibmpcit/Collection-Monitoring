Go through my app against the checklist below. For every item, tell me whether it is already handled, does not apply to my app, or is missing. Fix the missing ones, and at the end explain what you changed and why, file by file. Do not change anything else.

## Access control
- CORS - Restrict which sites' JavaScript can read your API. It does not block direct requests, curl ignores it. Never use *.
- SameSite cookies - Stops another site making requests as your logged-in user. This is your CSRF protection.
- RLS (row level security) - The database itself refuses rows that are not the user's. Postgres only, so Supabase and Neon have it. On MySQL or SQLite, enforce it in every query.
- Scoped queries - The user ID goes inside the SQL statement, not in a check above it.
- Server-side gates - Hiding a button is not security. The endpoint must refuse too.
- Static files ignore your auth - Your public folder is served before your code runs. Paid downloads cannot live there.
- 404 instead of 403 - With sequential IDs, a 403 confirms the record exists.

## Roles and permissions (RBAC)
- RBAC - Define roles server-side and check them in every endpoint. Not a UI state.
- Never read the role from the client - localStorage and unverified tokens are user-editable. Read it from the database. This is the most common takeover.
- Block mass assignment - Save only the fields you named, or someone sends {"role":"admin"} and promotes themselves.
- Rank roles, do not compare them - role === 'editor' locks your admin out.
- Default deny - New routes refuse until you open them.
- Re-check the role per request - Otherwise revoking access waits for logout.
- Least privilege for staff - A moderator does not need your email list.
- Separate role from plan - Staff and paid are different questions.
- Log privileged actions - Who granted what, when.

## Accounts
- Password hashing - argon2id, scrypt or bcrypt. Never MD5 or SHA1.
- Minimum 8 characters - And check against a breached-password list if you can.
- HttpOnly cookies - Session in a cookie JavaScript cannot read, not localStorage.
- Session expiry - Sessions end, and a fresh one is issued at login.
- Email verification - Checked where sessions are validated, not just at login.
- No account enumeration - Signup and forgot-password answer the same for real and fake addresses.
- Kill sessions on password reset - Every device.
- Timing-safe comparison - Compare tokens with a constant-time function, not ===.
- MFA option - TOTP is enough.
- Account deletion - A real one the user can run themselves.

## Abuse and cost
- Rate limiting - Per IP and per user on login, signup, uploads and anything that sends email.
- Persist the counters - In-memory limits reset on every deploy and break across servers.
- Brute-force alerts - Know when someone starts guessing.
- Spend caps - Daily ceiling on paid API calls, per user and global. One script can run up your bill.
- Storage caps - Lifetime, not just daily.
- Honeypot field - Hidden input bots fill in. Weak alone, free to add.
- Disposable email blocking - Refuse temp-mail. These lists get it wrong sometimes, so never block a paying customer.

## Input and files
- Validate server-side - Price, plan, role, quantity, ID. Browser values are claims, not facts.
- Parameterized queries - Never build SQL from strings.
- Command injection - Never put user input in a shell command. Pass arguments as an array. Hits anyone using ffmpeg or yt-dlp.
- Magic-byte file checks - Validate by signature, not extension.
- Magic bytes alone are not enough - Also cap size, re-encode images, and never serve uploads with an executable type.
- Check limits before reading the file - A quota check after buffering already cost you the memory.
- Never build a path from user input - Look the ID up in a fixed list. This is directory traversal.
- Sanitize HTML with DOMPurify - Do not write your own. React and Vue escape text already, so the risk is dangerouslySetInnerHTML and v-html.
- No open redirects - Allowlist post-login destinations, or your domain fronts a phishing link.
- SSRF protection - Allowlist the host, block private IPs and 169.254.169.254, re-check on every redirect.

## AI features
- Prompt injection - Scraped pages, user messages and uploads can contain instructions. Label them as data, never as commands.
- Limit what the model can do - Read-only tools first, no delete, cap writes per turn and per day.
- No user data in the system prompt - Unless it is required, and never another user's.
- Treat model output as untrusted - Do not run it, render it as HTML, or put it in a query.

## Browser and headers
- HTTPS everywhere - No mixed content. The certificate is free.
- CSP - Controls which scripts may run, blocking most injected code. Use nonces if you have inline scripts.
- HSTS - Forces HTTPS. Preload is hard to undo.
- frame-ancestors none - Stops clickjacking. Replaces X-Frame-Options.
- nosniff - Stops the browser guessing a file is a script.
- Cache-Control - private behind a login, no-store for sensitive data, so a CDN never replays it to someone else.
- No stack traces in production - They hand over your framework, paths and queries.
- Remove X-Powered-By - Smallest item here, and free.

## Secrets
- Env vars only - And check your git history, not just current files.
- No secret in frontend code - NEXT_PUBLIC_ and VITE_ variables ship to the browser. Search your build output.
- Block dotfiles and backups - /.env, /.git and stray .zip files must 404. Scanners check these within minutes of launch.
- Sourcemaps off in production - Or your source is one click away in DevTools.
- Least privilege - Narrowest permissions on your database user and API keys. Not admin.
- Encrypt third-party tokens at rest - The tokens your users hand you for their own accounts are theirs, not yours.
- Do not roll your own crypto - Use the platform library.
- Rotate any leaked secret - Once it is in a repo or a screenshot, it is burned.

## Infrastructure
- Remove test and default accounts - The seeded admin with the obvious password.
- No public debug endpoints - API docs, database panels, health checks that dump config.
- Firewall your origin - Behind Cloudflare, block direct hits to the server IP or your WAF is skipped.
- Memory cap on the process - One heavy request should not take the server down.
- Update dependencies - npm audit, commit your lockfile, turn on Dependabot. Most breaches come through a package.
- Automated offsite backups - Nightly, encrypted, with retention.
- Actually test a restore - A backup you never restored is a guess.
- Audit log - Who changed what, when. You need it exactly once.
- Do not log personal data - Logs get copied and shared. No passwords, tokens or full request bodies.
- Alerting - Learn about the 500s before your users tell you.
- Security contact - Somewhere for a researcher to report a hole instead of posting it.

## The legal pages
- Terms of service - What the service is, what users may not do, when you can suspend an account, and your liability limits. A disclaimer does not override consumer law.
- Privacy policy - What you collect, why, how long, and how to get it deleted. Legally required almost everywhere once you handle personal data.
- Sub-processor list - Every company that touches user data. Email sender, storage, AI provider, analytics. One new API call adds one company.
- Cookie disclosure - A session cookie needs disclosing, not consent. Analytics and ad cookies need consent.
- Refund policy - Say plainly whether refunds exist. A blanket "no refunds" does not remove statutory rights.
- Data processing terms - Required if your users put their own customers' data in your app.
- Export and deletion - The right to get data out, and to be forgotten.
- Date each document separately - And only when that document actually changes.

## Money
- One path to access - Exactly one place in your code grants a paid plan.
- Recompute totals server-side - The amount in the request is something the user typed.
- Verify webhook signatures - Anyone can POST to your payment webhook and claim an order was paid.
- Idempotency keys - A double-click must not charge or grant twice.
- Test with two accounts - Log in as A, copy an ID, try to open it as B. This one manual test finds more real holes than any scanner.