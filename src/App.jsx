import React, { useState, useEffect, useMemo, createContext, useContext, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import html2canvas from "html2canvas";
import { 
  getFirestore, doc, setDoc, collection, 
  query, onSnapshot, where, serverTimestamp 
} from 'firebase/firestore';
import { 
  getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged 
} from 'firebase/auth';
import { 
  Settings, ChevronLeft, ChevronRight, X, Trash2, 
  CheckCircle, AlertCircle, Coffee, Plus, TrendingUp, 
  Zap, ChevronDown, LogOut, Wallet, Share2,
  BarChart3, Loader2, Save, WifiOff, Info, UserPlus
} from 'lucide-react';

/* ================================================================
  1. CONFIG & SYSTEM CONSTANTS
  ================================================================
*/
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : {
      apiKey: "AIzaSyAoCy8CgjNSnpI3bVbcLJBU6pX61ILUB2g",
      authDomain: "penjualansk.firebaseapp.com",
      projectId: "penjualansk",
      storageBucket: "penjualansk.firebasestorage.app",
      messagingSenderId: "422208396983",
      appId: "1:422208396983:web:0da873fb88eb2c16e43732"
    };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'serasa-kopi-ultra-pro';

const THEME_MAP = {
  blue: { bg: "bg-blue-50", text: "text-blue-600", icon: "bg-blue-100", border: "border-blue-100" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", icon: "bg-emerald-100", border: "border-emerald-100" },
  rose: { bg: "bg-rose-50", text: "text-rose-600", icon: "bg-rose-100", border: "border-rose-100" },
  slate: { bg: "bg-slate-50", text: "text-slate-600", icon: "bg-slate-100", border: "border-slate-100" },
  indigo: { bg: "bg-indigo-50", text: "text-indigo-600", icon: "bg-indigo-100", border: "border-indigo-100" }
};

/* ================================================================
  2. PAYROLL CORE ENGINE
  ================================================================
*/
const PayrollEngine = {
  getWeekId: (dateStr) => {
    const d = new Date(dateStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
    const mon = new Date(d.setDate(diff));
    return mon.toISOString().split('T')[0];
  },

  calculate: (entries, config) => {
    const res = {
      gajiPokokTotal: 0,
      komisiCup: 0, kehadiran: 0, bonusMingguan: 0,
      kasbon: 0, minus: 0, expired: 0,
      totalCup: 0, totalNonSks: 0, hariKerja: entries.length,
      weeklyCups: {}
    };

    if (!config) return { ...res, weeklyDetails: [], bruto: 0, potongan: 0, net: 0 };

    res.gajiPokokTotal = res.hariKerja * (config.gajiHarian || 0);

    entries.forEach(e => {

  const totalCup = Math.max(0, Number(e.total) || 0);
  const nonSks = Math.max(0, Number(e.nonSks) || 0);

  res.totalCup += totalCup;
  res.totalNonSks += nonSks;

  /* ======================================
     1️⃣ KOMISI PER CUP (BERDASARKAN NON SKS)
     ====================================== */

  const rate = Math.max(0, Number(config.komisiDasarPerCup) || 0);
  res.komisiCup += nonSks * rate;


  /* ======================================
   2️⃣ KEHADIRAN (BERDASARKAN NON SKS)
   ====================================== */

let bestKehadiran = 0;

for (const tier of (config.kehadiranTiers || [])) {
  const min = Math.max(0, Number(tier?.min) || 0);
  const value = Math.max(0, Number(tier?.bonus) || 0); 
  // tetap pakai field "bonus" di config, hanya nama output diganti

  if (totalCup >= min && value > bestKehadiran) {
    bestKehadiran = value;
  }
}

res.kehadiran += bestKehadiran;


  /* ======================================
     POTONGAN
     ====================================== */

  res.kasbon += Math.max(0, Number(e.kasbon) || 0);
  res.minus += Math.max(0, Number(e.minus) || 0);
  res.expired += Math.max(0, Number(e.expired) || 0);


  /* ======================================
     DATA MINGGUAN (TOTAL CUP)
     ====================================== */

  const wId = PayrollEngine.getWeekId(e.date);
  res.weeklyCups[wId] = (res.weeklyCups[wId] || 0) + totalCup;

});


/* ======================================
   BONUS MINGGUAN
   ====================================== */

const weeklyDetails = Object.entries(res.weeklyCups).map(([date, total]) => {

  let bestWeeklyBonus = 0;

  for (const tier of (config.mingguanTiers || [])) {
    const min = Math.max(0, Number(tier?.min) || 0);
    const bonus = Math.max(0, Number(tier?.bonus) || 0);

    if (total >= min && bonus > bestWeeklyBonus) {
      bestWeeklyBonus = bonus;
    }
  }

  res.bonusMingguan += bestWeeklyBonus;

  return { date, total, bonus: bestWeeklyBonus };
});


/* ======================================
   TOTAL GAJI
   ====================================== */

const bruto =
  res.gajiPokokTotal +
  res.komisiCup +
  res.kehadiran +
  res.bonusMingguan;

const potongan =
  res.kasbon +
  res.minus +
  res.expired;

return {
  ...res,
  weeklyDetails,
  bruto,
  potongan,
  net: bruto - potongan
};
  }
};
/* ================================================================
  3. STATE & DATA CONTEXT
  ================================================================
*/
const AppContext = createContext();

const AppProvider = ({ children }) => {
  const [state, setState] = useState({
    user: null,
    branch: null,
    isOnline: navigator.onLine,
    loading: true,
    msg: null
  });

  const notify = useCallback((text, type = 'success') => {
    setState(prev => ({ ...prev, msg: { text, type } }));
    setTimeout(() => setState(prev => ({ ...prev, msg: null })), 3000);
  }, []);

  useEffect(() => {
    const handleStatus = () => setState(p => ({ ...p, isOnline: navigator.onLine }));
    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);

    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        notify("Gagal otentikasi", "error");
      }
    };

    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setState(p => ({ 
        ...p, 
        user: u, 
        loading: false 
      }));
    });

    return () => {
      unsubscribe();
      window.removeEventListener('online', handleStatus);
      window.removeEventListener('offline', handleStatus);
    };
  }, [notify]);

  return (
    <AppContext.Provider value={{ ...state, setState, notify }}>
      {children}
    </AppContext.Provider>
  );
};

