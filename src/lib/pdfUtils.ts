import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Bill } from '../types';

// Global clinical rule to evaluate high-risk / critical patient alerts derived entirely from database columns
export const isPatientHighRisk = (patient: any): boolean => {
  if (!patient) return false;

  // 1. Check direct priority fields from the latest token
  const tokenPriority = (patient.latestToken?.priority || patient.tokens?.[0]?.priority || '') as string;
  if (tokenPriority) {
    const tpLower = tokenPriority.toLowerCase();
    if (tpLower === 'critical' || tpLower === 'high' || tpLower === 'urgent' || tpLower === 'emergency') {
      return true;
    }
    if (tpLower === 'low' || tpLower === 'medium' || tpLower === 'normal' || tpLower === 'standard' || tpLower === 'routine') {
      return false;
    }
  }

  // 2. Check priority from the latest consultation's token priority
  const consultPriority = (patient.latestConsultation?.visitRecord?.token?.priority || '') as string;
  if (consultPriority) {
    const cpLower = consultPriority.toLowerCase();
    if (cpLower === 'critical' || cpLower === 'high' || cpLower === 'urgent' || cpLower === 'emergency') {
      return true;
    }
    if (cpLower === 'low' || cpLower === 'medium' || cpLower === 'normal' || cpLower === 'standard' || cpLower === 'routine') {
      return false;
    }
  }

  // 3. Check medical history string/priority field
  const hist = (patient.medicalHistory || '').toLowerCase();
  
  // Extract explicit priority level from database medical history payload
  const match = hist.match(/priority:\s*([a-z\-]+)/i);
  if (match) {
    const pVal = match[1].trim().toLowerCase();
    
    // Explicit exclusions for low, medium, and normal priority levels
    if (pVal === 'low' || pVal === 'medium' || pVal === 'normal' || pVal === 'standard' || pVal === 'routine') {
      return false;
    }
    // High-priority markers always classify as clinically high risk
    if (pVal === 'high' || pVal === 'urgent' || pVal === 'critical' || pVal === 'emergency') {
      return true;
    }
  }

  return false;
};

