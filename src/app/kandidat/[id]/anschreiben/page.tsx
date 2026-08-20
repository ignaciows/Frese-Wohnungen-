import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { MessageEditor } from '@/app/_components/MessageEditor';
import { Callout } from '@/app/_components/Shell';

export const dynamic = 'force-dynamic';

export default async function AnschreibenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Gefragt wird nach dem Fall, nicht nach dem Anschreiben.
  //
  // Vorher hing die Seite am Anschreiben-Datensatz und zeigte „404", wenn es
  // ihn nicht gab. Angelegt wird er zwar beim Anlegen des Falls mit — aber ein
  // Fall, der auf einem anderen Weg entstanden ist, hat keinen, und dann
  // antwortet ausgerechnet der Bildschirm mit „Seite nicht gefunden", auf den
  // das Anlegen direkt weiterleitet. Ein fehlendes Anschreiben ist kein
  // fehlender Fall, sondern ein leeres Feld.
  const fall = await prisma.candidateCase.findUnique({
    where: { id },
    select: { applicationMessage: { select: { body: true } } },
  });
  if (!fall) notFound();
  const body = fall.applicationMessage?.body ?? '';

  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <Callout tone="info">
        Das Anschreiben wird woanders erstellt (z. B. mit ChatGPT) und hier nur eingefügt. Die App schreibt
        keine Texte und verschickt nichts automatisch.
      </Callout>

      <MessageEditor candidateCaseId={id} initialBody={body} />

      <div className="row-between">
        <Link href={`/kandidat/${id}`} className="btn">
          ← Zurück zur Übersicht
        </Link>
        <Link href={`/kandidat/${id}/profil`} className="btn primary">
          Weiter: Suchprofil →
        </Link>
      </div>
    </div>
  );
}
