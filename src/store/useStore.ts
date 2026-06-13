import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  User, Patient, Appointment, Token, Prescription, 
  Consultation, ActivityLog, UserRole, PrescriptionItem 
} from '../types';

interface HospitalState {
  // Auth
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  
  // Data lists (Database Simulation)
  users: User[];
  departments: any[];
  patients: Patient[];
  appointments: Appointment[];
  tokens: Token[];
  prescriptions: Prescription[];
  pharmacyHistory: any[];
  bills: any[];
  consultations: Consultation[];
  activityLogs: ActivityLog[];
  drafts: Record<string, { notes: string; diagnosis: string; followUp: string; medicines: PrescriptionItem[] }>;

  // Inventory State
  inventoryItems: any[];
  suppliers: any[];
  reorders: any[];
  transactions: any[];

  // Inventory Actions
  fetchInventoryItems: () => Promise<void>;
  fetchSuppliers: () => Promise<void>;
  fetchReorders: () => Promise<void>;
  fetchTransactions: () => Promise<void>;
  addInventoryItem: (item: any) => Promise<void>;
  addStockBatch: (data: { parentItemId: string, batchNumber: string, stockQuantity: number, expiryDate: string | null, supplierId: string | null }) => Promise<void>;
  updateInventoryItem: (id: string, data: any) => Promise<void>;
  deleteInventoryItem: (id: string) => Promise<void>;
  addSupplier: (supplier: any) => Promise<void>;
  createReorderRequest: (reorder: any) => Promise<void>;
  updateReorderStatus: (id: string, status: string) => Promise<void>;
  bulkImportInventory: (items: any[]) => Promise<any>;
  
  // Actions
  fetchUsers: () => Promise<void>;
  addUser: (user: Partial<User>) => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  fetchDepartments: () => Promise<void>;
  addDepartment: (name: string) => Promise<any>;
  
  fetchPatients: (search?: string) => Promise<void>;
  addPatient: (patient: Partial<Patient>) => Promise<any>;
  updatePatient: (id: string, patient: Partial<Patient>) => Promise<void>;
  
  fetchTokens: (params?: { doctorId?: string; status?: string }) => Promise<void>;
  addAppointment: (data: any) => Promise<any>;
  updateTokenStatus: (id: string, status: string) => Promise<void>;
  updateTokenPriority: (id: string, priority: string) => Promise<void>;
  
  completeConsultation: (data: any) => Promise<void>;
  fetchPatientHistory: (patientId: string) => Promise<any[]>;
  
  fetchPharmacyQueue: () => Promise<void>;
  fetchPharmacyHistory: () => Promise<void>;
  dispensePrescription: (queueId: string, items: any[]) => Promise<void>;
  updateQueueStatus: (queueId: string, status: string) => Promise<void>;
  
  fetchBills: (startDate?: string, endDate?: string) => Promise<void>;
  updateBillStatus: (billId: string, status: string) => Promise<void>;

  addActivityLog: (log: any) => void | Promise<void>;
  fetchActivityLogs: () => Promise<void>;
  saveDraft: (tokenId: string, data: any) => void;
  updateDutyStatus: (dutyStatus: string, shiftType?: string) => Promise<void>;
  fetchMe: () => Promise<void>;
  
  // Auth
  login: (credentials: any) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  
  resetData: () => void;
}

let isRefreshing: Promise<string | null> | null = null;

const refreshAccessToken = async (): Promise<string | null> => {
  const state = useStore.getState();
  const refreshToken = state.currentUser?.refreshToken;
  if (!refreshToken) return null;

  try {
    const refreshRes = await fetch('/api/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refreshToken }),
      credentials: 'include'
    });

    if (refreshRes.ok) {
      const refreshData = await refreshRes.json();
      const updatedUser = {
        ...state.currentUser,
        ...refreshData.user,
        accessToken: refreshData.accessToken
      };
      useStore.setState({ currentUser: updatedUser });
      return refreshData.accessToken;
    }
  } catch (refreshErr) {
    console.error('Failed to auto-refresh token:', refreshErr);
  }
  return null;
};

