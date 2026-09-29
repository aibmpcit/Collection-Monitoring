# Account roles and permissions

Super admins can create or edit accounts in **Accounts**, choose Collector, Branch Admin, or Loan Account Specialist (LAS), and select account access:

- Import collections
- Add loan remarks
- Add loan payments

LAS accounts can read branch loan data by default. Enabling **Import collections** lets that specific LAS account import loan data for its assigned branch. It does not grant account administration, loan deletion, manual loan creation, or bulk remarks import. Remarks import remains super-admin only.

Collectors retain their existing defaults (adding remarks and payments). Branch admins retain all three permissions by default. A super admin can override these defaults for an individual account or use **Use role defaults** to clear overrides. Other existing permissions still follow the selected role.

Changing a role does not delete the account's payment or remark history. Role editing does not offer super-admin promotion, and super-admin accounts cannot be edited through this form.

API requests reload the account's current role, branch, and permissions from the database. Permission revocations apply immediately to new requests, including existing sessions. The UI refreshes account access on window focus and every 30 seconds.

## Database update

The migration adds `las` to the users role enum and a JSON permissions column without modifying existing account permissions or loan history. Docker startup and `npm run dev:server` run this migration automatically. For a manually started production server, run:

```sh
npm run build
npm run migrate --workspace server
```

Then restart the server.
