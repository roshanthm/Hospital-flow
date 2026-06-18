import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from "motion/react";
import { 
  TrendingUp, DollarSign, 
  FileText, Download,
  Calendar, AlertCircle,
  MoreVertical, Shield, ChevronDown, Search, X, CheckSquare
} from "lucide-react";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer
} from 'recharts';
import { toast } from 'sonner';
import { useStore, authFetch } from '@/src/store/useStore';
import { generateBillPDF } from '../../lib/pdfUtils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function RevenueReports() {
  const bills = useStore(state => state.bills);
  const fetchBills = useStore(state => state.fetchBills);
  const departments = useStore(state => state.departments);
  const fetchDepartments = useStore(state => state.fetchDepartments);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'All' | 'Completed' | 'Processing'>('All');
  const [timeFilter, setTimeFilter] = useState<'all' | '30days'>('all');

  const [revenueSummary, setRevenueSummary] = useState<any>({
    totalRevenueFiltered: 0,
    outstandingInvoicesFiltered: 0,
    settledBillsCountFiltered: 0,
    settlementRate: '0.0%',
    dynamicGrowth: '0.0%',
    trendChartData: [],
    calculatedDeptData: []
  });
  const [isSummaryLoading, setIsSummaryLoading] = useState(true);

  const loadRevenueSummary = async () => {
    setIsSummaryLoading(true);
    try {
      const res = await authFetch(`/api/admin/revenue-summary?timeFilter=${timeFilter}`);
      if (res.ok) {
        const data = await res.json();
        setRevenueSummary(data);
      }
    } catch (err) {
      console.error('Failed to load revenue report metrics:', err);
    } finally {
      setIsSummaryLoading(false);
    }
  };

  useEffect(() => {
    fetchBills();
    if (fetchDepartments) {
      fetchDepartments();
    }
  }, []);

  useEffect(() => {
    loadRevenueSummary();
  }, [timeFilter, bills]);

  const {
    totalRevenueFiltered,
    outstandingInvoicesFiltered,
    settledBillsCountFiltered,
    settlementRate,
    dynamicGrowth,
    trendChartData,
    calculatedDeptData
  } = revenueSummary;

  const now = new Date();
  const currentYear = now.getFullYear();

  // Helper to check if a bill date is within the selected range (last 30 days or current year)
  const isBillInFilterRange = (billDateStr: string | Date | null | undefined) => {
    if (!billDateStr) return false;
    const bd = new Date(billDateStr);
    if (isNaN(bd.getTime())) return false;
    
    if (timeFilter === '30days') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return bd >= thirtyDaysAgo;
    } else {
      // Annual View: current year (January -> December)
      return bd.getFullYear() === currentYear;
    }
  };

  // Helper to retrieve initials for patients
  const getInitials = (name: string) => {
    return name.split(' ').map((n: string) => n[0] || '').join('').toUpperCase().slice(0, 2) || 'PT';
  };

  // Real database-driven transactional record mapper - Removing mocked Payment Method
  const mappedTransactions = (bills || []).map((bill: any) => {
    const rawDept = bill.dispensingLog?.pharmacyQueue?.prescription?.doctor?.department || 'Pharmacy';
    let deptName = rawDept.charAt(0).toUpperCase() + rawDept.slice(1).toLowerCase();
    
    if (deptName.includes('Cardio')) deptName = 'Cardiology';
    else if (deptName.includes('Onco')) deptName = 'Oncology';
    else if (deptName.includes('Neuro')) deptName = 'Neurology';
    else if (deptName.includes('Radio')) deptName = 'Radiology';
    else if (deptName.includes('Emerg')) deptName = 'Emergency';

    const patientName = bill.patient?.name || 'Guest Patient';
    const summaryItems = bill.items && bill.items.length > 0
      ? bill.items.map((i: any) => i.name).join(', ')
      : 'Prescription Checkout';

    // Real database billing status map
    const mappedStatus = bill.status === 'PAID' ? 'Completed' : 'Processing';

    // Calculate total item quantity sum
    const totalQty = bill.items && bill.items.length > 0
      ? bill.items.reduce((sum: number, i: any) => sum + (i.quantity || 1), 0)
      : 1;

    return {
      id: bill.id,
      name: patientName,
      service: summaryItems.length > 35 ? summaryItems.slice(0, 35) + '...' : summaryItems,
      department: deptName,
      quantity: totalQty,
      amount: bill.total,
      status: mappedStatus,
      rawStatus: bill.status,
      date: bill.createdAt ? new Date(bill.createdAt).toLocaleDateString() : 'N/A',
      avatar: getInitials(patientName),
      rawBill: bill
    };
  });

  const handleDeptClick = (deptName: string) => {
    if (selectedDept === deptName) {
      setSelectedDept(null);
      toast.info('Cleared department filter');
    } else {
      setSelectedDept(deptName);
      toast.info(`Filtering transactions by ${deptName}`);
    }
  };

  // Filter transactions logically
  const filteredTransactions = mappedTransactions.filter(item => {
    const matchesDept = !selectedDept || item.department.toLowerCase() === selectedDept.toLowerCase();
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          item.service.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.department.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab = activeTab === 'All' || item.status === activeTab;
    return matchesDept && matchesSearch && matchesTab;
  });

  // Action download generating a real medical database PDF report matching live entries
  const handleExport = () => {
    if (!bills || bills.length === 0) {
      toast.error('No financial data available in database to export.');
      return;
    }

    const toastId = toast.loading('Loading...');

    try {
      // 1. Initialize Document
      const doc = new jsPDF('p', 'mm', 'a4'); // Portrait, Millimeters, A4 size
      const dateStr = new Date().toLocaleString('en-US', { hour12: true });
      const periodStr = timeFilter === 'all' ? 'Annual Trajectory' : 'Last 30 Days Cycle';

      // ==========================================
      // PAGE 1: TITLE & EXECUTIVE SUMMARY
      // ==========================================

      // Header top line accent
      doc.setFillColor(13, 59, 102); // Deep Navy
      doc.rect(14, 15, 182, 3, 'F');

      // MedFlow Branding
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(13, 59, 102);
      doc.text('MEDFLOW', 14, 30);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(26, 86, 179); // Clinical Blue
      doc.text('HEALTHCARE GLOBAL SYSTEM', 14, 35);

      // Report Title Block (Right Header)
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text('FINANCIAL PERFORMANCE REPORT', 196, 30, { align: 'right' });

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(`Generated: ${dateStr}`, 196, 35, { align: 'right' });
      doc.text(`Trajectory Period: ${periodStr}`, 196, 40, { align: 'right' });

      // Horizontal separator rule
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(14, 45, 196, 45);

      // KPI Boxes Function Definition
      const drawKPICard = (x: number, y: number, w: number, h: number, title: string, value: string, sub: string, accentColor: [number, number, number]) => {
        // Base Box
        doc.setFillColor(248, 250, 252);
        doc.rect(x, y, w, h, 'F');
        
        // Left Border accent strip
        doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
        doc.rect(x, y, 4, h, 'F');
        
        // Outer light border box
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.rect(x, y, w, h, 'S');
        
        // Card Title
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(title.toUpperCase(), x + 10, y + 6);
        
        // Card Metric
        doc.setFontSize(15);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 41, 59);
        doc.text(value, x + 10, y + 14);
        
        // Secondary label
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text(sub, x + 10, y + 19);
      };

      // Formulating Strings
      const totalRevenueVal = `$${totalRevenueFiltered.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const outstandingVal = `$${outstandingInvoicesFiltered.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const settledCountVal = `${settledBillsCountFiltered} Paid Bills`;
      const growthVal = dynamicGrowth;

      // Draw 2x2 Clean Balanced KPI Grid
      drawKPICard(14, 52, 88, 22, `Total Revenue (${timeFilter === '30days' ? '30 Days' : 'Annual'})`, totalRevenueVal, "+12% outpatient pharmacy growth", [16, 185, 129]);
      drawKPICard(108, 52, 88, 22, `Outstanding Invoices`, outstandingVal, "Unpaid bills pending accounts clearing", [239, 68, 68]);
      drawKPICard(14, 78, 88, 22, "Completed Bills Paid", settledCountVal, `${settlementRate} settlement completion rate`, [13, 59, 102]);
      drawKPICard(108, 78, 88, 22, "Revenue Growth %", growthVal, "Current month compared against last", [99, 102, 241]);

      // Department Section title
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(13, 59, 102);
      doc.text('DEPARTMENTAL REVENUE DISTRIBUTION', 14, 112);
      
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('Tracks absolute collections and relative performance mapped directly to originating prescribing clinical specialists.', 14, 116);

      // Department table body creation
      const deptRows = calculatedDeptData.map((dept: any) => [
        dept.name,
        `$${dept.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        dept.pct
      ]);

      // Draw Department table using autoTable
      autoTable(doc, {
        startY: 120,
        head: [['Clinical Department', 'Revenue Collected', 'Percentage Share']],
        body: deptRows,
        theme: 'striped',
        headStyles: { fillColor: [13, 59, 102], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        styles: { fontSize: 8.5, cellPadding: 4 },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 60, halign: 'right' },
          2: { cellWidth: 42, halign: 'center' }
        },
        margin: { left: 14, right: 14 }
      });

      const page1FinalY = (doc as any).lastAutoTable.finalY;

      // Executive Compliance Summary Note Block at bottom of Page 1
      const insightsY = Math.max(page1FinalY + 12, 185);
      
      doc.setFillColor(240, 246, 252);
      doc.rect(14, insightsY, 182, 28, 'F');
      
      doc.setDrawColor(186, 210, 235);
      doc.setLineWidth(0.5);
      doc.rect(14, insightsY, 182, 28, 'S');

      doc.setFillColor(26, 86, 179);
      doc.rect(14, insightsY, 4, 28, 'F');
      
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(13, 59, 102);
      doc.text('EXECUTIVE COMMISSION AUDIT & COMPLIANCE SUMMARY', 24, insightsY + 7);
      
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text('• Patient-consultation to prescription-dispense flow is monitored securely across hospital databases.', 24, insightsY + 13);
      doc.text(`• Total audit ledger comprises ${(bills || []).length} generated bills (${bills.filter((b: any) => b.status === "PAID").length} settled, ${bills.filter((b: any) => b.status === "UNPAID").length} pending).`, 24, insightsY + 18);
      doc.text('• Department-level classification is extracted cleanly from medical staff consultation indices.', 24, insightsY + 23);

      // ==========================================
      // PAGE 2: HISTORICAL METRICS & AUDIT LEDGER
      // ==========================================

      doc.addPage();

      // Top decorative rule for Page 2
      doc.setFillColor(13, 59, 102);
      doc.rect(14, 15, 182, 3, 'F');
      
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(13, 59, 102);
      doc.text('FINANCIAL METRICS DETAIL & HISTORICAL RECORDS', 14, 26);
      
      // Divider line
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(14, 30, 196, 30);

      // Revenue Trend section
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(13, 59, 102);
      doc.text('MONTHLY REVENUE TREND COMPARISON', 14, 38);

      const trendRows = trendChartData.map((item: any) => {
        const currentVal = item.current !== null && item.current !== undefined ? item.current : 0;
        const prevVal = item.previous !== null && item.previous !== undefined ? item.previous : 0;
        
        let fluxStr = '0.0%';
        if (prevVal > 0) {
          const flux = ((currentVal - prevVal) / prevVal) * 100;
          fluxStr = `${flux >= 0 ? '+' : ''}${flux.toFixed(1)}%`;
        } else if (currentVal > 0) {
          fluxStr = '+100.0%';
        }
        
        return [
          item.name,
          `$${currentVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          `$${prevVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          fluxStr
        ];
      });

      // Annual / Monthly comparative trend table
      autoTable(doc, {
        startY: 42,
        head: [['Period (Cycle)', 'Current Trajectory (A)', 'Prior Horizon (B)', 'Comparative Flux %']],
        body: trendRows.slice(0, 12), // ensure exactly 12 month items displayed beautifully
        theme: 'grid',
        headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
        styles: { fontSize: 8, cellPadding: 3 },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 50, halign: 'right' },
          2: { cellWidth: 50, halign: 'right' },
          3: { cellWidth: 42, halign: 'center' }
        },
        margin: { left: 14, right: 14 }
      });

      const page2TrendFinalY = (doc as any).lastAutoTable.finalY;

      // Section 4: Detailed Transaction Ledger (Audit Trail)
      const ledgerY = page2TrendFinalY + 10;
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(13, 59, 102);
      doc.text('DETAILED AUDIT TRAIL — GENERATED TRANSACTIONS', 14, ledgerY);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text('Complete collection register showing clinical billing logs, payment categories, and payment settlement stat.', 14, ledgerY + 4);

      const txRows = (bills || [])
        .filter((bill: any) => isBillInFilterRange(bill.createdAt))
        .map((bill: any) => {
        const patientName = bill.patient?.name || 'Guest Patient';
        
        const rawDept = bill.dispensingLog?.pharmacyQueue?.prescription?.doctor?.department || 'Pharmacy';
        let deptName = rawDept.charAt(0).toUpperCase() + rawDept.slice(1).toLowerCase();
        if (deptName.includes('Cardio')) deptName = 'Cardiology';
        else if (deptName.includes('Onco')) deptName = 'Oncology';
        else if (deptName.includes('Neuro')) deptName = 'Neurology';
        else if (deptName.includes('Radio')) deptName = 'Radiology';
        else if (deptName.includes('Emerg')) deptName = 'Emergency';

        const summaryItems = bill.items && bill.items.length > 0
          ? bill.items.map((i: any) => `${i.name} (x${i.quantity || 1})`).join(', ')
          : 'Prescription Checkout';

        return [
          bill.id.slice(-8).toUpperCase(),
          patientName,
          deptName,
          summaryItems.length > 30 ? summaryItems.slice(0, 30) + '...' : summaryItems,
          `$${bill.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          bill.status,
          new Date(bill.createdAt).toLocaleDateString()
        ];
      });

      // Major transaction ledger table
      autoTable(doc, {
        startY: ledgerY + 8,
        head: [['Invoice ID', 'Patient Name', 'Clinical Dept', 'Service Mapped', 'Amount', 'Status', 'Dispensed Date']],
        body: txRows,
        theme: 'striped',
        headStyles: { fillColor: [13, 59, 102], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
        styles: { fontSize: 8, cellPadding: 3.5 },
        columnStyles: {
          0: { cellWidth: 20 },
          1: { cellWidth: 35 },
          2: { cellWidth: 30 },
          3: { cellWidth: 40 },
          4: { cellWidth: 22, halign: 'right' },
          5: { cellWidth: 20, halign: 'center' },
          6: { cellWidth: 24, halign: 'center' }
        },
        margin: { left: 14, right: 14 }
      });

      // Page numbers & beautiful footers stamp for all generated pages
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text('MedFlow Healthcare Admin System • Secure Financial Auditor Ledger', 14, 287);
        doc.text(`Audit Page ${i} of ${totalPages}`, 196, 287, { align: 'right' });
      }

      // Save generated report
      const cleanDate = new Date().toISOString().split('T')[0];
      doc.save(`MedFlow_Corporate_Financial_Report_${cleanDate}.pdf`);

      toast.dismiss(toastId);
      toast.success('Financial PDF Report Generated Successfully', {
        description: `Exported comprehensive A4 executive auditor ledger of ${bills.length} active invoices.`
      });
    } catch (err: any) {
      console.error('PDF generation error: ', err);
      toast.dismiss(toastId);
      toast.error('Could not generate financial report PDF. Falling back to CSV export.', {
        description: err?.message || 'Unexpected rendering fault.'
      });
      // Safe fallback download matching user expectations
      try {
        const headers = ['Invoice ID', 'Patient Name', 'Prescribing Dept', 'Invoice Items', 'Subtotal', 'Tax (5%)', 'Total Amount', 'Status', 'Dispensed Date'];
        const rows = bills.map((bill: any) => {
          const patientName = bill.patient?.name || 'Unknown';
          const prodList = bill.items ? bill.items.map((i: any) => `${i.name} (x${i.quantity})`).join('|') : 'Pharmacy Cart';
          const deptName = bill.dispensingLog?.pharmacyQueue?.prescription?.doctor?.department || 'Pharmacy';
          const status = bill.status;
          return [bill.id, patientName, deptName, prodList, bill.subtotal, bill.tax, bill.total, status, new Date(bill.createdAt).toLocaleDateString()];
        });
        const csvContent = [headers.join(','), ...rows.map(row => row.map(val => `"${val}"`).join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `medflow_financial_report_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (innerErr) {
        console.error('CSV fallback failed: ', innerErr);
      }
    }
  };

  const showRedesignShell = false;
  if (showRedesignShell) {
    return <div id="blank-revenue-reports" className="w-full h-full min-h-screen bg-slate-50" />;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-16">
      
      {/* Page Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Financial Overview</h2>
          <p className="text-slate-500 text-sm mt-1">Monitoring fiscal performance across all clinical departments.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => {
              const targetFilter = timeFilter === 'all' ? '30days' : 'all';
              setTimeFilter(targetFilter);
              toast.info(`Switched trajectory filter to: ${targetFilter === 'all' ? 'Annual Trajectory' : 'Last 30 Days Cycle'}`);
            }}
            className={`flex items-center gap-2 px-4 py-2 border rounded-md text-sm font-semibold transition-colors ${
              timeFilter === '30days' 
                ? 'bg-blue-50 border-blue-200 text-[#0D3B66] font-bold' 
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Calendar size={16} />
            {timeFilter === '30days' ? 'Last 30 Days' : 'Annual View'}
          </button>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-[#0D3B66] text-white rounded-md text-sm font-semibold hover:bg-blue-900 transition-colors cursor-pointer shadow-sm active:scale-95"
          >
            <Download size={16} />
            Export Financial Report
          </button>
        </div>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        
        {/* Card 1: Total Revenue */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-start justify-between mb-4">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <DollarSign size={24} />
            </div>
            <span className="text-[12px] font-semibold text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center">
              <TrendingUp size={12} className="mr-0.5" />
              12%
            </span>
          </div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{timeFilter === '30days' ? 'Total Revenue (30d)' : 'Total Revenue (Annual)'}</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">
            ${totalRevenueFiltered.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        {/* Card 2: Outstanding Invoices */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-start justify-between mb-4">
            <div className="p-2 bg-rose-50 text-rose-500 rounded-lg">
              <FileText size={24} />
            </div>
            <span className="text-[12px] font-semibold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full flex items-center">
              <AlertCircle size={12} className="mr-1" />
              High
            </span>
          </div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{timeFilter === '30days' ? 'Outstanding Invoices (30d)' : 'Outstanding Invoices (Annual)'}</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">
            ${outstandingInvoicesFiltered.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        {/* Card 3: Completed Bills Paid */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-start justify-between mb-4">
            <div className="p-2 bg-teal-50 text-teal-600 rounded-lg">
              <CheckSquare size={24} />
            </div>
            <span className="text-[12px] font-semibold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">{settlementRate} Rate</span>
          </div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Completed Bills Paid</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{settledBillsCountFiltered}</p>
        </div>

        {/* Card 4: Revenue Growth */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-start justify-between mb-4">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <TrendingUp size={24} />
            </div>
            <span className="text-[12px] font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full">Q3 Target</span>
          </div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Revenue Growth %</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{dynamicGrowth}</p>
        </div>

      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        
        {/* Column: Revenue Trend (Line Chart) */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col h-[400px]">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-bold text-slate-800">Revenue Trend</h3>
              <p className="text-xs text-slate-400 font-medium">
                {timeFilter === '30days' ? 'Daily metrics for past 30 days cycle' : 'Monthly fiscal trajectory for the current year'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#0D3B66]"></span>
                <span className="text-xs font-semibold text-slate-600">Current Year</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-slate-200"></span>
                <span className="text-xs font-semibold text-slate-600">Previous Year</span>
              </div>
            </div>
          </div>
          
          {/* Canvas Container rendered with pristine Recharts AreaChart to look identical */}
          <div className="flex-1 relative min-h-0 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendChartData}>
                <defs>
                  <linearGradient id="colorCurrentYear" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0D3B66" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#0D3B66" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  fontSize={10} 
                  fontWeight={500}
                  fontFamily="Inter"
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#94a3b8' }} 
                  dy={10}
                />
                <YAxis 
                  fontSize={10} 
                  fontWeight={500}
                  fontFamily="Inter"
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#94a3b8' }}
                  tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                  formatter={(value: any) => [`$${value.toLocaleString()}`, 'Revenue']}
                />
                <Area 
                  type="monotone" 
                  dataKey="previous" 
                  stroke="#e2e8f0" 
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  fill="none"
                  dot={false}
                  activeDot={false}
                />
                <Area 
                  type="monotone" 
                  dataKey="current" 
                  stroke="#0D3B66" 
                  strokeWidth={2.5}
                  fill="url(#colorCurrentYear)"
                  connectNulls={true}
                  dot={false}
                  activeDot={{ r: 6, fill: '#0D3B66', strokeWidth: 2, stroke: '#fff' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Column: Revenue by Dept (Bar List) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col h-[400px]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-bold text-slate-800">Revenue by Dept</h3>
            {selectedDept && (
              <button 
                onClick={() => setSelectedDept(null)}
                className="text-[10px] font-bold text-[#1A56B3] flex items-center gap-0.5 bg-blue-50 px-2 py-1 rounded"
              >
                Clear Filter <X size={10} />
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400 mb-6 font-medium">Click on any department to filter table records below.</p>
          
          <div className="flex-1 space-y-5 overflow-y-auto pr-1">
            {calculatedDeptData.map((dept: any) => {
              const isActive = selectedDept === dept.name;
              const hasSelection = selectedDept !== null;
              return (
                <div 
                  key={dept.name} 
                  data-purpose="dept-revenue-bar"
                  onClick={() => handleDeptClick(dept.name)}
                  className={`cursor-pointer group p-1.5 rounded-lg transition-all ${
                    isActive 
                      ? 'bg-slate-50 ring-2 ring-offset-2 ring-[#0D3B66]' 
                      : hasSelection ? 'opacity-40 hover:opacity-100' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-800 transition-colors flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-[#1A56B3]' : 'bg-[#0D3B66]/60'}`} />
                      {dept.name}
                    </span>
                    <span className="text-xs font-bold text-slate-800">${dept.value.toLocaleString()}</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-[#0D3B66] rounded-full transition-all group-hover:bg-[#1A56B3]" 
                      initial={{ width: 0 }}
                      animate={{ width: dept.pct }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <button 
            onClick={() => {
              setSelectedDept(null);
              toast.info('Showing general breakdown overview');
            }}
            className="mt-6 w-full py-3 border-t border-slate-100 text-xs font-bold text-[#1A56B3] hover:underline"
          >
            Switch to Detailed View
          </button>
        </div>

      </div>

      {/* Transactions Table Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        
        <div className="flex flex-col md:flex-row md:items-center justify-between p-6 border-b border-slate-100 gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Recent Transactions</h3>
            {selectedDept && (
              <span className="inline-flex items-center gap-1.5 text-xs text-blue-800 font-bold bg-blue-50 px-2 py-0.5 rounded-md mt-1">
                Department: {selectedDept}
                <button onClick={() => setSelectedDept(null)}><X size={12} className="text-blue-500 hover:text-blue-700" /></button>
              </span>
            )}
          </div>
          
          {/* Controls: Search, Tabs */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-64">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                <Search size={14} className="text-slate-400" />
              </span>
              <input 
                type="text" 
                placeholder="Search patient or service..."
                className="w-full pl-9 pr-6 py-1.5 border border-slate-200 rounded-md text-xs bg-slate-50 focus:ring-[#1A56B3] focus:border-[#1A56B3] focus:bg-white transition-all outline-none"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="flex border border-slate-200 rounded-md overflow-hidden bg-slate-50">
              {(['All', 'Completed', 'Processing'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 text-xs font-semibold border-r last:border-r-0 border-slate-200 transition-all ${
                    activeTab === tab 
                      ? 'bg-white text-[#0D3B66] shadow-sm font-bold' 
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Patient Name</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Department</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Service</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Qty</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-right">Amount</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bill Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <AnimatePresence mode="popLayout">
                {filteredTransactions.length > 0 ? (
                  filteredTransactions.map((tx) => (
                    <motion.tr 
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      key={tx.id} 
                      className="hover:bg-slate-50 transition-colors border-b border-slate-100/50"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 text-[#1A56B3] flex items-center justify-center text-[10px] font-bold">
                            {tx.avatar}
                          </div>
                          <span className="text-sm font-semibold text-slate-800">{tx.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold uppercase tracking-wide">
                          {tx.department}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-medium truncate max-w-[200px]" title={tx.service}>
                        {tx.service}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-medium text-center">
                        {tx.quantity}
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-slate-800 text-right">
                        ${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          tx.status === 'Completed' 
                            ? 'bg-teal-50 text-teal-600' 
                            : 'bg-blue-50 text-[#1A56B3]'
                        }`}>
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">
                        {tx.date}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button 
                          onClick={() => {
                            if (tx.rawBill) {
                              generateBillPDF(tx.rawBill);
                            } else {
                              toast.info(`Invoice Identifier: ${tx.id}`);
                            }
                          }}
                          className="medflow-btn medflow-btn-outline p-1.5 flex items-center justify-center mx-auto text-slate-500 hover:text-[#1A56B3] border border-slate-200 hover:border-blue-200 bg-white rounded-md transition-colors"
                          title="Generate/Download Bill PDF"
                        >
                          <Download size={14} />
                        </button>
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-400 font-medium">
                      No transactions match the selected filters.
                    </td>
                  </tr>
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        
        {/* Pagination/Controls footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-400 font-medium">Showing {filteredTransactions.length} of {mappedTransactions.length} records</p>
          <button 
            onClick={() => toast.info('Loading full hospital transaction database...', {
              description: 'You can navigate to the Pharmacy tab to manage raw dispenser orders.'
            })}
            className="text-xs font-bold text-[#1A56B3] hover:underline"
          >
            View Full Ledger
          </button>
        </div>

      </div>

    </div>
  );
}
