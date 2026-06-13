export type UserRole = 'ADMIN' | 'RECEPTION' | 'DOCTOR' | 'PHARMACY';

export interface User {
  id: string;
  name: string;
  email: string | null;
  role: UserRole;
  password?: string | null;
  pin?: string | null;
  requiresPasswordChange?: boolean;
  department?: string;
  isActive?: boolean;
  dutyStatus?: string;
  lastActivatedAt?: string;
  shiftType?: string;
  accessToken?: string;
  refreshToken?: string;
  employeeId?: string;
  designation?: string;
  phone?: string;
  dateJoined?: string;
  employmentStatus?: string;
  notes?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Patient {
  id: string;
  name: string;
  age: number;
  dateOfBirth?: string;
  gender: 'M' | 'F' | 'O';
  phone: string;
  email?: string;
  address: string;
  bloodGroup: string;
  medicalHistory: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  bloodPressure?: string;
  weight?: string;
  temperature?: string;
  createdAt: string;
}

export type AppointmentStatus = 'SCHEDULED' | 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  date: string;
  time: string;
  status: AppointmentStatus;
}

export type TokenStatus = 'WAITING' | 'IN_CONSULTATION' | 'CONSULTATION_COMPLETED' | 'SENT_TO_PHARMACY' | 'DISPENSED' | 'CANCELLED' | 'CONSULTATION_COMPLETED_NO_PRESCRIPTION';

export interface Token {
  id: string;
  tokenNumber: string;
  patientId: string;
  doctorId: string;
  appointmentId: string;
  status: TokenStatus;
  createdAt: string;
  patient?: Patient;
  priority?: string;
}

export interface PrescriptionItem {
  medicine: string;
  dosage: string;
  frequency: string;
  duration: string;
  notes?: string;
}

export interface Prescription {
  id: string;
  tokenId?: string;
  tokenNumber: string;
  patientId: string;
  doctorId: string;
  items: PrescriptionItem[];
  notes?: string;
  status: 'PENDING' | 'DISPENSED';
  createdAt: string;
  doctor?: { name: string; department: string };
  patient?: Patient;
  queueId?: string;
}

export interface BillItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Bill {
  id: string;
  patientId: string;
  patient?: Patient;
  tokenNumber: string;
  subtotal: number;
  tax: number;
  total: number;
  status: 'UNPAID' | 'PAID' | 'CANCELLED';
  createdAt: string;
  items: BillItem[];
  dispensingLog?: any;
}

export interface Consultation {
  id: string;
  tokenId: string;
  tokenNumber: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  department: string;
  notes: string;
  diagnosis?: string;
  followUp?: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  action: string;
  user: string;
  timestamp: string;
  details?: string;
}