export const generateBillPDF = (bill: Bill) => {
  const doc = new jsPDF();
  const patientName = bill.patient?.name || 'Unknown Patient';
  
  // Header
  doc.setFontSize(22);
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text('HOSPITAL PHARMACY', 14, 22);
  
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text('INVOICE / DISPENSING RECORD', 14, 28);
  
  // Bill Info
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(`Invoice ID: ${bill.id.toUpperCase()}`, 14, 45);
  doc.text(`Date: ${new Date(bill.createdAt).toLocaleString()}`, 14, 50);
  doc.text(`Status: ${bill.status}`, 14, 55);
  
  // Patient Info
  doc.setFontSize(12);
  doc.text('BILL TO:', 140, 45);
  doc.setFontSize(10);
  doc.text(patientName, 140, 50);
  doc.text(`Token: ${bill.tokenNumber}`, 140, 55);
  doc.text(`Patient ID: P-${bill.patientId.toUpperCase().slice(0, 8)}`, 140, 60);

  // Table
  const tableRows = bill.items.map((item, index) => [
    index + 1,
    item.name,
    item.quantity,
    `INR ${item.unitPrice.toFixed(2)}`,
    `INR ${item.total.toFixed(2)}`
  ]);

  autoTable(doc, {
    startY: 70,
    head: [['#', 'Medicine / Item', 'Qty', 'Unit Price', 'Total']],
    body: tableRows,
    theme: 'striped',
    headStyles: { fillColor: [4, 45, 114] },
    styles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 80 },
      2: { cellWidth: 20, halign: 'center' },
      3: { cellWidth: 40, halign: 'right' },
      4: { cellWidth: 40, halign: 'right' }
    }
  });

  const finalY = (doc as any).lastAutoTable.finalY + 10;
  
  // Totals
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Subtotal: INR ${bill.subtotal.toFixed(2)}`, 140, finalY);
  doc.text(`Tax (5%): INR ${bill.tax.toFixed(2)}`, 140, finalY + 5);
  doc.text(`Grand Total: INR ${bill.total.toFixed(2)}`, 140, finalY + 10);

  // Footer
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('Vitalis Healthcare - Computer Generated Automated Invoice', 105, 285, { align: 'center' });

  doc.save(`Invoice_${bill.tokenNumber}_${bill.id.slice(-6).toUpperCase()}.pdf`);
};

export const generateHistoryPDF = (logs: any[]) => {
  const doc = new jsPDF();
  
  doc.setFontSize(20);
  doc.text('SYSTEM ACTIVITY AUDIT TRAIL', 14, 20);
  
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 26);
  
  const rows = logs.map((log, index) => [
    index + 1,
    new Date(log.timestamp).toLocaleString(),
    log.user || 'System',
    log.action,
    log.details || ''
  ]);

  autoTable(doc, {
    startY: 32,
    head: [['#', 'Timestamp', 'Operator', 'Action Event', 'Details']],
    body: rows,
    headStyles: { fillColor: [71, 85, 105] },
    styles: { fontSize: 8.5 }
  });

  doc.save(`Activity_Audit_Logs_${new Date().toISOString().split('T')[0]}.pdf`);
};

export const generateAllBillsPDF = (bills: Bill[]) => {
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape layout is perfect for displaying additional columns cleanly
  
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text('HOSPITAL FINANCIAL LEDGER & DISPENSING SERVICE LOGS', 14, 20);
  
  doc.setFontSize(9);
  doc.setTextColor(115, 125, 140);
  doc.text(`Billing Summary generated on: ${new Date().toLocaleString()} | Total Transactions: ${bills.length}`, 14, 26);
  
  const rows = bills.map((b, index) => {
    const medicinesDetail = b.items && b.items.length > 0
      ? b.items.map(item => `${item.name} (Qty: ${item.quantity})`).join('\n')
      : 'No medicines assigned';

    return [
      index + 1,
      b.id.toUpperCase().slice(-8),
      new Date(b.createdAt).toLocaleDateString(),
      b.patient?.name || 'Unknown Patient',
      b.tokenNumber,
      medicinesDetail,
      `INR ${b.total.toFixed(2)}`,
      b.status
    ];
  });

  autoTable(doc, {
    startY: 32,
    head: [['#', 'Invoice Ref', 'Date', 'Patient Name', 'Token #', 'Pre-authorized Medicines', 'Grand Total', 'Status']],
    body: rows,
    headStyles: { fillColor: [30, 41, 59] },
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 22 },
      2: { cellWidth: 25 },
      3: { cellWidth: 38 },
      4: { cellWidth: 20 },
      5: { cellWidth: 105 }, // Generous width for medicine item descriptors
      6: { cellWidth: 28, halign: 'right' },
      7: { cellWidth: 22 }
    }
  });

  doc.save(`Financial_Ledger_Summary_${new Date().toISOString().split('T')[0]}.pdf`);
};

export interface TokenPdfData {
  tokenNumber: string;
  patientName: string;
  patientId?: string;
  phone?: string;
  doctorName: string;
  department: string;
  priority?: string;
  createdAt?: string | Date;
  isHighRisk?: boolean;
}

export const generateTokenPDF = (data: TokenPdfData) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [100, 160] // perfectly fits thermal ticket sizing
  });

  const createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
  const dateStr = createdAt.toLocaleDateString();
  const timeStr = createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Draw Background and border
  doc.setDrawColor(0, 45, 114); // Deep Navy Primary
  doc.setLineWidth(1);
  doc.rect(4, 4, 92, 152); // border

  // Hospital Branding
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0, 45, 114);
  doc.text('VITALIS HEALTHCARE', 50, 15, { align: 'center' });
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('MAIN CLINICAL ENTRANCE RECEPTION', 50, 20, { align: 'center' });
  doc.text('Phone: +1 (555) 304-9210 | Vitalis Hub', 50, 24, { align: 'center' });

  // Divider
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.5);
  doc.line(10, 28, 90, 28);

  // Queue Label
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('CONSULTATION QUEUE TICKET', 50, 33, { align: 'center' });

  // Token ID / Token Number Huge Display
  doc.setFontSize(32);
  doc.setTextColor(0, 26, 72);
  doc.text(data.tokenNumber, 50, 48, { align: 'center' });

  // Priority and High Risk badge
  const priority = data.priority || 'Medium';
  const highRisk = data.isHighRisk || false;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  if (highRisk) {
    doc.setTextColor(186, 26, 26); // red alert
    doc.text(`CRITICAL ALERT: HIGH CLINICAL RISK`, 50, 55, { align: 'center' });
  } else {
    if (priority.toLowerCase() === 'urgent' || priority.toLowerCase() === 'high') {
      doc.setTextColor(186, 26, 26); // red
    } else {
      doc.setTextColor(0, 106, 97); // green
    }
    doc.text(`${priority.toUpperCase()} PRIORITY`, 50, 55, { align: 'center' });
  }

  // Details box
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.rect(10, 59, 80, 75, 'FD');

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);

  const startX = 14;
  const valueX = 86;
  let currentY = 65;

  const drawRow = (label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(label, startX, currentY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(value, valueX, currentY, { align: 'right' });
    currentY += 8;
  };

  drawRow('Patient ID:', data.patientId || 'N/A');
  drawRow('Patient Name:', data.patientName || 'Unknown Patient');
  drawRow('Phone Number:', data.phone || 'N/A');
  drawRow('Assigned MD:', data.doctorName || 'Staff Physician');
  drawRow('Department:', data.department || 'General Medicine');
  drawRow('Issue Date:', dateStr);
  drawRow('Issue Time:', timeStr);
  drawRow('Risk Category:', highRisk ? 'CRITICAL / HIGH RISK' : 'Standard');

  // Instructions
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text("Please monitor the station's LED Calling boards.", 50, 142, { align: 'center' });
  doc.text('An automated announcement will sound when you are called.', 50, 145, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text('Thank you for choosing Vitalis Healthcare!', 50, 149, { align: 'center' });

  doc.save(`Token_${data.tokenNumber}_Receipt.pdf`);
};

export const generateFullPatientHistoryPDF = (
  patient: any,
  consultations: any[],
  bills: any[],
  tokens: any[],
  users?: any[]
) => {
  const doc = new jsPDF('p', 'mm', 'a4');
  
  // Header
  doc.setFillColor(11, 28, 48); // Dark Navy background header
  doc.rect(0, 0, 210, 40, 'F');
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('VITALIS CLINICAL RECORD SERVICES', 14, 18);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text('COMPREHENSIVE PATIENT HEALTH DOSSIER & HISTORIC RECORDS', 14, 25);
  doc.text(`Report Spooled On: ${new Date().toLocaleString()} (Local Time)`, 14, 31);
  
  const highRisk = isPatientHighRisk(patient);

  // Red Warning Badge if Patient is HIGH-RISK
  if (highRisk) {
    doc.setFillColor(239, 68, 68); // Red
    doc.rect(14, 44, 182, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text('CRITICAL PROTOCOL ALERT: PATIENT CONCURRENTLY FLAGGED AS CLINICALLY HIGH-RISK', 18, 49.5);
  }

  // SECTION 1: Patient registration credentials
  const startSectionY = highRisk ? 58 : 48;
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(11, 28, 48);
  doc.text('1. PATIENT DEMOGRAPHICS & CLINICAL REGISTRATION PROFILE', 14, startSectionY);

  // Demographic details using a clean double-column autoTable
  const demographicData = [
    ['Full Legal Name', patient.name || 'N/A', 'Patient ID Code', patient.id || 'N/A'],
    ['Date of Birth', patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString() : 'N/A', 'Age & Gender', `${patient.age || 'N/A'} yrs / ${patient.gender || 'N/A'}`],
    ['Primary Phone', patient.phone || 'N/A', 'Email Address', patient.email || 'N/A'],
    ['Residential Address', patient.address || 'N/A', 'Blood Group Type', patient.bloodGroup || 'N/A'],
    ['Emergency Contact', `${patient.emergencyContactName || 'N/A'} (${patient.emergencyContactPhone || 'N/A'})`, 'Registration Date', patient.createdAt ? new Date(patient.createdAt).toLocaleDateString() : 'N/A'],
    ['Initial BP Vitals', patient.bloodPressure || 'N/A', 'Clinical Risk Status', highRisk ? 'CRITICAL / HIGH RISK ALERT' : 'Standard Normative Class'],
    ['Weight', patient.weight ? `${patient.weight} kg` : 'N/A', 'Body Temperature', patient.temperature ? `${patient.temperature} °C` : 'N/A'],
    ['Latest Allergies', patient.allergies || 'No known allergies', 'Chronic Conditions', (patient.chronicConditions && patient.chronicConditions !== 'None' && patient.chronicConditions !== 'None disclosed') ? patient.chronicConditions : 'No chronic conditions recorded']
  ];

  autoTable(doc, {
    startY: startSectionY + 4,
    body: demographicData,
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 2.5, textColor: [30, 41, 59] },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [11, 28, 48], cellWidth: 35 },
      1: { cellWidth: 60 },
      2: { fontStyle: 'bold', textColor: [11, 28, 48], cellWidth: 35 },
      3: { cellWidth: 60 },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (cellData) => {
      if (cellData.section === 'body' && cellData.column.index === 3 && cellData.cell.text[0]?.includes('CRITICAL')) {
        cellData.cell.styles.textColor = [186, 26, 26];
        cellData.cell.styles.fontStyle = 'bold';
      }
    }
  });

  let currentY = (doc as any).lastAutoTable.finalY + 12;

  // SECTION 2: CLINICAL VISITS & CONSULTATION MEDICAL NOTES
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(11, 28, 48);
  doc.text('2. COMPREHENSIVE OUTPATIENT CLINICAL CONSULTATION HISTORY', 14, currentY);
  currentY += 6;

  if (consultations && consultations.length > 0) {
    // Sort consultations chronologically (newest first)
    const sortedConsults = [...consultations].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    sortedConsults.forEach((c: any, index: number) => {
      // Check for page break if we are near the bottom of the page
      if (currentY > 215) {
        doc.addPage();
        currentY = 20;
      }

      // Title header banner for the consultation visit
      doc.setFillColor(241, 245, 249);
      doc.rect(14, currentY, 182, 7, 'F');
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(11, 28, 48);
      const visitNo = sortedConsults.length - index;
      const consultDateTimeStr = `${new Date(c.createdAt).toLocaleDateString()} @ ${new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      doc.text(`CLINICAL RECORD #${visitNo} — SESSION TIMESTAMP: ${consultDateTimeStr}`, 17, currentY + 5);
      currentY += 11;

      // Two column details
      const associatedToken = c.visitRecord?.token;
      const assignedTokenNo = associatedToken?.tokenNumber || 'N/A';
      const assignedDoctorId = associatedToken?.doctorId;
      const assignedDoctorObj = users?.find((u: any) => u.id === assignedDoctorId);
      const assignedDoctorName = assignedDoctorObj ? assignedDoctorObj.name : 'Staff Doctor';
      const riskStatus = associatedToken?.priority || 'NORMAL';

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(71, 85, 105);
      
      doc.text('Assigned Token ID:', 16, currentY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`Token ${assignedTokenNo}`, 48, currentY);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Assigned Doctor:', 110, currentY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`Dr. ${assignedDoctorName}`, 142, currentY);
      currentY += 4.5;

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Attending Doctor:', 16, currentY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`Dr. ${c.doctor?.name || 'Staff Practitioner'} (${c.doctor?.department || 'Outpatient Department'})`, 48, currentY);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Clinical Risk:', 110, currentY);
      doc.setFont('helvetica', 'bold');
      if (riskStatus === 'CRITICAL' || riskStatus === 'HIGH' || riskStatus === 'URGENT' || riskStatus === 'EMERGENCY') {
        doc.setTextColor(186, 26, 26);
      } else {
        doc.setTextColor(21, 128, 61);
      }
      doc.text(`${riskStatus}`, 142, currentY);
      currentY += 5;

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Chief Complaint:', 16, currentY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`${c.chiefComplaint || 'No primary complaint logged.'}`, 48, currentY);
      currentY += 4.5;

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Session Vitals:', 16, currentY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`${c.vitals || 'No session vitals entered.'}`, 48, currentY);
      currentY += 4.5;

      // Diagnosis highlighting
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(153, 27, 27); // Deep red for diagnosis
      doc.text('Clinical Diagnosis:', 16, currentY);
      doc.text(`${c.diagnosis || 'No clinical diagnosis entered.'}`, 48, currentY);
      currentY += 5;

      // Allergies & Chronic Conditions during this visit
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('visit Allergies:', 16, currentY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`${c.allergies || 'No known allergies.'}`, 48, currentY);
      currentY += 4.5;

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Chronic Conditions:', 16, currentY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      let chronicText = 'No chronic conditions recorded';
      if (c.chronicConditions && c.chronicConditions !== 'None' && c.chronicConditions !== 'None disclosed' && c.chronicConditions.trim() !== '') {
        chronicText = c.chronicConditions;
      }
      doc.text(chronicText, 48, currentY);
      currentY += 5;

      // Clinical notes (allow wrap)
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(11, 28, 48);
      doc.text('Clinical Findings & Outpatient Notes:', 16, currentY);
      currentY += 4;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);
      const lines = doc.splitTextToSize(c.notes || 'No clinical examination notes written.', 176);
      doc.text(lines, 16, currentY);
      currentY += (lines.length * 4.2) + 2;

      // Medications
      if (currentY > 230) {
        doc.addPage();
        currentY = 20;
      }
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(11, 28, 48);
      doc.text('Prescribed Pharmacotherapy:', 16, currentY);
      currentY += 4;
      
      const meds = c.prescription?.items || [];
      if (meds.length > 0) {
        meds.forEach((m: any, mIdx: number) => {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(15, 23, 42);
          let medLineStr = `  ${mIdx + 1}. ${m.medicine || m.medicineName} (${m.dosage} | ${m.frequency || 'N/A'} | ${m.duration || 'N/A'})`;
          if (m.instructions) {
            medLineStr += ` — Inst: ${m.instructions}`;
          }
          doc.text(medLineStr, 16, currentY);
          currentY += 4.5;
        });
      } else {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(115, 125, 140);
        doc.text('  No outpatient routine medicines prescribed during this consultation.', 16, currentY);
        currentY += 4.5;
      }
      currentY += 2;

      // Referral & Follow up
      if (currentY > 230) {
        doc.addPage();
        currentY = 20;
      }
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Referral Target:', 16, currentY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`${c.referral || 'No referral required'}`, 48, currentY);
      currentY += 4.5;

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text('Follow-up Advice:', 16, currentY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(`${c.followUp || 'No follow-up advice specified.'}`, 48, currentY);
      
      currentY += 12; // Extra spacer for next card block
    });
    
    // Set dummy lastAutoTable for spacing subsequent sections
    (doc as any).lastAutoTable = { finalY: currentY - 6 };
  } else {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(115, 125, 140);
    doc.text('No formal physical physician consultations or clinical check-up records logged in medical files.', 14, currentY + 6);
    (doc as any).lastAutoTable = { finalY: currentY + 12 };
  }

  // Footer on all pages / Final page
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Confidential Clinical File - Vitalis Hospital Management Systems | Page ${i} of ${totalPages}`,
      105,
      287,
      { align: 'center' }
    );
  }

  doc.save(`Clinical_Dossier_Patient_${patient.name.replace(/\s+/g, '_')}.pdf`);
};

export const generateDateWiseExportPDF = (
  periodString: string,
  dayTokens: any[],
  users: any[]
) => {
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape for better column fitting
  
  // Header banner
  doc.setFillColor(15, 23, 42); // slate-900 background
  doc.rect(0, 0, 297, 40, 'F');
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('VITALIS HEALTHCARE QUEUE TELEMETRY LOGS', 14, 18);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text(`DAILY CLINICAL ROSTER AUDIT REPORT - PERIOD: ${periodString.toUpperCase()}`, 14, 25);
  doc.text(`Generated on: ${new Date().toLocaleString()} | Active Hospital Counter Records`, 14, 31);

  const tableRows = dayTokens.map((t, index) => {
    // find doctor details
    const docUser = users.find(u => u.id === t.doctorId);
    const doctorNameStr = docUser ? docUser.name : (t.doctorName || 'Staff Physician');
    const deptStr = docUser?.department || t.department || 'General Medicine';
    const rawTime = t.createdAt ? new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
    const rawDate = t.createdAt ? new Date(t.createdAt).toISOString().split('T')[0] : 'N/A';
    
    // Extract Clinical Consultation Info
    const consult = t.visitRecord?.consultation;
      
    // Prescriptions Item
    const rxItems = consult?.prescription?.items;
    const rxStr = rxItems && rxItems.length > 0
      ? rxItems.map((pi: any) => `· ${pi.medicine} (${pi.dosage}, ${pi.frequency}, ${pi.duration})`).join('\n')
      : (consult ? 'ADVICE ONLY / NO RX' : 'No prescription yet');

    return [
      index + 1,
      t.tokenNumber || 'N/A',
      `${t.patientName || t.patient?.name || 'Unknown Patient'}\nPID-${(t.patientId || t.patient?.id || '').slice(0, 8).toUpperCase()}`,
      `Dr. ${doctorNameStr}\n(${deptStr})`,
      `${rawTime}\n(${rawDate})`,
      rxStr
    ];
  });

  autoTable(doc, {
    startY: 45,
    head: [['#', 'Token ID', 'Patient Name & ID', 'Practitioner / Dept', 'Time (Date) Issued', 'Prescription Items']],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 2.5, textColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 25, fontStyle: 'bold' },
      2: { cellWidth: 60, fontStyle: 'bold' },
      3: { cellWidth: 60 },
      4: { cellWidth: 40, halign: 'center' },
      5: { cellWidth: 74 }
    }
  });

  // Footer
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Daily Roster Audit Logs - Confidential System Export | Created by Reception Staff | Page ${i} of ${totalPages}`,
      148,
      285,
      { align: 'center' }
    );
  }

  doc.save(`Daily_Roster_${periodString.replace(/[\s/:]+/g, '_')}.pdf`);
};

