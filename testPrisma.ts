import { prisma } from './src/lib/prisma.js';

async function run() {
  const whereClause: any = { createdAt: { gte: new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000) } };
  
  try {
    console.log("Testing findMany patient...");
    await prisma.patient.findMany({ where: whereClause, select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 2 });
    
    console.log("Testing findMany token...");
    await prisma.token.findMany({ where: whereClause, select: { id: true, tokenNumber: true, createdAt: true, patient: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 2 });
    
    console.log("Testing findMany consultation...");
    await prisma.consultation.findMany({ where: whereClause, select: { id: true, createdAt: true, visitRecord: { select: { token: { select: { tokenNumber: true } } } }, doctor: { select: { name: true } }, patient: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 2 });
    
    console.log("Testing findMany prescription...");
    await prisma.prescription.findMany({ where: whereClause, select: { id: true, createdAt: true, status: true, patient: { select: { name: true } }, items: { select: { medicine: true } } }, orderBy: { createdAt: 'desc' }, take: 2 });
    
    console.log("Testing findMany bill...");
    await prisma.bill.findMany({ where: whereClause, select: { id: true, createdAt: true, total: true, status: true, patient: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 2 });
    
    // Test the first big Promise.all from the API
    console.log("Testing the large Promise.all...");
    await Promise.all([
        prisma.bill.groupBy({
          by: ['status'],
          where: whereClause,
          _count: { id: true },
          _sum: { total: true }
        }),
        prisma.consultation.count({ where: whereClause }),
        prisma.prescription.count({
          where: { ...whereClause, status: 'DISPENSED' }
        }),
        prisma.patient.count({ where: whereClause }),
        prisma.user.count({ where: { role: 'DOCTOR', isActive: true, dutyStatus: { in: ['ON DUTY', 'ON_DUTY'] } } }),
        prisma.user.count({ where: { role: 'DOCTOR', isActive: true } }),
        prisma.token.count({
          where: { ...whereClause, status: { in: ['WAITING', 'IN_CONSULTATION', 'SENT_TO_PHARMACY'] } }
        }),
        prisma.token.findMany({
          where: { ...whereClause, visitRecord: { consultation: { isNot: null } } },
          select: {
            createdAt: true,
            visitRecord: { select: { consultation: { select: { createdAt: true } } } }
          },
          orderBy: { createdAt: 'desc' },
          take: 500
        })
    ]);
    
    console.log("All OK!");
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
