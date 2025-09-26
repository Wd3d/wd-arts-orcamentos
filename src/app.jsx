import React, { useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// ===== Firebase (sync entre dispositivos) =====
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  deleteUser,
} from "firebase/auth";
import {
  getFirestore,
  enableIndexedDbPersistence,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  addDoc,
  serverTimestamp,
  getDocs,
  writeBatch,
} from "firebase/firestore";

// ===== Config do Firebase (use o seu projeto) =====
const firebaseConfig = {
  apiKey: "AIzaSyAnQaV5BlIrB_7BBPkMes0f9dtqWSBU_fQ",
  authDomain: "add-app-web-8e2e1.firebaseapp.com",
  projectId: "add-app-web-8e2e1",
  storageBucket: "add-app-web-8e2e1.firebasestorage.app",
  messagingSenderId: "77808786670",
  appId: "1:77808786670:web:b0b741a66269991372e7ff",
  measurementId: "G-VZRD0CJNKB",
};
let fbApp = null, fbAuth = null, fbDb = null;
function ensureFirebase() {
  if (fbApp) return;
  if (!firebaseConfig?.apiKey) return;
  fbApp = initializeApp(firebaseConfig);
  fbAuth = getAuth(fbApp);
  fbDb = getFirestore(fbApp);
  enableIndexedDbPersistence(fbDb).catch(() => {});
}

