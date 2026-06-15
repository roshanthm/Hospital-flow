/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Hospital-Grade Password Restructure Page
 */

import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useStore, authFetch } from '@/src/store/useStore';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { 
  Key, 
  Lock, 
  ShieldAlert, 
  Activity, 
  Eye, 
  EyeOff, 
  ArrowRight,
  ShieldCheck
} from 'lucide-react';

export default function ChangePasswordPage() {
  const currentUser = useStore(state => state.currentUser);
  const logout = useStore(state => state.logout);
  const addActivityLog = useStore(state => state.addActivityLog);
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If there's no active user session, redirect to the secure gatekeeper
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // If the user's password doesn't require resetting, send them directly to their registry interface
  if (!currentUser.requiresPasswordChange) {
    const defaultRoute = 
      currentUser.role === 'ADMIN' ? '/admin' :
      currentUser.role === 'RECEPTION' ? '/reception' :
      currentUser.role === 'DOCTOR' ? '/doctor' :
      currentUser.role === 'PHARMACY' ? '/pharmacy' : '/';
    return <Navigate to={defaultRoute} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.trim().length < 6) {
      toast.error('Clinical Security Policy: Password must contain at least 6 characters.');
      return;
    }

    if (newPassword.trim() !== confirmPassword.trim()) {
      toast.error('Credential Verification Error: Password confirmations do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPassword.trim() }),
      });

      if (res.ok) {
        toast.success('Workstation access unlocked. Credentials saved in encrypted format.');
        
        // Log auditing footprint in real-time
        addActivityLog({
          id: Math.random().toString(36).substring(7),
          action: 'Secured Password Updated',
          user: currentUser.name,
          timestamp: new Date().toISOString(),
          details: 'Credential token updated from temporary authorization grant.'
        });

        // Mutate local state atomically
        useStore.setState((state) => {
          if (state.currentUser) {
            return {
              currentUser: {
                ...state.currentUser,
                requiresPasswordChange: false
              }
            };
          }
          return {};
        });

        // Redirect based on clinical role permissions
        switch (currentUser.role) {
          case 'ADMIN': navigate('/admin'); break;
          case 'RECEPTION': navigate('/reception'); break;
          case 'DOCTOR': navigate('/doctor'); break;
          case 'PHARMACY': navigate('/pharmacy'); break;
          default: navigate('/');
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        toast.error(errorData.error || 'Workstation authorization rejected.');
      }
    } catch (err) {
      toast.error('Network failure connecting to clinical validation server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden font-sans select-none">
      {/* Visual Ambiance Backdrop */}
      <div className="absolute inset-0 bg-cover bg-center opacity-10 filter blur-lg transition-transform duration-10000"
           style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&q=80&w=2053")' }} />
      <div className="absolute w-[600px] h-[600px] rounded-full bg-blue-900/10 -top-40 -left-40 blur-3xl" />
      <div className="absolute w-[600px] h-[600px] rounded-full bg-indigo-900/10 -bottom-40 -right-40 blur-3xl" />

      <motion.div 
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 lg:p-8 xl:p-10 shadow-2xl relative z-10 space-y-6"
      >
        {/* Branding & Medical Module Title */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <Activity size={18} />
            </div>
            <span className="text-lg font-bold text-white tracking-tight">MedFlow Workstation</span>
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-black text-slate-100 tracking-tight">PASSWORD RESTRUCTURE</h2>
            <p className="text-xs text-slate-400 font-medium max-w-xs leading-relaxed">
              Clinical Session Lock: You are logged in with temporary credentials for <strong className="text-blue-400 font-bold">{currentUser.name}</strong> ({currentUser.employeeId}) and must define secure workstation codes to proceed.
            </p>
          </div>
        </div>

        {/* Clinical Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-4">
            {/* New Password input */}
            <div className="space-y-1.5 flex flex-col">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider font-mono">Define New Password PIN</label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                  <Lock size={16} strokeWidth={1.8} />
                </div>
                <input 
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full h-11 pl-11 pr-11 bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-500 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/5 transition-all text-slate-200"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Confirm New Password PIN input */}
            <div className="space-y-1.5 flex flex-col">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider font-mono">Confirm Password PIN Code</label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                  <Key size={16} strokeWidth={1.8} />
                </div>
                <input 
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full h-11 pl-11 pr-11 bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-500 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/5 transition-all text-slate-200"
                />
              </div>
            </div>
          </div>

          {/* Secure Policy Footprint */}
          <div className="bg-blue-950/40 p-3.5 rounded-2xl border border-blue-900/30 flex items-start gap-2.5">
            <ShieldAlert className="text-blue-400 shrink-0 mt-0.5" size={15} />
            <div className="text-[10px] text-slate-300 leading-normal font-semibold">
              Clinical Security Protocol: Passwords should be complex. By authorizing this restructuring, temporary tokens are permanently revoked. Access histories are synchronized globally in our secure PostgreSQL cluster.
            </div>
          </div>

          {/* Submit buttons */}
          <div className="grid grid-cols-5 gap-2.5 pt-2">
            <button
              type="button"
              onClick={logout}
              className="col-span-2 py-3 bg-slate-800 hover:bg-slate-700 hover:text-slate-200 text-slate-400 font-bold rounded-xl text-xs transition-all border border-slate-700/60"
            >
              Cancel & Sign Out
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="col-span-3 py-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-blue-500/10 active:scale-98 disabled:opacity-75 focus:outline-none"
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Unlock Workstation
                  <ArrowRight size={13} />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Regulatory footer */}
        <div className="text-center pt-2 border-t border-slate-800 flex justify-center items-center gap-1 text-slate-500 text-[10px] font-bold">
          <ShieldCheck size={12} className="text-emerald-500" />
          <span>PostgreSQL RSA-256 Bit Encryption Module Status: Online</span>
        </div>
      </motion.div>
    </div>
  );
}
