import { History, Calendar, ArrowLeft, ClipboardList } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '../store/useStore';

interface MedicalHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientName: string;
  history: any[];
  patient?: any;
}

const getPatientEmail = (p: any) => p?.email || 'Not Available';

const getPatientDOB = (p: any) => {
  if (!p?.dateOfBirth) return 'Not Available';
  try {
    const d = new Date(p.dateOfBirth);
    if (isNaN(d.getTime())) return 'Not Available';
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch (e) {
    return 'Not Available';
  }
};

const getPatientAge = (p: any) => p?.age != null ? String(p.age) : 'Not Available';

const getPatientGender = (p: any) => {
  if (!p?.gender) return 'Not Available';
  const g = p.gender.toUpperCase();
  if (g === 'M' || g === 'MALE') return 'Male';
  if (g === 'F' || g === 'FEMALE') return 'Female';
  if (g === 'O' || g === 'OTHER') return 'Other';
  return p.gender;
};

const getPatientAddress = (p: any) => p?.address || 'Not Available';

const getPatientEmergencyName = (p: any) => {
  if (p?.emergencyContactName && p.emergencyContactName.trim() !== '') return p.emergencyContactName;
  if (p?.medicalHistory) {
    const match = p.medicalHistory.match(/Emergency Contact:\s*([^(]+)/i);
    if (match && match[1] && match[1].trim() !== '') return match[1].trim();
  }
  return 'Not Available';
};

const getPatientEmergencyPhone = (p: any) => {
  if (p?.emergencyContactPhone && p.emergencyContactPhone.trim() !== '') return p.emergencyContactPhone;
  if (p?.medicalHistory) {
    const match = p.medicalHistory.match(/Emergency Contact:\s*[^(]+\(([^)]+)\)/i);
    if (match && match[1] && match[1].trim() !== '') return match[1].trim();
  }
  return 'Not Available';
};

const getPatientReasonForVisit = (p: any) => {
  if (p?.reasonForVisit && p.reasonForVisit.trim() !== '') return p.reasonForVisit;
  if (p?.medicalHistory) {
    const match = p.medicalHistory.match(/Reason:\s*([^\n]+)/i);
    if (match && match[1] && match[1].trim() !== '') return match[1].trim();
  }
  return 'Not Available';
};

const getPatientBP = (p: any) => {
  if (p?.bloodPressure && p.bloodPressure.trim() !== '') return p.bloodPressure;
  if (p?.medicalHistory) {
    const match = p.medicalHistory.match(/BP:\s*([^\n,]+)/i);
    if (match && match[1] && match[1].trim() !== '') return match[1].trim();
  }
  return 'Not Available';
};

const getPatientWeight = (p: any) => {
  if (p?.weight && p.weight.trim() !== '') {
    return p.weight.slice(-2).toLowerCase() === 'kg' ? p.weight : `${p.weight} kg`;
  }
  if (p?.medicalHistory) {
    const match = p.medicalHistory.match(/Weight:\s*([^\n,]+)/i);
    if (match && match[1] && match[1].trim() !== '') return match[1].trim();
  }
  return 'Not Available';
};

const getPatientTemp = (p: any) => {
  if (p?.temperature && p.temperature.trim() !== '') {
    return p.temperature.includes('°') ? p.temperature : `${p.temperature}°C`;
  }
  if (p?.medicalHistory) {
    const match = p.medicalHistory.match(/Temp:\s*([^\n,]+)/i);
    if (match && match[1] && match[1].trim() !== '') return match[1].trim();
  }
  return 'Not Available';
};

export default function MedicalHistoryModal({ isOpen, onClose, patientName, history, patient }: MedicalHistoryModalProps) {
  const { users } = useStore();
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-4xl bg-slate-50 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="p-6 bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Patient Detail & Medical History: {patientName}</h2>
                <p className="text-xs text-slate-400 font-medium font-semibold uppercase tracking-wider">Complete record of registered demographics, active vitals, and previous consultations.</p>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-100 rounded-xl transition-all"
              >
                <ArrowLeft size={20} className="rotate-180" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 scrollbar-hide">
              {/* Patient Core Demographics & Registration Record (Data Audited) */}
              {patient && (
                <div id="patient-lookup-profile-card" className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden p-6 space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4 gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-lg">
                        {patient.name ? patient.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() : 'PT'}
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-800">Complete Patient Profile Card</h3>
                        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Patient ID: {patient.id || 'N/A'}</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold shadow-xs self-start sm:self-center">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span>Verified Active Profile</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Column 1: Personal Details */}
                    <div className="space-y-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100/70">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[15px]">person</span>
                        <span>Personal Info</span>
                      </h4>
                      <div className="space-y-2.5">
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none">Full Legal Name</p>
                          <p className="text-sm font-bold text-slate-800 mt-1">{patient.name || 'Not Available'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none">Gender</p>
                          <p className="text-sm font-bold text-slate-800 mt-1">{getPatientGender(patient)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none">Date of Birth</p>
                          <p className="text-sm font-bold text-slate-800 mt-1">{getPatientDOB(patient)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none">Age</p>
                          <p className="text-sm font-bold text-slate-800 mt-1">{getPatientAge(patient)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Column 2: Contacts & Address */}
                    <div className="space-y-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100/70">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[15px]">contact_phone</span>
                        <span>Contact Detail</span>
                      </h4>
                      <div className="space-y-2.5">
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none">Phone Number</p>
                          <p className="text-sm font-bold text-slate-800 mt-1">{patient.phone || 'Not Available'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none">Email Address</p>
                          <p className="text-sm font-bold text-slate-800 mt-1">{getPatientEmail(patient)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none">Residential Address</p>
                          <p className="text-sm font-bold text-slate-600 leading-relaxed mt-1">{getPatientAddress(patient)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Column 3: Emergency & Triage Vitals */}
                    <div className="space-y-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100/70">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[15px]">clinical_notes</span>
                        <span>Clinical Details</span>
                      </h4>
                      <div className="space-y-2.5">
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none">Emergency Contact</p>
                          <p className="text-sm font-bold text-slate-800 mt-1">
                            {getPatientEmergencyName(patient)}
                            {getPatientEmergencyPhone(patient) !== 'Not Available' && ` (${getPatientEmergencyPhone(patient)})`}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none">Reason For Visit</p>
                          <p className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-lg mt-1 inline-block">
                            {getPatientReasonForVisit(patient)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase leading-none mb-1">Triage Vitals</p>
                          <div className="flex flex-wrap gap-1.5">
                            <span className="px-2.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-bold rounded">
                              BP: {getPatientBP(patient)}
                            </span>
                            <span className="px-2.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-bold rounded">
                              Weight: {getPatientWeight(patient)}
                            </span>
                            <span className="px-2.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-bold rounded">
                              Temp: {getPatientTemp(patient)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t border-slate-200 pt-4 pb-2">
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Historical Consultation Records</h4>
              </div>
              {history.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-slate-200">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                    <History size={32} />
                  </div>
                  <p className="text-slate-400 font-medium">No previous consultation records found.</p>
                </div>
              ) : (
                history.map((record) => {
                  const prescription = record.prescription;
                  const token = record.visitRecord?.token;
                  const doctor = record.doctor;
                  const dispensingStatus = prescription?.pharmacyQueue?.status || (prescription ? 'PENDING' : 'N/A');

                  return (
                    <div key={record.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                      <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Calendar size={14} className="text-blue-500" />
                          <span className="text-sm font-bold text-slate-700">
                            {new Date(record.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                          </span>
                          <div className="flex items-center gap-1.5 ml-1">
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded leading-none">
                              IN: {record.startTime ? new Date(record.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                            </span>
                            <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded leading-none">
                              OUT: {new Date(record.endTime || record.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded ml-2">Token: {token?.tokenNumber || 'N/A'}</span>
                        </div>
                         <div className="flex flex-col items-end">
                          {(() => {
                            const liveDoc = (users || []).find((u: any) => u.id === doctor?.id || u.name === doctor?.name);
                            const isDocOnDuty = liveDoc ? (liveDoc.dutyStatus === 'ON DUTY' || liveDoc.dutyStatus === 'ON_DUTY') : false;
                            const statusDot = isDocOnDuty ? '🟢' : '⚫';
                            return (
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                <span>{statusDot}</span>
                                <span>Dr. {doctor?.name} • {doctor?.department}</span>
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-8">
                         <div>
                            <div className="flex items-center justify-between mb-3">
                               <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Clinical Findings</h4>
                               <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${record.type === 'ADVICE_ONLY' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                  {record.type === 'ADVICE_ONLY' ? 'ADVICE ONLY' : 'PRESCRIPTION ATTACHED'}
                               </span>
                            </div>
                            <div className="space-y-4">
                               <div>
                                  <p className="text-[10px] font-bold text-blue-600 uppercase mb-1">Diagnosis</p>
                                  <p className="text-sm font-bold text-slate-800">{record.diagnosis || 'General Checkup'}</p>
                               </div>
                               <div>
                                  <p className="text-[10px] font-bold text-blue-600 uppercase mb-1">Consultation Notes</p>
                                  <p className="text-sm text-slate-600 leading-relaxed font-medium">{record.notes}</p>
                               </div>
                               <div>
                                  <p className="text-[10px] font-bold text-amber-600 uppercase mb-1">Follow-up Recommendation</p>
                                  <p className="text-xs font-bold text-amber-800 bg-amber-50 px-2 py-1 rounded inline-block">{record.followUp || 'As needed'}</p>
                               </div>
                            </div>
                         </div>
                         <div>
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Medication Details</h4>
                            {prescription && record.type !== 'ADVICE_ONLY' ? (
                              <div className="space-y-3">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Pharmacy Status</span>
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    dispensingStatus === 'COMPLETED' ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
                                  }`}>
                                    {dispensingStatus}
                                  </span>
                                </div>
                                {(prescription.items || []).map((med: any, i: number) => (
                                  <div key={i} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                    <div className="flex justify-between items-start">
                                      <div>
                                        <p className="text-xs font-bold text-slate-800">{med.medicine}</p>
                                        <p className="text-[10px] text-slate-400 font-semibold">{med.dosage} · {med.frequency} · {med.duration}</p>
                                      </div>
                                      {med.instructions && (
                                        <p className="text-[9px] text-slate-400 italic">"{med.instructions}"</p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="py-10 flex flex-col items-center justify-center text-center bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                                <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-300 mb-3">
                                   <ClipboardList size={20} />
                                </div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">No medication prescribed</p>
                                <p className="text-[10px] text-slate-400 mt-1 font-medium italic">Consulted on this date — Advice only</p>
                              </div>
                            )}
                         </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
