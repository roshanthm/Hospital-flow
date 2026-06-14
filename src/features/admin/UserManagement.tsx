/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useStore, authFetch } from '@/src/store/useStore';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  Plus, Search, Filter, Download, RefreshCw, Pencil, Trash2, 
  Lock, CheckCircle2, ShieldAlert, ShieldCheck, X, ArrowRight,
  ChevronLeft, ChevronRight, Users, UserRound, Activity, Key,
  Eye, Calendar, Phone, Briefcase, FileText, Check, Clock, BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { UserRole } from '@/src/types';
import { generateStaffCredentials } from '@/src/lib/utils';

export default function UserManagement() {
  const users = useStore(state => state.users);
  const addUser = useStore(state => state.addUser);
  const updateUser = useStore(state => state.updateUser);
  const deleteUser = useStore(state => state.deleteUser);
  const addActivityLog = useStore(state => state.addActivityLog);
  const fetchUsers = useStore(state => state.fetchUsers);
  const departments = useStore(state => state.departments);
  const fetchDepartments = useStore(state => state.fetchDepartments);
  const addDepartment = useStore(state => state.addDepartment);
  const tokens = useStore(state => state.tokens);
  const fetchTokens = useStore(state => state.fetchTokens);

  const location = useLocation();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userToEdit, setUserToEdit] = useState<any | null>(null);
  const [userToDelete, setUserToDelete] = useState<any | null>(null);
  const [selectedStaffProfile, setSelectedStaffProfile] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Custom filter states
  const [filterRole, setFilterRole] = useState('ALL');
  const [filterDept, setFilterDept] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL'); // ALL, ACTIVE, INACTIVE, ON_DUTY

  // Navigation tab for focused Directories
  const [activeTab, setActiveTab] = useState<'ALL' | 'DOCTOR' | 'PHARMACY' | 'RECEPTION' | 'STAFF' | 'RESETS'>('ALL');

  const [resetRequests, setResetRequests] = useState<any[]>([]);
  const [isResetRequestsLoading, setIsResetRequestsLoading] = useState(false);
  const [generatedTempPass, setGeneratedTempPass] = useState<string | null>(null);
  const [tempPassEmployeeName, setTempPassEmployeeName] = useState('');

  const [showCredentials, setShowCredentials] = useState<{email: string, pass: string} | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [revealedPins, setRevealedPins] = useState<Record<string, boolean>>({});

  const handleRequestRevealPin = (userId: string) => {
    const confirmReveal = window.confirm("Reveal credential information?");
    if (confirmReveal) {
      setRevealedPins(prev => ({ ...prev, [userId]: true }));
      setTimeout(() => {
        setRevealedPins(prev => ({ ...prev, [userId]: false }));
      }, 5000);
    }
  };

  // Duty Shift Settings states
  const [morningShiftEnd, setMorningShiftEnd] = useState('01:00 PM');
  const [eveningShiftEnd, setEveningShiftEnd] = useState('08:00 PM');
  const [timezoneReference, setTimezoneReference] = useState('Asia/Kolkata');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const isProtectedAccount = (u: any) => {
    if (!u) return false;
    const protectedEmails = ['admin@hospital.com', 'reception@hospital.com', 'pharmacy@hospital.com'];
    const protectedNames = ['System Admin', 'Reception Desk', 'Pharmacy Head'];
    const protectedEmpIds = ['ADM-1001', 'REC-1001', 'PHR-1001'];
    return (
      protectedEmails.includes(u.email || '') || 
      protectedNames.includes(u.name || '') ||
      protectedEmpIds.includes(u.employeeId || '')
    );
  };

  const handleExportIndividualPDF = async (u: any) => {
    toast.loading(`Constructing individual profile document for ${u.name}...`, { id: 'individual-pdf' });
    try {
      const res = await authFetch(`/api/admin/users/${u.id}/attendance-summary`);
      let attendanceMetrics = {
        presentDays: 0,
        absentDays: 30,
        dutyHours: 0.0,
        consultationsCompleted: 0,
        patientsSeen: 0,
        prescriptionsDispensed: 0,
        tokensIssued: 0,
        hasActivity: false
      };

      if (res.ok) {
        attendanceMetrics = await res.json();
      }

      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const now = new Date();
      const formattedDate = now.toLocaleString();

      // Top Header Trim (Hospital Blue/Black Deep Slate)
      doc.setFillColor(15, 23, 42); // slate-900 style primary color
      doc.rect(0, 0, 210, 25, 'F');

      // Title text inside the header band
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("M E D F L O W  H O S P I T A L  S Y S T E M S", 14, 11);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text("Official Clinical Profile & Administrative Credentials Dossier", 14, 18);

      // Section 1: Personnel Overview Card
      doc.setFillColor(248, 250, 252); // slate-50 background for profile card
      doc.rect(14, 32, 182, 32, 'F');
      doc.setDrawColor(226, 232, 240); // slate-200 border
      doc.rect(14, 32, 182, 32, 'S');

      // Profile Header inside the Card
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      const displayName = u.role === 'DOCTOR' ? `Dr. ${u.name}` : u.name;
      doc.text(displayName, 18, 42);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(79, 70, 229); // indigo-600
      doc.text(`ROLE: ${u.role || 'N/A'} - ${u.designation || 'Staff Member'}`, 18, 48);

      doc.setTextColor(100, 116, 139); // slate-500
      doc.setFont("helvetica", "normal");
      doc.text(`Employee ID: ${u.employeeId || 'N/A'}`, 18, 54);
      doc.text(`Date Joined: ${u.dateJoined ? new Date(u.dateJoined).toLocaleDateString() : 'N/A'}`, 18, 59);

      // Status Badge on the right
      const isActive = u.role === 'DOCTOR' 
        ? (u.dutyStatus === 'ON DUTY' || u.dutyStatus === 'ON_DUTY')
        : (u.employmentStatus === 'ACTIVE' || !!u.isActive);
      
      if (isActive) {
        doc.setFillColor(240, 253, 250); // teal-50
        doc.rect(145, 38, 45, 9, 'F');
        doc.setDrawColor(153, 246, 228); // teal-200
        doc.rect(145, 38, 45, 9, 'S');
        doc.setTextColor(15, 118, 110); // teal-700
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("STATUS: ON DUTY/ACTIVE", 149, 44);
      } else {
        doc.setFillColor(254, 242, 242); // red-50
        doc.rect(145, 38, 45, 9, 'F');
        doc.setDrawColor(254, 202, 202); // red-200
        doc.rect(145, 38, 45, 9, 'S');
        doc.setTextColor(185, 28, 28); // red-700
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("STATUS: INACTIVE / OFF", 149, 44);
      }

      // Section 2: Core Details Grid
      doc.setTextColor(15, 23, 42); // slate-900
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("1. Professional Profile Duties", 14, 73);
      doc.line(14, 75, 196, 75);

      autoTable(doc, {
        startY: 77,
        theme: 'grid',
        head: [['Characteristic', 'Administrative Assignment Detail']],
        body: [
          ['Full Name', u.name || 'N/A'],
          ['Professional Role', u.role || 'N/A'],
          ['Specific Designation', u.designation || 'Staff'],
          ['Assigned Department', u.department || 'Operations'],
          ['Assigned Shift Type', u.shiftType || 'MORNING'],
          ['Employment Nature', u.employmentStatus || 'ACTIVE']
        ],
        styles: { fontSize: 8.5, cellPadding: 2 },
        headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255] },
        columnStyles: { 0: { cellWidth: 45, fontStyle: 'bold' } },
        margin: { left: 14, right: 14 }
      });

      // Section 3: Residence and Contacts
      const curY1 = (doc as any).lastAutoTable.finalY + 8;
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("2. Residence Address & Contact Information", 14, curY1);
      doc.line(14, curY1 + 2, 196, curY1 + 2);

      const addressLine = [u.addressLine1, u.addressLine2].filter(Boolean).join(', ') || 'N/A';
      const cityState = [u.city, u.state].filter(Boolean).join(', ') || 'N/A';
      const postalCountry = [u.postalCode, u.country].filter(Boolean).join(', ') || 'N/A';

      autoTable(doc, {
        startY: curY1 + 4,
        theme: 'grid',
        head: [['Entity', 'Contact Details & Geographical Reference']],
        body: [
          ['Telephone Number', u.phone || 'No phone supplied'],
          ['System Email Address', u.email || 'None (Non-Login profile/Roster-Only)'],
          ['Street Residence Address', addressLine],
          ['City / Province', cityState],
          ['Postal Code / Country', postalCountry]
        ],
        styles: { fontSize: 8.5, cellPadding: 2 },
        headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255] },
        columnStyles: { 0: { cellWidth: 45, fontStyle: 'bold' } },
        margin: { left: 14, right: 14 }
      });

      // Section 4: Attendance & Schedule Audit
      const curY2 = (doc as any).lastAutoTable.finalY + 8;
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("3. Quality Duty & Attendance Summary", 14, curY2);
      doc.line(14, curY2 + 2, 196, curY2 + 2);

      // Construct dynamic database stats based on real logs
      const complianceBody = [
        ['Roster Time-card Status', isActive ? 'PRESENT AND ACTIVE' : 'STANDBY / ABSENT'],
        ['Present Days (Activity Logged)', `${attendanceMetrics.presentDays} days`],
        ['Absent Days (No Activity)', `${attendanceMetrics.absentDays} days`],
        ['Validated Duty Hours (All-Time)', `${attendanceMetrics.dutyHours} hours`]
      ];

      if (u.role === 'DOCTOR') {
        complianceBody.push(
          ['Consultations Completed', `${attendanceMetrics.consultationsCompleted}`],
          ['Patients Seen (Unique Count)', `${attendanceMetrics.patientsSeen}`]
        );
      } else if (u.role === 'PHARMACY') {
        complianceBody.push(
          ['Prescriptions Dispensed', `${attendanceMetrics.prescriptionsDispensed}`]
        );
      } else if (u.role === 'RECEPTION') {
        complianceBody.push(
          ['Tokens Handled', `${attendanceMetrics.tokensIssued}`]
        );
      }

      complianceBody.push(
        ['Administrative Notes', u.notes || 'No exceptional logs reported for this active period. Personnel maintains high standard compliance.']
      );

      autoTable(doc, {
        startY: curY2 + 4,
        theme: 'grid',
        head: [['Metric / Clinical Indicator', 'Compliance Registry Log (Database-driven)']],
        body: complianceBody,
        styles: { fontSize: 8.5, cellPadding: 2 },
        headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255] },
        columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold' } },
        margin: { left: 14, right: 14 }
      });

      // Footer
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text(`Official Document - Generated on ${formattedDate} by Admin`, 14, 287);
      doc.text(`Confidential • Page 1 of ${pageCount}`, 170, 287);

      doc.save(`MedFlow_Staff_Dossier_${u.employeeId || 'N/A'}.pdf`);
      toast.success(`Dossier PDF for ${u.name} exported successfully!`, { id: 'individual-pdf' });
    } catch (err) {
      console.error(err);
      toast.error('Failed to export individual dossier PDF.', { id: 'individual-pdf' });
    }
  };

  // Department Management
  const [newDeptName, setNewDeptName] = useState('');
  const [isAddingDept, setIsAddingDept] = useState(false);

  // Form states for Add / Edit
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'DOCTOR' | 'RECEPTION' | 'PHARMACY' | 'STAFF'>('DOCTOR');
  const [department, setDepartment] = useState('General Medicine');
  
  // Custom manual department entry
  const [customDeptName, setCustomDeptName] = useState('');
  
  // Hospital-grade staff profile fields
  const [employeeId, setEmployeeId] = useState('');
  const [designation, setDesignation] = useState('');
  const [phone, setPhone] = useState('');
  const [dateJoined, setDateJoined] = useState(new Date().toISOString().split('T')[0]);
  const [employmentStatus, setEmploymentStatus] = useState('ACTIVE');
  const [notes, setNotes] = useState('');
  const [isLoginEnabled, setIsLoginEnabled] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [shiftType, setShiftType] = useState('MORNING');

  // Address fields
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');

  // Load and refresh live database-driven resources
  useEffect(() => {
    fetchUsers();
    fetchDepartments();
    fetchTokens();
  }, []);

  // Handle direct tab switches e.g. from the dashboard or notifications
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('tab') === 'resets') {
      setActiveTab('RESETS');
      fetchResetRequests();
    }
  }, [location.search]);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await authFetch('/api/duty-settings');
        if (res.ok) {
          const data = await res.json();
          if (data.morningShiftEnd) setMorningShiftEnd(data.morningShiftEnd);
          if (data.eveningShiftEnd) setEveningShiftEnd(data.eveningShiftEnd);
          if (data.timezone) setTimezoneReference(data.timezone);
        }
      } catch (err) {
        console.error('Failed to fetch duty settings', err);
      }
    };
    fetchSettings();
  }, []);

  // Update default department selection when departments are fetched
  useEffect(() => {
    if (departments && departments.length > 0 && !department) {
      setDepartment(departments[0].name);
    }
  }, [departments]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const res = await authFetch('/api/duty-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ morningShiftEnd, eveningShiftEnd, timezone: timezoneReference })
      });
      if (res.ok) {
        toast.success('Duty Schedule Settings updated successfully');
      } else {
        toast.error('Failed to save duty settings');
      }
    } catch (err) {
      toast.error('Error saving settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeptName.trim()) {
      toast.error('Please enter a department name');
      return;
    }
    setIsAddingDept(true);
    try {
      await addDepartment(newDeptName.trim());
      toast.success(`Department "${newDeptName.trim()}" successfully registered!`);
      setNewDeptName('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to register department');
    } finally {
      setIsAddingDept(false);
    }
  };

  // Adjust credentials preview dynamically when typing name/role/employeeId
  useEffect(() => {
    if (!userToEdit && isLoginEnabled) {
      const fullName = `${firstName} ${lastName}`.trim();
      const roleCount = (users || []).filter(u => u.role === role).length;
      const creds = generateStaffCredentials(role as any, fullName, roleCount, employeeId);
      setEmail(creds.email);
      setPassword(creds.password);
    }
  }, [firstName, lastName, role, employeeId, userToEdit, isLoginEnabled]);

  // Dynamically enable login credentials ONLY for DOCTOR role
  useEffect(() => {
    if (role === 'DOCTOR') {
      setIsLoginEnabled(true);
    } else {
      setIsLoginEnabled(false);
      setEmail('');
      setPassword('');
      setPin('');
    }
  }, [role]);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fullName = `${firstName} ${lastName}`.trim();
    if (!fullName) {
      toast.error('Please enter first and last name');
      return;
    }

    let finalDepartment = department;
    if (department === '_CUSTOM_') {
      const trimmedCustom = customDeptName.trim();
      if (!trimmedCustom) {
        toast.error('Please enter custom Department name');
        return;
      }
      try {
        await addDepartment(trimmedCustom);
      } catch (err) {
        // Safe to ignore if department already exists
        console.log('Department already exists or errored:', err);
      }
      finalDepartment = trimmedCustom;
    }

    try {
      const trimmedEmpId = employeeId.trim();
      if (!trimmedEmpId || trimmedEmpId.toUpperCase() === 'N/A') {
        toast.error('Employee ID is mandatory and cannot be empty or N/A.');
        return;
      }
      const idExists = users.some(u => u.employeeId && u.employeeId.toUpperCase() === trimmedEmpId.toUpperCase());
      if (idExists) {
        toast.error(`Employee ID "${trimmedEmpId}" is already assigned to another staff member.`);
        return;
      }

      const finalUser: any = {
        name: fullName,
        role: role as UserRole,
        department: finalDepartment || 'General Medicine',
        employeeId: trimmedEmpId,
        designation: designation || (role === 'DOCTOR' ? 'Consultant Physician' : role === 'PHARMACY' ? 'Pharmacist' : 'Support Specialist'),
        phone: phone || '',
        dateJoined: dateJoined ? new Date(dateJoined).toISOString() : new Date().toISOString(),
        employmentStatus: employmentStatus || 'ACTIVE',
        notes: notes || '',
        shiftType: shiftType || 'MORNING',
        addressLine1: addressLine1 || '',
        addressLine2: addressLine2 || '',
        city: city || '',
        state: state || '',
        postalCode: postalCode || '',
        country: country || ''
      };

      if (role === 'DOCTOR' && isLoginEnabled) {
        finalUser.email = email || `${fullName.toLowerCase().replace(/\s+/g, '')}@medflow.com`;
        finalUser.password = password || 'MedFlowPass123';
        finalUser.pin = pin || '';
      } else {
        finalUser.email = null;
        finalUser.password = null;
        finalUser.pin = null;
      }

      await addUser(finalUser);
      
      addActivityLog({
        id: Math.random().toString(36).substring(7),
        action: 'Staff Registered',
        user: 'Administrator',
        timestamp: new Date().toISOString(),
        details: `${finalUser.name} onboarding complete as ${finalUser.role} in ${finalUser.department}`,
      });
      
      if (isLoginEnabled) {
        setShowCredentials({ email: finalUser.email, pass: finalUser.password });
      } else {
        toast.success(`Staff profile for ${fullName} registered successfully!`);
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add staff member');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToEdit) return;

    const fullName = `${firstName} ${lastName}`.trim();
    if (!fullName) {
      toast.error('Please enter name');
      return;
    }

    let finalDepartment = department;
    if (department === '_CUSTOM_') {
      const trimmedCustom = customDeptName.trim();
      if (!trimmedCustom) {
        toast.error('Please enter custom Department name');
        return;
      }
      try {
        await addDepartment(trimmedCustom);
      } catch (err) {
        console.log('Department already exists or errored:', err);
      }
      finalDepartment = trimmedCustom;
    }

    try {
      const trimmedEmpId = employeeId.trim();
      if (!trimmedEmpId || trimmedEmpId.toUpperCase() === 'N/A') {
        toast.error('Employee ID is mandatory and cannot be empty or N/A.');
        return;
      }
      const idExists = users.some(u => u.id !== userToEdit.id && u.employeeId && u.employeeId.toUpperCase() === trimmedEmpId.toUpperCase());
      if (idExists) {
        toast.error(`Employee ID "${trimmedEmpId}" is already assigned to another staff member.`);
        return;
      }

      const updatedData = {
        ...userToEdit,
        name: fullName,
        role: role as UserRole,
        department: finalDepartment || 'General Medicine',
        employeeId: trimmedEmpId,
        designation: designation || userToEdit.designation,
        phone,
        dateJoined: dateJoined ? new Date(dateJoined).toISOString() : userToEdit.dateJoined,
        employmentStatus,
        notes,
        shiftType,
        addressLine1: addressLine1 || '',
        addressLine2: addressLine2 || '',
        city: city || '',
        state: state || '',
        postalCode: postalCode || '',
        country: country || '',
        email: (role === 'DOCTOR' && isLoginEnabled) ? (email || userToEdit.email || `${fullName.toLowerCase().replace(/\s+/g, '')}@medflow.com`) : null,
        password: (role === 'DOCTOR' && isLoginEnabled) ? (password || userToEdit.password || 'MedFlowPass123') : null,
        pin: (role === 'DOCTOR' && isLoginEnabled) ? (pin || userToEdit.pin) : null
      };

      await updateUser(updatedData);

      addActivityLog({
        id: Math.random().toString(36).substring(7),
        action: 'Staff Updated',
        user: 'Administrator',
        timestamp: new Date().toISOString(),
        details: `${updatedData.name} profile credentials modified successfully`,
      });

      toast.success('Staff record updated successfully');
      setUserToEdit(null);
      setIsModalOpen(false);
      resetForm();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update user details.');
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      await deleteUser(userToDelete.id);
      addActivityLog({
        id: Math.random().toString(36).substring(7),
        action: 'Staff Deleted',
        user: 'Administrator',
        timestamp: new Date().toISOString(),
        details: `${userToDelete.name} (${userToDelete.role}) removed from system database`,
      });
      toast.success(`${userToDelete.name} removed successfully`);
      setUserToDelete(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to remove staff');
    }
  };

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setRole('DOCTOR');
    setDepartment(departments[0]?.name || 'General Medicine');
    setCustomDeptName('');
    setEmployeeId(`EMP-${Math.floor(1000 + Math.random() * 9000)}`);
    setDesignation('');
    setPhone('');
    setDateJoined(new Date().toISOString().split('T')[0]);
    setEmploymentStatus('ACTIVE');
    setNotes('');
    setIsLoginEnabled(true);
    setEmail('');
    setPassword('');
    setPin('');
    setShiftType('MORNING');
    setAddressLine1('');
    setAddressLine2('');
    setCity('');
    setState('');
    setPostalCode('');
    setCountry('');
  };

  const fetchResetRequests = async () => {
    setIsResetRequestsLoading(true);
    try {
      const res = await authFetch('/api/admin/password-reset-requests');
      if (res.ok) {
        setResetRequests(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsResetRequestsLoading(false);
    }
  };

  const handleResolveResetRequest = async (id: string, employeeName: string) => {
    try {
      const res = await authFetch(`/api/admin/password-reset-requests/${id}/resolve`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedTempPass(data.tempPassword);
        setTempPassEmployeeName(employeeName);
        toast.success(`Temporary password generated successfully for ${employeeName}`);
        fetchResetRequests();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to resolve request');
      }
    } catch (error) {
      toast.error('Network error resolving password reset request.');
    }
  };

  const handleRejectResetRequest = async (id: string, employeeName: string) => {
    try {
      const res = await authFetch(`/api/admin/password-reset-requests/${id}/reject`, {
        method: 'POST'
      });
      if (res.ok) {
        toast.success(`Password reset request rejected for ${employeeName}`);
        fetchResetRequests();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to reject request');
      }
    } catch (error) {
      toast.error('Network error rejecting request.');
    }
  };

  const openAddModal = () => {
    resetForm();
    setUserToEdit(null);
    setIsModalOpen(true);
  };

  const openEditModal = (u: any) => {
    setUserToEdit(u);
    const names = u.name.split(' ');
    setFirstName(names[0] || '');
    setLastName(names.slice(1).join(' ') || '');
    setRole(u.role);
    setDepartment(u.department || 'General Medicine');
    setCustomDeptName('');
    setEmployeeId(u.employeeId || '');
    setDesignation(u.designation || '');
    setPhone(u.phone || '');
    setDateJoined(u.dateJoined ? new Date(u.dateJoined).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    setEmploymentStatus(u.employmentStatus || 'ACTIVE');
    setNotes(u.notes || '');
    setIsLoginEnabled(!!u.email);
    setEmail(u.email || '');
    setPassword(u.password || '');
    setPin(u.pin || '');
    setShiftType(u.shiftType || 'MORNING');
    setAddressLine1(u.addressLine1 || '');
    setAddressLine2(u.addressLine2 || '');
    setCity(u.city || '');
    setState(u.state || '');
    setPostalCode(u.postalCode || '');
    setCountry(u.country || '');
    setIsModalOpen(true);
  };

  // Dual filtering combining: Active Tab Selection, Search Terms, and Advanced Filters Dropdowns
  const filteredUsers = (users || []).filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (u.email && u.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          (u.employeeId && u.employeeId.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          (u.designation && u.designation.toLowerCase().includes(searchTerm.toLowerCase()));
    
    // Tab filtering
    const matchesTab = activeTab === 'ALL' || u.role === activeTab;
    
    // Role filter dropdown
    const matchesRole = filterRole === 'ALL' || u.role === filterRole;

    // Department filter dropdown
    const matchesDept = filterDept === 'ALL' || u.department === filterDept;

    // Status filter dropdown
    let matchesStatus = true;
    if (filterStatus !== 'ALL') {
      if (filterStatus === 'ACTIVE') {
        if (u.role === 'DOCTOR') {
          matchesStatus = u.dutyStatus === 'ON DUTY' || u.dutyStatus === 'ON_DUTY';
        } else {
          matchesStatus = u.employmentStatus === 'ACTIVE' || !!u.isActive;
        }
      } else if (filterStatus === 'INACTIVE') {
        if (u.role === 'DOCTOR') {
          matchesStatus = u.dutyStatus !== 'ON DUTY' && u.dutyStatus !== 'ON_DUTY';
        } else {
          matchesStatus = u.employmentStatus === 'INACTIVE' || !u.isActive;
        }
      } else if (filterStatus === 'ON_DUTY') {
        matchesStatus = u.dutyStatus === 'ON DUTY' || u.dutyStatus === 'ON_DUTY';
      }
    }

    return matchesSearch && matchesTab && matchesRole && matchesDept && matchesStatus;
  });

  // Calculate live statistical counters directly from actual Neon PostgreSQL models
  const totalStaffCount = (users || []).length;
  const activeStaffCount = (users || []).filter(u => {
    if (u.role === 'DOCTOR') {
      return u.dutyStatus === 'ON DUTY' || u.dutyStatus === 'ON_DUTY';
    }
    return u.employmentStatus === 'ACTIVE' || !!u.isActive;
  }).length;
  const doctorsCount = (users || []).filter(u => u.role === 'DOCTOR').length;
  const receptionCount = (users || []).filter(u => u.role === 'RECEPTION').length;
  const pharmacyCount = (users || []).filter(u => u.role === 'PHARMACY').length;
  const departmentsCount = (departments || []).length;

  // Real data PDF (.pdf) hospital-grade report exporter
  const handleExportPDF = () => {
    if (filteredUsers.length === 0) {
      toast.error("No staff records found to export.");
      return;
    }

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const now = new Date();
    const formattedDate = now.toLocaleString();

    // Add Logo or Decorative elements
    doc.setFillColor(15, 23, 42); // slate-900 style primary color
    doc.rect(0, 0, 297, 25, 'F');

    // Title text inside the header band
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("M E D F L O W  H O S P I T A L  S Y S T E M S", 14, 11);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Clinical Personnel Directory Registry • Departmental Audit", 14, 18);

    // Meta-information Block
    doc.setTextColor(51, 65, 85); // slate-700
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Hospital Name:", 14, 34);
    doc.setFont("helvetica", "normal");
    doc.text("MedFlow Medical Center", 48, 34);

    doc.setFont("helvetica", "bold");
    doc.text("Generated Date:", 14, 40);
    doc.setFont("helvetica", "normal");
    doc.text(formattedDate, 48, 40);

    doc.setFont("helvetica", "bold");
    doc.text("Total Staff Count:", 150, 34);
    doc.setFont("helvetica", "normal");
    doc.text(`${filteredUsers.length} filtered (${users.length} total)`, 185, 34);

    doc.setFont("helvetica", "bold");
    doc.text("Generated By:", 150, 40);
    doc.setFont("helvetica", "normal");
    doc.text("System Administrator: roshanpattathilsep16@gmail.com", 185, 40);

    // Department breakdown
    const deptCounts: Record<string, number> = {};
    filteredUsers.forEach(u => {
      const dept = u.department || 'General Medicine';
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    });
    const deptSummaryStr = Object.entries(deptCounts)
      .map(([name, count]) => `${name}: ${count}`)
      .join("  |  ");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Departmental Breakdown:", 14, 47);
    doc.setFont("helvetica", "normal");
    doc.text(deptSummaryStr, 58, 47);

    // Table data mapping
    const tableHeaders = [
      ["Employee ID", "Full Name", "Designation / Role", "Department", "Shift", "Status", "Date Joined", "Contact Information", "Residence Address"]
    ];

    const tableRows = filteredUsers.map(u => {
      const isDoctor = u.role === 'DOCTOR';
      const isActive = isDoctor 
        ? (u.dutyStatus === 'ON DUTY' || u.dutyStatus === 'ON_DUTY')
        : (u.employmentStatus === 'ACTIVE' || !!u.isActive);

      const addressParts = [u.addressLine1, u.addressLine2, u.city, u.state, u.postalCode, u.country].filter(Boolean);
      const fullAddressDisplay = addressParts.join(', ') || 'N/A';

      const contactDisplay = `${u.phone || 'No Phone'}\n${u.email || 'No login account'}`;

      return [
        u.employeeId || 'N/A',
        u.name || 'N/A',
        `${u.role || 'N/A'}${u.designation ? ' - ' + u.designation : ''}`,
        u.department || 'General Medicine',
        u.shiftType || 'MORNING',
        isActive ? 'ACTIVE' : 'INACTIVE',
        u.dateJoined ? new Date(u.dateJoined).toLocaleDateString() : 'N/A',
        contactDisplay,
        fullAddressDisplay
      ];
    });

    autoTable(doc, {
      head: tableHeaders,
      body: tableRows,
      startY: 53,
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 2.5,
        overflow: 'linebreak',
        font: 'helvetica'
      },
      headStyles: {
        fillColor: [15, 23, 42], // Slate-900 primary
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
        valign: 'middle'
      },
      columnStyles: {
        0: { cellWidth: 24, fontStyle: 'bold', halign: 'center' }, // Employee ID
        1: { cellWidth: 32 }, // Full Name
        2: { cellWidth: 32 }, // Designation
        3: { cellWidth: 28 }, // Department
        4: { cellWidth: 16, halign: 'center' }, // Shift
        5: { cellWidth: 18, halign: 'center' }, // Status
        6: { cellWidth: 24, halign: 'center' }, // Date Joined
        7: { cellWidth: 40 }, // Contact Info (Phone + Email)
        8: { cellWidth: 55 }  // Residence Address
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252] // Very light off-white slate background
      },
      margin: { left: 14, right: 14, bottom: 15 },
      didDrawPage: (data) => {
        // Footer bar with page numbers
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text(`Page ${data.pageNumber}`, 14, 203);
        doc.text(`Confidential - MedFlow Internal Staff Records`, 215, 203);
      }
    });

    // Save PDF
    const fileName = `MedFlow_Staff_Roster_${now.toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
    toast.success(`Successfully generated hospital-grade PDF with ${filteredUsers.length} staff records!`);
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500" id="staff-management-container">
      {/* Page Header */}
      <div className="medflow-page-header flex justify-between items-center" id="user-mgt-header">
        <div className="medflow-page-header-left">
          <h1 className="text-2xl font-bold text-slate-800">Hospital Systems Staff & Directory</h1>
          <p className="text-sm text-slate-500">Add, audit, and coordinate both Login and Non-Login employees, departments, and live schedules.</p>
        </div>
        <div className="medflow-page-actions flex gap-3">
          <button 
            type="button"
            id="onboard-new-staff"
            className="medflow-btn medflow-btn-primary flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm"
            onClick={openAddModal}
          >
            <Plus size={16} />
            <span>Onboard Personnel</span>
          </button>
        </div>
      </div>

      {/* Staff Statistics Cards - Dynamically calculated from database */}
      <div className="medflow-ov-stats grid grid-cols-2 md:grid-cols-6 gap-4" id="real-stats-dashboard">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Users size={16} /></span>
            <span className="text-[10px] font-bold text-blue-600 px-1.5 py-0.5 bg-blue-50 rounded-full">Live</span>
          </div>
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Staff</div>
          <div className="text-xl font-extrabold text-slate-800 mt-1">{totalStaffCount}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><CheckCircle2 size={16} /></span>
            <span className="text-[10px] font-bold text-emerald-600 px-1.5 py-0.5 bg-emerald-50 rounded-full">Active</span>
          </div>
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Staff</div>
          <div className="text-xl font-extrabold text-slate-800 mt-1">{activeStaffCount}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><UserRound size={16} /></span>
            <span className="text-[10px] font-bold text-indigo-600 px-1.5 py-0.5 bg-indigo-50 rounded-full">MDs</span>
          </div>
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Doctors</div>
          <div className="text-xl font-extrabold text-slate-800 mt-1">{doctorsCount}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="p-2 bg-teal-50 text-teal-600 rounded-lg"><Activity size={16} /></span>
            <span className="text-[10px] font-bold text-teal-600 px-1.5 py-0.5 bg-teal-50 rounded-full">Desk</span>
          </div>
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Reception</div>
          <div className="text-xl font-extrabold text-slate-800 mt-1">{receptionCount}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="p-2 bg-orange-50 text-orange-600 rounded-lg"><Lock size={16} /></span>
            <span className="text-[10px] font-bold text-orange-600 px-1.5 py-0.5 bg-orange-50 rounded-full">Rx</span>
          </div>
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Pharmacy</div>
          <div className="text-xl font-extrabold text-slate-800 mt-1">{pharmacyCount}</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="p-2 bg-pink-50 text-pink-600 rounded-lg"><BookOpen size={16} /></span>
            <span className="text-[10px] font-bold text-pink-600 px-1.5 py-0.5 bg-pink-50 rounded-full">Dept</span>
          </div>
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Departments</div>
          <div className="text-xl font-extrabold text-slate-800 mt-1">{departmentsCount}</div>
        </div>
      </div>

      {/* Directory Tab Selection Bar */}
      <div className="flex border-b border-slate-200" id="directory-tab-bar">
        {[
          { id: 'ALL', label: 'All Employees Directory', icon: Users },
          { id: 'DOCTOR', label: 'Clinical Physician Directory', icon: UserRound },
          { id: 'PHARMACY', label: 'Pharmacy Staff Directory', icon: Activity },
          { id: 'RECEPTION', label: 'Reception Staff Directory', icon: CheckCircle2 },
          { id: 'RESETS', label: 'Password Reset Review', icon: Key }
        ].map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id as any);
                setFilterRole('ALL'); // reset secondary filter for clean view
                if (tab.id === 'RESETS') {
                  fetchResetRequests();
                }
              }}
              className={`flex items-center gap-2 px-6 py-3 border-b-2 text-sm font-bold transition-all ${
                isSelected 
                  ? 'border-blue-650 text-blue-650' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-200'
              }`}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Advanced Filter and Real-Time Search control panel */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4" id="advanced-filter-controls">
        <div className="flex flex-col md:flex-row items-center gap-4">
          {/* Dynamic search bar */}
          <div className="flex-1 w-full relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="search" 
              placeholder="Search by Employee ID, Name, Designation, phone, or Username Email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 transition-all text-slate-700"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Dynamic Department Selector option directly from the DB */}
            <div className="relative min-w-[150px]">
              <select 
                value={filterDept}
                onChange={(e) => setFilterDept(e.target.value)}
                className="w-full pl-3 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 appearance-none focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Departments</option>
                {departments.map((dept: any) => (
                  <option key={dept.id} value={dept.name}>{dept.name}</option>
                ))}
              </select>
            </div>

            {/* Custom status selector */}
            <div className="relative min-w-[150px]">
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full pl-3 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 appearance-none focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Employment: Active</option>
                <option value="INACTIVE">Employment: Inactive</option>
                <option value="ON_DUTY">Currently: ON DUTY</option>
              </select>
            </div>

            {/* Secondary role fallback filter when browsing 'ALL' tab */}
            {activeTab === 'ALL' && (
              <div className="relative min-w-[150px]">
                <select 
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="w-full pl-3 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 appearance-none focus:outline-none cursor-pointer"
                >
                  <option value="ALL">All Roles</option>
                  <option value="ADMIN">System Admins</option>
                  <option value="DOCTOR">Physicians</option>
                  <option value="RECEPTION">Reception Ops</option>
                  <option value="PHARMACY">Pharmacists</option>
                </select>
              </div>
            )}

            <button 
              type="button"
              onClick={() => {
                fetchUsers();
                fetchDepartments();
                fetchTokens();
                toast.success('Roster records updated in real-time');
              }}
              className="p-3 bg-slate-50 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200 transition-all duration-150"
              title="Refresh lists"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Staff Directory Table containing tailored Views based on active tab requirements */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" id="staff-directory-table-block">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
          <div>
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
              {activeTab === 'ALL' ? 'Complete Personnel Registry' : 
               activeTab === 'DOCTOR' ? 'Doctor Registry (Clinicians)' :
               activeTab === 'PHARMACY' ? 'Pharmacy Roster' : 
               activeTab === 'RESETS' ? 'Medical Staff Password Reset Requests' : 'Reception Operations Desk'}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeTab === 'RESETS' ? `Showing ${resetRequests.length} pending secure auth requests` : `Showing ${filteredUsers.length} matched database records`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExportPDF}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-sm transition-all"
              title="Export Complete Registry PDF"
            >
              <Download size={13} />
              <span>Export Full Staff PDF</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto w-full">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs text-slate-600">
            {/* Custom doctor headers vs support staff headers */}
            <thead className="bg-slate-50 font-bold text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
              {activeTab === 'RESETS' ? (
                <tr>
                  <th className="px-6 py-3.5">Doctor Profile Name</th>
                  <th className="px-6 py-3.5">Employee ID</th>
                  <th className="px-6 py-3.5">System Role</th>
                  <th className="px-6 py-3.5 font-bold">Department</th>
                  <th className="px-6 py-3.5">Requested At</th>
                  <th className="px-6 py-3.5 text-right">Actions / Review Authorization</th>
                </tr>
              ) : activeTab === 'DOCTOR' ? (
                <tr>
                  <th className="px-6 py-3.5">Name / Doctor Profile</th>
                  <th className="px-6 py-3.5">Employee ID</th>
                  <th className="px-6 py-3.5">Department / Specialization</th>
                  <th className="px-6 py-3.5">Duty Status</th>
                  <th className="px-6 py-3.5 text-center">Active Patients</th>
                  <th className="px-6 py-3.5 text-center">Today's Consultations</th>
                  <th className="px-6 py-3.5">Date Joined</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              ) : (
                <tr>
                  <th className="px-6 py-3.5">Staff Personnel Name</th>
                  <th className="px-6 py-3.5">Employee ID</th>
                  <th className="px-6 py-3.5">Role / Designation</th>
                  <th className="px-6 py-3.5 font-bold">Department</th>
                  <th className="px-6 py-3.5">Shift</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Contact Number</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              )}
            </thead>

            {/* Live rendered list */}
            <tbody className="divide-y divide-slate-100 font-semibold" id="directory-table-rows">
              {activeTab === 'RESETS' ? (
                resetRequests.length > 0 ? (
                  resetRequests.map((req) => {
                    const initials = req.userName?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'DR';
                    return (
                      <tr key={req.id} className="hover:bg-slate-50 transition-all font-medium">
                        <td className="px-6 py-4 font-bold text-slate-800">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-extrabold text-xs">
                              {initials}
                            </div>
                            <div>
                              <div className="text-sm font-bold text-slate-800">{req.userName}</div>
                              <div className="text-[10px] text-slate-400">Request ID: {req.id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono text-slate-500 font-bold">{req.employeeId}</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-600">
                            {req.userRole}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-600 font-bold">{req.userDepartment}</td>
                        <td className="px-6 py-4 text-slate-500 font-bold">
                          {new Date(req.requestTime).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-2 text-xs font-bold">
                            <button
                              type="button"
                              onClick={() => handleResolveResetRequest(req.id, req.userName)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs px-2.5 py-1.5 rounded-lg transition-all flex items-center gap-1 shadow-sm"
                            >
                              <Key size={11} /> Generate Temporary PIN
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectResetRequest(req.id, req.userName)}
                              className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs px-2.5 py-1.5 rounded-lg transition-all border border-rose-200"
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="text-center py-10 text-slate-400 font-bold">
                      🎉 No pending password recovery requests found.
                    </td>
                  </tr>
                )
              ) : filteredUsers.length > 0 ? (
                filteredUsers.map((user) => {
                  const initials = user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'ST';
                  
                  // Avatars
                  let avatarBg = 'bg-slate-100';
                  let avatarFg = 'text-slate-600';
                  if (user.role === 'ADMIN') { avatarBg = 'bg-rose-50'; avatarFg = 'text-rose-700'; }
                  else if (user.role === 'DOCTOR') { avatarBg = 'bg-blue-50'; avatarFg = 'text-blue-700'; }
                  else if (user.role === 'RECEPTION') { avatarBg = 'bg-emerald-50'; avatarFg = 'text-emerald-700'; }
                  else if (user.role === 'PHARMACY') { avatarBg = 'bg-indigo-50'; avatarFg = 'text-indigo-700'; }

                  // Date conversion
                  const joinDisplay = user.dateJoined ? new Date(user.dateJoined).toLocaleDateString() : 'N/A';

                  // Doctors detailed calculations
                  const activePatients = tokens.filter((tk: any) => tk.doctorId === user.id && (tk.status === 'WAITING' || tk.status === 'IN_CONSULTATION')).length;
                  const todayConsultations = tokens.filter((tk: any) => tk.doctorId === user.id && tk.status === 'COMPLETED').length;

                  return activeTab === 'DOCTOR' ? (
                    /* DOCTOR DIRECTORY DETAILS VIEW */
                    <tr key={user.id} className="hover:bg-slate-50/50 transition-all font-medium">
                      <td className="px-6 py-4 font-bold text-slate-800">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full ${avatarBg} ${avatarFg} flex items-center justify-center font-extrabold text-xs`}>
                            {initials}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-850 flex items-center gap-1.5">
                              <span>Dr. {user.name}</span>
                              {user.email ? (
                                <span title="System login authenticated">
                                  <Lock size={12} className="text-slate-400" />
                                </span>
                              ) : (
                                <span className="text-[9px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded">Roster Only</span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 font-medium font-sans">{user.email || 'No credentials'}</div>
                            {user.city && (
                              <div className="text-[10px] text-teal-650 mt-1 font-semibold flex items-center gap-1">📍 {user.addressLine1}, {user.city}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-500">{user.employeeId || 'N/A'}</td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-700">{user.department || 'General Medicine'}</div>
                        <div className="text-[11px] text-slate-400">{user.designation || 'Consultant Physician'}</div>
                      </td>
                      <td className="px-6 py-4">
                        {user.dutyStatus === 'ON DUTY' || user.dutyStatus === 'ON_DUTY' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span> ON DUTY
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-50 text-slate-500">
                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full"></span> INACTIVE
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center font-bold text-indigo-600 text-sm">{activePatients}</td>
                      <td className="px-6 py-4 text-center font-bold text-slate-800 text-sm">{todayConsultations}</td>
                      <td className="px-6 py-4 text-slate-500">{joinDisplay}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button 
                            type="button" 
                            className="p-1 px-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded border border-transparent transition-all"
                            title="Inspect Profile"
                            onClick={() => setSelectedStaffProfile(user)}
                          >
                            <Eye size={14} />
                          </button>
                          <button 
                            type="button" 
                            className="p-1 px-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded border border-transparent transition-all"
                            title="Edit Record"
                            onClick={() => openEditModal(user)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button 
                            type="button" 
                            className="p-1 px-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded border border-transparent transition-all"
                            title="Export Individual PDF"
                            onClick={() => handleExportIndividualPDF(user)}
                          >
                            <FileText size={13} />
                          </button>
                          {!isProtectedAccount(user) && (
                            <button 
                              type="button" 
                              className="p-1 px-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded border border-transparent transition-all"
                              title="Deactivate / Delete"
                              onClick={() => setUserToDelete(user)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                          {user.email && (
                            <button 
                              type="button" 
                              className="p-1 px-2 text-slate-400 hover:text-indigo-500 hover:bg-blue-50 rounded border border-transparent transition-all"
                              title="Show Credentials PIN"
                              onClick={() => setShowPasswords(prev => ({...prev, [user.id]: !prev[user.id]}))}
                            >
                              <Key size={13} />
                            </button>
                          )}
                        </div>
                        {showPasswords[user.id] && (
                          <div className="text-[10px] text-right font-mono mt-1 text-slate-800 bg-slate-50 px-2.5 py-1.5 rounded border border-slate-200 flex flex-col items-end gap-1.5 shrink-0 ml-auto w-fit">
                            <div className="flex items-center gap-1.5 justify-end">
                              <span>PIN: </span>
                              <span className="font-bold text-indigo-700 font-mono">
                                {revealedPins[user.id] 
                                  ? (user.password?.startsWith('$2') ? '***** (Hashed Securely)' : (user.password || 'MedFlowPass123'))
                                  : '******'
                                }
                              </span>
                            </div>
                            {!revealedPins[user.id] && (
                              <button
                                type="button"
                                onClick={() => handleRequestRevealPin(user.id)}
                                className="text-[9px] bg-red-600 hover:bg-red-750 text-white font-extrabold px-1.5 py-0.5 rounded transition-all shadow-xs"
                              >
                                Reveal PIN
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    /* PHARMACY, RECEPTION AND GENERAL SUPPORT DIRECTORY DISPLAY */
                    <tr key={user.id} className="hover:bg-slate-50/50 transition-all font-semibold">
                      <td className="px-6 py-4 font-bold text-slate-800">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full ${avatarBg} ${avatarFg} flex items-center justify-center font-extrabold text-xs`}>
                            {initials}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                              <span>{user.name}</span>
                              {user.email ? (
                                <span title="System login authenticated">
                                  <Lock size={12} className="text-slate-400" />
                                </span>
                              ) : (
                                <span className="text-[9px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded">Roster Only</span>
                              )}
                            </div>
                            <div className="text-xs text-slate-450 font-normal">{user.email || 'No login credentials'}</div>
                            {user.city && (
                              <div className="text-[10px] text-teal-650 mt-1 font-semibold flex items-center gap-1">📍 {user.addressLine1}, {user.city}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-500">{user.employeeId || 'N/A'}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          user.role === 'ADMIN' ? 'bg-red-50 text-red-600' :
                          user.role === 'RECEPTION' ? 'bg-emerald-50 text-emerald-600' :
                          'bg-indigo-50 text-indigo-600'
                        }`}>
                          {user.role}
                        </span>
                        <div className="text-[10px] text-slate-400 mt-1">{user.designation || 'Staff'}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-600 font-bold">{user.department || 'Operations'}</td>
                      <td className="px-6 py-4 font-bold text-slate-600">
                        <span className="flex items-center gap-1.5">
                          <Clock size={12} className="text-slate-400" />
                          {user.shiftType || 'MORNING'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {(user.role === 'DOCTOR' ? (user.dutyStatus === 'ON DUTY' || user.dutyStatus === 'ON_DUTY') : (user.employmentStatus === 'ACTIVE' || !!user.isActive)) ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700">
                            🟢 ACTIVE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500">
                            ⚫ INACTIVE
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 font-normal text-slate-600">{user.phone || 'N/A'}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button 
                            type="button" 
                            className="p-1 px-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded border border-transparent transition-all"
                            title="Inspect Profile"
                            onClick={() => setSelectedStaffProfile(user)}
                          >
                            <Eye size={14} />
                          </button>
                          <button 
                            type="button" 
                            className="p-1 px-2 text-slate-400 hover:text-indigo-650 hover:bg-slate-100 rounded border border-transparent transition-all"
                            title="Edit Record"
                            onClick={() => openEditModal(user)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button 
                            type="button" 
                            className="p-1 px-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded border border-transparent transition-all"
                            title="Export Individual PDF"
                            onClick={() => handleExportIndividualPDF(user)}
                          >
                            <FileText size={13} />
                          </button>
                          {!isProtectedAccount(user) && (
                            <button 
                              type="button" 
                              className="p-1 px-2 text-slate-400 hover:text-red-650 hover:bg-red-50 rounded border border-transparent transition-all"
                              title="Deactivate / Delete"
                              onClick={() => setUserToDelete(user)}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                          {user.email && (
                            <button 
                              type="button" 
                              className="p-1 px-2 text-slate-400 hover:text-indigo-500 hover:bg-blue-50 rounded border border-transparent transition-all"
                              title="Show Credentials PIN"
                              onClick={() => setShowPasswords(prev => ({...prev, [user.id]: !prev[user.id]}))}
                            >
                              <Key size={13} />
                            </button>
                          )}
                        </div>
                        {showPasswords[user.id] && (
                          <div className="text-[10px] text-right font-mono mt-1 text-slate-800 bg-slate-50 px-2.5 py-1.5 rounded border border-slate-200 flex flex-col items-end gap-1.5 shrink-0 ml-auto w-fit">
                            <div className="flex items-center gap-1.5 justify-end">
                              <span>PIN: </span>
                              <span className="font-bold text-indigo-700 font-mono">
                                {revealedPins[user.id] 
                                  ? (user.password?.startsWith('$2') ? '***** (Hashed Securely)' : (user.password || 'MedFlowPass123'))
                                  : '******'
                                }
                              </span>
                            </div>
                            {!revealedPins[user.id] && (
                              <button
                                type="button"
                                onClick={() => handleRequestRevealPin(user.id)}
                                className="text-[9px] bg-red-600 hover:bg-red-750 text-white font-extrabold px-1.5 py-0.5 rounded transition-all shadow-xs"
                              >
                                Reveal PIN
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-450 bg-slate-50/20 font-bold">
                    No active staff personnel or doctors matched selection criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info counts */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500 font-bold" id="dir-footer">
          <span>Showing 1 to {filteredUsers.length} of {filteredUsers.length} active database records</span>
          <div className="flex gap-1.5">
            <button type="button" className="p-1 px-2 bg-white rounded border border-slate-200 text-[#0b1c30] hover:bg-slate-50"><ChevronLeft size={12} /></button>
            <button type="button" className="p-1 px-3 bg-blue-600 text-white rounded font-bold">1</button>
            <button type="button" className="p-1 px-2 bg-white rounded border border-slate-200 text-[#0b1c30] hover:bg-slate-50"><ChevronRight size={12} /></button>
          </div>
        </div>
      </div>

      {/* Dynamic Departments Creator Roster panel alongside Shift schedule settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" id="util-control-boards">
        {/* Dynamic Department Management Card */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4 border-b border-slate-100 pb-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <BookOpen size={16} />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Hospital Department Registry</h3>
                <p className="text-xs text-slate-400">Add custom departments dynamically connected to database. Updates all workflows immediately.</p>
              </div>
            </div>

            {/* List current departments */}
            <div className="mb-4">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Departments list ({departmentsCount})</label>
              <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto p-1 bg-slate-50 rounded-lg">
                {departments.map((dept: any) => (
                  <span key={dept.id} className="text-[11px] font-bold bg-white text-slate-650 px-2.5 py-1 rounded-md border border-slate-200 shadow-sm">
                    {dept.name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <form onSubmit={handleCreateDepartment} className="flex gap-2">
            <input 
              type="text" 
              placeholder="e.g. Ophthalmology, Dermatology..."
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-xs font-semibold text-slate-705 outline-none focus:ring-2 focus:ring-blue-600/10 focus:border-blue-605"
              required
            />
            <button
              type="submit"
              disabled={isAddingDept}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition-all disabled:opacity-50"
            >
              {isAddingDept ? 'Adding...' : 'Register Dept'}
            </button>
          </form>
        </div>

        {/* Duty Schedule Settings Panel */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-4 border-b border-slate-100 pb-3">
            <div className="w-8 h-8 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center">
              <Clock size={16} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Duty Schedule Settings</h3>
              <p className="text-xs text-slate-400">Configure daily clinical shift durations and automatic transition/reset boundaries.</p>
            </div>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Morning End Time</label>
                <input 
                  type="text" 
                  placeholder="e.g. 01:00 PM"
                  value={morningShiftEnd}
                  onChange={(e) => setMorningShiftEnd(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-600/10 focus:border-indigo-600"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Evening Reset Time</label>
                <input 
                  type="text" 
                  placeholder="e.g. 08:00 PM"
                  value={eveningShiftEnd}
                  onChange={(e) => setEveningShiftEnd(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-600/10 focus:border-indigo-600"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hospital Reference Timezone</label>
              <select
                value={timezoneReference}
                onChange={(e) => setTimezoneReference(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-600/10 focus:border-indigo-600"
                required
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST, UTC+5:30)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST, UTC+4:00)</option>
                <option value="UTC">UTC (GMT, UTC+0:00)</option>
                <option value="America/New_York">America/New_York (EST/EDT, UTC-5/-4)</option>
                <option value="America/Chicago">America/Chicago (CST/CDT, UTC-6/-5)</option>
                <option value="America/Denver">America/Denver (MST/MDT, UTC-7/-6)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT, UTC-8/-7)</option>
                <option value="Europe/London">Europe/London (GMT/BST, UTC+0/+1)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT, UTC+8:00)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isSavingSettings}
              className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 h-[38px]"
            >
              <ShieldCheck size={14} />
              {isSavingSettings ? 'Saving protocols...' : 'Apply Schedule Configuration'}
            </button>
          </form>
        </div>
      </div>

      {/* MODAL SYSTEM */}
      <AnimatePresence>
        {/* VIEW DETAILED STAFF PROFILE MODAL */}
        {selectedStaffProfile && (
          <div className="overlay fixed inset-0 z-50 bg-[#0f172a]/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedStaffProfile(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden w-full max-w-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-extrabold text-lg shadow-sm">
                    {selectedStaffProfile.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                      {selectedStaffProfile.role === 'DOCTOR' ? `Dr. ${selectedStaffProfile.name}` : selectedStaffProfile.name}
                      <span className="text-[10px] bg-indigo-50 text-indigo-700 uppercase font-extrabold px-2 py-0.5 rounded-full">
                        {selectedStaffProfile.role}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-450 leading-relaxed font-bold font-mono">Employee ID: {selectedStaffProfile.employeeId || 'N/A'}</p>
                  </div>
                </div>
                <button 
                  type="button"
                  className="w-8 h-8 rounded-lg bg-white border border-slate-100 hover:bg-slate-50 flex items-center justify-center text-slate-450"
                  onClick={() => setSelectedStaffProfile(null)}
                >
                  <X size={14} />
                </button>
              </div>

              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                {/* Section 1: Employment Context */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1"><Briefcase size={10} /> Department</div>
                    <div className="font-bold text-slate-750 text-xs mt-1.5">{selectedStaffProfile.department || 'Operations'}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1"><BookOpen size={10} /> Designation</div>
                    <div className="font-bold text-slate-750 text-xs mt-1.5">{selectedStaffProfile.designation || 'Staff'}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1"><Clock size={10} /> Assigned Shift</div>
                    <div className="font-bold text-slate-755 text-xs mt-1.5 uppercase flex items-center gap-1"><Clock size={10} className="text-slate-400" />{selectedStaffProfile.shiftType || 'MORNING'}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1"><Calendar size={10} /> Joined Date</div>
                    <div className="font-bold text-slate-750 text-xs mt-1.5">
                      {selectedStaffProfile.dateJoined ? new Date(selectedStaffProfile.dateJoined).toLocaleDateString() : 'N/A'}
                    </div>
                  </div>
                </div>

                {/* Section 2: Personal Profile & Contact */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50/50 px-4 py-2 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wide text-slate-500">Contact & Access Dossier</div>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-semibold">
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-400 flex items-center gap-1"><Phone size={12} /> Contact Phone:</span>
                      <span className="text-slate-800">{selectedStaffProfile.phone || 'No phone supplied'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-400 flex items-center gap-1"><Lock size={12} /> Email Username:</span>
                      <span className="text-slate-800 font-mono text-[11px] font-bold text-indigo-700">{selectedStaffProfile.email || 'None (Non-Login profile)'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-400">Employment Status:</span>
                      <span className="text-slate-800 font-bold uppercase bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px]">{selectedStaffProfile.employmentStatus || 'ACTIVE'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-400">Duty Status indicator:</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        selectedStaffProfile.dutyStatus === 'ON DUTY' || selectedStaffProfile.dutyStatus === 'ON_DUTY' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'
                      }`}>
                        {selectedStaffProfile.dutyStatus || 'INACTIVE'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Section 2.5: Residence Address */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50/50 px-4 py-2 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wide text-slate-500">Residence Address</div>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-semibold">
                    <div className="flex justify-between border-b border-slate-50 pb-2 col-span-2">
                      <span className="text-slate-400">Address Line 1:</span>
                      <span className="text-slate-800">{selectedStaffProfile.addressLine1 || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-2 col-span-2">
                      <span className="text-slate-400">Address Line 2 (Optional):</span>
                      <span className="text-slate-800">{selectedStaffProfile.addressLine2 || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-400">City:</span>
                      <span className="text-slate-800">{selectedStaffProfile.city || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-400">State / Province:</span>
                      <span className="text-slate-800">{selectedStaffProfile.state || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-400">Postal Code:</span>
                      <span className="text-slate-800 font-mono font-bold text-slate-700">{selectedStaffProfile.postalCode || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-50 pb-2">
                      <span className="text-slate-400">Country:</span>
                      <span className="text-slate-800">{selectedStaffProfile.country || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                {/* Section 3: Notes & Medical Office Comments */}
                <div className="p-4 bg-orange-50/30 border border-orange-100 rounded-xl">
                  <div className="text-[10px] text-orange-800 font-bold uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <FileText size={12} /> Administrative Comments / Notes
                  </div>
                  <p className="text-slate-700 font-medium text-xs leading-relaxed italic">
                    {selectedStaffProfile.notes || 'No operational administrative notes have been flagged for this clinical staff dossier.'}
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex justify-end">
                <button 
                  type="button" 
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-sm"
                  onClick={() => setSelectedStaffProfile(null)}
                >
                  Close Profile Audit
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* ADD / EDIT STAFF MODAL */}
        {isModalOpen && (
          <div className="overlay fixed inset-0 z-50 bg-[#0f172a]/55 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.15 }}
              className="modal-box w-full max-w-xl bg-white rounded-2xl border border-slate-100 shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-hdr px-6 py-4 bg-slate-50/50 border-b border-slate-100 flex items-start justify-between">
                <div>
                  <h3 className="text-base font-extrabold text-slate-800">
                    {userToEdit ? 'Edit Roster Personnel Profile' : 'Onboard New Hospital Staff'}
                  </h3>
                  <p className="text-xs text-slate-450 mt-0.5">
                    {userToEdit ? 'Update core medical or administrative record parameters.' : 'Create a database-driven clinical personnel record.'}
                  </p>
                </div>
                <button 
                  type="button"
                  className="cls-btn w-8 h-8 rounded-lg bg-white border border-slate-100 hover:bg-slate-100 flex items-center justify-center text-slate-400"
                  onClick={() => setIsModalOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>

              <form onSubmit={userToEdit ? handleEditSubmit : handleAddSubmit}>
                <div className="modal-bdy px-6 py-4 max-h-[60vh] overflow-y-auto space-y-4">
                  {/* Name Fields */}
                  <div className="form-grid-2 grid grid-cols-2 gap-4">
                    <div className="form-field flex flex-col">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">First Name</label>
                      <input 
                        type="text" 
                        required
                        placeholder="e.g. Julianne"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-semibold text-slate-700"
                      />
                    </div>
                    <div className="form-field flex flex-col">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Last Name / Prefix</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Smith"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-semibold text-slate-700"
                      />
                    </div>
                  </div>

                  {/* Profile ID, Designation, Phone */}
                  <div className="form-grid-3 grid grid-cols-3 gap-4">
                    <div className="form-field flex flex-col">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Employee ID</label>
                      <input 
                        type="text" 
                        placeholder="EMP-4829"
                        value={employeeId}
                        onChange={(e) => setEmployeeId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-semibold text-slate-700"
                      />
                    </div>
                    <div className="form-field flex flex-col">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Designation (Speciality)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Head Nurse, Consultant"
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-semibold text-slate-700"
                      />
                    </div>
                    <div className="form-field flex flex-col">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Phone Number</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 555-0199"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-semibold text-slate-700"
                      />
                    </div>
                  </div>

                  {/* Role, Dynamic Department, Shift, Employment Status */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="form-field flex flex-col">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Staff System Action Role</label>
                      <select 
                        value={role}
                        onChange={(e) => setRole(e.target.value as any)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-750"
                      >
                        <option value="DOCTOR">Physician / Doctor</option>
                        <option value="PHARMACY">Pharmacist / Drug Dispensary</option>
                        <option value="RECEPTION">Reception Operations / front-desk</option>
                        <option value="ADMIN">Hospital Administration</option>
                        <option value="STAFF">Support / Nursing Staff (Non-login)</option>
                      </select>
                    </div>

                    <div className="form-field flex flex-col">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Assign Dynamic Department</label>
                      <select 
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-750"
                      >
                        {departments.map((dept: any) => (
                          <option key={dept.id} value={dept.name}>{dept.name}</option>
                        ))}
                        <option value="_CUSTOM_">✏️ Enter Custom Department manually...</option>
                      </select>
                      {department === '_CUSTOM_' && (
                        <input 
                          type="text"
                          placeholder="Type custom department name..."
                          value={customDeptName}
                          onChange={(e) => setCustomDeptName(e.target.value)}
                          className="mt-2 w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-blue-50/30 focus:ring-2 focus:ring-blue-600/15 focus:border-blue-500 outline-none font-semibold text-slate-750 transition-all"
                        />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="form-field flex flex-col">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Duty Shift</label>
                      <select 
                        value={shiftType}
                        onChange={(e) => setShiftType(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-750"
                      >
                        <option value="MORNING">Morning Shift</option>
                        <option value="EVENING">Evening Shift</option>
                        <option value="NIGHT">Night Shift</option>
                        <option value="ON_CALL">On-Call duty</option>
                      </select>
                    </div>

                    <div className="form-field flex flex-col">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Employment Status</label>
                      <select
                        value={employmentStatus}
                        onChange={(e) => setEmploymentStatus(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-750"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                        <option value="TEMPORARY">TEMPORARY</option>
                        <option value="PROBATION">PROBATION</option>
                        <option value="ON_LEAVE">ON LEAVE</option>
                      </select>
                    </div>

                    <div className="form-field flex flex-col">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Date Joined</label>
                      <input 
                        type="date" 
                        value={dateJoined}
                        onChange={(e) => setDateJoined(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-700"
                      />
                    </div>
                  </div>

                  {/* Administrative Notes */}
                  <div className="form-field flex flex-col">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Internal Notes / Comments</label>
                    <textarea 
                      placeholder="Enter qualifications, certifications, special desk rules..."
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-semibold text-slate-700 resize-none"
                    />
                  </div>

                  {/* Address Information Section */}
                  <div className="border border-slate-150 p-4 rounded-xl space-y-4 bg-slate-50/50">
                    <div className="text-xs font-extrabold text-slate-805 uppercase tracking-wide">Staff Residence Address</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="form-field flex flex-col col-span-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Address Line 1</label>
                        <input 
                          type="text" 
                          placeholder="Apartment, suite, unit, building, floor, street, etc."
                          value={addressLine1}
                          onChange={(e) => setAddressLine1(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-700"
                        />
                      </div>
                      <div className="form-field flex flex-col col-span-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Address Line 2 (Optional)</label>
                        <input 
                          type="text" 
                          placeholder="Landmark, locality, sub-locality"
                          value={addressLine2}
                          onChange={(e) => setAddressLine2(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-700"
                        />
                      </div>
                      <div className="form-field flex flex-col">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">City</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Mumbai"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-700"
                        />
                      </div>
                      <div className="form-field flex flex-col">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">State / Province</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Maharashtra"
                          value={state}
                          onChange={(e) => setState(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-700"
                        />
                      </div>
                      <div className="form-field flex flex-col">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Postal Code</label>
                        <input 
                          type="text" 
                          placeholder="e.g. 400001"
                          value={postalCode}
                          onChange={(e) => setPostalCode(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-700"
                        />
                      </div>
                      <div className="form-field flex flex-col">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Country</label>
                        <input 
                          type="text" 
                          placeholder="e.g. India"
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-bold text-slate-700"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Toggle System Login Credentials Option */}
                  {role === 'DOCTOR' && (
                    <div className="border border-slate-150 p-4 rounded-xl space-y-4 bg-slate-50/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-extrabold text-slate-800">Assign System Login Credentials</div>
                          <div className="text-[10px] text-slate-400 mt-1">If enabled, username emails and login passkey codes will be synchronized in PostgreSQL.</div>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={isLoginEnabled}
                          onChange={(e) => setIsLoginEnabled(e.target.checked)}
                          className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                        />
                      </div>

                      {isLoginEnabled && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="space-y-3.5 pt-2 border-t border-slate-100"
                        >
                          <div className="form-field flex flex-col">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.2 font-semibold">Login Email Address</label>
                            <input 
                              type="email" 
                              placeholder="name@vitalis.edu"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-mono font-bold text-indigo-700"
                            />
                          </div>

                          <div className="form-field flex flex-col">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.2 font-semibold font-mono">Personal reference PIN</label>
                            <input 
                              type="text" 
                              placeholder="e.g. 748293"
                              value={pin}
                              onChange={(e) => setPin(e.target.value)}
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-mono font-bold text-emerald-700"
                            />
                          </div>

                          <div className="form-field flex flex-col">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.2 font-semibold font-mono">System Login Password</label>
                            <input 
                              type="text" 
                              placeholder="MedFlowPass123"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-600/10 focus:border-blue-600 outline-none font-mono font-bold text-blue-805"
                            />
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}
                </div>

                <div className="modal-ftr bg-slate-50 px-6 py-3.5 border-t border-slate-100 flex justify-end gap-2.5">
                  <button 
                    type="button"
                    className="px-4 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg font-bold text-xs hover:bg-slate-50" 
                    onClick={() => setIsModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-lg shadow-sm"
                  >
                    {userToEdit ? 'Save Changes' : 'Onboard Employee'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* ACCESS CREDENTIALS SUMMARY POPUP */}
        {showCredentials && (
          <div className="overlay fixed inset-0 z-[60] bg-[#0f172a]/50 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="modal-box w-full max-w-sm bg-white p-6 rounded-2xl shadow-2xl text-center space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <ShieldCheck size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Access Protocol Initialized</h3>
              <p className="text-xs text-slate-400">Credentials have been generated for onboarding.</p>
              
              <div className="p-3 bg-slate-50 rounded-lg text-left border border-slate-200">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Email Username:</div>
                <div className="font-mono text-xs font-semibold text-slate-800 break-all select-all">{showCredentials.email}</div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mt-2">PIN Keyphrase Code:</div>
                <div className="font-mono text-sm font-bold text-blue-900 break-all select-all">{showCredentials.pass}</div>
              </div>

              <button 
                type="button"
                onClick={() => setShowCredentials(null)}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs shadow-sm"
              >
                Onboarding Protocol Completed
              </button>
            </motion.div>
          </div>
        )}

        {/* WARNING DELETE MODAL */}
        {userToDelete && (
          <div className="overlay fixed inset-0 z-50 bg-[#0f172a]/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setUserToDelete(null)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="modal-box w-full max-w-md bg-white rounded-2xl border border-red-100 shadow-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                  <ShieldAlert size={28} />
                </div>
                <h3 className="text-lg font-bold text-slate-800">Revoke Access Warning</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  You are about to permanently remove active access configurations and delete the personnel record for <strong>{userToDelete.name}</strong> ({userToDelete.role}).
                </p>

                <div className="bg-red-50 text-red-750 p-3 rounded-lg text-left text-[11px] w-full border border-red-100 font-medium">
                  <ul className="list-disc list-inside space-y-1">
                    <li>Instantly terminates MedFlow login authentication.</li>
                    <li>Saves credentials logs into administrative audit logs.</li>
                  </ul>
                </div>

                <div className="grid grid-cols-2 gap-3 w-full pt-2">
                  <button 
                    type="button" 
                    className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg font-bold text-xs hover:bg-slate-200"
                    onClick={() => setUserToDelete(null)}
                  >
                    Cancel
                  </button>
                  <button 
                    type="button" 
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg shadow-sm"
                    onClick={handleDeleteUser}
                  >
                    Confirm Revocation
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* SECURE DISCLOSURE: TEMPORARY CREDENTIALS POPUP */}
        {generatedTempPass && (
          <div className="overlay fixed inset-0 z-50 bg-[#0f172a]/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setGeneratedTempPass(null); setTempPassEmployeeName(''); }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="modal-box w-full max-w-sm bg-white rounded-2xl border border-blue-100 shadow-2xl p-6 text-center space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                <ShieldAlert size={28} />
              </div>
              <div>
                <h4 className="font-extrabold text-slate-800 text-sm">Temporary Access Passkey Generated</h4>
                <p className="text-xs text-slate-500 mt-1">Please provide this passkey to user: <strong className="text-slate-800">{tempPassEmployeeName}</strong></p>
              </div>

              <div className="bg-indigo-950 p-4 rounded-xl border border-indigo-900 select-all font-mono font-bold text-lg text-emerald-400 tracking-widest break-all shadow-inner">
                {generatedTempPass}
              </div>

              <div className="text-[10px] text-amber-600 font-bold bg-amber-50 border border-amber-105 p-3 rounded-lg text-left leading-normal">
                ⚠️ SECURITY POLICY WARNING: This temporary credential PIN code is showcased ONLY once and was immediately processed in an encrypted format using bcrypt. It is invalid after the first verification and the doctor WILL be forced onto the Change Password Screen immediately upon sign-in.
              </div>

              <button 
                type="button"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs shadow-sm"
                onClick={() => { setGeneratedTempPass(null); setTempPassEmployeeName(''); }}
              >
                Understood & Copied
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