/* ================================================================
  4. MAIN APP LOGIC
  ================================================================
*/

const SerasaApp = () => {
  const { user, branch, isOnline, loading, msg, setState, notify } = useContext(AppContext);
  const [activeTab, setActiveTab] = useState('input');
  const [selectedBarista, setSelectedBarista] = useState('');
  const [viewDate, setViewDate] = useState(new Date());
  const [showSettings, setShowSettings] = useState(false);
  const [newBaristaName, setNewBaristaName] = useState('');
  
  const [isFetching, setIsFetching] = useState(false);
  const [baristas, setBaristas] = useState({});
  const [entries, setEntries] = useState([]);

  // Fetch Branch Config
  useEffect(() => {
    if (!user || !branch) return;
    const branchRef = doc(db, 'artifacts', appId, 'public', 'data', 'branches', branch);
    return onSnapshot(branchRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data().drivers || {};
        setBaristas(data);
        // Initialize selection if empty
        if (!selectedBarista && Object.keys(data).length > 0) {
          setSelectedBarista(Object.keys(data)[0]);
        }
      } else {
        setDoc(branchRef, { drivers: {} });
      }
    });
  }, [user, branch]);

  // Query Records for active barista
  useEffect(() => {
    if (!user || !branch || !selectedBarista) {
        setEntries([]);
        return;
    }

    setIsFetching(true);
    const startOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).toISOString().split('T')[0];

    const entriesRef = collection(db, 'artifacts', appId, 'public', 'data', 'branches', branch, 'baristas', selectedBarista, 'entries');
    
    const unsubscribe = onSnapshot(entriesRef, (snap) => {
      const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const filtered = allDocs.filter(d => d.date >= startOfMonth && d.date <= endOfMonth);
      setEntries(filtered);
      setIsFetching(false);
    }, (err) => {
      notify("Gagal memuat data", "error");
      setIsFetching(false);
    });

    return () => unsubscribe();
  }, [user, branch, selectedBarista, viewDate, notify]);

  const stats = useMemo(() => {
    const config = baristas[selectedBarista] || null;
    return PayrollEngine.calculate(entries, config);
  }, [entries, baristas, selectedBarista]);

  const updateBaristaConfig = (targetName, key, value, tierIndex = null, field = null) => {
    setBaristas(prev => {
      const currentBarista = prev[targetName] || {};
      let nextBarista = { ...currentBarista };

      if (tierIndex !== null && field) {
        const tierType = key; 
        const nextTiers = [...(nextBarista[tierType] || [])];
        nextTiers[tierIndex] = { ...nextTiers[tierIndex], [field]: value };
        nextBarista[tierType] = nextTiers;
      } else {
        nextBarista[key] = value;
      }

      return { ...prev, [targetName]: nextBarista };
    });
  };

  const handleAddBarista = () => {
    if (!newBaristaName.trim()) return notify("Nama tidak boleh kosong", "error");
    if (baristas[newBaristaName]) return notify("Barista sudah ada", "error");

    const newList = {
        ...baristas,
       [newBaristaName]: {
  gajiHarian: 0,
  komisiDasarPerCup: 0,
  minCupForKomisi: 0, // 🔥 TAMBAHAN
  kehadiranTiers: [],
  mingguanTiers: []
        }
    };
    setBaristas(newList);
    setSelectedBarista(newBaristaName);
    setNewBaristaName('');
    notify(`Barista ${newBaristaName} ditambahkan`);
  };

  const handleRemoveBarista = (name) => {
    const { [name]: removed, ...rest } = baristas;
    setBaristas(rest);
    if (selectedBarista === name) {
      setSelectedBarista(Object.keys(rest)[0] || '');
    }
    notify(`Barista ${name} dihapus`);
  };

  const handleSaveEntry = async (e) => {
    e.preventDefault();
    if (!selectedBarista) return notify("Pilih barista", "error");
    if (!isOnline) return notify("Sedang offline", "error");
    
    const fd = new FormData(e.currentTarget);
    const date = fd.get('date');
    
    try {
      const entryData = {
        date,
        total: parseInt(fd.get('total')) || 0,
        nonSks: parseInt(fd.get('nonSks')) || 0,
        kasbon: parseInt(fd.get('kasbon')) || 0,
        minus: parseInt(fd.get('minus')) || 0,
        expired: parseInt(fd.get('expired')) || 0,
        updatedAt: serverTimestamp()
      };

      const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'branches', branch, 'baristas', selectedBarista, 'entries', date);
      await setDoc(docRef, entryData);
      notify("Data shift disimpan");
      e.target.reset();
    } catch (err) {
      notify("Gagal menyimpan", "error");
    }
  };