export const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const state = useStore.getState();
  const token = state.currentUser?.accessToken;

  const headers: Record<string, string> = {
    'X-Timezone-Offset': String(new Date().getTimezoneOffset()),
    ...options.headers as Record<string, string>,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchOptions: RequestInit = {
    ...options,
    headers,
    credentials: 'include'
  };

  let res: Response;
  try {
    res = await fetch(url, fetchOptions);
  } catch (err) {
    console.warn('Network fetch error for:', url, err);
    return new Response(JSON.stringify({ error: 'Clinical API is currently unreachable. Please check connection and retry.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (res.status === 401 && state.currentUser) {
    if (!isRefreshing) {
      isRefreshing = refreshAccessToken().finally(() => {
        isRefreshing = null;
      });
    }

    const newAccessToken = await isRefreshing;

    if (newAccessToken) {
      const retryHeaders = {
        ...options.headers as Record<string, string>,
        'Authorization': `Bearer ${newAccessToken}`
      };
      try {
        return await fetch(url, {
          ...fetchOptions,
          headers: retryHeaders
        });
      } catch (retryErr) {
        console.warn('Network fetch retry error for:', url, retryErr);
        return new Response(JSON.stringify({ error: 'Clinical API is unreachable on session retry.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      useStore.setState({ currentUser: null });
    }
  }

  return res;
};

export const useStore = create<HospitalState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),
      
      users: [],
      departments: [],
      patients: [],
      appointments: [],
      tokens: [],
      prescriptions: [],
      pharmacyHistory: [],
      bills: [],
      consultations: [],
      activityLogs: [],
      drafts: {},
      
      inventoryItems: [],
      suppliers: [],
      reorders: [],
      transactions: [],
      
      login: async (credentials) => {
        try {
          const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials),
            credentials: 'include'
          });
          if (res.ok) {
            const user = await res.json();
            set({ currentUser: user });
            return { success: true };
          }
          const errData = await res.json().catch(() => ({}));
          return { success: false, error: errData.error || 'Invalid credentials' };
        } catch (error) {
          return { success: false, error: 'Network communication error. Server is unreachable.' };
        }
      },
      
      logout: async () => {
        try {
          await fetch('/api/logout', { 
            method: 'POST',
            credentials: 'include'
          });
        } catch (e) {
          console.error(e);
        }
        set({ currentUser: null });
      },
      
      fetchUsers: async () => {
        const res = await authFetch('/api/users');
        if (res.ok) set({ users: await res.json() });
      },
      
      fetchDepartments: async () => {
        const res = await authFetch('/api/departments');
        if (res.ok) {
          const data = await res.json();
          set({ departments: data });
        }
      },
      
      addDepartment: async (name: string) => {
        const res = await authFetch('/api/departments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        if (res.ok) {
          const newDept = await res.json();
          await get().fetchDepartments();
          return newDept;
        } else {
          const err = await res.json().catch(() => ({ error: 'Failed to create department' }));
          throw new Error(err.error || 'Failed to create department');
        }
      },
      
      addUser: async (user) => {
        const res = await authFetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user)
        });
        if (res.ok) {
          get().fetchUsers();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to create user account');
        }
      },
      
      updateUser: async (user) => {
        const res = await authFetch(`/api/users/${user.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user)
        });
        if (res.ok) get().fetchUsers();
      },
      
      deleteUser: async (id) => {
        const res = await authFetch(`/api/users/${id}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          get().fetchUsers();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to delete user');
        }
      },

      updateDutyStatus: async (dutyStatus, shiftType) => {
        const state = get();
        const currentUserId = state.currentUser?.id;
        if (!currentUserId) return;

        const res = await authFetch(`/api/users/${currentUserId}/duty`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dutyStatus, shiftType })
        });

        if (res.ok) {
          const updatedUser = await res.json();
          set({
            currentUser: {
              ...state.currentUser,
              ...updatedUser
            } as any
          });
          await get().fetchUsers();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update duty status');
        }
      },

      fetchMe: async () => {
        const state = get();
        if (!state.currentUser) return;
        try {
          const res = await authFetch('/api/me');
          if (res.ok) {
            const updatedUser = await res.json();
            set({
              currentUser: {
                ...state.currentUser,
                ...updatedUser
              } as any
            });
          }
        } catch (e) {
          console.error("Failed to fetch user profile", e);
        }
      },
      
      fetchPatients: async (search) => {
        const url = search ? `/api/patients?search=${encodeURIComponent(search)}` : '/api/patients';
        const res = await authFetch(url);
        if (res.ok) set({ patients: await res.json() });
      },
      
      addPatient: async (patient) => {
        const res = await authFetch('/api/patients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patient)
        });
        if (res.ok) {
          const created = await res.json();
          get().fetchPatients();
          return created;
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to register patient');
        }
      },
      
      updatePatient: async (id, patient) => {
        const res = await authFetch(`/api/patients/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patient)
        });
        if (res.ok) {
          get().fetchPatients();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update patient profile');
        }
      },
      
      fetchTokens: async (params) => {
        let url = '/api/tokens?';
        if (params?.doctorId) url += `doctorId=${params.doctorId}&`;
        if (params?.status) {
          const statusStr = Array.isArray(params.status) ? params.status.join(',') : params.status;
          url += `status=${statusStr}&`;
        }
        const res = await authFetch(url);
        if (res.ok) {
          const freshTokens = await res.json();
          set({ tokens: freshTokens });
        }
      },
      
      addAppointment: async (data) => {
        const res = await authFetch('/api/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (res.ok) {
          const result = await res.json();
          get().fetchTokens();
          return result;
        }
        const err = await res.json();
        throw new Error(err.error || 'Failed to create appointment');
      },
      
      updateTokenStatus: async (id, status) => {
        const res = await authFetch(`/api/tokens/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        if (res.ok) {
          const params = get().currentUser?.role === 'DOCTOR' 
            ? { doctorId: get().currentUser?.id, status: 'WAITING,IN_CONSULTATION,CONSULTATION_COMPLETED,SENT_TO_PHARMACY,DISPENSED' }
            : {};
          get().fetchTokens(params);
        }
      },
      
      updateTokenPriority: async (id, priority) => {
        const res = await authFetch(`/api/tokens/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priority })
        });
        if (res.ok) {
          get().fetchTokens();
        }
      },
      
      completeConsultation: async (data) => {
        const res = await authFetch('/api/consultations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (res.ok) {
          const params = get().currentUser?.role === 'DOCTOR' 
            ? { doctorId: get().currentUser?.id, status: 'WAITING,IN_CONSULTATION,CONSULTATION_COMPLETED,SENT_TO_PHARMACY,DISPENSED' }
            : {};
          get().fetchTokens(params);
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to complete consultation');
        }
      },
      
      fetchPatientHistory: async (patientId) => {
        const res = await authFetch(`/api/patients/${patientId}/history`);
        if (res.ok) return await res.json();
        return [];
      },
      
      fetchPharmacyQueue: async () => {
        const res = await authFetch('/api/pharmacy/queue');
        if (res.ok) {
          const queue = await res.json();
          set({ prescriptions: queue.map((q: any) => ({
            ...q.prescription,
            queueId: q.id,
            status: q.status,
            prescriptionCreatedAt: q.prescription.createdAt, // Doctor prescription timestamp
            queueCreatedAt: q.createdAt, // Pharmacy queue assignment timestamp
            tokenNumber: q.prescription.consultation?.visitRecord?.token?.tokenNumber
          })) });
        }
      },
      
      fetchPharmacyHistory: async () => {
        const res = await authFetch('/api/pharmacy/history');
        if (res.ok) set({ pharmacyHistory: await res.json() });
      },
      
      dispensePrescription: async (queueId, items) => {
        const res = await authFetch('/api/pharmacy/dispense', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            queueId, 
            pharmacistId: get().currentUser?.id,
            items
          })
        });
        
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to dispense');
        }
        
        get().fetchPharmacyQueue();
        get().fetchPharmacyHistory();
        get().fetchBills();
        get().fetchInventoryItems();
        get().fetchTransactions();
      },

      updateQueueStatus: async (queueId, status) => {
        const res = await authFetch(`/api/pharmacy/queue/${queueId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        if (res.ok) {
          get().fetchPharmacyQueue();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update queue status');
        }
      },
      
      fetchBills: async (startDate?: string, endDate?: string) => {
        let url = '/api/bills';
        const params: string[] = [];
        if (startDate) params.push(`startDate=${encodeURIComponent(startDate)}`);
        if (endDate) params.push(`endDate=${encodeURIComponent(endDate)}`);
        if (params.length > 0) {
          url += `?${params.join('&')}`;
        }
        const res = await authFetch(url);
        if (res.ok) set({ bills: await res.json() });
      },
      
      updateBillStatus: async (billId, status) => {
        const res = await authFetch(`/api/bills/${billId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        if (res.ok) {
          await get().fetchBills();
          await get().fetchInventoryItems();
          await get().fetchTransactions();
          await get().fetchReorders();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update bill status');
        }
      },
      
      fetchInventoryItems: async () => {
        const res = await authFetch('/api/inventory');
        if (res.ok) set({ inventoryItems: await res.json() });
      },
      
      fetchSuppliers: async () => {
        const res = await authFetch('/api/suppliers');
        if (res.ok) set({ suppliers: await res.json() });
      },
      
      fetchReorders: async () => {
        const res = await authFetch('/api/inventory/reorders');
        if (res.ok) set({ reorders: await res.json() });
      },
      
      fetchTransactions: async () => {
        const res = await authFetch('/api/inventory/transactions');
        if (res.ok) set({ transactions: await res.json() });
      },
      
      addInventoryItem: async (item) => {
        const res = await authFetch('/api/inventory', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-name': get().currentUser?.name || 'System'
          },
          body: JSON.stringify(item)
        });
        if (res.ok) {
          get().fetchInventoryItems();
          get().fetchTransactions();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to add item');
        }
      },
      
      addStockBatch: async (data) => {
        const res = await authFetch('/api/inventory/add-stock', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-name': get().currentUser?.name || 'System'
          },
          body: JSON.stringify(data)
        });
        if (res.ok) {
          get().fetchInventoryItems();
          get().fetchTransactions();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to add stock batch');
        }
      },
      
      updateInventoryItem: async (id, data) => {
        const res = await authFetch(`/api/inventory/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-user-name': get().currentUser?.name || 'System'
          },
          body: JSON.stringify(data)
        });
        if (res.ok) {
          get().fetchInventoryItems();
          get().fetchTransactions();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update item');
        }
      },
      
      deleteInventoryItem: async (id) => {
        const res = await authFetch(`/api/inventory/${id}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          get().fetchInventoryItems();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to delete item');
        }
      },
      
      addSupplier: async (supplier) => {
        const res = await authFetch('/api/suppliers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(supplier)
        });
        if (res.ok) {
          get().fetchSuppliers();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to add supplier');
        }
      },
      
      createReorderRequest: async (reorder) => {
        const res = await authFetch('/api/inventory/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...reorder,
            requestedBy: get().currentUser?.name || 'System Admin'
          })
        });
        if (res.ok) {
          get().fetchReorders();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to create reorder request');
        }
      },
      
      updateReorderStatus: async (id, status) => {
        const res = await authFetch(`/api/inventory/reorders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        if (res.ok) {
          get().fetchReorders();
          get().fetchInventoryItems();
          get().fetchTransactions();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update status');
        }
      },
      
      bulkImportInventory: async (items) => {
        const res = await authFetch('/api/inventory/bulk-import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-name': get().currentUser?.name || 'System Bulk File'
          },
          body: JSON.stringify({ items })
        });
        if (res.ok) {
          get().fetchInventoryItems();
          get().fetchTransactions();
          return await res.json();
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to bulk import');
        }
      },
      
      fetchActivityLogs: async () => {
        try {
          const res = await authFetch('/api/activity-logs');
          if (res.ok) {
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              const data = await res.json();
              if (Array.isArray(data)) {
                set({ activityLogs: data });
              }
            } else {
              console.warn('Expected JSON response for activity logs, but received:', contentType);
            }
          }
        } catch (e: any) {
          console.warn('Silent fallback: failed to get activity logs:', e?.message || e);
        }
      },
      
      addActivityLog: async (log) => {
        set((state) => ({
          activityLogs: [log, ...state.activityLogs].slice(0, 50)
        }));
        try {
          await authFetch('/api/activity-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: log.action,
              user: log.user,
              details: log.details || '',
              userId: log.userId
            })
          });
        } catch (e) {
          console.error('Failed to create activity log in background:', e);
        }
      },
      
      saveDraft: (tokenId, data) => set((state) => ({
        drafts: { ...state.drafts, [tokenId]: data }
      })),
      
      resetData: () => set({
        patients: [],
        appointments: [],
        tokens: [],
        prescriptions: [],
        consultations: [],
        activityLogs: []
      }),
    }),
    {
      name: 'hospital-storage',
    }
  )
);

export const useAuth = () => useStore((state) => ({ user: state.currentUser, login: state.login, logout: state.logout }));
