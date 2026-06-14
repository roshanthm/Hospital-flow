import React, { useState } from 'react';
import { useStore, authFetch } from '../../store/useStore';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export default function DoctorDashboard() {
  const { currentUser, logout, updateDutyStatus, fetchMe } = useStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [modalTitle, setModalTitle] = useState('');
  const [modalDescription, setModalDescription] = useState('');
  const [modalPriority, setModalPriority] = useState('MEDIUM');
  const [modalReminderDate, setModalReminderDate] = useState('');
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 5;

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

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    await logout();
    navigate('/login');
  };

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['doctorTokens'],
    queryFn: async () => {
      const res = await authFetch('/api/tokens');
      if (!res.ok) throw new Error('Failed to fetch tokens');
      return res.json();
    },
    refetchInterval: 30000
  });

  const { data: tasks = [], isLoading: isLoadingTasks } = useQuery({
    queryKey: ['doctorTasks'],
    queryFn: async () => {
      const res = await authFetch('/api/tasks');
      if (!res.ok) throw new Error('Failed to fetch tasks');
      return res.json();
    }
  });

  const createTask = useMutation({
    mutationFn: async (data: { title: string, description?: string, priority?: string, reminderDate?: string }) => {
      const res = await authFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to create task');
      return res.json();
    },
    onSuccess: (newTask) => {
      queryClient.setQueryData(['doctorTasks'], (old: any) => [newTask, ...(old || [])]);
      queryClient.invalidateQueries({ queryKey: ['doctorTasks'] });
      toast.success('Task/Reminder created successfully');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to create task');
    }
  });
  
  const updateTask = useMutation({
    mutationFn: async ({ id, ...fields }: { id: string, title?: string, description?: string, priority?: string, reminderDate?: string, isCompleted?: boolean }) => {
      const res = await authFetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
      if (!res.ok) throw new Error('Failed to update task');
      return res.json();
    },
    onSuccess: (updatedTask) => {
      queryClient.setQueryData(['doctorTasks'], (old: any) => 
        (old || []).map((t: any) => t.id === updatedTask.id ? updatedTask : t)
      );
      queryClient.invalidateQueries({ queryKey: ['doctorTasks'] });
      toast.success('Task/Reminder updated');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update task');
    }
  });

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/tasks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete task');
      return res.json();
    },
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: ['doctorTasks'] });
      const previousTasks = queryClient.getQueryData(['doctorTasks']);
      queryClient.setQueryData(['doctorTasks'], (old: any) => 
        (old || []).filter((t: any) => t.id !== deletedId)
      );
      return { previousTasks };
    },
    onError: (err: any, deletedId, context: any) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['doctorTasks'], context.previousTasks);
      }
      toast.error(err.message || 'Failed to delete task');
    },
    onSuccess: (data, deletedId) => {
      const idToFilter = data?.id || deletedId;
      queryClient.setQueryData(['doctorTasks'], (old: any) => 
        (old || []).filter((t: any) => t.id !== idToFilter)
      );
      queryClient.invalidateQueries({ queryKey: ['doctorTasks'] });
      toast.success('Task deleted successfully');
    }
  });

  const handleSaveTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalTitle.trim()) {
      toast.error('Task title is required');
      return;
    }

    const payload = {
      title: modalTitle,
      description: modalDescription,
      priority: modalPriority,
      reminderDate: modalReminderDate
    };

    if (editingTask) {
      updateTask.mutate({ id: editingTask.id, ...payload }, {
        onSuccess: () => {
          setIsModalOpen(false);
          resetModalFields();
        }
      });
    } else {
      createTask.mutate(payload, {
        onSuccess: () => {
          setIsModalOpen(false);
          resetModalFields();
        }
      });
    }
  };

  const openCreateModal = () => {
    setEditingTask(null);
    setModalTitle('');
    setModalDescription('');
    setModalPriority('MEDIUM');
    setModalReminderDate('');
    setIsModalOpen(true);
  };

  const openEditModal = (task: any) => {
    setEditingTask(task);
    setModalTitle(task.title || '');
    setModalDescription(task.description || '');
    setModalPriority(task.priority || 'MEDIUM');
    setModalReminderDate(task.reminderDate || '');
    setIsModalOpen(true);
  };

  const resetModalFields = () => {
    setEditingTask(null);
    setModalTitle('');
    setModalDescription('');
    setModalPriority('MEDIUM');
    setModalReminderDate('');
  };

  const handleDeleteClick = (id: string) => {
    deleteTask.mutate(id);
  };

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await authFetch(`/api/tokens/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Failed to update status');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doctorTokens'] });
    },
    onError: (err: any) => {
      toast.error(err.message);
    }
  });

  const activeTokens = tokens
    .filter((t: any) => t.status === 'WAITING' || t.status === 'CALLED' || t.status === 'IN_CONSULTATION')
    // Oldest first for FIFO
    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const checkAccessAndNavigate = (route: string) => {
    navigate(route);
  };

  const handleStartConsultation = (tokenId: string, status: string) => {

    if (status === 'WAITING') {
      updateStatus.mutate({ id: tokenId, status: 'IN_CONSULTATION' }, {
        onSuccess: () => {
          navigate(`/doctor/consultation/${tokenId}`);
        }
      });
    } else {
      navigate(`/doctor/consultation/${tokenId}`);
    }
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
        .medflow-doctor-dashboard *, .medflow-doctor-dashboard *::before, .medflow-doctor-dashboard *::after {
          box-sizing:border-box;margin:0;padding:0;
        }
        .medflow-doctor-dashboard {
          font-family:"Inter",sans-serif;background:var(--page);color:var(--text);min-height:100vh;font-size:14px;
        }
        .medflow-doctor-dashboard .shell{display:grid;grid-template-columns:180px 1fr;min-height:100vh;}
        /* Sidebar */
        .medflow-doctor-dashboard .sidebar{background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;padding:20px 0;position:sticky;top:0;height:100vh;overflow-y:auto;}
        .medflow-doctor-dashboard .brand{display:flex;align-items:center;gap:10px;padding:0 16px 24px;}
        .medflow-doctor-dashboard .brand-icon{width:36px;height:36px;background:var(--brand-deep);border-radius:8px;display:grid;place-items:center;color:#fff;font-size:18px;flex-shrink:0;}
        .medflow-doctor-dashboard .brand-name{font-size:15px;font-weight:700;color:var(--brand-deep);line-height:1.2;}
        .medflow-doctor-dashboard .brand-sub{font-size:9px;color:#9ca3af;letter-spacing:.6px;text-transform:uppercase;}
        .medflow-doctor-dashboard .nav{flex:1;padding:0 8px;display:flex;flex-direction:column;gap:2px;}
        .medflow-doctor-dashboard .nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;font-size:14px;font-weight:600;color:var(--muted);background:transparent;border:0;cursor:pointer;text-decoration:none;width:100%;text-align:left;}
        .medflow-doctor-dashboard .nav-item:hover{background:var(--brand-light);color:var(--brand);}
        .medflow-doctor-dashboard .nav-item.active{background:var(--brand);color:#fff;}
        .medflow-doctor-dashboard .nav-item i{font-size:16px;flex-shrink:0;}
        .medflow-doctor-dashboard .sidebar-footer{padding:12px 8px 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:2px;}
        /* Topbar */
        .medflow-doctor-dashboard .main-area{display:flex;flex-direction:column;min-height:100vh;}
        .medflow-doctor-dashboard .topbar{height:56px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 24px;position:sticky;top:0;z-index:50;}
        .medflow-doctor-dashboard .search-wrap{position:relative;width:340px;}
        .medflow-doctor-dashboard .search-wrap i{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:15px;pointer-events:none;z-index:10;}
        .medflow-doctor-dashboard .search-wrap input{width:100%;height:40px;border:1.5px solid var(--line);border-radius:9999px;background:var(--page);padding:0 36px 0 38px;font:500 13.5px/1 "Inter",sans-serif;color:var(--text);outline:none;transition:all 0.2s ease-in-out;box-shadow:inset 0 1px 2px rgba(0,0,0,0.05);}
        .medflow-doctor-dashboard .search-wrap input:focus{border-color:var(--brand);background:#fff;box-shadow:0 0 0 3px rgba(13,71,161,0.15);}
        .medflow-doctor-dashboard .topbar-tools{display:flex;align-items:center;gap:6px;}
        .medflow-doctor-dashboard .tool-btn{width:36px;height:36px;border:0;background:transparent;border-radius:8px;display:grid;place-items:center;cursor:pointer;color:var(--muted);font-size:18px;}
        .medflow-doctor-dashboard .tb-div{width:1px;height:28px;background:var(--line);margin:0 4px;}
        .medflow-doctor-dashboard .profile-chip{display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 8px;border-radius:8px;}
        .medflow-doctor-dashboard .profile-info{text-align:right;}
        .medflow-doctor-dashboard .profile-name{display:block;font-size:14px;font-weight:700;color:var(--text);line-height:1.2;}
        .medflow-doctor-dashboard .profile-role{display:block;font-size:11px;font-weight:700;color:var(--brand);letter-spacing:.05em;text-transform:uppercase;margin-top:1px;}
        .medflow-doctor-dashboard .avatar{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#9bc2ff,#dce8ff);border:2px solid var(--brand);display:grid;place-items:center;font-size:14px;font-weight:700;color:var(--brand-deep);}
        /* Content */
        .medflow-doctor-dashboard .content-area{flex:1;padding:28px;overflow-y:auto;}
        /* Buttons & Badges */
        .medflow-doctor-dashboard .btn{display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:38px;border-radius:8px;font:600 14px/1 "Inter",sans-serif;cursor:pointer;border:0;}
        .medflow-doctor-dashboard .btn-primary{background:var(--brand);color:#fff;}
        .medflow-doctor-dashboard .btn-outline{background:#fff;color:var(--brand);border:1.5px solid var(--brand);}
        .medflow-doctor-dashboard .btn-ghost{background:#fff;color:var(--text);border:1px solid var(--line);}
        .medflow-doctor-dashboard .btn-sm{height:32px;padding:0 12px;font-size:13px;}
        .medflow-doctor-dashboard .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;}
        .medflow-doctor-dashboard .badge-red{background:var(--warn-bg);color:var(--warn);}
        .medflow-doctor-dashboard .badge-green{background:#d1fae5;color:#065f46;}
        .medflow-doctor-dashboard .badge-gray{background:#f3f4f6;color:#6b7280;}
        /* Stats Row */
        .medflow-doctor-dashboard .stats-row{display:grid;grid-template-columns:repeat(3, 1fr);gap:14px;margin-bottom:20px;}
        .medflow-doctor-dashboard .stat-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;box-shadow:var(--shadow);}
        .medflow-doctor-dashboard .stat-card.blue-card{background:var(--brand);border-color:var(--brand);color:#fff;}
        .medflow-doctor-dashboard .stat-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}
        .medflow-doctor-dashboard .stat-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:10px;}
        .medflow-doctor-dashboard .blue-card .stat-lbl,.medflow-doctor-dashboard .blue-card .stat-sub{color:rgba(255,255,255,.75);}
        .medflow-doctor-dashboard .stat-val{font-size:34px;font-weight:800;line-height:1;color:var(--text);}
        .medflow-doctor-dashboard .stat-val.danger{color:var(--warn);}
        .medflow-doctor-dashboard .blue-card .stat-val{color:#fff;}
        .medflow-doctor-dashboard .stat-icon{font-size:22px;color:var(--line);}
        .medflow-doctor-dashboard .blue-card .stat-icon{color:rgba(255,255,255,.4);}
        .medflow-doctor-dashboard .stat-sub{font-size:12px;color:var(--muted);margin-top:8px;}
        .medflow-doctor-dashboard .stat-trend{display:flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--good);margin-top:4px;}
        .medflow-doctor-dashboard .blue-card-desc{font-size:13px;line-height:1.5;color:rgba(255,255,255,.9);margin:8px 0 14px;}
        /* Queue Table */
        .medflow-doctor-dashboard .queue-section{background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);margin-bottom:20px;overflow:hidden;}
        .medflow-doctor-dashboard .queue-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--line);}
        .medflow-doctor-dashboard .queue-head-title h2{font-size:17px;font-weight:700;margin-bottom:2px;}
        .medflow-doctor-dashboard .queue-head-title p{font-size:13px;color:var(--muted);}
        .medflow-doctor-dashboard .queue-head-actions{display:flex;gap:8px;}
        .medflow-doctor-dashboard table{width:100%;border-collapse:collapse;}
        .medflow-doctor-dashboard .q-table th{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:11px 16px;border-bottom:1px solid var(--line);text-align:left;background:#fafafa;}
        .medflow-doctor-dashboard .q-table td{padding:14px 16px;border-bottom:1px solid var(--line);vertical-align:middle;}
        .medflow-doctor-dashboard .q-table tbody tr:last-child td{border-bottom:0;}
        .medflow-doctor-dashboard .q-table tbody tr:hover td{background:#fafbfc;}
        .medflow-doctor-dashboard .token-id{font-size:13px;font-weight:700;color:var(--brand);}
        .medflow-doctor-dashboard .pat-chip{display:flex;align-items:center;gap:10px;}
        .medflow-doctor-dashboard .pat-av{width:36px;height:36px;border-radius:999px;display:grid;place-items:center;font-size:13px;font-weight:700;flex-shrink:0;}
        .medflow-doctor-dashboard .av-jm{background:#dbeafe;color:#1e40af;} 
        .medflow-doctor-dashboard .av-sc{background:#d1fae5;color:#065f46;}
        .medflow-doctor-dashboard .av-rd{background:#f3f4f6;color:#374151;} 
        .medflow-doctor-dashboard .av-el{background:#ede9fe;color:#6d28d9;}
        .medflow-doctor-dashboard .pat-name{font-size:14px;font-weight:600;}
        .medflow-doctor-dashboard .symptoms-text{font-size:13px;color:var(--muted);max-width:180px;}
        /* Bottom Row */
        .medflow-doctor-dashboard .bottom-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;}
        .medflow-doctor-dashboard .mini-sect{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:var(--shadow);}
        .medflow-doctor-dashboard .ms-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:12px;}
        .medflow-doctor-dashboard .approval-row{display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line);}
        .medflow-doctor-dashboard .approval-row:last-child{border-bottom:0;padding-bottom:0;}
        .medflow-doctor-dashboard .approval-name{font-size:13px;font-weight:600;}
        .medflow-doctor-dashboard .check-btn{width:28px;height:28px;border:0;background:var(--good-bg);border-radius:999px;display:grid;place-items:center;cursor:pointer;color:var(--good);font-size:14px;}
        .medflow-doctor-dashboard .session-row{display:flex;gap:12px;}
        .medflow-doctor-dashboard .sess-time{font-size:12px;font-weight:700;color:var(--muted);width:42px;flex-shrink:0;line-height:1.4;}
        .medflow-doctor-dashboard .sess-info strong{display:block;font-size:14px;font-weight:700;}
        .medflow-doctor-dashboard .sess-info span{font-size:12px;color:var(--muted);}
        .medflow-doctor-dashboard .create-task{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:72px;cursor:pointer;text-align:center;gap:8px;}
        .medflow-doctor-dashboard .ct-icon{width:40px;height:40px;border:2px dashed var(--line);border-radius:999px;display:grid;place-items:center;font-size:20px;color:var(--muted);}
        .medflow-doctor-dashboard .create-task p{font-size:13px;font-weight:600;color:var(--muted);}
        /* Pagination */
        .medflow-doctor-dashboard .pagination{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-top:1px solid var(--line);background:#fafafa;}
        .medflow-doctor-dashboard .pg-info{font-size:13px;color:var(--muted);}
        .medflow-doctor-dashboard .pg-nums{display:flex;gap:4px;}
        .medflow-doctor-dashboard .pg-btn{width:32px;height:32px;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer;font:600 13px/1 "Inter",sans-serif;color:var(--muted);display:grid;place-items:center;}
        .medflow-doctor-dashboard .pg-btn.active{background:var(--brand);border-color:var(--brand);color:#fff;}
        .medflow-doctor-dashboard .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(17, 24, 39, 0.4);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000;
        }
        .medflow-doctor-dashboard .modal-content {
          background: #fff; border-radius: 12px; width: 480px; max-width: 90%;
          border: 1px solid var(--line); box-shadow: 0 4px 20px rgba(0,0,0,.15);
          overflow: hidden;
        }
        .medflow-doctor-dashboard .modal-header {
          padding: 16px 20px; border-bottom: 1px solid var(--line);
          display: flex; align-items: center; justify-content: space-between;
        }
        .medflow-doctor-dashboard .modal-body {
          padding: 20px; display: flex; flex-direction: column; gap: 14px;
        }
        .medflow-doctor-dashboard .modal-footer {
          padding: 14px 20px; background: #fafafa; border-top: 1px solid var(--line);
          display: flex; justify-content: flex-end; gap: 10px;
        }
        .medflow-doctor-dashboard .search-item {
          transition: background 0.2s;
        }
        .medflow-doctor-dashboard .search-item:hover {
          background: #f3f4f6;
        }
      `}} />
      <div className="medflow-doctor-dashboard">
        <div className="shell">
          {/* Sidebar */}
          <aside className="sidebar">
            <div className="brand">
              <div className="brand-icon"><i className="bi bi-hospital"></i></div>
              <div><div className="brand-name">MedFlow</div><div className="brand-sub">Clinical Precision</div></div>
            </div>
            <nav className="nav">
              <a className="nav-item active" href="#" onClick={(e) => e.preventDefault()}><i className="bi bi-people"></i><span>Patient Queue</span></a>
              <a className="nav-item" href="#" onClick={(e) => {
                e.preventDefault();
                const token = activeTokens.find((t: any) => t.status === 'IN_CONSULTATION') || activeTokens[0];
                if (token) handleStartConsultation(token.id, token.status);
                else toast.info('No active consultations available.');
              }}><i className="bi bi-clipboard2-pulse"></i><span>Consultations</span></a>
              <a className="nav-item" href="#" onClick={(e) => { e.preventDefault(); checkAccessAndNavigate('/doctor/records'); }}><i className="bi bi-folder2-open"></i><span>Patient Records</span></a>
              <a className="nav-item" href="#" onClick={(e) => { e.preventDefault(); checkAccessAndNavigate('/doctor/history'); }}><i className="bi bi-clock-history"></i><span>Medical History</span></a>
            </nav>
            <div className="sidebar-footer">
              <a className="nav-item" href="#"><i className="bi bi-gear"></i><span>Settings</span></a>
              <a className="nav-item cursor-pointer" onClick={handleLogout}><i className="bi bi-box-arrow-left"></i><span>Logout</span></a>
            </div>
          </aside>

          <div className="main-area">
            {/* Topbar */}
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
                    <span className="profile-name">{currentUser?.name || 'Dr. Sarah Connor'}</span>
                    <span className="profile-role">Doctor</span>
                  </div>
                  <div className="avatar">{currentUser?.name?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'DSC'}</div>
                </div>
              </div>
            </header>

            {/* Content */}
            <main className="content-area">

              {/* Stats Row */}
              <div className="stats-row">
                <div className="stat-card">
                  <div className="stat-lbl">Total Waiting</div>
                  <div className="stat-top">
                    <div>
                      <div className="stat-val">{activeTokens.length < 10 ? `0${activeTokens.length}` : activeTokens.length}</div>
                      <div className="stat-trend"><i className="bi bi-arrow-up-short"></i>+2 since 08:00 AM</div>
                    </div>
                    <i className="bi bi-people stat-icon"></i>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">Emergency Cases</div>
                  <div className="stat-top">
                    <div>
                      <div className="stat-val danger">
                        {(() => {
                          const count = activeTokens.filter((t: any) => 
                            ['HIGH', 'URGENT', 'EMERGENCY', 'CRITICAL'].includes(t.priority?.toUpperCase() || '')
                          ).length;
                          return count < 10 ? `0${count}` : count;
                        })()}
                      </div>
                      <div className="stat-sub">Requires immediate review</div>
                    </div>
                    <i className="bi bi-asterisk stat-icon" style={{color: 'var(--warn)', opacity: 0.5}}></i>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-lbl">Avg. Wait Time</div>
                  <div className="stat-top">
                    <div>
                      <div className="stat-val">{activeTokens.length > 0 ? Math.floor(activeTokens.reduce((acc: number, t: any) => acc + (new Date().getTime() - new Date(t.createdAt).getTime()), 0) / activeTokens.length / 60000) : 0}<span style={{fontSize: '22px', fontWeight: 700}}> m</span></div>
                      <div className="stat-sub">Efficiency stable</div>
                    </div>
                    <i className="bi bi-clock stat-icon"></i>
                  </div>
                </div>
              </div>

              {/* Queue Table */}
              <div className="queue-section">
                <div className="queue-head">
                  <div className="queue-head-title">
                    <h2>Live Patient Queue</h2>
                    <p>Real-time status of current waiting list</p>
                  </div>
                  <div className="queue-head-actions">
                    <button className="btn btn-ghost btn-sm"><i className="bi bi-filter"></i> Filter List</button>
                    <button className="btn btn-primary btn-sm"><i className="bi bi-arrow-clockwise"></i> Refresh Queue</button>
                  </div>
                </div>
                <table className="q-table">
                  <thead>
                    <tr>
                      <th>Token ID</th><th>Patient Name</th><th>Priority</th>
                      <th>Wait Time</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr><td colSpan={5} style={{textAlign: 'center', padding: '20px'}}>Loading...</td></tr>
                    ) : activeTokens.length === 0 ? (
                      <tr><td colSpan={5} style={{textAlign: 'center', padding: '20px'}}>No patients in queue</td></tr>
                    ) : (
                      (() => {
                        const totalQueueEntries = activeTokens.length;
                        const totalQueuePages = Math.ceil(totalQueueEntries / ITEMS_PER_PAGE) || 1;
                        const validPage = currentPage > totalQueuePages ? totalQueuePages : currentPage;
                        const paginatedList = activeTokens.slice((validPage - 1) * ITEMS_PER_PAGE, validPage * ITEMS_PER_PAGE);

                        return paginatedList.map((token: any, index: number) => {
                          const patColors = ['av-jm', 'av-sc', 'av-rd', 'av-el'];
                          // Map index relative to full activeTokens array
                          const fullIdx = (validPage - 1) * ITEMS_PER_PAGE + index;
                          const colorClass = patColors[fullIdx % patColors.length];
                          const initials = token.patient?.name ? token.patient.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() : 'PT';
                          
                          const calculateWaitTime = (createdAt: string) => {
                            const diff = new Date().getTime() - new Date(createdAt).getTime();
                            const m = Math.floor(diff / 60000);
                            const s = Math.floor((diff % 60000) / 1000);
                            return `${m}m ${s}s`;
                          };
                          const waitTime = calculateWaitTime(token.createdAt);
                          
                          return (
                            <tr key={token.id} onClick={() => handleStartConsultation(token.id, token.status)} style={{cursor: 'pointer'}}>
                              <td><span className="token-id">{token.tokenNumber}</span></td>
                              <td><div className="pat-chip"><div className={`pat-av ${colorClass}`}>{initials}</div><span className="pat-name">{token.patient?.name}</span></div></td>
                              <td>
                                {['HIGH', 'URGENT', 'EMERGENCY', 'CRITICAL'].includes(token.priority?.toUpperCase() || '') ? (
                                  <span className="badge badge-red">
                                    <i className="bi bi-circle-fill" style={{fontSize: '7px'}}></i>
                                    {token.priority}
                                  </span>
                                ) : (
                                  <span className="badge" style={{background: '#f3f4f6', color: '#6b7280'}}>
                                    {token.priority || 'NORMAL'}
                                  </span>
                                )}
                              </td>
                              <td>
                                <span style={{
                                  fontWeight: 600, 
                                  color: ['HIGH', 'URGENT', 'EMERGENCY', 'CRITICAL'].includes(token.priority?.toUpperCase() || '') ? 'var(--warn)' : 'inherit'
                                }}>
                                  {waitTime}
                                </span>
                              </td>
                              <td>
                                <button 
                                  className={`btn ${token.status === 'IN_CONSULTATION' ? 'btn-primary' : 'btn-outline'} btn-sm`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartConsultation(token.id, token.status);
                                  }}
                                  disabled={updateStatus.isPending}
                                >
                                  {token.status === 'IN_CONSULTATION' ? 'Resume' : 'Start'}
                                </button>
                              </td>
                            </tr>
                          );
                        });
                      })()
                    )}
                  </tbody>
                </table>
                {(() => {
                  const totalQueueEntries = activeTokens.length;
                  const totalQueuePages = Math.ceil(totalQueueEntries / ITEMS_PER_PAGE) || 1;
                  const validPage = currentPage > totalQueuePages ? totalQueuePages : currentPage;
                  const startItemIdx = totalQueueEntries === 0 ? 0 : (validPage - 1) * ITEMS_PER_PAGE + 1;
                  const endItemIdx = Math.min(validPage * ITEMS_PER_PAGE, totalQueueEntries);

                  return (
                    <div className="pagination">
                      <span className="pg-info">Showing {startItemIdx} to {endItemIdx} of {totalQueueEntries} patients in queue</span>
                      <div className="pg-nums">
                        <button 
                          className="pg-btn" 
                          disabled={validPage === 1}
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          style={{ opacity: validPage === 1 ? 0.5 : 1, cursor: validPage === 1 ? 'not-allowed' : 'pointer' }}
                        >
                          <i className="bi bi-chevron-left"></i>
                        </button>
                        {Array.from({ length: totalQueuePages }, (_, i) => i + 1).map((pgNum) => (
                          <button 
                            key={pgNum} 
                            className={`pg-btn ${validPage === pgNum ? 'active' : ''}`}
                            onClick={() => setCurrentPage(pgNum)}
                          >
                            {pgNum}
                          </button>
                        ))}
                        <button 
                          className="pg-btn" 
                          disabled={validPage === totalQueuePages}
                          onClick={() => setCurrentPage(prev => Math.min(totalQueuePages, prev + 1))}
                          style={{ opacity: validPage === totalQueuePages ? 0.5 : 1, cursor: validPage === totalQueuePages ? 'not-allowed' : 'pointer' }}
                        >
                          <i className="bi bi-chevron-right"></i>
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Tasks & Duty Status Side-by-Side Grid (Freed approx 50% width from tasks) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '24px' }}>
                {/* Left Side: Tasks & Productivity Reminders Panel */}
                {(() => {
                  const filteredTasks = tasks.filter((t: any) => {
                    if (taskFilter === 'pending') return !t.isCompleted;
                    if (taskFilter === 'completed') return t.isCompleted;
                    return true;
                  });

                  return (
                    <div className="queue-section" style={{ margin: 0 }}>
                      <div className="queue-head" style={{ borderBottom: '1px solid var(--line)' }}>
                        <div className="queue-head-title">
                          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <i className="bi bi-journal-check" style={{ color: 'var(--brand)' }}></i>
                            Tasks & Reminders
                          </h2>
                          <p>Schedule clinician tasks, reminders, and patient organizer</p>
                        </div>
                        <div className="queue-head-actions">
                          <button className="btn btn-primary btn-sm" onClick={() => openCreateModal()}>
                            <i className="bi bi-plus-lg"></i> Create Task
                          </button>
                        </div>
                      </div>

                      {/* Filter Tabs */}
                      <div style={{ display: 'flex', gap: '8px', padding: '12px 20px', background: '#fafafa', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
                        <button 
                          className={`btn btn-sm ${taskFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`} 
                          onClick={() => setTaskFilter('all')}
                          style={{ height: '28px', fontSize: '12px', padding: '0 12px' }}
                        >
                          All ({tasks.length})
                        </button>
                        <button 
                          className={`btn btn-sm ${taskFilter === 'pending' ? 'btn-primary' : 'btn-ghost'}`} 
                          onClick={() => setTaskFilter('pending')}
                          style={{ height: '28px', fontSize: '12px', padding: '0 12px' }}
                        >
                          Pending ({tasks.filter((t: any) => !t.isCompleted).length})
                        </button>
                        <button 
                          className={`btn btn-sm ${taskFilter === 'completed' ? 'btn-primary' : 'btn-ghost'}`} 
                          onClick={() => setTaskFilter('completed')}
                          style={{ height: '28px', fontSize: '12px', padding: '0 12px' }}
                        >
                          Completed ({tasks.filter((t: any) => t.isCompleted).length})
                        </button>
                      </div>

                      {/* Task grid container */}
                      {isLoadingTasks ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                          Loading tasks and reminders...
                        </div>
                      ) : filteredTasks.length === 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '50px 20px', color: 'var(--muted)', gap: '12px' }}>
                          <div className="ct-icon" style={{ cursor: 'pointer', display: 'grid', placeItems: 'center', width: '50px', height: '50px', border: '2px dashed var(--line)', borderRadius: '50%' }} onClick={() => openCreateModal()}>
                            <i className="bi bi-journal-plus" style={{ fontSize: '24px' }}></i>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <p style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text)' }}>No tasks or reminders here</p>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px', padding: '16px', maxHeight: '310px', overflowY: 'auto' }}>
                          {filteredTasks.map((task: any) => (
                            <div 
                              key={task.id} 
                              style={{
                                background: '#fff',
                                border: '1px solid var(--line)',
                                borderRadius: '12px',
                                padding: '12px 16px',
                                boxShadow: 'var(--shadow)',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                opacity: task.isCompleted ? 0.75 : 1,
                                borderLeft: `4px solid ${
                                  task.priority === 'URGENT' ? 'var(--warn)' :
                                  task.priority === 'HIGH' ? '#f97316' :
                                  task.priority === 'MEDIUM' ? '#3b82f6' : '#9ca3af'
                                }`
                              }}
                            >
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '4px' }}>
                                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', flex: 1 }}>
                                    <input 
                                      type="checkbox" 
                                      checked={task.isCompleted} 
                                      onChange={(e) => updateTask.mutate({ id: task.id, isCompleted: e.target.checked })}
                                      style={{ width: '15px', height: '15px', cursor: 'pointer', marginTop: '3px' }}
                                    />
                                    <h3 style={{
                                      fontSize: '13.5px',
                                      fontWeight: 700,
                                      textDecoration: task.isCompleted ? 'line-through' : 'none',
                                      color: task.isCompleted ? 'var(--muted)' : 'var(--text)',
                                      lineHeight: 1.3
                                    }}>{task.title}</h3>
                                  </label>
                                  <span className="badge" style={{
                                    fontSize: '9.5px',
                                    fontWeight: 800,
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    background: 
                                      task.priority === 'URGENT' ? 'var(--warn-bg)' :
                                      task.priority === 'HIGH' ? '#fff7ed' :
                                      task.priority === 'MEDIUM' ? '#eff6ff' : '#f3f4f6',
                                    color: 
                                      task.priority === 'URGENT' ? 'var(--warn)' :
                                      task.priority === 'HIGH' ? '#c2410c' :
                                      task.priority === 'MEDIUM' ? '#1d4ed8' : '#4b5563'
                                  }}>{task.priority || 'NORMAL'}</span>
                                </div>
                              </div>

                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: '8px', marginTop: '4px' }}>
                                {task.reminderDate ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10.5px', fontWeight: 600, color: 'var(--brand)' }}>
                                    <i className="bi bi-bell-fill"></i>
                                    <span>{new Date(task.reminderDate).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                ) : (
                                  <span style={{ fontSize: '10.5px', color: 'var(--muted)', fontStyle: 'italic' }}>No reminder</span>
                                )}

                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button 
                                    className="btn btn-ghost" 
                                    onClick={() => openEditModal(task)}
                                    style={{ padding: '0 6px', height: '24px', minWidth: '24px', borderRadius: '6px' }}
                                    title="Edit Task"
                                  >
                                    <i className="bi bi-pencil" style={{ fontSize: '10px' }}></i>
                                  </button>
                                  <button 
                                    className="btn btn-ghost" 
                                    onClick={() => handleDeleteClick(task.id)}
                                    style={{ padding: '0 6px', height: '24px', minWidth: '24px', color: 'var(--warn)', borderColor: 'rgba(239, 68, 68, 0.2)', borderRadius: '6px' }}
                                    title="Delete Task"
                                  >
                                    <i className="bi bi-trash" style={{ fontSize: '10px' }}></i>
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Right Side: New Duty Status Panel */}
                <div className="queue-section" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
                  <div className="queue-head" style={{ borderBottom: '1px solid var(--line)' }}>
                    <div className="queue-head-title">
                      <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <i className="bi bi-shield-check" style={{ color: 'var(--brand)' }}></i>
                        Duty Status
                      </h2>
                      <p>Activate your patient queue coverage and shift timers</p>
                    </div>
                  </div>
                  
                  <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, justifyContent: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fafafa', padding: '16px', borderRadius: '12px', border: '1px solid var(--line)' }}>
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Status</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                          {(currentUser?.dutyStatus === 'ON DUTY' || currentUser?.dutyStatus === 'ON_DUTY') ? (
                            <>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }}></span>
                              <span style={{ fontSize: '16px', fontWeight: 700, color: '#15803d' }}>ON DUTY</span>
                              {currentUser?.shiftType && (
                                <span className="badge badge-green" style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', padding: '1px 6px' }}>
                                  {currentUser.shiftType} SHIFT
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#000000', display: 'inline-block' }}></span>
                              <span style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>INACTIVE</span>
                              <span className="badge badge-gray" style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', padding: '1px 6px' }}>
                                OFF SHIFT
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {currentUser?.lastActivatedAt && (currentUser?.dutyStatus === 'ON DUTY' || currentUser?.dutyStatus === 'ON_DUTY') && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Activated At</div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--brand)', marginTop: '4px' }}>
                            {new Date(currentUser.lastActivatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      )}
                    </div>

                    {currentUser?.dutyStatus === 'INACTIVE' && (
                      <div style={{ fontSize: '12.5px', fontWeight: 500, color: '#ef4444', background: '#fef2f2', border: '1px solid #fee2e2', padding: '10px 14px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }}></span>
                        <span>Shift ended automatically at configured duty cutoff.</span>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <button
                        onClick={async () => {
                          try {
                            const currentHour = new Date().getHours();
                            const assumedShift = currentHour < 13 ? 'MORNING' : 'EVENING';
                            await updateDutyStatus('ON DUTY', assumedShift);
                            toast.success(`Coverage Activated: You are now ON DUTY for the ${assumedShift} shift.`);
                          } catch (e: any) {
                            toast.error(e.message || 'Failed to update duty coverage.');
                          }
                        }}
                        disabled={currentUser?.dutyStatus === 'ON DUTY' || currentUser?.dutyStatus === 'ON_DUTY'}
                        className="btn btn-primary"
                        style={{
                          width: '100%',
                          justifyContent: 'center',
                          background: (currentUser?.dutyStatus === 'ON DUTY' || currentUser?.dutyStatus === 'ON_DUTY') ? '#e5e7eb' : 'var(--brand)',
                          color: (currentUser?.dutyStatus === 'ON DUTY' || currentUser?.dutyStatus === 'ON_DUTY') ? '#9ca3af' : '#fff',
                          cursor: (currentUser?.dutyStatus === 'ON DUTY' || currentUser?.dutyStatus === 'ON_DUTY') ? 'not-allowed' : 'pointer',
                          border: 'none',
                          boxShadow: '0 2px 4px rgba(13, 71, 161, 0.1)'
                        }}
                      >
                        <span style={{ fontSize: '13.5px', fontWeight: 700 }}>Go On Duty</span>
                      </button>

                      <button
                        onClick={async () => {
                          try {
                            await updateDutyStatus('INACTIVE');
                            toast.success('Coverage Disabled: You are now INACTIVE.');
                          } catch (e: any) {
                            toast.error(e.message || 'Failed to disable duty coverage.');
                          }
                        }}
                        disabled={currentUser?.dutyStatus !== 'ON DUTY' && currentUser?.dutyStatus !== 'ON_DUTY'}
                        className="btn btn-outline"
                        style={{
                          width: '100%',
                          justifyContent: 'center',
                          borderColor: (currentUser?.dutyStatus !== 'ON DUTY' && currentUser?.dutyStatus !== 'ON_DUTY') ? '#e5e7eb' : 'var(--brand)',
                          color: (currentUser?.dutyStatus !== 'ON DUTY' && currentUser?.dutyStatus !== 'ON_DUTY') ? '#9ca3af' : 'var(--brand)',
                          cursor: (currentUser?.dutyStatus !== 'ON DUTY' && currentUser?.dutyStatus !== 'ON_DUTY') ? 'not-allowed' : 'pointer',
                          background: '#fff'
                        }}
                      >
                        <span style={{ fontSize: '13.5px', fontWeight: 700 }}>Go Off Duty</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Task creation / editing dialogue overlay */}
              {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                  <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
                        {editingTask ? 'Modify Task Details' : 'Create Task / Reminder'}
                      </h3>
                      <button 
                        className="tool-btn" 
                        onClick={() => setIsModalOpen(false)}
                        style={{ width: '26px', height: '26px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--page)' }}
                      >
                        <i className="bi bi-x-lg" style={{ fontSize: '11px' }}></i>
                      </button>
                    </div>
                    <form onSubmit={handleSaveTask}>
                      <div className="modal-body">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Task Title *</label>
                          <input 
                            type="text" 
                            placeholder="e.g. Schedule Specialist Review for Patient Record"
                            value={modalTitle}
                            onChange={(e) => setModalTitle(e.target.value)}
                            required
                            style={{
                              padding: '8px 12px',
                              border: '1px solid var(--line)',
                              borderRadius: '8px',
                              outline: 'none',
                              fontSize: '13px',
                              fontWeight: 500
                            }}
                          />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Description / Notes</label>
                          <textarea 
                            placeholder="Enter notes, medical context, or reminder actions needed..."
                            value={modalDescription}
                            onChange={(e) => setModalDescription(e.target.value)}
                            rows={3}
                            style={{
                              padding: '8px 12px',
                              border: '1px solid var(--line)',
                              borderRadius: '8px',
                              outline: 'none',
                              fontSize: '13px',
                              fontFamily: 'inherit',
                              lineHeight: 1.4,
                              resize: 'none'
                            }}
                          />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Set Priority</label>
                            <select 
                              value={modalPriority} 
                              onChange={(e) => setModalPriority(e.target.value)}
                              style={{
                                padding: '8px 12px',
                                border: '1px solid var(--line)',
                                borderRadius: '8px',
                                background: '#fff',
                                outline: 'none',
                                fontSize: '12.5px',
                                fontWeight: 500
                              }}
                            >
                              <option value="LOW">Low Priority</option>
                              <option value="MEDIUM">Medium Priority</option>
                              <option value="HIGH">High Priority</option>
                              <option value="URGENT">Urgent / Emergency</option>
                            </select>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reminder Date & Time</label>
                            <input 
                              type="datetime-local" 
                              value={modalReminderDate}
                              onChange={(e) => setModalReminderDate(e.target.value)}
                              style={{
                                padding: '8px 12px',
                                border: '1px solid var(--line)',
                                borderRadius: '8px',
                                outline: 'none',
                                fontSize: '12.5px',
                                fontWeight: 500
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="modal-footer">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsModalOpen(false)}>Cancel</button>
                        <button type="submit" className="btn btn-primary btn-sm">
                          {editingTask ? 'Save Modifications' : 'Create Task'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
