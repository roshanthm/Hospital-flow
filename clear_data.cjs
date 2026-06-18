const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearData() {
  await prisma.activityLog.deleteMany({});
  await prisma.billItem.deleteMany({});
  await prisma.bill.deleteMany({});
  await prisma.pharmacyDispensingLog.deleteMany({});
  await prisma.pharmacyQueue.deleteMany({});
  await prisma.prescriptionItem.deleteMany({});
  await prisma.prescription.deleteMany({});
  
  // also the new models
  if (prisma.labRequest) await prisma.labRequest.deleteMany({});
  if (prisma.referral) await prisma.referral.deleteMany({});
  
  await prisma.consultation.deleteMany({});
  await prisma.visitRecord.deleteMany({});
  await prisma.doctorQueue.deleteMany({});
  
  console.log("Cleared all doctor/consultation/pharmacy records.");
}

clearData()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
