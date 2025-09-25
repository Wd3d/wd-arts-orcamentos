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
  if (!firebaseConfig.apiKey) return;
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
  };

  const STORAGE_KEY = "precificacao-v2";
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
  const [catForm, setCatForm] = useState({ nome: "", unidade: "", preco: "", obs: "" });
  const [editCatId, setEditCatId] = useState(null);
  const [editCatData, setEditCatData] = useState({ nome: "", unidade: "", preco: "", obs: "" });

  // Auth/sync
  const [user, setUser] = useState(null);
  const [syncStatus, setSyncStatus] = useState("offline"); // offline | syncing | online
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin"); // signin | signup
  const [authEmail, setAuthEmail] = useState("");
  const [authPass, setAuthPass] = useState("");

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

  // ====== Logo no header (50px circular, clicável) ======
  const logoInputRef = useRef(null);
  const openLogoPicker = () => logoInputRef?.current?.click();
  const onLogoUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setState((s) => ({ ...s, logoDataUrl: String(e.target?.result || "") }));
    reader.readAsDataURL(file);
  };

  // ===== LocalStorage =====
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY); if (raw) setState(JSON.parse(raw));
      const favRaw = localStorage.getItem(FAV_KEY); if (favRaw) setFavoritos(JSON.parse(favRaw));
      const orcRaw = localStorage.getItem(ORCS_KEY); if (orcRaw) setOrcamentos(JSON.parse(orcRaw));
      const catRaw = localStorage.getItem(CATA_KEY); if (catRaw) setCatalogo(JSON.parse(catRaw));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [state]);

  const persistFavoritos = (next) => { setFavoritos(next); try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch {} };
  const persistOrcamentos = (next) => { setOrcamentos(next); try { localStorage.setItem(ORCS_KEY, JSON.stringify(next)); } catch {} };
  const persistCatalogo = (next) => { setCatalogo(next); try { localStorage.setItem(CATA_KEY, JSON.stringify(next)); } catch {} };

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
    return () => { unsubA(); unsubB(); unsubC(); };
  }, [user]);

  // ===== Service Worker & Install PWA =====
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);
  useEffect(() => {
    const onBeforeInstall = (e) => { e.preventDefault(); setDeferredPrompt(e); setIsInstallable(true); };
    const onInstalled = () => setIsInstallable(false);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onBeforeInstall); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  const instalarApp = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; setDeferredPrompt(null); setIsInstallable(false); };

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
  const addMaterial = () => {
    const nextId = (state.materiais.at(-1)?.id || 0) + 1;
    setState((s) => ({ ...s, materiais: [...s.materiais, { id: nextId, descricao: "", qtd: "", unit: "", fav: false }] }));
  };
  const removeMaterial = (id) => setState((s) => ({ ...s, materiais: s.materiais.filter((m) => m.id !== id) }));
  const updateMaterial = (id, patch) => setState((s) => ({ ...s, materiais: s.materiais.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

  // ===== Favoritos =====
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
    persistFavoritos(next);
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
    persistFavoritos([]);
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
    persistOrcamentos(next);
    setState((s) => ({ ...s, _id: id }));
    pushToast(exists ? "Orçamento atualizado!" : "Orçamento salvo!");
  };
  const salvarComoNovo = async () => {
    const id = `${Date.now()}`;
    const payload = { ...state, _id: id, _savedAt: new Date().toISOString() };
    if (user && fbDb) {
      try { await setDoc(doc(fbDb, "users", user.uid, "orcamentos", id), payload); } catch {}
      setState((s) => ({ ...s, _id: id }));
      pushToast("Orçamento salvo como novo (nuvem)!");
      return;
    }
    persistOrcamentos([payload, ...orcamentos]);
    setState((s) => ({ ...s, _id: id }));
    pushToast("Orçamento salvo como novo!");
  };
  const carregarOrcamento = (id) => { const found = orcamentos.find((o) => o._id === id); if (found) setState(found); setMostrarLista(false); };
  const excluirOrcamento = async (id) => {
    if (!window.confirm("Excluir este orçamento?")) return;
    if (user && fbDb) {
      try { await deleteDoc(doc(fbDb, "users", user.uid, "orcamentos", id)); } catch {}
      if (state._id === id) setState(initial);
      pushToast("Orçamento excluído.");
      return;
    }
    const next = orcamentos.filter((o) => o._id !== id);
    persistOrcamentos(next);
    if (state._id === id) setState(initial);
    pushToast("Orçamento excluído.");
  };

  // ===== Gestor de Materiais (catálogo) =====
  const addFromCatalog = (item) => {
    const nextId = (state.materiais.at(-1)?.id || 0) + 1;
    setState((s) => ({ ...s, materiais: [...s.materiais, { id: nextId, descricao: item.nome, qtd: "", unit: String(item.preco ?? ""), fav: false }] }));
    pushToast("Material adicionado ao orçamento.");
  };
  const salvarMaterialCatalogo = async () => {
    const nome = (catForm.nome || "").trim();
    if (!nome) { alert("Informe o nome do material"); return; }
    const novo = { id: `${Date.now()}`, nome, unidade: (catForm.unidade || "").trim(), preco: toNumber(catForm.preco), obs: (catForm.obs || "").trim(), createdAt: new Date().toISOString() };
    if (user && fbDb) { try { await setDoc(doc(fbDb, "users", user.uid, "catalogo", novo.id), novo); } catch {} }
    persistCatalogo([novo, ...catalogo]);
    setCatForm({ nome: "", unidade: "", preco: "", obs: "" });
    pushToast("Material cadastrado.");
  };
  const removerMaterialCatalogo = async (id) => {
    if (!window.confirm("Excluir este material do catálogo?")) return;
    if (user && fbDb) { try { await deleteDoc(doc(fbDb, "users", user.uid, "catalogo", id)); } catch {} }
    persistCatalogo(catalogo.filter((c) => c.id !== id));
    pushToast("Material excluído.");
  };
  const iniciarEdicaoMaterial = (item) => { setEditCatId(item.id); setEditCatData({ nome: item.nome || "", unidade: item.unidade || "", preco: String(item.preco ?? ""), obs: item.obs || "" }); };
  const cancelarEdicaoMaterial = () => { setEditCatId(null); setEditCatData({ nome: "", unidade: "", preco: "", obs: "" }); };
  const salvarEdicaoMaterial = async () => {
    if (!editCatId) return;
    const patch = { ...editCatData, preco: toNumber(editCatData.preco) };
    if (user && fbDb) { try { await setDoc(doc(fbDb, "users", user.uid, "catalogo", editCatId), { ...(catalogo.find(c=>c.id===editCatId) || {}), ...patch, id: editCatId }); } catch {} }
    const next = catalogo.map((c) => (c.id === editCatId ? { ...c, ...patch } : c));
    persistCatalogo(next);
    cancelarEdicaoMaterial();
    pushToast("Material atualizado.");
  };
  const catLista = useMemo(() => {
    let arr = [...catalogo];
    const b = (catBusca || "").toString().toLowerCase();
    if (b) arr = arr.filter(c => (c.nome || "").toLowerCase().includes(b) || (c.unidade || "").toLowerCase().includes(b));
    arr.sort((a,b)=> (a.nome||"").localeCompare(b.nome||""));
    return arr;
  }, [catalogo, catBusca]);

  // ===== PDF =====
  const buildPDF = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 48; let y = 56;
    const mm = (v) => v * 2.83465; // 1 mm = 2.83465 pt

    // Logo (1,5 cm) no topo esquerdo
    const hasLogo = !!state.logoDataUrl;
    const logoSize = mm(15);
    if (hasLogo) { try { doc.addImage(state.logoDataUrl, "PNG", marginX, y, logoSize, logoSize, undefined, "FAST"); } catch {} }

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

  // ===== UI =====
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

  return (
    <div className="min-h-screen bg-neutral-50 py-8">
      <div className="mx-auto max-w-6xl px-4">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Calculadora de Precificação</h1>
            <p className="text-sm text-neutral-600">Preencha e gere o PDF do orçamento sem expor custos internos.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Avatar da logo 50px no header */}
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e)=> onLogoUpload(e.target.files?.[0])} />
            <button onClick={openLogoPicker} title="Editar logo" className="h-[50px] w-[50px] overflow-hidden rounded-full border border-neutral-300 bg-white shadow-sm">
              {state.logoDataUrl ? (
                <img src={state.logoDataUrl} alt="logo" className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center text-[10px] text-neutral-500">Logo</span>
              )}
            </button>

            {user ? (
              <>
                <span className="text-sm text-neutral-600">Conectado: <span className="font-medium">{user.email}</span> — <span className="italic">{syncStatus}</span></span>
                <button onClick={async()=>{ try{ ensureFirebase(); await fbSignOut(fbAuth); }catch{} }} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Sair</button>
              </>
            ) : (
              <button onClick={()=> setAuthOpen(true)} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Entrar</button>
            )}

            {(mostrarLista || mostrarGestor) ? (
              <button onClick={() => { setMostrarLista(false); setMostrarGestor(false); }} className="rounded-2xl bg-black px-4 py-2 text-white shadow-sm hover:bg-neutral-800">Voltar</button>
            ) : (
              <>
                <button onClick={salvarOrcamento} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Salvar orçamento</button>
                <button onClick={salvarComoNovo} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Salvar como novo</button>
                <button onClick={() => setMostrarLista(true)} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Meus orçamentos</button>
                <button onClick={() => setMostrarGestor(true)} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Gestor de materiais</button>
                <button onClick={gerarPDF} className="rounded-2xl bg-black px-4 py-2 text-white shadow-sm hover:bg-neutral-800">Gerar PDF</button>
                <button onClick={compartilharPDF} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Compartilhar PDF</button>
                {isInstallable && (<button onClick={instalarApp} className="rounded-2xl border border-green-300 bg-white px-4 py-2 text-green-700 shadow-sm hover:bg-green-50">Instalar app</button>)}
                <button onClick={()=> setState(initial)} className="rounded-2xl border border-red-300 bg-white px-4 py-2 text-red-600 shadow-sm hover:bg-red-50">Resetar</button>
              </>
            )}
          </div>
        </header>

        {/* Form principal oculto quando lista/gestor estiverem ativos */}
        {!mostrarLista && !mostrarGestor && (
          <>
            {/* Meta */}
            <section className="mb-6 grid gap-3 rounded-2xl bg-white p-4 shadow-sm md:grid-cols-2 lg:grid-cols-3">
              <LabeledInput label="Nome do orçamento / Projeto" value={state.orcamentoNome} onChange={(v) => setState((s) => ({ ...s, orcamentoNome: v }))} placeholder="Ex.: Lembrancinhas aniversário" />
              <LabeledInput label="Cliente" value={state.clienteNome} onChange={(v) => setState((s) => ({ ...s, clienteNome: v }))} placeholder="Nome do cliente" />
              <LabeledInput label="Contato (opcional)" value={state.clienteContato} onChange={(v) => setState((s) => ({ ...s, clienteContato: v }))} placeholder="WhatsApp / e-mail" />
              <LabeledInput label="Quantidade de unidades" value={state.quantidade} onChange={(v) => setState((s) => ({ ...s, quantidade: v }))} placeholder="1" inputMode="numeric" />
              <LabeledInput label="Validade do orçamento (dias)" value={state.validadeDias} onChange={(v) => setState((s) => ({ ...s, validadeDias: v }))} placeholder="7" inputMode="numeric" />
              <LabeledInput label="Prazo de entrega" value={state.prazoEntrega} onChange={(v) => setState((s) => ({ ...s, prazoEntrega: v }))} placeholder="Ex.: 5 a 7 dias úteis" />
              <LabeledInput label="Condições de pagamento" value={state.condicoesPagamento} onChange={(v) => setState((s) => ({ ...s, condicoesPagamento: v }))} placeholder="Pix / Cartão / 50% sinal" />
              <LabeledTextarea label="Observações (mostradas no PDF)" value={state.observacoes} onChange={(v) => setState((s) => ({ ...s, observacoes: v }))} placeholder="Ex.: Arte inclusa. Alterações após aprovação podem gerar custo adicional." />
            </section>

            {/* Materiais */}
            <section className="mb-8 rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Materiais</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm text-neutral-600">Favoritos:</div>
                  <div className="flex flex-wrap gap-2">
                    {favoritos.length === 0 && <span className="text-sm text-neutral-500">Nenhum favorito ainda</span>}
                    {favoritos.map((f, idx) => (
                      <button key={idx} onClick={() => addFromFavorito(f)} className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm hover:bg-neutral-100">{f.descricao}</button>
                    ))}
                    {favoritos.length > 0 && (
                      <button onClick={limparFavoritos} className="rounded-full border border-red-300 bg-white px-3 py-1 text-sm text-red-600 hover:bg-red-50">Limpar favoritos</button>
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-auto">
                <table className="w-full table-auto border-collapse">
                  <thead>
                    <tr className="bg-neutral-100 text-left text-sm">
                      <th className="p-2">ID</th>
                      <th className="p-2">Descrição</th>
                      <th className="p-2">Qtd usada</th>
                      <th className="p-2">Valor unit (R$)</th>
                      <th className="p-2">Valor usado (R$)</th>
                      <th className="p-2 text-center">Fav</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.materiais.map((m) => (
                      <tr key={m.id} className="border-b">
                        <td className="p-2 text-center text-sm text-neutral-600">{m.id}</td>
                        <td className="p-2">
                          <input value={m.descricao} onChange={(e) => updateMaterial(m.id, { descricao: e.target.value })} placeholder="Ex.: Papel A4 90g" className="w-full rounded-xl border border-neutral-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20" />
                        </td>
                        <td className="p-2">
                          <input value={m.qtd} onChange={(e) => updateMaterial(m.id, { qtd: e.target.value })} placeholder="0,00" inputMode="decimal" className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-right outline-none focus:ring-2 focus:ring-black/20" />
                        </td>
                        <td className="p-2">
                          <input value={m.unit} onChange={(e) => updateMaterial(m.id, { unit: e.target.value })} placeholder="0,00" inputMode="decimal" className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-right outline-none focus:ring-2 focus:ring-black/20" />
                        </td>
                        <td className="p-2 text-right font-medium">{brl(toNumber(m.qtd) * toNumber(m.unit))}</td>
                        <td className="p-2 text-center">
                          <button onClick={() => toggleFavorito(m)} className={`inline-flex items-center justify-center rounded-lg border px-2 py-2 ${m.fav ? "border-yellow-400 bg-yellow-50" : "border-neutral-300 bg-white"}`} title={m.fav ? "Remover dos favoritos" : "Adicionar aos favoritos"}>
                            {m.fav ? "★" : "☆"}
                          </button>
                        </td>
                        <td className="p-2 text-right">
                          <button onClick={() => removeMaterial(m.id)} className="rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100" aria-label={`Remover material ${m.id}`}>Remover</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="p-2 text-right font-semibold">CUSTO TOTAL DE MATERIAL</td>
                      <td className="p-2 text-right font-semibold">{brl(computed.totalMateriais)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="mt-3">
                <button onClick={addMaterial} className="w-full rounded-2xl bg-black px-4 py-2 text-white shadow-sm hover:bg-neutral-800">+ Material</button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <LabeledInput label="% de perda (desperdício/erro)" suffix="%" value={state.perdaPct} onChange={(v) => setState((s) => ({ ...s, perdaPct: v }))} placeholder="0,00" inputMode="decimal" />
              </div>
              <div className="mt-2 text-right text-sm text-neutral-600">Materiais ajustados: <span className="font-semibold">{brl(computed.materiaisAjustados)}</span></div>
            </section>

            {/* Produção — dados internos */}
            <section className="mb-8 rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold">Produção (por unidade) — dados internos</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <LabeledInput label="Minutos para produzir uma unidade" value={state.minutosPorUnidade} onChange={(v) => setState((s) => ({ ...s, minutosPorUnidade: v }))} placeholder="0" inputMode="numeric" />
                <LabeledInput label="Mão de obra (R$/min)" prefix="R$" value={state.maoDeObraPorMin} onChange={(v) => setState((s) => ({ ...s, maoDeObraPorMin: v }))} placeholder="0,00" inputMode="decimal" />
                <LabeledInput label="Custo fixo (R$/min)" prefix="R$" value={state.custoFixoPorMin} onChange={(v) => setState((s) => ({ ...s, custoFixoPorMin: v }))} placeholder="0,00" inputMode="decimal" />
              </div>
            </section>

            {/* Precificação */}
            <section className="mb-8 rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold">Precificação</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <LabeledInput label="% de lucro desejada" suffix="%" value={state.lucroPct} onChange={(v) => setState((s) => ({ ...s, lucroPct: v }))} placeholder="0,00" inputMode="decimal" />
                <LabeledInput label="% de taxa (marketplace/gateway)" suffix="%" value={state.taxaPct} onChange={(v) => setState((s) => ({ ...s, taxaPct: v }))} placeholder="0,00" inputMode="decimal" />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-neutral-200 p-4"><div className="mb-1 text-sm text-neutral-600">Valor parcial (custo total)</div><div className="text-xl font-semibold">{brl(computed.custoParcial)}</div></div>
                <div className="rounded-2xl border border-neutral-200 p-4"><div className="mb-1 text-sm text-neutral-600">Preço sem taxas</div><div className="text-xl font-semibold">{brl(computed.precoSemTaxas)}</div></div>
              </div>
              <div className="mt-4 rounded-2xl bg-black p-6 text-white shadow">
                <div className="text-sm/6 opacity-80">Preço unitário (com taxas)</div>
                <div className="mt-1 text-3xl font-extrabold tracking-tight">{Number.isNaN(computed.precoFinal) ? "—" : brl(computed.precoFinal)}</div>
              </div>
              <div className="mt-3 text-right text-sm text-neutral-700">Total para {computed.quantidade} un.: <span className="font-semibold">{Number.isFinite(computed.totalGeral) ? brl(computed.totalGeral) : "—"}</span></div>
              {computed.validacoes.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 rounded-2xl bg-red-50 p-3 pl-6 text-sm text-red-700">
                  {computed.validacoes.map((msg, i) => (<li key={i}>{msg}</li>))}
                </ul>
              )}
            </section>
          </>
        )}

        {/* Lista de orçamentos */}
        {mostrarLista && (
          <section className="mb-8 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">Meus orçamentos</h2>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome do orçamento ou cliente..." className="w-full max-w-sm rounded-xl border border-neutral-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20" />
              <select value={ordem} onChange={(e) => setOrdem(e.target.value)} className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20">
                <option value="updated_desc">Mais recentes</option>
                <option value="updated_asc">Mais antigos</option>
                <option value="nome">Nome do orçamento (A–Z)</option>
                <option value="cliente">Cliente (A–Z)</option>
              </select>
              <span className="text-sm text-neutral-500">{orcLista.length} resultado(s)</span>
            </div>
            {orcLista.length === 0 ? (
              <div className="text-sm text-neutral-500">Nenhum orçamento salvo ainda.</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full table-auto border-collapse text-sm">
                  <thead>
                    <tr className="bg-neutral-100 text-left">
                      <th className="p-2">Logo</th>
                      <th className="p-2">Nome</th>
                      <th className="p-2">Cliente</th>
                      <th className="p-2">Atualizado</th>
                      <th className="p-2 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orcLista.map((o) => (
                      <tr key={o._id} className="border-b">
                        <td className="p-2">
                          {o.logoDataUrl ? (
                            <img src={o.logoDataUrl} alt="logo" className="h-8 w-8 rounded-full object-cover border" />
                          ) : (
                            <div className="h-8 w-8 rounded-full border bg-neutral-100" />
                          )}
                        </td>
                        <td className="p-2">{o.orcamentoNome || "(sem nome)"}</td>
                        <td className="p-2">{o.clienteNome || "—"}</td>
                        <td className="p-2">{new Date(o._savedAt || o._id).toLocaleString("pt-BR")}</td>
                        <td className="p-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => carregarOrcamento(o._id)} className="rounded-xl border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100">Abrir</button>
                            <button onClick={() => excluirOrcamento(o._id)} className="rounded-xl border border-red-300 bg-white px-3 py-1 text-red-600 hover:bg-red-50">Excluir</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Gestor de materiais */}
        {mostrarGestor && (
          <section className="mb-8 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">Gestor de materiais</h2>
            {!user && <p className="mb-2 text-xs text-neutral-500">Dica: faça login para sincronizar seu catálogo entre dispositivos.</p>}

            <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <LabeledInput label="Nome" value={catForm.nome} onChange={(v)=> setCatForm(f=>({...f, nome:v}))} placeholder="Ex.: Papel A4 90g" />
              <LabeledInput label="Unidade" value={catForm.unidade} onChange={(v)=> setCatForm(f=>({...f, unidade:v}))} placeholder="Ex.: folha, metro, ml" />
              <LabeledInput label="Preço unitário (R$)" prefix="R$" value={catForm.preco} onChange={(v)=> setCatForm(f=>({...f, preco:v}))} placeholder="0,00" inputMode="decimal" />
              <LabeledInput label="Obs. (opcional)" value={catForm.obs} onChange={(v)=> setCatForm(f=>({...f, obs:v}))} placeholder="Marca, cor..." />
              <div className="sm:col-span-2 lg:col-span-4">
                <button onClick={salvarMaterialCatalogo} className="w-full rounded-2xl bg-black px-4 py-2 text-white shadow-sm hover:bg-neutral-800">Cadastrar material</button>
              </div>
            </div>

            <div className="mb-3 flex items-center gap-2">
              <input value={catBusca} onChange={(e)=> setCatBusca(e.target.value)} placeholder="Buscar material..." className="w-full max-w-sm rounded-xl border border-neutral-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20" />
              <span className="text-sm text-neutral-500">{catLista.length} item(ns)</span>
            </div>

            <div className="overflow-auto">
              <table className="w-full table-auto border-collapse text-sm">
                <thead>
                  <tr className="bg-neutral-100 text-left">
                    <th className="p-2">Nome</th>
                    <th className="p-2">Unidade</th>
                    <th className="p-2">Preço</th>
                    <th className="p-2">Obs.</th>
                    <th className="p-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {catLista.map((c)=> (
                    <tr key={c.id} className="border-b">
                      {editCatId === c.id ? (
                        <>
                          <td className="p-2"><input value={editCatData.nome} onChange={(e)=> setEditCatData(d=>({...d, nome:e.target.value}))} className="w-full rounded-xl border border-neutral-300 px-2 py-1" /></td>
                          <td className="p-2"><input value={editCatData.unidade} onChange={(e)=> setEditCatData(d=>({...d, unidade:e.target.value}))} className="w-full rounded-xl border border-neutral-300 px-2 py-1" /></td>
                          <td className="p-2"><input value={editCatData.preco} onChange={(e)=> setEditCatData(d=>({...d, preco:e.target.value}))} className="w-full rounded-xl border border-neutral-300 px-2 py-1 text-right" inputMode="decimal" /></td>
                          <td className="p-2"><input value={editCatData.obs} onChange={(e)=> setEditCatData(d=>({...d, obs:e.target.value}))} className="w-full rounded-xl border border-neutral-300 px-2 py-1" /></td>
                          <td className="p-2 text-right">
                            <div className="flex justify-end gap-2">
                              <button onClick={salvarEdicaoMaterial} className="rounded-xl border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100">Salvar</button>
                              <button onClick={cancelarEdicaoMaterial} className="rounded-xl border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100">Cancelar</button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-2">{c.nome}</td>
                          <td className="p-2">{c.unidade || "—"}</td>
                          <td className="p-2">{brl(toNumber(c.preco))}</td>
                          <td className="p-2">{c.obs || "—"}</td>
                          <td className="p-2 text-right">
                            <div className="flex justify-end gap-2">
                              <button onClick={()=> addFromCatalog(c)} className="rounded-xl border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100">Adicionar ao orçamento</button>
                              <button onClick={()=> iniciarEdicaoMaterial(c)} className="rounded-xl border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100">Editar</button>
                              <button onClick={()=> removerMaterialCatalogo(c.id)} className="rounded-xl border border-red-300 bg-white px-3 py-1 text-red-600 hover:bg-red-50">Excluir</button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  {catLista.length === 0 && (<tr><td className="p-3 text-neutral-500" colSpan={5}>Cadastre seus materiais para agilizar futuros orçamentos.</td></tr>)}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="text-center text-xs text-neutral-500">Dica: instale o app para usar offline. Faça login para sincronizar pela nuvem.</footer>

        {toast && (
          <div aria-live="polite" className="fixed bottom-4 right-4 z-50">
            <div className={`rounded-xl px-4 py-3 shadow-lg ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-neutral-800 text-white'}`}>
              {toast.msg}
            </div>
          </div>
        )}

        {/* Auth Modal */}
        {authOpen && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold">{authMode === "signin" ? "Entrar" : "Criar conta"}</h3>
                <button onClick={()=> setAuthOpen(false)} className="rounded-xl border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100">Fechar</button>
              </div>
              <label className="mb-2 block text-sm font-medium">E-mail</label>
              <input value={authEmail} onChange={(e)=> setAuthEmail(e.target.value)} type="email" placeholder="voce@exemplo.com" className="mb-3 w-full rounded-xl border border-neutral-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20" />
              <label className="mb-2 block text-sm font-medium">Senha</label>
              <input value={authPass} onChange={(e)=> setAuthPass(e.target.value)} type="password" placeholder="••••••••" className="mb-2 w-full rounded-xl border border-neutral-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20" />
              <button type="button" onClick={async()=>{ try{ ensureFirebase(); if(!authEmail) return alert('Informe seu e‑mail.'); await sendPasswordResetEmail(getAuth(), authEmail); pushToast('E‑mail de redefinição enviado.'); }catch(e){ alert(e?.message || 'Falha ao enviar redefinição'); } }} className="mb-4 text-left text-xs text-neutral-600 underline">Esqueci minha senha</button>
              <div className="flex gap-2">
                {authMode === "signin" ? (
                  <button onClick={async()=>{ try{ ensureFirebase(); await signInWithEmailAndPassword(getAuth(), authEmail, authPass); setAuthOpen(false);}catch(e){ alert(e?.message || 'Falha ao entrar'); } }} className="flex-1 rounded-2xl bg-black px-4 py-2 text-white">Entrar</button>
                ) : (
                  <button onClick={async()=>{ try{ ensureFirebase(); await createUserWithEmailAndPassword(getAuth(), authEmail, authPass); setAuthOpen(false);}catch(e){ alert(e?.message || 'Falha ao criar conta'); } }} className="flex-1 rounded-2xl bg-black px-4 py-2 text-white">Criar conta</button>
                )}
                <button onClick={()=> setAuthMode(authMode === "signin" ? "signup" : "signin")} className="rounded-2xl border border-neutral-300 px-4 py-2">{authMode === "signin" ? "Criar conta" : "Já tenho conta"}</button>
              </div>
              <p className="mt-3 text-xs text-neutral-500">Seus orçamentos ficam disponíveis em todos os dispositivos quando logado.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============== INPUTS ===============
function LabeledInput({ label, prefix, suffix, value, onChange, placeholder, inputMode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-800">{label}</span>
      <div className="flex items-stretch overflow-hidden rounded-xl border border-neutral-300 focus-within:ring-2 focus-within:ring-black/20">
        {prefix && <span className="flex items-center px-3 text-neutral-500">{prefix}</span>}
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode} className="min-w-0 flex-1 bg-white px-3 py-2 outline-none" />
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
