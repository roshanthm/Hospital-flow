/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useStore, authFetch } from '@/src/store/useStore';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { generateTokenPDF } from '@/src/lib/pdfUtils';
import { 
  Search, Phone, User, Stethoscope, 
  Clock, CheckCircle2, X, Printer, Info, UserPlus
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface GenerateTokenModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GenerateTokenModal({ isOpen, onClose }: GenerateTokenModalProps) {
  const navigate = useNavigate();
  const users = useStore(state => state.users);
  const tokens = useStore(state => state.tokens);
  const fetchUsers = useStore(state => state.fetchUsers);
  const fetchTokens = useStore(state => state.fetchTokens);
  const addAppointment = useStore(state => state.addAppointment);
  const addActivityLog = useStore(state => state.addActivityLog);

  const [step, setStep] = useState<'INPUT' | 'SUCCESS'>('INPUT');
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<'Cardiology' | 'General Med' | 'Pediatrics' | 'Dermatology'>('General Med');
  const [selectedPriority, setSelectedPriority] = useState<'Low' | 'Medium' | 'High' | 'Urgent' | 'Emergency'>('Medium');
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [issuedToken, setIssuedToken] = useState<any>(null);

  const [searchedPatients, setSearchedPatients] = useState<any[]>([]);
  const [recentPatients, setRecentPatients] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Load backend data
  useEffect(() => {
    if (isOpen) {
      // Async load only the top 4 recently registered patients to populate fast start lookup
      (async () => {
        try {
          const res = await authFetch('/api/patients?page=1&limit=4');
          if (res.ok) {
            const body = await res.json();
            setRecentPatients(body?.data || []);
          }
        } catch (e) {
          console.error("Failed to fetch recent patients for autocomplete:", e);
        }
      })();

      fetchUsers();
      fetchTokens();
      // Initialize states when opening
      setStep('INPUT');
      setPatientSearchQuery('');
      setSelectedPatient(null);
      setSelectedDepartment('General Med');
      setSelectedPriority('Medium');
      
      const activeDocs = (users || []).filter(u => u.role === 'DOCTOR' && u.isActive !== false);
      setSelectedDoctorId(activeDocs[0]?.id || '');

      setIssuedToken(null);
      setSearchedPatients([]);
      setIsSearching(false);
    }
  }, [isOpen]);

  // Run patient search on the live database dynamically with a 150ms debounce
  useEffect(() => {
    let active = true;
    const query = patientSearchQuery.trim();

    if (!query) {
      setSearchedPatients([]);
      setIsSearching(false);
      return;
    }

    const performSearch = async () => {
      setIsSearching(true);
      try {
        const res = await authFetch(`/api/patients?search=${encodeURIComponent(query)}`);
        if (res.ok && active) {
          const data = await res.json();
          setSearchedPatients(data);
        }
      } catch (err) {
        console.error('Failed to search patients on backend:', err);
      } finally {
        if (active) {
          setIsSearching(false);
        }
      }
    };

    const delayDebounceFn = setTimeout(() => {
      performSearch();
    }, 150);

    return () => {
      active = false;
      clearTimeout(delayDebounceFn);
    };
  }, [patientSearchQuery]);

  // Handle auto-selection of doctor when a department is chosen
  const activeDoctors = React.useMemo(() => {
    return (users || []).filter(u => u.role === 'DOCTOR' && u.isActive !== false);
  }, [users]);
  const isAnyDoctorOnDuty = (users || []).some(u => u.role === 'DOCTOR' && u.isActive !== false && (u.dutyStatus === 'ON DUTY' || u.dutyStatus === 'ON_DUTY'));

  // Automatically derive and sync department from selected doctor
  useEffect(() => {
    const chosenDoc = activeDoctors.find(d => d.id === selectedDoctorId);
    if (chosenDoc) {
      setSelectedDepartment((chosenDoc.department || 'General Medicine') as any);
    }
  }, [selectedDoctorId, activeDoctors]);

  useEffect(() => {
    if (activeDoctors.length > 0 && (!selectedDoctorId || !activeDoctors.some(d => d.id === selectedDoctorId))) {
      setSelectedDoctorId(activeDoctors[0].id);
    }
  }, [users, activeDoctors, selectedDoctorId]);

  // Find any previously selected/assigned doctor for the selected patient
  const getPreviousDoctorId = () => {
    if (!selectedPatient) return '';
    
    // Parse from medical history note
    const docMatch = selectedPatient.medicalHistory?.match(/Assigned Doctor:\s*([a-zA-Z0-9-]+)/);
    if (docMatch && docMatch[1]) {
      return docMatch[1];
    }
    
    // Fallback to latest token
    const lastToken = [...(tokens || [])]
      .filter(t => t.patientId === selectedPatient.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    return lastToken ? lastToken.doctorId : '';
  };

  const getDoctorsInDepartment = (dept: string) => {
    return activeDoctors.filter(d => {
      const lowerDept = d.department?.toLowerCase() || '';
      if (dept === 'Cardiology') return lowerDept.includes('cardio');
      if (dept === 'General Med') return lowerDept.includes('general') || lowerDept.includes('med');
      if (dept === 'Pediatrics') return lowerDept.includes('pediatric');
      if (dept === 'Dermatology') return lowerDept.includes('derm');
      return false;
    });
  };

  const getDoctorsForDropdown = () => {
    return [...activeDoctors].sort((a, b) => {
      const aOn = a.dutyStatus === 'ON DUTY' || a.dutyStatus === 'ON_DUTY';
      const bOn = b.dutyStatus === 'ON DUTY' || b.dutyStatus === 'ON_DUTY';
      if (aOn && !bOn) return -1;
      if (!aOn && bOn) return 1;
      return a.name.localeCompare(b.name);
    });
  };

  const getDoctorLoad = (doctorId: string) => {
    const list = tokens || [];
    const waiting = list.filter(t => t.doctorId === doctorId && t.status === 'WAITING').length;
    const active = list.filter(t => t.doctorId === doctorId && t.status === 'IN_CONSULTATION').length;
    return { waiting, active };
  };

  const normalizeDept = (deptStr: string) => {
    const lower = deptStr.toLowerCase();
    if (lower.includes('cardio')) return 'Cardiology';
    if (lower.includes('general') || lower.includes('med')) return 'General Med';
    if (lower.includes('pediatric')) return 'Pediatrics';
    if (lower.includes('derm')) return 'Dermatology';
    return null;
  };

  // Run patient search on the client when not empty, fallback to typed results
  const searchResults = searchedPatients;

  // Handle selecting a patient
  const handleSelectPatient = (patient: any) => {
    setSelectedPatient(patient);
    setPatientSearchQuery('');
    
    // Auto-detect preference from medicalHistory registration details
    let preferredDoctorId = '';
    let preferredDept = '';

    if (patient.medicalHistory) {
      const docMatch = patient.medicalHistory.match(/Assigned Doctor:\s*([a-zA-Z0-9-]+)/);
      preferredDoctorId = docMatch ? docMatch[1] : '';
      const deptMatch = patient.medicalHistory.match(/Department:\s*([a-zA-Z0-9_\s]+)/);
      preferredDept = deptMatch ? deptMatch[1].trim() : '';
    }

    if (!preferredDoctorId) {
      const lastToken = [...(tokens || [])]
        .filter(t => t.patientId === patient.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      if (lastToken) {
        preferredDoctorId = lastToken.doctorId;
        const lastDoc = users.find(u => u.id === preferredDoctorId);
        if (lastDoc?.department) {
          preferredDept = lastDoc.department;
        }
      }
    }

    const normalizedDept = preferredDept ? normalizeDept(preferredDept) : null;
    if (normalizedDept) {
      setSelectedDepartment(normalizedDept);
    }

    const isDocAvailable = activeDoctors.some(d => d.id === preferredDoctorId);
    if (isDocAvailable) {
      setSelectedDoctorId(preferredDoctorId);
    } else {
      const deptDocs = getDoctorsInDepartment(normalizedDept || selectedDepartment);
      if (deptDocs.length > 0) {
        setSelectedDoctorId(deptDocs[0].id);
      } else {
        setSelectedDoctorId('');
      }
    }
  };

  const handlePrintSuccessSlip = (slip: any) => {
    if (!slip) return;
    generateTokenPDF({
      tokenNumber: slip.tokenNumber,
      patientName: slip.patientName,
      patientId: slip.patientId || 'N/A',
      phone: slip.phone || 'N/A',
      doctorName: slip.doctorName || 'Staff Physician',
      department: slip.department || 'General Med',
      priority: slip.priority || 'Standard',
      createdAt: slip.createdAt || new Date()
    });
    toast.success(`Downloading high-fidelity queue slip PDF for ${slip.tokenNumber}...`);
  };

  const handlePreviewToken = () => {
    if (!selectedPatient) {
      toast.error('Please select a patient first to preview.');
      return;
    }
    const chosenDoc = activeDoctors.find(d => d.id === selectedDoctorId);
    toast.info(`Spooling preview ticket: ${selectedDepartment.toUpperCase()} Queue - ${selectedPatient.name} (${chosenDoc?.name || 'Assigned Physician'}) Priority: ${selectedPriority}`);
  };

  const handleGenerate = async () => {
    if (!selectedPatient) {
      toast.error('Please select or search a patient first.');
      return;
    }
    if (!selectedDoctorId) {
      toast.error('Please select an available doctor for assignment.');
      return;
    }

    try {
      const response = await addAppointment({
        patientId: selectedPatient.id,
        doctorId: selectedDoctorId,
        priority: selectedPriority,
        date: new Date().toISOString().split('T')[0],
        time: new Date().toTimeString().slice(0, 5)
      });

      const tokenNumber = response.token?.tokenNumber || 'A-' + Math.floor(1000 + Math.random() * 9000);
      const chosenDoc = activeDoctors.find(d => d.id === selectedDoctorId);

      addActivityLog({
        id: Math.random().toString(36).substring(7),
        action: 'Appointment & Token Generated',
        user: 'Reception',
        timestamp: new Date().toISOString(),
        details: `Token ${tokenNumber} issued dynamically for ${selectedPatient.name} with Dr. ${chosenDoc?.name || 'Staff'}.`,
      });

      const deptLabel = chosenDoc?.department || selectedDepartment;
      const slipData = {
        tokenNumber,
        patientName: selectedPatient.name,
        patientId: selectedPatient.id,
        department: deptLabel,
        doctorName: chosenDoc?.name || 'Unknown Doctor',
        priority: selectedPriority,
        dateTime: new Date().toLocaleString()
      };

      setIssuedToken(slipData);
      setStep('SUCCESS');
      toast.success(`Success! Token ${tokenNumber} issued successfully`);
      
      // Sync local roster cache
      fetchTokens();

      // Trigger slip printing
      setTimeout(() => {
        handlePrintSuccessSlip(slipData);
      }, 300);

    } catch (e: any) {
      toast.error(e.message || 'Failed to generate token. Please try again.');
    }
  };

  const handleRegisterRedirect = () => {
    onClose();
    navigate('/reception/register');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-[#0b1c30]/40 backdrop-blur-sm">
      <div 
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative w-full max-w-4xl bg-white border border-[#c4c6d2] rounded-3xl shadow-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200 flex flex-col my-8">
        
        {/* Modal Header */}
        <header className="px-8 py-5 flex justify-between items-start border-b border-[#c4c6d2] bg-[#eff4ff]/50">
          <div>
            <h1 className="text-[24px] leading-[32px] font-bold text-[#001a48]">Generate New Token</h1>
            <p className="text-[13px] leading-[18px] text-slate-500 mt-0.5">
              Assign a consultation queue token after locating or verifying the patient registry entry.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 p-2 rounded-full transition-all active:scale-95"
          >
            <X size={20} />
          </button>
        </header>

        {step === 'INPUT' ? (
          <>
            {/* Modal Body */}
            <div className="p-8 space-y-8 overflow-y-auto max-h-[calc(100vh-220px)] scrollbar-thin">
              
              {/* 1. Patient Identification */}
              <section className="space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-[18px] leading-[24px] font-bold flex items-center gap-2 text-[#0b1c30]">
                    <span className="text-[#001a48] font-black">1.</span> Patient Identification
                  </h2>
                  <button 
                    type="button"
                    onClick={handleRegisterRedirect}
                    className="flex items-center gap-1.5 text-[#002d72] hover:text-[#001a48] text-xs hover:underline font-bold"
                  >
                    <UserPlus size={14} />
                    Register New Patient
                  </button>
                </div>

                {!selectedPatient ? (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input
                        value={patientSearchQuery}
                        onChange={(e) => setPatientSearchQuery(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 bg-[#eff4ff]/60 border border-[#c4c6d2] rounded-xl focus:ring-2 focus:ring-[#002d72]/15 focus:border-[#002d72] outline-none transition-all text-sm font-medium text-slate-800 placeholder-slate-400"
                        placeholder="Search standard patient registry by name, phone, or Patient ID..."
                        type="text"
                      />
                    </div>

                    {/* Results Container */}
                    {patientSearchQuery.trim() !== '' && (
                      <div className="border border-[#c4c6d2] bg-white rounded-xl shadow-lg p-2 max-h-60 overflow-y-auto space-y-1 z-20">
                        {isSearching ? (
                          <div className="px-4 py-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
                            <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-300 border-t-slate-650 rounded-full" />
                            <span>Searching live database...</span>
                          </div>
                        ) : searchResults.length > 0 ? (
                          <>
                            <p className="text-[11px] font-bold text-slate-400 px-3 py-1 uppercase tracking-wider">
                              Found {searchResults.length} matching registration files
                            </p>
                            {searchResults.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => handleSelectPatient(p)}
                                className="w-full text-left px-4 py-3 hover:bg-[#eff4ff] rounded-xl transition-all flex items-center justify-between group border border-transparent hover:border-[#002d72]/10"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-9 h-9 rounded-full bg-[#001a48]/10 text-[#001a48] flex items-center justify-center font-bold text-sm">
                                    {p.name.charAt(0)}
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-bold text-slate-800 group-hover:text-[#002d72]">{p.name}</h4>
                                    <p className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-0.5">
                                      <Phone size={12} className="text-slate-400" /> {p.phone}
                                      <span className="text-slate-300">|</span>
                                      <span>{p.age} yrs • {p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : 'Other'}</span>
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <span className="text-[10px] font-bold text-[#002d72] bg-[#eff4ff] px-2.5 py-1 rounded-full border border-blue-100 group-hover:bg-[#002d72] group-hover:text-white transition-colors">
                                    ID: {p.id.toUpperCase()}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </>
                        ) : (
                          <div className="px-4 py-6 text-center text-slate-400 text-sm">
                            No patient profiles matched your query.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Quick Access List when Search is Empty */}
                    {patientSearchQuery.trim() === '' && recentPatients && recentPatients.length > 0 && (
                      <div className="pt-2">
                        <p className="text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-wide">
                          Recently Registered Patients:
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {recentPatients.slice(0, 4).map((p: any) => (
                            <div 
                              key={p.id}
                              onClick={() => handleSelectPatient(p)}
                              className="p-3 bg-[#eff4ff]/20 hover:bg-[#eff4ff]/60 border border-[#c4c6d2] hover:border-[#002d72]/30 rounded-xl cursor-pointer transition-all flex items-center justify-between"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-[#002d72]/10 text-[#002d72] flex items-center justify-center font-bold text-xs shrink-0">
                                  {p.name.charAt(0)}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-700 truncate">{p.name}</p>
                                  <p className="text-[10px] text-slate-500 font-medium truncate flex items-center gap-1 mt-0.5">
                                    <Phone size={10} /> {p.phone}
                                  </p>
                                </div>
                              </div>
                              <span className="text-[9px] font-black bg-white text-[#002d72] border border-[#c4c6d2] px-2 py-0.5 rounded-full shrink-0">
                                {p.id.slice(0, 6).toUpperCase()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 bg-emerald-600 text-white rounded-full flex items-center justify-center font-bold text-base shadow-sm">
                        {selectedPatient.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-800 text-sm">{selectedPatient.name}</h4>
                          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-200">
                            ID: {selectedPatient.id.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-0.5">
                          <Phone size={12} className="text-slate-400" /> {selectedPatient.phone}
                          <span className="text-slate-300">|</span>
                          <span>{selectedPatient.age} yrs • {selectedPatient.gender === 'M' ? 'Male' : selectedPatient.gender === 'F' ? 'Female' : 'Other'}</span>
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedPatient(null)}
                      className="text-xs font-bold text-slate-500 hover:text-error bg-white hover:bg-red-50 border border-[#c4c6d2] hover:border-red-200 px-3 py-1.5 rounded-lg transition-all"
                    >
                      Change Patient
                    </button>
                  </div>
                )}
              </section>

              {/* Grid Content Columns for Select Department, Priority AND Physician */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
                
                {/* 1. Select Available Doctor */}
                <section className="space-y-4">
                  <h2 className="text-[18px] leading-[24px] font-bold flex items-center gap-2 text-[#0b1c30]">
                    <span className="text-[#001a48] font-black">1.</span> Assigned Doctor
                  </h2>
                  <div className="space-y-3">
                    <div className="relative">
                      <Stethoscope className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <select 
                        required
                        className={`w-full pl-10 pr-4 py-3 bg-white border ${
                          activeDoctors.length === 0 ? 'border-[#ba1a1a] bg-red-50/10' : 'border-[#c4c6d2]'
                        } rounded-xl text-sm focus:ring-2 focus:ring-[#002d72] outline-none text-slate-800 font-bold`}
                        value={selectedDoctorId}
                        onChange={(e) => {
                          const docId = e.target.value;
                          setSelectedDoctorId(docId);
                        }}
                      >
                        {activeDoctors.length === 0 ? (
                          <option value="">No doctors available</option>
                        ) : (
                          <>
                            <option value="">-- No Doctor Assigned --</option>
                            {getDoctorsForDropdown().map((d) => {
                              const isDocOnDuty = d.dutyStatus === 'ON DUTY' || d.dutyStatus === 'ON_DUTY';
                              const statusDot = isDocOnDuty ? '🟢' : '⚫';
                              const rawName = d.name.toLowerCase().startsWith('dr') ? d.name : `Dr. ${d.name}`;
                              const deptName = d.department || 'General Medicine';
                              return (
                                <option key={d.id} value={d.id}>
                                  {statusDot} {rawName} ({deptName}) - {isDocOnDuty ? 'ON DUTY' : 'OFF DUTY'}
                                </option>
                              );
                            })}
                          </>
                        )}
                      </select>
                    </div>

                    {(() => {
                      const selectedDoc = activeDoctors.find(d => d.id === selectedDoctorId);
                      const isSelectedDocOffDuty = selectedDoc && !(selectedDoc.dutyStatus === 'ON DUTY' || selectedDoc.dutyStatus === 'ON_DUTY');
                      if (isSelectedDocOffDuty) {
                        return (
                          <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl flex items-center gap-2 text-xs text-amber-800 font-bold">
                            <span className="material-symbols-outlined text-[18px]">warning</span>
                            <span>Selected Doctor is currently OFF DUTY.</span>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {!isAnyDoctorOnDuty ? (
                      <div className="p-4 bg-red-50 border border-[#ba1a1a]/30 rounded-xl flex items-center gap-2.5 text-xs text-[#ba1a1a] font-bold">
                        <span className="material-symbols-outlined text-[18px]">warning</span>
                        <span>No doctors are currently on duty. Please contact administration.</span>
                      </div>
                    ) : (
                      <p className="text-[11px] text-[#006a61] font-bold ml-1">
                        Select any registered clinical staff doctor. Real-time duty statuses are indicated.
                      </p>
                    )}
                  </div>

                  {/* Priority Level */}
                  <div className="pt-2">
                    <h2 className="text-[16px] leading-[22px] font-bold flex items-center gap-2 text-[#0b1c30] mb-3">
                      Priority Level
                    </h2>
                    <div className="grid grid-cols-2 gap-2.5">
                      {[
                        { id: 'Low', label: 'Low', color: 'bg-[#006a61]' },
                        { id: 'Medium', label: 'Medium', color: 'bg-[#002d72]' },
                        { id: 'High', label: 'High', color: 'bg-[#ba1a1a]' },
                        { id: 'Urgent', label: 'Urgent', color: 'bg-[#ea580c]' },
                        { id: 'Emergency', label: 'Emergency', color: 'bg-red-600' }
                      ].map((prio) => {
                        const isSelected = selectedPriority === prio.id;
                        return (
                          <div
                            key={prio.id}
                            onClick={() => setSelectedPriority(prio.id as any)}
                            className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all hover:scale-[1.01] active:scale-95 ${
                              isSelected
                                ? prio.id === 'Emergency' || prio.id === 'Urgent' || prio.id === 'High'
                                  ? 'border-2 border-red-500 bg-red-50/50'
                                  : 'border-2 border-[#001a48] bg-[#eff4ff]'
                                : 'border border-[#c4c6d2] hover:bg-[#eff4ff]/20'
                            }`}
                          >
                            <span className={`text-xs font-bold ${
                              isSelected ? 'text-[#001a48]' : 'text-slate-600'
                            }`}>
                              {prio.label}
                            </span>
                            <div className={`w-2 h-2 rounded-full ${prio.color} ${prio.id === 'Emergency' ? 'animate-pulse' : ''}`} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                {/* 2. Automatically Derived Department */}
                <section className="space-y-4">
                  <h2 className="text-[18px] leading-[24px] font-bold flex items-center gap-2 text-[#0b1c30]">
                    <span className="text-[#001a48] font-black">2.</span> Derived Department
                  </h2>
                  <div className="p-6 rounded-2xl bg-[#eff4ff] border-2 border-[#001a48] flex items-center gap-4 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-[#001a48]/5 rounded-full -mr-12 -mt-12 blur-xl pointer-events-none" />
                    <div className="w-12 h-12 rounded-2xl bg-[#001a48] text-white flex items-center justify-center shrink-0 shadow-sm">
                      <span className="material-symbols-outlined text-[24px]">
                        {(() => {
                          const lower = selectedDepartment.toLowerCase();
                          if (lower.includes('cardio')) return 'favorite';
                          if (lower.includes('pedi')) return 'child_care';
                          if (lower.includes('derm')) return 'vaccines';
                          if (lower.includes('emerg')) return 'emergency';
                          return 'medical_services';
                        })()}
                      </span>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#001a48]/70 font-bold uppercase tracking-wider">Clinical Department (Read-Only)</p>
                      <h3 className="text-xl font-black text-[#001a48] mt-0.5">{selectedDoctorId ? selectedDepartment : 'Select a doctor...'}</h3>
                      <p className="text-[11px] text-slate-500 mt-1 italic">Automatically mapped from staff credentials</p>
                    </div>
                  </div>

                  <div className="p-4 bg-white border border-[#c4c6d2] rounded-xl flex gap-2.5 items-start mt-4">
                    <span className="material-symbols-outlined text-[#006a61] mt-0.5">verified_user</span>
                    <div className="text-xs">
                      <p className="font-bold text-slate-800">Mismatch Prevention Mode Active</p>
                      <p className="text-slate-500 mt-0.5 leading-relaxed">Selecting a doctor automatically assigns the correct, verified medical department record from the database registry.</p>
                    </div>
                  </div>
                </section>

              </div>

              {/* Info Box */}
              <div className="p-4 bg-[#eff4ff] border border-blue-100 rounded-xl flex gap-3">
                <Info size={18} className="text-[#002d72] mt-0.5 shrink-0" />
                <p className="text-[13px] leading-[18px] text-slate-600">
                  Current department load estimation indicates <span className="font-bold text-[#001a48]">{selectedDepartment}</span> is active with competent physicians. Wait roster times will adjust automatically as tokens get cleared.
                </p>
              </div>

            </div>

            {/* Modal Footer */}
            <footer className="px-8 py-5 bg-[#eff4ff]/50 border-t border-[#c4c6d2] flex justify-between items-center bg-[#eff4ff]/30">
              <button 
                type="button"
                onClick={onClose}
                className="text-[#001a48] font-bold hover:underline text-sm"
              >
                Cancel
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handlePreviewToken}
                  disabled={activeDoctors.length === 0 || !isAnyDoctorOnDuty}
                  className={`px-5 py-2.5 rounded-xl border border-[#001a48] text-[#001a48] font-bold text-sm hover:bg-[#dce9ff] transition-all flex items-center justify-center gap-1.5 active:scale-95 ${
                    (activeDoctors.length === 0 || !isAnyDoctorOnDuty) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  <Printer size={16} />
                  Preview
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={activeDoctors.length === 0 || !isAnyDoctorOnDuty}
                  className={`px-5 py-2.5 rounded-xl bg-[#001a48] hover:bg-[#002d72] text-white font-bold text-sm transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 ${
                    (activeDoctors.length === 0 || !isAnyDoctorOnDuty) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  <CheckCircle2 size={16} />
                  Generate Token
                </button>
              </div>
            </footer>
          </>
        ) : (
          /* SUCCESS SCREEN with Issued Token details */
          <div className="p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm border border-emerald-100">
              <CheckCircle2 size={32} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-800">Token Generated Successfully!</h3>
              <p className="text-slate-500 text-sm mt-1">Direct the patient to the respective waiting room. The slip is printing.</p>
            </div>

            {issuedToken && (
              <div className="bg-slate-900 rounded-2xl p-6 text-white relative overflow-hidden max-w-sm mx-auto shadow-xl">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl" />
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 relative z-10">Assigned Token</p>
                <h2 className="text-4xl font-bold tracking-tighter mb-4 text-emerald-400 relative z-10">{issuedToken.tokenNumber}</h2>
                
                <div className="space-y-2 text-left pt-4 border-t border-white/10 relative z-10">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400 font-medium">Patient</span>
                    <span className="font-bold">{issuedToken.patientName}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400 font-medium">Physician</span>
                    <span className="font-bold">{issuedToken.doctorName}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 max-w-sm mx-auto pt-4">
              <button 
                type="button"
                onClick={() => handlePrintSuccessSlip(issuedToken)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer text-sm"
              >
                <Printer size={16} />
                Print Slip
              </button>
              <button 
                type="button"
                onClick={onClose}
                className="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-xl transition-all cursor-pointer text-sm"
              >
                Close Sheet
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
