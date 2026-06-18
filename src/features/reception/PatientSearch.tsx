/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore, authFetch } from '@/src/store/useStore';
import { 
  Search, Calendar, User, 
  ArrowRight, Phone, ShieldCheck,
  Stethoscope, Clock, CheckCircle2, UserPlus,
  History, X, CheckSquare, Bell
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import MedicalHistoryModal from '@/src/components/MedicalHistoryModal';
import GenerateTokenModal from '@/src/components/GenerateTokenModal';
import { isPatientHighRisk } from '@/src/lib/pdfUtils';

const isToday = (dateInput: any) => {
  if (!dateInput) return false;
  const d = new Date(dateInput);
  const today = new Date();
  return d.getDate() === today.getDate() &&
         d.getMonth() === today.getMonth() &&
         d.getFullYear() === today.getFullYear();
};

const PRIORITY_ORDER: Record<string, number> = {
  'EMERGENCY': 5,
  'URGENT': 4,
  'HIGH': 3,
  'MEDIUM': 2,
  'LOW': 1,
  'NORMAL': 1,
  'STANDARD': 1
};

const getPriorityOrder = (t: any) => {
  if (t.priority) {
    return PRIORITY_ORDER[t.priority.toUpperCase()] || 2;
  }
  const hist = (t.patient?.medicalHistory || '').toLowerCase();
  const match = hist.match(/priority:\s*([a-z\-]+)/i);
  if (match) {
    return PRIORITY_ORDER[match[1].toUpperCase()] || 2;
  }
  return 2;
};

export default function PatientSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const patients = useStore(state => state.patients);
  const users = useStore(state => state.users);
  const tokens = useStore(state => state.tokens);
  const activityLogs = useStore(state => state.activityLogs);
  const addAppointment = useStore(state => state.addAppointment);
  const addActivityLog = useStore(state => state.addActivityLog);
  const fetchPatients = useStore(state => state.fetchPatients);
  const fetchUsers = useStore(state => state.fetchUsers);
  const fetchTokens = useStore(state => state.fetchTokens);
  const fetchPatientHistory = useStore(state => state.fetchPatientHistory);
  const fetchActivityLogs = useStore(state => state.fetchActivityLogs);
  const logout = useStore(state => state.logout);
  const currentUser = useStore(state => state.currentUser);

  const [headerSearchTerm, setHeaderSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any>({ patients: [], tokens: [], consultations: [] });
  const [searchTimeout, setSearchTimeout] = useState<any>(null);

  const handleManualRefresh = async () => {
    const toastId = toast.loading('Refreshing patient entries & tickets...');
    try {
      await Promise.all([
        fetchUsers(),
        fetchTokens({ today: true }),
        fetchActivityLogs()
      ]);
      toast.success('Patient registry and ticket queues synchronized!', { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to sync. Please check network connection.', { id: toastId });
    }
  };

  const handleSearchChange = (val: string) => {
    setHeaderSearchTerm(val);
    if (!val.trim()) {
      setSearchResults({ patients: [], tokens: [], consultations: [] });
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/search?q=${encodeURIComponent(val)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data);
        }
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 250);
    setSearchTimeout(timeout);
  };

  const handleSelectSearchPatient = (name: string) => {
    setHeaderSearchTerm(name);
    setSearchResults({ patients: [], tokens: [], consultations: [] });
  };

  const handleSelectSearchToken = (tokenNumber: string) => {
    if (window.location.pathname.includes('/reception/tokens')) {
      setHeaderSearchTerm(tokenNumber);
    } else {
      navigate(`/reception/tokens?q=${encodeURIComponent(tokenNumber)}`);
    }
    setSearchResults({ patients: [], tokens: [], consultations: [] });
  };
  const [isNewAppointmentOpen, setIsNewAppointmentOpen] = useState(false);
  
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [patientHistory, setPatientHistory] = useState<any[]>([]);
  const [historyPatientName, setHistoryPatientName] = useState('');
  const [selectedLookupPatient, setSelectedLookupPatient] = useState<any | null>(null);

  // High Risk Modal and telemetry state
  const [isHighRiskViewOpen, setIsHighRiskViewOpen] = useState(false);

  // Esc-key modal closing support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsHistoryModalOpen(false);
        setIsNewAppointmentOpen(false);
        setIsHighRiskViewOpen(false);
        setSelectedLookupPatient(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Table shift filter tabs
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'MORNING' | 'AFTERNOON' | 'EVENING'>('ALL');
  const [selectedDoctorFilter, setSelectedDoctorFilter] = useState<string>('ALL');

  useEffect(() => {
    fetchUsers();
    fetchTokens({ today: true });
    fetchActivityLogs();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      handleSearchChange(q);
    }
  }, []);

  const doctors = (users || [])
    .filter(u => u.role === 'DOCTOR' && u.isActive !== false)
    .sort((a, b) => {
      const aOn = a.dutyStatus === 'ON DUTY' || a.dutyStatus === 'ON_DUTY';
      const bOn = b.dutyStatus === 'ON DUTY' || b.dutyStatus === 'ON_DUTY';
      if (aOn && !bOn) return -1;
      if (!aOn && bOn) return 1;
      return a.name.localeCompare(b.name);
    });

  // Trigger modal with pre-selected patient or empty
  const handleOpenNewAppointment = (patient: any = null) => {
    setIsNewAppointmentOpen(true);
  };

  const handleFetchHistory = async (patient: any) => {
    setSelectedLookupPatient(patient);
    setHistoryPatientName(patient.name);
    
    try {
      const res = await authFetch(`/api/patients/${patient.id}`);
      if (res.ok) {
        const fullPatientObj = await res.json();
        setSelectedLookupPatient(fullPatientObj);
      }
    } catch (error) {
      console.error('Failed to pre-fetch full patient details:', error);
    }

    const history = await fetchPatientHistory(patient.id);
    setPatientHistory(history);
    setIsHistoryModalOpen(true);
  };

  // Base dynamic KPI card calculations
  const todayTokens = tokens.filter(t => t.createdAt && isToday(t.createdAt));
  const totalTokens = todayTokens.length;
  const checkedInTokens = todayTokens.filter(t => t.status !== 'CANCELLED').length;
  const activeTokensCount = todayTokens.filter(t => t.status === 'WAITING' || t.status === 'IN_CONSULTATION').length;
  
  // Compute high-risk patients efficiently from active today tokens that already contain patient objects
  const highRiskPatientsList = useMemo(() => {
    const activeTodayPatientIds = new Set<string>();
    const activeTodayPatients: any[] = [];
    (tokens || []).forEach(t => {
      if (t.patient && t.createdAt && isToday(t.createdAt) && ['WAITING', 'CALLED', 'IN_CONSULTATION', 'CHECKED_IN'].includes(t.status)) {
        if (!activeTodayPatientIds.has(t.patient.id)) {
          activeTodayPatientIds.add(t.patient.id);
          activeTodayPatients.push(t.patient);
        }
      }
    });

    return activeTodayPatients.filter(p => {
      const isHighRiskRecord = isPatientHighRisk(p);
      const activeTodayTokens = tokens.filter(t => 
        t.patientId === p.id && 
        t.createdAt && 
        isToday(t.createdAt) && 
        ['WAITING', 'CALLED', 'IN_CONSULTATION', 'CHECKED_IN'].includes(t.status)
      );
      const hasHighPriorityToken = activeTodayTokens.some(t => 
        ['EMERGENCY', 'URGENT', 'HIGH'].includes(t.priority?.toUpperCase() || '')
      );
      return isHighRiskRecord || hasHighPriorityToken;
    });
  }, [tokens]);

  const emergencyAlertsCount = highRiskPatientsList.length;

  // Visual Fallback Data matching HTML layout precisely
  const mockTokens = [
    {
      id: "mock1",
      tokenNumber: "A-01",
      time: "09:00 AM",
      patient: { name: "Arthur Jenkins", phone: "555-0192", id: "p-mock1" },
      doctor: { name: "Dr. Elizabeth Vance" },
      purpose: "Annual Physical",
      status: "IN_CONSULTATION",
    },
    {
      id: "mock2",
      tokenNumber: "A-02",
      time: "09:30 AM",
      patient: { name: "Sarah Miller", phone: "555-0248", id: "p-mock2" },
      doctor: { name: "Dr. Alan Grant" },
      purpose: "Blood Work",
      status: "WAITING",
    },
    {
      id: "mock3",
      tokenNumber: "A-03",
      time: "10:00 AM",
      patient: { name: "Robert Klein", phone: "555-0311", id: "p-mock3" },
      doctor: { name: "Dr. Elizabeth Vance" },
      purpose: "Follow-up",
      status: "WAITING",
    },
    {
      id: "mock4",
      tokenNumber: "A-04",
      time: "10:15 AM",
      patient: { name: "Thomas Doe", phone: "555-0922", id: "p-mock4" },
      doctor: { name: "Dr. Sarah Connor" },
      purpose: "X-Ray Review",
      status: "CANCELLED",
    }
  ];

  const getPurposeFromHistory = (historyText?: string | null) => {
    if (!historyText) return 'General Consultation';
    const match = historyText.match(/Reason:\s*([^\n]+)/);
    return match ? match[1].trim() : 'General Consultation';
  };

  const defaultDoctor = (users || []).find(u => u.role === 'DOCTOR') || { id: 'fallback-doc', name: 'General Practitioner' };

  // Generate dynamic table rows from live database records
  const activeTokenItems: any[] = tokens
    .filter(t => t.createdAt && isToday(t.createdAt))
    .map(t => {
      const pat = t.patient;
      const doc = users.find(u => u.id === t.doctorId);
      return {
        id: t.id,
        tokenNumber: t.tokenNumber,
        time: t.createdAt ? new Date(t.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-',
        patient: pat,
        doctor: doc || defaultDoctor,
        department: doc?.department || 'General Medicine',
        status: t.status,
        createdAt: t.createdAt,
        priority: t.priority
      };
    })
    .filter(item => item.patient !== undefined) // Only show appointments with valid existing database patient records
    .sort((a, b) => {
      const scoreA = getPriorityOrder(a);
      const scoreB = getPriorityOrder(b);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  // Apply complete multi-factor filtering (Text Search + Doctor Filter + Shift Filter)
  const filteredScheduleItems = activeTokenItems.filter(item => {
    // 1. Text Search Filter
    const searchString = `${item.patient?.name || ''} ${item.doctor?.name || ''} ${item.tokenNumber || ''} ${item.department || ''}`.toLowerCase();
    const matchesSearch = searchString.includes(headerSearchTerm.toLowerCase());
    if (!matchesSearch) return false;

    // 2. Doctor Filter
    if (selectedDoctorFilter !== 'ALL' && item.doctor?.id !== selectedDoctorFilter) {
      return false;
    }

    // 3. Shift Filter
    if (shiftFilter !== 'ALL' && item.createdAt) {
      const date = new Date(item.createdAt);
      const hours = date.getHours();
      
      if (shiftFilter === 'MORNING') {
        // Morning Shift: 06:00 to 11:59
        if (hours < 6 || hours >= 12) return false;
      } else if (shiftFilter === 'AFTERNOON') {
        // Afternoon Shift: 12:00 to 16:59
        if (hours < 12 || hours >= 17) return false;
      } else if (shiftFilter === 'EVENING') {
        // Evening Shift: 17:00 to 23:59
        if (hours < 17 || hours >= 24) return false;
      }
    }

    return true;
  });

  // Dynamic user avatar list & timeline activity mapping
  const timelineActivities = [
    ...(activityLogs || []).map(log => ({
      time: new Date(log.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      title: log.action,
      details: log.details || '',
      type: log.action.includes('Emergency') ? 'emergency' : (log.action.includes('Patient') ? 'register' : 'info')
    })),
    { time: '10:45 AM', title: 'Patient Arthur Jenkins checked out from Cardiology.', details: 'Billing Completed', type: 'billing' },
    { time: '10:32 AM', title: 'Emergency Alert: Room 302 requesting immediate assistance.', details: 'Staff Dispatched', type: 'emergency' },
    { time: '10:15 AM', title: 'New Registration: Linda Myers (Patient ID #4552)', details: 'Assigned to Dr. Vance', type: 'register' },
    { time: '09:58 AM', title: 'Token #A-42 called for Counter 2.', details: 'Token Active', type: 'token' }
  ].slice(0, 4);

  const formattedDate = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });

  return (
    <div className="font-hanken bg-[#f8f9ff] text-on-background min-h-screen relative overflow-x-hidden p-0 m-0">
      
      {/* Dynamic AppLayout Sidebar/Header Bypass Injector */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');

        /* Hide standard AppLayout elements */
        .flex.h-screen > aside {
          display: none !important;
        }
        .flex.h-screen > main > header {
          display: none !important;
        }
        .flex.h-screen > main {
          background-color: #f8f9ff !important;
          margin-left: 0 !important;
          padding: 0 !important;
          overflow-y: auto !important;
          height: 100vh !important;
          scroll-behavior: smooth !important;
          -webkit-overflow-scrolling: touch;
        }
        .flex.h-screen > main > div {
          padding: 0 !important;
          overflow: visible !important;
          height: auto !important;
        }

        /* Fluid custom scrollbar for dashboard container */
        .flex.h-screen > main::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .flex.h-screen > main::-webkit-scrollbar-track {
          background: transparent;
        }
        .flex.h-screen > main::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 10px;
        }
        .flex.h-screen > main::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }

        :root {
          --hanken-font: 'Hanken Grotesk', sans-serif;
        }

        .font-hanken {
          font-family: var(--hanken-font);
        }

        /* Material Symbols overrides */
        .material-symbols-outlined {
          font-family: 'Material Symbols Outlined';
          font-weight: normal;
          font-style: normal;
          font-size: 24px;
          line-height: 1;
          letter-spacing: normal;
          text-transform: none;
          display: inline-block;
          white-space: nowrap;
          word-wrap: normal;
          direction: ltr;
          -webkit-font-smoothing: antialiased;
        }

        /* Color Scheme Mappings as requested */
        .bg-background { background-color: #f8f9ff !important; }
        .text-on-background { color: #0b1c30 !important; }
        .bg-surface-container-lowest { background-color: #ffffff !important; }
        .bg-surface-container-low { background-color: #eff4ff !important; }
        .bg-surface-container { background-color: #e5eeff !important; }
        .border-outline-variant { border-color: #c4c6d2 !important; }
        .text-on-surface-variant { color: #444651 !important; }
        .text-primary { color: #001a48 !important; }
        .bg-primary { background-color: #001a48 !important; }
        .text-on-primary { color: #ffffff !important; }
        .bg-primary-container { background-color: #002d72 !important; }
        .text-secondary { color: #006a61 !important; }
        .bg-secondary { background-color: #006a61 !important; }
        .text-on-surface { color: #0b1c30 !important; }
        .text-error { color: #ba1a1a !important; }
        .bg-error { background-color: #ba1a1a !important; }
        .border-l-error { border-left-color: #ba1a1a !important; }
        .border-l-primary-container { border-left-color: #002d72 !important; }
        .text-primary-container { color: #002d72 !important; }
        
        .dark\\:bg-surface { background-color: #f8f9ff !important; }
        .dark\\:text-inverse-primary { color: #b1c5ff !important; }
        .bg-secondary\\/10 { background-color: rgba(0, 106, 97, 0.1) !important; }
        .bg-primary-container\\/10 { background-color: rgba(0, 45, 114, 0.1) !important; }
        .bg-error\\/10 { background-color: rgba(186, 26, 26, 0.1) !important; }
        .bg-outline-variant\\/30 { background-color: rgba(196, 198, 210, 0.3) !important; }
        .bg-surface-dim { background-color: #cbdbf5 !important; }

        /* KPI and responsive constants */
        .w-sidebar-width { width: 260px; }
        .left-sidebar-width { left: 260px; }
        .px-container-padding { padding-left: 24px; padding-right: 24px; }
        .text-stats-number { font-size: 36px; line-height: 40px; font-weight: 700; }
        .text-headline-md { font-size: 24px; line-height: 32px; font-weight: 600; }
        .text-display-lg { font-size: 30px; line-height: 38px; letter-spacing: -0.02em; font-weight: 700; }
        .text-title-sm { font-size: 18px; line-height: 24px; font-weight: 600; }
        .text-label-caps { font-size: 11px; line-height: 16px; letter-spacing: 0.05em; font-weight: 700; text-transform: uppercase; }
        .text-body-md { font-size: 14px; line-height: 20px; }
        .text-body-sm { font-size: 13px; line-height: 18px; }
        .gap-card-gap { gap: 20px; }
      `}</style>

      {/* Sidebar Navigation */}
      <aside className="fixed left-0 top-0 bottom-0 flex flex-col justify-between py-6 w-sidebar-width h-screen border-r border-[#c4c6d2] bg-white z-50">
        <div>
          <div className="px-6 mb-10 flex items-center gap-3">
            <div className="bg-[#001a48] p-2 rounded-lg text-white">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>medical_services</span>
            </div>
            <div>
              <h1 className="text-headline-md font-bold text-[#001a48] leading-tight">MedFlow</h1>
              <p className="text-label-caps text-on-surface-variant opacity-70">CLINICAL PRECISION</p>
            </div>
          </div>
          <nav className="space-y-1">
            <button 
              onClick={() => navigate('/reception')}
              className="w-[244px] bg-[#001a48] text-white rounded-lg mx-2 flex items-center gap-3 px-4 py-3 transition-all duration-200 scale-95 active:scale-90"
            >
              <span className="material-symbols-outlined">dashboard</span>
              <span className="text-body-md font-semibold">Dashboard</span>
            </button>
            <button 
              onClick={() => navigate('/reception/register')}
              className="w-[244px] text-on-surface-variant hover:bg-surface-container-low mx-2 rounded-lg flex items-center gap-3 px-4 py-3 transition-all duration-200 text-left"
            >
              <span className="material-symbols-outlined">person_add</span>
              <span className="text-body-md font-semibold">Patient Registration</span>
            </button>
            <button 
              onClick={() => navigate('/reception/tokens')}
              className="w-[244px] text-on-surface-variant hover:bg-surface-container-low mx-2 rounded-lg flex items-center gap-3 px-4 py-3 transition-all duration-200 text-left"
            >
              <span className="material-symbols-outlined">confirmation_number</span>
              <span className="text-body-md font-semibold">Token Management</span>
            </button>
          </nav>
        </div>
        <div className="border-t border-[#c4c6d2] pt-6">
          <nav className="space-y-1">
            <button 
              onClick={() => { logout(); navigate('/login'); }}
              className="w-[244px] text-on-surface-variant hover:bg-surface-container-low mx-2 rounded-lg flex items-center gap-3 px-4 py-3 transition-all duration-200 text-error text-left"
            >
              <span className="material-symbols-outlined">logout</span>
              <span className="text-body-md font-semibold font-bold">Logout</span>
            </button>
          </nav>
        </div>
      </aside>

      {/* Top App Bar */}
      <header className="fixed top-0 right-0 left-sidebar-width z-40 h-16 flex items-center justify-between px-container-padding bg-[#eff4ff]/80 backdrop-blur-md border-b border-[#c4c6d2]">
        <div className="flex-1 max-w-xl">
          <div className="relative flex items-center">
            <div className="relative group w-full">
              <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10 text-[19px]">search</span>
              <input 
                value={headerSearchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full bg-[#f8f9ff] border border-[#c4c6d2] rounded-full pl-11 pr-10 py-2 focus:ring-4 focus:ring-[#002d72]/15 focus:border-[#002d72] transition-all duration-200 outline-none text-[13.5px] font-semibold text-slate-800 shadow-inner"
                placeholder="Quick Search (Name, ID, Phone, Diagnosis)..." 
                type="text" 
              />
              {headerSearchTerm && (
                <button onClick={() => handleSearchChange('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 flex items-center z-10">
                  <span className="material-symbols-outlined text-[19px]">close</span>
                </button>
              )}

              {/* Real DB Search Dropdown */}
              {headerSearchTerm.trim() !== '' && (
                <div className="search-dropdown absolute top-[44px] left-0 right-0 bg-white border border-[#c4c6d2] rounded-xl shadow-lg z-50 max-h-[350px] overflow-y-auto text-left">
                  {isSearching ? (
                    <div className="p-3.5 text-[13px] text-slate-500 flex items-center gap-2">
                      <span className="animate-pulse">Searching hospital records...</span>
                    </div>
                  ) : (!searchResults?.patients?.length && !searchResults?.tokens?.length && !searchResults?.consultations?.length) ? (
                    <div className="p-3.5 text-[13px] text-slate-500">
                      No matching patients, token numbers, or consultations found.
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {searchResults.patients && searchResults.patients.length > 0 && (
                        <div className="border-b border-slate-100">
                          <div className="bg-slate-50 px-3.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Matching Patients ({searchResults.patients.length})
                          </div>
                          {searchResults.patients.map((p: any) => (
                            <div 
                              key={p.id} 
                              onClick={async () => {
                                handleSelectSearchPatient(p.name);
                                await handleFetchHistory(p);
                              }} 
                              className="p-3 cursor-pointer hover:bg-[#f8f9ff] flex items-center justify-between"
                            >
                              <div>
                                <div className="text-[13.5px] font-bold text-slate-800 flex items-center gap-1.5">
                                  <span className="material-symbols-outlined text-slate-500 text-[18px]">person</span>
                                  {p.name}
                                </div>
                                <div className="text-[11.5px] text-slate-500 mt-0.5 ml-6">
                                  Patient ID: {p.id.substring(0, 8)} · Phone: {p.phone} · Sex: {p.gender}
                                </div>
                              </div>
                              <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition-all flex items-center gap-1">
                                <span>Lookup Profile</span>
                                <span className="material-symbols-outlined text-[13px] font-bold">arrow_forward</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {searchResults.tokens && searchResults.tokens.length > 0 && (
                        <div className="border-b border-slate-100">
                          <div className="bg-slate-50 px-3.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Live Queue Tokens ({searchResults.tokens.length})
                          </div>
                          {searchResults.tokens.map((t: any) => (
                            <div 
                              key={t.id} 
                              onClick={() => handleSelectSearchToken(t.tokenNumber)} 
                              className="p-3 cursor-pointer hover:bg-[#f8f9ff]"
                            >
                              <div className="text-[13.5px] font-bold text-slate-800 flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-slate-500 text-[18px]">confirmation_number</span>
                                Token Number: {t.tokenNumber} ({t.status})
                              </div>
                              <div className="text-[11.5px] text-slate-500 mt-0.5 ml-6">
                                Patient: {t.patient?.name} · Priority Level: {t.priority}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {searchResults.consultations && searchResults.consultations.length > 0 && (
                        <div>
                          <div className="bg-slate-50 px-3.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Recent Consultations ({searchResults.consultations.length})
                          </div>
                          {searchResults.consultations.map((c: any) => (
                            <div 
                              key={c.id} 
                              onClick={() => handleSelectSearchPatient(c.patient?.name)} 
                              className="p-3 cursor-pointer hover:bg-[#f8f9ff]"
                            >
                              <div className="text-[13.5px] font-bold text-slate-800 flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-slate-500 text-[18px]">clinical_notes</span>
                                {c.diagnosis || 'General Treatment'}
                              </div>
                              <div className="text-[11.5px] text-slate-500 mt-0.5 ml-6 truncate">
                                Notes: {c.notes}
                              </div>
                              <div className="text-[11px] text-primary font-semibold mt-0.5 ml-6">
                                Patient: {c.patient?.name}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-on-surface-variant">
            <button onClick={() => toast.info('No new system notifications.')} className="hover:text-primary transition-colors opacity-80 hover:opacity-100 flex items-center">
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <button onClick={() => toast.info('Language selection is fixed to English (US).')} className="hover:text-primary transition-colors opacity-80 hover:opacity-100 flex items-center">
              <span className="material-symbols-outlined">language</span>
            </button>
          </div>
          <div className="h-8 w-px bg-[#c4c6d2]"></div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-body-sm font-bold text-on-surface leading-tight">{currentUser?.name || 'Alan Reji'}</p>
              <p className="text-label-caps text-on-surface-variant opacity-70">RECEPTION HUB</p>
            </div>
            <img 
              alt="User profile" 
              className="w-10 h-10 rounded-lg object-cover border border-[#c4c6d2]" 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuAvHNWhp62gToHcI19vfsiWO25xvNnfcMYmdTSqL4Rek9DWgu-76N9tgKKE9UbdcJ-KVPvV6DPjDvKfI6qHictczuXmYmnO05ZtR-BiE3X_lWMj1sv1M53kn9U7Bu1MvqlePqgo509rNZccZaXcnD6rWOe5su8TXm3ZIxMhugGKUrXDJUXwBeJ1SFu_nk1pPmrwQRiV2ND3CdWZITbvVh3-FzyTZNuL9mhdlUsA3-37RizJkZ2RxnMV9nW5KzZWJUwVtegJg-nPksQ" 
            />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="ml-[260px] pt-24 px-container-padding pb-10">
        
        {/* Welcome Header */}
        <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="text-display-lg text-on-surface font-bold tracking-tight">Vitalis Healthcare</h2>
            <p className="text-body-md text-on-surface-variant flex items-center gap-2 mt-1">
              Reception Hub <span className="w-1 h-1 rounded-full bg-[#747782]"></span> {formattedDate}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleManualRefresh}
              className="bg-white text-slate-700 border border-[#c4c6d2] px-4 py-3 rounded-xl flex items-center gap-2 font-semibold hover:bg-slate-50 transition-all shadow-sm active:scale-95 cursor-pointer"
              title="Refresh database"
            >
              <span className="material-symbols-outlined text-[20px]">refresh</span>
              Refresh
            </button>
            <button 
              onClick={() => handleOpenNewAppointment()}
              className="bg-[#002d72] text-white px-6 py-3 rounded-xl flex items-center gap-2 font-semibold hover:opacity-90 transition-all shadow-sm active:scale-95 whitespace-nowrap"
            >
              <span className="material-symbols-outlined">add</span>
              New Appointment
            </button>
          </div>
        </div>

        {/* Summary Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-card-gap mb-8">
          {/* Total Appointments */}
          <div className="bg-white border border-[#c4c6d2] p-5 rounded-xl shadow-xs">
            <div className="flex justify-between items-start mb-4">
              <p className="text-label-caps text-on-surface-variant">Total Appointments</p>
              <span className="material-symbols-outlined text-primary opacity-60">calendar_today</span>
            </div>
            <div className="flex items-end gap-3">
              <span className="text-stats-number text-on-surface font-bold">{displayScheduledItemsCount(totalTokens, 124)}</span>
              <span className="text-body-sm font-bold text-secondary mb-2 flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[16px]">trending_up</span> 12%
              </span>
            </div>
          </div>

          {/* Checked-in */}
          <div className="bg-white border border-[#c4c6d2] p-5 rounded-xl shadow-xs">
            <div className="flex justify-between items-start mb-4">
              <p className="text-label-caps text-on-surface-variant">Checked-in</p>
              <span className="material-symbols-outlined text-secondary opacity-60">check_circle</span>
            </div>
            <div className="flex items-end gap-2">
              <span className="text-stats-number text-on-surface font-bold">{displayScheduledItemsCount(checkedInTokens, 86)}</span>
              <span className="text-body-sm text-on-surface-variant mb-2">/ {displayScheduledItemsCount(totalTokens, 124)} total</span>
            </div>
          </div>

          {/* Active Tokens */}
          <div className="bg-white border border-[#c4c6d2] p-5 rounded-xl shadow-xs">
            <div className="flex justify-between items-start mb-4">
              <p className="text-label-caps text-on-surface-variant">Active Tokens</p>
              <span className="material-symbols-outlined text-primary-container opacity-60">confirmation_number</span>
            </div>
            <div className="flex items-end gap-2">
              <span className="text-stats-number text-on-surface font-bold">{displayScheduledItemsCount(activeTokensCount, 14)}</span>
              <span className="text-body-sm text-on-surface-variant mb-2">Waiting</span>
            </div>
          </div>

          {/* Emergency Alerts */}
          <div 
            onClick={() => setIsHighRiskViewOpen(true)}
            className="bg-white border border-[#c4c6d2] p-5 rounded-xl border-l-4 border-l-error shadow-xs cursor-pointer hover:bg-red-50/20 active:scale-[0.99] transition-all hover:shadow-md"
          >
            <div className="flex justify-between items-start mb-4">
              <p className="text-label-caps text-on-surface-variant">Emergency Alerts</p>
              <span className="material-symbols-outlined text-error" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
            </div>
            <div className="flex items-end gap-2">
              <span className="text-stats-number text-error font-bold">{displayScheduledItemsCount(emergencyAlertsCount, 0)}</span>
              <span className="text-body-sm text-error font-bold mb-2">Critical</span>
            </div>
          </div>
        </div>

        {/* Schedule Grid */}
        <div className="flex flex-col lg:flex-row gap-card-gap">
          
          {/* Today's Schedule Table Container */}
          <div className="flex-1 bg-white border border-[#c4c6d2] rounded-xl overflow-hidden shadow-sm">
            <div className="p-6 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center border-b border-[#c4c6d2] bg-[#eff4ff]/30">
              <h3 className="text-title-sm text-on-surface font-bold">Today's Schedule</h3>
              <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
                <div className="flex items-center gap-2">
                  <span className="text-body-sm font-bold text-slate-500 whitespace-nowrap">Doctor:</span>
                  <select
                    value={selectedDoctorFilter}
                    onChange={(e) => setSelectedDoctorFilter(e.target.value)}
                    className="bg-white border border-[#c4c6d2] rounded-lg px-3 py-1.5 text-body-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#002d72]"
                  >
                    <option value="ALL">All Doctors</option>
                    {doctors.map(doc => {
                      const isDocOnDuty = doc.dutyStatus === 'ON DUTY' || doc.dutyStatus === 'ON_DUTY';
                      const statusDot = isDocOnDuty ? '🟢' : '⚫';
                      return (
                        <option key={doc.id} value={doc.id}>
                          {statusDot} {doc.name}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-body-sm font-bold text-slate-500 whitespace-nowrap">Shift:</span>
                  <select
                    value={shiftFilter}
                    onChange={(e) => setShiftFilter(e.target.value as any)}
                    className="bg-white border border-[#c4c6d2] rounded-lg px-3 py-1.5 text-body-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-[#002d72]"
                  >
                    <option value="ALL">All Shifts</option>
                    <option value="MORNING">Morning (6 AM - 12 PM)</option>
                    <option value="AFTERNOON">Afternoon (12 PM - 5 PM)</option>
                    <option value="EVENING">Evening (5 PM - Midnight)</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[440px] overflow-y-auto scroll-smooth">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#eff4ff]/20 text-label-caps text-on-surface-variant uppercase tracking-wider border-b border-[#c4c6d2]">
                    <th className="px-6 py-4 font-bold">Time</th>
                    <th className="px-6 py-4 font-bold">Patient Name</th>
                    <th className="px-6 py-4 font-bold">Doctor</th>
                    <th className="px-6 py-4 font-bold">Department</th>
                    <th className="px-6 py-4 font-bold">Status</th>
                    <th className="px-6 py-4 font-bold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#c4c6d2]">
                  {filteredScheduleItems.length > 0 ? (
                    filteredScheduleItems.map((item) => {
                      const initials = item.patient?.name ? item.patient.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() : 'PT';
                      const isEmergency = item.priority?.toUpperCase() === 'EMERGENCY';
                      const isUrgent = item.priority?.toUpperCase() === 'URGENT';
                      
                      let rowHighlightClass = '';
                      if (item.status !== 'CANCELLED' && item.status !== 'COMPLETED') {
                        if (isEmergency) {
                          rowHighlightClass = 'bg-red-50/70 hover:bg-red-100/70 border-l-4 border-l-red-500';
                        } else if (isUrgent) {
                          rowHighlightClass = 'bg-amber-50/60 hover:bg-amber-100/60 border-l-4 border-l-amber-500';
                        } else {
                          rowHighlightClass = 'hover:bg-[#eff4ff]/10 border-l-2 border-l-transparent hover:border-l-[#002d72]';
                        }
                      } else {
                        rowHighlightClass = 'hover:bg-[#eff4ff]/10 border-l-2 border-l-transparent';
                        if (item.status === 'COMPLETED') {
                          rowHighlightClass += ' opacity-80';
                        }
                      }

                      return (
                        <tr 
                          key={item.id} 
                          className={`transition-colors transition-all ${rowHighlightClass}`}
                        >
                          <td className="px-6 py-5 font-bold text-on-surface text-body-md whitespace-nowrap">{item.time}</td>
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-[11px] ${
                                isEmergency ? 'bg-red-100 text-red-700' :
                                isUrgent ? 'bg-amber-100 text-amber-700' :
                                'bg-[#e5eeff] text-primary'
                              }`}>
                                {initials}
                              </div>
                              <span className="text-body-md font-bold text-on-surface flex items-center gap-2 flex-wrap">
                                {item.patient?.name}
                                {isEmergency && (
                                  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-red-100 text-red-700 border border-red-200 animate-pulse">
                                    EMERGENCY
                                  </span>
                                )}
                                {isUrgent && (
                                  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-100 text-amber-805 border border-amber-200 text-amber-800">
                                    URGENT
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-5 text-body-md text-on-surface-variant font-medium">
                            {(() => {
                              if (!item.doctor) return 'Staff Physician';
                              const liveDoc = users.find(u => u.id === item.doctor?.id);
                              const isDocOnDuty = liveDoc ? (liveDoc.dutyStatus === 'ON DUTY' || liveDoc.dutyStatus === 'ON_DUTY') : false;
                              const statusDot = isDocOnDuty ? '🟢' : '⚫';
                              return (
                                <span className="flex items-center gap-1.5">
                                  <span>{statusDot}</span>
                                  <span>{item.doctor.name}</span>
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-6 py-5 text-body-md text-on-surface-variant font-medium">{item.department}</td>
                          <td className="px-6 py-5">
                            {renderStatusBadge(item.status)}
                          </td>
                          <td className="px-6 py-5">
                            {item.patient?.id && !item.id.includes('mock') ? (
                              <button 
                                onClick={() => handleFetchHistory(item.patient)}
                                className="text-[#002d72] font-bold text-body-sm hover:underline cursor-pointer"
                              >
                                Details
                              </button>
                            ) : (
                              <button 
                                onClick={() => toast.success(`Viewing records for mock patient ${item.patient?.name}`)}
                                className="text-[#002d72] font-bold text-body-sm hover:underline cursor-pointer"
                              >
                                Details
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
                        No appointments found matching your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
             <div className="p-4 bg-[#eff4ff]/20 border-t border-[#c4c6d2] text-center">
              <button 
                onClick={() => {
                  setShiftFilter('ALL');
                  setSelectedDoctorFilter('ALL');
                  setHeaderSearchTerm('');
                  toast.success('Successfully cleared all active filters.');
                }}
                className="text-primary font-bold text-body-md flex items-center justify-center gap-2 w-full hover:opacity-80 transition-all cursor-pointer"
              >
                Clear all active filters & Show all appointments
                <span className="material-symbols-outlined text-[20px]">refresh</span>
              </button>
            </div>
          </div>

          {/* Activity Timeline Sidebar */}
          <div className="w-full lg:w-[320px] space-y-card-gap">
            <div className="bg-white border border-[#c4c6d2] rounded-xl p-6 shadow-sm">
              <h3 className="text-title-sm text-on-surface mb-6 font-bold">Recent Activity</h3>
              <div className="relative pl-8 space-y-8 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-[#c4c6d2]">
                
                {timelineActivities.map((act, index) => (
                  <div key={index} className="relative">
                    <div className={`absolute -left-8 top-0 w-6 h-6 rounded-full flex items-center justify-center text-white z-10 ${
                      act.type === 'emergency' ? 'bg-[#ba1a1a]' : 
                      act.type === 'register' ? 'bg-[#002d72]' : 
                      act.type === 'billing' ? 'bg-[#006a61]' : 'bg-[#cbdbf5] text-primary-container'
                    }`}>
                      <span className="material-symbols-outlined text-[14px]">
                        {act.type === 'emergency' ? 'emergency' : 
                         act.type === 'register' ? 'person_add' : 
                         act.type === 'billing' ? 'check' : 'confirmation_number'}
                      </span>
                    </div>
                    <div>
                      <p className="text-label-caps text-on-surface-variant opacity-70">{act.time}</p>
                      <p className="text-body-md font-bold text-on-surface mt-1 leading-tight">{act.title}</p>
                      <p className={`text-[11px] font-bold mt-1 uppercase ${
                        act.type === 'emergency' ? 'text-error' :
                        act.type === 'billing' ? 'text-secondary' : 'text-on-surface-variant'
                      }`}>{act.details}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* On-Duty Doctors list precisely matched */}
              <div className="mt-10 pt-6 border-t border-[#c4c6d2]">
                <p className="text-label-caps text-on-surface-variant mb-4 uppercase tracking-wider">On-Duty Doctors</p>
                <div className="flex items-center -space-x-2">
                  <img 
                    alt="Doctor 1" 
                    className="w-10 h-10 rounded-full border-2 border-white object-cover" 
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuA4ioymrQmb15veesnhHIOqsGDiKGrrQsgPi_FsrMWvVTazNmCWmdIYabJgMHDuA9yrqB66grQozkcXLXeK-i88qnKaGgawK9SiY6Vt0-vDl-7a7DkuIug2AWA4VL5gpra2xbYEPoOjTI1PlQGJ4LRLt1WsCa48Zu0wBwybYcwivQroHYHg8AaAfkvaL9jiQfgtjnC7MkWDP92Ha_ta_GY8Kyl2OpkErlzNg7VR4ghNHFHRBlFzGIlSXIsCSZPgKbd79EOJYKomgfc" 
                  />
                  <img 
                    alt="Doctor 2" 
                    className="w-10 h-10 rounded-full border-2 border-white object-cover" 
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuAKT5GvEDoOkh3Kq9xCLMbX67bxyieba1E8NmNkKFbo-WW18vLU6jQ1W1Ne2AhsKoy7hOR8_Ew6fmu04qgy4yB0PWFz8o77mlvd_pwBlZkE0l1t0m8FLYbidO5SfKcXuNMxGDJ_0yTs3-gSnsaB4REDzpgrYG5Mmc0zg4Cb7WxV64VvXVQHyDxx5ZJG_iKAt45FN84nWIYMy-nR-V-WI6gXp11EaguCs9RpWC0-CYIe43IPwKxmdgRzv0CZsikbxr-Vm5solzp1nXw" 
                  />
                  <img 
                    alt="Doctor 3" 
                    className="w-10 h-10 rounded-full border-2 border-white object-cover" 
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuChC6jd46mv4i_GBnjSNvkBWoZ80_6tR5AHZICihXvAFHYmVdTdZVqcphEpz9JKCDooGKlxtqV9HezYXbBzV-6Vra5-MFL7InvUizfJSQgAxejzyIXC7j3f91LDYvAMHmTdnBeF1VtSUKB6rbuKumMMO_D3P_uYek5zLGctT7jMufEy5tY9RX2BBfYamXHayl5qyDX10gL_3bWtLOvDPcgA1avVrmbMDJZYWa9kMfn9cO9hAJonZdoQgwMlnkbWEDDI_9Y13gTp9YY" 
                  />
                  <div className="w-10 h-10 rounded-full border-2 border-white bg-[#e5eeff] text-on-surface-variant text-[11px] font-bold flex items-center justify-center shadow-xs">
                    +{Math.max(0, doctors.length - 3) + 2}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Appointment & Token Generator Modal Sheet */}
      <GenerateTokenModal 
        isOpen={isNewAppointmentOpen} 
        onClose={() => setIsNewAppointmentOpen(false)} 
      />

      {/* Patient Medical History Record Modal */}
      <MedicalHistoryModal 
        isOpen={isHistoryModalOpen}
        onClose={() => {
          setIsHistoryModalOpen(false);
          setSelectedLookupPatient(null);
        }}
        patientName={historyPatientName}
        history={patientHistory}
        patient={selectedLookupPatient}
      />

      {/* MODAL: Clinical High Risk & Emergency Alerts View */}
      {isHighRiskViewOpen && (
        <div 
          onClick={() => setIsHighRiskViewOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl border border-red-200 animate-in fade-in zoom-in-95 duration-200"
          >
            {/* Modal Header */}
            <div className="bg-[#5a0c1a] border-b border-red-800 p-6 text-white flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-red-505 font-bold animate-pulse text-red-400" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                  <span>Clinical Risk & Emergency Registry</span>
                </h3>
                <p className="text-xs text-red-200/90 mt-1 font-semibold">
                  Real-time list of registered patients holding active critical vitals or risk indicators.
                </p>
              </div>
              <button 
                onClick={() => setIsHighRiskViewOpen(false)}
                className="text-red-200 hover:text-white hover:bg-white/10 p-2 rounded-lg transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto max-h-[70vh] space-y-4">
              {(() => {
                const highRiskItems = highRiskPatientsList;
                
                if (highRiskItems.length === 0) {
                  return (
                    <div className="text-center py-12 space-y-3">
                      <span className="material-symbols-outlined text-4xl text-slate-300">verified_user</span>
                      <p className="text-sm font-bold text-slate-500">No clinically high-risk patients registered in the database.</p>
                      <p className="text-xs text-slate-400 font-medium">All active triage records report normal physiologic metrics.</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-500 font-bold flex items-center gap-1.5 bg-red-50 text-red-900 px-3 py-2 rounded-lg border border-red-100">
                      <span>⚠️</span>
                      <span>Verified clinical findings require careful monitoring. Showing {highRiskItems.length} registered patient profiles.</span>
                    </p>

                    <div className="overflow-x-auto border border-slate-200 rounded-xl">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 text-slate-600 text-[10px] font-bold uppercase tracking-wider border-b border-slate-200">
                            <th className="px-4 py-3">Patient Name / ID</th>
                            <th className="px-4 py-3">Contact Details</th>
                            <th className="px-4 py-3">Clinical Risk Reason</th>
                            <th className="px-4 py-3">Physician / Dept</th>
                            <th className="px-4 py-3">Active Ticket Details</th>
                            <th className="px-4 py-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {highRiskItems.map(p => {
                            // Find any active queue status/token for today
                            const patToken = tokens.find(t => 
                              t.patientId === p.id && 
                              t.createdAt && 
                              isToday(t.createdAt) && 
                              ['WAITING', 'CALLED', 'IN_CONSULTATION', 'CHECKED_IN'].includes(t.status)
                            );
                            const assignedDoc = patToken ? users.find(u => u.id === patToken.doctorId) : null;
                            
                            const initials = p.name ? p.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() : 'PT';
                            const riskReason = getPatientRiskReason(p);
                            const ticketNum = patToken ? patToken.tokenNumber : 'N/A';
                            const ticketTime = patToken?.createdAt ? new Date(patToken.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
                            const ticketStatusStr = patToken ? patToken.status.replace(/_/g, ' ') : 'N/A';

                            return (
                              <tr key={p.id} className="hover:bg-red-50/10 text-xs font-medium text-slate-700">
                                {/* Name and ID */}
                                <td className="px-4 py-4.5">
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 rounded-full bg-red-100 text-red-700 flex items-center justify-center font-bold text-[10px]">
                                      {initials}
                                    </div>
                                    <div>
                                      <p className="font-bold text-slate-900 text-[13px]">{p.name}</p>
                                      <p className="font-semibold text-[11px] text-slate-500">PID-{p.id.slice(0, 8).toUpperCase()}</p>
                                    </div>
                                  </div>
                                </td>
                                {/* Contact Info */}
                                <td className="px-4 py-4.5 space-y-1">
                                  <div className="flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[14px] text-slate-400">phone</span>
                                    <span className="font-bold text-slate-900">{p.phone || 'No phone'}</span>
                                  </div>
                                  {p.emergencyContactName && (
                                    <p className="text-[10px] text-slate-500 font-semibold pl-4.5">
                                      {p.emergencyContactName}: {p.emergencyContactPhone || 'N/A'}
                                    </p>
                                  )}
                                </td>
                                {/* Clinical Risk Reason */}
                                <td className="px-4 py-4.5">
                                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold">
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping"></span>
                                    <span>{riskReason}</span>
                                  </span>
                                </td>
                                {/* Doctor and Dept */}
                                <td className="px-4 py-4.5">
                                  {assignedDoc ? (
                                    (() => {
                                      const isDocOnDuty = assignedDoc.dutyStatus === 'ON DUTY' || assignedDoc.dutyStatus === 'ON_DUTY';
                                      const statusDot = isDocOnDuty ? '🟢' : '⚫';
                                      return (
                                        <>
                                          <p className="font-bold text-slate-800 flex items-center gap-1.5">
                                            <span>{statusDot}</span>
                                            <span>Dr. {assignedDoc.name}</span>
                                          </p>
                                          <p className="text-[10px] text-slate-500 font-bold uppercase pl-5">{assignedDoc.department || 'General Medicine'}</p>
                                        </>
                                      );
                                    })()
                                  ) : (
                                    <span className="text-slate-400 italic">No physician assigned</span>
                                  )}
                                </td>
                                {/* Session details */}
                                <td className="px-4 py-4.5 space-y-0.5">
                                  <div className="flex items-center gap-1">
                                    <span className="text-slate-400">Token:</span>
                                    <span className="font-bold text-[#001a48]">{ticketNum}</span>
                                  </div>
                                  <div className="flex items-center gap-1 text-[11px]">
                                    <span className="text-slate-400">Time:</span>
                                    <span className="font-semibold">{ticketTime}</span>
                                  </div>
                                </td>
                                {/* Status */}
                                <td className="px-4 py-4.5">
                                  {patToken ? (
                                    <span className="inline-block px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-full font-bold uppercase text-[10px] tracking-wider whitespace-nowrap">
                                      {ticketStatusStr}
                                    </span>
                                  ) : (
                                    <span className="inline-block px-2.5 py-0.5 bg-slate-100 text-slate-500 rounded-full font-bold text-[10px] whitespace-nowrap">
                                      No Active Visit
                                    </span>
                                  )}
                                </td>
                                {/* Action row */}
                                <td className="px-4 py-4.5 text-right">
                                  <button
                                    onClick={() => {
                                      setIsHighRiskViewOpen(false);
                                      handleFetchHistory(p);
                                    }}
                                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 font-bold rounded text-[11px] transition-colors cursor-pointer"
                                  >
                                    History...
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setIsHighRiskViewOpen(false)}
                className="px-5 py-2 border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 transition-colors text-xs cursor-pointer active:scale-95"
              >
                Close Alerts
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Status badge matching custom style requirements
  function renderStatusBadge(status: string) {
    if (status === 'IN_CONSULTATION' || status === 'IN_PROGRESS') {
      return (
        <span className="bg-secondary/10 text-secondary border border-secondary/20 px-3 py-1 rounded-full text-[11px] font-bold uppercase whitespace-nowrap">
          In Consultation
        </span>
      );
    }
    if (status === 'WAITING' || status === 'SCHEDULED') {
      return (
        <span className="bg-outline-variant/30 text-on-surface-variant px-3 py-1 rounded-full text-[11px] font-bold uppercase whitespace-nowrap">
          Checked In
        </span>
      );
    }
    if (status === 'COMPLETED' || status === 'SENT_TO_PHARMACY' || status === 'DISPENSED' || status === 'CONSULTATION_COMPLETED_NO_PRESCRIPTION') {
      return (
        <span className="bg-emerald-50 text-emerald-600 border border-emerald-100 px-3 py-1 rounded-full text-[11px] font-bold uppercase whitespace-nowrap">
          Confirmed
        </span>
      );
    }
    return (
      <span className="bg-error/10 text-error px-3 py-1 rounded-full text-[11px] font-bold uppercase whitespace-nowrap">
        Delayed
      </span>
    );
  }

  // Display value safe guard wrapper
  function displayScheduledItemsCount(actual: number, fallback: number) {
    return actual < 10 ? '0' + actual : String(actual);
  }

  // Clinical Risk Reason detail mapper dynamically matching measurements
  function getPatientRiskReason(patient: any): string {
    if (!patient) return 'Standard';
    const reasons: string[] = [];
    
    const hist = (patient.medicalHistory || '').toLowerCase();
    
    // Extract priority level
    const match = hist.match(/priority:\s*([a-z\-]+)/i);
    if (match) {
      const pVal = match[1].trim().toUpperCase();
      reasons.push(`${pVal} PRIORITY`);
    }

    const criticalWords = ['critical', 'severe', 'urgent', 'emergency'];
    const matchedWords = criticalWords.filter(w => hist.includes(w) && !reasons.some(r => r.includes(w.toUpperCase())));
    if (matchedWords.length > 0) {
      reasons.push(`${matchedWords.map(w => w.toUpperCase()).join(', ')} CLINICAL OUTCOME`);
    }

    if (patient.bloodPressure) {
      const parts = patient.bloodPressure.split('/');
      if (parts.length === 2) {
        const systolic = parseInt(parts[0], 10);
        const diastolic = parseInt(parts[1], 10);
        if (!isNaN(systolic) && (systolic >= 140 || diastolic >= 90)) {
          reasons.push(`Vitals BP: ${patient.bloodPressure}`);
        }
      }
    }

    if (patient.temperature) {
      const temp = parseFloat(patient.temperature);
      if (!isNaN(temp)) {
        if (temp >= 101.3) {
          reasons.push(`Temp: ${patient.temperature}°F`);
        } else if (temp >= 38.5 && temp < 45) {
          reasons.push(`Temp: ${patient.temperature}°C`);
        }
      }
    }

    return reasons.join(' | ') || 'Flagged Risk Warning';
  }
}
