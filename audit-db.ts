import { prisma } from './src/lib/prisma.js';

const MALICIOUS_PATTERNS = [
  /<script/i,
  /<\/script/i,
  /javascript:/i,
  /onerror\s*=/i,
  /onload\s*=/i,
  /onclick\s*=/i,
  /<img/i,
  /<svg/i,
  /iframe/i
];

function isSuspicious(val: any): boolean {
  if (typeof val !== 'string') return false;
  return MALICIOUS_PATTERNS.some(pat => pat.test(val));
}

async function audit() {
  console.log("Starting DB audit for malicious payloads...");
  try {
    // 1. Patient Table
    const patients = await prisma.patient.findMany();
    for (const p of patients) {
      for (const [key, val] of Object.entries(p)) {
        if (isSuspicious(val)) {
          console.log(`[SUSPICIOUS] Patient ID: ${p.id} | Field: ${key} | Value: ${val}`);
        }
      }
    }

    // 2. User Table
    const users = await prisma.user.findMany();
    for (const u of users) {
      for (const [key, val] of Object.entries(u)) {
        if (isSuspicious(val)) {
          console.log(`[SUSPICIOUS] User ID: ${u.id} | Field: ${key} | Value: ${val}`);
        }
      }
    }

    // 3. Consultation Table
    const consultations = await prisma.consultation.findMany();
    for (const c of consultations) {
      for (const [key, val] of Object.entries(c)) {
        if (isSuspicious(val)) {
          console.log(`[SUSPICIOUS] Consultation ID: ${c.id} | Field: ${key} | Value: ${val}`);
        }
      }
    }

    // 4. Prescription Table
    const prescriptions = await prisma.prescription.findMany();
    for (const pr of prescriptions) {
      for (const [key, val] of Object.entries(pr)) {
        if (isSuspicious(val)) {
          console.log(`[SUSPICIOUS] Prescription ID: ${pr.id} | Field: ${key} | Value: ${val}`);
        }
      }
    }

    // 5. PrescriptionItem Table
    const prescriptionItems = await prisma.prescriptionItem.findMany();
    for (const pi of prescriptionItems) {
      for (const [key, val] of Object.entries(pi)) {
        if (isSuspicious(val)) {
          console.log(`[SUSPICIOUS] PrescriptionItem ID: ${pi.id} | Field: ${key} | Value: ${val}`);
        }
      }
    }

    // 6. Referral Table
    const referrals = await prisma.referral.findMany();
    for (const r of referrals) {
      for (const [key, val] of Object.entries(r)) {
        if (isSuspicious(val)) {
          console.log(`[SUSPICIOUS] Referral ID: ${r.id} | Field: ${key} | Value: ${val}`);
        }
      }
    }

    // 7. InventoryItem Table
    const inventoryItems = await prisma.inventoryItem.findMany();
    for (const item of inventoryItems) {
      for (const [key, val] of Object.entries(item)) {
        if (isSuspicious(val)) {
          console.log(`[SUSPICIOUS] InventoryItem ID: ${item.id} | Field: ${key} | Value: ${val}`);
        }
      }
    }

    // 8. Department Table
    const departments = await prisma.department.findMany();
    for (const d of departments) {
      for (const [key, val] of Object.entries(d)) {
        if (isSuspicious(val)) {
          console.log(`[SUSPICIOUS] Department ID: ${d.id} | Field: ${key} | Value: ${val}`);
        }
      }
    }

    // 9. Appointment Table
    const appointments = await prisma.appointment.findMany();
    for (const appt of appointments) {
      for (const [key, val] of Object.entries(appt)) {
        if (isSuspicious(val)) {
          console.log(`[SUSPICIOUS] Appointment ID: ${appt.id} | Field: ${key} | Value: ${val}`);
        }
      }
    }

    console.log("Audit complete!");
  } catch (error) {
    console.error("Error during DB audit:", error);
  } finally {
    await prisma.$disconnect();
  }
}

audit();
