/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { motion } from "motion/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/src/store/useStore";
import { toast } from "sonner";
import { 
  LogIn, 
  Eye, 
  EyeOff, 
  Mail, 
  Lock,
  Activity,
  ChevronRight,
  X,
  Key,
  ShieldAlert
} from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useStore(state => state.login);
  const addActivityLog = useStore(state => state.addActivityLog);
  const [showPassword, setShowPassword] = useState(false);
  
  // SECURE PASSWORD RECOVERY STRATEGY STATES
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotInput, setForgotInput] = useState('');
  const [isForgotSubmitting, setIsForgotSubmitting] = useState(false);

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotInput || !forgotInput.trim()) {
      toast.error('Please enter your Employee ID or Reference PIN.');
      return;
    }
    setIsForgotSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeIdOrPin: forgotInput }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || 'Password recovery request submitted successfully!');
        setIsForgotModalOpen(false);
        setForgotInput('');
      } else {
        toast.error(data.error || 'No active medical profile was found with those credentials.');
      }
    } catch (err) {
      toast.error('Connection failure trying to submit reset. Please try again.');
    } finally {
      setIsForgotSubmitting(false);
    }
  };
  
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    const result = await login(data);
    
    if (result.success) {
      const user = useStore.getState().currentUser!;
      addActivityLog({
        id: Math.random().toString(36).substring(7),
        action: 'User Login',
        user: user.name,
        userId: user.id,
        timestamp: new Date().toISOString(),
      });
      toast.success(`Welcome back, ${user.name}`);
      
      // Redirect based on role
      switch (user.role) {
        case 'ADMIN': navigate('/admin'); break;
        case 'RECEPTION': navigate('/reception'); break;
        case 'DOCTOR': navigate('/doctor'); break;
        case 'PHARMACY': navigate('/pharmacy'); break;
        default: navigate('/');
      }
    } else {
      toast.error(result.error || 'Invalid email or password');
    }
  };

  return (
    <div className="h-screen flex flex-col md:flex-row bg-white overflow-hidden">
      {/* Left Panel - Branding & Creative */}
      <div className="hidden md:flex md:w-1/2 relative flex-col justify-between p-8 lg:p-12 xl:p-16 overflow-hidden bg-blue-900 shrink-0">
        {/* Background Image with Overlay */}
        <div 
          className="absolute inset-0 bg-cover bg-center transition-transform duration-10000 hover:scale-110"
          style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&q=80&w=2053")' }}
        />
        <div className="absolute inset-0 bg-blue-900/80 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/40 to-transparent" />

        {/* Logo & Product Name */}
        <div className="relative z-10 flex items-center gap-2">
          <div className="w-8 h-8 lg:w-10 lg:h-10 bg-white rounded-lg lg:rounded-xl flex items-center justify-center text-blue-600 shadow-xl">
            <Activity size={20} className="lg:hidden" />
            <Activity size={24} className="hidden lg:block" />
          </div>
          <span className="text-xl lg:text-2xl font-bold text-white tracking-tight">MedFlow</span>
        </div>

        {/* Hero Section */}
        <div className="relative z-10 max-w-lg lg:mb-6 xl:mb-12">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-[clamp(1.75rem,5vw,3.75rem)] font-bold text-white leading-[1.1] tracking-tight"
          >
            Advanced Care,<br />
            Connected<br />
            Intelligence.
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-blue-100/80 text-sm lg:text-base xl:text-lg mt-4 lg:mt-6 leading-relaxed max-w-md font-light"
          >
            The next generation of clinical management. Precision data meets compassionate care in a unified digital ecosystem.
          </motion.p>
        </div>

        {/* Footer info labels */}
        <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-6 lg:pt-8">
          <div className="flex gap-6 lg:gap-10">
            <div className="space-y-1">
              <p className="text-[9px] lg:text-[10px] uppercase tracking-widest text-blue-200/50 font-bold">System Status</p>
              <div className="flex items-center gap-1.5 lg:gap-2">
                <div className="w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-white text-[11px] lg:text-xs font-medium">Operational</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] lg:text-[10px] uppercase tracking-widest text-blue-200/50 font-bold">Data Protocol</p>
              <span className="text-white text-[11px] lg:text-xs font-medium uppercase">HL7 / FHIR v4.0</span>
            </div>
          </div>
          <p className="text-[9px] lg:text-[10px] text-blue-200/30 font-medium">
            Secure Terminal ID: VH-9928-X
          </p>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-6 lg:p-12 xl:p-24 bg-white overflow-y-auto">
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full max-w-[420px] 2xl:max-w-[480px] space-y-6 lg:space-y-8 xl:space-y-12"
        >
          {/* Header */}
          <div className="space-y-1.5 lg:space-y-3">
            <h2 className="text-2xl sm:text-3xl lg:text-[clamp(1.875rem,3vw,2.5rem)] font-bold text-slate-900 tracking-tight leading-tight">Welcome Back</h2>
            <p className="text-slate-500 text-sm sm:text-base lg:text-lg font-light leading-relaxed">Securely sign in to your hospital workspace.</p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 lg:space-y-6 xl:space-y-10">
            <div className="space-y-4 lg:space-y-5 xl:space-y-6">
              <div className="space-y-1.5 lg:space-y-2">
                <label className="text-[9px] lg:text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] ml-1">Email Address</label>
                <div className="relative group">
                  <div className="absolute left-4 lg:left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
                    <Mail size={18} strokeWidth={1.5} className="lg:hidden" />
                    <Mail size={20} strokeWidth={1.5} className="hidden lg:block" />
                  </div>
                  <input
                    {...register("email")}
                    placeholder="name@vitalis.health"
                    className="w-full h-11 lg:h-12 xl:h-14 pl-11 lg:pl-14 pr-6 bg-slate-50 border border-slate-100 rounded-xl lg:rounded-2xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-600/5 focus:border-blue-600 focus:bg-white transition-all text-sm lg:text-base xl:text-lg font-medium"
                  />
                </div>
                {errors.email && <p className="text-rose-500 text-[11px] mt-1.5 ml-1 font-medium italic">{errors.email.message}</p>}
              </div>

              <div className="space-y-1.5 lg:space-y-2">
                <div className="flex justify-between items-center px-1">
                  <label className="text-[9px] lg:text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Security Key</label>
                  <button type="button" onClick={() => setIsForgotModalOpen(true)} className="text-[10px] lg:text-[11px] font-semibold text-blue-600 hover:text-blue-700">Forgot key?</button>
                </div>
                <div className="relative group">
                  <div className="absolute left-4 lg:left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
                    <Lock size={18} strokeWidth={1.5} className="lg:hidden" />
                    <Lock size={20} strokeWidth={1.5} className="hidden lg:block" />
                  </div>
                  <input
                    {...register("password")}
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    className="w-full h-11 lg:h-12 xl:h-14 pl-11 lg:pl-14 pr-11 lg:pr-14 bg-slate-50 border border-slate-100 rounded-xl lg:rounded-2xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-600/5 focus:border-blue-600 focus:bg-white transition-all text-sm lg:text-base xl:text-lg font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 lg:right-5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? (
                      <>
                        <EyeOff size={18} strokeWidth={1.5} className="lg:hidden" />
                        <EyeOff size={20} strokeWidth={1.5} className="hidden lg:block" />
                      </>
                    ) : (
                      <>
                        <Eye size={18} strokeWidth={1.5} className="lg:hidden" />
                        <Eye size={20} strokeWidth={1.5} className="hidden lg:block" />
                      </>
                    )}
                  </button>
                </div>
                {errors.password && <p className="text-rose-500 text-[11px] mt-1.5 ml-1 font-medium italic">{errors.password.message}</p>}
              </div>
            </div>

            <div className="flex items-center gap-2.5 px-1">
              <input 
                type="checkbox" 
                id="remember" 
                className="w-4 h-4 rounded border-slate-200 text-blue-600 focus:ring-blue-600/20 transition-all cursor-pointer"
              />
              <label htmlFor="remember" className="text-[11px] lg:text-sm text-slate-500 font-medium cursor-pointer select-none">
                Remember this terminal for 12 hours
              </label>
            </div>

            <button
              disabled={isSubmitting}
              type="submit"
              className="w-full h-12 lg:h-14 xl:h-16 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-xl lg:rounded-2xl transition-all flex items-center justify-center gap-3 text-sm lg:text-base xl:text-lg shadow-xl shadow-blue-900/10 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed group whitespace-nowrap"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 lg:w-6 lg:h-6 border-2 lg:border-3 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Authenticate Session
                  <ChevronRight size={18} className="lg:hidden group-hover:translate-x-1 transition-transform" />
                  <ChevronRight size={20} className="hidden lg:block group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>

          {/* Footer Footer */}
          <div className="space-y-4 lg:space-y-6 pt-6 lg:pt-8 border-t border-slate-100">
            <div className="text-center">
              <p className="text-[10px] lg:text-[11px] text-slate-400 font-medium tracking-tight">Need assistance with your credentials?</p>
            </div>
            <button
              type="button"
              onClick={() => setIsForgotModalOpen(true)}
              className="w-full h-10 lg:h-12 border border-slate-100 hover:border-slate-200 text-slate-600 text-[8px] lg:text-[9px] font-black uppercase tracking-[0.2em] rounded-xl lg:rounded-2xl transition-all flex items-center justify-center gap-2 hover:bg-slate-50 active:scale-95"
            >
              Contact IT Administration
            </button>
          </div>
        </motion.div>
      </div>

      {isForgotModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#0f172a]/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsForgotModalOpen(false)}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wide">Secure Password Recovery</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Clinical Station Operations Authorization</p>
              </div>
              <button 
                type="button" 
                onClick={() => setIsForgotModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleForgotSubmit} className="p-6 space-y-4">
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                <Key size={22} />
              </div>

              <div className="text-center space-y-1">
                <h4 className="text-xs font-bold text-slate-700">Submit Auth Restructure Request</h4>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Enter your unique clinical Employee ID (e.g., EMP-1234) or secure Reference PIN. The administrator board will examine your request and generate unique one-time credentials.
                </p>
              </div>

              <div className="space-y-1.5 flex flex-col">
                <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1 font-mono">Employee ID or Reference PIN</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. EMP-9182 or 742194"
                  value={forgotInput}
                  onChange={(e) => setForgotInput(e.target.value)}
                  className="w-full h-11 px-4 border border-slate-200 rounded-xl text-xs bg-white focus:ring-4 focus:ring-blue-600/5 focus:border-blue-600 outline-none font-semibold text-slate-700 placeholder:text-slate-400"
                />
              </div>

              <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 flex items-start gap-2.5">
                <ShieldAlert className="text-amber-600 shrink-0 mt-0.5" size={15} />
                <div className="text-[10px] text-amber-700 leading-normal font-semibold">
                  Note: Administrators can reject or authorize requests but never view current passkeys. Approved reset forces new credential updates on subsequent medical workstation access.
                </div>
              </div>

              <div className="flex gap-2.5 pt-2">
                <button 
                  type="button" 
                  onClick={() => setIsForgotModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-all text-center"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={isForgotSubmitting}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-xl text-xs transition-all shadow-md shadow-blue-650/10 active:scale-95 disabled:opacity-75"
                >
                  {isForgotSubmitting ? 'Requesting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
