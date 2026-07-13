/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Navigate, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useStore, authFetch } from '@/src/store/useStore';
import { 
  Hospital, LayoutDashboard, Users, UserRound, 
  Search, Calendar, ShoppingBag, LogOut, 
  Menu, X, Bell, User as UserIcon, Activity,
  Settings, HelpCircle, ShieldAlert, CheckCircle2, TrendingUp
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/src/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { UserRole } from '@/src/types';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  { label: 'Operational Overview', href: '/admin', icon: LayoutDashboard, roles: ['ADMIN'] },
  { label: 'Staff Management', href: '/admin/users', icon: Users, roles: ['ADMIN'] },
  { label: 'Revenue Reports', href: '/admin/revenue', icon: ShoppingBag, roles: ['ADMIN'] },
  
  { label: 'Recpt Dashboard', href: '/reception', icon: LayoutDashboard, roles: ['RECEPTION'] },
  { label: 'Registration', href: '/reception/register', icon: UserRound, roles: ['RECEPTION'] },
  { label: 'Patient Search', href: '/reception/search', icon: Search, roles: ['RECEPTION'] },
  
  { label: 'Doctor Dashboard', href: '/doctor', icon: LayoutDashboard, roles: ['DOCTOR'] },
  { label: 'Pharmacy Dashboard', href: '/pharmacy', icon: LayoutDashboard, roles: ['PHARMACY'] },
  { label: 'Dispense Medicines', href: '/pharmacy/dispense', icon: ShoppingBag, roles: ['PHARMACY'] },
];

