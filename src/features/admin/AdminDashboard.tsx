/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from "motion/react";
import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useStore, authFetch } from "@/src/store/useStore";
import { 
  Users, Activity, Clock, ArrowUpRight, 
  Calendar, Download, Bell, HelpCircle, 
  CheckCircle2, TrendingUp, DollarSign, ListTodo, ShieldAlert,
  Receipt, FileText, ArrowRight, UserCheck, UserX, Search,
  ChevronDown, ChevronUp, RefreshCw
} from "lucide-react";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer 
} from 'recharts';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const formatLocalDate = (dateObj: Date): string => {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function AdminDashboard() {
  const users = useStore(state => state.users);
  const patients = useStore(state => state.patients);
  const appointments = useStore(state => state.appointments);
  const activityLogs = useStore(state => state.activityLogs);
  const tokens = useStore(state => state.tokens);
  const prescriptions = useStore(state => state.prescriptions);
  const bills = useStore(state => state.bills);

  const fetchUsers = useStore(state => state.fetchUsers);
  const fetchPatients = useStore(state => state.fetchPatients);
  const fetchTokens = useStore(state => state.fetchTokens);
  const fetchPharmacyQueue = useStore(state => state.fetchPharmacyQueue);
  const fetchBills = useStore(state => state.fetchBills);
  const fetchActivityLogs = useStore(state => state.fetchActivityLogs);

  const [consultations, setConsultations] = useState<any[]>([]);
  const [timeFilter, setTimeFilter] = useState<'30days' | '24h' | '7days'>('30days');
  const [pendingResetsCount, setPendingResetsCount] = useState<number>(0);

  // --- DOCTOR ATTENDANCE & ACTIVITY TRACKING STATE ---
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<any>({
    doctorsPresentToday: 0,
    doctorsAbsentToday: 0,
    doctorsOnDutyNow: 0,
    avgConsultations: 0
  });
  const [attendanceFilter, setAttendanceFilter] = useState<'today' | 'yesterday' | '7days' | '30days' | 'custom'>('today');
  const [attStartInput, setAttStartInput] = useState<string>(formatLocalDate(new Date()));
  const [attEndInput, setAttEndInput] = useState<string>(formatLocalDate(new Date()));
  const [isAttLoading, setIsAttLoading] = useState<boolean>(false);
  const [attendanceSearchTerm, setAttendanceSearchTerm] = useState<string>('');
  const [expandedDoctors, setExpandedDoctors] = useState<{ [id: string]: boolean }>({});

  const fetchAttendance = useCallback(async (silent: boolean = false) => {
    if (!silent) setIsAttLoading(true);
    let finished = false;
    let timeoutId: any = null;

    if (!silent) {
      timeoutId = setTimeout(() => {
        if (!finished) {
          setIsAttLoading(false);
          toast.error("Unable to load data. Please try again.");
        }
      }, 10000); // 10 seconds timeout
    }

    try {
      let startStr = '';
      let endStr = '';
      const todayVal = new Date();

      if (attendanceFilter === 'today') {
        const str = formatLocalDate(todayVal);
        startStr = str;
        endStr = str;
      } else if (attendanceFilter === 'yesterday') {
        const yes = new Date();
        yes.setDate(yes.getDate() - 1);
        const str = formatLocalDate(yes);
        startStr = str;
        endStr = str;
      } else if (attendanceFilter === '7days') {
        const s = new Date();
        s.setDate(s.getDate() - 6);
        startStr = formatLocalDate(s);
        endStr = formatLocalDate(todayVal);
      } else if (attendanceFilter === '30days') {
        const s = new Date();
        s.setDate(s.getDate() - 29);
        startStr = formatLocalDate(s);
        endStr = formatLocalDate(todayVal);
      } else if (attendanceFilter === 'custom') {
        startStr = attStartInput;
        endStr = attEndInput;
      }

      const res = await authFetch(`/api/admin/doctor-attendance?startDate=${startStr}&endDate=${endStr}`);
      finished = true;
      if (timeoutId) clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        setAttendanceRows(data.rows || []);
        setAttendanceSummary(data.summary || {
          doctorsPresentToday: 0,
          doctorsAbsentToday: 0,
          doctorsOnDutyNow: 0,
          avgConsultations: 0
        });
      } else {
        if (!silent) {
          setIsAttLoading(false);
          toast.error("Unable to load data. Please try again.");
        }
      }
    } catch (err) {
      console.error(err);
      finished = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (!silent) {
        setIsAttLoading(false);
        toast.error("Unable to load data. Please try again.");
      }
    } finally {
      if (!silent) setIsAttLoading(false);
    }
  }, [attendanceFilter, attStartInput, attEndInput]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  const [summaryData, setSummaryData] = useState<any>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);

  const fetchSummary = useCallback(async (silent = false) => {
    if (!silent) setIsSummaryLoading(true);
    try {
      const res = await authFetch(`/api/admin/operational-summary?timeFilter=${timeFilter}`);
      if (res.ok) {
        const data = await res.json();
        setSummaryData(data);
      }
    } catch (e) {
      console.error("Failed to load operational summary:", e);
    } finally {
      if (!silent) setIsSummaryLoading(false);
    }
  }, [timeFilter]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    // Fetch password reset requests to show alerts in real-time
    const loadResetRequests = async () => {
      try {
        const res = await authFetch('/api/admin/password-reset-requests');
        if (res.ok) {
          const data = await res.json();
          setPendingResetsCount(data.length);
        }
      } catch (e) {
        console.error("Failed to load password reset requests for dashboard:", e);
      }
    };
    loadResetRequests();
  }, []);

  // Map high-speed database telemetry aggregates directly
  const targetPatients = timeFilter === '24h' ? 5 : timeFilter === '7days' ? 20 : 100;
  const avgWaitMinutes = summaryData?.avgWaitMinutes ?? 18;

  const periodPatientsCount = summaryData?.periodPatientsCount ?? 0;
  const patientProgressPercent = summaryData?.patientProgressPercent ?? 0;
  const doctorsOnDutyCount = summaryData?.doctorsOnDutyCount ?? 0;
  const totalDoctorsCount = summaryData?.totalDoctorsCount ?? 0;
  const staffOnDutyPercent = summaryData?.staffOnDutyPercent ?? 100;
  const avgWaitTimeStr = summaryData?.avgWaitTimeStr ?? '18m';
  const totalBillsGenerated = summaryData?.totalBillsGenerated ?? 0;
  const totalPaidBills = summaryData?.totalPaidBills ?? 0;
  const totalUnpaidBills = summaryData?.totalUnpaidBills ?? 0;
  const totalCancelledBills = summaryData?.totalCancelledBills ?? 0;
  const pharmacyRevenueSum = summaryData?.pharmacyRevenueSum ?? 0;
  const consultationsCompletedCount = summaryData?.consultationsCompletedCount ?? 0;
  const activeTokensCount = summaryData?.activeTokensCount ?? 0;
  const prescriptionsDispensedCount = summaryData?.prescriptionsDispensedCount ?? 0;
  
  const chartData = summaryData?.chartData ?? [];
  const unifiedLogsList = summaryData?.unifiedLogsList ?? [];
  const emergencyRegistryItems = summaryData?.emergencyRegistryItems ?? [];
  const activeTransactions = summaryData?.activeTransactions ?? [];

  const getPharmacistName = (pharmacistId: string | null) => {
    return 'System Pharmacist';
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: true
    });
  };

  // --- EXPORT REPORT (USES GENERATIVE enterprise operational index) ---
  const handleExportOperationalReport = () => {
    const toastId = toast.loading('Loading...');

    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const stampStr = new Date().toLocaleString('en-US', { hour12: true });

      // Horizontal Top Highlight Trim
      doc.setFillColor(0, 50, 133); // MedFlow Navy
      doc.rect(14, 15, 182, 3, 'F');

      // Main Branding Left
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 50, 133);
      doc.text('MEDFLOW', 14, 28);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 116, 139);
      doc.text('FACILITY OPERATIONS & CLINICAL OVERVIEW', 14, 33);

      // Report Right Meta
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('OPERATIONAL HEALTH REPORT', 196, 28, { align: 'right' });

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated: ${stampStr}`, 196, 33, { align: 'right' });
      doc.text(`Query Range: ${timeFilter === '30days' ? 'Last 30 Days' : timeFilter === '7days' ? 'Last 7 Days' : 'Last 24 Hours'}`, 196, 37, { align: 'right' });

      // Mid header separator rule
      doc.setDrawColor(215, 218, 221);
      doc.setLineWidth(0.5);
      doc.line(14, 42, 196, 42);

      // Box KPIs
      const drawReportBox = (x: number, y: number, w: number, h: number, title: string, value: string, sub: string, color: [number, number, number]) => {
        doc.setFillColor(241, 244, 247);
        doc.rect(x, y, w, h, 'F');
        doc.setFillColor(color[0], color[1], color[2]);
        doc.rect(x, y, 3, h, 'F');
        doc.setDrawColor(215, 218, 221);
        doc.setLineWidth(0.3);
        doc.rect(x, y, w, h, 'S');

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(title.toUpperCase(), x + 8, y + 6);

        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 50, 133);
        doc.text(value, x + 8, y + 13);

        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(sub, x + 8, y + 18);
      };

      drawReportBox(14, 48, 56, 22, "Patient Registrations", `${periodPatientsCount} Patients`, `Target progress: ${patientProgressPercent}%`, [5, 150, 105]);
      drawReportBox(77, 48, 56, 22, "Staff On-Duty", `${doctorsOnDutyCount} / ${totalDoctorsCount}`, `Availability score: ${staffOnDutyPercent}%`, [0, 50, 133]);
      drawReportBox(140, 48, 56, 22, "Avg. Wait Duration", avgWaitTimeStr, "Admission to Diagnostic Complete", [239, 68, 68]);

      // Telemetry Sections
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 50, 133);
      doc.text('CLINICAL & BILLING SYSTEM PERFORMANCE SUMMARY', 14, 80);

      const telemetryRows = [
        ['Metric Category', 'Active Database Count / Value', 'Operational Context'],
        ['Total Patient Bills Issued', String(totalBillsGenerated), 'All checkout requests completed'],
        ['Fully PAID Pharmacy Bills', String(totalPaidBills), 'Settled and cleared invoices'],
        ['Outstanding UNPAID Bills', String(totalUnpaidBills), 'Pending checkout balances'],
        ['Dispensed Pharmacy Invoices Revenue', `$${pharmacyRevenueSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Actual earned pharmacy earnings'],
        ['Consultations Completed', String(consultationsCompletedCount), 'Completed diagnostics sessions'],
        ['Active Tokens in Process', String(activeTokensCount), 'Active patient diagnostic sessions'],
        ['Prescriptions Dispensed', String(prescriptionsDispensedCount), 'Fulfilled prescription carts']
      ];

      autoTable(doc, {
        startY: 85,
        head: [telemetryRows[0]],
        body: telemetryRows.slice(1),
        theme: 'striped',
        headStyles: { fillColor: [0, 50, 133], textColor: 255 },
        styles: { fontSize: 8.5, cellPadding: 3.5 },
        margin: { left: 14, right: 14 }
      });

      const nextSectionY = (doc as any).lastAutoTable.finalY + 12;

      // Section: Recent System Activity logs
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 50, 133);
      doc.text('LIVE AUDIT SYSTEM REGISTER', 14, nextSectionY);

      const activityTableRows = unifiedLogsList.map((log: any) => [
        new Date(log.timestamp).toLocaleDateString() + ' ' + formatTime(new Date(log.timestamp)),
        log.action,
        log.subject,
        log.user,
        log.department
      ]);

      autoTable(doc, {
        startY: nextSectionY + 4,
        head: [['Log Timestamp', 'Action Category', 'Associated Subject Element', 'Responsible Actor', 'Department']],
        body: activityTableRows,
        theme: 'grid',
        headStyles: { fillColor: [51, 65, 85], textColor: 255 },
        styles: { fontSize: 8, cellPadding: 3 },
        margin: { left: 14, right: 14 }
      });

      // Simple footer signature for all pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text('MedFlow Admin Portal • Dynamic Operational Registry Pipeline', 14, 287);
        doc.text(`Page ${i} of ${totalPages}`, 196, 287, { align: 'right' });
      }

      const cleanDate = new Date().toISOString().split('T')[0];
      doc.save(`MedFlow_Operational_Overview_${cleanDate}.pdf`);

      toast.dismiss(toastId);
      toast.success('Operational Report Exported', {
        description: `Successfully printed current clinic queues and billing telemetry.`
      });
    } catch (e: any) {
      console.error(e);
      toast.dismiss(toastId);
      toast.error('Could not generate PDF download index.');
    }
  };

  const handleExportAttendanceReportPDF = () => {
    toast.loading('Loading...', { id: 'attendance-pdf' });
    try {
      const doc = new jsPDF('l', 'mm', 'a4'); // 'l' landscape for generous width columns!
      const stampStr = new Date().toLocaleString('en-US', { hour12: true });

      // Horizontal Top Highlight Trim (Red for emergency/attendance registry)
      doc.setFillColor(186, 26, 26);
      doc.rect(14, 15, 269, 3, 'F');

      // Title & Logo
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.setTextColor(30, 41, 59);
      doc.text('MEDFLOW CLINICAL INFRASTRUCTURE', 14, 27);
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(186, 26, 26);
      doc.text('OFFICIAL DOCTOR ATTENDANCE & PERFORMANCE AUDIT LEDGER', 14, 33);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(9);
      doc.text(`Triage Range: ${attendanceFilter.toUpperCase()} | Generated: ${stampStr}`, 14, 39);

      // Summary block
      doc.setFillColor(248, 250, 252);
      doc.rect(14, 44, 269, 18, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.rect(14, 44, 269, 18, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text('Present Today:', 20, 54);
      doc.setTextColor(22, 101, 52);
      doc.text(`${attendanceSummary.doctorsPresentToday || 0}`, 45, 54);

      doc.setTextColor(71, 85, 105);
      doc.text('Absent Today:', 75, 54);
      doc.setTextColor(153, 27, 27);
      doc.text(`${attendanceSummary.doctorsAbsentToday || 0}`, 100, 54);

      doc.setTextColor(71, 85, 105);
      doc.text('On Duty Now:', 130, 54);
      doc.setTextColor(180, 83, 9);
      doc.text(`${attendanceSummary.doctorsOnDutyNow || 0}`, 155, 54);

      doc.setTextColor(71, 85, 105);
      doc.text('Avg Consultations Period:', 185, 54);
      doc.setTextColor(30, 58, 138);
      doc.text(`${attendanceSummary.avgConsultations || 0}`, 228, 54);

      // Prepare table columns
      const tableHeaders = [
        ['Doctor (ID)', 'Date', 'Status', 'Duty Activated At', 'Duty Deactivated At', 'Consultations', 'Patients Seen']
      ];

      const formatTimeOnly = (dateInput: any) => {
        if (!dateInput) return '--';
        try {
          const d = new Date(dateInput);
          if (isNaN(d.getTime())) return '--';
          return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        } catch (err) {
          return '--';
        }
      };

      // Extract exact date range strings shown in the UI
      let startStr = '';
      let endStr = '';
      const todayLocalDate = formatLocalDate(new Date());

      if (attendanceFilter === 'today') {
        startStr = todayLocalDate;
        endStr = todayLocalDate;
      } else if (attendanceFilter === 'yesterday') {
        const yes = new Date();
        yes.setDate(yes.getDate() - 1);
        const yesStr = formatLocalDate(yes);
        startStr = yesStr;
        endStr = yesStr;
      } else if (attendanceFilter === '7days') {
        const s = new Date();
        s.setDate(s.getDate() - 6);
        startStr = formatLocalDate(s);
        endStr = todayLocalDate;
      } else if (attendanceFilter === '30days') {
        const s = new Date();
        s.setDate(s.getDate() - 29);
        startStr = formatLocalDate(s);
        endStr = todayLocalDate;
      } else if (attendanceFilter === 'custom') {
        startStr = attStartInput;
        endStr = attEndInput;
      }

      const filteredRowsForPdf = (attendanceRows || []).filter((r) => {
        const matchesSearch = 
          (r.doctorName || '').toLowerCase().includes(attendanceSearchTerm.toLowerCase()) ||
          (r.department || '').toLowerCase().includes(attendanceSearchTerm.toLowerCase());
        if (!matchesSearch) return false;

        return r.date >= startStr && r.date <= endStr;
      });

      const sortedRowsForPdf = [...filteredRowsForPdf].sort((a, b) => {
        const nameComp = (a.doctorName || '').localeCompare(b.doctorName || '');
        if (nameComp !== 0) return nameComp;
        return (b.date || '').localeCompare(a.date || '');
      });

      const tableRows = sortedRowsForPdf.map((row) => [
        `${row.doctorName || 'Doctor'} (${row.employeeId || 'N/A'})`,
        row.date || '--',
        row.attendanceStatus || 'ABSENT',
        formatTimeOnly(row.dutyActivatedTime),
        formatTimeOnly(row.dutyDeactivatedTime),
        String(row.consultationsCompleted ?? 0),
        String(row.patientsSeen ?? 0)
      ]);

      autoTable(doc, {
        startY: 68,
        head: tableHeaders,
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [186, 26, 26], textColor: 255, fontSize: 8.5 },
        styles: { fontSize: 8, cellPadding: 3 },
        margin: { left: 14, right: 14 }
      });

      // Simple footer signature for all pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text('MedFlow Analytics System • Clinical Audit Trail Document', 14, 203);
        doc.text(`Page ${i} of ${totalPages}`, 283, 203, { align: 'right' });
      }

      const cleanDate = new Date().toISOString().split('T')[0];
      doc.save(`MedFlow_Attendance_Performance_Audit_${cleanDate}.pdf`);

      toast.success('Attendance PDF Exported Successfully', { id: 'attendance-pdf' });
    } catch (e: any) {
      console.error(e);
      toast.error('Could not construct PDF report export.', { id: 'attendance-pdf' });
    }
  };

  const toggleDoctorExpand = (doctorId: string) => {
    setExpandedDoctors(prev => ({
      ...prev,
      [doctorId]: !prev[doctorId]
    }));
  };

  const handleManualRefresh = async () => {
    const toastId = toast.loading('Refreshing dashboard metrics...');
    try {
      await Promise.all([
        fetchAttendance(true),
        fetchSummary(true),
        (async () => {
          const res = await authFetch('/api/admin/password-reset-requests');
          if (res.ok) {
            const data = await res.json();
            setPendingResetsCount(data.length);
          }
        })()
      ]);
      toast.success('Dashboard metrics synchronized in real-time!', { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to sync dashboard metrics.', { id: toastId });
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Title Header with the exact MedFlow design elements */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 id="view-title" className="text-3xl font-extrabold text-[#003285] tracking-tight">Operational Health</h2>
          <p className="text-[#64748b] mt-1 text-sm font-medium">Real-time facility performance and administrative analytics.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            id="btn-manual-refresh-admin"
            onClick={handleManualRefresh}
            className="h-10 px-4 bg-white border border-[#d7dadd] rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-[#f1f4f7] text-[#1e293b] shadow-sm transition-all active:scale-[0.98] cursor-pointer"
            title="Refresh dashboard metrics"
          >
            <RefreshCw size={15} />
            Refresh
          </button>
          <button 
            id="btn-filter-period"
            onClick={() => {
              const filters: ('30days' | '24h' | '7days')[] = ['30days', '24h', '7days'];
              const currentIdx = filters.indexOf(timeFilter);
              const nextIdx = (currentIdx + 1) % filters.length;
              setTimeFilter(filters[nextIdx]);
              toast.info(`Query window adjusted: ${filters[nextIdx] === '30days' ? 'Last 30 Days' : filters[nextIdx] === '24h' ? 'Last 24 Hours' : 'Last 7 Days'}`);
            }}
            className="h-10 px-4 bg-white border border-[#d7dadd] rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-[#f1f4f7] text-[#1e293b] shadow-sm transition-all active:scale-[0.98]"
          >
            <Calendar size={16} className="text-[#64748b]" />
            {timeFilter === '30days' ? 'Last 30 Days' : timeFilter === '24h' ? 'Last 24 Hours' : 'Last 7 Days'}
          </button>
          <button 
            id="btn-export-reports"
            onClick={handleExportOperationalReport}
            className="h-10 px-4 bg-[#003285] text-white rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-opacity-90 shadow-sm transition-all active:scale-[0.98]"
          >
            <Download size={16} />
            Export Report
          </button>
        </div>
      </div>

      {/* SECURE NOTIFICATION BAR FOR PASSWORD RESETS */}
      {pendingResetsCount > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <ShieldAlert size={20} className="animate-bounce" />
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-amber-900 uppercase tracking-tight">Security Actions Required</h4>
              <p className="text-xs text-amber-700 font-bold mt-0.5">
                There are <strong className="text-amber-950 font-black underline">{pendingResetsCount} pending medical staff password reset requests</strong> from the clinical terminals.
              </p>
            </div>
          </div>
          <Link
            to="/admin/users?tab=resets"
            className="w-full sm:w-auto h-9 px-4 bg-amber-600 hover:bg-[#d97706] text-white rounded-lg text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all shadow-sm shrink-0"
          >
            Review Requests & Authorize
            <ArrowRight size={13} />
          </Link>
        </motion.div>
      )}

      {/* THREE DEFINITIVE DATABASE-DRIVEN KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* KPI Card 1: Patient Registrations (Replaces Simulated Bed Occupancy) */}
        <div id="kpi-card-occupancy" className="bg-white p-6 rounded-lg border border-[#d7dadd] shadow-sm transition-all hover:shadow-md">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2.5 bg-teal-50 text-teal-600 rounded-lg">
              <Activity size={24} className="animate-pulse" />
            </div>
            <div className="flex items-center gap-1 text-[#059669] text-xs font-bold bg-emerald-50 px-2 py-1 rounded-sm">
              <ArrowUpRight size={14} className="text-emerald-600" />
              Live Track
            </div>
          </div>
          <p className="text-xs font-bold text-[#64748b] uppercase tracking-wider">Patient Registrations</p>
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className="text-3xl font-extrabold text-[#003285] tracking-tight">{periodPatientsCount}</h3>
            <span className="text-xs text-[#64748b] font-medium">/ {targetPatients} Target</span>
          </div>
          
          <div className="mt-4 h-2 w-full bg-[#f1f4f7] rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${patientProgressPercent}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full bg-teal-600 rounded-full" 
            />
          </div>
        </div>

        {/* KPI Card 2: Staff On-Duty (Calculated from active users) */}
        <div id="kpi-card-staff-util" className="bg-white p-6 rounded-lg border border-[#d7dadd] shadow-sm transition-all hover:shadow-md">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
              <Users size={24} />
            </div>
            <div className="text-blue-600 text-[10px] font-black uppercase tracking-wider bg-blue-50 px-2.5 py-1 rounded-sm">
              Active Shift
            </div>
          </div>
          <p className="text-xs font-bold text-[#64748b] uppercase tracking-wider">Staff On-Duty</p>
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className="text-3xl font-extrabold text-[#003285] tracking-tight">{doctorsOnDutyCount} <span className="text-lg text-slate-400 font-bold">/ {totalDoctorsCount}</span></h3>
            <span className="text-xs text-[#64748b] font-medium">{doctorsOnDutyCount} Doctors Active</span>
          </div>
          
          <div className="mt-4 h-2 w-full bg-[#f1f4f7] rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${staffOnDutyPercent}%` }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }}
              className="h-full bg-blue-600 rounded-full" 
            />
          </div>
        </div>

        {/* KPI Card 3: Avg wait duration */}
        <div id="kpi-card-proc-time" className="bg-white p-6 rounded-lg border border-[#d7dadd] shadow-sm transition-all hover:shadow-md">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2.5 bg-red-50 text-red-600 rounded-lg">
              <Clock size={24} />
            </div>
            <div className="text-red-600 text-[10px] font-black uppercase tracking-wider bg-red-50 px-2.5 py-1 rounded-sm">
              Queue Speed
            </div>
          </div>
          <p className="text-xs font-bold text-[#64748b] uppercase tracking-wider">Avg. Wait Duration</p>
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className="text-3xl font-extrabold text-[#003285] tracking-tight">{avgWaitTimeStr}</h3>
            <span className="text-xs text-[#64748b] font-medium">Registry to Diagnosed</span>
          </div>
          
          <div className="mt-4 flex items-center gap-1 h-2">
            <div className={`h-full w-1/4 rounded-full ${avgWaitMinutes > 60 ? 'bg-red-500' : 'bg-teal-500'}`} />
            <div className={`h-full w-1/4 rounded-full ${avgWaitMinutes > 40 ? 'bg-red-400' : 'bg-teal-400'}`} />
            <div className={`h-full w-1/4 rounded-full ${avgWaitMinutes > 20 ? 'bg-red-300' : 'bg-teal-300'}`} />
            <div className={`h-full w-1/4 rounded-full ${avgWaitMinutes > 0 ? 'bg-red-200' : 'bg-teal-200'}`} />
          </div>
        </div>
      </div>

      {/* PLOTS AND METRICS GRAPH GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Dynamic Patient Volume Area Chart */}
        <div id="dashboard-patient-volume" className="lg:col-span-2 bg-white p-8 rounded-lg border border-[#d7dadd] shadow-sm flex flex-col min-h-[380px]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-lg font-extrabold text-[#003285]">Patient Volume trends</h3>
              <p className="text-xs text-[#64748b] font-medium mt-0.5">Real-time daily patient intake & consultation metrics</p>
            </div>
            <div className="flex items-center gap-6 text-[10px] font-bold uppercase tracking-wider">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#003285]" /> 
                <span className="text-[#64748b]">Registrations</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-teal-500" /> 
                <span className="text-[#64748b]">Consultations</span>
              </div>
            </div>
          </div>

          <div className="flex-1 w-full min-h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRegistrations" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#003285" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#003285" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorConsultations" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis 
                  dataKey="name" 
                  fontSize={10} 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontWeight: 'bold' }} 
                />
                <YAxis 
                  fontSize={10} 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontWeight: 'bold' }} 
                />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '8px', 
                    border: '1px solid #d7dadd', 
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
                    fontSize: '11px',
                    fontFamily: 'inherit'
                  }} 
                />
                <Area 
                  type="monotone" 
                  dataKey="Registrations" 
                  stroke="#003285" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorRegistrations)" 
                />
                <Area 
                  type="monotone" 
                  dataKey="Consultations" 
                  stroke="#14b8a6" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorConsultations)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Clinical & Billing Telemetry Summary (Replaces old Gross Billings) */}
        <div id="dashboard-revenue-trends" className="bg-white p-8 rounded-lg border border-[#d7dadd] shadow-sm flex flex-col">
          <h3 className="text-lg font-extrabold text-[#003285] mb-4">Clinic Telemetry</h3>
          <p className="text-xs text-[#64748b] font-medium mb-4">Actual system audits processed in this billing window.</p>
          
          <div className="bg-[#f1f4f7] rounded-lg p-5 mb-6">
            <p className="text-[10px] font-extrabold text-[#64748b] uppercase tracking-widest mb-1">Pharmacy Revenue</p>
            <h4 className="text-2xl font-black text-[#003285] tracking-tight">
              ${pharmacyRevenueSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h4>
            <p className="text-xs text-[#059669] font-bold mt-1.5 flex items-center gap-1">
              <ArrowUpRight size={14} />
              {totalPaidBills} bills settled <span className="text-slate-400 font-normal">({totalUnpaidBills} unpaid)</span>
            </p>
          </div>

          <div className="space-y-4 flex-1 justify-center flex flex-col">
            {/* Metric Indicator 1 */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-50 text-blue-600 rounded">
                  <CheckCircle2 size={14} />
                </div>
                <span className="text-xs text-[#1e293b] font-semibold">Consultations Cleared</span>
              </div>
              <span className="text-sm font-extrabold text-[#003285]">{consultationsCompletedCount}</span>
            </div>

            {/* Metric Indicator 2 */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-teal-50 text-teal-600 rounded">
                  <Activity size={14} />
                </div>
                <span className="text-xs text-[#1e293b] font-semibold">Active Queue Tokens</span>
              </div>
              <span className="text-sm font-extrabold text-teal-600">{activeTokensCount}</span>
            </div>

            {/* Metric Indicator 3 */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-pink-50 text-pink-600 rounded">
                  <DollarSign size={14} />
                </div>
                <span className="text-xs text-[#1e293b] font-semibold">Total Inbound Bills</span>
              </div>
              <span className="text-sm font-extrabold text-[#003285]">{totalBillsGenerated}</span>
            </div>

            {/* Metric Indicator 4 */}
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-orange-50 text-orange-600 rounded">
                  <TrendingUp size={14} />
                </div>
                <span className="text-xs text-[#1e293b] font-semibold">Prescriptions Dispensed</span>
              </div>
              <span className="text-sm font-extrabold text-orange-600">{prescriptionsDispensedCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* SYSTEM GENERAL ACTIVITY LOG SECTION (Unified and fully real) */}
      <div id="operations-activity-table" className="bg-white rounded-lg border border-[#d7dadd] shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#d7dadd] flex justify-between items-center bg-white">
          <h3 className="text-lg font-extrabold text-[#003285] flex items-center gap-2">
            <ListTodo size={20} className="text-[#003285]" />
            Recent Activity Log
          </h3>
          <span className="text-xs font-bold text-[#64748b] bg-[#f1f4f7] px-3 py-1.5 rounded-lg border border-[#d7dadd]">
            Active Audit Register
          </span>
        </div>
        <div className="overflow-x-auto">
          {unifiedLogsList.length > 0 ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f1f4f7] text-[#64748b] text-[10px] font-bold uppercase tracking-widest border-b border-[#d7dadd]">
                  <th className="px-8 py-4">Timestamp</th>
                  <th className="px-6 py-4">Activity</th>
                  <th className="px-6 py-4">Subject</th>
                  <th className="px-6 py-4">User</th>
                  <th className="px-8 py-4">Department</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1f4f7] text-sm">
                {unifiedLogsList.map((log: any, idx: number) => (
                  <tr key={idx} className="hover:bg-[#f7fafd] transition-colors">
                    <td className="px-8 py-4 font-mono text-xs text-[#64748b]">
                      {new Date(log.timestamp).toLocaleDateString() + ' ' + formatTime(new Date(log.timestamp))}
                    </td>
                    <td className="px-6 py-4 font-bold text-[#1e293b]">
                      {log.action}
                    </td>
                    <td className="px-6 py-4 text-[#64748b] font-medium max-w-[280px] truncate" title={log.subject}>
                      {log.subject}
                    </td>
                    <td className="px-6 py-4">
                      <span className="bg-[#f1f4f7] text-[#1e293b] px-2.5 py-1 rounded-md text-[10px] font-bold tracking-tight border border-[#d7dadd]">
                        {log.user}
                      </span>
                    </td>
                    <td className="px-8 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${log.color || 'bg-emerald-100 text-[#059669]'}`}>
                        {log.department}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              No recent audit trail transactions registered during this query window.
            </div>
          )}
        </div>
      </div>

      {/* DOCTOR ATTENDANCE & PERFORMANCE LEADERBOARD/LOGS */}
      <div id="doctor-attendance-activity-section" className="bg-white rounded-lg border border-[#d7dadd] shadow-sm overflow-hidden mt-8">
        <div className="p-6 border-b border-[#d7dadd] flex flex-col md:flex-row justify-between md:items-center gap-4 bg-slate-50/50">
          <div>
            <h3 className="text-lg font-extrabold text-[#003285] flex items-center gap-2">
              <UserCheck size={20} className="text-[#003285]" />
              Doctor Attendance & Activity Ledger
            </h3>
            <p className="text-xs text-[#64748b] font-medium mt-1">
              Live analytics of doctor shifts, first logins, last activities, consultations completed, and total patients seen based on raw clinical events.
            </p>
          </div>
          <button
            onClick={handleExportAttendanceReportPDF}
            className="self-start md:self-auto h-9 px-4 bg-red-700 text-white hover:bg-red-800 rounded-lg text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]"
          >
            <Download size={14} />
            Export Attendance PDF
          </button>
        </div>

        {/* ATTENDANCE KPI SUB-CARDS */}
        <div className="p-6 grid grid-cols-2 lg:grid-cols-4 gap-4 border-b border-[#d7dadd] bg-white">
          <div className="p-4 bg-emerald-50/30 border border-emerald-100 rounded-xl">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider">Present Today</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div className="text-2xl font-black text-emerald-900">{attendanceSummary.doctorsPresentToday}</div>
            <div className="text-[10px] text-emerald-600 font-bold mt-1">Duty activated today</div>
          </div>

          <div className="p-4 bg-rose-50/30 border border-rose-100 rounded-xl">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-black uppercase text-rose-800 tracking-wider">Absent Today</span>
              <span className="w-2 h-2 rounded-full bg-rose-500" />
            </div>
            <div className="text-2xl font-black text-rose-900">{attendanceSummary.doctorsAbsentToday}</div>
            <div className="text-[10px] text-rose-600 font-bold mt-1 font-mono">No actions received</div>
          </div>

          <div className="p-4 bg-amber-50/30 border border-amber-100 rounded-xl">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-black uppercase text-amber-800 tracking-wider">On Duty Now</span>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-bounce" />
            </div>
            <div className="text-2xl font-black text-amber-900">{attendanceSummary.doctorsOnDutyNow}</div>
            <div className="text-[10px] text-amber-600 font-bold mt-1">Currently taking patients</div>
          </div>

          <div className="p-4 bg-blue-50/30 border border-blue-100 rounded-xl">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-black uppercase text-blue-800 tracking-wider">Avg Consults</span>
              <span className="w-2 h-2 rounded-full bg-blue-500" />
            </div>
            <div className="text-2xl font-black text-blue-900">{attendanceSummary.avgConsultations}</div>
            <div className="text-[10px] text-blue-600 font-bold mt-1">Per active doctor in window</div>
          </div>
        </div>

        {/* FILTERS & SEARCH RAIL */}
        <div className="p-6 border-b border-[#d7dadd] flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-[#f8fafc]">
          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: 'Today', value: 'today' },
              { label: 'Yesterday', value: 'yesterday' },
              { label: 'Last 7 Days', value: '7days' },
              { label: 'Last 30 Days', value: '30days' },
              { label: 'Custom Range', value: 'custom' },
            ].map((f) => (
              <button
                key={f.value}
                onClick={() => setAttendanceFilter(f.value as any)}
                className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all ${
                  attendanceFilter === f.value
                    ? 'bg-[#003285] text-white border-[#003285] shadow-sm'
                    : 'bg-white text-slate-700 border-[#d7dadd] hover:bg-slate-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Date Range Fields (when custom is selected) */}
          {attendanceFilter === 'custom' && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 text-xs font-semibold text-slate-500">
              <div className="flex items-center gap-1.5 bg-white border border-[#d7dadd] rounded-lg px-2.5 py-1.5 shadow-sm">
                <span>Start:</span>
                <input
                  type="date"
                  value={attStartInput}
                  onChange={(e) => setAttStartInput(e.target.value)}
                  className="bg-transparent focus:outline-none text-slate-700 font-bold"
                />
              </div>
              <div className="flex items-center gap-1.5 bg-white border border-[#d7dadd] rounded-lg px-2.5 py-1.5 shadow-sm">
                <span>End:</span>
                <input
                  type="date"
                  value={attEndInput}
                  onChange={(e) => setAttEndInput(e.target.value)}
                  className="bg-transparent focus:outline-none text-slate-700 font-bold"
                />
              </div>
            </div>
          )}

          {/* Search Box */}
          <div className="relative w-full xl:w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search doctor or department..."
              value={attendanceSearchTerm}
              onChange={(e) => setAttendanceSearchTerm(e.target.value)}
              className="w-full h-9 pl-9 pr-4 bg-white border border-[#d7dadd] rounded-lg text-xs font-semibold focus:outline-none focus:border-[#003285] focus:ring-1 focus:ring-[#003285] transition-all shadow-sm"
            />
          </div>
        </div>

        {/* ATTENDANCE DATA TABLE */}
        <div className="overflow-x-auto">
          {isAttLoading ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              <span className="inline-block animate-spin text-2xl mr-2">⏳</span>
              Analyzing medical registry entries...
            </div>
          ) : (() => {
            const filteredRows = (attendanceRows || []).filter((r) => {
              const matchesSearch = 
                (r.doctorName || '').toLowerCase().includes(attendanceSearchTerm.toLowerCase()) ||
                (r.department || '').toLowerCase().includes(attendanceSearchTerm.toLowerCase());
              if (!matchesSearch) return false;

              let startStr = '';
              let endStr = '';
              const todayLocalDate = formatLocalDate(new Date());

              if (attendanceFilter === 'today') {
                startStr = todayLocalDate;
                endStr = todayLocalDate;
              } else if (attendanceFilter === 'yesterday') {
                const yes = new Date();
                yes.setDate(yes.getDate() - 1);
                const yesStr = formatLocalDate(yes);
                startStr = yesStr;
                endStr = yesStr;
              } else if (attendanceFilter === '7days') {
                const s = new Date();
                s.setDate(s.getDate() - 6);
                startStr = formatLocalDate(s);
                endStr = todayLocalDate;
              } else if (attendanceFilter === '30days') {
                const s = new Date();
                s.setDate(s.getDate() - 29);
                startStr = formatLocalDate(s);
                endStr = todayLocalDate;
              } else if (attendanceFilter === 'custom') {
                startStr = attStartInput;
                endStr = attEndInput;
              }

              return r.date >= startStr && r.date <= endStr;
            });

            const formatFullTime = (dateInput: any) => {
              if (!dateInput) return '--';
              try {
                const d = new Date(dateInput);
                if (isNaN(d.getTime())) return '--';
                return d.toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true
                });
              } catch (e) {
                return '--';
              }
            };

            const groupedDoctors = (() => {
              const map: { [id: string]: { doctorId: string; doctorName: string; department: string; employeeId: string; history: any[] } } = {};
              
              filteredRows.forEach((row) => {
                const docId = row.doctorId || 'unknown-doc';
                if (!map[docId]) {
                  map[docId] = {
                    doctorId: docId,
                    doctorName: row.doctorName || 'Doctor',
                    department: row.department || 'General Medicine',
                    employeeId: row.employeeId || 'N/A',
                    history: []
                  };
                }
                map[docId].history.push(row);
              });

              return Object.values(map).map((doc) => {
                const sortedHistory = [...doc.history].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                
                // Locate today's entry first to show in parent row columns if available,
                // or fall back to the most recent filtered range history entry.
                const todayStr = formatLocalDate(new Date());
                const todayRecord = sortedHistory.find((h) => h.date === todayStr) || sortedHistory[0] || {};

                return {
                  ...doc,
                  history: sortedHistory,
                  currentStatus: todayRecord.attendanceStatus || 'ABSENT',
                  latestDate: todayRecord.date,
                  dutyActivated: todayRecord.dutyActivatedTime,
                  dutyDeactivated: todayRecord.dutyDeactivatedTime,
                  consultationsToday: todayRecord.consultationsCompleted || 0,
                  patientsSeenToday: todayRecord.patientsSeen || 0
                };
              }).sort((a, b) => a.doctorName.localeCompare(b.doctorName));
            })();

            return groupedDoctors.length > 0 ? (
              <table className="w-full text-left border-collapse font-sans">
                <thead>
                  <tr className="bg-[#f1f4f7] text-[#64748b] text-[10px] font-bold uppercase tracking-widest border-b border-[#d7dadd]">
                    <th className="px-6 py-4 w-12 text-center"></th>
                    <th className="px-6 py-4">Doctor Name</th>
                    <th className="px-6 py-4">Department</th>
                    <th className="px-6 py-4">Current Status</th>
                    <th className="px-6 py-4 text-center">Duty Activated</th>
                    <th className="px-6 py-4 text-center">Duty Deactivated</th>
                    <th className="px-6 py-4 text-center">Consultations Today</th>
                    <th className="px-6 py-4 text-center">Patients Seen Today</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1f4f7] text-xs">
                  {groupedDoctors.map((doc: any) => {
                    const isExpanded = !!expandedDoctors[doc.doctorId];
                    return (
                       <React.Fragment key={doc.doctorId}>
                        {/* Parent Group Row */}
                        <tr 
                          onClick={() => toggleDoctorExpand(doc.doctorId)}
                          className="hover:bg-slate-50/70 transition-colors cursor-pointer border-l-4 border-transparent hover:border-l-[#003285]"
                        >
                          <td className="px-6 py-4 text-center" onClick={(e) => {
                            e.stopPropagation();
                            toggleDoctorExpand(doc.doctorId);
                          }}>
                            <button className="p-1 hover:bg-slate-100 rounded transition-all text-slate-500">
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </td>
                          <td className="px-6 py-4 font-bold text-sm text-[#1e293b]">
                            <div>{doc.doctorName}</div>
                            <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                              ID: {doc.employeeId}
                            </div>
                          </td>
                          <td className="px-6 py-4 font-semibold text-slate-600">
                            {doc.department}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider uppercase border border-solid ${
                              (doc.currentStatus === 'PRESENT' || doc.currentStatus === 'ON DUTY')
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                : doc.currentStatus === 'INACTIVE'
                                ? 'bg-slate-100 text-slate-600 border-slate-200'
                                : 'bg-rose-50 text-rose-700 border-rose-100'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${
                                (doc.currentStatus === 'PRESENT' || doc.currentStatus === 'ON DUTY')
                                  ? 'bg-emerald-600'
                                  : doc.currentStatus === 'INACTIVE'
                                  ? 'bg-slate-400'
                                  : 'bg-rose-600'
                              }`} />
                              {doc.currentStatus}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center font-semibold font-mono text-slate-600 bg-emerald-50/10">
                            {formatFullTime(doc.dutyActivated)}
                          </td>
                          <td className="px-6 py-4 text-center font-semibold font-mono text-slate-600 bg-rose-50/10">
                            {(doc.currentStatus === 'ON DUTY' && !doc.dutyDeactivated) ? '—' : formatFullTime(doc.dutyDeactivated)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="text-sm font-black text-[#003285] bg-[#003285]/5 px-2.5 py-1 rounded-md border border-[#003285]/10 font-mono">
                              {doc.consultationsToday}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="text-sm font-black text-purple-800 bg-purple-500/5 px-2.5 py-1 rounded-md border border-purple-500/10 font-mono">
                              {doc.patientsSeenToday}
                            </span>
                          </td>
                        </tr>

                        {/* Child History Rows */}
                        {isExpanded && (
                          <tr className="bg-[#f8fafc]/50">
                            <td colSpan={8} className="px-8 py-4 bg-[#f8fafc]/20 border-t border-b border-[#e2e8f0]">
                              <div className="rounded-lg border border-[#e2e8f0] bg-white overflow-hidden shadow-xs">
                                <div className="bg-[#f1f4f7] p-3 px-4 border-b border-[#e2e8f0] flex justify-between items-center">
                                  <span className="text-[10px] font-black uppercase text-slate-800 tracking-wider flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#003285]" />
                                    Clinical Audit Trail Ledger: {doc.doctorName}
                                  </span>
                                  <span className="text-[10px] font-bold text-[#64748b]">
                                    {doc.history.length} active shift entries
                                  </span>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left font-sans text-xs">
                                    <thead className="bg-[#f8fafc] text-[#64748b] text-[9px] font-black uppercase tracking-wider border-b border-[#e2e8f0]">
                                      <tr>
                                        <th className="px-6 py-3">Audit Date</th>
                                        <th className="px-6 py-3">Attendance Status</th>
                                        <th className="px-6 py-3 text-center">Duty Activated</th>
                                        <th className="px-6 py-3 text-center">Duty Released</th>
                                        <th className="px-6 py-3 text-center">Completed Consultations</th>
                                        <th className="px-6 py-3 text-center">Patients Seen</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {doc.history.map((hist: any, hIdx: number) => (
                                        <tr key={`${hist.date}-${hIdx}`} className="hover:bg-slate-50">
                                          <td className="px-6 py-3 font-semibold text-slate-700">{hist.date}</td>
                                          <td className="px-6 py-3">
                                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black tracking-wider uppercase border ${
                                              (hist.attendanceStatus === 'PRESENT' || hist.attendanceStatus === 'ON DUTY')
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                                : hist.attendanceStatus === 'INACTIVE'
                                                ? 'bg-slate-100 text-slate-600 border-slate-200'
                                                : 'bg-rose-50 text-rose-700 border-rose-100'
                                            }`}>
                                              <span className={`w-1 h-1 rounded-full ${
                                                (hist.attendanceStatus === 'PRESENT' || hist.attendanceStatus === 'ON DUTY') ? 'bg-emerald-600' : hist.attendanceStatus === 'INACTIVE' ? 'bg-slate-400' : 'bg-rose-600'
                                              }`} />
                                              {hist.attendanceStatus}
                                            </span>
                                          </td>
                                          <td className="px-6 py-3 text-center font-mono text-emerald-600 bg-emerald-50/5">{formatFullTime(hist.dutyActivatedTime)}</td>
                                          <td className="px-6 py-3 text-center font-mono text-rose-600 bg-rose-50/5">{(hist.attendanceStatus === 'ON DUTY' && !hist.dutyDeactivatedTime) ? '—' : formatFullTime(hist.dutyDeactivatedTime)}</td>
                                          <td className="px-6 py-3 text-center font-mono text-[#003285] font-semibold">
                                            {hist.consultationsCompleted}
                                          </td>
                                          <td className="px-6 py-3 text-center font-mono text-purple-700 font-semibold">
                                            {hist.patientsSeen}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="p-12 text-center text-[#64748b]">
                <p className="text-sm font-bold text-slate-700">No attendance reports match your filtering options.</p>
                <p className="text-xs text-slate-400 font-medium mt-1">Please adjust search or calendar ranges.</p>
              </div>
            );
          })()}
        </div>
      </div>

      {/* REAL TRANSACTIONS LEDGER TABLE (Replaces old redundant items) */}
      <div id="billing-transactions-table" className="bg-white rounded-lg border border-[#d7dadd] shadow-sm overflow-hidden mt-8">
        <div className="p-6 border-b border-[#d7dadd] flex justify-between items-center bg-white">
          <h3 className="text-lg font-extrabold text-[#003285] flex items-center gap-2">
            <Receipt size={20} className="text-[#003285]" />
            Recent Transactions
          </h3>
          <span className="text-xs font-bold text-[#64748b] bg-[#f1f4f7] px-3 py-1.5 rounded-lg border border-[#d7dadd]">
            Billing & Invoices Ledger
          </span>
        </div>
        <div className="overflow-x-auto">
          {activeTransactions.length > 0 ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#f1f4f7] text-[#64748b] text-[10px] font-bold uppercase tracking-widest border-b border-[#d7dadd]">
                  <th className="px-8 py-4">Bill Number</th>
                  <th className="px-6 py-4">Patient Name</th>
                  <th className="px-6 py-4">Token Number</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-8 py-4 font-medium text-left">Processed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f1f4f7] text-sm">
                {activeTransactions.slice(0, 10).map((bill: any, idx: number) => {
                  const billNo = `INV-${bill.id.slice(-6).toUpperCase()}`;
                  const patName = bill.patient?.name || "Walk-In patient";
                  const tokNo = bill.tokenNumber ? `#${bill.tokenNumber}` : 'N/A';
                  const totalAmt = `$${(bill.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                  const dateStr = new Date(bill.createdAt).toLocaleDateString();
                  const pharmacistId = bill.dispensingLog?.pharmacistId || null;
                  const dispenser = getPharmacistName(pharmacistId);

                  return (
                    <tr key={bill.id || idx} className="hover:bg-[#f7fafd] transition-colors">
                      <td className="px-8 py-4 font-mono font-bold text-xs text-[#003285]">
                        {billNo}
                      </td>
                      <td className="px-6 py-4 font-bold text-[#1e293b]">
                        {patName}
                      </td>
                      <td className="px-6 py-4 font-semibold text-slate-600">
                        {tokNo}
                      </td>
                      <td className="px-6 py-4 font-extrabold text-[#1e293b]">
                        {totalAmt}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          bill.status === "PAID" 
                            ? "bg-teal-50 text-teal-700 border border-teal-100" 
                            : bill.status === "UNPAID" 
                            ? "bg-amber-50 text-amber-700 border border-amber-100" 
                            : "bg-slate-100 text-slate-700 border border-slate-200"
                        }`}>
                          {bill.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-[#64748b]">
                        {dateStr}
                      </td>
                      <td className="px-8 py-4 font-medium text-slate-700">
                        {dispenser}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              No bills or invoice transactions registered during this query window.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