const handleDownloadSlip = async () => {
  const element = document.getElementById("slipGaji");

  if (!element) return notify("Slip tidak ditemukan", "error");

  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff"
  });

  const image = canvas.toDataURL("image/png");

  const link = document.createElement("a");
  link.href = image;
  link.download = `slip-gaji-${selectedBarista}.png`;
  link.click();

  notify("Slip berhasil diunduh sebagai gambar");
};
  const handleShareGaji = () => {
    if (!selectedBarista || stats.net === 0) return notify("Data kosong", "error");

    const monthStr = viewDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  const message =
  `☕ *SERASA KOPI INDONESIA*\n` +
  `📄 *SLIP GAJI BULANAN*\n` +
  `══════════════════════\n` +

  `👤 Nama    : *${selectedBarista}*\n` +

  `📅 Periode : *${monthStr}*\n\n` +

  `📈 *PENDAPATAN*\n` +
  `• Gaji Pokok      : Rp ${stats.gajiPokokTotal.toLocaleString()}\n` +
  `• Komisi Penjualan: Rp ${stats.komisiCup.toLocaleString()}\n` +
  `• Kehadiran       : Rp ${stats.kehadiran.toLocaleString()}\n` +
  `• Bonus Mingguan  : Rp ${stats.bonusMingguan.toLocaleString()}\n` +
  `──────────────────────\n` +

  `📉 *POTONGAN*\n` +
  `• Kasbon          : Rp ${stats.kasbon.toLocaleString()}\n` +
  `• Minus           : Rp ${stats.minus.toLocaleString()}\n` +
  `• Expired         : Rp ${stats.expired.toLocaleString()}\n` +
  `──────────────────────\n` +

  `💰 *TOTAL DITERIMA*\n` +
  `✨ *Rp ${stats.net.toLocaleString()}*\n\n` +

  `🙏 Terima kasih atas kerja keras dan dedikasinya.\n` +
  `Semoga performa bulan depan semakin meningkat 🚀\n\n` +

  `_Slip ini dibuat otomatis oleh Sistem Serasa Kopi_`;

    const encoded = encodeURIComponent(message);
    
    // Copy to clipboard fallback
    const tempInput = document.createElement("textarea");
    tempInput.value = message;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);

    notify("Salinan slip disalin ke clipboard!");
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-slate-50">
      <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
    </div>
  );

if (!branch) return (
  <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 text-black">
    <div className="w-full max-w-md">

      {/* LOGO */}
      <div className="w-24 h-24 mx-auto mb-8">
        <img
          src="/logo.png"
          alt="Logo"
          className="w-full h-full object-contain"
        />
      </div>

      {/* JUDUL */}
      <h1 className="text-4xl font-black tracking-tighter mb-2 italic uppercase text-center">
        SERASA <span className="text-blue-600">ADMIN</span>
      </h1>

      <p className="text-slate-400 font-bold text-xs uppercase tracking-[0.3em] mb-12 italic text-center">
        Pilih Cabang
      </p>

      {/* BUTTON */}
      <div className="grid gap-4">
        {['KIOS', 'KOPI KELILING'].map(b => (
          <button
            key={b}
            onClick={() => setState(p => ({ ...p, branch: b }))}
            className="p-8 bg-blue border-2 border-slate-100 rounded-[2.5rem] font-black text-xl hover:border-blue-600 hover:shadow-xl transition-all uppercase italic"
          >
            {b}
          </button>
        ))}
      </div>

    </div>
  </div>
);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 text-black">
     <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-100 px-6 py-4">
  <div className="max-w-7xl mx-auto flex items-center justify-between">

    {/* KIRI: LOGO + TEKS */}
    <div className="flex items-center gap-3">

      {/* LOGO */}
      <div className="w-10 h-10 flex items-center justify-center">
        <img
          src="/logo.png"
          alt="Logo"
          className="w-full h-full object-contain"
        />
      </div>

      {/* TEKS */}
      <div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">
          {branch}
        </p>
        <h2 className="text-sm font-black flex items-center gap-2 uppercase tracking-tight italic">
          ADMIN PANEL {!isOnline && <WifiOff className="w-3 h-3 text-rose-500" />}
        </h2>
      </div>

    </div>

    {/* KANAN: BUTTON */}
    <div className="flex gap-2">
      <button
        onClick={() => setShowSettings(true)}
        className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all font-black text-[10px] uppercase italic tracking-widest shadow-lg"
      >
        <Settings className="w-4 h-4" /> Atur Gaji & Target
      </button>

      <button
        onClick={() => setState(p => ({ ...p, branch: null }))}
        className="p-3 bg-rose-50 text-rose-500 rounded-2xl hover:bg-rose-100 transition-all"
      >
        <LogOut className="w-5 h-5" />
      </button>
    </div>

  </div>
