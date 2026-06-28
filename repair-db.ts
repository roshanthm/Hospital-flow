import { prisma } from './src/lib/prisma.js';

// Define the set of clinical fields (same as server.ts)
const CLINICAL_FIELDS = new Set([
  'notes', 'diagnosis', 'symptoms', 'chiefComplaint', 'vitals',
  'observations', 'symptomsDetail', 'clinicalNotes', 'treatmentPlan',
  'allergies', 'prescription', 'referralReason', 'medicalHistory', 'chronicConditions'
]);

// Robust generic string sanitizer (same behavior as server.ts)
function sanitizeInputString(val: string, isClinical: boolean): string {
  if (!val) return val;
  let clean = val;

  if (isClinical) {
    // For clinical text, only remove explicit script tags, iframe/object/embed/svg tags, onEvent attributes, and javascript: links.
    // Do NOT strip generic HTML-like markers or brackets to avoid messing up medical text (like '< 120' or '> 50').
    clean = clean.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '');
    clean = clean.replace(/<script\b[^>]*>/gi, '');
    clean = clean.replace(/<\/script>/gi, '');
    clean = clean.replace(/<iframe\b[^>]*>([\s\S]*?)<\/iframe>/gi, '');
    clean = clean.replace(/<iframe\b[^>]*>/gi, '');
    clean = clean.replace(/<svg\b[^>]*>([\s\S]*?)<\/svg>/gi, '');
    clean = clean.replace(/<svg\b[^>]*>/gi, '');
    
    clean = clean.replace(/\bon\w+\s*=\s*['"`][^'"`]*['"`]/gi, '');
    clean = clean.replace(/\bon\w+\s*=\s*[^>\s]+/gi, '');
    clean = clean.replace(/javascript\s*:\s*[^"'>\s]+/gi, '');
    clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  } else {
    // 1. Remove script blocks and tags entirely
    clean = clean.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '');
    clean = clean.replace(/<script\b[^>]*>/gi, '');
    clean = clean.replace(/<\/script>/gi, '');

    // 2. Remove other dangerous tags entirely (iframe, object, embed, svg, style, link)
    clean = clean.replace(/<iframe\b[^>]*>([\s\S]*?)<\/iframe>/gi, '');
    clean = clean.replace(/<iframe\b[^>]*>/gi, '');
    clean = clean.replace(/<svg\b[^>]*>([\s\S]*?)<\/svg>/gi, '');
    clean = clean.replace(/<svg\b[^>]*>/gi, '');
    clean = clean.replace(/<object\b[^>]*>([\s\S]*?)<\/object>/gi, '');
    clean = clean.replace(/<object\b[^>]*>/gi, '');
    clean = clean.replace(/<embed\b[^>]*>/gi, '');
    clean = clean.replace(/<link\b[^>]*>/gi, '');
    clean = clean.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, '');
    clean = clean.replace(/<style\b[^>]*>/gi, '');

    // 3. Remove img tags entirely
    clean = clean.replace(/<img\b[^>]*>/gi, '');

    // 4. Remove generic html tags but preserve content
    clean = clean.replace(/<\/?([a-zA-Z]+)([^>]*?)>/g, '');

    // 5. Remove onEVENT attributes if they somehow remained
    clean = clean.replace(/\bon\w+\s*=\s*['"`][^'"`]*['"`]/gi, '');
    clean = clean.replace(/\bon\w+\s*=\s*[^>\s]+/gi, '');

    // 6. Remove javascript: links
    clean = clean.replace(/javascript\s*:\s*[^"'>\s]+/gi, '');

    // 7. Remove any null bytes or control characters except tabs, carriage returns, and newlines
    clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  return clean.trim();
}

// Special check if name is a placeholder (like "Sanitized Patient" or "Patient Pat")
function isPlaceholderName(val: string): boolean {
  if (!val) return true;
  const clean = val.trim().toLowerCase();
  return (
    clean === 'sanitized patient' ||
    clean === 'sanitized name' ||
    clean === 'patient pat' ||
    clean === 'patient pat-' ||
    clean === 'sanitized staff' ||
    clean.length < 2
  );
}

// Check if a name is valid and legitimate (no HTML, script, etc., and matches Unicode letter format)
function isLegitimateName(val: string): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  if (isPlaceholderName(trimmed)) return false;
  // Use the exact Unicode regex as server.ts to support any international names
  return /^[\p{L}\p{M}\s'\-.]+$/u.test(trimmed);
}

// Clean phone format
function cleanPhone(val: string): string {
  if (!val) return val;
  let clean = sanitizeInputString(val, false);
  clean = clean.replace(/[^0-9\s\-()+]/g, '');
  return clean.trim();
}

// Clean email format
function cleanEmail(val: string): string {
  if (!val) return val;
  let clean = sanitizeInputString(val, false).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    clean = clean.replace(/[^a-z0-9@.\-_+]/gi, '');
  }
  return clean.trim();
}

async function runRepair() {
  console.log("=== STARTING MEDFLOW STORED XSS DATA REPAIR ===");

  // Reset any temporary "Patient Pat" name from previous trials back to "Sanitized Patient"
  // to run the audit cleanly on original state
  try {
    const affectedPatients = await prisma.patient.findMany({
      where: {
        name: 'Patient Pat'
      }
    });
    for (const p of affectedPatients) {
      console.log(`[CLEANUP] Resetting Patient ID ${p.id} name from "Patient Pat" to "Sanitized Patient" for audit`);
      await prisma.patient.update({
        where: { id: p.id },
        data: { name: 'Sanitized Patient' }
      });
    }
  } catch (e) {
    console.error("Cleanup error (can ignore):", e);
  }

  const auditReport = {
    Patient: { scanned: 0, repaired: 0, unrecoverable: [] as string[] },
    User: { scanned: 0, repaired: 0, unrecoverable: [] as string[] },
    Consultation: { scanned: 0, repaired: 0 },
    PrescriptionItem: { scanned: 0, repaired: 0 },
    Referral: { scanned: 0, repaired: 0 },
    InventoryItem: { scanned: 0, repaired: 0 },
    Department: { scanned: 0, repaired: 0 },
    Appointment: { scanned: 0, repaired: 0 },
  };

  try {
    // 1. Repair Patient Table
    console.log("Auditing Patient table...");
    const patients = await prisma.patient.findMany();
    auditReport.Patient.scanned = patients.length;

    for (const p of patients) {
      let changed = false;
      const updateData: any = {};

      // If patient name is a placeholder, try to recover the original legitimate name
      if (isPlaceholderName(p.name)) {
        console.log(`[AUDIT] Found placeholder name for patient ID: ${p.id}. Attempting recovery...`);
        // Search ActivityLog for original name before sanitization
        const activityLogs = await prisma.activityLog.findMany({
          where: {
            details: {
              contains: p.id
            },
            action: 'PATIENT_OPENED'
          },
          orderBy: {
            timestamp: 'asc' // get the earliest log if possible
          }
        });

        let recoveredName = '';
        for (const log of activityLogs) {
          if (log.details) {
            // Log pattern: "Opened patient record: <Original Name> (ID: PAT-XXXXX)"
            const match = log.details.match(/Opened patient record:\s*(.*?)\s*\(ID:/);
            if (match && match[1]) {
              const nameCandidate = sanitizeInputString(match[1], false);
              if (isLegitimateName(nameCandidate)) {
                recoveredName = nameCandidate;
                break;
              }
            }
          }
        }

        if (recoveredName) {
          console.log(`[RECOVERED] Successfully recovered legitimate name: "${recoveredName}" for Patient ID: ${p.id}`);
          updateData.name = recoveredName;
          changed = true;
        } else {
          // Unrecoverable! We MUST NOT modify the database with fallback/placeholder names
          console.log(`[UNRECOVERABLE] Could not recover legitimate name for Patient ID: ${p.id}. Leaving unchanged.`);
          auditReport.Patient.unrecoverable.push(`Patient ID: ${p.id} (Current name: "${p.name}") | Original name was purely malicious or unrecoverable.`);
        }
      } else {
        // Legitimate name already. Run sanitization and make sure we don't alter it unless it had some weird tags/chars
        const cleaned = sanitizeInputString(p.name, false);
        if (cleaned !== p.name && isLegitimateName(cleaned)) {
          updateData.name = cleaned;
          changed = true;
        }
      }

      // Check and sanitize emergencyContactName if it exists
      if (p.emergencyContactName) {
        if (isPlaceholderName(p.emergencyContactName)) {
          // If it's placeholder, do NOT replace with another placeholder unless recoverable. Here, leave unchanged.
        } else {
          const cleaned = sanitizeInputString(p.emergencyContactName, false);
          if (cleaned !== p.emergencyContactName && isLegitimateName(cleaned)) {
            updateData.emergencyContactName = cleaned;
            changed = true;
          }
        }
      }

      if (p.phone) {
        const newPhone = cleanPhone(p.phone);
        if (newPhone !== p.phone) {
          updateData.phone = newPhone;
          changed = true;
        }
      }

      if (p.emergencyContactPhone) {
        const newEmergPhone = cleanPhone(p.emergencyContactPhone);
        if (newEmergPhone !== p.emergencyContactPhone) {
          updateData.emergencyContactPhone = newEmergPhone;
          changed = true;
        }
      }

      if (p.email) {
        const newEmail = cleanEmail(p.email);
        if (newEmail !== p.email) {
          updateData.email = newEmail;
          changed = true;
        }
      }

      // Text fields
      const textFields = ['address', 'medicalHistory', 'chronicConditions', 'allergies', 'bloodPressure', 'weight', 'temperature'];
      for (const field of textFields) {
        const currentVal = (p as any)[field];
        if (currentVal) {
          const isClinical = CLINICAL_FIELDS.has(field);
          const cleanedVal = sanitizeInputString(currentVal, isClinical);
          if (cleanedVal !== currentVal) {
            updateData[field] = cleanedVal;
            changed = true;
          }
        }
      }

      // Gender normalization
      if (p.gender) {
        const upper = p.gender.toUpperCase().trim();
        let normalizedGender = p.gender;
        if (upper === 'M' || upper === 'MALE') {
          normalizedGender = 'M';
        } else if (upper === 'F' || upper === 'FEMALE') {
          normalizedGender = 'F';
        } else if (upper === 'O' || upper === 'OTHER') {
          normalizedGender = 'O';
        }

        if (normalizedGender !== p.gender) {
          updateData.gender = normalizedGender;
          changed = true;
        }
      }

      if (changed) {
        console.log(`[REPAIRING] Patient ID: ${p.id} | Changes:`, JSON.stringify(updateData));
        await prisma.patient.update({
          where: { id: p.id },
          data: updateData
        });
        auditReport.Patient.repaired++;
      }
    }

    // 2. Repair User Table
    console.log("Auditing User table...");
    const users = await prisma.user.findMany();
    auditReport.User.scanned = users.length;
    for (const u of users) {
      let changed = false;
      const updateData: any = {};

      if (isPlaceholderName(u.name)) {
        // Do not fabricate names! Leave unchanged and put in report.
        auditReport.User.unrecoverable.push(`User ID: ${u.id} (Current name: "${u.name}") | Unrecoverable placeholder name.`);
      } else {
        const cleaned = sanitizeInputString(u.name, false);
        if (cleaned !== u.name && isLegitimateName(cleaned)) {
          updateData.name = cleaned;
          changed = true;
        }
      }

      if (u.email) {
        const newEmail = cleanEmail(u.email);
        if (newEmail !== u.email) {
          updateData.email = newEmail;
          changed = true;
        }
      }

      if (u.phone) {
        const newPhone = cleanPhone(u.phone);
        if (newPhone !== u.phone) {
          updateData.phone = newPhone;
          changed = true;
        }
      }

      const textFields = ['notes', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'];
      for (const field of textFields) {
        const currentVal = (u as any)[field];
        if (currentVal) {
          const isClinical = CLINICAL_FIELDS.has(field);
          const cleanedVal = sanitizeInputString(currentVal, isClinical);
          if (cleanedVal !== currentVal) {
            updateData[field] = cleanedVal;
            changed = true;
          }
        }
      }

      if (changed) {
        console.log(`[REPAIRING] User ID: ${u.id} | Changes:`, JSON.stringify(updateData));
        await prisma.user.update({
          where: { id: u.id },
          data: updateData
        });
        auditReport.User.repaired++;
      }
    }

    // 3. Repair Consultation Table
    console.log("Auditing Consultation table...");
    const consultations = await prisma.consultation.findMany();
    auditReport.Consultation.scanned = consultations.length;
    for (const c of consultations) {
      let changed = false;
      const updateData: any = {};

      const textFields = [
        'notes', 'diagnosis', 'symptoms', 'chiefComplaint', 'vitals',
        'allergies', 'observations', 'chronicConditions', 'referral'
      ];
      for (const field of textFields) {
        const currentVal = (c as any)[field];
        if (currentVal) {
          const isClinical = CLINICAL_FIELDS.has(field);
          const cleanedVal = sanitizeInputString(currentVal, isClinical);
          if (cleanedVal !== currentVal) {
            updateData[field] = cleanedVal;
            changed = true;
          }
        }
      }

      if (changed) {
        console.log(`[REPAIRING] Consultation ID: ${c.id} | Changes:`, JSON.stringify(updateData));
        await prisma.consultation.update({
          where: { id: c.id },
          data: updateData
        });
        auditReport.Consultation.repaired++;
      }
    }

    // 4. Repair PrescriptionItem Table
    console.log("Auditing PrescriptionItem table...");
    const piItems = await prisma.prescriptionItem.findMany();
    auditReport.PrescriptionItem.scanned = piItems.length;
    for (const pi of piItems) {
      let changed = false;
      const updateData: any = {};

      const textFields = ['medicine', 'dosage', 'frequency', 'duration', 'instructions'];
      for (const field of textFields) {
        const currentVal = (pi as any)[field];
        if (currentVal) {
          const isClinical = CLINICAL_FIELDS.has(field);
          const cleanedVal = sanitizeInputString(currentVal, isClinical);
          if (cleanedVal !== currentVal) {
            updateData[field] = cleanedVal;
            changed = true;
          }
        }
      }

      if (changed) {
        console.log(`[REPAIRING] PrescriptionItem ID: ${pi.id} | Changes:`, JSON.stringify(updateData));
        await prisma.prescriptionItem.update({
          where: { id: pi.id },
          data: updateData
        });
        auditReport.PrescriptionItem.repaired++;
      }
    }

    // 5. Repair Referral Table
    console.log("Auditing Referral table...");
    const referrals = await prisma.referral.findMany();
    auditReport.Referral.scanned = referrals.length;
    for (const r of referrals) {
      let changed = false;
      const updateData: any = {};

      if (r.reason) {
        const isClinical = CLINICAL_FIELDS.has('referralReason');
        const cleanedVal = sanitizeInputString(r.reason, isClinical);
        if (cleanedVal !== r.reason) {
          updateData.reason = cleanedVal;
          changed = true;
        }
      }

      if (changed) {
        console.log(`[REPAIRING] Referral ID: ${r.id} | Changes:`, JSON.stringify(updateData));
        await prisma.referral.update({
          where: { id: r.id },
          data: updateData
        });
        auditReport.Referral.repaired++;
      }
    }

    // 6. Repair InventoryItem Table
    console.log("Auditing InventoryItem table...");
    const inventoryItems = await prisma.inventoryItem.findMany();
    auditReport.InventoryItem.scanned = inventoryItems.length;
    for (const item of inventoryItems) {
      let changed = false;
      const updateData: any = {};

      const textFields = ['name', 'genericName', 'brandName', 'type', 'dosage', 'unit', 'shelfLocation'];
      for (const field of textFields) {
        const currentVal = (item as any)[field];
        if (currentVal) {
          const isClinical = CLINICAL_FIELDS.has(field);
          const cleanedVal = sanitizeInputString(currentVal, isClinical);
          if (cleanedVal !== currentVal) {
            updateData[field] = cleanedVal;
            changed = true;
          }
        }
      }

      if (changed) {
        console.log(`[REPAIRING] InventoryItem ID: ${item.id} | Changes:`, JSON.stringify(updateData));
        await prisma.inventoryItem.update({
          where: { id: item.id },
          data: updateData
        });
        auditReport.InventoryItem.repaired++;
      }
    }

    // 7. Repair Department Table
    console.log("Auditing Department table...");
    const departments = await prisma.department.findMany();
    auditReport.Department.scanned = departments.length;
    for (const d of departments) {
      let changed = false;
      const updateData: any = {};

      if (d.name) {
        const isClinical = CLINICAL_FIELDS.has('department');
        const cleanedVal = sanitizeInputString(d.name, isClinical);
        if (cleanedVal !== d.name) {
          updateData.name = cleanedVal;
          changed = true;
        }
      }

      if (changed) {
        console.log(`[REPAIRING] Department ID: ${d.id} | Changes:`, JSON.stringify(updateData));
        await prisma.department.update({
          where: { id: d.id },
          data: updateData
        });
        auditReport.Department.repaired++;
      }
    }

    // 8. Repair Appointment Table
    console.log("Auditing Appointment table...");
    const appointments = await prisma.appointment.findMany();
    auditReport.Appointment.scanned = appointments.length;
    for (const appt of appointments) {
      let changed = false;
      const updateData: any = {};

      const textFields = ['time', 'status'];
      for (const field of textFields) {
        const currentVal = (appt as any)[field];
        if (currentVal) {
          const isClinical = CLINICAL_FIELDS.has(field);
          const cleanedVal = sanitizeInputString(currentVal, isClinical);
          if (cleanedVal !== currentVal) {
            updateData[field] = cleanedVal;
            changed = true;
          }
        }
      }

      if (changed) {
        console.log(`[REPAIRING] Appointment ID: ${appt.id} | Changes:`, JSON.stringify(updateData));
        await prisma.appointment.update({
          where: { id: appt.id },
          data: updateData
        });
        auditReport.Appointment.repaired++;
      }
    }

    console.log("=== MEDFLOW STORED XSS DATA REPAIR COMPLETE ===");
    console.log("Audit Report:", JSON.stringify(auditReport, null, 2));

  } catch (err) {
    console.error("Critical error during stored XSS data repair:", err);
  } finally {
    await prisma.$disconnect();
  }
}

runRepair();
