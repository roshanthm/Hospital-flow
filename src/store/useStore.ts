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
  billsPaginated: any[];
  billsTotalCount: number;
  pharmacyDashboardSummary: { revenueVal: number, totalDispToday: number, pendingClearVal: number } | null;
  consultations: Consultation[];
  activityLogs: ActivityLog[];
  drafts: Record<string, { notes: string; diagnosis: string; followUp: string; medicines: PrescriptionItem[] }>;

  // Inventory State
  inventoryItems: any[];
  suppliers: any[];
  reorders: any[];
  transactions: any[];
  lastFetched: Record<string, number>;

  // Inventory Actions
  fetchInventoryItems: (force?: boolean) => Promise<void>;
  fetchSuppliers: (force?: boolean) => Promise<void>;
  fetchReorders: (force?: boolean) => Promise<void>;
  fetchTransactions: (force?: boolean) => Promise<void>;
  addInventoryItem: (item: any) => Promise<void>;
  addStockBatch: (data: { parentItemId: string, batchNumber: string, stockQuantity: number, expiryDate: string | null, supplierId: string | null }) => Promise<void>;
  updateInventoryItem: (id: string, data: any) => Promise<void>;
  deleteInventoryItem: (id: string) => Promise<void>;
  addSupplier: (supplier: any) => Promise<void>;
  createReorderRequest: (reorder: any) => Promise<void>;
  updateReorderStatus: (id: string, status: string) => Promise<void>;
  bulkImportInventory: (items: any[]) => Promise<any>;
  
  // Actions
  fetchUsers: (force?: boolean) => Promise<void>;
  addUser: (user: Partial<User>) => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  fetchDepartments: (force?: boolean) => Promise<void>;
  addDepartment: (name: string) => Promise<any>;
  
  fetchPatients: (search?: string, force?: boolean) => Promise<void>;
  addPatient: (patient: Partial<Patient>) => Promise<any>;
  updatePatient: (id: string, patient: Partial<Patient>) => Promise<void>;
  
  fetchTokens: (params?: { doctorId?: string; status?: string; patientId?: string; today?: boolean; active?: boolean }, force?: boolean) => Promise<void>;
  addAppointment: (data: any) => Promise<any>;
  updateTokenStatus: (id: string, status: string) => Promise<void>;
  updateTokenPriority: (id: string, priority: string) => Promise<void>;
  
  completeConsultation: (data: any) => Promise<void>;
  fetchPatientHistory: (patientId: string) => Promise<any[]>;
  
  fetchPharmacyQueue: (force?: boolean) => Promise<void>;
  fetchPharmacyHistory: (force?: boolean) => Promise<void>;
  dispensePrescription: (queueId: string, items: any[]) => Promise<void>;
  updateQueueStatus: (queueId: string, status: string) => Promise<void>;
  
  fetchBills: (startDate?: string, endDate?: string, force?: boolean, page?: number, limit?: number, status?: string, search?: string) => Promise<void>;
  fetchPharmacyDashboardSummary: (startDate?: string, endDate?: string, status?: string, search?: string) => Promise<void>;
  updateBillStatus: (billId: string, status: string) => Promise<void>;

  addActivityLog: (log: any) => void | Promise<void>;
  fetchActivityLogs: (force?: boolean) => Promise<void>;
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
    } else {
      if (refreshRes.status === 401 || refreshRes.status === 403) {
        console.warn('Session refresh token has expired or is invalid. Purging local state.');
        useStore.setState({ currentUser: null });
      }
    }
  } catch (refreshErr) {
    console.error('Failed to auto-refresh token due to network/server state:', refreshErr);
  }
  return null;
};

// Memory cache for client GET requests to enable instant navigation and deduplication
interface ClientCacheEntry {
  timestamp: number;
  dataText: string;
  contentType: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  version: number;
  category: string;
}

const clientCache = new Map<string, ClientCacheEntry>();
const pendingRequests = new Map<string, Promise<Response>>();

export let localCacheVersions: Record<string, number> = {
  system: 1,
  users: 1,
  revenue: 1,
  attendance: 1,
  inventory: 1,
  patients: 1,
  tokens: 1,
};

export const getRouteVersionCategory = (url: string): string => {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('/api/admin/operational-summary')) return 'system';
  if (urlLower.includes('/api/admin/revenue-summary')) return 'revenue';
  if (urlLower.includes('/api/admin/doctor-attendance')) return 'attendance';
  if (urlLower.includes('/api/departments')) return 'system';
  if (urlLower.includes('/api/users')) return 'users';
  if (urlLower.includes('/api/bills')) return 'revenue';
  if (urlLower.includes('/api/patients')) return 'patients';
  if (urlLower.includes('/api/tokens')) return 'tokens';
  if (urlLower.includes('/api/inventory')) return 'inventory';
  return 'system';
};

