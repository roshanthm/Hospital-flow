import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useStore, authFetch } from '../../store/useStore';
import { generateDoctorPatientsTablePDF } from '../../lib/pdfUtils';

export default function DoctorPatientRecords() {
  const navigate = useNavigate();
  const currentUser = useStore(state => state.currentUser);
  const logout = useStore(state => state.logout);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingPatient, setEditingPatient] = useState<any>(null);
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'custom' | 'all'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const queryClient = useQueryClient();

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

  const updatePatientMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await authFetch(`/api/patients/${data.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to update patient');
      return res.json();
    },
    onSuccess: () => {
      toast.success('Patient updated');
      queryClient.invalidateQueries({ queryKey: ['doctorPatients'] });
      setEditingPatient(null);
    },
    onError: (err: any) => toast.error(err.message)
  });

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    await logout();
    navigate('/login');
  };

  // Fetch patients for the current doctor with index-backed server-side filters
  const { data: activePatientsRaw = [], isLoading: isLoadingTokens } = useQuery({
    queryKey: ['doctorPatients', dateFilter, startDate, endDate, searchTerm],
    queryFn: async () => {
      const url = `/api/patients?dateFilter=${dateFilter}&startDate=${startDate || ''}&endDate=${endDate || ''}&search=${encodeURIComponent(searchTerm)}`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error('Failed to fetch patients');
      return res.json();
    }
  });

  const { data: tokens = [] } = useQuery({
    queryKey: ['doctorTokensForNav'],
    queryFn: async () => {
      const res = await authFetch('/api/tokens');
      if (!res.ok) throw new Error('Failed to fetch tokens');
      return res.json();
    }
  });

  let activePatients = activePatientsRaw.map((p: any) => ({
    ...p,
    latestToken: p.tokens && p.tokens.length > 0 ? p.tokens[0] : null,
    latestConsultation: p.consultations && p.consultations.length > 0 ? p.consultations[0] : null,
    latestDate: p.consultations && p.consultations.length > 0 ? p.consultations[0].createdAt : p.createdAt
  }));
  
  // Filter by consultation date: ONLY patients actually consulted by that doctor
  activePatients = activePatients.filter((p: any) => {
    if (!p.latestConsultation) return false;
    const consultTime = new Date(p.latestConsultation.createdAt).getTime();

    if (dateFilter === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return consultTime >= todayStart.getTime();
    }
    if (dateFilter === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);
      return consultTime >= weekAgo.getTime();
    }
    if (dateFilter === 'month') {
      const monthAgo = new Date();
      monthAgo.setDate(monthAgo.getDate() - 30);
      monthAgo.setHours(0, 0, 0, 0);
      return consultTime >= monthAgo.getTime();
    }
    if (dateFilter === 'custom') {
      if (!startDate) return true;
      const sDate = new Date(startDate);
      sDate.setHours(0, 0, 0, 0);
      const eDate = endDate ? new Date(endDate) : new Date();
      eDate.setHours(23, 59, 59, 999);
      return consultTime >= sDate.getTime() && consultTime <= eDate.getTime();
    }
    return true; // "all"
  });

  // Sort by latest interaction descending
  activePatients.sort((a: any, b: any) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());

  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    activePatients = activePatients.filter((p: any) => 
      p.name.toLowerCase().includes(term) || 
      p.id.toLowerCase().includes(term)
    );
  }

  const handleExportReport = () => {
    try {
      if (activePatients.length === 0) {
        toast.error('No visible patient records in the current filtered view to export.');
        return;
      }
      toast.info(`Spooling clinical registry PDF containing ${activePatients.length} visible patient records...`);
      let filterText: string = dateFilter;
      if (dateFilter === 'custom') {
        filterText = `Custom Range: ${startDate || 'unspecified start'} to ${endDate || 'unspecified end'}`;
      } else {
        filterText = dateFilter === 'all' ? 'All Time' : `Past ${dateFilter}`;
      }
      generateDoctorPatientsTablePDF(activePatients, filterText, currentUser?.name || 'MD Staff');
      toast.success('Professional Patient Table Roster PDF download started!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate professional patient table PDF.');
    }
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

  const checkAccessAndNavigate = (route: string) => {
    navigate(route);
  };

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
        .medflow-records *, .medflow-records *::before, .medflow-records *::after {
          box-sizing:border-box;margin:0;padding:0;
        }
        .medflow-records {
          font-family:"Inter",sans-serif;background:var(--page);color:var(--text);min-height:100vh;font-size:14px;
        }
        .medflow-records .shell{display:grid;grid-template-columns:180px 1fr;min-height:100vh;}
        /* Sidebar */
        .medflow-records .sidebar{background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;padding:20px 0;position:sticky;top:0;height:100vh;overflow-y:auto;}
        .medflow-records .brand{display:flex;align-items:center;gap:10px;padding:0 16px 24px;}
        .medflow-records .brand-icon{width:36px;height:36px;background:var(--brand-deep);border-radius:8px;display:grid;place-items:center;color:#fff;font-size:18px;flex-shrink:0;}
        .medflow-records .brand-name{font-size:15px;font-weight:700;color:var(--brand-deep);line-height:1.2;}
        .medflow-records .brand-sub{font-size:9px;color:#9ca3af;letter-spacing:.6px;text-transform:uppercase;}
        .medflow-records .nav{flex:1;padding:0 8px;display:flex;flex-direction:column;gap:2px;}
        .medflow-records .nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;font-size:14px;font-weight:600;color:var(--muted);background:transparent;border:0;cursor:pointer;text-decoration:none;width:100%;text-align:left;}
        .medflow-records .nav-item:hover{background:var(--brand-light);color:var(--brand);}
        .medflow-records .nav-item.active{background:var(--brand);color:#fff;}
        .medflow-records .nav-item i{font-size:16px;flex-shrink:0;}
        .medflow-records .sidebar-footer{padding:12px 8px 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:2px;}
        /* Topbar */
        .medflow-records .main-area{display:flex;flex-direction:column;min-height:100vh;}
        .medflow-records .topbar{height:56px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 24px;position:sticky;top:0;z-index:50;}
        .medflow-records .search-wrap{position:relative;width:340px;}
        .medflow-records .search-wrap i{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:15px;pointer-events:none;z-index:10;}
        .medflow-records .search-wrap input{width:100%;height:40px;border:1.5px solid var(--line);border-radius:9999px;background:var(--page);padding:0 36px 0 38px;font:500 13.5px/1 "Inter",sans-serif;color:var(--text);outline:none;transition:all 0.2s ease-in-out;box-shadow:inset 0 1px 2px rgba(0,0,0,0.05);}
        .medflow-records .search-wrap input:focus{border-color:var(--brand);background:#fff;box-shadow:0 0 0 3px rgba(13,71,161,0.15);}
        .medflow-records .search-item:hover{background:#f8fafc;}
        .medflow-records .topbar-tools{display:flex;align-items:center;gap:6px;}
        .medflow-records .tool-btn{width:36px;height:36px;border:0;background:transparent;border-radius:8px;display:grid;place-items:center;cursor:pointer;color:var(--muted);font-size:18px;}
        .medflow-records .tb-div{width:1px;height:28px;background:var(--line);margin:0 4px;}
        .medflow-records .profile-chip{display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 8px;border-radius:8px;}
        .medflow-records .profile-info{text-align:right;}
        .medflow-records .profile-name{display:block;font-size:14px;font-weight:700;color:var(--text);line-height:1.2;}
        .medflow-records .profile-role{display:block;font-size:11px;font-weight:700;color:var(--brand);letter-spacing:.05em;text-transform:uppercase;margin-top:1px;}
        .medflow-records .avatar{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#9bc2ff,#dce8ff);border:2px solid var(--brand);display:grid;place-items:center;font-size:14px;font-weight:700;color:var(--brand-deep);}
        /* Content */
        .medflow-records .content-area{flex:1;padding:28px;overflow-y:auto;}
        /* Buttons & Badges */
        .medflow-records .btn{display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:38px;border-radius:8px;font:600 14px/1 "Inter",sans-serif;cursor:pointer;border:0;}
        .medflow-records .btn-primary{background:var(--brand);color:#fff;}
        .medflow-records .btn-ghost{background:#fff;color:var(--text);border:1px solid var(--line);}
        .medflow-records .btn-sm{height:32px;padding:0 12px;font-size:13px;}
        .medflow-records .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;}
        .medflow-records .badge-red{background:var(--warn-bg);color:var(--warn);}
        .medflow-records .badge-green{background:#d1fae5;color:#065f46;}
        .medflow-records .badge-orange{background:var(--orange-bg);color:var(--orange);}
        /* Page Header */
        .medflow-records .page-header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap;}
        .medflow-records .page-header h1{font-size:28px;font-weight:800;letter-spacing:-.5px;margin-bottom:4px;}
        .medflow-records .page-header p{font-size:14px;color:var(--muted);}
        /* Mini Stats */
        .medflow-records .mini-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;}
        .medflow-records .mini-stat{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px;box-shadow:var(--shadow);display:flex;align-items:center;gap:12px;}
        .medflow-records .ms-icon{width:44px;height:44px;border-radius:10px;display:grid;place-items:center;font-size:20px;flex-shrink:0;}
        .medflow-records .icon-blue{background:var(--brand-light);color:var(--brand);}
        .medflow-records .icon-green{background:var(--good-bg);color:var(--good);}
        .medflow-records .icon-red{background:var(--warn-bg);color:var(--warn);}
        .medflow-records .icon-gray{background:#f3f4f6;color:#6b7280;}
        .medflow-records .ms-val{font-size:22px;font-weight:800;line-height:1;}
        .medflow-records .ms-lbl{font-size:12px;color:var(--muted);margin-top:3px;}
        /* Filter Row */
        .medflow-records .filter-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
        .medflow-records .inline-search{position:relative;flex:1;max-width:300px;}
        .medflow-records .inline-search i{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:13px;}
        .medflow-records .inline-search input{width:100%;height:38px;border:1px solid var(--line);border-radius:8px;padding:0 12px 0 32px;font:500 14px/1 "Inter",sans-serif;background:var(--page);color:var(--text);outline:none;}
        /* Records Table */
        .medflow-records .rec-wrap{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);overflow:hidden;}
        .medflow-records .r-table{width:100%;border-collapse:collapse;}
        .medflow-records .r-table th{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:11px 16px;border-bottom:1px solid var(--line);text-align:left;background:#fafafa;}
        .medflow-records .r-table td{padding:12px 16px;border-bottom:1px solid var(--line);vertical-align:middle;}
        .medflow-records .r-table tbody tr:last-child td{border-bottom:0;}
        .medflow-records .r-table tbody tr:hover td{background:#fafbfc;}
        .medflow-records .rec-av{width:36px;height:36px;border-radius:999px;display:grid;place-items:center;font-size:12px;font-weight:700;flex-shrink:0;}
        .medflow-records .rec-name{font-weight:600;}
        .medflow-records .rec-sub{font-size:12px;color:var(--muted);margin-top:1px;}
        .medflow-records .icon-act{width:32px;height:32px;border:0;background:var(--page);border-radius:8px;display:inline-grid;place-items:center;cursor:pointer;color:var(--muted);font-size:15px;}
        .medflow-records .icon-act:hover{background:var(--brand-light);color:var(--brand);}
        /* Pagination */
        .medflow-records .pagination{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-top:1px solid var(--line);background:#fafafa;}
        .medflow-records .pg-info{font-size:13px;color:var(--muted);}
        .medflow-records .pg-nums{display:flex;gap:4px;}
        .medflow-records .pg-btn{width:32px;height:32px;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer;font:600 13px/1 "Inter",sans-serif;color:var(--muted);display:grid;place-items:center;}
        .medflow-records .pg-btn.active{background:var(--brand);border-color:var(--brand);color:#fff;}

        /* Media Print Rules */
        @media print {
          body {
            background: #fff !important;
            color: #000 !important;
          }
          .print-header {
            display: flex !important;
          }
          .sidebar, .topbar, .mini-stats, .filter-row, .pagination, .icon-act, .btn, .page-header {
            display: none !important;
          }
          .shell {
            display: block !important;
          }
          .main-area {
            margin: 0 !important;
            padding: 0 !important;
            display: block !important;
          }
          .content-area {
            padding: 0 !important;
            margin: 0 !important;
          }
          .rec-wrap {
            border: none !important;
            box-shadow: none !important;
            margin: 10px 0 !important;
            width: 100% !important;
          }
          .r-table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          .r-table th, .r-table td {
            border: 1px solid #111 !important;
            padding: 10px 12px !important;
            text-align: left !important;
            font-size: 11px !important;
          }
          .rec-sub {
            color: #000 !important;
          }
        }
      `}} />
      
      <div className="medflow-records">
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
              <a className="nav-item active" href="#" onClick={(e) => e.preventDefault()}><i className="bi bi-folder2-open"></i><span>Patient Records</span></a>
              <a className="nav-item" href="#" onClick={(e) => { e.preventDefault(); checkAccessAndNavigate('/doctor/history'); }}><i className="bi bi-clock-history"></i><span>Medical History</span></a>
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

              {/* Page Header */}
              <div className="page-header">
                <div>
                  <h1>Patient Records</h1>
                  <p>Manage and monitor comprehensive patient data and clinical histories.</p>
                </div>
              </div>

              {/* Mini Stats */}
              <div className="mini-stats">
                <div className="mini-stat">
                  <div className="ms-icon icon-blue"><i className="bi bi-people-fill"></i></div>
                  <div><div className="ms-val">{activePatients.length}</div><div className="ms-lbl">Total Patients</div></div>
                </div>
                <div className="mini-stat">
                  <div className="ms-icon icon-green"><i className="bi bi-check-circle-fill"></i></div>
                  <div><div className="ms-val">{activePatients.filter((p: any) => !p.latestToken?.priority || p.latestToken?.priority === 'NORMAL' || p.latestToken?.priority === 'LOW').length}</div><div className="ms-lbl">Stable</div></div>
                </div>
                <div className="mini-stat">
                  <div className="ms-icon icon-red"><i className="bi bi-exclamation-circle-fill"></i></div>
                  <div><div className="ms-val">{activePatients.filter((p: any) => p.latestToken?.priority === 'CRITICAL' || p.latestToken?.priority === 'HIGH').length}</div><div className="ms-lbl">High Risk</div></div>
                </div>
                <div className="mini-stat">
                  <div className="ms-icon icon-gray"><i className="bi bi-eye-fill"></i></div>
                  <div><div className="ms-val">{activePatients.filter((p: any) => p.latestToken?.priority === 'URGENT' || p.latestToken?.priority === 'MEDIUM').length}</div><div className="ms-lbl">In Observation</div></div>
                </div>
              </div>

              {/* Report Print Header (Only visible on print via @media print) */}
              <div className="print-header" style={{ display: 'none', borderBottom: '1.5px solid #000', paddingBottom: '8px', marginBottom: '16px', fontSize: '11px', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><strong>Clinical Registry Export Index</strong> | Attending: {currentUser?.name || "MD Staff"} | Outpatient (OP)</div>
                <div><strong>Printed:</strong> {new Date().toLocaleDateString()} | <strong>Scope:</strong> {dateFilter.toUpperCase()}</div>
              </div>

              {/* Filter Row */}
              <div className="filter-row" style={{display: 'flex', flexDirection: 'column', gap: '12px', background: '#fff', border: '1px solid var(--line)', padding: '16px', borderRadius: '12px', marginBottom: '20px'}}>
                <div style={{display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', width: '100%'}}>
                  <div className="inline-search" style={{flex: '1', minWidth: '200px', maxWidth: '100%'}}>
                    <i className="bi bi-search"></i>
                    <input 
                      type="text" 
                      placeholder="Quick search patient name or ID..." 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  
                  {/* Quick Filters */}
                  <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap'}}>
                    <button 
                      className={`btn btn-sm ${dateFilter === 'today' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setDateFilter('today')}
                    >Today</button>
                    <button 
                      className={`btn btn-sm ${dateFilter === 'week' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setDateFilter('week')}
                    >Past Week</button>
                    <button 
                      className={`btn btn-sm ${dateFilter === 'month' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setDateFilter('month')}
                    >Past Month</button>
                    <button 
                      className={`btn btn-sm ${dateFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setDateFilter('all')}
                    >All Time</button>
                    <button 
                      className={`btn btn-sm ${dateFilter === 'custom' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setDateFilter('custom')}
                    >Custom Range</button>
                  </div>

                  <button 
                    className="btn btn-sm" 
                    style={{marginLeft: 'auto', background: '#ebf5ff', color: '#0055cc', border: '1px solid #99ccff', fontWeight: 600}} 
                    onClick={handleExportReport}
                  >
                    <i className="bi bi-file-earmark-pdf"></i> Export Report (PDF)
                  </button>
                </div>

                {dateFilter === 'custom' && (
                  <div style={{display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid var(--line)'}}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                      <span style={{fontSize: '12px', fontWeight: 600, color: 'var(--muted)'}}>Start Date:</span>
                      <input 
                        type="date" 
                        value={startDate} 
                        onChange={(e) => setStartDate(e.target.value)} 
                        style={{padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--line)', background: '#fff', fontSize: '12px'}}
                      />
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                      <span style={{fontSize: '12px', fontWeight: 600, color: 'var(--muted)'}}>End Date:</span>
                      <input 
                        type="date" 
                        value={endDate} 
                        onChange={(e) => setEndDate(e.target.value)} 
                        style={{padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--line)', background: '#fff', fontSize: '12px'}}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Records Table */}
              <div className="rec-wrap">
                <table className="r-table">
                  <thead>
                    <tr>
                      <th>Patient Name</th>
                      <th>Patient ID</th>
                      <th>Phone Number</th>
                      <th>Doctor Name</th>
                      <th>Primary Care</th>
                      <th>Status</th>
                      <th>Last Interaction</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingTokens ? (
                      <tr><td colSpan={8} style={{textAlign: 'center', padding: '20px'}}>Loading records...</td></tr>
                    ) : activePatients.length === 0 ? (
                      <tr><td colSpan={8} style={{textAlign: 'center', padding: '20px'}}>No patient records found</td></tr>
                    ) : (
                      activePatients.map((patient: any, index: number) => {
                        const patColors = [
                          { bg: '#dbeafe', text: '#1e40af' }, // Blue
                          { bg: '#fee2e2', text: '#991b1b' }, // Red
                          { bg: '#ffedd5', text: '#9a3412' }, // Orange
                          { bg: '#ede9fe', text: '#5b21b6' }, // Purple
                          { bg: '#d1fae5', text: '#065f46' },  // Green
                        ];
                        const colorClass = patColors[index % patColors.length];
                        const initials = patient.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase();
                        
                        // Use token priority for status
                        let statusBadge;
                        const priority = patient.latestToken?.priority || 'NORMAL';
                        if (priority === 'CRITICAL' || priority === 'HIGH') {
                          statusBadge = <span className="badge badge-red">{priority}</span>;
                        } else if (priority === 'URGENT') {
                          statusBadge = <span className="badge badge-orange">{priority}</span>;
                        } else {
                          statusBadge = <span className="badge badge-green">{priority || 'STABLE'}</span>;
                        }

                        const docName = patient.latestConsultation?.doctor?.name 
                          ? `Dr. ${patient.latestConsultation.doctor.name}`
                          : `Dr. ${currentUser?.name || 'MD Staff'}`;

                        const department = patient.latestConsultation?.doctor?.department || 'General Practice';

                        return (
                          <tr key={patient.id}>
                            <td>
                              <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                                <div className="rec-av" style={{background: colorClass.bg, color: colorClass.text}}>
                                  {initials}
                                </div>
                                <div>
                                  <div className="rec-name">{patient.name}</div>
                                  <div className="rec-sub">{patient.age || 'N/A'} years &bull; {patient.gender || 'Unknown'}</div>
                                </div>
                              </div>
                            </td>
                            <td style={{fontSize: '13px', color: 'var(--muted)', fontWeight: 600}}>PT-{patient.id.substring(0,8).toUpperCase()}</td>
                            <td style={{fontSize: '13px', color: 'var(--text)'}}>{patient.phone || 'N/A'}</td>
                            <td style={{fontSize: '13px', color: 'var(--text)', fontWeight: 500}}>{docName}</td>
                            <td style={{fontSize: '13px', color: 'var(--muted)'}}>{department}</td>
                            <td>{statusBadge}</td>
                            <td style={{color: 'var(--muted)', fontSize: '13px'}}>
                              {new Date(patient.latestDate).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}
                            </td>
                            <td>
                              <div style={{display: 'flex', gap: '6px'}}>
                                <button className="icon-act" title="View History" onClick={() => checkAccessAndNavigate(`/doctor/history/${patient.id}`)}><i className="bi bi-eye"></i></button>
                                <button className="icon-act" title="Edit Profile" onClick={() => setEditingPatient(patient)}><i className="bi bi-pencil"></i></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                <div className="pagination">
                  <span className="pg-info">Showing {activePatients.length > 0 ? 1 : 0} to {activePatients.length} of {activePatients.length} patients</span>
                  <div className="pg-nums">
                    <button className="pg-btn"><i className="bi bi-chevron-left"></i></button>
                    <button className="pg-btn active">1</button>
                    <button className="pg-btn"><i className="bi bi-chevron-right"></i></button>
                  </div>
                </div>
              </div>

            </main>
          </div>
        </div>

        {editingPatient && (
          <div style={{position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000}}>
            <div style={{background: '#fff', padding: '24px', borderRadius: '12px', width: '400px', maxWidth: '90%'}}>
              <h3 style={{marginTop: 0, marginBottom: '20px', fontSize: '18px', fontWeight: 600}}>Edit Patient Profile</h3>
              <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                updatePatientMutation.mutate({
                  id: editingPatient.id,
                  name: formData.get('name'),
                  phone: formData.get('phone'),
                  age: formData.get('age'),
                  gender: formData.get('gender'),
                  bloodGroup: formData.get('bloodGroup'),
                  address: formData.get('address'),
                  emergencyContactName: formData.get('emergencyContactName'),
                  emergencyContactPhone: formData.get('emergencyContactPhone'),
                });
              }}>
                <div style={{marginBottom: '12px'}}>
                  <label style={{display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)'}}>Patient Name</label>
                  <input name="name" defaultValue={editingPatient.name} style={{width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--line)'}} />
                </div>
                <div style={{marginBottom: '12px'}}>
                  <label style={{display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)'}}>Phone</label>
                  <input name="phone" defaultValue={editingPatient.phone} style={{width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--line)'}} />
                </div>
                <div style={{marginBottom: '12px'}}>
                  <label style={{display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)'}}>Age & Gender</label>
                  <div style={{display: 'flex', gap: '8px'}}>
                    <input name="age" type="number" defaultValue={editingPatient.age} style={{width: '100px', padding: '8px', borderRadius: '6px', border: '1px solid var(--line)'}} />
                    <select name="gender" defaultValue={editingPatient.gender} style={{width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--line)'}}>
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                      <option value="O">Other</option>
                    </select>
                  </div>
                </div>
                <div style={{marginBottom: '12px'}}>
                  <label style={{display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)'}}>Blood Group</label>
                  <input name="bloodGroup" defaultValue={editingPatient.bloodGroup} style={{width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--line)'}} />
                </div>
                <div style={{marginBottom: '12px'}}>
                  <label style={{display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 600, color: 'var(--muted)'}}>Address</label>
                  <input name="address" defaultValue={editingPatient.address} style={{width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--line)'}} />
                </div>
                <div style={{display: 'flex', gap: '10px', marginTop: '20px'}}>
                  <button type="button" onClick={() => setEditingPatient(null)} style={{flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', fontWeight: 600}}>Cancel</button>
                  <button type="submit" style={{flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: 'var(--brand)', color: '#fff', cursor: 'pointer', fontWeight: 600}} disabled={updatePatientMutation.isPending}>{updatePatientMutation.isPending ? 'Saving...' : 'Save Profile'}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
