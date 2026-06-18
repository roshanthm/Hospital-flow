import { prisma } from './src/lib/prisma.js';

async function clearData() {
  await prisma.activityLog.deleteMany({});
  await prisma.billItem.deleteMany({});
  await prisma.bill.deleteMany({});
  await prisma.pharmacyDispensingLog.deleteMany({});
  await prisma.pharmacyQueue.deleteMany({});
  await prisma.prescriptionItem.deleteMany({});
  await prisma.prescription.deleteMany({});
  
  if (prisma.labRequest) await prisma.labRequest.deleteMany({});
  if (prisma.referral) await prisma.referral.deleteMany({});
  
  await prisma.medicalHistory.deleteMany({});
  await prisma.consultation.deleteMany({});
  await prisma.visitRecord.deleteMany({});
  await prisma.doctorQueue.deleteMany({});
  
  // optionally set all tokens to waiting, so they are not stuck in consultation
  await prisma.token.updateMany({
    data: { status: 'WAITING' }
  });
  
  console.log("Cleared all doctor/consultation/pharmacy records.");
}

clearData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
