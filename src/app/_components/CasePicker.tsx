'use client';
import { useRouter } from 'next/navigation';

interface Props {
  cases: Array<{ id: string; reference: string; displayName: string; status: string }>;
  selectedCaseId: string | null;
}

export function CasePicker({ cases, selectedCaseId }: Props) {
  const router = useRouter();
  return (
    <select
      defaultValue={selectedCaseId ?? ''}
      onChange={(e) => router.push(`/?case=${e.currentTarget.value}`)}
      className="input"
      style={{ width: 260 }}
      aria-label="Kandidat auswählen"
    >
      {cases.map((c) => (
        <option key={c.id} value={c.id}>
          {c.reference} — {c.displayName}
          {c.status === 'ARCHIVED' ? ' (archiviert)' : ''}
        </option>
      ))}
    </select>
  );
}
