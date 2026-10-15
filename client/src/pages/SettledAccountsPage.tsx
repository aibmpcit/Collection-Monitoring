import { PageHeader } from "../components/PageHeader";
import { PageMetaStamp } from "../components/PageMetaStamp";
import { SettledAccountsPanel } from "./loans/SettledAccountsPanel";

/** Standalone view of the Collections "Settled Accounts" tab (kept for direct links). */
export function SettledAccountsPage() {
  return (
    <main className="page-shell">
      <PageHeader title="Settled Accounts" eyebrow="Collections" actions={<PageMetaStamp />} />
      <section className="panel p-4">
        <SettledAccountsPanel />
      </section>
    </main>
  );
}
