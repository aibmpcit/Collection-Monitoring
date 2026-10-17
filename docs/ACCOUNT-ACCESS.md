# Account roles and permissions

Super admins can create or edit accounts in **Accounts**, choose Collector, Branch Admin, or Loan Account Specialist (LAS), and select account access:

- Import collections
- Add loan remarks
- Add loan payments

LAS accounts do field work like collectors: by default they can add loan remarks and payments and update their own payments. Enabling **Import collections** lets that specific LAS account import loan data for its assigned branch. It does not grant account administration, loan deletion, or manual loan creation.

Managers upload each branch's updated overdue list once a week; Collections shows a reminder when the latest list is more than 7 days old. Each upload is checked first and saved only after confirming. Any loan account that is not on the branch's updated list moves to the **Settled Accounts** tab on Collection Records (its payments and remarks stay in history), and a settled loan that reappears in a later upload returns to Collections. The option **Move loans that are not in this file to Settled Accounts** is on by default; untick it only when uploading a partial file. Loans deleted by an admin are archived separately and never appear as settled. Settled Accounts is available to super admins, branch admins and LAS.

Remark columns: during testing (`REMARK_IMPORT_ONCE=false`) every import brings them in and skips remarks already stored. At go-live set `REMARK_IMPORT_ONCE=true`: remarks are then imported only once per branch, on its first import by a super admin, after which the branch is locked and remarks are added by users. Branch admins can edit or delete any remark in their branch; collectors and LAS can edit or delete only their own.

Collectors retain their existing defaults (adding remarks and payments). Branch admins retain all three permissions by default. A super admin can override these defaults for an individual account or use **Use role defaults** to clear overrides. Other existing permissions still follow the selected role.

**Loan status (from payments):** when collectors, LAS or admins record a payment they must choose its type, **Partially Paid** or **Settled**, and add proof: a camera photo or an attached file, together with the phone's location (a payment can't be saved without a location). Remarks offer the same two steps (photo or file, and current location) but both are optional.

Changing a role does not delete the account's payment or remark history. Role editing does not offer super-admin promotion, and super-admin accounts cannot be edited through this form.

API requests reload the account's current role, branch, and permissions from the database. Permission revocations apply immediately to new requests, including existing sessions. The UI refreshes account access on window focus and every 30 seconds.

## Database update

The migration adds `las` to the users role enum and a JSON permissions column without modifying existing account permissions or loan history. Docker startup and `npm run dev:server` run this migration automatically. For a manually started production server, run:

```sh
npm run build
npm run migrate --workspace server
```

Then restart the server.
