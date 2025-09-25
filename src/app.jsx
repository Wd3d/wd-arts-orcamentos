import React, { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ===== Firebase =====
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  deleteUser,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  deleteDoc,
} from "firebase/firestore";

// ====== Helpers gerais ======
const brl = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
const toNumber = (v) => {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
};
const pctStr = (n) => `${(n * 100).toFixed(2)}%`;

// ====== Storage keys ======
const STORAGE_KEY = "orcamento-state-v3";
const ORCS_KEY = "orcamentos-v3";
const FAV_KEY = "favoritos-v2";
const CATA_KEY = "catalogo-v2";
const LOGO_KEY = "logoDataURL-v1";

// ====== Firebase config (use variáveis de ambiente do Vite OU preencha aqui) ======
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "COLOQUE_SUA_API_KEY",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "SEU_PROJETO.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "SEU_PROJETO",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "SEU_BUCKET.appspot.com",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_SENDER_ID || "SEU_SENDER_ID",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "SUA_APP_ID",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
};

let fbApp = null;
let fbDb = null;
let fbAuth = null;
function ensureFirebase() {
  if (!getApps().length) {
    fbApp = initializeApp(firebaseConfig);
  } else {
    fbApp = getApps()[0];
  }
  fbDb = getFirestore(fbApp);
  fbAuth = getAuth(fbApp);
}

