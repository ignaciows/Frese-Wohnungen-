import { prisma } from '@/lib/prisma';

export async function markSystemTransferRegistered(input: {
  contactAttemptId: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.systemTransfer.findUniqueOrThrow({
      where: { contactAttemptId: input.contactAttemptId },
    });
    const updated = await tx.systemTransfer.update({
      where: { id: transfer.id },
      data: { registeredAt: new Date(), registeredById: input.userId },
    });
    await tx.auditEvent.create({
      data: {
        userId: input.userId,
        entityType: 'SystemTransfer',
        entityId: transfer.id,
        action: 'systemTransfer.registered',
      },
    });
    return updated;
  });
}
