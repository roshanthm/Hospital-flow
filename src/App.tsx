/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import LoginPage from './features/auth/LoginPage';
import ChangePasswordPage from './features/auth/ChangePasswordPage';
import { ProtectedRoute } from './components/layout/AppLayout';

import AdminDashboard from './features/admin/AdminDashboard';
import UserManagement from './features/admin/UserManagement';
import RevenueReports from './features/admin/RevenueReports';

import PatientRegistration from './features/reception/PatientRegistration';
import PatientSearch from './features/reception/PatientSearch';
import TokenManagement from './features/reception/TokenManagement';

import DoctorDashboard from './features/doctor/DoctorDashboard';
import DoctorConsultation from './features/doctor/DoctorConsultation';
import DoctorPatientRecords from './features/doctor/DoctorPatientRecords';
import DoctorMedicalHistory from './features/doctor/DoctorMedicalHistory';

import PharmacyDashboard from './features/pharmacy/PharmacyDashboard';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // Prevent redundant/duplicate api runs on tab/window focus
      retry: 1, // Safe retry boundary
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          
          {/* Admin Protected Routes */}
          <Route element={<ProtectedRoute roles={['ADMIN']} />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/users" element={<UserManagement />} />
            <Route path="/admin/revenue" element={<RevenueReports />} />
          </Route>

          {/* Reception Protected Routes */}
          <Route element={<ProtectedRoute roles={['RECEPTION']} />}>
            <Route path="/reception" element={<PatientSearch />} />
            <Route path="/reception/register" element={<PatientRegistration />} />
            <Route path="/reception/search" element={<PatientSearch />} />
            <Route path="/reception/tokens" element={<TokenManagement />} />
          </Route>

          {/* Doctor Protected Routes */}
          <Route element={<ProtectedRoute roles={['DOCTOR']} useLayout={false} />}>
            <Route path="/doctor" element={<DoctorDashboard />} />
            <Route path="/doctor/consultation/:tokenId" element={<DoctorConsultation />} />
            <Route path="/doctor/records" element={<DoctorPatientRecords />} />
            <Route path="/doctor/history" element={<DoctorMedicalHistory />} />
            <Route path="/doctor/history/:patientId" element={<DoctorMedicalHistory />} />
          </Route>

          {/* Pharmacy Protected Routes */}
          <Route element={<ProtectedRoute roles={['PHARMACY']} useLayout={false} />}>
            <Route path="/pharmacy" element={<PharmacyDashboard />} />
            <Route path="/pharmacy/dispense" element={<PharmacyDashboard />} />
          </Route>

          {/* Redirects */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/unauthorized" element={
            <div className="h-screen flex flex-col items-center justify-center p-4 text-center">
              <h1 className="text-4xl font-bold text-slate-800 mb-2">403</h1>
              <p className="text-slate-500 mb-6">You don't have permission to access this area.</p>
              <button 
                onClick={() => window.history.back()}
                className="bg-blue-600 text-white px-6 py-2 rounded-xl font-bold"
              >
                Go Back
              </button>
            </div>
          } />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        <Toaster position="top-right" richColors closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
