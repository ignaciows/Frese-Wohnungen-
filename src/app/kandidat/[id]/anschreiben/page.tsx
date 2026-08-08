import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { MessageEditor } from '@/app/_components/MessageEditor';
import { Callout } from '@/app/_components/Shell';

export const dynamic = 'force-dynamic';

export default async function AnschreibenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const message = await prisma.applicationMessage.findUnique({ where: { candidateCaseId: id } });
  if (!message) notFound();

  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <Callout tone="info">
        Das Anschreiben wird woanders erstellt (z. B. mit ChatGPT) und hier nur eingefügt. Die App schreibt
        keine Texte und verschickt nichts automatisch.
      </Callout>

      <MessageEditor candidateCaseId={id} initialBody={message.body} />

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