</header>

      <main className="max-w-7xl mx-auto p-6 md:p-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-12">
          <div className="lg:col-span-8 bg-blue-600 rounded-[3.5rem] p-10 md:p-14 text-white shadow-2xl relative overflow-hidden">
             <div className="absolute -right-20 -bottom-20 opacity-10"><BarChart3 className="w-80 h-80" /></div>
             <div className="relative z-10">
                <p className="text-[10px] font-black uppercase tracking-[0.4em] opacity-60 mb-3 italic">Gaji Bersih (Take Home Pay)</p>
                {isFetching ? <div className="h-16 w-64 bg-white/20 rounded-2xl animate-pulse mb-10" /> : <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-10 italic">Rp {stats.net.toLocaleString()}</h1>}
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white/10 backdrop-blur-md rounded-3xl p-4 border border-white/10">
                    <p className="text-[8px] font-black uppercase opacity-60 mb-1 italic">
  Uang Kehadiran
</p>
<p className="text-lg font-black">
  Rp {isFetching ? '...' : stats.kehadiran.toLocaleString()}
</p>
                    </div>
                  <div className="bg-white/10 backdrop-blur-md rounded-3xl p-4 border border-white/10">
                    <p className="text-[8px] font-black uppercase opacity-60 mb-1 italic">Total Cup</p>
                    <p className="text-lg font-black">{isFetching ? '...' : stats.totalCup}</p>
                  </div>
                  <div className="bg-white/10 backdrop-blur-md rounded-3xl p-4 border border-white/10">
                    <p className="text-[8px] font-black uppercase opacity-60 mb-1 italic">Bonus Total</p>
                    <p className="text-lg font-black">+{isFetching ? '...' : (stats.kehadiran + stats.bonusMingguan).toLocaleString()}</p>
                  </div>
                  <div className="bg-white/10 backdrop-blur-md rounded-3xl p-4 border border-white/10">
                    <p className="text-[8px] font-black uppercase opacity-60 mb-1 italic">Potongan</p>
                    <p className="text-lg font-black">-{isFetching ? '...' : stats.potongan.toLocaleString()}</p>
                  </div>
                </div>
             </div>
          </div>

          <div className="lg:col-span-4 flex flex-col gap-6">
             <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-xl">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 italic">Pilih Driver / Barista</p>
                <div className="relative">
                  <select 
                    value={selectedBarista} 
                    onChange={e => setSelectedBarista(e.target.value)}
                    className="w-full appearance-none bg-slate-50 px-8 py-5 rounded-[1.8rem] font-black text-xl outline-none uppercase italic"
                  >
                    {Object.keys(baristas).length > 0 ? Object.keys(baristas).map(name => <option key={name} value={name}>{name}</option>) : <option disabled value="">Belum ada driver</option>}
                  </select>
                  <ChevronDown className="absolute right-6 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-300" />
                </div>
             </div>

             <div className="bg-slate-900 p-8 rounded-[3rem] text-white flex items-center justify-between shadow-xl">
                <div>
                   <p className="text-[9px] font-black uppercase opacity-40 mb-1 italic">Periode Laporan</p>
                   <p className="text-xl font-black italic">{viewDate.toLocaleDateString('id-ID', {month: 'long', year: 'numeric'})}</p>
                </div>
                <div className="flex gap-2">
                   <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()-1))} className="p-3 bg-white/10 rounded-2xl hover:bg-white/20"><ChevronLeft className="w-5 h-5"/></button>
                   <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()+1))} className="p-3 bg-white/10 rounded-2xl hover:bg-white/20"><ChevronRight className="w-5 h-5"/></button>
                </div>
             </div>
          </div>
        </div>

        <div className="flex bg-slate-100 p-1.5 rounded-[2rem] w-fit mx-auto mb-12 shadow-inner">
           {['input', 'rekap', 'gaji'].map(t => (
             <button key={t} onClick={() => setActiveTab(t)} className={`px-10 py-3.5 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all italic ${activeTab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>
               {t}
             </button>
           ))}
        </div>

        <div className="animate-in slide-in-from-bottom-5">
           {activeTab === 'input' && (
             <div className="max-w-xl mx-auto">
                <form onSubmit={handleSaveEntry} className="bg-white p-10 md:p-14 rounded-[4rem] border border-slate-100 shadow-2xl space-y-10">
                   <div className="space-y-3 text-center">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Tanggal Kerja</label>
                      <input name="date" type="date" required defaultValue={new Date().toISOString().split('T')[0]} className="w-full p-6 bg-slate-50 rounded-[2rem] font-black text-xl outline-none focus:ring-4 ring-blue-50 transition-all text-center" />
                   </div>

                   <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-3">
                         <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest ml-4 italic">Total Cup</label>
                         <input name="total" type="number" required placeholder="0" className="w-full p-8 bg-blue-50 text-blue-700 rounded-[2.5rem] font-black text-4xl outline-none focus:ring-4 ring-blue-100 text-center italic" />
                      </div>
                      <div className="space-y-3">
                         <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-4 italic">Non-SKS</label>
                         <input name="nonSks" type="number" required placeholder="0" className="w-full p-8 bg-emerald-50 text-emerald-700 rounded-[2.5rem] font-black text-4xl outline-none focus:ring-4 ring-emerald-100 text-center italic" />
                      </div>
                   </div>

                   <div className="grid grid-cols-3 gap-4">
                      {['Kasbon', 'Minus', 'Expired'].map(f => (
                        <div key={f} className="space-y-2">
                           <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest text-center block italic">{f}</label>
                           <input name={f.toLowerCase()} type="number" placeholder="0" className="w-full p-5 bg-slate-50 rounded-[1.8rem] font-black text-center text-slate-800 outline-none italic" />
                        </div>
                      ))}
                   </div>

                   <button type="submit" disabled={!isOnline || !selectedBarista} className="w-full py-8 bg-slate-900 text-white rounded-[2.5rem] font-black text-sm uppercase tracking-[0.4em] hover:bg-blue-600 disabled:opacity-50 transition-all shadow-xl italic">
                      Simpan Data Shift
                   </button>
                </form>
             </div>
           )}

           {activeTab === 'rekap' && (
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-xl h-fit">
                   <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-8 flex items-center gap-2 italic">
                     <Zap className="w-4 h-4 text-blue-500" /> Milestone Mingguan
                   </h4>
                   <div className="space-y-4">
                      {isFetching ? [1,2,3].map(i => <div key={i} className="h-20 w-full bg-slate-100 rounded-3xl animate-pulse" />) : stats.weeklyDetails.map(w => (
                         <div key={w.date} className="flex justify-between items-center p-5 bg-slate-50 rounded-3xl border border-slate-100">
                            <div>
                               <p className="text-[9px] font-black text-slate-400 uppercase italic">Senin, {new Date(w.date).getDate()}</p>
                               <p className="font-black text-lg italic">{w.total} Cup</p>
                            </div>
                            <div className="text-right">
                               <p className="text-[9px] font-black text-blue-400 uppercase italic">Bonus</p>
                               <p className="font-black text-emerald-600 italic">Rp {w.bonus.toLocaleString()}</p>
                            </div>
                         </div>
                      ))}
                   </div>
                </div>

                <div className="lg:col-span-2 bg-white rounded-[3.5rem] border border-slate-100 shadow-xl overflow-hidden">
                   <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-100">
                           <tr>
                             <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Tanggal</th>
                             <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Data Cup</th>
                             <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right italic">Potongan</th>
                           </tr>
                        </thead>
                        <tbody>
                           {isFetching ? [1,2,3,4,5].map(i => (
                             <tr key={i}><td colSpan="3" className="px-8 py-4"><div className="h-10 w-full bg-slate-50 rounded-lg animate-pulse" /></td></tr>
                           )) : entries.sort((a,b) => b.date.localeCompare(a.date)).map(e => (
                             <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                               <td className="px-8 py-6 font-black text-slate-800 italic">{new Date(e.date).toLocaleDateString('id-ID', {weekday: 'short', day: 'numeric', month: 'short'})}</td>
                               <td className="px-8 py-6">
                                  <div className="flex gap-2">
                                     <span className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg font-black text-[10px] italic">{e.total} Total</span>
                                     <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg font-black text-[10px] italic">{e.nonSks} Non-Sks</span>
                                  </div>
                               </td>
                               <td className="px-8 py-6 text-right font-black text-rose-500 italic">Rp {(e.kasbon + e.minus + e.expired).toLocaleString()}</td>
                             </tr>
                           ))}
                        </tbody>
                      </table>
                   </div>
                </div>
             </div>
           )}

           {activeTab === 'gaji' && (
             <div className="max-w-4xl mx-auto space-y-8">
                <div id="slipGaji" className="bg-white rounded-[4rem] border border-slate-100 shadow-2xl overflow-hidden">
                   <div className="bg-slate-900 p-12 text-white flex flex-col md:flex-row justify-between items-start md:items-end gap-8">
                      <div>
                         <p className="text-[10px] font-black uppercase tracking-[0.5em] text-blue-400 mb-2 italic">E-Slip Gaji Terpadu</p>
                         <h3 className="text-5xl font-black tracking-tighter uppercase italic">{selectedBarista || 'Pilih Nama'}</h3>
                      </div>
                      <div className="text-right">
                         <p className="text-[10px] font-black uppercase tracking-[0.5em] opacity-40 mb-1 italic">Total Terima</p>
                         <p className="text-6xl font-black text-emerald-400 italic">
  Rp {(stats.kehadiran - stats.potongan).toLocaleString()}
</p>
                      </div>
                   </div>

                   <div className="p-10 md:p-16 grid grid-cols-1 md:grid-cols-2 gap-16">
                      <section className="space-y-6">
                         <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 italic">
                            <TrendingUp className="w-4 h-4 text-emerald-500"/> Rincian Pendapatan
                         </h4>
                         <div className="space-y-3">
                            {[
                              {l: 'Gaji Pokok Harian', v: stats.gajiPokokTotal, t: 'indigo'},
                              {l: 'Komisi Per Cup', v: stats.komisiCup, t: null},
                             {l: 'Kehadiran', v: stats.kehadiran, t: 'emerald'},
                              {l: 'Bonus Mingguan', v: stats.bonusMingguan, t: 'blue'}
                            ].map((item, idx) => (
                              <div key={idx} className={`flex justify-between items-center p-6 rounded-3xl ${item.t ? THEME_MAP[item.t].bg : 'bg-slate-50'}`}>
                                 <span className="text-[10px] font-bold text-slate-500 uppercase italic">{item.l}</span>
                                 <span className={`font-black italic ${item.t ? THEME_MAP[item.t].text : ''}`}>Rp {item.v.toLocaleString()}</span>
                              </div>
                            ))}
                         </div>
                      </section>

                      <section className="space-y-6">
                         <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 italic">
                            <Info className="w-4 h-4 text-rose-500"/> Rincian Potongan
                         </h4>
                         <div className="space-y-3">
                            {[
                                {l: 'Minus Kas', v: stats.minus},
                                {l: 'Barang Expired', v: stats.expired},
                                {l: 'Pinjaman / Kasbon', v: stats.kasbon}
                            ].map((item, idx) => (
                               <div key={idx} className="flex justify-between items-center p-6 bg-rose-50/50 rounded-3xl border border-rose-100">
                                 <span className="text-[10px] font-bold text-rose-400 uppercase italic">{item.l}</span>
                                 <span className="font-black text-rose-600 italic">Rp {item.v.toLocaleString()}</span>
                               </div>
                            ))}
                         </div>
                      </section>
                   </div>
                </div>

               <div className="flex gap-4">

  <button
    onClick={handleDownloadSlip}
    className="flex-1 p-8 bg-emerald-600 text-white rounded-[2.5rem] font-black"
  >
    Download Slip
  </button>

  <button
    onClick={handleShareGaji}
    className="flex-1 p-8 bg-blue-600 text-white rounded-[2.5rem] font-black"
  >
    Bagikan WA
  </button>

</div>
             </div>
           )}
        </div>
      </main>

      {showSettings && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-md flex items-end md:items-center justify-center p-4">
           <div className="w-full max-w-4xl bg-white rounded-[4rem] shadow-2xl h-[90vh] md:h-auto md:max-h-[90vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom-20">
              <div className="p-10 border-b border-slate-100 flex justify-between items-center shrink-0">
                 <h2 className="text-3xl font-black tracking-tighter flex items-center gap-4 italic uppercase">
                   <Settings className="w-8 h-8 text-blue-600" /> Atur Gaji & Target
                 </h2>
                 <button onClick={() => setShowSettings(false)} className="p-4 hover:bg-slate-100 rounded-2xl transition-all"><X className="w-7 h-7"/></button>
              </div>

              <div className="flex-1 overflow-y-auto p-10 space-y-12 pb-32">
                 <section className="p-10 bg-slate-900 rounded-[3rem] text-white shadow-xl">
                    <h4 className="text-[11px] font-black opacity-40 uppercase tracking-[0.3em] mb-8 italic">Kelola Nama Driver / Barista</h4>
                    <div className="flex gap-4 mb-8">
                       <input 
                        type="text" 
                        placeholder="Input Nama Baru..." 
                        value={newBaristaName}
                        onChange={e => setNewBaristaName(e.target.value)}
                        className="flex-1 bg-white/10 p-5 rounded-2xl font-black outline-none border border-white/10 focus:border-blue-500 italic"
                       />
                       <button onClick={handleAddBarista} className="p-5 bg-blue-600 rounded-2xl hover:bg-blue-500 transition-all shadow-lg active:scale-95"><UserPlus className="w-6 h-6"/></button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       {Object.keys(baristas).map(name => (
                          <div key={name} className={`flex items-center justify-between p-5 rounded-2xl border transition-all ${selectedBarista === name ? 'bg-blue-600 border-blue-400' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                             <button onClick={() => setSelectedBarista(name)} className="flex-1 text-left font-black uppercase italic">{name}</button>
                             <button onClick={() => handleRemoveBarista(name)} className="p-2 text-rose-400 hover:text-rose-300"><Trash2 className="w-4 h-4"/></button>
                          </div>
                       ))}
                    </div>
                 </section>

                 {selectedBarista ? (
                    <div className="space-y-12 animate-in slide-in-from-top-5">
                        <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100 flex items-center gap-4">
                            <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black italic shadow-lg">
                                {selectedBarista.charAt(0)}
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest italic">Sedang Mengatur Gaji:</p>
                                <p className="text-xl font-black uppercase italic">{selectedBarista}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          <section className="p-10 bg-indigo-50/50 rounded-[3rem] border border-indigo-100">
                              <h4 className="text-[11px] font-black text-indigo-600 uppercase tracking-[0.3em] mb-8 flex items-center gap-2 italic">
                                <Wallet className="w-4 h-4" /> 1. Gaji Pokok Harian
                              </h4>
                              <div className="relative">
                                <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-slate-300">Rp</span>
                                <input 
                                    type="number" 
                                    value={baristas[selectedBarista]?.gajiHarian || 0}
                                    onChange={e => updateBaristaConfig(selectedBarista, 'gajiHarian', parseInt(e.target.value) || 0)}
                                    className="w-full pl-16 pr-8 py-6 bg-white rounded-2xl border border-slate-200 font-black text-2xl outline-none focus:border-indigo-500 transition-all italic" 
                                />
                              </div>
                              <p className="mt-4 text-[9px] font-bold text-slate-400 italic">* Nilai ini akan dikalikan dengan jumlah hari kerja dalam sebulan.</p>
                          </section>

                          <section className="p-10 bg-slate-50 rounded-[3rem] border border-slate-100">
  <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] mb-8 italic">
    2. Komisi Dasar (Per Cup)
  </h4>

  {/* KOMISI PER CUP */}
  <div className="relative mb-6">
    <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-slate-300">
      Rp
    </span>
    <input 
      type="number" 
      value={baristas[selectedBarista]?.komisiDasarPerCup || 0}
      onChange={e =>
        updateBaristaConfig(
          selectedBarista,
          'komisiDasarPerCup',
          parseInt(e.target.value) || 0
        )
      }
      className="w-full pl-16 pr-8 py-6 bg-white rounded-2xl border border-slate-200 font-black text-2xl outline-none focus:border-blue-500 transition-all italic"
    />
  </div>

  {/* BATAS MINIMAL CUP */}
  <div className="relative">
    <span className="absolute left-6 top-1/2 -translate-y-1/2 font-black text-slate-300">
      ≥
    </span>
    <input 
      type="number"
      placeholder="Minimal cup agar komisi aktif"
      value={baristas[selectedBarista]?.minCupForKomisi || 0}
      onChange={e =>
        updateBaristaConfig(
          selectedBarista,
          'minCupForKomisi',
          parseInt(e.target.value) || 0
        )
      }
      className="w-full pl-16 pr-8 py-5 bg-white rounded-2xl border border-slate-200 font-black outline-none italic"
    />
  </div>

  <p className="mt-4 text-[9px] font-bold text-slate-400 italic">
    * Komisi hanya berlaku jika total cup ≥ nilai ini
  </p>
</section>
                        </div>

                        <section className="p-10 bg-emerald-50/30 rounded-[3rem] border border-emerald-100">
                            <div className="flex justify-between items-center mb-8">
                            <h4 className="text-[11px] font-black text-emerald-600 uppercase tracking-[0.3em] italic">3. Bonus Harian (Berdasarkan Non-SKS)</h4>
                            <button onClick={() => {
                                const current = baristas[selectedBarista]?.kehadiranTiers || [];
                                updateBaristaConfig(selectedBarista, 'kehadiranTiers', [...current, { min: 0, bonus: 0 }]);
                            }} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase italic shadow-md">+ Tambah Tier</button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {baristas[selectedBarista]?.kehadiranTiers?.map((t, i) => (
                                <div key={i} className="flex gap-4 items-center">
                                    <div className="flex-1 grid grid-cols-2 gap-4 bg-white p-3 rounded-2xl border border-emerald-100 shadow-sm">
                                    <div className="p-2 border-r border-slate-100">
                                        <p className="text-[8px] font-black text-slate-300 uppercase mb-1 italic">Min. Non-Sks</p>
                                        <input type="number" value={t.min} onChange={e => updateBaristaConfig(selectedBarista, 'kehadiranTiers', parseInt(e.target.value), i, 'min')} className="w-full font-black outline-none italic" />
                                    </div>
                                    <div className="p-2">
                                        <p className="text-[8px] font-black text-slate-300 uppercase mb-1 italic">Bonus Rp</p>
                                        <input type="number" value={t.bonus} onChange={e => updateBaristaConfig(selectedBarista, 'kehadiranTiers', parseInt(e.target.value), i, 'bonus')} className="w-full font-black outline-none italic text-emerald-600" />
                                    </div>
                                    </div>
                                    <button onClick={() => {
                                    const next = baristas[selectedBarista].kehadiranTiers.filter((_, idx) => idx !== i);
                                    updateBaristaConfig(selectedBarista, 'kehadiranTiers', next);
                                    }} className="p-4 text-rose-400 hover:bg-rose-50 rounded-2xl transition-all"><Trash2 className="w-5 h-5"/></button>
                                </div>
                            ))}
                            </div>
                        </section>

                        <section className="p-10 bg-blue-50/30 rounded-[3rem] border border-blue-100">
                            <div className="flex justify-between items-center mb-8">
                            <h4 className="text-[11px] font-black text-blue-600 uppercase tracking-[0.3em] italic">4. Bonus Mingguan (Total Cup)</h4>
                            <button onClick={() => {
                                const current = baristas[selectedBarista]?.mingguanTiers || [];
                                updateBaristaConfig(selectedBarista, 'mingguanTiers', [...current, { min: 0, bonus: 0 }]);
                            }} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase italic shadow-md">+ Tambah Tier</button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {baristas[selectedBarista]?.mingguanTiers?.map((t, i) => (
                                <div key={i} className="flex gap-4 items-center">
                                    <div className="flex-1 grid grid-cols-2 gap-4 bg-white p-3 rounded-2xl border border-blue-100 shadow-sm">
                                    <div className="p-2 border-r border-slate-100">
                                        <p className="text-[8px] font-black text-slate-300 uppercase mb-1 italic">Min. Cup / Minggu</p>
                                        <input type="number" value={t.min} onChange={e => updateBaristaConfig(selectedBarista, 'mingguanTiers', parseInt(e.target.value), i, 'min')} className="w-full font-black outline-none italic" />
                                    </div>
                                    <div className="p-2">
                                        <p className="text-[8px] font-black text-slate-300 uppercase mb-1 italic">Bonus Rp</p>
                                        <input type="number" value={t.bonus} onChange={e => updateBaristaConfig(selectedBarista, 'mingguanTiers', parseInt(e.target.value), i, 'bonus')} className="w-full font-black outline-none italic text-blue-600" />
                                    </div>
                                    </div>
                                    <button onClick={() => {
                                    const next = baristas[selectedBarista].mingguanTiers.filter((_, idx) => idx !== i);
                                    updateBaristaConfig(selectedBarista, 'mingguanTiers', next);
                                    }} className="p-4 text-rose-400 hover:bg-rose-50 rounded-2xl transition-all"><Trash2 className="w-5 h-5"/></button>
                                </div>
                            ))}
                            </div>
                        </section>
                    </div>
                 ) : (
                    <div className="p-20 text-center space-y-4">
                        <Info className="w-16 h-16 text-slate-200 mx-auto" />
                        <p className="font-black text-slate-400 uppercase italic">Pilih atau Tambahkan Barista untuk Mengatur Gaji</p>
                    </div>
                 )}

                 <button 
                  onClick={async () => {
                    try {
                      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'branches', branch), { drivers: baristas }, { merge: true });
                      notify("Konfigurasi disimpan");
                      setShowSettings(false);
                    } catch (e) {
                      notify("Koneksi gagal", "error");
                    }
                  }}
                  className="w-full py-8 bg-slate-900 text-white rounded-[2.5rem] font-black text-sm uppercase tracking-[0.4em] shadow-2xl hover:bg-blue-600 flex items-center justify-center gap-4 italic active:scale-95 transition-all"
                 >
                   <Save className="w-6 h-6" /> Simpan Semua Pengaturan
                 </button>
              </div>
           </div>
        </div>
      )}

      {msg && (
        <div className={`fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] px-10 py-5 rounded-[2rem] shadow-2xl flex items-center gap-4 text-white font-black animate-in slide-in-from-bottom-10 ${msg.type === 'success' ? 'bg-slate-900' : 'bg-rose-600'}`}>
          {msg.type === 'success' ? <CheckCircle className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5" />}
          <span className="text-[10px] uppercase tracking-widest italic">{msg.text}</span>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,700;0,800;1,800&display=swap');
        body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: #FDFDFD; margin: 0; overflow-x: hidden; }
        .animate-in { animation: animateIn 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
        @keyframes animateIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        select { background-image: none !important; }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      `}</style>
    </div>
  );
};

const App = () => (
  <AppProvider>
    <SerasaApp />
  </AppProvider>
);

export default App;
