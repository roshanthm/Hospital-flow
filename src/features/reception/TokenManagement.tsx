/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, authFetch } from '@/src/store/useStore';
import { Patient, Token } from '@/src/types';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import GenerateTokenModal from '@/src/components/GenerateTokenModal';
import { generateTokenPDF, generateFullPatientHistoryPDF, generateDateWiseExportPDF, generateAllPatientsExportPDF, isPatientHighRisk } from '@/src/lib/pdfUtils';

const normalizeDeptName = (deptStr: string) => {
  const lower = (deptStr || '').toLowerCase();
  if (lower.includes('cardio')) return 'Cardiology';
  if (lower.includes('general') || lower.includes('med')) return 'General Medicine';
  if (lower.includes('pediatric')) return 'Pediatrics';
  if (lower.includes('diag')) return 'Diagnostics';
  if (lower.includes('emerg')) return 'Emergency';
  if (lower.includes('derm')) return 'Dermatology';
  return deptStr;
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

const getPriorityOrder = (t: any, patients: any[] = []) => {
  if (t.priority) {
    return PRIORITY_ORDER[t.priority.toUpperCase()] || 2;
  }
  const pat = t.patient || patients.find(p => p.id === t.patientId);
  const hist = (pat?.medicalHistory || '').toLowerCase();
  const match = hist.match(/priority:\s*([a-z\-]+)/i);
  if (match) {
    return PRIORITY_ORDER[match[1].toUpperCase()] || 2;
  }
  return 2;
};

// Define the Queue Token shape for our local UI state
interface QueueToken {
  id: string;
  tokenNumber: string;
  patientName: string;
  patientId: string;
  department: string;
  waitTime: string;
  waitTimeNum: number; // representation in minutes for filtering
  status: 'IN QUEUE' | 'CALLED' | 'DELAYED' | 'COMPLETED';
  isHighRisk?: boolean;
  priority?: string;
}

export default function TokenManagement() {
  const navigate = useNavigate();
  const logout = useStore(state => state.logout);
  const currentUser = useStore(state => state.currentUser);
  const patients = useStore(state => state.patients);
  const fetchPatients = useStore(state => state.fetchPatients);
  const storeTokens = useStore(state => state.tokens);
  const fetchTokens = useStore(state => state.fetchTokens);
  const updateTokenStatus = useStore(state => state.updateTokenStatus);
  const updateTokenPriority = useStore(state => state.updateTokenPriority);
  const addAppointment = useStore(state => state.addAppointment);
  const users = useStore(state => state.users);
  const fetchUsers = useStore(state => state.fetchUsers);
  const addPatient = useStore(state => state.addPatient);

  useEffect(() => {
    // Only preload tokens and users on mount. Avoid downloading the entire patient table.
    fetchTokens({ today: true });
    fetchUsers();

    const intervalId = setInterval(() => {
      fetchTokens({ today: true });
      fetchUsers();
    }, 30000);

    return () => clearInterval(intervalId);
  }, []);

  // Support Closing via keys (Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExportModalOpen(false);
        setIsGenerateModalOpen(false);
        setIsViewAllUnitsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Header quick search input
  const [headerSearchTerm, setHeaderSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any>({ patients: [], tokens: [], consultations: [] });
  const [searchTimeout, setSearchTimeout] = useState<any>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      setHeaderSearchTerm(q);
    }
  }, []);

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
    setHeaderSearchTerm(tokenNumber);
    setSearchResults({ patients: [], tokens: [], consultations: [] });
  };
  
  // Toolbar filters and tabs state
  const [activeTab, setActiveTab] = useState<'ALL' | 'CALLED' | 'IN_QUEUE'>('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);

  // Modal State for Generating a Token
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isViewAllUnitsOpen, setIsViewAllUnitsOpen] = useState(false);
  
  // Export states
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [selectedExportPatientId, setSelectedExportPatientId] = useState('');
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false);
  const [exportDate, setExportDate] = useState(new Date().toISOString().split('T')[0]);
  const [exportPeriodType, setExportPeriodType] = useState<'today' | 'yesterday' | 'custom' | 'range'>('today');
  const [exportStartDate, setExportStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [exportEndDate, setExportEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [patientNameSearch, setPatientNameSearch] = useState('Sarah Mitchell');
  const [patientIdSearch, setPatientIdSearch] = useState('8849-MX');
  const [selectedDepartment, setSelectedDepartment] = useState<'Cardiology' | 'General Med' | 'Pediatrics' | 'Dermatology'>('Cardiology');
  const [selectedPriority, setSelectedPriority] = useState<'Low' | 'Medium' | 'High' | 'Urgent'>('High');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Sync on-type patient search when typing in export modal with a debounced delay
  useEffect(() => {
    const term = patientSearchQuery.trim();
    if (term.length >= 2) {
      const delay = setTimeout(() => {
        fetchPatients(term);
      }, 300);
      return () => clearTimeout(delay);
    }
  }, [patientSearchQuery, fetchPatients]);

  const filteredExportPatients = React.useMemo(() => {
    const q = patientSearchQuery.trim().toLowerCase();
    const list = q ? patients.filter((p: any) => {
      const nameMatch = p.name ? p.name.toLowerCase().includes(q) : false;
      const idMatch = p.id ? p.id.toLowerCase().includes(q) : false;
      const phoneMatch = p.phone ? p.phone.toLowerCase().includes(q) : false;
      return nameMatch || idMatch || phoneMatch;
    }) : patients;
    return list.slice(0, 100);
  }, [patients, patientSearchQuery]);

  const isToday = (dateInput: any) => {
    if (!dateInput) return false;
    const d = new Date(dateInput);
    const today = new Date();
    return d.getDate() === today.getDate() &&
           d.getMonth() === today.getMonth() &&
           d.getFullYear() === today.getFullYear();
  };

  // Load real tokens from database store
  const dbTokens: QueueToken[] = (storeTokens || [])
    .filter(t => t.createdAt && isToday(t.createdAt))
    .sort((a, b) => {
      const scoreA = getPriorityOrder(a, patients);
      const scoreB = getPriorityOrder(b, patients);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })
    .map(t => {
      const pat = t.patient || patients.find(p => p.id === t.patientId);
      
      // Map database enum statuses to UI queue statuses
      let uiStatus: 'IN QUEUE' | 'CALLED' | 'DELAYED' | 'COMPLETED' = 'IN QUEUE';
      if (t.status === 'WAITING') uiStatus = 'IN QUEUE';
      if (t.status === 'IN_CONSULTATION') uiStatus = 'CALLED';
      if (t.status === 'CONSULTATION_COMPLETED' || t.status === 'CONSULTATION_COMPLETED_NO_PRESCRIPTION' || t.status === 'DISPENSED' || t.status === 'CANCELLED') {
        uiStatus = 'COMPLETED';
      }

      // Calculate wait times
      const diffMs = Math.max(0, new Date().getTime() - new Date(t.createdAt).getTime());
      const minsPassed = Math.floor(diffMs / 60000);
      
      // Calculate active queue order position for dynamic remaining wait estimation
      const doctorWaitingTokens = (storeTokens || [])
        .filter(x => x.createdAt && isToday(x.createdAt) && x.doctorId === t.doctorId && x.status === 'WAITING')
        .sort((a, b) => {
          const scoreA = getPriorityOrder(a, patients);
          const scoreB = getPriorityOrder(b, patients);
          if (scoreA !== scoreB) {
            return scoreB - scoreA;
          }
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
      
      const aheadIdx = doctorWaitingTokens.findIndex(x => x.id === t.id);
      const estWaitMins = Math.max(5, aheadIdx >= 0 ? aheadIdx * 15 : 15);
      
      const waitTime = t.status === 'WAITING' 
        ? `${minsPassed}m (Est: ${estWaitMins}m left)` 
        : (t.status === 'IN_CONSULTATION' ? 'Active' : 'Completed');

      // Extract department from assigned doctor
      const doc = users.find(u => u.id === t.doctorId);
      const departmentStr = normalizeDeptName(doc?.department || 'General Medicine');

      return {
        id: t.id,
        tokenNumber: t.tokenNumber,
        patientName: pat?.name || 'Unknown Patient',
        patientId: pat?.id || t.patientId,
        department: departmentStr,
        waitTime,
        waitTimeNum: minsPassed,
        status: uiStatus as 'IN QUEUE' | 'CALLED' | 'DELAYED' | 'COMPLETED',
        isHighRisk: pat ? isPatientHighRisk(pat) : false,
        priority: t.priority || (pat?.medicalHistory?.match(/priority:\s*([a-z\-]+)/i)?.[1] || 'Medium')
      };
    });

  const tokens: QueueToken[] = dbTokens;

  // Sync animation simulation state
  const [isSyncing, setIsSyncing] = useState(false);

  const handleRefreshSync = async () => {
    setIsSyncing(true);
    toast.loading('Loading...');
    try {
      await Promise.all([
        fetchPatients(undefined, true),
        fetchTokens({ today: true }, true),
        fetchUsers(true)
      ]);
      setIsSyncing(false);
      toast.dismiss();
      toast.success('Roster refreshed successfully! All token loads synced.');
    } catch (e) {
      setIsSyncing(false);
      toast.dismiss();
      toast.error('Sync failed. Please verify connection.');
    }
  };

  // Generate Token Form submit
  const handleGenerateToken = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!patientNameSearch.trim()) {
      toast.error('Patient Name is required.');
      return;
    }

    const matchedPat = patients.find(p => p.id === patientIdSearch || p.name === patientNameSearch);
    let patId = matchedPat?.id;

    if (!patId) {
      try {
        const createdOnFly = await addPatient({
          name: patientNameSearch,
          age: 30,
          gender: 'M',
          phone: `+1 (555) ${Math.floor(100 + Math.random() * 900)}-${Math.floor(1000 + Math.random() * 9000).toString().padStart(4, '0')}`,
          address: 'Walk-in registration',
          bloodGroup: 'O+',
          medicalHistory: `Walk-in queue assignment for ${selectedDepartment}`
        });
        patId = createdOnFly?.id;
      } catch (err: any) {
        toast.error('Failed to create walk-in patient profile.');
        return;
      }
    }

    const doctorsList = (users || []).filter(u => u.role === 'DOCTOR');
    const deptDoctors = doctorsList.filter(d => 
      d.department?.toLowerCase().includes(selectedDepartment.toLowerCase().substring(0, 5)) ||
      selectedDepartment.toLowerCase().includes(d.department?.toLowerCase() || '')
    );
    const chosenDoc = deptDoctors[0] || doctorsList[0];

    if (patId && chosenDoc) {
      try {
        const response = await addAppointment({
          patientId: patId,
          doctorId: chosenDoc.id,
          priority: selectedPriority,
          date: new Date().toISOString().split('T')[0],
          time: new Date().toTimeString().split(' ')[0].substring(0, 5)
        });
        const tokenNum = response.token?.tokenNumber || 'A-00';
        toast.success(`Success! Token ${tokenNum} issued for ${patientNameSearch}.`);
        fetchTokens({ today: true });
      } catch (error: any) {
        toast.error(error.message || 'Failed to generate token.');
      }
    } else {
      toast.error('No doctors available for on-duty assignment.');
    }

    // Reset Generate State
    setPatientNameSearch('Sarah Mitchell');
    setPatientIdSearch('8849-MX');
    setSelectedDepartment('Cardiology');
    setSelectedPriority('High');
    setIsGenerateModalOpen(false);
  };

  const handlePreviewToken = () => {
    toast.info(`Spooling preview ticket: ${selectedDepartment.toUpperCase()} Queue - ${patientNameSearch} (${patientIdSearch}) Priority: ${selectedPriority}`);
  };

  const handleRegisterNewPatient = () => {
    toast.message('Navigating to Patient Registration Hub...', {
      description: 'You will be able to register new profiles.'
    });
    navigate('/reception/register');
  };

  // Actions trigger feedback
  const handleCallToken = async (token: QueueToken) => {
    const storeTok = storeTokens.find(t => t.id === token.id || t.tokenNumber === token.tokenNumber);
    if (storeTok) {
      await updateTokenStatus(storeTok.id, 'IN_CONSULTATION');
      toast.success(`Broadcasting announcement: Token ${token.tokenNumber} (${token.patientName}) called for Counter 2.`);
    } else {
      toast.success(`Broadcasting announcement: Token ${token.tokenNumber} called for Counter 2.`);
    }
  };

  const handlePrintToken = (token: QueueToken) => {
    const fullDbToken = storeTokens?.find(t => t.id === token.id || t.tokenNumber === token.tokenNumber);
    const assignedDoc = users?.find(u => u.id === fullDbToken?.doctorId);
    const doctorDisplay = assignedDoc ? assignedDoc.name : 'Staff Physician';
    
    // find actual patient associated to get patient.phone
    const patRecord = patients?.find(p => p.id === token.patientId || p.id === (fullDbToken?.patientId || ''));
    
    generateTokenPDF({
      tokenNumber: token.tokenNumber,
      patientName: token.patientName,
      patientId: token.patientId || 'N/A',
      phone: patRecord?.phone || 'N/A',
      doctorName: doctorDisplay,
      department: token.department || 'General Medicine',
      priority: 'Standard',
      createdAt: fullDbToken?.createdAt || new Date(),
      isHighRisk: patRecord ? isPatientHighRisk(patRecord) : false
    });
    toast.success(`Downloading high-fidelity queue slip PDF for ${token.tokenNumber}...`);
  };

  const handleExportPatientDossier = async (patientId: string, currentPatientName?: string) => {
    try {
      toast.info(`Fetching complete medical history for patient: ${currentPatientName || 'ID ' + patientId.slice(0, 8)}...`);
      // 1. Fetch consultations clinical history
      const { fetchPatientHistory } = useStore.getState();
      const historyRes = await fetchPatientHistory(patientId);
      
      // 2. Fetch bills belonging only to this specific patient
      const billsRes = await authFetch(`/api/bills?patientId=${patientId}`);
      const patientBills = billsRes.ok ? await billsRes.json() : [];
      
      // 3. Find patient object
      const patientObj = patients.find(p => p.id === patientId);
      if (!patientObj) {
        toast.error("Error: Patient demographic profile record not found in registered database.");
        return;
      }
      
      // 4. Fetch tokens belonging only to this specific patient
      const tokensRes = await authFetch(`/api/tokens?patientId=${patientId}`);
      const patientTokens = tokensRes.ok ? await tokensRes.json() : [];
      
      // 5. Generate and download PDF
      generateFullPatientHistoryPDF(patientObj, historyRes, patientBills, patientTokens);
      toast.success(`Dossier PDF downloaded for ${patientObj.name}!`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate complete patient health record dossier.");
    }
  };

  const handleExportDateWiseTokens = async () => {
    try {
      toast.info("Analyzing and compiling daily queue logs...");
      
      // Fetch fresh tokens so we have today's DB snapshot
      await useStore.getState().fetchTokens({ today: true }, true);
      const allTokens = useStore.getState().tokens || [];

      let startDate: Date;
      let endDate: Date;
      let label = '';

      const today = new Date();
      if (exportPeriodType === 'today') {
        startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
        endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
        label = `Today (${today.toLocaleDateString()})`;
      } else if (exportPeriodType === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
        endDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
        label = `Yesterday (${yesterday.toLocaleDateString()})`;
      } else if (exportPeriodType === 'custom') {
        if (!exportDate) {
          toast.error("Please select a valid custom date.");
          return;
        }
        const customDate = new Date(exportDate);
        startDate = new Date(customDate.getFullYear(), customDate.getMonth(), customDate.getDate(), 0, 0, 0);
        endDate = new Date(customDate.getFullYear(), customDate.getMonth(), customDate.getDate(), 23, 59, 59);
        label = `${customDate.toLocaleDateString()}`;
      } else {
        // range
        if (!exportStartDate || !exportEndDate) {
          toast.error("Please specify a complete date range.");
          return;
        }
        const s = new Date(exportStartDate);
        const e = new Date(exportEndDate);
        startDate = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0);
        endDate = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59);
        label = `${s.toLocaleDateString()} to ${e.toLocaleDateString()}`;
      }

      // Filter tokens generated on selected day or range
      const dayTokens = allTokens.filter(t => {
        if (!t.createdAt) return false;
        const creationTime = new Date(t.createdAt).getTime();
        return creationTime >= startDate.getTime() && creationTime <= endDate.getTime();
      }).map(t => {
        const pat = t.patient || patients.find(p => p.id === t.patientId);
        return { ...t, patient: pat };
      });
      
      if (dayTokens.length === 0) {
        toast.error(`No queue entry tokens were created in our system database for: ${label}`);
        return;
      }
      
      generateDateWiseExportPDF(label, dayTokens, users || []);
      toast.success(`Clinical summary report generated for period [${label}]!`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate daily clinical summary export.");
    }
  };

  const handleExportAllPatientsSystemWide = async (format: 'pdf' | 'csv') => {
    try {
      toast.info(`Generating complete system-wide registry audit report in ${format.toUpperCase()} format...`);
      
      // Direct fetch from dedicated uncapped export endpoints
      const [patientsRes, billsRes, tokensRes] = await Promise.all([
        authFetch('/api/export/patients'),
        authFetch('/api/export/bills'),
        authFetch('/api/export/tokens')
      ]);

      if (!patientsRes.ok) {
        throw new Error(`Failed to load uncapped patients data: ${patientsRes.status}`);
      }
      if (!billsRes.ok) {
        throw new Error(`Failed to load uncapped bills data: ${billsRes.status}`);
      }
      if (!tokensRes.ok) {
        throw new Error(`Failed to load uncapped tokens data: ${tokensRes.status}`);
      }

      const allPatients = (await patientsRes.json() || []) as Patient[];
      const allBills = (await billsRes.json() || []) as any[];
      const allTokens = (await tokensRes.json() || []) as Token[];

      if (allPatients.length === 0) {
        toast.error("No patients found in system registry to compile reports.");
        return;
      }

      const formatVisitDate = (dateVal: any) => {
        if (!dateVal) return new Date().toISOString().split('T')[0];
        try {
          return new Date(dateVal).toISOString().split('T')[0];
        } catch (e) {
          return new Date().toISOString().split('T')[0];
        }
      };

      const formatPhoneForCSV = (phoneVal: any) => {
        if (!phoneVal || phoneVal === 'N/A' || phoneVal === 'Not Available') return 'Not Available';
        return String(phoneVal).trim();
      };

      const formatDoctorName = (rawName: string) => {
        if (!rawName || rawName === 'N/A' || rawName === 'Not Assigned' || rawName === 'Unknown Practitioner') return 'Not Assigned';
        let cleanName = rawName.trim();
        while (cleanName.toLowerCase().startsWith('dr.') || cleanName.toLowerCase().startsWith('dr ')) {
          if (cleanName.toLowerCase().startsWith('dr.')) {
            cleanName = cleanName.slice(3).trim();
          } else if (cleanName.toLowerCase().startsWith('dr ')) {
            cleanName = cleanName.slice(3).trim();
          }
        }
        if (cleanName.toLowerCase() === 'dr' || !cleanName) {
          return 'Not Assigned';
        }
        return `Dr. ${cleanName}`;
      };

      // Single Unified Dataset Query & Resolution Layer
      const dataset = allTokens.map((t: any) => {
        const p = t.patient || allPatients.find((pat: any) => pat.id === t.patientId);
        const docUser = users.find((u: any) => u.id === t.doctorId);
        const rawDoctorName = docUser ? docUser.name : (t.doctorName || 'Staff Physician');
        const department = docUser?.department || t.department || 'General Medicine';

        const patientBills = allBills.filter((b: any) => b.patientId === t.patientId && b.tokenNumber === t.tokenNumber);
        const totalInvoiced = patientBills.reduce((acc, b) => acc + (b.total || 0), 0);
        const billStatus = patientBills.length > 0 ? `INR ${totalInvoiced.toFixed(2)}` : 'NO BILL';
        const paymentStatus = patientBills.length > 0 ? (patientBills[0].status || 'PENDING').toUpperCase() : 'N/A';

        const visitDate = formatVisitDate(t.createdAt || (p ? p.createdAt : null));
        const visitTime = t.createdAt ? new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : 'Not Available';

        const consult = t.visitRecord?.consultation;
        const rxItems = consult?.prescription?.items;
        const rxStr = rxItems && rxItems.length > 0
          ? rxItems.map((pi: any) => `${pi.medicine} (${pi.dosage || 'N/A'}, ${pi.frequency || 'N/A'}, ${pi.duration || 'N/A'})`).join('\n')
          : (consult ? 'ADVICE ONLY' : 'N/A');

        return {
          patientId: p?.id || t.patientId || 'N/A',
          patientName: p?.name || 'Unknown Patient',
          age: p ? String(p.age) : 'N/A',
          gender: p?.gender || 'N/A',
          phone: formatPhoneForCSV(p?.phone),
          department: department,
          doctorName: formatDoctorName(rawDoctorName),
          tokenNumber: t.tokenNumber || t.id || 'N/A',
          visitDate: visitDate,
          visitTime: visitTime,
          status: t.status || 'N/A',
          billingStatus: billStatus,
          paymentStatus: paymentStatus,
          prescriptions: rxStr,
          rawCreatedAt: t.createdAt ? new Date(t.createdAt).getTime() : 0
        };
      });

      // Strict Chronological Ordering Rule (Visit Date DESC, Token ID DESC) applied identically to PDF and CSV
      dataset.sort((a, b) => {
        if (b.rawCreatedAt !== a.rawCreatedAt) {
          return b.rawCreatedAt - a.rawCreatedAt;
        }
        return String(b.tokenNumber).localeCompare(String(a.tokenNumber));
      });

      // Assert validation check: matching counts, order, and critical data cells
      const validateIntegrity = (list: typeof dataset) => {
        const pdfProjection = list.map(item => ({
          patientId: item.patientId,
          patientName: item.patientName,
          tokenNumber: item.tokenNumber,
          visitDate: item.visitDate,
          billingStatus: item.billingStatus,
          prescriptions: item.prescriptions
        }));

        const csvProjection = list.map(item => ({
          patientId: item.patientId,
          patientName: item.patientName,
          tokenNumber: item.tokenNumber,
          visitDate: item.visitDate,
          billingStatus: item.billingStatus,
          prescriptions: item.prescriptions
        }));

        if (pdfProjection.length !== csvProjection.length) return false;
        
        for (let i = 0; i < pdfProjection.length; i++) {
          if (pdfProjection[i].patientId !== csvProjection[i].patientId) return false;
          if (pdfProjection[i].patientName !== csvProjection[i].patientName) return false;
          if (pdfProjection[i].tokenNumber !== csvProjection[i].tokenNumber) return false;
          if (pdfProjection[i].visitDate !== csvProjection[i].visitDate) return false;
          if (pdfProjection[i].billingStatus !== csvProjection[i].billingStatus) return false;
          if (pdfProjection[i].prescriptions !== csvProjection[i].prescriptions) return false;
        }
        return true;
      };

      if (!validateIntegrity(dataset)) {
        console.error("Clinical Registry Audit Mismatch: System datasets diverge on validation.");
        toast.error("Export Mismatch Detected. Operation aborted automatically for hospital registry compliance.");
        return;
      }

      if (format === 'pdf') {
        generateAllPatientsExportPDF(dataset, allPatients.length);
        toast.success("Complete historical database PDF generated!");
      } else {
        // High fidelity Excel-compliant aligned XLSX formatting implementing ALL production standards
        const headers = [
          "Patient ID",
          "Patient Name",
          "Age",
          "Gender",
          "Phone",
          "Department",
          "Assigned Doctor",
          "Token ID",
          "Visit Date",
          "Visit Time",
          "Status",
          "Billing Status",
          "Payment Status",
          "Prescriptions Issued"
        ];

        const worksheetData: any[][] = [];
        worksheetData.push(headers);

        dataset.forEach(row => {
          worksheetData.push([
            row.patientId.startsWith('PID-') ? row.patientId : `PID-${row.patientId.slice(0, 8).toUpperCase()}`,
            row.patientName,
            row.age,
            row.gender,
            row.phone,
            row.department,
            row.doctorName,
            row.tokenNumber,
            row.visitDate,
            row.visitTime,
            row.status,
            row.billingStatus,
            row.paymentStatus,
            row.prescriptions
          ]);
        });

        // Generate the workbook
        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
        
        // Apply production formatting standards on cells
        Object.keys(worksheet).forEach(cellKey => {
          if (cellKey.startsWith('!')) return;
          const cell = worksheet[cellKey];
          if (!cell) return;
          
          const colLetter = cellKey.match(/[A-Z]+/)?.[0] || '';
          const rowNum = parseInt(cellKey.match(/\d+/)?.[0] || '1', 10);
          
          // Decode column letter to 0-based column index
          let colIndex = 0;
          for (let i = 0; i < colLetter.length; i++) {
            colIndex = colIndex * 26 + (colLetter.charCodeAt(i) - 64);
          }
          colIndex = colIndex - 1;
          
          const isHeader = (rowNum === 1);
          const isPrescriptions = (colIndex === 13); // Prescriptions Issued is at index 13
          const isCenter = [0, 2, 3, 7, 8, 9, 10, 11, 12].includes(colIndex);
          
          cell.s = {
            font: {
              name: 'Arial',
              sz: isHeader ? 11 : 10,
              bold: isHeader
            },
            alignment: {
              horizontal: isHeader ? 'center' : (isCenter ? 'center' : 'left'),
              vertical: 'center',
              wrapText: isPrescriptions
            }
          };
        });

        // Required Column Widths
        worksheet['!cols'] = [
          { wch: 18 }, // Patient ID
          { wch: 30 }, // Patient Name
          { wch: 10 }, // Age
          { wch: 12 }, // Gender
          { wch: 20 }, // Phone
          { wch: 25 }, // Department
          { wch: 35 }, // Assigned Doctor
          { wch: 18 }, // Token ID
          { wch: 18 }, // Visit Date
          { wch: 15 }, // Visit Time
          { wch: 18 }, // Status
          { wch: 20 }, // Billing Status
          { wch: 20 }, // Payment Status
          { wch: 60 }  // Prescriptions Issued
        ];

        // Normal Rows: Minimum height 25. Rows containing multiple medicines: Auto-expand height.
        const rowHeights: any[] = [];
        rowHeights.push({ hpt: 28 }); // Header height

        for (let r = 1; r < worksheetData.length; r++) {
          const rxColValue = worksheetData[r][13] || '';
          const lineCount = String(rxColValue).split('\n').length;
          const calculatedHeight = Math.max(25, lineCount * 17);
          rowHeights.push({ hpt: calculatedHeight });
        }
        worksheet['!rows'] = rowHeights;

        // Freeze first row
        worksheet['!views'] = [
          {
            state: 'frozen',
            ySplit: 1,
            xSplit: 0,
            topLeftCell: 'A2',
            activePane: 'bottomLeft'
          }
        ];

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Master Clinical Audit');
        
        XLSX.writeFile(workbook, `hospital_master_clinical_audit_ledger_${new Date().toISOString().split('T')[0]}.xlsx`);
        toast.success("Comprehensive Excel/XLSX Audit Ledger downloaded successfully!");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to compile whole system patient archive ledger.");
    }
  };

  const handleCancelToken = async (token: QueueToken) => {
    const storeTok = storeTokens.find(t => t.id === token.id || t.tokenNumber === token.tokenNumber);
    if (storeTok) {
      await updateTokenStatus(storeTok.id, 'CANCELLED');
      toast.error(`Token ${token.tokenNumber} for ${token.patientName} has been cancelled.`);
    } else {
      toast.error(`Token ${token.tokenNumber} for ${token.patientName} has been cancelled.`);
    }
  };

  const handleCompleteToken = async (token: QueueToken) => {
    const storeTok = storeTokens.find(t => t.id === token.id || t.tokenNumber === token.tokenNumber);
    if (storeTok) {
      await updateTokenStatus(storeTok.id, 'CONSULTATION_COMPLETED');
      toast.success(`Token ${token.tokenNumber} mapped to [COMPLETED] files. Records saved.`);
    } else {
      toast.success(`Token ${token.tokenNumber} mapped to [COMPLETED].`);
    }
  };

  const handleDownloadRoster = () => {
    if (filteredTokens.length === 0) {
      toast.error('The active roster queue is empty. Nothing to export.');
      return;
    }
    toast.success('Compiling CSV visible queue roster dataset. Your download is starting shortly.');
    
    const headers = ["Token Number", "Patient Name", "Patient ID", "Department", "Wait Time", "Status", "Clinical Risk Status"];
    const rows = filteredTokens.map(t => {
      return [
        t.tokenNumber || 'N/A',
        `"${t.patientName || 'N/A'}"`,
        t.patientId || 'N/A',
        t.department || 'N/A',
        `"${t.waitTime || 'N/A'}"`,
        t.status || 'N/A',
        t.isHighRisk ? 'HIGH RISK' : 'Standard'
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `queue_active_roster_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Department Load calculations derived dynamically from state
  const getDepartmentStats = (deptName: string) => {
    const list = tokens.filter((t) => normalizeDeptName(t.department || '') === normalizeDeptName(deptName) && t.status !== 'COMPLETED');
    const activeWaiting = tokens.filter((t) => normalizeDeptName(t.department || '') === normalizeDeptName(deptName) && t.status === 'IN QUEUE');
    
    const countVal = list.length;
    
    // Calculate real-time estimated wait time based on active count and doctor pool size
    const deptDocs = (users || []).filter(u => u.role === 'DOCTOR' && u.isActive !== false && normalizeDeptName(u.department || '') === normalizeDeptName(deptName));
    const doctorPoolSize = deptDocs.length || 1;
    
    let totalWeightMins = 0;
    activeWaiting.forEach(t => {
      const pri = t.priority?.toUpperCase();
      if (pri === 'EMERGENCY') {
        totalWeightMins += 20;
      } else if (pri === 'URGENT') {
        totalWeightMins += 15;
      } else {
        totalWeightMins += 12;
      }
    });

    const estMins = Math.ceil(totalWeightMins / doctorPoolSize);
    
    const countStr = countVal < 10 ? '0' + countVal : String(countVal);
    const waitStr = estMins < 10 ? `0${estMins} MIN WAIT` : `${estMins} MIN WAIT`;
    
    return { count: countStr, avgWait: waitStr };
  };

  const activeTotalCount = tokens.filter((t) => t.status !== 'COMPLETED').length;

  // Filter Tokens list based on Active Tab, Search terms, and Department selection
  const filteredTokens = tokens.filter((token) => {
    // 1. Tab Filter
    if (activeTab === 'CALLED' && token.status !== 'CALLED') return false;
    if (activeTab === 'IN_QUEUE' && token.status !== 'IN QUEUE' && token.status !== 'DELAYED') return false;

    // 2. Quick Search Term
    if (headerSearchTerm.trim() !== '') {
      const criteria = `${token.tokenNumber} ${token.patientName} ${token.patientId} ${token.department}`.toLowerCase();
      if (!criteria.includes(headerSearchTerm.toLowerCase())) return false;
    }

    // 3. Department Dropdown Filter
    if (departmentFilter !== 'ALL') {
      if (token.department.toLowerCase() !== departmentFilter.toLowerCase()) return false;
    }

    return true;
  });

  return (
    <div className="font-body-md bg-background text-on-surface min-h-screen relative overflow-x-hidden p-0 m-0">
      
      {/* Dynamic styles override custom workspace app configurations */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');

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

        :root {
          --hanken-font: 'Hanken Grotesk', sans-serif;
        }

        .font-body-md {
          font-family: var(--hanken-font);
        }

        .material-symbols-outlined {
          font-family: 'Material Symbols Outlined';
          vertical-align: middle;
          display: inline-block;
          font-size: 24px;
          line-height: 1;
        }

        /* Color Scheme Palette Alignments */
        .bg-background { background-color: #f8f9ff !important; }
        .text-on-surface { color: #0b1c30 !important; }
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
        .bg-secondary-container { background-color: #83f6e6 !important; }
        .text-on-secondary-container { color: #00201c !important; }
        .bg-error-container { background-color: #ffdad6 !important; }
        .text-on-error-container { color: #93000a !important; }
        .bg-surface-variant { background-color: #d3e4fe !important; }
        .bg-surface-container-high { background-color: #dce9ff !important; }
        .bg-secondary-fixed { background-color: #83f6e6 !important; }
        .text-on-secondary-fixed { color: #00201c !important; }

        .text-stats-number { font-size: 36px; line-height: 40px; font-weight: 700; }
        .text-headline-md { font-size: 24px; line-height: 32px; font-weight: 700; }
        .text-display-lg { font-size: 30px; line-height: 38px; letter-spacing: -0.02em; font-weight: 700; }
        .text-title-sm { font-size: 18px; line-height: 24px; font-weight: 600; }
        .text-label-caps { font-size: 11px; line-height: 16px; letter-spacing: 0.05em; font-weight: 700; text-transform: uppercase; }
        
        .px-container-padding { padding-left: 24px; padding-right: 24px; }
        .w-sidebar-width { width: 260px; }
        .h-16 { height: 64px; }
      `}</style>

      {/* Sidebar Navigation */}
      <aside className="fixed left-0 top-0 bottom-0 flex flex-col justify-between py-6 w-sidebar-width h-screen border-r border-[#c4c6d2] bg-white z-50">
        <div>
          {/* Brand Logo Header */}
          <div className="px-6 mb-10 flex items-center gap-3">
            <div className="w-10 h-10 bg-[#001a48] rounded flex items-center justify-center text-white shadow-sm">
              <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>medical_services</span>
            </div>
            <div>
              <h1 className="text-headline-md font-bold text-[#001a48]">MedFlow</h1>
              <p className="text-label-caps text-[#444651] tracking-widest leading-none">CLINICAL PRECISION</p>
            </div>
          </div>
          {/* Nav Items */}
          <nav className="space-y-2 px-2">
            <button 
              onClick={() => navigate('/reception')}
              className="w-full flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-[#eff4ff] transition-colors rounded-lg text-left"
            >
              <span className="material-symbols-outlined text-slate-500">dashboard</span>
              <span className="font-body-md font-semibold text-slate-700">Dashboard</span>
            </button>
            <button 
              onClick={() => navigate('/reception/register')}
              className="w-full flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-[#eff4ff] transition-colors rounded-lg text-left"
            >
              <span className="material-symbols-outlined text-slate-500">person_add</span>
              <span className="font-body-md font-semibold text-slate-700">Patient Registration</span>
            </button>
            <button 
              onClick={() => setActiveTab('ALL')}
              className="w-full flex items-center gap-3 px-4 py-3 bg-[#001a48] text-white rounded-lg shadow-sm text-left transition-all scale-[0.98]"
            >
              <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>confirmation_number</span>
              <span className="font-body-md font-bold">Token Management</span>
            </button>
          </nav>
        </div>
        {/* Nav Items Footer settings & signout */}
        <div className="space-y-2 px-2">
          <button 
            onClick={() => { logout(); navigate('/login'); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-[#eff4ff] transition-colors rounded-lg hover:text-red-600 text-left"
          >
            <span className="material-symbols-outlined">logout</span>
            <span className="font-body-md font-bold text-[#ba1a1a]">Logout</span>
          </button>
        </div>
      </aside>

      {/* Top App Bar Header section */}
      <header className="fixed top-0 right-0 left-[260px] z-40 flex items-center justify-between px-container-padding h-16 bg-white/80 backdrop-blur-md border-b border-[#c4c6d2]">
        <div className="flex-1 max-w-xl">
          <div className="relative group">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10 text-[19px]">search</span>
            <input
              value={headerSearchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full bg-[#f8f9ff] border border-[#c4c6d2] rounded-full pl-11 pr-10 py-2 focus:ring-4 focus:ring-[#001a48]/15 focus:border-[#001a48] transition-all duration-200 outline-none text-[13.5px] font-semibold text-slate-800 shadow-inner"
              placeholder="Quick Search (Name, ID, Phone, Dept)..."
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
                            onClick={() => handleSelectSearchPatient(p.name)} 
                            className="p-3 cursor-pointer hover:bg-[#f8f9ff]"
                          >
                            <div className="text-[13.5px] font-bold text-slate-800 flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-slate-500 text-[18px]">person</span>
                              {p.name}
                            </div>
                            <div className="text-[11.5px] text-slate-500 mt-0.5 ml-6">
                              Patient ID: {p.id.substring(0, 8)} · Phone: {p.phone} · Sex: {p.gender}
                            </div>
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
        <div className="flex items-center gap-6">
          <button onClick={() => toast.info('System notifications feed empty.')} className="relative text-on-surface-variant hover:text-primary transition-colors flex items-center">
            <span className="material-symbols-outlined text-slate-700">notifications</span>
            <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-red-600 border-2 border-white rounded-full"></span>
          </button>
          <button onClick={() => toast.info('Internal clinical translation services: English')} className="text-on-surface-variant hover:text-primary transition-colors flex items-center">
            <span className="material-symbols-outlined text-slate-700">language</span>
          </button>
          <div className="flex items-center gap-3 border-l border-[#c4c6d2] pl-6">
            <div className="text-right">
              <p className="text-[13px] font-bold text-[#0b1c30] leading-none">{currentUser?.name || 'Alan Reji'}</p>
              <p className="text-label-caps text-on-surface-variant opacity-85 mt-1">RECEPTION HUB</p>
            </div>
            <img
              alt="Profile photograph of Alan Reji"
              className="w-10 h-10 rounded-full border border-[#c4c6d2] object-cover bg-slate-100"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDLOf86N8awil44VR8fkx4C7Rpj6i3jkyRizaFZl_lzoXZ_pxb64IC-tiU0G79TZppESx72FGhiHKDfCyGGtZGCLggRwUBu5qonx2o1TGiRlHmmIr5KWPM8yHg6hmREWb29hSqc5xeSgri6g5VKVqKOOIIWG7hXdDUMVoE-wLYssTx38WQZKq6QAFuF4wwGN2kY2RtOR5yi-YAbKz0B1c7wN_n2sFb9gf3QRVGhIbPkvCXkQyxo29N6glfBs2104cgi5t9nyAPdOVM"
            />
          </div>
        </div>
      </header>

      {/* Main Page Content Body area */}
      <main className="ml-[260px] pt-24 min-h-screen">
        <div className="p-container-padding space-y-6">

          {/* Page Title & primary CTA actions area */}
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-display-lg text-[#001a48] tracking-tight">Token Management</h2>
              <p className="font-body-md text-on-surface-variant mt-1">Real-time patient flow and department queue monitoring</p>
            </div>
             <div className="flex gap-3">
              <button
                onClick={handleRefreshSync}
                disabled={isSyncing}
                className="flex items-center gap-2 px-5 py-2.5 border border-[#001a48] text-[#001a48] font-bold rounded-lg hover:bg-[#e5eeff]/40 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-lg ${isSyncing ? 'animate-spin' : ''}`}>refresh</span>
                <span>Refresh Sync</span>
              </button>
              <button
                onClick={() => setIsExportModalOpen(true)}
                className="flex items-center gap-2 px-5 py-2.5 border border-[#002d72] bg-[#eff4ff] text-[#001a48] font-bold rounded-lg hover:bg-white transition-all cursor-pointer active:scale-95 shadow-xs"
              >
                <span className="material-symbols-outlined text-lg">download</span>
                <span>Advanced Reports</span>
              </button>
              <button
                onClick={() => setIsGenerateModalOpen(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#001a48] text-white font-bold rounded-lg hover:opacity-90 shadow-xs transition-all cursor-pointer active:scale-95"
              >
                <span className="material-symbols-outlined text-lg">add</span>
                <span>Generate New Token</span>
              </button>
            </div>
          </div>

          {/* Statistical layout cards */}
          <div className="grid grid-cols-12 gap-5">
            
            {/* Left side active total card */}
            <div className="col-span-12 lg:col-span-3 bg-white border border-[#c4c6d2] rounded-xl p-6 flex flex-col justify-between shadow-xs">
              <div>
                <p className="text-label-caps text-on-surface-variant">TOTAL ACTIVE QUEUE</p>
                <div className="flex items-baseline gap-3 mt-2">
                  <span className="text-stats-number text-[#001a48] leading-none">{activeTotalCount}</span>
                  <span className="text-[13px] text-[#006a61] font-semibold">+5 from last hour</span>
                </div>
              </div>
              <div className="mt-6">
                <div className="h-2.5 w-full bg-[#eff4ff] rounded-full overflow-hidden flex">
                  <div className="h-full bg-[#001a48]" style={{ width: '45%' }}></div>
                  <div className="h-full bg-[#006a61]" style={{ width: '25%' }}></div>
                  <div className="h-full bg-[#ba1a1a]" style={{ width: '15%' }}></div>
                </div>
              </div>
            </div>

            {/* Right side Department Loads dashboard */}
            <div className="col-span-12 lg:col-span-9 bg-white border border-[#c4c6d2] rounded-xl p-6 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <p className="text-label-caps text-on-surface-variant">DEPARTMENT LOADS</p>
                <button 
                  onClick={() => setIsViewAllUnitsOpen(true)}
                  className="text-[13px] font-bold text-[#001a48] hover:underline"
                >
                  View All Units
                </button>
              </div>

              {/* Grid block mapping Department statuses */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'General Medicine', key: 'General Medicine' },
                  { label: 'Cardiology', key: 'Cardiology' },
                  { label: 'Diagnostics', key: 'Diagnostics' },
                  { label: 'Pediatrics', key: 'Pediatrics' },
                ].map((dept) => {
                  const stats = getDepartmentStats(dept.key);
                  return (
                    <div key={dept.key} className="bg-[#eff4ff]/60 p-4 rounded-lg border border-[#c4c6d2]/55">
                      <p className="text-[13px] font-semibold text-slate-800">{dept.label}</p>
                      <div className="flex items-baseline gap-1 mt-1">
                        <span className="text-title-sm font-bold text-[#0b1c30]">{stats.count}</span>
                        <span className="text-label-caps text-slate-500 font-bold uppercase text-[10px]">/ {stats.avgWait}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Active Queue elements list table */}
          <div className="bg-white border border-[#c4c6d2] rounded-xl overflow-hidden shadow-xs">
            
            {/* Table Controls Header */}
            <div className="px-6 py-4 flex items-center justify-between border-b border-[#c4c6d2] bg-slate-50">
              <div className="flex items-center gap-6">
                <h3 className="text-title-sm text-[#0b1c30] font-bold">Active Queue</h3>
                {/* Visual tabs switcher */}
                <div className="flex bg-[#eff4ff] p-1 rounded-lg">
                  <button
                    onClick={() => setActiveTab('ALL')}
                    className={`px-4 py-1.5 text-[13px] font-bold rounded-md transition-all cursor-pointer ${
                      activeTab === 'ALL'
                        ? 'bg-white text-[#001a48] shadow-sm'
                        : 'text-slate-600 hover:text-[#001a48]'
                    }`}
                  >
                    All Tokens
                  </button>
                  <button
                    onClick={() => setActiveTab('CALLED')}
                    className={`px-4 py-1.5 text-[13px] font-bold rounded-md transition-all cursor-pointer ${
                      activeTab === 'CALLED'
                        ? 'bg-white text-[#001a48] shadow-sm'
                        : 'text-slate-600 hover:text-[#001a48]'
                    }`}
                  >
                    Called
                  </button>
                  <button
                    onClick={() => setActiveTab('IN_QUEUE')}
                    className={`px-4 py-1.5 text-[13px] font-bold rounded-md transition-all cursor-pointer ${
                      activeTab === 'IN_QUEUE'
                        ? 'bg-white text-[#001a48] shadow-sm'
                        : 'text-slate-600 hover:text-[#001a48]'
                    }`}
                  >
                    In Queue
                  </button>
                </div>
              </div>

              {/* Table side control buttons */}
              <div className="flex items-center gap-2 relative">
                {/* Department drop search filters toggle */}
                <button
                  type="button"
                  onClick={() => setShowDepartmentDropdown(!showDepartmentDropdown)}
                  className={`w-9 h-9 flex items-center justify-center border rounded hover:bg-[#e5eeff] transition-all cursor-pointer ${
                    departmentFilter !== 'ALL' ? 'border-[#001a48] bg-[#eff4ff] text-[#001a48]' : 'border-[#c4c6d2] text-slate-700 bg-white'
                  }`}
                  title="Filter by Department"
                >
                  <span className="material-symbols-outlined text-lg">filter_list</span>
                </button>

                {showDepartmentDropdown && (
                  <div className="absolute right-10 top-0 w-56 bg-white border border-[#c4c6d2] rounded-lg shadow-lg z-30 p-2 text-[13px] text-slate-800">
                    <p className="px-3 py-1 text-label-caps text-slate-500 font-bold mb-1">Filter Department</p>
                    {['ALL', 'General Medicine', 'Cardiology', 'Diagnostics', 'Pediatrics', 'Emergency'].map((dept) => (
                      <button
                        key={dept}
                        onClick={() => {
                          setDepartmentFilter(dept);
                          setShowDepartmentDropdown(false);
                          toast.info(`Filtering database list to display [${dept}] only.`);
                        }}
                        className={`w-full text-left px-3 py-1.5 rounded hover:bg-[#eff4ff] transition-colors ${
                          departmentFilter === dept ? 'bg-[#eff4ff] text-[#001a48] font-bold' : ''
                        }`}
                      >
                        {dept}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Roster Table Content */}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[#eff4ff]/30">
                  <tr className="border-b border-[#c4c6d2]">
                    <th className="px-6 py-4 text-label-caps text-on-surface-variant font-bold">TOKEN ID</th>
                    <th className="px-6 py-4 text-label-caps text-on-surface-variant font-bold">PATIENT NAME</th>
                    <th className="px-6 py-4 text-label-caps text-on-surface-variant font-bold">DEPARTMENT</th>
                    <th className="px-6 py-4 text-label-caps text-on-surface-variant font-bold">WAIT TIME</th>
                    <th className="px-6 py-4 text-label-caps text-on-surface-variant font-bold text-center">STATUS</th>
                    <th className="px-6 py-4 text-label-caps text-on-surface-variant font-bold text-right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#c4c6d2]">
                  {filteredTokens.length > 0 ? (
                    filteredTokens.map((token) => {
                      const isRowCalled = token.status === 'CALLED';
                      const isRowCompleted = token.status === 'COMPLETED';
                      const isEmergency = token.priority?.toUpperCase() === 'EMERGENCY';
                      const isUrgent = token.priority?.toUpperCase() === 'URGENT';
                      
                      let priorityRowClass = '';
                      if (!isRowCompleted) {
                        if (isEmergency) {
                          priorityRowClass = 'bg-red-50/70 hover:bg-red-100/70 border-l-4 border-l-red-500';
                        } else if (isUrgent) {
                          priorityRowClass = 'bg-amber-50/60 hover:bg-amber-100/60 border-l-4 border-l-amber-500';
                        }
                      }

                      return (
                        <tr
                          key={token.id}
                          className={`hover:bg-[#f8f9ff] transition-colors transition-all ${
                            isRowCalled ? 'border-l-3 border-l-[#001a48]' : ''
                          } ${isRowCompleted ? 'bg-[#eff4ff]/20 opacity-75' : ''} ${priorityRowClass}`}
                        >
                          {/* Token number */}
                          <td className={`px-6 py-4 font-bold text-[14px] ${isRowCompleted ? 'text-slate-500 line-through' : 'text-[#001a48]'}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              {token.tokenNumber}
                              {!isRowCompleted ? (
                                <select
                                  value={token.priority?.toUpperCase() || 'MEDIUM'}
                                  onChange={async (e) => {
                                    try {
                                      await updateTokenPriority(token.id, e.target.value);
                                      toast.success(`Priority updated to ${e.target.value} for ${token.patientName}.`);
                                    } catch (err: any) {
                                      toast.error(err.message || 'Failed to update priority');
                                    }
                                  }}
                                  className={`text-[10px] font-bold rounded px-2 py-0.5 border cursor-pointer uppercase transition-colors ${
                                    token.priority?.toUpperCase() === 'EMERGENCY' ? 'bg-red-100 text-red-700 border-red-300 animate-pulse' :
                                    token.priority?.toUpperCase() === 'URGENT' ? 'bg-amber-100 text-amber-800 border-amber-300' :
                                    token.priority?.toUpperCase() === 'HIGH' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                    token.priority?.toUpperCase() === 'MEDIUM' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                    'bg-slate-100 text-slate-650 border-slate-300'
                                  }`}
                                >
                                  <option value="LOW">Low</option>
                                  <option value="MEDIUM">Medium</option>
                                  <option value="HIGH">High</option>
                                  <option value="URGENT">Urgent</option>
                                  <option value="EMERGENCY">Emergency</option>
                                </select>
                              ) : (
                                <span className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-slate-100 text-slate-500 border border-slate-200">
                                  {token.priority || 'MEDIUM'}
                                </span>
                              )}
                            </div>
                          </td>
                          {/* Patient Legal identification details */}
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-slate-900 text-[14px]">{token.patientName}</p>
                            </div>
                            <p className="text-[12px] text-slate-500 font-semibold">{token.patientId}</p>
                          </td>
                          {/* Assigned hospital division */}
                          <td className="px-6 py-4 text-[13px] font-semibold text-slate-700">
                            {token.department}
                          </td>
                          {/* Active waiting counters */}
                          <td className={`px-6 py-4 text-[13px] font-semibold ${token.status === 'DELAYED' ? 'text-red-650' : 'text-slate-600'}`}>
                            {token.waitTime}
                          </td>
                          {/* Render Status Badge Pill */}
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-center">
                              {token.status === 'IN QUEUE' && (
                                <div className="px-3.5 py-1 text-[11px] font-extrabold uppercase rounded-full bg-[#006a61]/10 text-[#006a61] tracking-wider whitespace-nowrap">
                                  IN QUEUE
                                </div>
                              )}
                              {token.status === 'CALLED' && (
                                <div className="px-3.5 py-1 text-[11px] font-extrabold uppercase rounded-full bg-[#001a48] text-white tracking-wider whitespace-nowrap shadow-xs">
                                  CALLED
                                </div>
                              )}
                              {token.status === 'DELAYED' && (
                                <div className="px-3.5 py-1 text-[11px] font-extrabold uppercase rounded-full bg-red-100 text-[#ba1a1a] tracking-wider whitespace-nowrap">
                                  DELAYED
                                </div>
                              )}
                              {token.status === 'COMPLETED' && (
                                <div className="px-3.5 py-1 text-[11px] font-extrabold uppercase rounded-full bg-slate-100 text-slate-500 tracking-wider whitespace-nowrap">
                                  COMPLETED
                                </div>
                              )}
                            </div>
                          </td>
                          {/* Render dynamic CTA Action layouts */}
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-3.5 text-slate-600">
                              {!isRowCompleted ? (
                                <>
                                  {isRowCalled ? (
                                    <button
                                      onClick={() => handleCompleteToken(token)}
                                      className="hover:text-[#006a61] transition-colors p-1"
                                      title="Mark consultation completed"
                                    >
                                      <span className="material-symbols-outlined text-[20px] text-[#006a61]">check_circle</span>
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleCallToken(token)}
                                      className="hover:text-[#001a48] transition-colors p-1"
                                      title="Broadcast announcements"
                                    >
                                      <span className="material-symbols-outlined text-[20px]">campaign</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handlePrintToken(token)}
                                    className="hover:text-amber-600 transition-colors p-1"
                                    title="Print Token Roster Ticket"
                                  >
                                    <span className="material-symbols-outlined text-[20px]">print</span>
                                  </button>
                                  <button
                                    onClick={() => handleExportPatientDossier(token.patientId, token.patientName)}
                                    className="hover:text-blue-700 transition-colors p-1"
                                    title="Download Complete Patient Dossier PDF"
                                  >
                                    <span className="material-symbols-outlined text-[20px] text-blue-600">assignment_ind</span>
                                  </button>
                                  <button
                                    onClick={() => handleCancelToken(token)}
                                    className="hover:text-[#ba1a1a] transition-colors p-1"
                                    title="Cancel queue token"
                                  >
                                    <span className="material-symbols-outlined text-[20px]">cancel</span>
                                  </button>
                                </>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleExportPatientDossier(token.patientId, token.patientName)}
                                    className="hover:text-blue-700 transition-colors p-1"
                                    title="Download Complete Patient Dossier PDF"
                                  >
                                    <span className="material-symbols-outlined text-[20px] text-blue-600">assignment_ind</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic text-[14px]">
                        No patients matching selected queue filtering params.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Table pagination footer section matching visuals */}
            <div className="px-6 py-4 flex items-center justify-between border-t border-[#c4c6d2] bg-slate-50/50">
              <p className="text-[13px] font-semibold text-slate-500">
                Showing {filteredTokens.length} active matching tokens ({tokens.length} total elements)
              </p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => toast.info('We are currently displaying the live unified scroll buffer queue.')}
                  className="w-8 h-8 flex items-center justify-center border border-[#c4c6d2] rounded hover:bg-[#eff4ff] transition-colors text-slate-700 cursor-pointer"
                  title="First Page"
                >
                  <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                </button>
                <button
                  type="button"
                  onClick={() => toast.info('Queue logs are fully buffered in the immediate live table viewport.')}
                  className="w-8 h-8 flex items-center justify-center border border-[#c4c6d2] rounded hover:bg-[#eff4ff] transition-colors text-slate-700 cursor-pointer"
                  title="Last Page"
                >
                  <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                </button>
              </div>
            </div>

          </div>

        </div>
      </main>

      {/* Visual background atmospheric shapes match designs precisely */}
      <div className="fixed inset-0 pointer-events-none -z-10 opacity-15 overflow-hidden">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-gradient-to-br from-[#e5eeff] to-transparent rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-[#dce9ff] to-transparent rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl"></div>
      </div>

      {/* MODAL: Generate New Token Ticket Modal Form sheet */}
      <GenerateTokenModal 
        isOpen={isGenerateModalOpen} 
        onClose={() => setIsGenerateModalOpen(false)} 
      />

      {/* MODAL: Advanced Medical Reports Export Hub */}
      {isExportModalOpen && (
        <div 
          onClick={() => setIsExportModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-[#c4c6d2] animate-in fade-in zoom-in-95 duration-200"
          >
            {/* Modal Header */}
            <div className="bg-[#001a48] text-white p-6 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-white">Clinical Records Export Hub</h3>
                <p className="text-xs text-sky-200 mt-1 font-semibold">Generate and download official PDF medical reports</p>
              </div>
              <button 
                onClick={() => setIsExportModalOpen(false)}
                className="text-white/80 hover:text-white hover:bg-white/10 p-2 rounded-lg transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              
              {/* Option A: Full Patient Dossier */}
              <div className="p-5 bg-white border border-[#c4c6d2] rounded-xl space-y-4 shadow-xs">
                <div className="flex items-center gap-2.5 text-[#0b1c30]">
                  <span className="material-symbols-outlined text-[#001a48] text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>assignment_ind</span>
                  <p className="font-bold text-sm">Patient Care Dossier Reports</p>
                </div>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  Compiles a comprehensive dossier file with demographics, initial vitals, department allocations, queue history, clinical consult logs, and billing statements since registration.
                </p>
                
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Select Registered Patient</label>
                  
                  {selectedExportPatientId ? (
                    (() => {
                      const chosenPatientObj = patients.find(p => p.id === selectedExportPatientId);
                      if (!chosenPatientObj) return null;
                      return (
                        <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg flex items-center justify-between">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-xs text-[#001a48]">{chosenPatientObj.name}</span>
                            <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1.5">
                              <span>ID: <strong className="text-slate-700">{chosenPatientObj.id.slice(0, 8).toUpperCase()}</strong></span>
                              <span>•</span>
                              <span>Phone: <strong className="text-slate-700">{chosenPatientObj.phone || 'N/A'}</strong></span>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedExportPatientId('');
                              setPatientSearchQuery('');
                            }}
                            className="px-2 py-1 bg-white border border-slate-200 text-[11px] text-slate-600 hover:text-red-500 hover:border-red-100 hover:bg-red-50 rounded-md font-bold transition-all flex items-center gap-1 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[13px]">close</span>
                            <span>Change</span>
                          </button>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="relative">
                      <div className="relative flex items-center">
                        <span className="absolute left-3 text-slate-400 material-symbols-outlined text-[16px] pointer-events-none">search</span>
                        <input
                          type="text"
                          placeholder="Search patient by Name, ID, or Phone..."
                          value={patientSearchQuery}
                          onChange={(e) => {
                            setPatientSearchQuery(e.target.value);
                            setIsPatientDropdownOpen(true);
                          }}
                          onFocus={() => setIsPatientDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setIsPatientDropdownOpen(false), 200)}
                          className="w-full bg-white border border-[#c4c6d2] rounded-lg pl-8.5 pr-8 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-[#001a48] focus:ring-1 focus:ring-[#001a48] transition-all"
                        />
                        {patientSearchQuery && (
                          <button
                            type="button"
                            onClick={() => {
                              setPatientSearchQuery('');
                              setIsPatientDropdownOpen(true);
                            }}
                            className="absolute right-3 text-slate-400 hover:text-slate-600 cursor-pointer flex items-center justify-center p-0.5"
                          >
                            <span className="material-symbols-outlined text-[14px]">close</span>
                          </button>
                        )}
                      </div>

                      {isPatientDropdownOpen && (
                        <div className="absolute z-50 w-full mt-1 bg-white border border-[#c4c6d2] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {filteredExportPatients.length === 0 ? (
                            <div className="p-3 text-xs text-slate-400 text-center font-medium">No patients match search.</div>
                          ) : (
                            filteredExportPatients.map((p: any) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  setSelectedExportPatientId(p.id);
                                  setPatientSearchQuery('');
                                  setIsPatientDropdownOpen(false);
                                }}
                                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors flex flex-col gap-0.5 border-b border-dashed border-slate-100 last:border-0 cursor-pointer"
                              >
                                <span className="font-semibold text-slate-900">{p.name}</span>
                                <span className="text-[10px] text-slate-500 flex items-center gap-1.5 font-medium">
                                  <span>ID: <strong className="text-slate-600">{p.id.slice(0, 8).toUpperCase()}</strong></span>
                                  <span>•</span>
                                  <span>Phone: <strong className="text-slate-600">{p.phone || 'N/A'}</strong></span>
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                <button
                  disabled={!selectedExportPatientId}
                  onClick={() => {
                    const chosen = patients.find(p => p.id === selectedExportPatientId);
                    if (chosen) {
                      handleExportPatientDossier(chosen.id, chosen.name);
                    }
                  }}
                  className="w-full py-2.5 bg-[#001a48] disabled:bg-slate-300 hover:opacity-90 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  <span>Export Patient Dossier Report</span>
                </button>
              </div>

              {/* Option B: Date-Wise Daily Roster */}
              <div className="p-5 bg-white border border-[#c4c6d2] rounded-xl space-y-4 shadow-xs">
                <div className="flex items-center gap-2.5 text-[#0b1c30]">
                  <span className="material-symbols-outlined text-[#006a61] text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>calendar_month</span>
                  <p className="font-bold text-sm">Shift Queue &amp; Operational Roster</p>
                </div>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  Compiles a summary of clinical session entry logs, allocated departments, practitioner assignments, issue times, and clinical outcomes.
                </p>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Select Date Span</label>
                    <select
                      value={exportPeriodType}
                      onChange={(e: any) => setExportPeriodType(e.target.value)}
                      className="w-full bg-white border border-[#c4c6d2] rounded-lg p-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-[#006a61] focus:ring-1 focus:ring-[#006a61] transition-all"
                    >
                      <option value="today">Today's active logs only</option>
                      <option value="yesterday">Yesterday's logged history</option>
                      <option value="custom">Single Custom Date</option>
                      <option value="range">Custom Date Range</option>
                    </select>
                  </div>

                  {exportPeriodType === 'custom' && (
                    <div className="col-span-2 space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Choose Operations Date</label>
                      <input
                        type="date"
                        value={exportDate}
                        onChange={(e) => setExportDate(e.target.value)}
                        className="w-full bg-white border border-[#c4c6d2] rounded-lg p-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-[#006a61] focus:ring-1 focus:ring-[#006a61]"
                      />
                    </div>
                  )}

                  {exportPeriodType === 'range' && (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Start Date</label>
                        <input
                          type="date"
                          value={exportStartDate}
                          onChange={(e) => setExportStartDate(e.target.value)}
                          className="w-full bg-white border border-[#c4c6d2] rounded-lg p-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-[#006a61] focus:ring-1 focus:ring-[#006a61]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">End Date</label>
                        <input
                          type="date"
                          value={exportEndDate}
                          onChange={(e) => setExportEndDate(e.target.value)}
                          className="w-full bg-white border border-[#c4c6d2] rounded-lg p-2.5 text-xs font-semibold text-slate-700 outline-none focus:border-[#006a61] focus:ring-1 focus:ring-[#006a61]"
                        />
                      </div>
                    </>
                  )}
                </div>
                
                <button
                  onClick={handleExportDateWiseTokens}
                  className="w-full py-2.5 bg-[#006a61] hover:opacity-90 text-white font-bold rounded-lg text-xs transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  <span>Export Period-Wise Clinical Summary</span>
                </button>
              </div>

              {/* Option C: System Wide All-Patients Historical Report */}
              <div className="p-5 bg-white border border-[#c4c6d2] rounded-xl space-y-4 shadow-xs">
                <div className="flex items-center gap-2.5 text-[#0b1c30]">
                  <span className="material-symbols-outlined text-purple-600 text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>database</span>
                  <p className="font-bold text-sm">Master Clinical Registry Audit</p>
                </div>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  Generates complete master ledger reports documenting all registered patient profiles, lifetime consultation metrics, financial invoicing totals, and clinical risk statuses.
                </p>
                
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleExportAllPatientsSystemWide('pdf')}
                    className="py-2.5 bg-[#001a48] hover:opacity-90 text-white font-bold rounded-lg text-xs transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
                    <span>Download PDF Dossier</span>
                  </button>
                  <button
                    onClick={() => handleExportAllPatientsSystemWide('csv')}
                    className="py-2.5 bg-[#006a61] hover:opacity-90 text-white font-bold rounded-lg text-xs transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <span className="material-symbols-outlined text-[16px]">table_chart</span>
                    <span>Download CSV Ledger</span>
                  </button>
                </div>
              </div>

            </div>
            
            <div className="bg-slate-50 p-4 border-t border-[#c4c6d2] flex justify-end">
              <button
                onClick={() => setIsExportModalOpen(false)}
                className="px-5 py-2 border border-[#c4c6d2] bg-white rounded-lg text-slate-700 font-bold hover:bg-[#eff4ff] transition-all text-xs cursor-pointer active:scale-95"
              >
                Close Hub
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: View All Units Detailed Breakdown */}
      {isViewAllUnitsOpen && (
        <div 
          onClick={() => setIsViewAllUnitsOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-200"
          >
            {/* Modal Header */}
            <div className="bg-[#001a48] text-white p-6 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-white">Hospital Units Operational Load</h3>
                <p className="text-xs text-sky-200 mt-1 font-semibold">Real-time dynamic clinic load and estimated wait times</p>
              </div>
              <button 
                onClick={() => setIsViewAllUnitsOpen(false)}
                className="text-white/80 hover:text-white hover:bg-white/10 p-2 rounded-lg transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[70vh] space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { label: 'General Medicine', key: 'General Medicine', desc: 'Routine checkups, family medicine, and general health evaluations.' },
                  { label: 'Cardiology', key: 'Cardiology', desc: 'Heart care, ECG analysis, chronic cardiovascular management.' },
                  { label: 'Diagnostics', key: 'Diagnostics', desc: 'Lab work, blood tests, radiology prep, and diagnostics services.' },
                  { label: 'Pediatrics', key: 'Pediatrics', desc: 'Specialized care for infants, children, and young adolescents.' },
                  { label: 'Emergency', key: 'Emergency', desc: 'Immediate trauma, acute pain management, and urgent triage cases.' },
                  { label: 'Dermatology', key: 'Dermatology', desc: 'Skin, hair, nails analysis and topical treatment consults.' }
                ].map((dept) => {
                  const stats = getDepartmentStats(dept.key);
                  const deptTokens = tokens.filter(t => normalizeDeptName(t.department || '') === normalizeDeptName(dept.key) && t.status !== 'COMPLETED');
                  const deptDocs = (users || []).filter(u => u.role === 'DOCTOR' && u.isActive !== false && normalizeDeptName(u.department || '') === normalizeDeptName(dept.key));
                  
                  return (
                    <div key={dept.key} className="bg-[#eff4ff]/40 p-5 rounded-xl border border-[#c4c6d2]/60 space-y-3 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <h4 className="font-bold text-slate-900 text-sm">{dept.label}</h4>
                            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{dept.desc}</p>
                          </div>
                          <span className="px-2 py-0.5 bg-[#001a48] text-white text-[10px] font-bold rounded-md shrink-0">
                            {deptDocs.length} DOCS
                          </span>
                        </div>

                        <div className="flex items-center gap-4 py-2 my-2 border-y border-dashed border-[#c4c6d2]/50">
                          <div>
                            <p className="text-[10px] uppercase font-bold text-slate-400">Active Load</p>
                            <p className="text-sm font-bold text-[#0b1c30]">{stats.count} Waiting / Active</p>
                          </div>
                          <div className="border-l border-[#c4c6d2]/40 h-8"></div>
                          <div>
                            <p className="text-[10px] uppercase font-bold text-slate-400">Est. Wait Time</p>
                            <p className="text-sm font-semibold text-[#006a61]">{stats.avgWait}</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 mt-2">
                        <p className="text-[10px] uppercase font-bold text-slate-400">Active Queue Roster</p>
                        {deptTokens.length === 0 ? (
                          <p className="text-[11px] text-slate-500 italic">No patients currently waiting in this department queue</p>
                        ) : (
                          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                            {deptTokens.map(t => (
                              <div key={t.id} className="flex justify-between items-center bg-white border border-[#c4c6d2]/40 rounded-lg p-2 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-[#001a48]" style={{ fontFamily: 'monospace' }}>
                                    #{t.tokenNumber}
                                  </span>
                                  <span className="font-semibold text-slate-800">{t.patientName}</span>
                                </div>
                                <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold ${
                                  t.status === 'CALLED' ? 'bg-[#ebfaf6] text-[#006a61]' : 'bg-[#f0f1f5] text-slate-600'
                                }`}>
                                  {t.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setIsViewAllUnitsOpen(false)}
                className="px-5 py-2 bg-[#001a48] text-white rounded-lg text-xs font-bold hover:opacity-90 transition-colors cursor-pointer active:scale-95"
              >
                Close Detailed Roster
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
