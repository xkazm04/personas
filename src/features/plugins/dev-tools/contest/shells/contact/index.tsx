// STUB — WP5 replaces this body with the "contact" prototype shell. It exists so
// the page renders before the shells land: the ledger and the setup form in a
// plain column. A shell takes NO props; it reads the hooks and `../../focus`.
import { ContestLedgerList } from '../../components/ContestLedgerList';
import { SetupForm } from '../../components/SetupForm';

export default function ContactSheetShell() {
  return (
    <div className="space-y-6" data-testid="contest-shell-contact">
      <ContestLedgerList />
      <SetupForm />
    </div>
  );
}
