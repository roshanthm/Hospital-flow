/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, authFetch } from '@/src/store/useStore';
import { toast } from 'sonner';

const calculateAge = (dobString: string): string => {
  if (!dobString) return '';
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age >= 0 ? String(age) : '';
};

export default function PatientRegistration() {
  const navigate = useNavigate();
  const patients = useStore(state => state.patients);
  const addPatient = useStore(state => state.addPatient);
  const users = useStore(state => state.users);
  const tokens = useStore(state => state.tokens);
  const addActivityLog = useStore(state => state.addActivityLog);
  const fetchPatients = useStore(state => state.fetchPatients);
  const fetchUsers = useStore(state => state.fetchUsers);
  const fetchTokens = useStore(state => state.fetchTokens);
  const logout = useStore(state => state.logout);
  const currentUser = useStore(state => state.currentUser);
  const addAppointment = useStore(state => state.addAppointment);

  const [step, setStep] = useState<1 | 2>(1);
  const [headerSearchTerm, setHeaderSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any>({ patients: [], tokens: [], consultations: [] });
  const [searchTimeout, setSearchTimeout] = useState<any>(null);

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
    setHeaderSearchTerm('');
    setSearchResults({ patients: [], tokens: [], consultations: [] });
    // Navigate back to dashboard with the filter loaded!
    navigate(`/reception?q=${encodeURIComponent(name)}`);
  };

  const handleSelectSearchToken = (tokenNumber: string) => {
    navigate(`/reception/tokens?q=${encodeURIComponent(tokenNumber)}`);
    setSearchResults({ patients: [], tokens: [], consultations: [] });
  };
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupPhone, setLookupPhone] = useState('');

  // Comprehensive Form State mapping medical details
  const [formData, setFormData] = useState({
    name: '',
    dateOfBirth: '',
    phone: '',
    email: '',
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    age: '',
    gender: 'M' as 'M' | 'F' | 'O',
    bloodGroup: 'O+',
    medicalHistory: '',
    department: 'GENERAL MEDICINE' as 'GENERAL MEDICINE' | 'CARDIOLOGY' | 'PEDIATRICS' | 'EMERGENCY' | 'DIAGNOSTICS',
    doctorId: '',
    priority: 'Medium' as 'Low' | 'Medium' | 'High' | 'Urgent',
    reasonForVisit: '',
    bloodPressure: '120/80',
    weight: '75.0',
    temperature: '36.6',
  });

  useEffect(() => {
    // Users and daily tokens are relevant to current session registration, loaded incrementally
    fetchUsers();
    fetchTokens();
  }, []);

  const getDeptDoctorsInRegistration = (deptKey: string) => {
    const activeDocs = (users || []).filter(u => u.role === 'DOCTOR' && u.isActive !== false);
    const list = activeDocs.filter(d => {
      const lowerDept = d.department?.toLowerCase() || '';
      const dk = deptKey.toLowerCase();
      if (dk.includes('cardio')) return lowerDept.includes('cardio');
      if (dk.includes('general') || dk.includes('med')) return lowerDept.includes('general') || lowerDept.includes('med');
      if (dk.includes('pediat')) return lowerDept.includes('pediat');
      if (dk.includes('emerg')) return lowerDept.includes('emerg');
      if (dk.includes('diag')) return lowerDept.includes('diag') || lowerDept.includes('derm');
      return false;
    });

    const prevDocId = formData.doctorId;
    if (prevDocId) {
      const hasPrevDoc = list.some(d => d.id === prevDocId);
      if (hasPrevDoc) {
        return [...list].sort((a, b) => {
          if (a.id === prevDocId) return -1;
          if (b.id === prevDocId) return 1;
          return 0;
        });
      } else {
        const prevDoc = activeDocs.find(d => d.id === prevDocId);
        if (prevDoc) {
          return [prevDoc, ...list];
        }
      }
    }
    return list;
  };

  const activeDoctorsInRegistration = React.useMemo(() => {
    return (users || [])
      .filter(u => u.role === 'DOCTOR' && u.isActive !== false)
      .sort((a, b) => {
        const aOn = a.dutyStatus === 'ON DUTY' || a.dutyStatus === 'ON_DUTY';
        const bOn = b.dutyStatus === 'ON DUTY' || b.dutyStatus === 'ON_DUTY';
        if (aOn && !bOn) return -1;
        if (!aOn && bOn) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [users]);

  const isAnyDoctorOnDuty = (users || []).some(u => u.role === 'DOCTOR' && u.isActive !== false && (u.dutyStatus === 'ON DUTY' || u.dutyStatus === 'ON_DUTY'));

  // Set and synchronize default doctor ID and automatically set derived department
  useEffect(() => {
    if (activeDoctorsInRegistration.length > 0) {
      const isCurrentValid = activeDoctorsInRegistration.some(d => d.id === formData.doctorId);
      const targetDoc = isCurrentValid 
        ? activeDoctorsInRegistration.find(d => d.id === formData.doctorId) 
        : activeDoctorsInRegistration[0];
      
      const newDoctorId = targetDoc?.id || '';
      const newDept = (targetDoc?.department || 'GENERAL MEDICINE').toUpperCase() as any;

      if (formData.doctorId !== newDoctorId || formData.department !== newDept) {
        setFormData(prev => ({ 
          ...prev, 
          doctorId: newDoctorId,
          department: newDept
        }));
      }
    } else {
      if (formData.doctorId !== '' || formData.department !== 'GENERAL MEDICINE') {
        setFormData(prev => ({
          ...prev,
          doctorId: '',
          department: 'GENERAL MEDICINE' as any
        }));
      }
    }
  }, [formData.doctorId, formData.department, activeDoctorsInRegistration]);

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Full Legal Name is required');
      return;
    }
    if (!formData.phone.trim()) {
      toast.error('Phone Number is required');
      return;
    }
    setStep(2);
    toast.success('Step 1 Validated. Navigating to Step 2: Clinical Assignment.');
  };

  const doctors = (users || []).filter(u => u.role === 'DOCTOR');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      // Build a comprehensive medical history note that embeds vitals and priority details
      const consolidatedNotes = `
Department: ${formData.department}
Assigned Doctor: ${formData.doctorId}
Priority: ${formData.priority}
Reason: ${formData.reasonForVisit}
Vitals - BP: ${formData.bloodPressure}, Weight: ${formData.weight}kg, Temp: ${formData.temperature}°C
Pathology history: ${formData.medicalHistory || 'None disclosed'}
Emergency Contact: ${formData.emergencyContactName} (${formData.emergencyContactPhone})
      `.trim();

      const newPatient = await addPatient({
        name: formData.name,
        age: parseInt(formData.age || '30'),
        dateOfBirth: formData.dateOfBirth ? new Date(formData.dateOfBirth).toISOString() : undefined,
        gender: formData.gender,
        phone: formData.phone,
        email: formData.email,
        address: formData.address || 'Address not provided',
        bloodGroup: formData.bloodGroup || 'O+',
        medicalHistory: consolidatedNotes,
        emergencyContactName: formData.emergencyContactName,
        emergencyContactPhone: formData.emergencyContactPhone,
        bloodPressure: formData.bloodPressure,
        weight: formData.weight,
        temperature: formData.temperature,
      });

      addActivityLog({
        id: Math.random().toString(36).substring(7),
        action: 'Patient Registered',
        user: 'Reception',
        timestamp: new Date().toISOString(),
        details: `${formData.name} was successfully registered inside patient directory.`,
      });

      toast.success(`Patient "${formData.name}" successfully registered inside patient directory!`);

      // Reset Form state
      setFormData({
        name: '',
        dateOfBirth: '',
        phone: '',
        email: '',
        address: '',
        emergencyContactName: '',
        emergencyContactPhone: '',
        age: '',
        gender: 'M',
        bloodGroup: 'O+',
        medicalHistory: '',
        department: 'GENERAL MEDICINE',
        doctorId: (users || []).filter(u => u.role === 'DOCTOR' && u.isActive !== false)[0]?.id || '',
        priority: 'Medium',
        reasonForVisit: '',
        bloodPressure: '120/80',
        weight: '75.0',
        temperature: '36.6',
      });
      setStep(1);
      fetchPatients();
    } catch (error: any) {
      if (error.message?.includes('already registered') || error.message?.includes('already exists')) {
        toast.error(error.message || 'A patient profile with this phone number is already registered.');
      } else {
        toast.error(error.message || 'Failed to submit registry file. Please verify parameters.');
      }
    }
  };

  // List of fallback mocked records for UI precision match
  const fallbackRecords = [
    { id: 'rec-1', name: 'Alice Moore', prefix: 'AM', color: 'bg-secondary-container text-on-secondary-container', lastVisit: '2 days ago', phone: '+1 (555) 102-4091' },
    { id: 'rec-2', name: 'Robert Harrison', prefix: 'RH', color: 'bg-error-container text-on-error-container', lastVisit: 'Oct 12, 2023', phone: '+1 (555) 902-8821' },
    { id: 'rec-3', name: 'Kathy Davis', prefix: 'KD', color: 'bg-surface-container-high text-primary', lastVisit: 'Jan 05, 2024', phone: '+1 (555) 431-1052' }
  ];

  const handleLookupSearch = async () => {
    const term = lookupQuery.trim() || lookupPhone.trim();
    if (!term) {
      toast.error('Please enter a name, phone, or ID to look up.');
      return;
    }
    const toastId = toast.loading('Searching patient registry...');
    try {
      const res = await authFetch(`/api/search?q=${encodeURIComponent(term)}`);
      if (res.ok) {
        const searchRes = await res.json();
        const matched = searchRes.patients?.[0];

        if (matched) {
          toast.dismiss(toastId);
          toast.success(`Found matched record: ${matched.name}`);
          
          const dateOfBirthFormatted = matched.dateOfBirth 
            ? new Date(matched.dateOfBirth).toISOString().split('T')[0] 
            : '';

          const getHistoryVal = (pattern: RegExp, defaultVal: string = '') => {
            if (!matched.medicalHistory) return defaultVal;
            const m = matched.medicalHistory.match(pattern);
            return m && m[1] ? m[1].trim() : defaultVal;
          };

          const extractedReason = getHistoryVal(/Reason:\s*([^\n]+)/i, '');
          const extractedBP = matched.bloodPressure || getHistoryVal(/BP:\s*([^\n,]+)/i, '120/80');
          let extractedWeight = matched.weight || getHistoryVal(/Weight:\s*([^\n,]+)/i, '75.0');
          if (extractedWeight && extractedWeight.endsWith('kg')) {
            extractedWeight = extractedWeight.slice(0, -2).trim();
          }
          let extractedTemp = matched.temperature || getHistoryVal(/Temp:\s*([^\n,]+)/i, '36.6');
          if (extractedTemp && extractedTemp.endsWith('°C')) {
            extractedTemp = extractedTemp.slice(0, -2).trim();
          }

          setFormData({
            ...formData,
            name: matched.name,
            dateOfBirth: dateOfBirthFormatted,
            phone: matched.phone,
            email: matched.email || '',
            address: matched.address || '',
            emergencyContactName: matched.emergencyContactName || getHistoryVal(/Emergency Contact:\s*([^(]+)/i, ''),
            emergencyContactPhone: matched.emergencyContactPhone || getHistoryVal(/Emergency Contact:\s*[^(]+\(([^)]+)\)/i, ''),
            age: String(matched.age || 30),
            gender: (matched.gender === 'F' || matched.gender === 'O' || matched.gender === 'M' ? matched.gender : 'M') as 'M' | 'F' | 'O',
            bloodGroup: matched.bloodGroup || 'O+',
            medicalHistory: matched.medicalHistory || '',
            reasonForVisit: extractedReason,
            bloodPressure: extractedBP,
            weight: extractedWeight,
            temperature: extractedTemp,
          });
          return;
        }
      }
      toast.dismiss(toastId);
      toast.info('No database match found list. Setting values as form templates.');
      if (lookupPhone) {
        setFormData(f => ({ ...f, phone: lookupPhone }));
      }
    } catch (err) {
      toast.dismiss(toastId);
      console.error(err);
      toast.error('Lookup search failed.');
    }
  };



  return (
    <div className="font-hanken bg-background text-on-surface min-h-screen relative overflow-x-hidden p-0 m-0">
      
      {/* Dynamic Style and Font injections */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');

        /* Bypass app container styles to enforce absolute pixel-perfect desktop layouts */
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

        .font-hanken {
          font-family: var(--hanken-font);
        }

        .material-symbols-outlined {
          font-family: 'Material Symbols Outlined';
          vertical-align: middle;
          display: inline-block;
          font-size: 24px;
          line-height: 1;
        }

        /* Enforce theme colors matched exactly helper mappings */
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
        .text-body-md { font-size: 14px; line-height: 20px; }
        .text-body-sm { font-size: 13px; line-height: 18px; }

        /* Stepper circle settings */
        .stepper-active-bg { background-color: #001a48 !important; color: #ffffff !important; }
        
        /* Backdrop blur glass headers */
        .glass-header {
          background: rgba(239, 244, 255, 0.82);
          backdrop-filter: blur(12px);
        }
      `}</style>

      {/* Sidebar Navigation */}
      <aside className="fixed left-0 top-0 bottom-0 flex flex-col justify-between py-6 w-[260px] h-screen border-r border-[#c4c6d2] bg-white z-50">
        <div>
          {/* Brand Section */}
          <div className="px-6 mb-10 flex items-center gap-3">
            <div className="w-10 h-10 bg-[#002d72] rounded flex items-center justify-center">
              <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>medical_services</span>
            </div>
            <div>
              <h1 className="text-headline-md font-bold text-[#001a48]">MedFlow</h1>
              <p className="text-label-caps text-[#444651] tracking-widest leading-none">CLINICAL PRECISION</p>
            </div>
          </div>
          {/* Nav Links */}
          <nav className="space-y-2 px-2">
            <button 
              onClick={() => navigate('/reception')}
              className="w-full flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-[#eff4ff] transition-colors rounded-lg text-left"
            >
              <span className="material-symbols-outlined text-slate-500">dashboard</span>
              <span className="text-body-md font-semibold">Dashboard</span>
            </button>
            <button 
              onClick={() => setStep(1)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-[#001a48] text-white rounded-lg shadow-sm text-left transition-all scale-[0.98]"
            >
              <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>person_add</span>
              <span className="text-body-md font-bold">Patient Registration</span>
            </button>
            <button 
              onClick={() => navigate('/reception/tokens')}
              className="w-full flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-[#eff4ff] transition-colors rounded-lg text-left"
            >
              <span className="material-symbols-outlined text-slate-500">confirmation_number</span>
              <span className="text-body-md font-semibold">Token Management</span>
            </button>
          </nav>
        </div>
        {/* Footer Nav */}
        <div className="space-y-2 px-2">
          <button 
            onClick={() => { logout(); navigate('/login'); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-[#eff4ff] transition-colors rounded-lg hover:text-red-600 text-left"
          >
            <span className="material-symbols-outlined">logout</span>
            <span className="text-body-md font-bold text-[#ba1a1a]">Logout</span>
          </button>
        </div>
      </aside>

      {/* Top App Bar */}
      <header className="fixed top-0 right-0 left-[260px] z-40 flex items-center justify-between px-8 h-16 glass-header border-b border-[#c4c6d2]">
        <div className="flex-1 max-w-xl">
          <div className="relative group">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 z-10 text-[19px]">search</span>
            <input
              value={headerSearchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full bg-[#f8f9ff] border border-[#c4c6d2] rounded-full pl-11 pr-10 py-2 focus:ring-4 focus:ring-[#001a48]/15 focus:border-[#001a48] transition-all duration-200 outline-none text-[13.5px] font-semibold text-slate-800 shadow-inner"
              placeholder="Quick Search (Name, ID, Phone)..."
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
          <button onClick={() => toast.info('Notification console clean.')} className="relative text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center">
            <span className="material-symbols-outlined">notifications</span>
            <span className="absolute top-0 right-0 w-2 h-2 bg-red-600 rounded-full"></span>
          </button>
          <button onClick={() => toast.info('Default language: English (US)')} className="text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center">
            <span className="material-symbols-outlined">language</span>
          </button>
          <div className="flex items-center gap-3 border-l border-[#c4c6d2] pl-6">
            <div className="text-right">
              <p className="text-body-md font-bold text-[#0b1c30]">{currentUser?.name || 'Alan Reji'}</p>
              <p className="text-label-caps text-on-surface-variant opacity-80">RECEPTION HUB</p>
            </div>
            <img
              alt="Alan Reji"
              className="w-10 h-10 rounded-lg object-cover border border-[#c4c6d2]"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDLqZrurR0XK-fIDc6WHAy0lQDKzndNZyUARrpLZ-lHuwp_mKUN-nA9KKoMkEwREaYjlBjzHcvUDqXeOB2TE50NrL8GdnCdZiQngu2knVJ3Qw_e3pfdqFeSJV4gaX-uO2wzmsPFeNKh1dfdAduBs5dNFkW-7lmoB-bsPMG8Bjsz4wPLAzzhBXy9kKaHW3UP53mEbY1gvAniVH2jKc17iXB5Ow4pFr1cFTwNyMYZZ1PxP8lcehDveALwjF6yaN_BPQBux9nXYvJ9v2U"
            />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="ml-[260px] pt-16 min-h-screen">
        <div className="p-8">
          
          {/* Page Header Area */}
          <div className="flex justify-between items-end mb-8">
            <div>
              <h2 className="text-display-lg text-[#001a48] font-bold">Patient Registration</h2>
              <p className="text-body-md text-on-surface-variant font-medium">Register a new patient or look up an existing record.</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => {
                  toast.info('Showing latest patient registrations in the right panel.');
                }}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#001a48] text-white font-bold rounded-lg hover:opacity-90 shadow-sm transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">history</span>
                <span className="text-body-md">Recent Registrations</span>
              </button>
            </div>
          </div>

          {/* Grid Layout Container */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Left Registration Form block */}
            <div className="lg:col-span-8">
              <div className="bg-white border border-[#c4c6d2] rounded-xl overflow-hidden shadow-sm">
                
                {/* Visual Stepper Header - Switches styling based on active state */}
                <div className="bg-[#eff4ff] px-8 py-5 flex items-center justify-between border-b border-[#c4c6d2]">
                  <div className="flex items-center gap-8">
                    {/* Step 1 indicator */}
                    <div 
                      onClick={() => setStep(1)}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      {step === 2 ? (
                        <div className="w-7 h-7 rounded-full bg-[#006a61] text-white flex items-center justify-center">
                          <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-[#001a48] text-white flex items-center justify-center font-bold text-body-sm">
                          1
                        </div>
                      )}
                      <span className={`text-body-md font-bold ${step === 1 ? 'text-[#001a48]' : 'text-slate-700'}`}>Personal Details</span>
                    </div>

                    <div className="w-12 h-[1px] bg-[#c4c6d2]"></div>

                    {/* Step 2 indicator */}
                    <div 
                      onClick={() => {
                        if (formData.name && formData.phone) {
                          setStep(2);
                        } else {
                          toast.error('Please input patient name and phone number before proceeding to step 2.');
                        }
                      }}
                      className="flex items-center gap-3 cursor-pointer"
                    >
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-body-sm transition-colors ${
                        step === 2 ? 'bg-[#001a48] text-white' : 'border border-[#747782] text-slate-500 bg-white'
                      }`}>
                        2
                      </div>
                      <span className={`text-body-md font-bold ${step === 2 ? 'text-[#001a48]' : 'text-slate-400'}`}>Clinical Assignment</span>
                    </div>
                  </div>
                  <span className="text-label-caps text-on-surface-variant">STEP {step} OF 2</span>
                </div>

                {/* Form Content Toggle Panels */}
                {step === 1 ? (
                  // STEP 1 UI: Personal Details Form
                  <form onSubmit={handleNextStep} className="p-8 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <label className="block text-label-caps text-on-surface-variant">FULL LEGAL NAME *</label>
                        <input
                          required
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="w-full px-4 py-3 bg-[#f8f9ff] border border-[#c4c6d2] rounded-lg text-body-md focus:ring-2 focus:ring-[#001a48]/10 focus:border-[#001a48] outline-none transition-all text-slate-800 font-semibold"
                          placeholder="e.g. Johnathan Doe"
                          type="text"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-label-caps text-on-surface-variant">DATE OF BIRTH</label>
                        <input
                          value={formData.dateOfBirth}
                          onChange={(e) => {
                            const dob = e.target.value;
                            const calculatedAge = calculateAge(dob);
                            setFormData(prev => ({ ...prev, dateOfBirth: dob, age: calculatedAge }));
                          }}
                          className="w-full px-4 py-3 bg-[#f8f9ff] border border-[#c4c6d2] rounded-lg text-body-md focus:ring-2 focus:ring-[#001a48]/10 focus:border-[#001a48] outline-none transition-all text-slate-800 font-semibold"
                          type="date"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-label-caps text-on-surface-variant">PHONE NUMBER *</label>
                        <input
                          required
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="w-full px-4 py-3 bg-[#f8f9ff] border border-[#c4c6d2] rounded-lg text-body-md focus:ring-2 focus:ring-[#001a48]/10 focus:border-[#001a48] outline-none transition-all text-slate-800 font-semibold"
                          placeholder="Enter phone number"
                          type="tel"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-label-caps text-on-surface-variant">EMAIL ADDRESS</label>
                        <input
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full px-4 py-3 bg-[#f8f9ff] border border-[#c4c6d2] rounded-lg text-body-md focus:ring-2 focus:ring-[#001a48]/10 focus:border-[#001a48] outline-none transition-all text-slate-800 font-semibold"
                          placeholder="j.doe@example.com"
                          type="email"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-label-caps text-[#444651]">AGE (Years)</label>
                        <input
                          value={formData.age}
                          onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                          className="w-full px-4 py-3 bg-[#f8f9ff] border border-[#c4c6d2] rounded-lg text-body-md focus:ring-2 focus:ring-[#001a48]/10 focus:border-[#001a48] outline-none transition-all text-slate-800 font-semibold"
                          placeholder="30"
                          type="number"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-label-caps text-[#444651]">GENDER ASSIGNMENT</label>
                        <select
                          value={formData.gender}
                          onChange={(e) => setFormData({ ...formData, gender: e.target.value as 'M' | 'F' | 'O' })}
                          className="w-full px-4 py-3 bg-[#f8f9ff] border border-[#c4c6d2] rounded-lg text-body-md focus:ring-2 focus:ring-[#001a48]/10 focus:border-[#001a48] outline-none transition-all text-slate-800 font-semibold"
                        >
                          <option value="M">Male</option>
                          <option value="F">Female</option>
                          <option value="O">Other</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="block text-label-caps text-on-surface-variant">RESIDENTIAL ADDRESS</label>
                      <textarea
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        className="w-full px-4 py-3 bg-[#f8f9ff] border border-[#c4c6d2] rounded-lg text-body-md focus:ring-2 focus:ring-[#001a48]/10 focus:border-[#001a48] outline-none transition-all resize-none text-slate-800 font-semibold"
                        placeholder="Street address, City, State, ZIP"
                        rows={3}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <label className="block text-label-caps text-on-surface-variant">EMERGENCY CONTACT NAME</label>
                        <input
                          value={formData.emergencyContactName}
                          onChange={(e) => setFormData({ ...formData, emergencyContactName: e.target.value })}
                          className="w-full px-4 py-3 bg-[#f8f9ff] border border-[#c4c6d2] rounded-lg text-body-md focus:ring-2 focus:ring-[#001a48]/10 focus:border-[#001a48] outline-none transition-all text-slate-800 font-semibold"
                          placeholder="Contact person's name"
                          type="text"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-label-caps text-on-surface-variant">EMERGENCY CONTACT PHONE</label>
                        <input
                          value={formData.emergencyContactPhone}
                          onChange={(e) => setFormData({ ...formData, emergencyContactPhone: e.target.value })}
                          className="w-full px-4 py-3 bg-[#f8f9ff] border border-[#c4c6d2] rounded-lg text-body-md focus:ring-2 focus:ring-[#001a48]/10 focus:border-[#001a48] outline-none transition-all text-slate-800 font-semibold"
                          placeholder="+1 (555) 000-0000"
                          type="tel"
                        />
                      </div>
                    </div>

                    {/* Step 1 Footer */}
                    <div className="pt-6 border-t border-[#c4c6d2] flex justify-end gap-4 bg-white">
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({
                            ...formData,
                            name: '',
                            phone: '',
                            email: '',
                            address: '',
                            emergencyContactName: '',
                            emergencyContactPhone: '',
                          });
                          toast.info('Identity draft cleared.');
                        }}
                        className="px-8 py-2.5 border border-[#001a48] text-[#001a48] font-bold text-body-sm rounded-lg hover:bg-[#eff4ff] transition-all cursor-pointer"
                      >
                        Save Draft
                      </button>
                      <button
                        type="submit"
                        className="flex items-center gap-2 px-10 py-2.5 bg-[#001a48] text-white font-bold text-body-sm rounded-lg hover:opacity-90 transition-all group cursor-pointer"
                      >
                        Next Step
                        <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
                      </button>
                    </div>
                  </form>
                ) : (
                  // STEP 2 UI: Clinical Assignment Form (Matching HTML EXACTLY)
                  <form onSubmit={handleSubmit} className="p-8 space-y-10">
                    
                    {/* Doctor Selection (Step 1) & Department Selection (Step 2 - derived and read-only) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="material-symbols-outlined text-[#001a48]">medical_information</span>
                          <label className="block text-label-caps text-on-surface-variant font-bold">1. ASSIGN DOCTOR</label>
                        </div>
                        <div className="relative">
                          <select
                            value={formData.doctorId}
                            onChange={(e) => setFormData({ ...formData, doctorId: e.target.value })}
                            className="w-full bg-[#eff4ff] border border-[#c4c6d2] rounded-lg px-4 py-3 appearance-none focus:ring-2 focus:ring-[#001a48]/20 outline-none text-body-md cursor-pointer font-bold text-slate-800"
                          >
                            {activeDoctorsInRegistration.length > 0 ? (
                              activeDoctorsInRegistration.map((doc) => {
                                const isDocOnDuty = doc.dutyStatus === 'ON DUTY' || doc.dutyStatus === 'ON_DUTY';
                                const statusDot = isDocOnDuty ? '🟢' : '⚫';
                                const displayName = doc.name.toLowerCase().startsWith('dr') ? doc.name : `Dr. ${doc.name}`;
                                return (
                                  <option key={doc.id} value={doc.id}>
                                    {statusDot} {displayName} ({doc.department || 'General Medicine'}) - {isDocOnDuty ? 'ON DUTY' : 'OFF DUTY'}
                                  </option>
                                );
                              })
                            ) : (
                              <option disabled value="">No physicians registered in staff management</option>
                            )}
                          </select>
                          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">expand_more</span>
                        </div>

                        {(() => {
                          const selectedDoc = activeDoctorsInRegistration.find(d => d.id === formData.doctorId);
                          const isSelectedDocOffDuty = selectedDoc && !(selectedDoc.dutyStatus === 'ON DUTY' || selectedDoc.dutyStatus === 'ON_DUTY');
                          if (isSelectedDocOffDuty) {
                            return (
                              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-lg flex items-center gap-2 text-xs text-amber-800 font-bold mt-2">
                                <span className="material-symbols-outlined text-[18px]">warning</span>
                                <span>Selected Doctor is currently OFF DUTY.</span>
                              </div>
                            );
                          }
                          return null;
                        })()}

                        {!isAnyDoctorOnDuty ? (
                          <div className="p-4 bg-red-50 border border-[#ba1a1a]/30 rounded-lg flex items-center gap-2.5 text-xs text-[#ba1a1a] font-bold mt-2">
                            <span className="material-symbols-outlined text-[18px]">warning</span>
                            <span>No doctors are currently on duty. Please contact administration.</span>
                          </div>
                        ) : (
                          <p className="text-[11px] text-[#006a61] font-bold mt-1.5 ml-1">
                            Select any registered clinical staff doctor. Real-time duty statuses are indicated.
                          </p>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="material-symbols-outlined text-[#001a48]">apartment</span>
                          <label className="block text-label-caps text-on-surface-variant font-bold">2. DERIVED DEPARTMENT (READ-ONLY)</label>
                        </div>
                        <div className="p-4 rounded-lg bg-[#001a48]/5 border border-[#001a48]/20 flex items-center gap-3 shadow-sm h-[52px]">
                          <span className="material-symbols-outlined text-[#001a48] text-[20px]">
                            {(() => {
                              const lower = (formData.department || '').toLowerCase();
                              if (lower.includes('cardio')) return 'favorite';
                              if (lower.includes('pedi')) return 'child_care';
                              if (lower.includes('derm')) return 'vaccines';
                              if (lower.includes('emerg')) return 'emergency';
                              return 'medical_services';
                            })()}
                          </span>
                          <span className="text-body-md font-extrabold text-[#001a48] tracking-wide uppercase">
                            {formData.department || 'SELECT A DOCTOR FIRST'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1.5 ml-1 italic">
                          Automatically mapped and verified based on staff credentials.
                        </p>
                      </div>
                    </div>

                    {/* Assignment & Priority */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                        <label className="block text-label-caps text-on-surface-variant mb-2">PRIORITY LEVEL</label>
                        <div className="flex gap-2">
                          {['Low', 'Medium', 'High', 'Urgent'].map((pri) => {
                            const isSelected = formData.priority === pri;
                            let btnStyle = "flex-1 py-2 px-3 border border-[#c4c6d2] rounded-lg text-body-sm font-bold text-[#444651] hover:bg-[#dce9ff] transition-colors";
                            if (isSelected) {
                              if (pri === 'Urgent') {
                                btnStyle = "flex-1 py-2 px-3 border-2 border-red-600 bg-red-600 text-white rounded-lg text-body-sm font-bold shadow-md";
                              } else {
                                btnStyle = "flex-1 py-2 px-3 border-2 border-[#001a48] bg-[#001a48] text-white rounded-lg text-body-sm font-bold shadow-md";
                              }
                            } else if (pri === 'Urgent') {
                              btnStyle = "flex-1 py-2 px-3 border border-red-600 text-red-600 rounded-lg text-body-sm font-bold hover:bg-red-50 transition-colors";
                            }
                            return (
                              <button
                                key={pri}
                                type="button"
                                onClick={() => setFormData({ ...formData, priority: pri as any })}
                                className={btnStyle}
                              >
                                {pri}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Reason for Visit */}
                    <div>
                      <label className="block text-label-caps text-on-surface-variant mb-2">REASON FOR VISIT</label>
                      <textarea
                        value={formData.reasonForVisit}
                        onChange={(e) => setFormData({ ...formData, reasonForVisit: e.target.value })}
                        className="w-full bg-[#eff4ff] border border-[#c4c6d2] rounded-lg p-4 focus:ring-2 focus:ring-[#001a48]/20 outline-none text-body-md resize-none text-slate-800 font-semibold"
                        placeholder="Enter reason for visit"
                        rows={3}
                      />
                    </div>

                    {/* Initial Vitals (Optional) */}
                    <div>
                      <div className="flex items-center gap-2 mb-6">
                        <span className="material-symbols-outlined text-[#001a48]">monitoring</span>
                        <h3 className="text-title-sm font-bold text-[#0b1c30]">Initial Vitals <span className="text-slate-500 font-normal">(Optional)</span></h3>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        <div>
                          <label className="block text-label-caps text-on-surface-variant mb-2">BLOOD PRESSURE (mmHg)</label>
                          <input
                            value={formData.bloodPressure}
                            onChange={(e) => setFormData({ ...formData, bloodPressure: e.target.value })}
                            className="w-full bg-[#eff4ff] border border-[#c4c6d2] rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#001a48]/20 outline-none text-body-md font-semibold text-slate-800"
                            type="text"
                          />
                        </div>
                        <div>
                          <label className="block text-label-caps text-on-surface-variant mb-2">WEIGHT (kg)</label>
                          <input
                            value={formData.weight}
                            onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                            className="w-full bg-[#eff4ff] border border-[#c4c6d2] rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#001a48]/20 outline-none text-body-md font-semibold text-slate-800"
                            type="text"
                          />
                        </div>
                        <div>
                          <label className="block text-label-caps text-on-surface-variant mb-2">TEMPERATURE (°C)</label>
                          <input
                            value={formData.temperature}
                            onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                            className="w-full bg-[#eff4ff] border border-[#c4c6d2] rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-[#001a48]/20 outline-none text-body-md font-semibold text-slate-800"
                            type="text"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Step 2 Action Footer */}
                    <div className="px-8 py-6 bg-[#eff4ff] border-t border-[#c4c6d2] -mx-8 -mb-8 flex justify-between">
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="flex items-center gap-2 px-6 py-2.5 border border-[#001a48] text-[#001a48] font-bold rounded-lg hover:bg-[#002d72]/5 transition-all text-body-sm cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
                        <span>Back to Billing</span>
                      </button>
                      
                      <button
                        type="submit"
                        disabled={activeDoctorsInRegistration.length === 0 || !isAnyDoctorOnDuty}
                        className={`flex items-center gap-2 px-8 py-2.5 bg-[#001a48] text-white font-bold rounded-lg hover:opacity-90 shadow-md transition-all text-body-sm ${
                          (activeDoctorsInRegistration.length === 0 || !isAnyDoctorOnDuty) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer animate-pulse'
                        }`}
                      >
                        <span>Complete Registration</span>
                        <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      </button>
                    </div>

                  </form>
                )}
              </div>
            </div>

            {/* Right layout sidebar panel content section */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* Patient Lookup Module Card */}
              <div className="bg-[#eff4ff] border border-[#c4c6d2] rounded-xl p-6 shadow-xs">
                <h4 className="text-title-sm font-bold text-[#001a48] mb-5">Patient Lookup</h4>
                <div className="space-y-4">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">badge</span>
                    <input
                      value={lookupQuery}
                      onChange={(e) => setLookupQuery(e.target.value)}
                      className="w-full bg-white border border-[#c4c6d2] rounded-lg pl-10 pr-4 py-2.5 focus:ring-2 focus:ring-[#001a48]/25 outline-none text-body-sm font-semibold text-slate-800"
                      placeholder="Patient ID / Name / SSN"
                      type="text"
                    />
                  </div>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">call</span>
                    <input
                      value={lookupPhone}
                      onChange={(e) => setLookupPhone(e.target.value)}
                      className="w-full bg-white border border-[#c4c6d2] rounded-lg pl-10 pr-4 py-2.5 focus:ring-2 focus:ring-[#001a48]/25 outline-none text-body-sm font-semibold text-slate-800"
                      placeholder="Phone Number"
                      type="text"
                    />
                  </div>
                  <button
                    onClick={handleLookupSearch}
                    className="w-full py-2.5 bg-[#001a48] text-white font-bold rounded-lg hover:opacity-95 transition-all shadow-sm cursor-pointer"
                  >
                    Search Records
                  </button>
                </div>
              </div>

              {/* Recent Records list box matching HTML */}
              <div className="bg-white border border-[#c4c6d2] rounded-xl overflow-hidden shadow-xs">
                <div className="px-6 py-4 bg-[#eff4ff] border-b border-[#c4c6d2]">
                  <h4 className="text-label-caps text-on-surface-variant font-bold">RECENT RECORDS</h4>
                </div>
                <div className="divide-y divide-[#c4c6d2]">
                  {patients && patients.length > 0 ? (
                    // Render real dynamic patient documents in descending order (newest first)
                    [...(patients || [])].slice(0, 6).map((rec) => {
                      return (
                        <div
                          key={rec.id}
                          id={`recent-reg-item-${rec.id}`}
                          className="p-4 bg-white"
                        >
                          <div>
                            <p className="text-body-md font-bold text-[#0b1c30] leading-snug">{rec.name}</p>
                            <p className="text-body-sm text-slate-500 font-semibold mt-0.5">{rec.phone}</p>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="p-6 text-center text-slate-400 text-xs font-semibold uppercase tracking-wider">
                      No recent patient registrations found.
                    </div>
                  )}
                </div>
              </div>



            </div>
          </div>

        </div>
      </main>

      {/* Background Decor Gradients matching Step 2 exactly */}
      <div className="fixed inset-0 pointer-events-none -z-10 opacity-30">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-gradient-to-br from-[#e5eeff] to-transparent rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-[#dce9ff] to-transparent rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl"></div>
      </div>
    </div>
  );
}
