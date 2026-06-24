import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useStore, authFetch } from '../../store/useStore';

const getExpiryStatus = (expiryDateStr: string | null | Date, warningWindowDays: number = 182): 'EXPIRED' | 'EXPIRES TODAY' | 'EXPIRING SOON' | 'NORMAL' => {
  if (!expiryDateStr) return 'NORMAL';
  
  const expDate = new Date(expiryDateStr);
  expDate.setHours(0, 0, 0, 0);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffTime = expDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return 'EXPIRED';
  } else if (diffDays === 0) {
    return 'EXPIRES TODAY';
  } else if (diffDays <= warningWindowDays) {
    return 'EXPIRING SOON';
  } else {
    return 'NORMAL';
  }
};

export default function DoctorConsultation() {
  const { tokenId } = useParams();
  const navigate = useNavigate();
  const currentUser = useStore(state => state.currentUser);
  const logout = useStore(state => state.logout);
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
    // Deep load/reload or navigate depending on if it's the current route
    navigate(`/doctor/consultation/${tokenId}`);
    if (window.location.pathname.includes('/doctor/consultation/')) {
      window.location.reload();
    }
  };

  const [notes, setNotes] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [followUp, setFollowUp] = useState('In 2 weeks');
  const [chiefComplaint, setChiefComplaint] = useState('');

  const [medicines, setMedicines] = useState([
    { medicine: '', quantity: 1, dosage: '', frequency: '', duration: '', instructions: '', inventoryItemId: '' }
  ]);
  const [icdCode, setIcdCode] = useState('');
  const [activeDropdownIndex, setActiveDropdownIndex] = useState<number | null>(null);
  const [focusedItemIndex, setFocusedItemIndex] = useState<number>(0);
  const [dropdownDirection, setDropdownDirection] = useState<'down' | 'up'>('down');

  const [bloodPressure, setBloodPressure] = useState('');
  const [temperature, setTemperature] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [spo2, setSpo2] = useState('');
  const [weight, setWeight] = useState('');
  const [allergies, setAllergies] = useState('No known allergies');
  const [symptoms, setSymptoms] = useState('');
  const [observations, setObservations] = useState('');
  
  const [chronicConditionsList, setChronicConditionsList] = useState<string[]>([]);
  const [customChronicCondition, setCustomChronicCondition] = useState('');

  const COMMON_CHRONIC_CONDITIONS = ['Diabetes', 'Hypertension', 'COPD', 'Asthma', 'CKD', 'CAD', 'Hypothyroidism', 'Hyperlipidemia'];

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    await logout();
    navigate('/login');
  };

  // 1. Fetch token/patient details
  const { data: tokens, isLoading: isLoadingTokens } = useQuery({
    queryKey: ['doctorTokens', 'allTokens'],
    queryFn: async () => {
      const res = await authFetch('/api/tokens');
      if (!res.ok) throw new Error('Failed to fetch token');
      return res.json();
    }
  });

  const currentToken = tokens?.find((t: any) => t.id === tokenId);
  const patient = currentToken?.patient;

  const parseAllergies = (medicalHistory: string | null | undefined): string => {
    if (!medicalHistory) return 'No known allergies';
    const isRegBlock = medicalHistory.includes('Department:') || 
                        medicalHistory.includes('Assigned Doctor:') ||
                        medicalHistory.includes('Reason:');
    if (isRegBlock) {
      const allergyMatch = medicalHistory.match(/Allergies:\s*([^\n]+)/i);
      if (allergyMatch) {
        return allergyMatch[1].trim();
      }
      return 'No known allergies';
    }
    if (medicalHistory.startsWith('Allergies:')) {
      return medicalHistory.replace('Allergies:', '').trim();
    }
    const trimmed = medicalHistory.trim();
    if (!trimmed || trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'no clinical history reported.') {
      return 'No known allergies';
    }
    return trimmed;
  };

  useEffect(() => {
    if (patient) {
      if (patient.bloodPressure) setBloodPressure(patient.bloodPressure);
      if (patient.temperature) setTemperature(patient.temperature);
      if (patient.weight) setWeight(patient.weight);
      if (patient.allergies) {
        setAllergies(patient.allergies);
      } else {
        setAllergies(parseAllergies(patient.medicalHistory));
      }
      
      if (patient.chronicConditions) {
        const conds = patient.chronicConditions.split(',').map((c: string) => c.trim()).filter(Boolean);
        setChronicConditionsList(conds);
      } else {
        setChronicConditionsList([]);
      }
    }
  }, [patient]);

  // 2. Fetch history
  const { data: historyData } = useQuery({
    queryKey: ['patientHistory', patient?.id],
    queryFn: async () => {
      if (!patient?.id) return [];
      const res = await authFetch(`/api/patients/${patient.id}/history`);
      if (!res.ok) throw new Error('Failed to fetch history');
      return res.json();
    },
    enabled: !!patient?.id
  });

  // 3. Complete Consultation Mutation
  const { data: inventory = [], isLoading: isLoadingInventory } = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      const res = await authFetch('/api/inventory');
      if (!res.ok) throw new Error('Failed to fetch inventory');
      const data = await res.json();

      // Group inventory items by medication or supply item name (case-insensitive)
      const groups: Record<string, any> = {};

      data.forEach((item: any) => {
        // Exclude deleted items
        if (item.status === 'DELETED') return;

        const key = (item.name || '').trim().toLowerCase();
        if (!key) return;

        const expiryStatus = getExpiryStatus(item.expiryDate);
        const isExpired = expiryStatus === 'EXPIRED';
        
        // This mirrors PharmacyDashboard.tsx: An active batch is ACTIVE, has stock, and is not expired
        const isBatchActive = item.status === 'ACTIVE' && (item.stockQuantity || 0) > 0 && !isExpired;

        if (!groups[key]) {
          groups[key] = {
            id: item.id,
            name: item.name,
            genericName: item.genericName || '',
            brandName: item.brandName || '',
            category: item.category || item.type || 'MEDICINE',
            dosage: item.dosage || '',
            unit: item.unit || 'units',
            minThreshold: item.minThreshold || 20,
            reorderLevel: item.reorderLevel || 20,
            sellingPrice: item.sellingPrice || 15.0,
            status: item.status, 
            totalStock: 0,
            activeBatchCount: 0,
            nextExpiryDate: null,
            batches: []
          };
        }

        // Add each batch
        groups[key].batches.push({
          id: item.id,
          batchNumber: item.batchNumber || 'N/A',
          stockQuantity: item.stockQuantity || 0,
          expiryDate: item.expiryDate,
          status: expiryStatus === 'EXPIRED' ? 'EXPIRED' : item.status,
          shelfLocation: item.shelfLocation || ''
        });

        if (isBatchActive) {
          groups[key].totalStock += item.stockQuantity;
          groups[key].activeBatchCount += 1;

          const batchExp = item.expiryDate ? new Date(item.expiryDate) : null;
          if (batchExp) {
            if (!groups[key].nextExpiryDate) {
              groups[key].nextExpiryDate = item.expiryDate;
            } else {
              const currentNext = new Date(groups[key].nextExpiryDate);
              if (batchExp < currentNext) {
                groups[key].nextExpiryDate = item.expiryDate;
              }
            }
          }
        }
      });

      const result = Object.values(groups).map((group: any) => {
        // Sort batches by expiry date
        group.batches.sort((a: any, b: any) => {
          if (!a.expiryDate) return 1;
          if (!b.expiryDate) return -1;
          return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
        });

        // If there are no active batches but there are expired/depleted batches, 
        // fall back to the earliest expiry date as the nextExpiryDate
        if (!group.nextExpiryDate && group.batches.length > 0) {
          const batchesWithExpiry = group.batches.filter((b: any) => b.expiryDate);
          if (batchesWithExpiry.length > 0) {
            group.nextExpiryDate = batchesWithExpiry[0].expiryDate;
          }
        }

        // Compatibility mapping: we set stockQuantity to totalStock, and expiryDate to nextExpiryDate
        group.stockQuantity = group.totalStock;
        group.expiryDate = group.nextExpiryDate;

        return group;
      });

      return result;
    }
  });

  const { data: users = [] } = useQuery({
    queryKey: ['staffUsers'],
    queryFn: async () => {
      const res = await authFetch('/api/users');
      if (!res.ok) throw new Error('Failed to fetch users');
      return res.json();
    }
  });

  const [referralContext, setReferralContext] = useState('');

  const completeMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await authFetch('/api/consultations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to complete consultation');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Consultation completed successfully');
      queryClient.invalidateQueries({ queryKey: ['doctorTokens'] });
      queryClient.invalidateQueries({ queryKey: ['doctorPatients'] });
      queryClient.invalidateQueries({ queryKey: ['doctorTokensForNav'] });
      queryClient.invalidateQueries({ queryKey: ['patient'] });
      queryClient.invalidateQueries({ queryKey: ['patientHistory'] });
      navigate('/doctor');
    },
    onError: (err: any) => {
      toast.error(err.message);
    }
  });

  const handleFinish = () => {
    if (!currentToken) return;

    // Filter empty medicines
    const validMedicines = medicines.filter(m => m.medicine && m.medicine.trim() !== '');

    // Validate that all entered medicines are active items in the database inventory and NOT expired
    for (const med of validMedicines) {
      const qtyNum = parseInt(String(med.quantity)) || 0;
      if (qtyNum <= 0) {
        toast.error(`Please specify a mandatory valid positive quantity for "${med.medicine}".`);
        return;
      }

      const match = inventory.find((item: any) => 
        item.name.toLowerCase() === med.medicine.toLowerCase() && 
        item.status === 'ACTIVE'
      );
      if (!match) {
        toast.error(`"${med.medicine}" is not present in the active clinical stock inventory registry. All prescribed items must exist in the inventory.`);
        return;
      }
      const isExpired = match.expiryDate && new Date(match.expiryDate) < new Date();
      if (isExpired) {
        toast.error(`"${med.medicine}" has EXPIRED (expiry: ${new Date(match.expiryDate).toLocaleDateString()}) and cannot be prescribed.`);
        return;
      }

      // Stock validation
      const totalStock = match.stockQuantity || 0;
      if (qtyNum > totalStock) {
        toast.error(`Insufficient available stock.`);
        return;
      }
    }

    let finalNotes = notes || '';
    if (referralContext) {
      finalNotes += `\n\nClinical Referral Notes:\n${referralContext}`;
    }

    let fullDiagnosis = diagnosis;
    if (icdCode) {
      if (fullDiagnosis) fullDiagnosis += `, `;
      fullDiagnosis += icdCode;
    }

    completeMutation.mutate({
      tokenId: currentToken.id,
      patientId: currentToken.patientId,
      notes: finalNotes,
      diagnosis: fullDiagnosis || null,
      followUp: followUp || null,
      medicines: validMedicines,
      symptoms: symptoms || null,
      chiefComplaint: chiefComplaint || null,
      vitals: `BP: ${bloodPressure || 'N/A'} | Temp: ${temperature || 'N/A'}°F | HR: ${heartRate || 'N/A'} BPM | SpO2: ${spo2 || 'N/A'}% | Weight: ${weight || 'N/A'} kg`,
      allergies: allergies || 'No known allergies',
      observations: observations || null,
      bpVal: bloodPressure,
      tempVal: temperature,
      weightVal: weight,
      allergyVal: allergies || 'No known allergies',
      chronicConditionsVal: chronicConditionsList.length > 0 ? chronicConditionsList.join(', ') : 'None',
      referral: referralContext.trim() || null
    });
  };

  const addMedicine = () => {
    setMedicines([...medicines, { medicine: '', quantity: 1, dosage: '', frequency: '', duration: '', instructions: '', inventoryItemId: '' }]);
  };

  const updateMedicine = (index: number, fieldOrFields: string | Record<string, any>, value?: any) => {
    setMedicines(prevMeds => {
      const newMeds = [...prevMeds];
      if (typeof fieldOrFields === 'string') {
        newMeds[index] = { ...newMeds[index], [fieldOrFields]: value };
      } else {
        newMeds[index] = { ...newMeds[index], ...fieldOrFields };
      }
      
      const medName = typeof fieldOrFields === 'string' 
        ? (fieldOrFields === 'medicine' ? value : '') 
        : (fieldOrFields.medicine || '');

      if (medName && medName.trim() !== '') {
        const match = inventory.find((item: any) => 
          item.name.toLowerCase() === medName.toLowerCase() && 
          item.status === 'ACTIVE'
        );
        if (match && match.dosage && !newMeds[index].dosage) {
          newMeds[index].dosage = match.dosage;
        }
      }
      return newMeds;
    });
  };

  const removeMedicine = (index: number) => {
    setMedicines(prevMeds => {
      const newMeds = prevMeds.filter((_, i) => i !== index);
      return newMeds.length ? newMeds : [{ medicine: '', quantity: 1, dosage: '', frequency: '', duration: '', instructions: '', inventoryItemId: '' }];
    });
  };

  const checkAccessAndNavigate = (route: string) => {
    navigate(route);
  };
  
  if (isLoadingTokens) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  if (!currentToken || !patient) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4">
        <h2 className="text-2xl font-bold">Token not found</h2>
        <button onClick={() => navigate('/doctor')} className="bg-blue-600 px-4 py-2 text-white rounded">Go Back</button>
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @import url("https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css");
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap");

        :root {
          --brand:#0d47a1; --brand-deep:#003178; --brand-light:#e8f0fe;
          --text:#111827; --muted:#6b7280; --line:#e5e7eb; --page:#f5f6fa;
          --good:#15803d; --good-bg:#dcfce7; --warn:#b91c1c; --warn-bg:#fee2e2;
          --shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04);
        }
        .medflow-consultation *, .medflow-consultation *::before, .medflow-consultation *::after {
          box-sizing:border-box;margin:0;padding:0;
        }
        .medflow-consultation {
          font-family:"Inter",sans-serif;background:var(--page);color:var(--text);min-height:100vh;font-size:14px;
        }
        .medflow-consultation .shell{display:grid;grid-template-columns:180px 1fr;min-height:100vh;}
        /* Sidebar */
        .medflow-consultation .sidebar{background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;padding:20px 0;position:sticky;top:0;height:100vh;overflow-y:auto;}
        .medflow-consultation .brand{display:flex;align-items:center;gap:10px;padding:0 16px 24px;}
        .medflow-consultation .brand-icon{width:36px;height:36px;background:var(--brand-deep);border-radius:8px;display:grid;place-items:center;color:#fff;font-size:18px;flex-shrink:0;}
        .medflow-consultation .brand-name{font-size:15px;font-weight:700;color:var(--brand-deep);line-height:1.2;}
        .medflow-consultation .brand-sub{font-size:9px;color:#9ca3af;letter-spacing:.6px;text-transform:uppercase;}
        .medflow-consultation .nav{flex:1;padding:0 8px;display:flex;flex-direction:column;gap:2px;}
        .medflow-consultation .nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:6px;font-size:14px;font-weight:600;color:var(--muted);background:transparent;border:0;cursor:pointer;text-decoration:none;width:100%;text-align:left;}
        .medflow-consultation .nav-item:hover{background:var(--brand-light);color:var(--brand);}
        .medflow-consultation .nav-item.active{background:var(--brand);color:#fff;}
        .medflow-consultation .nav-item i{font-size:16px;flex-shrink:0;}
        .medflow-consultation .sidebar-footer{padding:12px 8px 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:2px;}
        /* Topbar */
        .medflow-consultation .main-area{display:flex;flex-direction:column;min-height:100vh;}
        .medflow-consultation .topbar{height:56px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 24px;position:sticky;top:0;z-index:50;}
        .medflow-consultation .search-wrap{position:relative;width:340px;}
        .medflow-consultation .search-wrap i{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#9ca3af;font-size:15px;pointer-events:none;z-index:10;}
        .medflow-consultation .search-wrap input{width:100%;height:40px;border:1.5px solid var(--line);border-radius:9999px;background:var(--page);padding:0 36px 0 38px;font:500 13.5px/1 "Inter",sans-serif;color:var(--text);outline:none;transition:all 0.2s ease-in-out;box-shadow:inset 0 1px 2px rgba(0,0,0,0.05);}
        .medflow-consultation .search-wrap input:focus{border-color:var(--brand);background:#fff;box-shadow:0 0 0 3px rgba(13,71,161,0.15);}
        .medflow-consultation .search-item:hover{background:#f8fafc;}
        .medflow-consultation .topbar-tools{display:flex;align-items:center;gap:6px;}
        .medflow-consultation .tool-btn{width:36px;height:36px;border:0;background:transparent;border-radius:8px;display:grid;place-items:center;cursor:pointer;color:var(--muted);font-size:18px;}
        .medflow-consultation .tb-div{width:1px;height:28px;background:var(--line);margin:0 4px;}
        .medflow-consultation .profile-chip{display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 8px;border-radius:8px;}
        .medflow-consultation .profile-info{text-align:right;}
        .medflow-consultation .profile-name{display:block;font-size:14px;font-weight:700;color:var(--text);line-height:1.2;}
        .medflow-consultation .profile-role{display:block;font-size:11px;font-weight:700;color:var(--brand);letter-spacing:.05em;text-transform:uppercase;margin-top:1px;}
        .medflow-consultation .avatar{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#9bc2ff,#dce8ff);border:2px solid var(--brand);display:grid;place-items:center;font-size:14px;font-weight:700;color:var(--brand-deep);}
        /* Content */
        .medflow-consultation .content-area{flex:1;padding:28px;overflow-y:auto;}
        /* Buttons & Badges */
        .medflow-consultation .btn{display:inline-flex;align-items:center;gap:6px;padding:0 16px;height:38px;border-radius:8px;font:600 14px/1 "Inter",sans-serif;cursor:pointer;border:0;}
        .medflow-consultation .btn-primary{background:var(--brand);color:#fff;}
        .medflow-consultation .btn-ghost{background:#fff;color:var(--text);border:1px solid var(--line);}
        .medflow-consultation .btn-sm{height:32px;padding:0 12px;font-size:13px;}
        .medflow-consultation .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;}
        .medflow-consultation .badge-green{background:#d1fae5;color:#065f46;}
        /* Consultation Header */
        .medflow-consultation .consult-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap;}
        .medflow-consultation .consult-title h1{font-size:26px;font-weight:800;margin-bottom:4px;}
        .medflow-consultation .consult-title p{font-size:14px;color:var(--muted);}
        .medflow-consultation .consult-actions{display:flex;gap:10px;}
        /* Grid */
        .medflow-consultation .consult-grid{display:grid;grid-template-columns:400px 1fr;gap:20px;align-items:start;}
        .medflow-consultation .c-panel{display:flex;flex-direction:column;gap:14px;}
        .medflow-consultation .c-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;box-shadow:var(--shadow);}
        /* Patient ID */
        .medflow-consultation .pat-id-row{display:flex;align-items:flex-start;gap:14px;margin-bottom:16px;}
        .medflow-consultation .pat-av-lg{width:60px;height:60px;border-radius:14px;background:linear-gradient(135deg,#dce8ff,#f3f7ff);border:1px solid var(--line);display:grid;place-items:center;font-size:20px;font-weight:700;color:var(--brand-deep);flex-shrink:0;}
        .medflow-consultation .pat-id-info strong{font-size:17px;font-weight:700;display:block;margin-bottom:4px;}
        .medflow-consultation .pat-id-info span{font-size:13px;color:var(--muted);display:block;margin-top:1px;}
        .medflow-consultation .ba-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
        .medflow-consultation .ba-box{border:1px solid var(--line);border-radius:8px;padding:10px 12px;}
        .medflow-consultation .ba-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:5px;}
        .medflow-consultation .ba-val{font-size:15px;font-weight:700;}
        .medflow-consultation .ba-val.danger{color:var(--warn);}
        /* Vitals */
        .medflow-consultation .vitals-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px;display:flex;justify-content:space-between;}
        .medflow-consultation .vitals-mini{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
        .medflow-consultation .v-mini{background:#fafbfc;border:1px solid var(--line);border-radius:10px;padding:12px;}
        .medflow-consultation .v-head{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:6px;}
        .medflow-consultation .v-head i{font-size:14px;}
        .medflow-consultation .v-num{font-size:20px;font-weight:800;line-height:1;}
        .medflow-consultation .v-unit{font-size:11px;color:var(--muted);}
        .medflow-consultation .v-status{font-size:11px;font-weight:600;color:var(--good);margin-top:3px;}
        /* History */
        .medflow-consultation .hist-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px;}
        .medflow-consultation .ht-item{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);}
        .medflow-consultation .ht-item:last-child{border-bottom:0;}
        .medflow-consultation .ht-dot{width:8px;height:8px;border-radius:999px;background:var(--brand);flex-shrink:0;margin-top:5px;}
        .medflow-consultation .ht-date{font-size:12px;font-weight:700;color:var(--muted);width:56px;flex-shrink:0;}
        .medflow-consultation .ht-title{font-size:13px;font-weight:600;}
        .medflow-consultation .ht-desc{font-size:12px;color:var(--muted);margin-top:2px;line-height:1.4;}
        /* Right Panel */
        .medflow-consultation .d-panel{display:flex;flex-direction:column;gap:14px;}
        .medflow-consultation .d-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:20px;box-shadow:var(--shadow);}
        .medflow-consultation .sec-title{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:var(--brand-deep);margin-bottom:14px;}
        .medflow-consultation .sec-title i{font-size:18px;}
        .medflow-consultation .field-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:5px;display:block;}
        .medflow-consultation .field-ta{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;font:500 14px/1.5 "Inter",sans-serif;color:var(--text);background:#fff;outline:none;resize:vertical;min-height:88px;}
        .medflow-consultation .field-ta:focus {border-color: var(--brand);}
        .medflow-consultation .field-sel{width:100%;height:42px;border:1px solid var(--line);border-radius:8px;padding:0 12px;font:500 14px/1 "Inter",sans-serif;color:var(--text);background:#fff;outline:none;}
        .medflow-consultation .mb12{margin-bottom:12px;}
        /* ICD Tags */
        .medflow-consultation .icd-tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}
        .medflow-consultation .icd-add{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:999px;border:1.5px dashed var(--brand);background:var(--brand-light);font:600 13px/1 "Inter",sans-serif;color:var(--brand);cursor:pointer;}
        .medflow-consultation .icd-code{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;border:1px solid var(--line);background:#f3f4f6;font:600 13px/1 "Inter",sans-serif;color:var(--text);cursor:pointer;}
        .medflow-consultation .icd-x{font-size:11px;opacity:.6;}
        /* Rx */
        .medflow-consultation .rx-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
        .medflow-consultation .rx-link{background:none;border:none;color:var(--brand);font:600 13px/1 "Inter",sans-serif;cursor:pointer;display:flex;align-items:center;gap:5px;}
        .medflow-consultation .rx-table th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:0 8px 8px;text-align:left;border-bottom:1px solid var(--line);}
        .medflow-consultation .rx-table td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:middle;}
        .medflow-consultation .rx-table tbody tr:last-child td{border-bottom:0;}
        .medflow-consultation .rx-input{width:100%;border:1px solid transparent;border-radius:6px;padding:6px 8px;font:500 13px/1 "Inter",sans-serif;color:var(--text);background:transparent;outline:none;}
        .medflow-consultation .rx-input:hover, .medflow-consultation .rx-input:focus{border-color:var(--line);}
        .medflow-consultation .del-rx{width:28px;height:28px;border:0;background:transparent;border-radius:6px;display:grid;place-items:center;cursor:pointer;color:var(--muted);font-size:15px;}
        .medflow-consultation .del-rx:hover{background:var(--warn-bg);color:var(--warn);}
        .medflow-consultation .add-med-btn{width:100%;padding:10px;border:1.5px dashed var(--line);border-radius:8px;background:transparent;font:600 13px/1 "Inter",sans-serif;color:var(--muted);cursor:pointer;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:6px;}
        /* Follow-up */
        .medflow-consultation .followup-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .medflow-consultation .toggle-group{display:flex;gap:8px;}
        .medflow-consultation .tog-btn{flex:1;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;font:600 13px/1 "Inter",sans-serif;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;}
        .medflow-consultation .tog-btn.active{border-color:var(--brand);background:var(--brand-light);color:var(--brand);}
      `}} />
      <div className="medflow-consultation">
        <div className="shell">
          {/* Sidebar */}
          <aside className="sidebar">
            <div className="brand">
              <div className="brand-icon"><i className="bi bi-hospital"></i></div>
              <div><div className="brand-name">MedFlow</div><div className="brand-sub">Clinical Precision</div></div>
            </div>
            <nav className="nav">
              <a className="nav-item" href="#" onClick={(e) => { e.preventDefault(); navigate('/doctor'); }}><i className="bi bi-people"></i><span>Patient Queue</span></a>
              <a className="nav-item active" href="#" onClick={(e) => e.preventDefault()}><i className="bi bi-clipboard2-pulse"></i><span>Consultations</span></a>
              <a className="nav-item" href="#" onClick={(e) => { e.preventDefault(); checkAccessAndNavigate('/doctor/records'); }}><i className="bi bi-folder2-open"></i><span>Patient Records</span></a>
              <a className="nav-item" href="#" onClick={(e) => { e.preventDefault(); checkAccessAndNavigate(patient?.id ? `/doctor/history/${patient.id}` : '/doctor/history'); }}><i className="bi bi-clock-history"></i><span>Medical History</span></a>
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
                  <div className="avatar">{currentUser?.name?.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase() || 'DR'}</div>
                </div>
              </div>
            </header>

            <main className="content-area">

              {/* Consult Header */}
              <div className="consult-header">
                <div className="consult-title">
                  <h1>Consultation Session</h1>
                  <p>Started just now &bull; Token: <span>{currentToken.tokenNumber}</span></p>
                </div>
                <div className="consult-actions">
                  <button className="btn btn-ghost" onClick={() => navigate('/doctor')}><i className="bi bi-pause-circle"></i> Pause Session</button>
                  <button 
                    className="btn btn-primary" 
                    onClick={handleFinish}
                    disabled={completeMutation.isPending}
                  >
                    <i className="bi bi-check-circle"></i> {completeMutation.isPending ? 'Saving...' : 'Finish & Sign'}
                  </button>
                </div>
              </div>

              <div className="consult-grid">
                {/* LEFT PANEL */}
                <div className="c-panel">
                  {/* Patient ID Card */}
                  <div className="c-card">
                    <div className="pat-id-row">
                      <div className="pat-av-lg">
                        {patient.name.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()}
                      </div>
                      <div className="pat-id-info">
                        <strong>{patient.name}</strong>
                        <span>DOB: {patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString() : 'N/A'} ({patient.age || 'N/A'} Yrs)</span>
                        <span>Patient ID: #{patient.id}</span>
                      </div>
                      <span className="badge badge-green" style={{marginLeft: 'auto', flexShrink: 0}}>Routine Care</span>
                    </div>
                    <div className="ba-grid">
                      <div className="ba-box">
                        <div className="ba-lbl">Blood Type</div>
                        <div className="ba-val">{patient.bloodGroup || 'N/A'}</div>
                      </div>
                      <div className="ba-box">
                        <div className="ba-lbl">Allergies</div>
                        <div className="ba-val" style={{ color: allergies && allergies.toLowerCase() !== 'no known allergies' && allergies.toLowerCase() !== 'none' ? 'var(--warn)' : 'inherit' }}>
                          {allergies || 'No known allergies'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Vitals Card */}
                  <div className="c-card">
                    <div className="vitals-head">
                      <span>Current Vitals</span>
                      <span>Last updated: {new Date(patient.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                    <div className="vitals-mini">
                      <div className="v-mini">
                        <div className="v-head"><i className="bi bi-heart-pulse" style={{color: 'var(--brand)'}}></i>Heart Rate</div>
                        <div className="v-num">-- <span className="v-unit">BPM</span></div>
                      </div>
                      <div className="v-mini">
                        <div className="v-head"><i className="bi bi-thermometer-half" style={{color: 'var(--warn)'}}></i>Temperature</div>
                        <div className="v-num">{patient.temperature || '--'} <span className="v-unit">°F</span></div>
                      </div>
                      <div className="v-mini">
                        <div className="v-head"><i className="bi bi-activity" style={{color: 'var(--good)'}}></i>Blood Pressure</div>
                        <div className="v-num">{patient.bloodPressure || '--'}</div>
                      </div>
                      <div className="v-mini">
                        <div className="v-head"><i className="bi bi-lungs" style={{color: 'var(--brand)'}}></i>SpO2</div>
                        <div className="v-num">-- <span className="v-unit">%</span></div>
                      </div>
                    </div>
                  </div>                  {/* History Card */}
                  <div className="c-card" style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '10px', marginBottom: '16px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--brand-deep)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <i className="bi bi-clock-history"></i> Clinical History Timeline
                      </span>
                      <span className="badge badge-green" style={{ background: 'var(--brand-light)', color: 'var(--brand)', fontSize: '11px', fontWeight: 700 }}>
                        {historyData?.length || 0} Consults
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', position: 'relative', paddingLeft: '12px', borderLeft: '2px solid #e2e8f0', marginLeft: '6px' }}>
                      {historyData && historyData.length > 0 ? (
                        historyData.map((hist: any, index: number) => {
                          const cDate = new Date(hist.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                          const cTime = new Date(hist.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          const getTimelineMeds = () => {
                            if (hist.prescription?.items && hist.prescription.items.length > 0) {
                              return hist.prescription.items;
                            }
                            if (hist.medicalHistory?.medicines) {
                              try {
                                const parsed = JSON.parse(hist.medicalHistory.medicines);
                                if (Array.isArray(parsed) && parsed.length > 0) {
                                  return parsed.map((m: any) => ({
                                    medicine: m.medicine || m.name || m.medicineName || m.itemCode,
                                    quantity: m.quantity || m.qty || 1,
                                    dosage: m.dosage || 'As directed',
                                    frequency: m.frequency || 'Once daily',
                                    duration: m.duration || 'As needed',
                                    instructions: m.instructions || ''
                                  }));
                                }
                              } catch (e) {
                                // ignore
                              }
                            }
                            return [];
                          };
                          const rxItems = getTimelineMeds();

                          return (
                            <div key={hist.id || index} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {/* Timeline Bullet Anchor */}
                              <div style={{
                                position: 'absolute',
                                left: '-18px',
                                top: '5px',
                                width: '10px',
                                height: '10px',
                                borderRadius: '50%',
                                background: 'var(--brand)',
                                border: '2px solid #fff',
                                boxShadow: '0 0 0 2px var(--brand-light)'
                              }}></div>

                              {/* Card Header */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '4px' }}>
                                <div>
                                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                                    Dr. {hist.doctor?.name || 'Staff Physician'}
                                  </span>
                                  <span style={{ fontSize: '10px', color: 'var(--muted)', display: 'block' }}>
                                    {hist.doctor?.department || 'Outpatient Department'}
                                  </span>
                                </div>
                                <span style={{ fontSize: '10.5px', fontWeight: 600, color: '#0f766e', background: '#e6fffa', padding: '2px 6px', borderRadius: '4px', border: '1px solid #b2f5ea' }}>
                                  {cDate} &bull; {cTime}
                                </span>
                              </div>                              {/* Chief Complaint & Diagnosis */}
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11.5px' }}>
                                <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: '6px', borderLeft: '2.5px solid var(--brand)' }}>
                                  <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block' }}>Chief Complaint</span>
                                  <span style={{ color: 'var(--text)', fontWeight: 550 }}>{hist.chiefComplaint || 'No specific chief complaint logged.'}</span>
                                </div>
                                <div style={{ background: '#fef2f2', padding: '6px 8px', borderRadius: '6px', borderLeft: '2.5px solid #ef4444' }}>
                                  <span style={{ fontSize: '9px', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', display: 'block' }}>Diagnosis</span>
                                  <span style={{ color: '#991b1b', fontWeight: 700 }}>{hist.diagnosis || 'No diagnosis entered'}</span>
                                </div>
                              </div>

                              {/* Clinical Notes */}
                              <div style={{ fontSize: '12px', background: '#fcfcfc', border: '1px solid #e2e8f0', padding: '8px', borderRadius: '6px' }}>
                                <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Clinical Outpatient Notes</span>
                                <p style={{ color: '#334155', lineHeight: '1.4', margin: 0, whiteSpace: 'pre-line' }}>{hist.notes || 'No clinical notes recorded.'}</p>
                              </div>

                              {/* Incident Vitals & Allergies Row */}
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                                <div style={{ background: '#f1f5f9', padding: '6px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                                  <span style={{ fontSize: '8px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', display: 'block' }}>Vitals Collected</span>
                                  <span style={{ color: '#334155', fontWeight: 600 }}>{hist.vitals || 'N/A'}</span>
                                </div>
                                <div style={{ background: '#fef2f2', padding: '6px 8px', borderRadius: '4px', border: '1px solid #fee2e2' }}>
                                  <span style={{ fontSize: '8px', fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', display: 'block' }}>Allergies Declared</span>
                                  <span style={{ color: '#b91c1c', fontWeight: 700 }}>{hist.allergies || 'No known allergies'}</span>
                                </div>
                              </div>

                              {/* Prescriptions Block */}
                              {rxItems.length > 0 && (
                                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                                  <div style={{ background: '#fafafa', padding: '4px 8px', borderBottom: '1px solid #e2e8f0', fontSize: '9.5px', fontWeight: 700, color: 'var(--brand-deep)', textTransform: 'uppercase' }}>
                                    <i className="bi bi-capsule" style={{ marginRight: '4px' }}></i> Prescribed Medicines ({rxItems.length})
                                  </div>
                                  <div style={{ padding: '6px', background: '#fff', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {rxItems.map((item: any, idx: number) => (
                                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', background: '#f8fafc', padding: '4px 8px', borderRadius: '4px', border: '1px solid #edf2f7' }}>
                                        <span style={{ fontWeight: 600, color: '#1e293b' }}>
                                          &bull; {item.medicine}
                                        </span>
                                        <span style={{ fontSize: '10px', color: 'var(--brand)', background: 'var(--brand-light)', padding: '1px 4px', borderRadius: '3px', fontWeight: 700 }}>
                                          Qty: {item.quantity || item.qty || 1} | {item.dosage} {item.frequency ? `| ${item.frequency}` : ''} {item.duration ? `(${item.duration})` : ''}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Follow-up & Referral Details */}
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                                {hist.followUp && (
                                  <span style={{ fontSize: '10px', color: '#15803d', background: '#dcfce7', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                    <i className="bi bi-calendar-event"></i> Follow-up: {hist.followUp}
                                  </span>
                                )}
                                {hist.referral ? (
                                  <span style={{ fontSize: '10px', color: '#7c2d12', background: '#ffedd5', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                    <i className="bi bi-person-fill-exclamation"></i> Referral: {hist.referral}
                                  </span>
                                ) : hist.referrals && hist.referrals.length > 0 ? (
                                  hist.referrals.map((ref: any, rIdx: number) => (
                                    <span key={rIdx} style={{ fontSize: '10px', color: '#7c2d12', background: '#ffedd5', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                      <i className="bi bi-person-fill-exclamation"></i> Referral: {ref.targetDoc?.name ? `Dr. ${ref.targetDoc.name} (${ref.targetDoc.department})` : ref.reason}
                                    </span>
                                  ))
                                ) : (
                                  <span style={{ fontSize: '10px', color: 'var(--muted)', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontWeight: 550 }}>
                                    <i className="bi bi-person-dash"></i> No referral required
                                  </span>
                                )}
                              </div>

                              {index < historyData.length - 1 && (
                                <div style={{ borderBottom: '1px dashed #e2e8f0', marginTop: '10px' }}></div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--muted)' }}>
                          <i className="bi bi-folder-x" style={{ fontSize: '20px', opacity: 0.4 }}></i>
                          <p style={{ fontSize: '12px', marginTop: '4px', margin: 0 }}>No previous histories logged.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* RIGHT PANEL */}
                <div className="d-panel">
                  {/* Diagnosis Card */}
                  <div className="d-card">
                    <div className="sec-title"><i className="bi bi-file-earmark-text"></i>Diagnosis &amp; Observations</div>
                    <div className="mb12">
                      <label className="field-lbl">Chief Complaint</label>
                      <textarea 
                        className="field-ta" 
                        placeholder="Describe primary visit grievance…"
                        style={{minHeight: '80px'}}
                        value={chiefComplaint}
                        onChange={(e) => setChiefComplaint(e.target.value)}
                      ></textarea>
                    </div>

                    <div className="mb12">
                      <label className="field-lbl">Clinical Notes</label>
                      <textarea 
                        className="field-ta" 
                        style={{minHeight: '120px'}} 
                        placeholder="Detailed clinical findings and examination notes…"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      ></textarea>
                    </div>

                    <div className="mb12">
                      <label className="field-lbl" style={{ fontWeight: 700, color: '#991b1b' }}>Clinical Diagnosis (Saves permanently to consultation record)</label>
                      <input 
                        type="text" 
                        className="field-sel"
                        style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: '#fff9f9', fontWeight: 600, color: '#991b1b' }}
                        placeholder="e.g. Essential hypertension, Acute viral bronchitis, Type 2 Diabetes…"
                        value={diagnosis}
                        onChange={(e) => setDiagnosis(e.target.value)}
                      />
                    </div>

                    {/* Vitals & Allergies Form Grid */}
                    <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '10px', border: '1px solid var(--line)', marginBottom: '14px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--brand-deep)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' }}>
                        <i className="bi bi-activity"></i> Complete Session Vitals &amp; Allergies Override
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '10px' }}>
                        <div>
                          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>BP (eg 120/80)</span>
                          <input type="text" value={bloodPressure} onChange={(e) => setBloodPressure(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--line)', fontSize: '12px', fontWeight: 600 }} placeholder="120/80" />
                        </div>
                        <div>
                          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>Temp (°F)</span>
                          <input type="text" value={temperature} onChange={(e) => setTemperature(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--line)', fontSize: '12px', fontWeight: 600 }} placeholder="98.6" />
                        </div>
                        <div>
                          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>HR (BPM)</span>
                          <input type="text" value={heartRate} onChange={(e) => setHeartRate(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--line)', fontSize: '12px', fontWeight: 600 }} placeholder="75" />
                        </div>
                        <div>
                          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>SpO2 (%)</span>
                          <input type="text" value={spo2} onChange={(e) => setSpo2(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--line)', fontSize: '12px', fontWeight: 600 }} placeholder="99" />
                        </div>
                        <div>
                          <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '3px' }}>Weight (kg)</span>
                          <input type="text" value={weight} onChange={(e) => setWeight(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--line)', fontSize: '12px', fontWeight: 600 }} placeholder="70" />
                        </div>
                      </div>
                      <div>
                        <label className="field-lbl" style={{ fontSize: '10px', color: 'var(--muted)', display: 'block', marginBottom: '2px' }}>Allergies (Overwrites patient record Allergies column)</label>
                        <input type="text" value={allergies} onChange={(e) => setAllergies(e.target.value)} style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)', fontSize: '12px', fontWeight: 600 }} placeholder="Patient specific medicine warnings / food allergies" />
                      </div>
                      <div style={{ marginTop: '12px', borderTop: '1px dashed var(--line)', paddingTop: '10px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--brand-deep)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: '6px' }}>
                          <i className="bi bi-heart-pulse-fill"></i> Chronic Conditions
                        </span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                          {COMMON_CHRONIC_CONDITIONS.map((cond) => {
                            const isSelected = chronicConditionsList.includes(cond);
                            return (
                              <button
                                key={cond}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setChronicConditionsList(chronicConditionsList.filter(c => c !== cond));
                                  } else {
                                    setChronicConditionsList([...chronicConditionsList, cond]);
                                  }
                                }}
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '11px',
                                  borderRadius: '20px',
                                  border: isSelected ? '1px solid var(--brand)' : '1px solid var(--line)',
                                  background: isSelected ? 'var(--brand-light)' : '#fff',
                                  color: isSelected ? 'var(--brand-deep)' : 'var(--text)',
                                  fontWeight: isSelected ? 700 : 500,
                                  cursor: 'pointer'
                                }}
                              >
                                {cond} {isSelected ? '✓' : ''}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            type="text"
                            value={customChronicCondition}
                            onChange={(e) => setCustomChronicCondition(e.target.value)}
                            placeholder="Add other custom chronic conditions..."
                            style={{ flex: 1, padding: '5px 8px', borderRadius: '4px', border: '1px solid var(--line)', fontSize: '11px' }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const val = customChronicCondition.trim();
                                if (val && !chronicConditionsList.includes(val)) {
                                  setChronicConditionsList([...chronicConditionsList, val]);
                                  setCustomChronicCondition('');
                                }
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const val = customChronicCondition.trim();
                              if (val && !chronicConditionsList.includes(val)) {
                                setChronicConditionsList([...chronicConditionsList, val]);
                                setCustomChronicCondition('');
                              }
                            }}
                            className="badge badge-green"
                            style={{ fontSize: '11px', border: 'none', cursor: 'pointer', padding: '4px 10px' }}
                          >
                            Add
                          </button>
                        </div>
                        {chronicConditionsList.length > 0 ? (
                          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--brand-deep)', fontWeight: 650 }}>
                            <i className="bi bi-shield-fill-check"></i> To be saved to patient permanent ledger: {chronicConditionsList.join(', ')}
                          </div>
                        ) : (
                          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--muted)', fontStyle: 'italic' }}>
                            No chronic conditions selected. Will clear chronic condition indicators if saved.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="icd-tags">
                      {icdCode && (
                        <button className="icd-code">
                          <span>{icdCode}</span>
                          <span className="icd-x" onClick={(e) => { e.stopPropagation(); setIcdCode(''); }}>✕</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Prescription Card */}
                  <div className="d-card">
                    <div className="rx-head">
                      <div className="sec-title" style={{margin: 0}}><i className="bi bi-prescription2"></i>Prescription Builder</div>
                      <button className="rx-link"><i className="bi bi-clock-history"></i> View Past Rx</button>
                    </div>
                    <table className="rx-table" style={{width: '100%', borderCollapse: 'collapse'}}>
                      <thead>
                        <tr>
                          <th>Medication</th>
                          <th style={{ width: '85px' }}>Qty</th>
                          <th>Dosage</th>
                          <th>Frequency</th>
                          <th>Duration</th>
                          <th>Instructions</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {medicines.map((med, index) => {
                          const searchTerm = med.medicine.trim().toLowerCase();
                          const filteredInventory = inventory.filter((item: any) => {
                            if (!searchTerm) return item.status === 'ACTIVE';
                            return (
                              item.status === 'ACTIVE' && (
                                item.name.toLowerCase().includes(searchTerm) ||
                                (item.genericName && item.genericName.toLowerCase().includes(searchTerm)) ||
                                (item.brandName && item.brandName.toLowerCase().includes(searchTerm)) ||
                                (item.category && item.category.toLowerCase().includes(searchTerm)) ||
                                (item.itemCode && item.itemCode.toLowerCase().includes(searchTerm))
                              )
                            );
                          }).sort((a: any, b: any) => {
                            const isAExpired = a.expiryDate && new Date(a.expiryDate) < new Date();
                            const isBExpired = b.expiryDate && new Date(b.expiryDate) < new Date();
                            if (isAExpired && !isBExpired) return 1;
                            if (!isAExpired && isBExpired) return -1;
                            return 0;
                          });

                          return (
                            <tr key={index}>
                              <td>
                                <div style={{ position: 'relative' }} className="w-full">
                                  <input 
                                    className="rx-input" 
                                    placeholder="Type or select medicine..."
                                    value={med.medicine}
                                    onChange={(e) => {
                                      updateMedicine(index, 'medicine', e.target.value);
                                      setActiveDropdownIndex(index);
                                      setFocusedItemIndex(0);
                                    }}
                                    onFocus={(e) => {
                                      setActiveDropdownIndex(index);
                                      setFocusedItemIndex(0);
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      const spaceBelow = window.innerHeight - rect.bottom;
                                      const spaceAbove = rect.top;
                                      if (spaceBelow < 450 && spaceAbove > spaceBelow) {
                                        setDropdownDirection('up');
                                      } else {
                                        setDropdownDirection('down');
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (activeDropdownIndex !== index) return;
                                      if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setFocusedItemIndex(prev => Math.min(prev + 1, filteredInventory.length - 1));
                                      } else if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setFocusedItemIndex(prev => Math.max(prev - 1, 0));
                                      } else if (e.key === 'Enter') {
                                        e.preventDefault();
                                        if (filteredInventory[focusedItemIndex]) {
                                          const selected = filteredInventory[focusedItemIndex];
                                          const isExpired = selected.expiryDate && getExpiryStatus(selected.expiryDate) === 'EXPIRED';
                                          if (isExpired) {
                                            toast.error(`"${selected.name}" has EXPIRED and cannot be selected.`);
                                            return;
                                          }
                                          updateMedicine(index, {
                                            medicine: selected.name,
                                            dosage: selected.dosage || '',
                                            inventoryItemId: selected.id
                                          });
                                          setActiveDropdownIndex(null);
                                        }
                                      } else if (e.key === 'Escape') {
                                        setActiveDropdownIndex(null);
                                      }
                                    }}
                                  />

                                  {activeDropdownIndex === index && (
                                    <>
                                      <div 
                                        style={{ position: 'fixed', inset: 0, zIndex: 40 }} 
                                        onClick={() => setActiveDropdownIndex(null)}
                                      />
                                      <div 
                                        className="inventory-dropdown bg-white border border-slate-200/80 rounded-2xl shadow-2xl p-3 w-[500px] md:w-[560px] md:min-w-[560px] max-w-[95vw]"
                                        style={{
                                          position: 'absolute',
                                          ...(dropdownDirection === 'up' 
                                            ? { bottom: '100%', marginBottom: '8px' } 
                                            : { top: '100%', marginTop: '8px' }
                                          ),
                                          left: 0,
                                          maxHeight: '440px',
                                          overflowY: 'auto',
                                          zIndex: 50
                                        }}
                                        onMouseDown={(e) => {
                                          // Prevent input blur before click triggers
                                          e.preventDefault();
                                        }}
                                      >
                                        {filteredInventory.length === 0 ? (
                                          <div className="p-6 text-slate-500 text-sm text-center font-medium">
                                            No matching active items found in the clinical stock registry.
                                          </div>
                                        ) : (
                                          filteredInventory.map((item: any, idx: number) => {
                                            const expiryStatus = item.expiryDate ? getExpiryStatus(item.expiryDate) : 'NORMAL';
                                            const isExpired = expiryStatus === 'EXPIRED';
                                            const isExpiresToday = expiryStatus === 'EXPIRES TODAY';
                                            const isExpiringSoon = expiryStatus === 'EXPIRING SOON';

                                            const isOutOfStock = item.stockQuantity === 0;
                                            const isLowStock = !isOutOfStock && item.stockQuantity <= item.minThreshold;

                                            // Availability status calculation
                                            let availabilityStatus = 'IN STOCK';
                                            let avBg = '#dcfce7'; // green-100
                                            let avText = '#15803d'; // green-700
                                            let avBorder = '#bbf7d0';
                                            let avDot = '🟢';

                                            if (isOutOfStock) {
                                              availabilityStatus = 'OUT OF STOCK';
                                              avBg = '#fee2e2'; // red-100
                                              avText = '#ef4444'; // red-500
                                              avBorder = '#fecaca';
                                              avDot = '🔴';
                                            } else if (isLowStock) {
                                              availabilityStatus = 'LOW STOCK';
                                              avBg = '#fef3c7'; // yellow-100
                                              avText = '#d97706'; // yellow-700
                                              avBorder = '#fde68a';
                                              avDot = '🟡';
                                            }

                                            // Expiry status calculation
                                            let expiryLabel = '';
                                            let expBg = '';
                                            let expText = '';
                                            let expBorder = '';
                                            let expDot = '';

                                            if (isExpired) {
                                              expiryLabel = 'EXPIRED';
                                              expBg = '#f1f5f9'; // slate-100
                                              expText = '#475569'; // slate-600
                                              expBorder = '#cbd5e1';
                                              expDot = '⚫';
                                            } else if (isExpiresToday) {
                                              expiryLabel = 'EXPIRES TODAY';
                                              expBg = '#fff7ed'; // orange-50
                                              expText = '#ea580c'; // orange-600
                                              expBorder = '#ffedd5';
                                              expDot = '⚠️';
                                            } else if (isExpiringSoon) {
                                              expiryLabel = 'EXPIRING SOON';
                                              expBg = '#e0e7ff'; // indigo-100
                                              expText = '#4338ca'; // indigo-700
                                              expBorder = '#c7d2fe';
                                              expDot = '⏳';
                                            }

                                            const isFocused = idx === focusedItemIndex;

                                            return (
                                              <div
                                                key={item.id}
                                                onClick={() => {
                                                  if (isExpired) {
                                                    toast.error(`"${item.name}" has EXPIRED and cannot be selected.`);
                                                    return;
                                                  }
                                                  updateMedicine(index, {
                                                    medicine: item.name,
                                                    dosage: item.dosage || '',
                                                    inventoryItemId: item.id
                                                  });
                                                  setActiveDropdownIndex(null);
                                                }}
                                                className={`p-4 cursor-pointer border border-slate-100 rounded-xl mb-2 last:mb-0 transition-all ${
                                                  isExpired ? 'opacity-65 cursor-not-allowed bg-slate-50/50' : ''
                                                } ${
                                                  isFocused ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500/20 shadow-md text-slate-900' : 'bg-white hover:bg-slate-50/50 text-slate-800'
                                                }`}
                                                onMouseEnter={() => setFocusedItemIndex(idx)}
                                              >
                                                <div className="flex items-start justify-between gap-4">
                                                  <div className="flex flex-col min-w-0">
                                                    <span className={`text-[13.5px] font-bold truncate ${isExpired ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                                                      {item.name} {item.dosage ? `(${item.dosage})` : ''}
                                                    </span>
                                                    {item.genericName && (
                                                      <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-tight mt-0.5 truncate">
                                                        Generic: {item.genericName}
                                                      </span>
                                                    )}
                                                  </div>
                                                  
                                                  <div className="flex gap-1.5 shrink-0">
                                                    <span 
                                                      className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-center flex items-center gap-1 border shadow-xs"
                                                      style={{ backgroundColor: avBg, color: avText, borderColor: avBorder }}
                                                    >
                                                      <span className="text-xs leading-none">{avDot}</span>
                                                      <span>{availabilityStatus}</span>
                                                    </span>

                                                    {expiryLabel && (
                                                      <span 
                                                        className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-center flex items-center gap-1 border shadow-xs"
                                                        style={{ backgroundColor: expBg, color: expText, borderColor: expBorder }}
                                                      >
                                                        <span className="text-xs leading-none">{expDot}</span>
                                                        <span>{expiryLabel}</span>
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>

                                                <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-500 font-medium bg-slate-50/80 border border-slate-100/50 p-2 rounded-lg mt-2.5">
                                                  <div className="min-w-0">
                                                    <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block mb-0.5">Category</span>
                                                    <strong className="text-slate-700 font-semibold truncate block">{item.category || item.type || 'MEDICINE'}</strong>
                                                  </div>
                                                  <div className="min-w-0">
                                                    <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block mb-0.5">Stock</span>
                                                    <strong className="text-slate-700 font-semibold truncate block">
                                                      {item.stockQuantity} {item.unit || 'units'}
                                                      {item.activeBatchCount !== undefined && (
                                                        <span className="text-[10px] text-slate-400 font-medium block">
                                                          ({item.activeBatchCount} active {item.activeBatchCount === 1 ? 'batch' : 'batches'})
                                                        </span>
                                                      )}
                                                    </strong>
                                                  </div>
                                                  <div className="min-w-0">
                                                    <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block mb-0.5">Expiry</span>
                                                    <strong className={`font-semibold truncate block ${isExpired ? 'text-red-500 font-bold' : 'text-slate-700'}`}>
                                                      {item.expiryDate ? new Date(item.expiryDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A'}
                                                    </strong>
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>

                                {med.medicine.trim() !== '' && (() => {
                                  const matchingItem = inventory.find(
                                    (item: any) => item.name.toLowerCase() === med.medicine.toLowerCase() && item.status === 'ACTIVE'
                                  );
                                  if (matchingItem) {
                                    const expiryStatus = matchingItem.expiryDate ? getExpiryStatus(matchingItem.expiryDate) : 'NORMAL';
                                    const isExpired = expiryStatus === 'EXPIRED';
                                    const isExpiresToday = expiryStatus === 'EXPIRES TODAY';
                                    const isExpiringSoon = expiryStatus === 'EXPIRING SOON';

                                    const isOutOfStock = matchingItem.stockQuantity === 0;
                                    const isLowStock = !isOutOfStock && matchingItem.stockQuantity <= matchingItem.minThreshold;

                                    let stockStatus = 'In Stock';
                                    let statusColor = '#15803d'; // green-700
                                    let statusBg = '#dcfce7'; // green-100

                                    if (isExpired) {
                                      stockStatus = 'EXPIRED';
                                      statusColor = '#64748b'; // slate-500
                                      statusBg = '#f1f5f9'; // slate-100
                                    } else if (isOutOfStock) {
                                      stockStatus = 'OUT OF STOCK';
                                      statusColor = '#ef4444'; // red-500
                                      statusBg = '#fee2e2'; // red-100
                                    } else if (isLowStock) {
                                      stockStatus = 'LOW STOCK';
                                      statusColor = '#d97706'; // yellow-700
                                      statusBg = '#fef3c7'; // yellow-100
                                    }

                                    // Let's also build an elegant text info for the expiry status
                                    let expiryText = '';
                                    let expiryTextColor = '#64748b';
                                    if (isExpired) {
                                      expiryText = `❌ EXPIRED on ${new Date(matchingItem.expiryDate).toLocaleDateString()}`;
                                      expiryTextColor = '#ef4444';
                                    } else if (isExpiresToday) {
                                      expiryText = `⚠️ EXPIRES TODAY! (${new Date(matchingItem.expiryDate).toLocaleDateString()})`;
                                      expiryTextColor = '#ea580c';
                                    } else if (isExpiringSoon) {
                                      expiryText = `⏳ EXPIRING SOON (${new Date(matchingItem.expiryDate).toLocaleDateString()})`;
                                      expiryTextColor = '#4338ca';
                                    } else if (matchingItem.expiryDate) {
                                      expiryText = `Expires: ${new Date(matchingItem.expiryDate).toLocaleDateString()}`;
                                    }

                                    return (
                                      <div style={{ marginTop: '8px', padding: '10px', borderRadius: '8px', border: isExpired ? '1px solid #fee2e2' : '1px solid #e2e8f0', background: isExpired ? '#fff5f5' : '#f8fafc', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 'bold', color: isExpired ? '#991b1b' : '#1e293b', fontSize: '12px' }}>
                                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: statusColor }}></span>
                                          <span>{matchingItem.name} {matchingItem.dosage ? `(${matchingItem.dosage})` : ''}</span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#64748b', marginTop: '2px', flexWrap: 'wrap', gap: '4px' }}>
                                          <span>
                                            Stock: <strong style={{ color: '#334155' }}>{matchingItem.stockQuantity} {matchingItem.unit || 'units'}</strong>
                                            {matchingItem.activeBatchCount !== undefined && (
                                              <span style={{ marginLeft: '8px', color: '#64748b' }}>
                                                ({matchingItem.activeBatchCount} active {matchingItem.activeBatchCount === 1 ? 'batch' : 'batches'})
                                              </span>
                                            )}
                                          </span>
                                          <span style={{ color: statusColor, background: statusBg, padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                            {isExpired ? '❌ EXPIRED - Cannot Prescribe' : stockStatus}
                                          </span>
                                        </div>
                                        {expiryText && (
                                          <div style={{ fontSize: '10.5px', color: expiryTextColor, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                                            {expiryText}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  } else {
                                    return (
                                      <div style={{ marginTop: '8px', padding: '10px', borderRadius: '8px', border: '1px solid #fee2e2', background: '#fef2f2', color: '#991b1b', fontSize: '11px', fontWeight: '500' }}>
                                        <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: '6px', color: '#ef4444' }}></i>
                                        Item not present in active stock inventory. Please select from list.
                                      </div>
                                    );
                                  }
                                })()}
                              </td>
                              <td>
                                <input 
                                  required
                                  type="number"
                                  className="rx-input" 
                                  placeholder="Qty" 
                                  min={1}
                                  step={1}
                                  value={med.quantity}
                                  onChange={(e) => updateMedicine(index, 'quantity', parseInt(e.target.value) || 0)}
                                />
                              </td>
                            <td>
                              <input 
                                className="rx-input" 
                                placeholder="1 Tablet" 
                                value={med.dosage}
                                onChange={(e) => updateMedicine(index, 'dosage', e.target.value)}
                              />
                            </td>
                            <td>
                              <input 
                                className="rx-input" 
                                placeholder="Once daily (AM)" 
                                value={med.frequency}
                                onChange={(e) => updateMedicine(index, 'frequency', e.target.value)}
                              />
                            </td>
                            <td>
                              <input 
                                className="rx-input" 
                                placeholder="30 Days" 
                                value={med.duration}
                                onChange={(e) => updateMedicine(index, 'duration', e.target.value)}
                              />
                            </td>
                            <td>
                              <input 
                                className="rx-input" 
                                placeholder="After meals" 
                                value={med.instructions || ''}
                                onChange={(e) => updateMedicine(index, 'instructions', e.target.value)}
                              />
                            </td>
                            <td>
                              <button className="del-rx" onClick={() => removeMedicine(index)}><i className="bi bi-trash3"></i></button>
                            </td>
                          </tr>
                        );
                        })}
                      </tbody>
                    </table>
                    <button className="add-med-btn" onClick={addMedicine}><i className="bi bi-plus-circle"></i> Add Medication</button>
                  </div>

                  {/* Follow-up Card */}
                  <div className="d-card">
                    <div className="sec-title"><i className="bi bi-calendar2-check"></i>Follow-up &amp; Next Steps</div>
                    <div className="followup-grid">
                      <div>
                        <label className="field-lbl">Recommended Timeline</label>
                        <select 
                          className="field-sel"
                          value={followUp}
                          onChange={(e) => setFollowUp(e.target.value)}
                        >
                          <option>In 2 weeks</option>
                          <option>In 1 month</option>
                          <option>In 3 months</option>
                          <option>As needed</option>
                        </select>
                      </div>
                      <div>
                        <label className="field-lbl">Referral Needed? (Type custom referral or select doctor)</label>
                        <input 
                          type="text"
                          className="field-sel"
                          placeholder="e.g. Cardiology Referral, Neurology Referral (or search doctor)..."
                          value={referralContext}
                          onChange={(e) => setReferralContext(e.target.value)}
                          list="referral-datalist"
                        />
                        <datalist id="referral-datalist">
                          <option value="Cardiology Referral" />
                          <option value="Neurology Referral" />
                          <option value="Orthopedic Follow-up" />
                          {users.filter((u: any) => u.role === 'DOCTOR' && u.id !== currentUser?.id).map((doc: any) => {
                            const rawName = doc.name.toLowerCase().startsWith('dr') ? doc.name : `Dr. ${doc.name}`;
                            return (
                              <option key={doc.id} value={`Referred to ${rawName} (${doc.department || 'General Medicine'})`} />
                            );
                          })}
                        </datalist>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </main>
          </div>
        </div>
      </div>
    </>
  );
}