export function AppLayout() {
  const currentUser = useStore(state => state.currentUser);
  const logout = useStore(state => state.logout);
  const users = useStore(state => state.users);
  const fetchUsers = useStore(state => state.fetchUsers);
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);

  // Admin MedFlow Shell interactive states
  const [showNotif, setShowNotif] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [showProfile, setShowProfile] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<any[]>([]);
  const [showSearchModal, setShowSearchModal] = React.useState(false);

  // Admin Self Password Change isolated states
  const [isChangingPassword, setIsChangingPassword] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [isSavingPassword, setIsSavingPassword] = React.useState(false);

  const resetPasswordForm = () => {
    setIsChangingPassword(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setIsSavingPassword(false);
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('All fields are required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New password and password confirmation do not match.');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters in length.');
      return;
    }

    setIsSavingPassword(true);
    try {
      const res = await authFetch('/api/admin/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      if (res.ok) {
        toast.success('Your password has been changed successfully.');
        resetPasswordForm();
        setShowProfile(false);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to change your password.');
      }
    } catch (err) {
      console.error('Password change error:', err);
      toast.error('An error occurred. Please try again.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  React.useEffect(() => {
    if (currentUser?.role === 'ADMIN' && (!users || users.length === 0)) {
      fetchUsers();
    }
  }, [currentUser, users, fetchUsers]);

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const q = searchQuery.trim();
      if (!q) return;
      const filtered = (users || []).filter((u: any) => 
        (u.name || '').toLowerCase().includes(q.toLowerCase()) || 
        (u.department || '').toLowerCase().includes(q.toLowerCase()) ||
        (u.role || '').toLowerCase().includes(q.toLowerCase())
      );
      setSearchResults(filtered);
      setShowSearchModal(true);
    }
  };

  const filteredNavItems = navItems.filter(item => item.roles.includes(currentUser.role));
  const isAdmin = currentUser.role === 'ADMIN';

  if (isAdmin) {
    const initials = currentUser?.name?.slice(0, 2).toUpperCase() || 'SA';
    return (
      <div className="medflow-shell" id="medflow-admin-layout">
        <aside className="medflow-sidebar">
          <div className="medflow-brand">
            <div className="medflow-brand-icon">
              <Hospital size={17} />
            </div>
            <div>
              <div className="medflow-brand-name">MedFlow</div>
              <div className="medflow-brand-sub">Clinical Precision</div>
            </div>
          </div>

          <nav className="medflow-nav">
            <Link 
              className={cn("medflow-nav-item", (location.pathname === '/admin' || location.pathname === '/admin/') && "active")} 
              to="/admin"
            >
              <LayoutDashboard size={16} />
              <span>Operational Overview</span>
            </Link>
            <Link 
              className={cn("medflow-nav-item", location.pathname === '/admin/users' && "active")} 
              to="/admin/users"
            >
              <Users size={16} />
              <span>Staff Management</span>
            </Link>
            <Link 
              className={cn("medflow-nav-item", location.pathname === '/admin/revenue' && "active")} 
              to="/admin/revenue"
            >
              <TrendingUp size={16} />
              <span>Revenue Reports</span>
            </Link>
          </nav>

          <div className="medflow-sidebar-footer">
            <button 
              onClick={handleLogout}
              className="medflow-nav-item"
            >
              <LogOut size={16} />
              <span>Logout</span>
            </button>
          </div>
        </aside>

        <div className="medflow-main-area">
          <header className="medflow-topbar">
            <div className="medflow-search-wrap">
              <i><Search size={14} /></i>
              <input 
                type="search" 
                placeholder="Search records, patients or transactions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyPress}
              />
            </div>

            <div className="medflow-topbar-tools">
              <button className="medflow-tool-btn" onClick={() => setShowNotif(true)}>
                <Bell size={18} />
              </button>
              <button className="medflow-tool-btn" onClick={() => setShowHelp(true)}>
                <HelpCircle size={18} />
              </button>

              <div className="medflow-tb-div"></div>

              <div className="medflow-profile-chip" onClick={() => setShowProfile(true)}>
                <div className="medflow-profile-info">
                  <span className="medflow-profile-name">{currentUser?.name}</span>
                  <span className="medflow-profile-role">Super Admin</span>
                </div>
                <div className="medflow-avatar">{initials}</div>
              </div>
            </div>
          </header>

          <main className="medflow-content-area scroll-smooth bg-[#f5f7fa]">
            <Outlet />
          </main>
        </div>

        {/* NOTIFICATIONS MODAL */}
        {showNotif && (
          <div className="overlay" style={{ display: 'flex' }} onClick={() => setShowNotif(false)}>
            <div className="modal-box" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-hdr">
                <div>
                  <h3>Notifications</h3>
                  <p>4 unread system alerts</p>
                </div>
                <button className="cls-btn" onClick={() => setShowNotif(false)}><X size={14} /></button>
              </div>
              <div className="modal-bdy">
                <div className="notif-item unread flex items-start gap-2">
                  <div className="text-amber-600 mr-2 mt-1"><ShieldAlert size={16} /></div>
                  <div>
                    <strong>Unusual Login Attempt</strong>
                    <span>Dr. Julianne Smith from unfamiliar IP: 192.168.1.124 · 2m ago</span>
                  </div>
                </div>
                <div className="notif-item unread flex items-start gap-2">
                  <div className="text-red-650 mr-2 mt-1"><Activity size={16} /></div>
                  <div>
                    <strong>Critical Stock: Latex Gloves (L)</strong>
                    <span>Only 120 units remain — below threshold · 15m ago</span>
                  </div>
                </div>
                <div className="notif-item unread flex items-start gap-2">
                  <div className="text-orange-600 mr-2 mt-1"><X size={16} /></div>
                  <div>
                    <strong>Expired Batch: Insulin Glargine</strong>
                    <span>Batch B-88211-IG · Immediate disposal required · 1h ago</span>
                  </div>
                </div>
                <div className="notif-item unread flex items-start gap-2">
                  <div className="text-emerald-600 mr-2 mt-1"><CheckCircle2 size={16} /></div>
                  <div>
                    <strong>HIPAA Certifications Updated</strong>
                    <span>24 Nursing staff members renewed credentials · 3h ago</span>
                  </div>
                </div>
              </div>
              <div className="modal-ftr">
                <button className="medflow-btn medflow-btn-ghost medflow-btn-sm" onClick={() => setShowNotif(false)}>Dismiss All</button>
                <button className="medflow-btn medflow-btn-primary medflow-btn-sm text-white" onClick={() => setShowNotif(false)}>View All</button>
              </div>
            </div>
          </div>
        )}

        {/* HELP MODAL */}
        {showHelp && (
          <div className="overlay" style={{ display: 'flex' }} onClick={() => setShowHelp(false)}>
            <div className="modal-box" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-hdr">
                <div>
                  <h3>Help & Support</h3>
                  <p>MedFlow Admin Portal v2.4</p>
                </div>
                <button className="cls-btn" onClick={() => setShowHelp(false)}><X size={14} /></button>
              </div>
              <div className="modal-bdy flex flex-col gap-3">
                <div className="p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer" onClick={() => toast.info('Loading documentation...')}>
                  <div className="font-bold text-sm text-[13px] mb-1 text-[#0d47a1]">
                    Documentation
                  </div>
                  <div className="text-xs text-slate-500">System manuals and admin guides</div>
                </div>
                <div className="p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer" onClick={() => toast.info('Connecting to IT Support...')}>
                  <div className="font-bold text-sm text-[13px] mb-1 text-teal-600">
                    Contact IT Support
                  </div>
                  <div className="text-xs text-slate-500">Raise a ticket or call ext. 5050</div>
                </div>
                <div className="p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer" onClick={() => toast.info('Viewing security policies...')}>
                  <div className="font-bold text-sm text-[13px] mb-1 text-orange-600">
                    Security Policies
                  </div>
                  <div className="text-xs text-slate-500">HIPAA compliance and access policies</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PROFILE MODAL */}
        {showProfile && (
          <div className="overlay" style={{ display: 'flex' }} onClick={() => { setShowProfile(false); resetPasswordForm(); }}>
            <div className="modal-box" style={{ maxWidth: '360px' }} onClick={(e) => e.stopPropagation()}>
              {isChangingPassword ? (
                <>
                  <div className="modal-hdr">
                    <h3>Change Password</h3>
                    <button className="cls-btn" onClick={() => { setShowProfile(false); resetPasswordForm(); }}><X size={14} /></button>
                  </div>
                  <form onSubmit={handleSavePassword}>
                    <div className="modal-bdy flex flex-col gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Current Password</label>
                        <input
                          type="password"
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                          placeholder="••••••••"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">New Password</label>
                        <input
                          type="password"
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                          placeholder="••••••••"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Confirm New Password</label>
                        <input
                          type="password"
                          className="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
                          placeholder="••••••••"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                    <div className="modal-ftr">
                      <button type="button" className="medflow-btn medflow-btn-ghost medflow-btn-sm" onClick={() => resetPasswordForm()}>Back</button>
                      <button type="submit" disabled={isSavingPassword} className="medflow-btn medflow-btn-primary bg-indigo-600 hover:bg-indigo-700 text-white medflow-btn-sm">
                        {isSavingPassword ? 'Saving...' : 'Save Password'}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <>
                  <div className="modal-hdr">
                    <h3>My Profile</h3>
                    <button className="cls-btn" onClick={() => setShowProfile(false)}><X size={14} /></button>
                  </div>
                  <div className="modal-bdy">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="medflow-avatar w-[52px] h-[52px] text-lg rounded-xl flex items-center justify-center font-bold">
                        {initials}
                      </div>
                      <div>
                        <div className="text-lg font-bold text-[#003178]">{currentUser?.name}</div>
                        <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs font-bold inline-block mt-1">SUPER ADMIN</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400">Role</div>
                        <div className="font-semibold text-slate-700">Super Admin</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400">Employee ID</div>
                        <div className="font-semibold text-slate-700">ADM-001</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400">Department</div>
                        <div className="font-semibold text-slate-700">Administration</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400">Access Level</div>
                        <div className="font-semibold text-slate-700">Full System</div>
                      </div>
                    </div>

                    <button 
                      className="medflow-btn medflow-btn-ghost text-indigo-600 hover:text-indigo-700 medflow-btn-sm font-bold flex items-center gap-1.5 w-full justify-center mt-5 border border-indigo-200 hover:bg-indigo-50/50" 
                      onClick={() => setIsChangingPassword(true)}
                    >
                      Change Password
                    </button>
                  </div>
                  <div className="modal-ftr">
                    <button className="medflow-btn medflow-btn-ghost medflow-btn-sm" onClick={() => setShowProfile(false)}>Close</button>
                    <button className="medflow-btn medflow-btn-primary bg-red-600 hover:bg-red-700 medflow-btn-sm text-white" onClick={handleLogout}>Logout</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* SEARCH OVERLAY */}
        {showSearchModal && (
          <div className="overlay" style={{ display: 'flex' }} onClick={() => setShowSearchModal(false)}>
            <div className="modal-box" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-hdr">
                <div>
                  <h3>Search Results</h3>
                  <p>{searchResults.length} result(s) for "{searchQuery}"</p>
                </div>
                <button className="cls-btn" onClick={() => setShowSearchModal(false)}><X size={14} /></button>
              </div>
              <div className="modal-bdy max-h-[400px] overflow-y-auto">
                {searchResults.length > 0 ? (
                  searchResults.map((u: any, idx: number) => {
                    const staffInitials = u.name?.slice(0, 2).toUpperCase() || 'SA';
                    return (
                      <div key={idx} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg mb-2 hover:bg-blue-50/50 cursor-pointer transition-colors">
                        <div className="w-10 h-10 rounded-full bg-blue-100 text-[#0d47a1] flex items-center justify-center font-bold text-xs">
                          {staffInitials}
                        </div>
                        <div className="flex-1">
                          <div className="font-bold text-slate-800">{u.name}</div>
                          <div className="text-xs text-slate-500">{u.role} · {u.department || 'General'}</div>
                        </div>
                        <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-0.5 rounded-full">Active</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center p-8 text-slate-400">
                    <Search size={32} className="mx-auto mb-2" />
                    No clinical staff records matched.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside 
        className={cn(
          "bg-white border-r border-slate-200 transition-all duration-300 flex flex-col z-30",
          isSidebarOpen ? "w-64" : "w-20"
        )}
      >
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-900 rounded-lg flex items-center justify-center text-white flex-shrink-0 shadow-lg shadow-blue-100">
            <Hospital size={24} />
          </div>
          {isSidebarOpen && (
            <div className="flex flex-col animate-fade-in">
              <span className="font-bold text-sm tracking-tight text-slate-800 leading-none">Vitalis Healthcare</span>
              <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-1">Clinical Precision</span>
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 space-y-1 mt-6">
          {filteredNavItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
                location.pathname === item.href 
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-200" 
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              )}
            >
              <item.icon size={20} className={cn(
                location.pathname === item.href ? "text-white" : "text-slate-400 group-hover:text-slate-600"
              )} />
              {isSidebarOpen && <span>{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-100 space-y-1">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-50 transition-all"
          >
            <LogOut size={20} className="text-slate-400" />
            {isSidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#f8fafc]">
        {/* Header */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 z-20">
          <div className="flex-1 max-w-md">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors" size={18} />
              <input 
                type="text" 
                placeholder="Search records, patients or transactions..."
                className="w-full h-11 pl-12 pr-4 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-4 focus:ring-blue-600/5 focus:border-blue-600 focus:bg-white transition-all shadow-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <button className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all">
                <Bell size={20} />
              </button>
              <button className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all">
                <Bell size={20} />
              </button>
            </div>
            <div className="h-10 w-px bg-slate-200"></div>
            <div className="flex items-center gap-4 pl-2">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-slate-900 leading-tight">{currentUser?.name}</p>
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                  {currentUser?.role === 'ADMIN' ? 'Super Admin' : (currentUser?.department || currentUser?.role)}
                </p>
              </div>
              <div className="w-10 h-10 bg-blue-100 text-blue-900 rounded-xl overflow-hidden shadow-sm border border-slate-200 flex items-center justify-center font-bold text-sm uppercase">
                {currentUser?.name?.charAt(0) || 'U'}
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic Content */}
        <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function ProtectedRoute({ roles, useLayout = true }: { roles: UserRole[], useLayout?: boolean }) {
  const currentUser = useStore(state => state.currentUser);
  
  if (!currentUser) return <Navigate to="/login" replace />;
  
  if (currentUser.requiresPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }
  
  if (!roles.includes(currentUser.role)) return <Navigate to="/unauthorized" replace />;
  
  return useLayout ? <AppLayout /> : <Outlet />;
}