export const generateAllPatientsExportPDF = (
  unifiedRecords: any[],
  patientsCount: number
) => {
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape format for rich tabular view
  
  // Header banner
  doc.setFillColor(11, 28, 48); // Dark Navy background header
  doc.rect(0, 0, 297, 40, 'F');
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('VITALIS HEALTHCARE SYSTEM CENTRAL REGISTRY AUDIT', 14, 18);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text('MASTER CLINICAL REGISTRY AUDIT - COMPLETE HISTORICAL CLINICAL VISITS LEDGER', 14, 25);
  doc.text(`Export Timestamp: ${new Date().toLocaleString()} | Total Active Clinical Visits: ${unifiedRecords.length}`, 14, 31);
  
  // Summary Stats Block
  const totalVisits = unifiedRecords.length;
  const completedVisits = unifiedRecords.filter(r => 
    r.status === 'DISPENSED' || 
    r.status === 'CONSULTATION_COMPLETED' || 
    r.status === 'SENT_TO_PHARMACY' ||
    String(r.status).includes('COMPLETED')
  ).length;
  
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(`DATABASE METRICS: Total Clinical Visits: ${totalVisits} | Completed & Serviced: ${completedVisits} | Registered Patient Profiles: ${patientsCount}`, 14, 49);

  const tableRows = unifiedRecords.map((r, index) => {
    return [
      index + 1,
      r.tokenNumber || 'N/A',
      `${r.patientName}\nPID-${(r.patientId || '').slice(0, 8).toUpperCase()}`,
      `${r.doctorName}\n(${r.department})`,
      `${r.visitDate}\n${r.visitTime}`,
      r.prescriptions,
      r.billingStatus
    ];
  });

  autoTable(doc, {
    startY: 55,
    head: [['#', 'Token ID', 'Patient Name & ID', 'Practitioner / Dept', 'Visit Date & Time', 'Prescriptions Issued', 'Billing & Invoice']],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: [11, 28, 48], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 2.5, textColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 22, fontStyle: 'bold' },
      2: { cellWidth: 45, fontStyle: 'bold' },
      3: { cellWidth: 45 },
      4: { cellWidth: 35, halign: 'center' },
      5: { cellWidth: 75 },
      6: { cellWidth: 35, halign: 'right' }
    }
  });

  // Footer page counters
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Confidential Centralized Clinical Records Audit Registry - Vitalis Healthcare | Range: Registry Inception to Current | Page ${i} of ${totalPages}`,
      148,
      285,
      { align: 'center' }
    );
  }

  doc.save(`Complete_Hospital_Historical_Roster_${new Date().toISOString().split('T')[0]}.pdf`);
};

export const generateDoctorPatientsTablePDF = (
  patients: any[],
  filterName: string,
  doctorName: string
) => {
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape format for tabular patient report
  
  // Header banner matching the system standard
  doc.setFillColor(11, 28, 48); // Dark Navy Primary
  doc.rect(0, 0, 297, 40, 'F');
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text('VITALIS CLINICAL PATIENT REGISTRY INDEX', 14, 18);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text(`FILTER STATUS SELECTION: ${filterName.toUpperCase()} ROSTER LISTING`, 14, 25);
  doc.text(`Spooling Operator: Dr. ${doctorName} | Generation Timestamp: ${new Date().toLocaleString()} (Local Time)`, 14, 31);
  
  
  const tableRows = patients.map((p, index) => {
    const docName = p.latestConsultation?.doctor?.name 
      ? `Dr. ${p.latestConsultation.doctor.name}`
      : `Dr. ${doctorName}`;
    const department = p.latestConsultation?.doctor?.department || 'General Practice';
    const statusVal = p.latestToken?.priority || 'STABLE';
    const lastInteraction = p.latestDate 
      ? new Date(p.latestDate).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})
      : 'N/A';

    return [
      index + 1,
      p.name || 'Unknown Name',
      `PT-${(p.id || '').toUpperCase().slice(0, 8)}`,
      `${p.age || 'N/A'} yrs / ${p.gender || 'N/A'}`,
      p.phone || 'N/A',
      department,
      docName,
      statusVal,
      lastInteraction
    ];
  });

  autoTable(doc, {
    startY: 45,
    head: [['#', 'Patient Legal Name', 'Patient ID Code', 'Age / Gender', 'Contact Phone', 'Primary Care', 'Consulting MD', 'Roster Status', 'Last Interaction']],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: [11, 28, 48], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 3, textColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { fontStyle: 'bold', cellWidth: 42 },
      2: { cellWidth: 25, fontStyle: 'bold' },
      3: { cellWidth: 26 },
      4: { cellWidth: 32 },
      5: { cellWidth: 32 },
      6: { cellWidth: 42 },
      7: { cellWidth: 26, halign: 'center', fontStyle: 'bold' },
      8: { cellWidth: 32 }
    },
    didParseCell: (cellData) => {
      if (cellData.section === 'body' && cellData.column.index === 7) {
        const val = cellData.cell.text[0] || '';
        if (val === 'CRITICAL' || val === 'HIGH' || val === 'URGENT') {
          cellData.cell.styles.textColor = [186, 26, 26];
          cellData.cell.styles.fillColor = [254, 242, 242];
        } else if (val === 'STABLE' || val === 'NORMAL' || val === 'LOW') {
          cellData.cell.styles.textColor = [21, 128, 61];
          cellData.cell.styles.fillColor = [220, 252, 231];
        }
      }
    }
  });

  // Footer page counters on Landscape A4
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Confidential Patient Table Index Listing | Range: ${filterName.toUpperCase()} | Page ${i} of ${totalPages}`,
      148,
      202,
      { align: 'center' }
    );
  }

  doc.save(`Patient_Table_Roster_${filterName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
};

export const generateInventoryPDF = (items: any[]) => {
  const doc = new jsPDF('landscape');
  
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFont('helvetica', 'bold');
  doc.text('Pharmacy Inventory Summary Report', 14, 20);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139); // slate-500
  doc.text(`Generated: ${new Date().toLocaleString()} | Total Unique Medicines: ${items.length}`, 14, 26);

  const tableRows: any[] = [];
  items.forEach((it: any) => {
    (it.batches || []).forEach((b: any) => {
      // Generate static deterministic shelf coordinate
      let sum = 0;
      const mName = it.name || 'MED';
      for (let i = 0; i < mName.length; i++) {
        sum += mName.charCodeAt(i);
      }
      const rack = String.fromCharCode(65 + (sum % 5));
      const shelf = (sum % 9) + 1;
      const bin = (sum % 15) + 1;
      const fallbackCoordinate = `${rack}-${shelf.toString().padStart(2, '0')}-${bin.toString().padStart(2, '0')}`;
      const shelfCoordinate = b.shelfLocation || it.shelfLocation || fallbackCoordinate;

      tableRows.push([
        it.name || 'N/A',
        it.category || 'N/A',
        it.dosage || 'N/A',
        b.batchNumber || 'N/A',
        b.expiryDate ? new Date(b.expiryDate).toLocaleDateString() : 'N/A',
        `${b.stockQuantity} units`,
        `$${(it.sellingPrice || 0).toFixed(2)}`,
        shelfCoordinate,
        b.status || 'ACTIVE'
      ]);
    });
  });

  autoTable(doc, {
    startY: 32,
    head: [[
      'Medicine Name',
      'Category',
      'Dosage Form',
      'Batch Number',
      'Expiry Date',
      'Stock Quantity',
      'Unit Price',
      'Shelf Location',
      'Status'
    ]],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [13, 71, 161], // #0d47a1 blue
      textColor: [255, 255, 255],
      fontSize: 9,
      fontStyle: 'bold'
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [51, 65, 85]
    },
    columnStyles: {
      0: { cellWidth: 50, fontStyle: 'bold' },
      1: { cellWidth: 25 },
      2: { cellWidth: 25 },
      3: { cellWidth: 30 },
      4: { cellWidth: 25 },
      5: { cellWidth: 25 },
      6: { cellWidth: 20 },
      7: { cellWidth: 35, fontStyle: 'bold' },
      8: { cellWidth: 20 }
    }
  });

  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Pharmacy Inventory Listing Report | Page ${i} of ${totalPages}`,
      148,
      202,
      { align: 'center' }
    );
  }

  doc.save(`Pharmacy_Inventory_${new Date().toISOString().split('T')[0]}.pdf`);
};