// ====== App principal ======
export default function App() {
  // ---------- Estado principal do orçamento ----------
  const initial = {
    _id: null, // id do orçamento salvo
    nomeOrcamento: "",
    cliente: "",
    contato: "",
    condicaoPagamento: "",
    observacoes: "",
    perdaPct: "0", // %
    minutosPorUnidade: "0",
    maoDeObraPorMin: "0", // R$/min (não vai para o PDF)
    custoFixoPorMin: "0", // R$/min (não vai para o PDF)
    lucroPct: "0", // % (não vai para o PDF)
    taxaPct: "0", // % (gross-up)
    materiais: [{ id: 1, descricao: "", qtd: "", unit: "", fav: false }],
  };

  const [state, setState] = useState(initial);

  // ---------- UI / Navegação ----------
  const [tab, setTab] = useState("editor"); // editor | orcamentos | catalogo
  const [toast, setToast] = useState(null);
  const [syncStatus, setSyncStatus] = useState("offline");

  // ---------- LGPD ----------
  const [lgpdAccepted, setLgpdAccepted] = useState(false);
  const [lgpdShowModal, setLgpdShowModal] = useState(false);
  const acceptLGPD = () => {
    setLgpdAccepted(true);
    try {
      localStorage.setItem("lgpdAccepted-v1", "1");
    } catch {}
    setLgpdShowModal(false);
  };

  // ---------- Auth ----------
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin"); // signin | signup
  const [authEmail, setAuthEmail] = useState("");
  const [authPass, setAuthPass] = useState("");

  // menu usuário
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // ---------- Catálogo de Materiais (gestor) ----------
  const [catalogo, setCatalogo] = useState([]);
  const [catForm, setCatForm] = useState({
    nome: "",
    unidade: "",
    quantidade: "",
    preco: "",
    obs: "",
  });
  const [editCatId, setEditCatId] = useState(null);
  const [editCatData, setEditCatData] = useState({
    nome: "",
    unidade: "",
    quantidade: "",
    preco: "",
    obs: "",
  });

  // ---------- Favoritos ----------
  const [favoritos, setFavoritos] = useState([]); // [{descricao, unit}]
  const [favQuery, setFavQuery] = useState("");

  // ---------- Lista de Orçamentos salvos ----------
  const [orcamentos, setOrcamentos] = useState([]); // [{id, name, createdAt, ...state básico}]
  const [orcQuery, setOrcQuery] = useState("");

  // ---------- Logo ----------
  const [logoDataURL, setLogoDataURL] = useState(null);
  const logoInputRef = useRef();

  // ---------- Effects: carregar localStorage e Firebase ----------
  useEffect(() => {
    // localStorage
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw));
      const orcRaw = localStorage.getItem(ORCS_KEY);
      if (orcRaw) setOrcamentos(JSON.parse(orcRaw));
      const favRaw = localStorage.getItem(FAV_KEY);
      if (favRaw) setFavoritos(JSON.parse(favRaw));
      const catRaw = localStorage.getItem(CATA_KEY);
      if (catRaw) setCatalogo(JSON.parse(catRaw));
      const l = localStorage.getItem(LOGO_KEY);
      if (l) setLogoDataURL(l);
      const lgpd = localStorage.getItem("lgpdAccepted-v1");
      setLgpdAccepted(!!lgpd);
    } catch {}
    // firebase auth
    try {
      ensureFirebase();
      onAuthStateChanged(getAuth(), async (u) => {
        setUser(u || null);
        setSyncStatus(u ? "online" : "offline");
        if (u) {
          // Carregar dados remotos (orcamentos, favoritos, catalogo, logo)
          await syncDown(u.uid);
        }
      });
    } catch {}
  }, []);

  // salvar state local
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  // ---------- Toast ----------
  const pushToast = (msg, type = "success") => {
    try {
      clearTimeout(window.__toastTmr);
    } catch {}
    setToast({ msg, type });
    window.__toastTmr = setTimeout(() => setToast(null), 2200);
  };

  const authMsg = (code) => {
    switch (code) {
      case "auth/invalid-email":
        return "E-mail inválido.";
      case "auth/missing-email":
        return "Informe seu e-mail.";
      case "auth/missing-password":
        return "Informe sua senha.";
      case "auth/invalid-credential":
      case "auth/wrong-password":
        return "E-mail ou senha incorretos.";
      case "auth/user-not-found":
        return "Usuário não encontrado.";
      case "auth/email-already-in-use":
        return "Este e-mail já está cadastrado.";
      case "auth/too-many-requests":
        return "Muitas tentativas. Tente novamente mais tarde ou redefina a senha.";
      default:
        return "Falha de autenticação.";
    }
  };

  const offerReset = async (email) => {
    if (!email) {
      alert("Informe seu e-mail para redefinir.");
      return;
    }
    try {
      ensureFirebase();
      await sendPasswordResetEmail(getAuth(), email);
      pushToast("E-mail de redefinição enviado.");
    } catch (e) {
      alert(e?.message || "Falha ao enviar redefinição");
    }
  };

  // ---------- Computados ----------
  const computed = useMemo(() => {
    const materiais = state.materiais.map((m) => {
      const qtd = toNumber(m.qtd);
      const unit = toNumber(m.unit);
      return { ...m, qtdNum: qtd, unitNum: unit, total: qtd * unit };
    });

    const totalMateriais = materiais.reduce((acc, m) => acc + m.total, 0);
    const perda = toNumber(state.perdaPct) / 100; // 0-1
    const materiaisAjustados = totalMateriais * (1 + perda);

    const minutos = toNumber(state.minutosPorUnidade);
    const maoObraMin = toNumber(state.maoDeObraPorMin);
    const fixoMin = toNumber(state.custoFixoPorMin);

    const custoMaoObra = minutos * maoObraMin;
    const custoFixo = minutos * fixoMin;

    const custoParcial = materiaisAjustados + custoMaoObra + custoFixo;

    const lucro = toNumber(state.lucroPct) / 100;
    const precoSemTaxas = custoParcial * (1 + lucro);

    const taxa = toNumber(state.taxaPct) / 100;
    const precoFinal = 1 - taxa === 0 ? NaN : precoSemTaxas / (1 - taxa);

    const validacoes = [];
    if (taxa >= 1) validacoes.push("A taxa não pode ser 100%.");
    if (perda < 0) validacoes.push("% de perda não pode ser negativa.");
    if (lucro < 0) validacoes.push("% de lucro não pode ser negativa.");
    if (minutos < 0) validacoes.push("Minutos por unidade não pode ser negativo.");

    return {
      materiais,
      totalMateriais,
      perda,
      materiaisAjustados,
      minutos,
      maoObraMin,
      fixoMin,
      custoMaoObra,
      custoFixo,
      custoParcial,
      lucro,
      precoSemTaxas,
      taxa,
      precoFinal,
      validacoes,
    };
  }, [state]);

  // ---------- Ações: materiais (editor) ----------
  const addMaterial = () => {
    const nextId = (state.materiais.at(-1)?.id || 0) + 1;
    setState((s) => ({
      ...s,
      materiais: [
        ...s.materiais,
        { id: nextId, descricao: "", qtd: "", unit: "", fav: false },
      ],
    }));
  };
  const removeMaterial = (id) =>
    setState((s) => ({
      ...s,
      materiais: s.materiais.filter((m) => m.id !== id),
    }));
  const updateMaterial = (id, patch) =>
    setState((s) => ({
      ...s,
      materiais: s.materiais.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));

  const toggleFav = (id) => {
    const item = state.materiais.find((m) => m.id === id);
    if (!item) return;
    const fav = { descricao: item.descricao, unit: String(item.unit) };
    const exists = favoritos.some(
      (f) =>
        f.descricao.trim().toLowerCase() ===
          fav.descricao.trim().toLowerCase() && String(f.unit) === String(fav.unit)
    );
    let next;
    if (exists) {
      next = favoritos.filter(
        (f) =>
          !(
            f.descricao.trim().toLowerCase() ===
              fav.descricao.trim().toLowerCase() &&
            String(f.unit) === String(fav.unit)
          )
      );
      pushToast("Removido dos favoritos.");
    } else {
      next = [fav, ...favoritos];
      pushToast("Adicionado aos favoritos.");
    }
    setFavoritos(next);
    persistFavoritos(next);
  };

  const persistFavoritos = async (next) => {
    setFavoritos(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {}
    // sync firestore
    if (user && fbDb) {
      try {
        await setDoc(doc(fbDb, "users", user.uid), { updatedAt: Date.now() }, { merge: true });
        await setDoc(doc(fbDb, "users", user.uid, "meta", "favoritos"), { lista: next });
      } catch {}
    }
  };

  const clearFavoritos = async () => {
    const ok = window.confirm("Limpar todos