// =============== COMPONENTE PRINCIPAL ===============
export default function CalculadoraPrecificacao() {
  // Helpers
  const brl = (n) => (Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—");
  const toNumber = (value) => {
    if (typeof value === "number") return value;
    if (value === null || value === undefined) return 0;
    const s = String(value).trim().replaceAll(" ", "").replaceAll(" ", "").replaceAll(",", ".");
    const n = parseFloat(s);
    return Number.isNaN(n) ? 0 : n;
  };

  const initial = {
    // Metadados do orçamento (aparecem no PDF)
    orcamentoNome: "",
    clienteNome: "",
    clienteContato: "",
    quantidade: "1",
    validadeDias: "7",
    prazoEntrega: "",
    condicoesPagamento: "",
    observacoes: "",
    logoDataUrl: "", // base64 da logo

    // Itens (favoritar por item)
    materiais: [{ id: 1, descricao: "", qtd: "", unit: "", fav: false }],

    // Parâmetros (uso interno; mantidos ocultos no PDF)
    perdaPct: "", // %
    minutosPorUnidade: "",
    maoDeObraPorMin: "",
    custoFixoPorMin: "",
    lucroPct: "",
    taxaPct: "", // taxa de marketplace/gateway

    // Técnicos para salvar/abrir
    _id: undefined,
    _savedAt: undefined,
  };

  const STORAGE_KEY = "precificacao-v3";
  const FAV_KEY = "materiaisFavoritos-v1";
  const ORCS_KEY = "orcamentosSalvos-v1";
  const CATA_KEY = "catalogoMateriais-v1";

  const [state, setState] = useState(initial);
  const [favoritos, setFavoritos] = useState([]);
  const [orcamentos, setOrcamentos] = useState([]);
  const [mostrarLista, setMostrarLista] = useState(false);
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState("updated_desc");

  // Gestor de materiais
  const [mostrarGestor, setMostrarGestor] = useState(false);
  const [catalogo, setCatalogo] = useState([]);
  const [catBusca, setCatBusca] = useState("");
  const [catForm, setCatForm] = useState({ nome: "", unidade: "", quantidade: "", preco: "", obs: "" });
  const [editCatId, setEditCatId] = useState(null);
  const [editCatData, setEditCatData] = useState({ nome: "", unidade: "", quantidade: "", preco: "", obs: "" });

  // Auth/sync
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState("offline"); // offline | syncing | online
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin"); // signin | signup
  const [authEmail, setAuthEmail] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [signupPass2, setSignupPass2] = useState("");
  const [signupLogoDataUrl, setSignupLogoDataUrl] = useState("");

  // LGPD / Política de Privacidade
  const [lgpdAccepted, setLgpdAccepted] = useState(false);
  const [lgpdShowModal, setLgpdShowModal] = useState(false);

  // Menu do usuário (dropdown)
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const logoFileRef = useRef(null);

  // PWA
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstallable, setIsInstallable] = useState(false);

  // Toast
  const [toast, setToast] = useState(null);
  const pushToast = (msg, type = "success") => {
    try { clearTimeout(window.__toastTmr); } catch {}
    setToast({ msg, type });
    window.__toastTmr = setTimeout(() => setToast(null), 2200);
  };

  // Mensagens amigáveis para erros de Auth
  const authMsg = (code) => {
    switch (code) {
      case 'auth/invalid-email': return 'E‑mail inválido.';
      case 'auth/missing-email': return 'Informe seu e‑mail.';
      case 'auth/missing-password': return 'Informe sua senha.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password': return 'E‑mail ou senha incorretos.';
      case 'auth/user-not-found': return 'Usuário não encontrado.';
      case 'auth/email-already-in-use': return 'Este e‑mail já está cadastrado.';
      case 'auth/too-many-requests': return 'Muitas tentativas. Tente novamente mais tarde ou redefina a senha.';
      default: return 'Falha de autenticação.';
    }
  };
  const offerReset = async (email) => {
    if (!email) { alert('Informe seu e‑mail para redefinir.'); return; }
    try { ensureFirebase(); await sendPasswordResetEmail(getAuth(), email); pushToast('E‑mail de redefinição enviado.'); }
    catch (e) { alert(e?.message || 'Falha ao enviar redefinição'); }
  };

  // ===== LocalStorage =====
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY); if (raw) setState(JSON.parse(raw));
      const favRaw = localStorage.getItem(FAV_KEY); if (favRaw) setFavoritos(JSON.parse(favRaw));
      const orcRaw = localStorage.getItem(ORCS_KEY); if (orcRaw) setOrcamentos(JSON.parse(orcRaw));
      const catRaw = localStorage.getItem(CATA_KEY); if (catRaw) setCatalogo(JSON.parse(catRaw));
      const lgpd = localStorage.getItem("lgpdAccepted-v1"); setLgpdAccepted(!!lgpd);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} }, [state]);

  const persistFavoritos = (next) => { setFavoritos(next); try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch {} };
  const persistOrcamentos = (next) => { setOrcamentos(next); try { localStorage.setItem(ORCS_KEY, JSON.stringify(next)); } catch {} };
  const persistCatalogo = (next) => { setCatalogo(next); try { localStorage.setItem(CATA_KEY, JSON.stringify(next)); } catch {} };

  // LGPD helpers
  const acceptLGPD = () => { setLgpdAccepted(true); try { localStorage.setItem("lgpdAccepted-v1", "1"); } catch {} setLgpdShowModal(false); };

  // Exclusão com 3 etapas (dupla confirmação + digitar EXCLUIR)
  const confirmDeleteAccount = async () => {
    const ok1 = window.confirm('Tem certeza que deseja excluir permanentemente a sua conta?');
    if (!ok1) return;
    const ok2 = window.confirm('Confirma novamente: essa ação é IRREVERSÍVEL e todos os dados vinculados à conta podem ser removidos.');
    if (!ok2) return;
    const typed = window.prompt('Para confirmar, digite EXCLUIR:');
    if ((typed || '').trim().toUpperCase() !== 'EXCLUIR') { alert('Texto incorreto. Operação cancelada.'); return; }
    try {
      ensureFirebase();
      const u = getAuth().currentUser;
      if (!u) return;
      await deleteUser(u);
      pushToast('Conta excluída.');
    } catch (e) {
      if (e?.code === 'auth/requires-recent-login') { alert('Por segurança, faça login novamente e tente excluir a conta.'); }
      else { alert(e?.message || 'Falha ao excluir a conta'); }
    }
  };

  // ===== Auth e sync Firestore =====
  useEffect(() => {
    try {
      ensureFirebase();
      if (!fbAuth) return;
      setSyncStatus("syncing");
      const unsub = onAuthStateChanged(fbAuth, (u) => {
        setUser(u || null);
        if (!u) setSyncStatus("offline");
      });
      return () => unsub && unsub();
    } catch {}
  }, []);

  useEffect(() => {
    if (!user || !fbDb) return;
    setSyncStatus("syncing");

    const unsubA = onSnapshot(collection(fbDb, "users", user.uid, "orcamentos"), (snap) => {
      setOrcamentos(snap.docs.map((d) => d.data()));
      setSyncStatus("online");
    });
    const unsubB = onSnapshot(collection(fbDb, "users", user.uid, "favoritos"), (snap) => {
      setFavoritos(snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })));
    });
    const unsubC = onSnapshot(collection(fbDb, "users", user.uid, "catalogo"), (snap) => {
      setCatalogo(snap.docs.map((d) => d.data()));
    });
    // Perfil (logo enviada no cadastro)
    const profileRef = doc(fbDb, 'users', user.uid, 'meta', 'profile');
    const unsubP = onSnapshot(profileRef, (d) => {
      if (d.exists()) {
        const lg = d.data()?.logoDataUrl;
        if (lg) setState((s) => ({ ...s, logoDataUrl: lg }));
      }
    });

    return () => { unsubA(); unsubB(); unsubC(); unsubP(); };
  }, [user]);

  // ===== Service Worker & Install PWA / Outside-click para menu =====
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);
  useEffect(() => {
    const onBeforeInstall = (e) => { e.preventDefault(); setDeferredPrompt(e); setIsInstallable(true); };
    const onInstalled = () => setIsInstallable(false);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onBeforeInstall); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  const instalarApp = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; setDeferredPrompt(null); setIsInstallable(false); };

  useEffect(() => {
    const onDocClick = (e) => {
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [userMenuOpen]);

  // ===== Cálculos =====
  const computed = useMemo(() => {
    const materiais = state.materiais.map((m) => {
      const qtd = toNumber(m.qtd);
      const unit = toNumber(m.unit);
      const total = qtd * unit;
      return { ...m, qtdNum: qtd, unitNum: unit, total };
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
    const precoFinal = (1 - taxa) === 0 ? NaN : precoSemTaxas / (1 - taxa);

    const quantidade = Math.max(1, Math.floor(toNumber(state.quantidade)) || 1);
    const totalGeral = Number.isFinite(precoFinal) ? precoFinal * quantidade : NaN;

    const validacoes = [];
    if (taxa >= 1) validacoes.push("A taxa não pode ser 100%.");
    if (perda < 0) validacoes.push("% de perda não pode ser negativa.");

    return { materiais, totalMateriais, perda, materiaisAjustados, minutos, custoMaoObra, custoFixo, custoParcial, precoSemTaxas, taxa, precoFinal, quantidade, totalGeral, validacoes };
  }, [state]);

  // ===== Materiais =====
  // Reset preservando a logo
  const resetar = () => setState((s) => ({ ...initial, logoDataUrl: s.logoDataUrl }));
  const addMaterial = () => {
    const nextId = (state.materiais.at(-1)?.id || 0) + 1;
    setState((s) => ({ ...s, materiais: [...s.materiais, { id: nextId, descricao: "", qtd: "", unit: "", fav: false }] }));
  };
  const removeMaterial = (id) => setState((s) => ({ ...s, materiais: s.materiais.filter((m) => m.id !== id) }));
  const updateMaterial = (id, patch) => setState((s) => ({ ...s, materiais: s.materiais.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

  // ===== Favoritos =====
  const [favoritosDocs, setFavoritosDocs] = useState([]);
  const toggleFavorito = async (mat) => {
    const desc = (mat.descricao || "").trim();
    const current = favoritos.find((f) => (f.descricao || "").trim() === desc);

    if (user && fbDb) {
      try {
        if (current?.id) await deleteDoc(doc(fbDb, "users", user.uid, "favoritos", current.id));
        else await addDoc(collection(fbDb, "users", user.uid, "favoritos"), { descricao: desc, unitPadrao: toNumber(mat.unit), createdAt: serverTimestamp() });
      } catch {}
      updateMaterial(mat.id, { fav: !current });
      pushToast(current ? "Removido dos favoritos." : "Adicionado aos favoritos.");
      return;
    }
    let next;
    if (current) next = favoritos.filter((f) => (f.descricao || "").trim() !== desc);
    else next = [...favoritos, { descricao: desc, unitPadrao: toNumber(mat.unit) }];
    setFavoritos(next); try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch {}
    updateMaterial(mat.id, { fav: !current });
    pushToast(current ? "Removido dos favoritos." : "Adicionado aos favoritos.");
  };
  const addFromFavorito = (fav) => {
    const nextId = (state.materiais.at(-1)?.id || 0) + 1;
    setState((s) => ({ ...s, materiais: [...s.materiais, { id: nextId, descricao: fav.descricao, qtd: "", unit: String(fav.unitPadrao ?? ""), fav: true }] }));
  };
  const limparFavoritos = async () => {
    const ok = window.confirm("Deseja realmente limpar TODOS os favoritos?");
    if (!ok) return;
    if (user && fbDb) {
      try {
        const snap = await getDocs(collection(fbDb, "users", user.uid, "favoritos"));
        const batch = writeBatch(fbDb);
        snap.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      } catch {}
    }
    setFavoritos([]); try { localStorage.setItem(FAV_KEY, JSON.stringify([])); } catch {}
    pushToast("Favoritos excluídos.");
  };

  // ===== Salvar / Abrir / Excluir orçamentos =====
  const salvarOrcamento = async () => {
    if (state._id && orcamentos.some((o) => o._id === state._id)) {
      const ok = window.confirm("Atualizar este orçamento existente? Para criar um novo, use 'Salvar como novo'.");
      if (!ok) return;
    }
    const id = state._id || `${Date.now()}`;
    const payload = { ...state, _id: id, _savedAt: new Date().toISOString() };
    const exists = orcamentos.some((o) => o._id === id);

    if (user && fbDb) {
      try { await setDoc(doc(fbDb, "users", user.uid, "orcamentos", id), payload); } catch {}
      setState((s) => ({ ...s, _id: id }));
      pushToast(exists ? "Orçamento atualizado (nuvem)!" : "Orçamento salvo (nuvem)!");
      return;
    }
    const next = exists ? orcamentos.map((o) => (o._id === id ? payload : o)) : [payload, ...orcamentos];
    setOrcamentos(next); try { localStorage.setItem(ORCS_KEY, JSON.stringify(next)); } catch {}
    setState((s) => ({ ...s, _id: id }));
    pushToast(exists ? "Orçamento atualizado!" : "Orçamento salvo!");
  };
  const salvarComoNovo = async () => {
    const id = `${Date.now()}`;
    const payload = { ...state, _id: id, _savedAt: new Date().toISOString() };
    if (user && fbDb) { try { await setDoc(doc(fbDb, "users", user.uid, "orcamentos", id), payload); } catch {} setState((s) => ({ ...s, _id: id })); pushToast("Orçamento salvo como novo (nuvem)!"); return; }
    const next = [payload, ...orcamentos]; setOrcamentos(next); try { localStorage.setItem(ORCS_KEY, JSON.stringify(next)); } catch {} setState((s) => ({ ...s, _id: id })); pushToast("Orçamento salvo como novo!");
  };
  const carregarOrcamento = (id) => { const found = orcamentos.find((o) => o._id === id); if (found) setState(found); setMostrarLista(false); setMostrarGestor(false); };
  const excluirOrcamento = async (id) => {
    if (!window.confirm("Excluir este orçamento?")) return;
    if (user && fbDb) { try { await deleteDoc(doc(fbDb, "users", user.uid, "orcamentos", id)); } catch {} if (state._id === id) resetar(); pushToast("Orçamento excluído."); return; }
    const next = orcamentos.filter((o) => o._id !== id); setOrcamentos(next); try { localStorage.setItem(ORCS_KEY, JSON.stringify(next)); } catch {} if (state._id === id) resetar(); pushToast("Orçamento excluído.");
  };

  // ===== Gestor de Materiais (catálogo) =====
  const addFromCatalog = (item) => {
    const nextId = (state.materiais.at(-1)?.id || 0) + 1;
    setState((s) => ({
      ...s,
      materiais: [
        ...s.materiais,
        { id: nextId, descricao: item.nome, qtd: String(item.quantidade ?? ""), unit: String(item.preco ?? ""), fav: false },
      ],
    }));
    pushToast("Material adicionado ao orçamento.");
  };
  const salvarMaterialCatalogo = async () => {
    const nome = (catForm.nome || "").trim();
    if (!nome) { alert("Informe o nome do material"); return; }
    const novo = {
      id: `${Date.now()}`,
      nome,
      unidade: (catForm.unidade || "").trim(),
      quantidade: toNumber(catForm.quantidade),
      preco: toNumber(catForm.preco),
      obs: (catForm.obs || "").trim(),
      createdAt: new Date().toISOString(),
    };
    if (user && fbDb) { try { await setDoc(doc(fbDb, "users", user.uid, "catalogo", novo.id), novo); } catch {} }
    const next = [novo, ...catalogo]; setCatalogo(next); try { localStorage.setItem(CATA_KEY, JSON.stringify(next)); } catch {}
    setCatForm({ nome: "", unidade: "", quantidade: "", preco: "", obs: "" });
    pushToast("Material cadastrado.");
  };
  const removerMaterialCatalogo = async (id) => {
    if (!window.confirm("Excluir este material do catálogo?")) return;
    if (user && fbDb) { try { await deleteDoc(doc(fbDb, "users", user.uid, "catalogo", id)); } catch {} }
    const next = catalogo.filter((c) => c.id !== id); setCatalogo(next); try { localStorage.setItem(CATA_KEY, JSON.stringify(next)); } catch {}
    pushToast("Material excluído.");
  };
  const iniciarEdicaoMaterial = (item) => { setEditCatId(item.id); setEditCatData({ nome: item.nome || "", unidade: item.unidade || "", quantidade: String(item.quantidade ?? ""), preco: String(item.preco ?? ""), obs: item.obs || "" }); };
  const cancelarEdicaoMaterial = () => { setEditCatId(null); setEditCatData({ nome: "", unidade: "", quantidade: "", preco: "", obs: "" }); };
  const salvarEdicaoMaterial = async () => {
    if (!editCatId) return;
    const patch = { ...editCatData, preco: toNumber(editCatData.preco), quantidade: toNumber(editCatData.quantidade) };
    if (user && fbDb) { try { await setDoc(doc(fbDb, "users", user.uid, "catalogo", editCatId), { ...(catalogo.find(c=>c.id===editCatId) || {}), ...patch, id: editCatId }); } catch {} }
    const next = catalogo.map((c) => (c.id === editCatId ? { ...c, ...patch } : c)); setCatalogo(next); try { localStorage.setItem(CATA_KEY, JSON.stringify(next)); } catch {}
    cancelarEdicaoMaterial();
    pushToast("Material atualizado.");
  };
  const catLista = useMemo(() => {
    let arr = [...catalogo];
    const b = (catBusca || "").toString().toLowerCase();
    if (b) arr = arr.filter(c => (c.nome || "").toLowerCase().includes(b) || (c.unidade || "").toLowerCase().includes(b) || (c.obs || "").toLowerCase().includes(b));
    arr.sort((a,b)=> (a.nome||"").localeCompare(b.nome||""));
    return arr;
  }, [catalogo, catBusca]);

  // ===== PDF =====
  const mm = (v) => v * 2.83465; // 1 mm = 2.83465 pt
  const buildPDF = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 48; let y = 56;

    // Logo (1,5 cm) no topo esquerdo
    const hasLogo = !!state.logoDataUrl;
    const logoSize = mm(15);
    if (hasLogo) { try { const fmt = state.logoDataUrl.startsWith("data:image/jpeg")?"JPEG":"PNG"; doc.addImage(state.logoDataUrl, fmt, marginX, y, logoSize, logoSize, undefined, "FAST"); } catch {} }

    // Título + cliente
    doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    const titleX = marginX + (hasLogo ? (logoSize + 12) : 0);
    doc.text(`Orçamento — ${state.orcamentoNome || "(sem nome)"}`, titleX, y + 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    if (state.clienteNome) { doc.text(`Cliente: ${state.clienteNome}`, titleX, y + 28); }

    y += hasLogo ? (logoSize + 10) : 30;

    // Dados do cliente
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Dados do cliente", marginX, y); y += 14;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    doc.text(`Nome: ${state.clienteNome || "—"}`, marginX, y); y += 14;
    if (state.clienteContato) { doc.text(`Contato: ${state.clienteContato}`, marginX, y); y += 14; }
    doc.text(`Quantidade: ${computed.quantidade}`, marginX, y); y += 18;

    // Itens – embute a perda nos preços unitários
    const perdaFactor = 1 + (computed.perda || 0);
    const linhas = computed.materiais
      .filter((m) => (m.descricao || "").trim() !== "")
      .map((m) => {
        const unitAdj = m.unitNum * perdaFactor;
        const totalAdj = m.qtdNum * unitAdj;
        return [m.descricao, String(m.qtdNum), brl(unitAdj), brl(totalAdj)];
      });

    autoTable(doc, {
      startY: y,
      head: [["Descrição", "Qtd usada", "Valor unit (R$)", "Valor usado (R$)"]],
      body: linhas.length ? linhas : [["—", "—", "—", "—"]],
      theme: "grid",
      styles: { font: "helvetica", fontSize: 10, cellPadding: 4 },
      headStyles: { fillColor: [0,0,0], textColor: [255,255,255] },
      margin: { left: marginX, right: marginX }
    });

    y = (doc.lastAutoTable?.finalY || y) + 10;

    // Totais (sem expor infos internas)
    doc.setFont("helvetica", "normal");
    doc.text(`Subtotal materiais: ${brl(computed.materiaisAjustados)}`, marginX, y); y += 14;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text(`Preço unitário: ${Number.isFinite(computed.precoFinal) ? brl(computed.precoFinal) : "—"}`, marginX, y); y += 18;
    doc.text(`Total para ${computed.quantidade} un.: ${Number.isFinite(computed.totalGeral) ? brl(computed.totalGeral) : "—"}`, marginX, y); y += 22;

    // Observações/condições
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    if (state.prazoEntrega) { doc.text(`Prazo de entrega: ${state.prazoEntrega}`, marginX, y); y += 14; }
    if (state.condicoesPagamento) { doc.text(`Condições de pagamento: ${state.condicoesPagamento}`, marginX, y); y += 14; }
    if (state.validadeDias) { doc.text(`Validade deste orçamento: ${state.validadeDias} dias`, marginX, y); y += 14; }
    if (state.observacoes) { const obs = doc.splitTextToSize(`Observações: ${state.observacoes}`, 500); doc.text(obs, marginX, y); y += obs.length * 12 + 4; }

    const nomeArquivo = (state.orcamentoNome || "wd-arts").trim().replaceAll(" ", "-").toLowerCase();
    return { doc, nomeArquivo };
  };
  const gerarPDF = () => { const { doc, nomeArquivo } = buildPDF(); doc.save(`orcamento-${nomeArquivo}.pdf`); };
  const compartilharPDF = async () => {
    try {
      const { doc, nomeArquivo } = buildPDF();
      const blob = doc.output("blob");
      const file = new File([blob], `orcamento-${nomeArquivo}.pdf`, { type: "application/pdf" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Orçamento", text: state.orcamentoNome ? `Orçamento: ${state.orcamentoNome}` : "" });
      } else { const url = URL.createObjectURL(blob); window.open(url, "_blank"); }
    } catch { const { doc } = buildPDF(); const blob = doc.output("blob"); const url = URL.createObjectURL(blob); window.open(url, "_blank"); }
  };

  // Troca de logo pelo menu do usuário
  const openLogoPicker = () => logoFileRef.current?.click();
  const onLogoFileChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = String(ev.target?.result || "");
      setState((s) => ({ ...s, logoDataUrl: dataUrl }));
      try {
        if (user && fbDb) {
          await setDoc(doc(fbDb, 'users', user.uid, 'meta', 'profile'), { logoDataUrl: dataUrl, updatedAt: serverTimestamp() });
          pushToast('Logo atualizada.');
        }
      } catch {}
    };
    reader.readAsDataURL(f);
    e.target.value = '';
  };

  // ===== Derivados =====
  const norm = (s) => (s ?? "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const orcLista = useMemo(() => {
    let arr = [...orcamentos];
    if (busca.trim()) { const b = norm(busca); arr = arr.filter((o) => norm(o.orcamentoNome).includes(b) || norm(o.clienteNome).includes(b)); }
    switch (ordem) {
      case "updated_asc": arr.sort((a,b)=> new Date(a._savedAt || a._id) - new Date(b._savedAt || b._id)); break;
      case "nome": arr.sort((a,b)=> norm(a.orcamentoNome).localeCompare(norm(b.orcamentoNome))); break;
      case "cliente": arr.sort((a,b)=> norm(a.clienteNome).localeCompare(norm(b.clienteNome))); break;
      default: arr.sort((a,b)=> new Date(b._savedAt || b._id) - new Date(a._savedAt || a._id));
    }
    return arr;
  }, [orcamentos, busca, ordem]);

  // ===== UI =====
  return (
    <div className="min-h-screen bg-neutral-50 py-8">
      <div className="mx-auto max-w-6xl px-4">
        {/* Cabeçalho minimal */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Calculadora de Precificação</h1>
            <p className="text-sm text-neutral-600">Gere PDFs de orçamento sem expor custos internos.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setMostrarLista(false); setMostrarGestor(false); }} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Edição</button>
            <button onClick={() => setMostrarLista(true)} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Meus orçamentos</button>
            <button onClick={() => setMostrarGestor(true)} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Gestor de materiais</button>
            {user ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                  className="h-12 w-12 overflow-hidden rounded-full border border-neutral-300 bg-white shadow-sm hover:opacity-90"
                  title="Conta"
                >
                  {state.logoDataUrl ? (
                    <img src={state.logoDataUrl} alt="Logo" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-sm text-neutral-500">👤</div>
                  )}
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-neutral-200 bg-white p-1 shadow-xl">
                    <button onClick={openLogoPicker} className="w-full rounded-xl px-3 py-2 text-left hover:bg-neutral-100">Trocar logo</button>
                    <button onClick={() => { setUserMenuOpen(false); confirmDeleteAccount(); }} className="w-full rounded-xl px-3 py-2 text-left text-red-600 hover:bg-red-50">Excluir conta</button>
                    <button onClick={async()=>{ try{ if(authPass !== signupPass2){ alert('As senhas não conferem.'); return; } ensureFirebase(); const cred = await createUserWithEmailAndPassword(getAuth(), authEmail, authPass); if (signupLogoDataUrl) { try { await setDoc(doc(fbDb, 'users', cred.user.uid, 'meta', 'profile'), { logoDataUrl: signupLogoDataUrl, updatedAt: serverTimestamp() }); setState((s)=> ({...s, logoDataUrl: signupLogoDataUrl})); } catch {} } setAuthOpen(false); setSignupPass2(""); pushToast('Conta criada.'); }catch(e){ const code = e?.code || ''; if(code==='auth/email-already-in-use'){ const goSignIn = window.confirm('Este e‑mail já está cadastrado. Deseja entrar com ele?'); if(goSignIn){ setAuthMode('signin'); } else { const send = window.confirm('Deseja enviar e‑mail de redefinição de senha para este endereço?'); if(send) await offerReset(authEmail); } } else { alert(authMsg(code)); } } }} className="flex-1 rounded-2xl bg-black px-4 py-2 text-white">Criar conta</button>
                )}
                <button onClick={()=> setAuthMode(authMode === "signin" ? "signup" : "signin")} className="rounded-2xl border border-neutral-300 px-4 py-2">{authMode === "signin" ? "Criar conta" : "Já tenho conta"}</button>
              </div>
              <p className="mt-3 text-xs text-neutral-500">No cadastro pedimos sua logo (opcional). Você pode alterar depois pelo suporte.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============== INPUTS ===============
function LabeledInput({ label, prefix, suffix, value, onChange, placeholder, inputMode, type = "text", name, autoComplete, onKeyDown, autoFocus }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-800">{label}</span>
      <div className="flex items-stretch overflow-hidden rounded-xl border border-neutral-300 focus-within:ring-2 focus-within:ring-black/20">
        {prefix && <span className="flex items-center px-3 text-neutral-500">{prefix}</span>}
        <input
          type={type}
          name={name}
          autoComplete={autoComplete}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          className="min-w-0 flex-1 bg-white px-3 py-2 outline-none"
        />
        {suffix && <span className="flex items-center px-3 text-neutral-500">{suffix}</span>}
      </div>
    </label>
  );
}

function LabeledTextarea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-800">{label}</span>
      <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-h-[80px] w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"></textarea>
    </label>
  );
}