const syncChannel = typeof window !== 'undefined' ? new BroadcastChannel('medflow-sync-channel') : null;

export const getCacheKey = (url: string): string => {
  const currentUser = useStore.getState().currentUser;
  if (!currentUser) return url;
  return `${currentUser.id}:${currentUser.role}:${url}`;
};

export const clearClientCache = () => {
  clientCache.clear();
  pendingRequests.clear();
  localCacheVersions = {
    system: 1,
    users: 1,
    revenue: 1,
    attendance: 1,
    inventory: 1,
    patients: 1,
    tokens: 1,
  };
};

export const invalidateClientCache = (keys: string[], localOnly = false) => {
  for (const cacheKey of clientCache.keys()) {
    const parts = cacheKey.split(':');
    const urlPart = parts.slice(2).join(':') || cacheKey;
    for (const key of keys) {
      if (urlPart.includes(key)) {
        clientCache.delete(cacheKey);
      }
    }
  }
  if (!localOnly && syncChannel) {
    syncChannel.postMessage({ type: 'INVALIDATE', keys });
  }
};

if (syncChannel) {
  syncChannel.onmessage = (event) => {
    if (event.data && event.data.type === 'INVALIDATE') {
      invalidateClientCache(event.data.keys, true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('medflow:cache-invalidated', { detail: { keys: event.data.keys } }));
      }
    } else if (event.data && event.data.type === 'VERSION_UPDATE') {
      localCacheVersions = { ...localCacheVersions, ...event.data.versions };
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('medflow:versions-updated', { detail: { versions: event.data.versions } }));
      }
    }
  };
}

// Establish Server-Sent Events (SSE) connection for real-time synchronization across users
if (typeof window !== 'undefined') {
  const connectSSE = () => {
    const eventSource = new EventSource('/api/sync/events');
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'mutation') {
          const category = data.category;
          const keysToInvalidate: string[] = [];
          
          if (category === 'patient') {
            keysToInvalidate.push('/api/patients', '/api/admin/operational-summary');
          } else if (category === 'token') {
            keysToInvalidate.push('/api/tokens', '/api/admin/operational-summary', '/api/admin/doctor-attendance', '/api/patients/history');
          } else if (category === 'consultation') {
            keysToInvalidate.push('/api/tokens', '/api/admin/operational-summary', '/api/admin/doctor-attendance', '/api/patients/history', '/api/bills');
          } else if (category === 'bill') {
            keysToInvalidate.push('/api/bills', '/api/admin/revenue-summary', '/api/admin/operational-summary', '/api/pharmacy/dashboard-summary');
          } else if (category === 'dispense') {
            keysToInvalidate.push('/api/bills', '/api/admin/revenue-summary', '/api/admin/operational-summary', '/api/pharmacy/dashboard-summary', '/api/inventory');
          } else if (category === 'inventory') {
            keysToInvalidate.push('/api/inventory', '/api/pharmacy/dashboard-summary', '/api/admin/operational-summary');
          } else if (category === 'admin') {
            keysToInvalidate.push('/api/users', '/api/admin/operational-summary', '/api/admin/doctor-attendance', '/api/departments');
          } else {
            keysToInvalidate.push('/api/admin/operational-summary', '/api/admin/revenue-summary');
          }
          
          if (data.versions) {
            localCacheVersions = { ...localCacheVersions, ...data.versions };
            if (syncChannel) {
              syncChannel.postMessage({ type: 'VERSION_UPDATE', versions: data.versions });
            }
          }
          
          invalidateClientCache(keysToInvalidate, true);
          window.dispatchEvent(new CustomEvent('medflow:cache-invalidated', { detail: { keys: keysToInvalidate } }));
        }
      } catch (e) {
        console.error('Error handling SSE message:', e);
      }
    };
    
    eventSource.onerror = () => {
      eventSource.close();
      setTimeout(connectSSE, 5000);
    };
  };
  
  connectSSE();
  
  fetch('/api/sync/versions')
    .then(r => r.json())
    .then(versions => {
      localCacheVersions = { ...localCacheVersions, ...versions };
    })
    .catch(err => console.warn('Failed to fetch initial sync versions:', err));
}

