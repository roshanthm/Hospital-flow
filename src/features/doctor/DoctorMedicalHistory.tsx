import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useStore, authFetch } from '../../store/useStore';
import { generateFullPatientHistoryPDF } from '../../lib/pdfUtils';

export default function DoctorMedicalHistory() {
  const { patientId } = useParams();
  const navigate = useNavigate();
  const currentUser = useStore(state => state.currentUser);
  const logout = useStore(state => state.logout);
  const [activeTab, setActiveTab] = useState('All Events');

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any>({ patients: [], tokens: [], consultations: [] });
  const [searchTimeout, setSearchTimeout] = useState<any>(null);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
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

  const handleStartConsultation = async (tokenId: string, status: string) => {
    if (status === 'WAITING') {
      try {
        await authFetch(`/api/tokens/${tokenId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'IN_CONSULTATION' })
        });
      } catch (err) {
        console.error(err);
      }
    }
    navigate(`/doctor/consultation/${tokenId}`);
  };

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    await logout();
    navigate('/login');
  };

  // Fetch the patient directly if we have patientId
  const { data: routePatient, isLoading: isLoadingPatient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      if (!patientId) return null;
      const res = await authFetch(`/api/patients/${patientId}`);
      if (!res.ok) throw new Error('Failed to fetch patient');
      return res.json();
    },
    enabled: !!patientId,
  });

  const { data: tokens = [], isLoading: isLoadingTokens } = useQuery({
    queryKey: ['doctorTokens', 'todayTokens'],
    queryFn: async () => {
      const res = await authFetch('/api/tokens?today=true');
      if (!res.ok) throw new Error('Failed to fetch tokens');
      return res.json();
    },
    enabled: !patientId,
    staleTime: 60000
  });

  // If no patientId in route, find the closest active patient from tokens
  const fallbackToken = !patientId ? (tokens.find((t: any) => t.status === 'IN_CONSULTATION') || tokens.find((t: any) => t.status === 'WAITING' || t.status === 'CALLED') || tokens[0]) : null;
  const patient = patientId ? routePatient : fallbackToken?.patient;
  
  const actualPatientId = patientId || patient?.id;

  const { data: historyEvents = [], isLoading: isLoadingHistory } = useQuery({
    queryKey: ['patientHistory', actualPatientId],
    queryFn: async () => {
      if (!actualPatientId) return [];
      const res = await authFetch(`/api/patients/${actualPatientId}/history`);
      if (!res.ok) throw new Error('Failed to fetch history');
      return res.json();
    },
    enabled: !!actualPatientId
  });

  const { data: users = [] } = useQuery({
    queryKey: ['staffUsers'],
    queryFn: async () => {
      const res = await authFetch('/api/users');
      if (!res.ok) throw new Error('Failed to fetch users');
      return res.json();
    }
  });

  const checkAccessAndNavigate = (route: string) => {
    navigate(route);
  };

  const navigateToConsultation = () => {
    const token = tokens.find((t: any) => t.status === 'IN_CONSULTATION') || 
                  tokens.find((t: any) => t.status === 'WAITING' || t.status === 'CALLED');
    if (token) {
      navigate(`/doctor/consultation/${token.id}`);
    } else {
      toast.info('No active consultations available.');
    }
  };

  const handleExportChartPDF = async () => {
    if (!patient) {
      toast.error('No patient selected to export chart.');
      return;
    }
    try {
      toast.info(`Spooling comprehensive medical chart PDF for ${patient.name}...`);
      
      // Fetch only bills belonging to this specific patient
      const billsRes = await authFetch(`/api/bills?patientId=${patient.id}`);
      const patientBills = billsRes.ok ? await billsRes.json() : [];
      
      // Fetch only tokens belonging to this specific patient
      const tokensRes = await authFetch(`/api/tokens?patientId=${patient.id}`);
      const patientTokens = tokensRes.ok ? await tokensRes.json() : [];
      
      generateFullPatientHistoryPDF(patient, historyEvents, patientBills, patientTokens, users);
      toast.success(`Dossier PDF downloaded for ${patient.name}!`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate complete medical dossier PDF.");
    }
  };

  const isScreenLoading = patientId ? (isLoadingPatient && !patient) : (isLoadingTokens && !patient);
  if (isScreenLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500 font-medium">
        <div className="flex flex-col items-center gap-3">
          <i className="bi bi-arrow-repeat animate-spin text-3xl text-blue-600"></i>
          <span>Retrieving medical records...</span>
        </div>
      </div>
    );
  }

  let chronicConditions: any[] = [];
  let parsedAllergies = 'No known allergies';

  if (patient) {
    if (patient.allergies) {
      parsedAllergies = patient.allergies;
    }

    if (patient.chronicConditions && patient.chronicConditions !== 'None' && patient.chronicConditions !== 'None disclosed') {
      chronicConditions = patient.chronicConditions.split(',').map((cond: string) => ({ name: cond.trim(), date: '' })).filter((cOn: any) => cOn.name);
    }

    if (patient.medicalHistory) {
      const isRegistrationBlock = patient.medicalHistory.includes('Department:') || 
                                  patient.medicalHistory.includes('Assigned Doctor:') ||
                                  patient.medicalHistory.includes('Pathology history:');
      if (isRegistrationBlock) {
        const pathMatch = patient.medicalHistory.match(/Pathology history:\s*([^\n]+)/i);
        const allergyMatch = patient.medicalHistory.match(/Allergies:\s*([^\n]+)/i);
        
        if (chronicConditions.length === 0) {
          const pathHistory = pathMatch ? pathMatch[1].trim() : '';
          if (pathHistory && pathHistory.toLowerCase() !== 'none disclosed' && pathHistory.toLowerCase() !== 'none') {
            chronicConditions = pathHistory.split(',').map((cond: string) => ({ name: cond.trim(), date: '' }));
          }
        }
        
        if (!patient.allergies && allergyMatch) {
          parsedAllergies = allergyMatch[1].trim();
        }
      } else {
        const cleanHist = patient.medicalHistory.startsWith('Allergies:') 
          ? patient.medicalHistory.replace('Allergies:', '').trim()
          : patient.medicalHistory;
        
        if (!patient.allergies && cleanHist) {
          parsedAllergies = cleanHist; 
        }
      }
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @import url("https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css");
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap");

        :root {
          --brand:#0d47a1; --brand-deep:#003178; --brand-light:#e8f0fe;
          --text:#111827; --muted:#6b7280; --line:#e5e7eb; --page:#f5f6fa;
          --good:#15803d; --good-bg:#dcfce7; --warn:#b91c1c; --warn-bg:#fee2e2;
          --orange:#c2410c; --orange-bg:#ffedd5;
          --shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04);
        }
        .medflow-history *, .medflow-history *::before, .medflow-history *::after {
          box-sizing:border-box;margin:0;padding:0;
        }
        .medflow-history {
          font-family:"Inter",sans-serif;background:var(--page);color:var(--text);min-height:100vh;font-size:14px;
        }
        .medflow-history .shell{display:grid;grid-template-columns:180px 1fr;min-height:100vh;}
        /* Sidebar */
        .medflow-history .sidebar{background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;padding:20px 0;position:sticky;top:0;height:100vh;overflow-y:auto;}
        .medflow-history .brand{display:flex;align-items:center;gap:10px;padding:0 16px 24px;}
        .medflow-history .brand-icon{width:36px;height:36px;background:var(--brand-deep);border-radius:8px;display:grid;place-items:center;color:#fff;font-size:18px;flex-shrink:0;}
        .medflow-history .brand-name{font-size:15px;font-weight:700;color:var(--brand-deep);line-height:1.2;}
        .medflow-history .brand-sub{font-size:9px;color:#9ca3af;letter-spacing:.6px;text-transform:uppercase;}
        .medflow-history .nav{flex:1;padding:0 8px;display:flex;flex-direction:column;gap:2px;}
        .medflow-history .nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;font-size:14px;font-weight:600;color:var(--muted);background:transparent;border:0;cursor:pointer;text-decoration:none;width:100%;text-align:left;}
        .medflow-history .nav-item:hover{background:var(--brand-light);color:var(--brand);}
        .medflow-history .nav-item.active{background:var(--brand);color:#fff;}
        .medflow-history .nav-item i{font-size:16px;flex-shrink:0;}
        .medflow-history .sidebar-footer{padding:12px 8px 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:2px;}
        /* Topbar */
        .medflow-history .main-area{display:flex;flex-direction:column;min-height:100vh;}
        .medflow-history .topbar{height:56px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 24px;position:sticky;top:0;z-index:50;}
        .medflow-history .search-wrap{position:relative;width:340px;}
        .medflow-history .search-wrap i{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:15px;pointer-events:none;z-index:10;}
        .medflow-history .search-wrap input{width:100%;height:40px;border:1.5px solid var(--line);border-radius:9999px;background:var(--page);padding:0 36px 0 38px;font:500 13.5px/1 "Inter",sans-serif;color:var(--text);outline:none;transition:all 0.2s ease-in-out;box-shadow:inset 0 1px 2px rgba(0,0,0,0.05);}
        .medflow-history .search-wrap input:focus{border-color:var(--brand);background:#fff;box-shadow:0 0 0 3px rgba(13,71;161,0.15);}
        .medflow-history .search-item:hover{background:#f8fafc;}
        .medflow-history .topbar-tools{display:flex;align-items:center;gap:6px;}
        .medflow-history .tool-btn{width:36px;height:36px;border:0;background:transparent;border-radius:8px;display:grid;place-items:center;cursor:pointer;color:var(--muted);font-size:18px;}
        .medflow-history .tb-div{width:1px;height:28px;background:var(--line);margin:0 4px;}
        .medflow-history .profile-chip{display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 8px;border-radius:8px;}
        .medflow-history .profile-info{text-align:right;}
        .medflow-history .profile-name{display:block;font-size:14px;font-weight:700;color:var(--text);line-height:1.2;}
        .medflow-history .profile-role{display:block;font-size:11px;font-weight:700;color:var(--brand);letter-spacing:.05em;text-transform:uppercase;margin-top:1px;}
        .medflow-history .avatar{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#9bc2ff,#dce8ff);border:2px solid var(--brand);display:grid;place-items:center;font-size:14px;font-weight:700;color:var(--brand-deep);}
        /* Content */
        .medflow-history .content-area{flex:1;padding:28px;overflow-y:auto;}
        /* Buttons */
        .medflow-history .btn{display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:38px;border-radius:8px;font:600 14px/1 "Inter",sans-serif;cursor:pointer;border:0;}
        .medflow-history .btn-primary{background:var(--brand);color:#fff;}
        .medflow-history .btn-ghost{background:#fff;color:var(--text);border:1px solid var(--line);}
        .medflow-history .btn-sm{height:32px;padding:0 12px;font-size:13px;}
        /* Page Header */
        .medflow-history .page-header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap;}
        .medflow-history .page-header h1{font-size:28px;font-weight:800;letter-spacing:-.5px;margin-bottom:4px;}
        .medflow-history .breadcrumb{font-size:13px;color:var(--muted);margin-bottom:6px;}
        .medflow-history .bc-link{color:var(--brand);font-weight:600;cursor:pointer;background:none;border:none;font:inherit;padding:0;}
        .medflow-history .page-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;flex-shrink:0;}
        /* Layout */
        .medflow-history .history-layout{display:grid;grid-template-columns:300px 1fr;gap:20px;align-items:start;}
        .medflow-history .hist-left{display:flex;flex-direction:column;gap:14px;}
        .medflow-history .h-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;box-shadow:var(--shadow);}
        .medflow-history .h-card-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;margin-bottom:14px;}
        .medflow-history .h-card-title i{font-size:16px;color:var(--brand);}
        /* Conditions */
        .medflow-history .condition-item{padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;}
        .medflow-history .condition-item:last-child{margin-bottom:0;}
        .medflow-history .cond-name{font-size:14px;font-weight:600;}
        .medflow-history .cond-date{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px;}
        /* Allergies */
        .medflow-history .allergy-tags{display:flex;flex-wrap:wrap;gap:7px;}
        .medflow-history .al-tag{padding:5px 12px;border-radius:999px;font-size:12px;font-weight:700;}
        .medflow-history .al-sev{background:var(--warn-bg);color:var(--warn);}
        .medflow-history .al-mod{background:var(--orange-bg);color:var(--orange);}
        /* Vitals 2x2 */
        .medflow-history .vitals-2x2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        .medflow-history .v2{border:1px solid var(--line);border-radius:8px;padding:10px 12px;}
        .medflow-history .v2-key{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;}
        .medflow-history .v2-val{font-size:16px;font-weight:800;}
        .medflow-history .v2-val.alert{color:var(--warn);}
        .medflow-history .v2-unit{font-size:11px;color:var(--muted);}
        /* Tabs */
        .medflow-history .tab-row{display:flex;border-bottom:2px solid var(--line);margin-bottom:18px;}
        .medflow-history .tab-btn{padding:10px 18px;border:0;background:transparent;font:700 12px/1 "Inter",sans-serif;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;text-transform:uppercase;letter-spacing:.06em;}
        .medflow-history .tab-btn.active{color:var(--brand);border-bottom-color:var(--brand);}
        /* Timeline */
        .medflow-history .tl-item{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid var(--line);}
        .medflow-history .tl-item:last-child{border-bottom:0;}
        .medflow-history .tl-icon-wrap{width:36px;height:36px;border-radius:999px;display:grid;place-items:center;font-size:16px;flex-shrink:0;margin-top:2px;}
        .medflow-history .tli-blue{background:var(--brand-light);color:var(--brand);}
        .medflow-history .tli-green{background:var(--good-bg);color:var(--good);}
        .medflow-history .tli-red{background:var(--warn-bg);color:var(--warn);}
        .medflow-history .tli-gray{background:#f3f4f6;color:#6b7280;}
        .medflow-history .tl-content{flex:1;}
        .medflow-history .tl-type-date{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
        .medflow-history .tl-type{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);}
        .medflow-history .tl-type.blue{color:var(--brand);} 
        .medflow-history .tl-type.red{color:var(--warn);} 
        .medflow-history .tl-type.green{color:var(--good);}
        .medflow-history .tl-date{font-size:13px;color:var(--muted);}
        .medflow-history .tl-title{font-size:16px;font-weight:700;margin-bottom:4px;}
        .medflow-history .tl-desc{font-size:13px;color:var(--muted);line-height:1.5;}
        .medflow-history .tl-attachments{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}
        .medflow-history .attach-btn{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border:1px solid var(--line);border-radius:6px;font:600 12px/1 "Inter",sans-serif;color:var(--brand);background:var(--brand-light);cursor:pointer;}
        .medflow-history .lab-values{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}
        .medflow-history .lab-val{border:1px solid var(--line);border-radius:8px;padding:8px 12px;min-width:90px;}
        .medflow-history .lab-key{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
        .medflow-history .lab-num{font-size:17px;font-weight:800;margin-top:2px;}
        .medflow-history .lab-num.alert{color:var(--warn);} 
        .medflow-history .lab-num.good{color:var(--good);}
        .medflow-history .lab-unit{font-size:11px;color:var(--muted);}
        /* Load More */
        .medflow-history .load-more-btn{display:flex;align-items:center;justify-content:center;gap:6px;padding:14px 0 4px;cursor:pointer;font:600 14px/1 "Inter",sans-serif;color:var(--brand);border:0;background:transparent;width:100%;}
      `}} />

      <div className="medflow-history">
        <div className="shell">
          {/* Sidebar */}
          <aside className="sidebar">
            <div className="brand">
              <div className="brand-icon"><i className="bi bi-hospital"></i></div>
              <div><div className="brand-name">MedFlow</div><div className="brand-sub">Clinical Precision</div></div>
            </div>
            <nav className="nav">
              <a className="nav-item" href="#" onClick={(e) => { e.preventDefault(); navigate('/doctor'); }}><i className="bi bi-people"></i><span>Patient Queue</span></a>
              <a className="nav-item" href="#" onClick={(e) => { e.preventDefault(); navigateToConsultation(); }}><i className="bi bi-clipboard2-pulse"></i><span>Consultations</span></a>
              <a className="nav-item" href="#" onClick={(e) => { e.preventDefault(); checkAccessAndNavigate('/doctor/records'); }}><i className="bi bi-folder2-open"></i><span>Patient Records</span></a>
              <a className="nav-item active" href="#" onClick={(e) => e.preventDefault()}><i className="bi bi-clock-history"></i><span>Medical History</span></a>
            </nav>
            <div className="sidebar-footer">
              <a className="nav-item" href="#"><i className="bi bi-gear"></i><span>Settings</span></a>
              <a className="nav-item cursor-pointer" onClick={handleLogout}><i className="bi bi-box-arrow-left"></i><span>Logout</span></a>
            </div>
          </aside>

          <div className="main-area">
            <header className="topbar">
              <div className="search-wrap" style={{ position: 'relative' }}>
                <i className="bi bi-search"></i>
                <input 
                  type="text" 
                  placeholder="Search records, patients or active tokens..." 
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  style={{ paddingRight: '36px' }}
                />
                {searchQuery && (
                  <button 
                    onClick={() => handleSearchChange('')} 
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', border: 0, background: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', zIndex: 12 }}
                  >
                    <i className="bi bi-x-circle-fill" style={{ fontSize: '15.5px' }}></i>
                  </button>
                )}

                {/* Search Results Dropdown */}
                {searchQuery.trim() !== '' && (
                  <div className="search-dropdown" style={{
                    position: 'absolute',
                    top: '44px',
                    left: 0,
                    right: 0,
                    background: '#fff',
                    border: '1px solid var(--line)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 15px rgba(0,0,0,.12)',
                    zIndex: 200,
                    maxHeight: '350px',
                    overflowY: 'auto',
                    textAlign: 'left'
                  }}>
                    {isSearching ? (
                      <div style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Searching clinical records...
                      </div>
                    ) : (!searchResults?.patients?.length && !searchResults?.tokens?.length && !searchResults?.consultations?.length) ? (
                      <div style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--muted)' }}>
                        No matching patients, token numbers, or consultations found.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {searchResults.patients && searchResults.patients.length > 0 && (
                          <div style={{ borderBottom: '1px solid var(--line)' }}>
                            <div style={{ background: '#fafafa', padding: '6px 14px', fontSize: '10.5px', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Matching Patients ({searchResults.patients.length})
                            </div>
                            {searchResults.patients.map((p: any) => (
                              <div 
                                key={p.id} 
                                onClick={() => { setSearchQuery(''); navigate(`/doctor/history/${p.id}`); }} 
                                style={{ padding: '10px 14px', cursor: 'pointer' }}
                                className="search-item"
                              >
                                <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)' }}>
                                  <i className="bi bi-person-fill" style={{ color: 'var(--brand)', marginRight: '6px' }}></i>
                                  {p.name}
                                </div>
                                <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '2px' }}>
                                  Patient ID: {p.id.substring(0, 8)} · Phone: {p.phone} · Sex: {p.gender}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {searchResults.tokens && searchResults.tokens.length > 0 && (
                          <div style={{ borderBottom: '1px solid var(--line)' }}>
                            <div style={{ background: '#fafafa', padding: '6px 14px', fontSize: '10.5px', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Live Queue Tokens ({searchResults.tokens.length})
                            </div>
                            {searchResults.tokens.map((t: any) => (
                              <div 
                                key={t.id} 
                                onClick={() => { setSearchQuery(''); handleStartConsultation(t.id, t.status); }} 
                                style={{ padding: '10px 14px', cursor: 'pointer' }}
                                className="search-item"
                              >
                                <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--brand-deep)' }}>
                                  <i className="bi bi-ticket-perforated-fill" style={{ marginRight: '6px' }}></i>
                                  Token Number: {t.tokenNumber} ({t.status})
                                </div>
                                <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '2px' }}>
                                  Patient: {t.patient?.name} · Priority Level: {t.priority}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {searchResults.consultations && searchResults.consultations.length > 0 && (
                          <div>
                            <div style={{ background: '#fafafa', padding: '6px 14px', fontSize: '10.5px', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Consultations & Diagnosis ({searchResults.consultations.length})
                            </div>
                            {searchResults.consultations.map((c: any) => (
                              <div 
                                key={c.id} 
                                onClick={() => { setSearchQuery(''); navigate(`/doctor/history/${c.patientId}`); }} 
                                style={{ padding: '10px 14px', cursor: 'pointer' }}
                                className="search-item"
                              >
                                <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)' }}>
                                  <i className="bi bi-journal-medical" style={{ marginRight: '6px', color: 'var(--brand)' }}></i>
                                  {c.diagnosis || 'General Clinical Treatment'}
                                </div>
                                <div style={{ fontSize: '11.5px', color: 'var(--muted)', display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', marginTop: '2px' }}>
                                  Details: {c.notes}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--brand)', fontWeight: 600, marginTop: '1px' }}>
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
              <div className="topbar-tools">
                <button className="tool-btn"><i className="bi bi-bell"></i></button>
                <button className="tool-btn"><i className="bi bi-question-circle"></i></button>
                <div className="tb-div"></div>
                <div className="profile-chip">
                  <div className="profile-info">
                    <span className="profile-name">{currentUser?.name || 'Dr. Aleena'}</span>
                    <span className="profile-role">Doctor</span>
                  </div>
                  <div className="avatar">
                    {currentUser?.name?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'DA'}
                  </div>
                </div>
              </div>
            </header>

            <main className="content-area">

              {!patient ? (
                <div className="flex h-full items-center justify-center p-8 text-gray-500">
                  <div className="text-center">
                    <i className="bi bi-person-x" style={{ fontSize: '3rem', opacity: 0.5 }}></i>
                    <p className="mt-4 font-semibold text-lg">No patient selected</p>
                    <p className="mt-2 text-sm text-gray-400">Please select a patient from Patient Records to view their medical history.</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Page Header */}
                  <div className="page-header">
                    <div>
                      <div className="breadcrumb">
                        <a className="bc-link" onClick={() => checkAccessAndNavigate('/doctor/records')}>Patient Records</a> ›
                        <span style={{ color: 'var(--brand)', fontWeight: 600, paddingLeft: '6px' }}>View Profile</span>
                      </div>
                      <h1>{patient.name}, {patient.age || 64}</h1>
                      <p style={{ marginTop: '4px', fontSize: '13px', color: 'var(--muted)' }}>Patient ID: PT-{patient.id.substring(0,8).toUpperCase()} &bull; {patient.bloodGroup || 'Blood Type Unknown'}</p>
                    </div>
                    <div className="page-actions">
                      <button className="btn btn-ghost" onClick={handleExportChartPDF}><i className="bi bi-download"></i> Export Chart</button>
                      <button className="btn btn-primary" onClick={navigateToConsultation}><i className="bi bi-plus"></i> New Entry</button>
                    </div>
                  </div>

                  {/* Layout */}
                  <div className="history-layout">
                    {/* Left Panel */}
                    <div className="hist-left">
                      {/* Chronic Conditions */}
                      <div className="h-card">
                        <div className="h-card-title"><i className="bi bi-heart-pulse-fill"></i>Chronic Conditions</div>
                        {chronicConditions.length > 0 ? chronicConditions.map((cond: any, i: number) => (
                          <div className="condition-item" key={i}>
                            <div className="cond-name">{cond.name}</div>
                            {cond.date && <div className="cond-date">{cond.date}</div>}
                          </div>
                        )) : (
                          <div className="text-sm text-gray-500">No chronic conditions recorded.</div>
                        )}
                      </div>                      {/* Allergies */}
                      <div className="h-card">
                        <div className="h-card-title"><i className="bi bi-exclamation-triangle-fill" style={{ color: 'var(--warn)' }}></i>Allergies</div>
                        <div style={{ fontSize: '13px', fontWeight: 650, color: parsedAllergies !== 'No known allergies' && parsedAllergies.toLowerCase() !== 'none' ? 'var(--warn)' : 'var(--text)' }}>
                          <i className="bi bi-exclamation-octagon" style={{ marginRight: '6px' }}></i>
                          {parsedAllergies}
                        </div>
                      </div>

                      {/* Vitals */}
                      <div className="h-card">
                        <div className="h-card-title">
                          <i className="bi bi-activity"></i>Last Vitals
                        </div>
                        <div className="vitals-2x2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                          <div className="v2"><div className="v2-key">BP</div><div className="v2-val" style={{ fontSize: '14px' }}>{patient.bloodPressure || '--'} <span className="v2-unit">mmHg</span></div></div>
                          <div className="v2"><div className="v2-key">Weight</div><div className="v2-val" style={{ fontSize: '14px' }}>{patient.weight || '--'}<span className="v2-unit">kg</span></div></div>
                          <div className="v2"><div className="v2-key">Temp</div><div className="v2-val" style={{ fontSize: '14px' }}>{patient.temperature || '--'} <span className="v2-unit">°C</span></div></div>
                        </div>
                      </div>
                    </div>

                    {/* Right Panel */}
                    <div>
                      <div className="h-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--line)', paddingBottom: '12px', marginBottom: '20px' }}>
                          <h2 style={{ fontSize: '16px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--brand-deep)' }}>
                            Clinical Consultation Timeline
                          </h2>
                          <span style={{ fontSize: '12px', fontWeight: 700, background: 'var(--brand-light)', color: 'var(--brand)', padding: '4px 10px', borderRadius: '999px' }}>
                            {historyEvents.length} {historyEvents.length === 1 ? 'CONSULTATION' : 'CONSULTATIONS'} RECOVERY
                          </span>
                        </div>

                        {/* Timeline */}
                        {isLoadingHistory ? (
                          <div style={{textAlign: 'center', padding: '4px 0', color: 'var(--muted)'}}>
                            <i className="bi bi-arrow-repeat animate-spin" style={{ fontSize: '20px' }}></i>
                            <div style={{ marginTop: '8px', fontSize: '13px' }}>Securing clinical parameters from database...</div>
                          </div>
                        ) : historyEvents.length === 0 ? (
                          <div style={{textAlign: 'center', padding: '40px 20px', color: 'var(--muted)'}}>
                            <i className="bi bi-folder-x" style={{ fontSize: '42px', opacity: 0.4 }}></i>
                            <h3 style={{ fontSize: '15px', fontWeight: 700, marginTop: '12px', color: 'var(--text)' }}>No medical history found</h3>
                            <p style={{ fontSize: '13px', marginTop: '6px' }}>This patient has no registered historical consultation outpatient records in our health databases.</p>
                          </div>
                        ) : (
                          historyEvents.map((evt: any, i: number) => {
                            const consultDate = new Date(evt.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                            const consultTimeStr = new Date(evt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                            const associatedToken = evt.visitRecord?.token;
                            const assignedTokenNo = associatedToken?.tokenNumber || 'N/A';
                            const assignedDoctorId = associatedToken?.doctorId;
                            const assignedDoctorObj = users.find((u: any) => u.id === assignedDoctorId);
                            const assignedDoctorName = assignedDoctorObj ? assignedDoctorObj.name : 'Unknown Staff';
                            const riskStatus = associatedToken?.priority || 'NORMAL';

                            return (
                              <div className="tl-item" key={evt.id || i} style={{ display: 'flex', gap: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '24px', marginBottom: '24px' }}>
                                <div className="tl-icon-wrap tli-blue" style={{ background: '#e0f2fe', color: '#0369a1', width: '38px', height: '38px', borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                  <i className="bi bi-file-medical" style={{ fontSize: '18px' }}></i>
                                </div>
                                <div className="tl-content" style={{ flex: 1 }}>
                                  {/* Header info */}
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                                    <div>
                                      <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>Consultation Record</h3>
                                      <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '2px 0 0 0' }}>
                                        Attending: <strong style={{ color: 'var(--brand)' }}>{evt.doctor?.name || 'Dr. Staff'}</strong> ({evt.doctor?.department || 'Outpatient Department'})
                                      </p>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f766e', background: '#e6fffa', border: '1px solid #b2f5ea', padding: '4px 8px', borderRadius: '6px' }}>
                                        <i className="bi bi-clock"></i> {consultDate} &bull; {consultTimeStr}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Token & Assigned Info Row */}
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                                    <div style={{ background: '#f8fafc', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '8px' }}>
                                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Assigned Token ID</div>
                                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Token {assignedTokenNo}</div>
                                    </div>
                                    <div style={{ background: '#f8fafc', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '8px' }}>
                                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Reception Assigned Doctor</div>
                                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Dr. {assignedDoctorName}</div>
                                    </div>
                                    <div style={{ background: '#f8fafc', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '8px' }}>
                                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Clinical Risk Status</div>
                                      <div style={{ fontSize: '13px', fontWeight: 800, color: (riskStatus === 'CRITICAL' || riskStatus === 'HIGH' || riskStatus === 'URGENT' || riskStatus === 'EMERGENCY') ? 'var(--warn)' : 'var(--good)' }}>
                                        {riskStatus}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Chief Complaint */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', marginBottom: '16px' }}>
                                    <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', borderLeft: '3px solid var(--brand)', border: '1px solid var(--line)', borderLeftWidth: '3px' }}>
                                      <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Chief Complaint</div>
                                      <div style={{ fontSize: '13px', fontWeight: 650, color: 'var(--text)' }}>{evt.chiefComplaint || 'No specific chief complaint logged.'}</div>
                                    </div>
                                  </div>

                                  {/* Allergies During That Visit */}
                                  <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                                    <div style={{ fontSize: '10px', fontWeight: 750, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                                      <i className="bi bi-exclamation-triangle" style={{ marginRight: '6px', color: '#b45309' }}></i> Allergies During Visit
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#78350f', fontWeight: 650 }}>
                                      {evt.allergies || 'No known allergies.'}
                                    </div>
                                  </div>

                                  {/* Chronic Conditions Evaluated */}
                                  <div style={{ marginBottom: '16px' }}>
                                    <div style={{ fontSize: '10px', fontWeight: 750, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Chronic Conditions Evaluated</div>
                                    {evt.chronicConditions && evt.chronicConditions !== 'None' && evt.chronicConditions !== 'None disclosed' && evt.chronicConditions.trim() !== '' ? (
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        {evt.chronicConditions.split(',').map((cond: string, condIdx: number) => (
                                          <span key={condIdx} style={{ fontSize: '12.5px', fontWeight: 700, color: '#991b1b', background: '#fef2f2', border: '1px solid #fee2e2', padding: '4px 10px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                            <i className="bi bi-heart-pulse-fill" style={{ color: '#ef4444' }}></i> {cond.trim()}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: '13px', color: 'var(--muted)', fontStyle: 'italic', fontWeight: 500 }}>
                                        No chronic conditions recorded
                                      </div>
                                    )}
                                  </div>

                                  {/* Clinical Diagnosis (ONLY if actually used/saved) */}
                                  {evt.diagnosis && evt.diagnosis.trim() !== '' && evt.diagnosis.toLowerCase() !== 'no diagnosis entered' && (
                                    <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Clinical Diagnosis</div>
                                      <div style={{ fontSize: '13.5px', fontWeight: 750, color: '#991b1b' }}>{evt.diagnosis}</div>
                                    </div>
                                  )}

                                  {/* Clinical Notes */}
                                  <div style={{ marginBottom: '16px' }}>
                                    <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Clinical Notes</div>
                                    <div style={{ fontSize: '13px', color: '#1e293b', lineHeight: 1.5, background: '#fff', border: '1px solid var(--line)', padding: '12px', borderRadius: '8px', whiteSpace: 'pre-line' }}>
                                      {evt.notes || 'No clinical notes recorded.'}
                                    </div>
                                  </div>

                                  {/* Prescriptions Block */}
                                  <div style={{ marginBottom: '16px', border: '1px solid var(--line)', borderRadius: '8px', overflow: 'hidden' }}>
                                    {(() => {
                                      const getPrescribedMeds = () => {
                                        if (evt.prescription?.items && evt.prescription.items.length > 0) {
                                          return evt.prescription.items;
                                        }
                                        if (evt.medicalHistory?.medicines) {
                                          try {
                                            const parsed = JSON.parse(evt.medicalHistory.medicines);
                                            if (Array.isArray(parsed) && parsed.length > 0) {
                                              return parsed.map((m: any) => ({
                                                medicine: m.medicine || m.name || m.medicineName || m.itemCode,
                                                quantity: m.quantity || m.qty || 1,
                                                dosage: m.dosage || 'As directed',
                                                frequency: m.frequency || 'Once daily',
                                                duration: m.duration || 'As needed',
                                                instructions: m.instructions || ''
                                              }));
                                            }
                                          } catch (e) {
                                            // ignore
                                          }
                                        }
                                        return [];
                                      };
                                      const medsList = getPrescribedMeds();
                                      const hasMeds = medsList.length > 0;

                                      return (
                                        <>
                                          <div style={{ background: '#fafafa', padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '10px', fontWeight: 750, color: 'var(--brand-deep)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                              <i className="bi bi-capsule" style={{ marginRight: '6px' }}></i> Prescribed Medicines
                                            </span>
                                            {hasMeds ? (
                                              <span style={{ fontSize: '9px', fontWeight: 800, color: '#15803d', background: '#dcfce7', padding: '3px 8px', borderRadius: '999px', textTransform: 'uppercase' }}>
                                                Active Prescription
                                              </span>
                                            ) : (
                                              <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--muted)', background: '#f3f4f6', padding: '3px 8px', borderRadius: '999px', textTransform: 'uppercase' }}>
                                                No Medicine Prescribed
                                              </span>
                                            )}
                                          </div>
                                          <div style={{ padding: '14px', background: '#fff' }}>
                                            {hasMeds ? (
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {medsList.map((item: any, k: number) => (
                                                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', background: '#f8fafc', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--line)', borderLeft: '3px solid var(--brand)' }}>
                                                    <strong style={{ color: 'var(--text)' }}>
                                                      <i className="bi bi-chevron-right" style={{ fontSize: '10px', color: 'var(--brand)', marginRight: '6px' }}></i> {item.medicine}
                                                      {item.instructions && (
                                                        <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '16px', marginTop: '2.5px', fontStyle: 'italic', display: 'block', fontWeight: 'normal' }}>
                                                          Instructions: {item.instructions}
                                                        </span>
                                                      )}
                                                    </strong>
                                                    <span style={{ fontSize: '12px', color: 'var(--brand)', background: 'var(--brand-light)', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>
                                                      Qty: {item.quantity || item.qty || 1} | {item.dosage} {item.frequency ? `| ${item.frequency}` : ''} {item.duration ? `(${item.duration})` : ''}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <div style={{ fontSize: '12.5px', color: 'var(--muted)', fontStyle: 'italic', textAlign: 'center', padding: '6px 0' }}>
                                                No clinical prescription medicines ordered during this consultation.
                                              </div>
                                            )}
                                          </div>
                                        </>
                                      );
                                    })()}
                                  </div>

                                  {/* Consultation Vitals per record */}
                                  <div style={{ marginBottom: '16px', background: '#f8fafc', border: '1px solid var(--line)', padding: '12px', borderRadius: '8px' }}>
                                    <div style={{ fontSize: '10px', fontWeight: 750, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                                      <i className="bi bi-activity" style={{ marginRight: '6px', color: 'var(--brand)' }}></i> consultation vitals
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#1e293b', fontWeight: 600 }}>
                                      {evt.vitals || 'No vitals collected/saved for this session.'}
                                    </div>
                                  </div>

                                  {/* Referrals & Follow Up Info */}
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', borderTop: '1px dashed var(--line)', paddingTop: '14px' }}>
                                    <div style={{ background: '#faf5ff', border: '1px solid #f3e8ff', padding: '10px', borderRadius: '8px' }}>
                                      <div style={{ fontSize: '9.5px', fontWeight: 750, color: '#6b21a8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>Clinical Referral Details</div>
                                      <div style={{ fontSize: '12px', color: '#6b21a8', fontWeight: 700 }}>
                                        <i className="bi bi-arrow-up-right-square" style={{ marginRight: '6px' }}></i>
                                        {evt.referral ? (
                                          <span>{evt.referral}</span>
                                        ) : evt.referrals && evt.referrals.length > 0 ? (
                                          evt.referrals.map((ref: any, rid: number) => (
                                            <span key={rid}>
                                              {ref.targetDoc?.name || "Specialist"} (Dept: {ref.targetDoc?.department || "N/A"})
                                            </span>
                                          ))
                                        ) : (
                                          'No referral required'
                                        )}
                                      </div>
                                    </div>
                                    <div style={{ background: '#eff6ff', border: '1px solid #dbeafe', padding: '10px', borderRadius: '8px' }}>
                                      <div style={{ fontSize: '9.5px', fontWeight: 750, color: 'var(--brand-deep)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>Follow-Up Advice &amp; Schedule</div>
                                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--brand-deep)' }}>
                                        <i className="bi bi-calendar-event" style={{ marginRight: '6px' }}></i> {evt.followUp || 'No follow-up advice specified.'}
                                      </div>
                                    </div>
                                  </div>

                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