export const getClientCachedJSON = (url: string, allowStale = true): any | null => {
  const cacheKey = getCacheKey(url);
  const cached = clientCache.get(cacheKey);
  if (cached) {
    if (allowStale) {
      try {
        return JSON.parse(cached.dataText);
      } catch (e) {
        return null;
      }
    }
    
    const category = getRouteVersionCategory(url);
    const currentVersion = localCacheVersions[category] || 1;
    if (cached.version !== currentVersion) {
      return null;
    }

    const cacheTTLs: Record<string, number> = {
      '/api/admin/operational-summary': 5 * 60 * 1000,
      '/api/admin/revenue-summary': 5 * 60 * 1000,
      '/api/admin/doctor-attendance': 5 * 60 * 1000,
      '/api/departments': 5 * 60 * 1000,
      '/api/users': 60 * 1000,
      '/api/bills': 60 * 1000,
    };
    let ttl = 0;
    for (const [route, t] of Object.entries(cacheTTLs)) {
      if (url.startsWith(route)) {
        ttl = t;
        break;
      }
    }
    if (ttl > 0 && Date.now() - cached.timestamp < ttl) {
      try {
        return JSON.parse(cached.dataText);
      } catch (e) {
        return null;
      }
    }
  }
  return null;
};

export const authFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const method = (options.method || 'GET').toUpperCase();

  const cacheTTLs: Record<string, number> = {
    '/api/admin/operational-summary': 5 * 60 * 1000,
    '/api/admin/revenue-summary': 5 * 60 * 1000,
    '/api/admin/doctor-attendance': 5 * 60 * 1000,
    '/api/departments': 5 * 60 * 1000,
    '/api/users': 60 * 1000,
    '/api/bills': 60 * 1000,
  };

  let cacheTTL = 0;
  if (method === 'GET') {
    for (const [route, ttl] of Object.entries(cacheTTLs)) {
      if (url.startsWith(route)) {
        cacheTTL = ttl;
        break;
      }
    }
  }

  if (cacheTTL > 0) {
    const cacheKey = getCacheKey(url);
    const cached = clientCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheTTL) {
      const category = getRouteVersionCategory(url);
      const currentVersion = localCacheVersions[category] || 1;
      if (cached.version === currentVersion) {
        return new Response(cached.dataText, {
          status: cached.status,
          statusText: cached.statusText,
          headers: new Headers(cached.headers),
        });
      }
    }
  }

  // Deduplicate concurrent in-flight requests for the exact same URL
  if (method === 'GET') {
    const pending = pendingRequests.get(url);
    if (pending) {
      const res = await pending;
      return res.clone();
    }
  }

  const executeFetch = async (): Promise<Response> => {
    let state = useStore.getState();

    // If a refresh is already in progress, wait for it first to use the new token immediately
    if (isRefreshing) {
      await isRefreshing;
      state = useStore.getState();
    }

    let token = state.currentUser?.accessToken;

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
      // Audit current token value - if already updated by an concurrent request, retry immediately
      const latestToken = useStore.getState().currentUser?.accessToken;
      if (latestToken && latestToken !== token) {
        const retryHeaders = {
          ...options.headers as Record<string, string>,
          'Authorization': `Bearer ${latestToken}`
        };
        try {
          return await fetch(url, {
            ...fetchOptions,
            headers: retryHeaders
          });
        } catch (retryErr) {
          console.warn('Network fetch retry error for refreshed token:', url, retryErr);
          return new Response(JSON.stringify({ error: 'Clinical API is unreachable on session retry.' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Trigger single unified token refresh
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
      }
    }

    return res;
  };

  if (method === 'GET') {
    const fetchPromise = executeFetch();
    pendingRequests.set(url, fetchPromise);

    try {
      const originalRes = await fetchPromise;
      pendingRequests.delete(url);

      if (originalRes.ok && cacheTTL > 0) {
        const clonedRes = originalRes.clone();
        const dataText = await clonedRes.text();
        const headersList: [string, string][] = [];
        originalRes.headers.forEach((val, key) => {
          headersList.push([key, val]);
        });

        const cacheKey = getCacheKey(url);
        const category = getRouteVersionCategory(url);
        const version = localCacheVersions[category] || 1;
        clientCache.set(cacheKey, {
          timestamp: Date.now(),
          dataText,
          contentType: originalRes.headers.get('content-type') || 'application/json',
          status: originalRes.status,
          statusText: originalRes.statusText,
          headers: headersList,
          version,
          category,
        });

        return new Response(dataText, {
          status: originalRes.status,
          statusText: originalRes.statusText,
          headers: originalRes.headers,
        });
      }

      return originalRes;
    } catch (e) {
      pendingRequests.delete(url);
      throw e;
    }
  } else {
    // Non-GET mutation request
    const res = await executeFetch();

    // Event-driven invalidation after a successful mutation
    if (res.ok) {
      const urlLower = url.toLowerCase();
      const keysToInvalidate: string[] = [];

      if (urlLower.includes('/api/patients')) {
        keysToInvalidate.push('/api/patients', '/api/admin/operational-summary');
      } else if (urlLower.includes('/api/tokens')) {
        keysToInvalidate.push('/api/tokens', '/api/admin/operational-summary', '/api/admin/doctor-attendance', '/api/patients/history');
      } else if (urlLower.includes('/api/consultations')) {
        keysToInvalidate.push('/api/tokens', '/api/admin/operational-summary', '/api/admin/doctor-attendance', '/api/patients/history', '/api/bills');
      } else if (urlLower.includes('/api/bills')) {
        keysToInvalidate.push('/api/bills', '/api/admin/revenue-summary', '/api/admin/operational-summary', '/api/pharmacy/dashboard-summary');
      } else if (urlLower.includes('/api/pharmacy/dispense')) {
        keysToInvalidate.push('/api/bills', '/api/admin/revenue-summary', '/api/admin/operational-summary', '/api/pharmacy/dashboard-summary', '/api/inventory');
      } else if (urlLower.includes('/api/inventory')) {
        keysToInvalidate.push('/api/inventory', '/api/pharmacy/dashboard-summary', '/api/admin/operational-summary');
      } else if (urlLower.includes('/api/users') || urlLower.includes('/api/departments') || urlLower.includes('/admin/reset') || urlLower.includes('password')) {
        keysToInvalidate.push('/api/users', '/api/admin/operational-summary', '/api/admin/doctor-attendance', '/api/departments');
      } else {
        // Safe default: invalidate operational & revenue summaries
        keysToInvalidate.push('/api/admin/operational-summary', '/api/admin/revenue-summary');
      }

      invalidateClientCache(keysToInvalidate);
    }

    return res;
  }
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
      billsPaginated: [],
      billsTotalCount: 0,
      pharmacyDashboardSummary: null,
      consultations: [],
      activityLogs: [],
      drafts: {},
      
      inventoryItems: [],
      suppliers: [],
      reorders: [],
      transactions: [],
      lastFetched: {},
      
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
        clearClientCache();
        set({ currentUser: null });
      },
      
      fetchUsers: async (force) => {
        const now = Date.now();
        const state = get();
        if (!force && now - (state.lastFetched['users'] || 0) < 600000) return;
        
        const runFetch = async () => {
          try {
            const res = await authFetch('/api/users');
            if (res.ok) {
              const data = await res.json();
              set({ 
                users: data,
                lastFetched: { ...get().lastFetched, 'users': now }
              });
            }
          } catch (e) {
            console.error("Silent users fetch failed:", e);
          }
        };

        if (state.users && state.users.length > 0 && !force) {
          runFetch();
        } else {
          await runFetch();
        }
      },
      
      fetchDepartments: async (force) => {
        const now = Date.now();
        const state = get();
        if (!force && now - (state.lastFetched['departments'] || 0) < 60000) return;
        
        const res = await authFetch('/api/departments');
        if (res.ok) {
          const data = await res.json();
          set({ 
            departments: data,
            lastFetched: { ...state.lastFetched, 'departments': now }
          });
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
          get().fetchUsers(true);
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
        if (res.ok) get().fetchUsers(true);
      },
      
      deleteUser: async (id) => {
        const res = await authFetch(`/api/users/${id}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          get().fetchUsers(true);
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
          await get().fetchUsers(true);
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
      
      fetchPatients: async (search, force) => {
        const now = Date.now();
        const state = get();
        // Skip fetch if requested within the 5 second stale window, unless searching or forcing refresh
        if (!search && !force && now - (state.lastFetched['patients'] || 0) < 5000) return;
        
        const url = search ? `/api/patients?search=${encodeURIComponent(search)}` : '/api/patients';
        
        const runFetch = async () => {
          try {
            const res = await authFetch(url);
            if (res.ok) {
              const data = await res.json();
              set({ 
                patients: data,
                ...(!search && { lastFetched: { ...get().lastFetched, 'patients': now } })
              });
            }
          } catch (e) {
            console.error("Silent patients fetch failed:", e);
          }
        };

        if (state.patients && state.patients.length > 0 && !search && !force) {
          runFetch();
        } else {
          await runFetch();
        }
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
      
       fetchTokens: async (params, force) => {
        const now = Date.now();
        const state = get();
        const cacheKey = params ? `tokens:${JSON.stringify(params)}` : 'tokens:all';
        if (!force && now - (state.lastFetched[cacheKey] || 0) < 5000) return;

        let url = '/api/tokens?';
        if (params?.doctorId) url += `doctorId=${params.doctorId}&`;
        if (params?.patientId) url += `patientId=${params.patientId}&`;
        if (params?.today) url += `today=true&`;
        if (params?.active) url += `active=true&`;
        if (params?.status) {
          const statusStr = Array.isArray(params.status) ? params.status.join(',') : params.status;
          url += `status=${statusStr}&`;
        }
        
        const runFetch = async () => {
          try {
            const res = await authFetch(url);
            if (res.ok) {
              const freshTokens = await res.json();
              set({ 
                tokens: freshTokens,
                lastFetched: { ...get().lastFetched, [cacheKey]: now }
              });
            }
          } catch (e) {
            console.error("Silent tokens fetch failed:", e);
          }
        };

        if (state.tokens && state.tokens.length > 0 && !force) {
          runFetch();
        } else {
          await runFetch();
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
      
      fetchPharmacyQueue: async (force) => {
        const now = Date.now();
        const state = get();
        if (!force && now - (state.lastFetched['pharmacyQueue'] || 0) < 5000) return;

        const res = await authFetch('/api/pharmacy/queue');
        if (res.ok) {
          const queue = await res.json();
          set({ 
            prescriptions: queue.map((q: any) => ({
              ...q.prescription,
              queueId: q.id,
              status: q.status,
              prescriptionCreatedAt: q.prescription.createdAt, // Doctor prescription timestamp
              queueCreatedAt: q.createdAt, // Pharmacy queue assignment timestamp
              tokenNumber: q.prescription.consultation?.visitRecord?.token?.tokenNumber
            })),
            lastFetched: { ...state.lastFetched, 'pharmacyQueue': now }
          });
        }
      },
      
      fetchPharmacyHistory: async (force) => {
        const now = Date.now();
        const state = get();
        if (!force && now - (state.lastFetched['pharmacyHistory'] || 0) < 5000) return;

        const res = await authFetch('/api/pharmacy/history');
        if (res.ok) {
          set({ 
            pharmacyHistory: await res.json(),
            lastFetched: { ...state.lastFetched, 'pharmacyHistory': now }
          });
        }
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
        
        get().fetchPharmacyQueue(true);
        get().fetchPharmacyHistory(true);
        // We do not fetch unpaginated bills here. Let the pharmacy dashboard re-fetch paginated automatically when needed.
        get().fetchPharmacyDashboardSummary();
        get().fetchInventoryItems(true);
        get().fetchTransactions(true);
      },

      updateQueueStatus: async (queueId, status) => {
        const res = await authFetch(`/api/pharmacy/queue/${queueId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        if (res.ok) {
          get().fetchPharmacyQueue(true);
        } else {
          const err = await res.json();
          throw new Error(err.error || 'Failed to update queue status');
        }
      },
      
      fetchPharmacyDashboardSummary: async (startDate?: string, endDate?: string, status?: string, search?: string) => {
        let url = '/api/pharmacy/dashboard-summary';
        const params: string[] = [];
        if (startDate) params.push(`startDate=${encodeURIComponent(startDate)}`);
        if (endDate) params.push(`endDate=${encodeURIComponent(endDate)}`);
        if (status) params.push(`status=${encodeURIComponent(status)}`);
        if (search) params.push(`search=${encodeURIComponent(search)}`);
        if (params.length > 0) {
          url += `?${params.join('&')}`;
        }
        try {
          const res = await authFetch(url);
          if (res.ok) {
            const data = await res.json();
            set({ pharmacyDashboardSummary: data });
          }
        } catch (error) {
          console.error("Failed to fetch pharmacy dashboard summary", error);
        }
      },

      fetchBills: async (startDate?: string, endDate?: string, force?: boolean, page?: number, limit?: number, status?: string, search?: string) => {
        const now = Date.now();
        const state = get();
        const cacheKey = `bills:${startDate || 'all'}:${endDate || 'all'}:${page || 'all'}:${limit || 'all'}:${status || 'all'}:${search || 'all'}`;
        if (!force && now - (state.lastFetched[cacheKey] || 0) < 5000) return;

        let url = '/api/bills';
        const params: string[] = [];
        if (startDate) params.push(`startDate=${encodeURIComponent(startDate)}`);
        if (endDate) params.push(`endDate=${encodeURIComponent(endDate)}`);
        if (page) params.push(`page=${page}`);
        if (limit) params.push(`limit=${limit}`);
        if (status) params.push(`status=${encodeURIComponent(status)}`);
        if (search) params.push(`search=${encodeURIComponent(search)}`);
        if (params.length > 0) {
          url += `?${params.join('&')}`;
        }
        
        const runFetch = async () => {
          try {
            const res = await authFetch(url);
            if (res.ok) {
              const data = await res.json();
              if (page && limit) {
                set({ 
                  billsPaginated: data.data || [],
                  billsTotalCount: data.total || 0,
                  lastFetched: { ...get().lastFetched, [cacheKey]: now }
                });
              } else {
                set({ 
                  bills: data || [],
                  billsTotalCount: Array.isArray(data) ? data.length : 0,
                  lastFetched: { ...get().lastFetched, [cacheKey]: now }
                });
              }
            }
          } catch (e) {
            console.error("Silent bills fetch failed:", e);
          }
        };

        if (page && limit) {
          await runFetch();
        } else if (state.bills && state.bills.length > 0 && !force) {
          runFetch();
        } else {
          await runFetch();
        }
      },
      
      updateBillStatus: async (billId, status) => {
        set((state) => ({
          bills: state.bills?.map(b => b.id === billId ? { ...b, status } : b),
          billsPaginated: state.billsPaginated?.map(b => b.id === billId ? { ...b, status } : b),
        }));

        const res = await authFetch(`/api/bills/${billId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        if (res.ok) {
          // Re-fetch to ensure sync, but the UI is already updated optimistically
          get().fetchInventoryItems(true);
          get().fetchTransactions(true);
          get().fetchReorders(true);
        } else {
          // Revert optimistic update by refetching immediately
          const err = await res.json();
          throw new Error(err.error || 'Failed to update bill status');
        }
      },
      
      fetchInventoryItems: async (force) => {
        const now = Date.now();
        const state = get();
        if (!force && now - (state.lastFetched['inventoryItems'] || 0) < 10000) return;

        const res = await authFetch('/api/inventory');
        if (res.ok) {
          set({ 
            inventoryItems: await res.json(),
            lastFetched: { ...state.lastFetched, 'inventoryItems': now }
          });
        }
      },
      
      fetchSuppliers: async (force) => {
        const now = Date.now();
        const state = get();
        if (!force && now - (state.lastFetched['suppliers'] || 0) < 10000) return;

        const res = await authFetch('/api/suppliers');
        if (res.ok) {
          set({ 
            suppliers: await res.json(),
            lastFetched: { ...state.lastFetched, 'suppliers': now }
          });
        }
      },
      
      fetchReorders: async (force) => {
        const now = Date.now();
        const state = get();
        if (!force && now - (state.lastFetched['reorders'] || 0) < 10000) return;

        const res = await authFetch('/api/inventory/reorders');
        if (res.ok) {
          set({ 
            reorders: await res.json(),
            lastFetched: { ...state.lastFetched, 'reorders': now }
          });
        }
      },
      
      fetchTransactions: async (force) => {
        const now = Date.now();
        const state = get();
        if (!force && now - (state.lastFetched['transactions'] || 0) < 10000) return;

        const res = await authFetch('/api/inventory/transactions');
        if (res.ok) {
          set({ 
            transactions: await res.json(),
            lastFetched: { ...state.lastFetched, 'transactions': now }
          });
        }
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
      
      fetchActivityLogs: async (force) => {
        const now = Date.now();
        const state = get();
        if (!force && now - (state.lastFetched['activityLogs'] || 0) < 5000) return;

        try {
          const res = await authFetch('/api/activity-logs');
          if (res.ok) {
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              const data = await res.json();
              if (Array.isArray(data)) {
                set({ 
                  activityLogs: data,
                  lastFetched: { ...state.lastFetched, 'activityLogs': now }
                });
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
      partialize: (state) => ({
        ...state,
        currentUser: state.currentUser ? {
          ...state.currentUser,
          accessToken: undefined,
          refreshToken: undefined,
        } : null,
      }),
    }
  )
);

export const useAuth = () => useStore((state) => ({ user: state.currentUser, login: state.login, logout: state.logout }));
