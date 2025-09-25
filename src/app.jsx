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
    const ok = window.confirm("Limpar todos os favoritos?");
    if (!ok) return;
    const ok2 = window.confirm("Tem certeza? Esta ação não pode ser desfeita.");
    if (!ok2) return;
    const next = [];
    await persistFavoritos(next);
    pushToast("Favoritos limpos.");
  };

  const addFavToMateriais = (fav) => {
    const nextId = (state.materiais.at(-1)?.id || 0) + 1;
    setState((s) => ({
      ...s,
      materiais: [
        ...s.materiais,
        { id: nextId, descricao: fav.descricao, qtd: "", unit: fav.unit, fav: false },
      ],
    }));
  };

  // ---------- Orçamentos (salvar/abrir) ----------
  const salvarOrcamento = async () => {
    const id = state._id || `${Date.now()}`;
    const payload = {
      ...state,
      _id: id,
      createdAt: state.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // local
    const next = [
      payload,
      ...orcamentos.filter((o) => o._id !== id),
    ].sort((a, b) => Number(b._id) - Number(a._id));
    setOrcamentos(next);
    try {
      localStorage.setItem(ORCS_KEY, JSON.stringify(next));
    } catch {}
    // remoto
    if (user && fbDb) {
      try {
        await setDoc(doc(fbDb, "users", user.uid, "orcamentos", id), payload);
      } catch {}
    }
    setState((s) => ({ ...s, _id: id }));
    pushToast("Orçamento salvo!");
  };

  const salvarComoNovo = async () => {
    const id = `${Date.now()}`;
    const payload = {
      ...state,
      _id: id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const next = [payload, ...orcamentos].sort(
      (a, b) => Number(b._id) - Number(a._id)
    );
    setOrcamentos(next);
    try {
      localStorage.setItem(ORCS_KEY, JSON.stringify(next));
    } catch {}
    if (user && fbDb) {
      try {
        await setDoc(doc(fbDb, "users", user.uid, "orcamentos", id), payload);
      } catch {}
    }
    setState((s) => ({ ...s, _id: id }));
    alert("Orçamento salvo como novo!");
  };

  const carregarOrcamento = (o) => {
    setState(o);
    setTab("editor");
    pushToast("Orçamento carregado.");
  };

  const excluirOrcamento = async (id) => {
    const ok = window.confirm("Excluir este orçamento?");
    if (!ok) return;
    const next = orcamentos.filter((o) => o._id !== id);
    setOrcamentos(next);
    try {
      localStorage.setItem(ORCS_KEY, JSON.stringify(next));
    } catch {}
    if (user && fbDb) {
      try {
        await deleteDoc(doc(fbDb, "users", user.uid, "orcamentos", id));
      } catch {}
    }
    if (state._id === id) setState((s) => ({ ...s, _id: null }));
    pushToast("Orçamento excluído.");
  };

  // ---------- Gestor de Materiais (catálogo) ----------
  const persistCatalogo = (next) => {
    setCatalogo(next);
    try {
      localStorage.setItem(CATA_KEY, JSON.stringify(next));
    } catch {}
    // sync remoto
    if (user && fbDb) {
      try {
        // gravamos cada item no Firestore em coleções separadas
        next.forEach(async (c) => {
          await setDoc(doc(fbDb, "users", user.uid, "catalogo", c.id), c);
        });
      } catch {}
    }
  };

  const salvarMaterialCatalogo = async () => {
    const nome = (catForm.nome || "").trim();
    if (!nome) {
      alert("Informe o nome do material");
      return;
    }
    const novo = {
      id: `${Date.now()}`,
      nome,
      unidade: (catForm.unidade || "").trim(),
      quantidade: toNumber(catForm.quantidade),
      preco: toNumber(catForm.preco),
      obs: (catForm.obs || "").trim(),
      createdAt: new Date().toISOString(),
    };
    if (user && fbDb) {
      try {
        await setDoc(doc(fbDb, "users", user.uid, "catalogo", novo.id), novo);
      } catch {}
    }
    persistCatalogo([novo, ...catalogo]);
    setCatForm({ nome: "", unidade: "", quantidade: "", preco: "", obs: "" });
    pushToast("Material cadastrado.");
  };

  const iniciarEdicaoMaterial = (item) => {
    setEditCatId(item.id);
    setEditCatData({
      nome: item.nome || "",
      unidade: item.unidade || "",
      quantidade: String(item.quantidade ?? ""),
      preco: String(item.preco ?? ""),
      obs: item.obs || "",
    });
  };

  const cancelarEdicaoMaterial = () => {
    setEditCatId(null);
    setEditCatData({
      nome: "",
      unidade: "",
      quantidade: "",
      preco: "",
      obs: "",
    });
  };

  const salvarEdicaoMaterial = async () => {
    if (!editCatId) return;
    const patch = {
      ...editCatData,
      preco: toNumber(editCatData.preco),
      quantidade: toNumber(editCatData.quantidade),
    };
    if (user && fbDb) {
      try {
        await setDoc(
          doc(fbDb, "users", user.uid, "catalogo", editCatId),
          { ...(catalogo.find((c) => c.id === editCatId) || {}), ...patch, id: editCatId }
        );
      } catch {}
    }
    const next = catalogo.map((c) =>
      c.id === editCatId ? { ...c, ...patch } : c
    );
    persistCatalogo(next);
    cancelarEdicaoMaterial();
    pushToast("Material atualizado.");
  };

  const removerMaterialCatalogo = async (id) => {
    if (!id) return;
    const ok = window.confirm("Remover este material do catálogo?");
    if (!ok) return;
    if (user && fbDb) {
      try {
        await deleteDoc(doc(fbDb, "users", user.uid, "catalogo", id));
      } catch {}
    }
    const next = catalogo.filter((c) => c.id !== id);
    persistCatalogo(next);
    pushToast("Material removido.");
  };

  const addFromCatalog = (item) => {
    const nextId = (state.materiais.at(-1)?.id || 0) + 1;
    setState((s) => ({
      ...s,
      materiais: [
        ...s.materiais,
        {
          id: nextId,
          descricao: item.nome,
          qtd: String(item.quantidade ?? ""),
          unit: String(item.preco ?? ""),
          fav: false,
        },
      ],
    }));
    pushToast("Material adicionado ao orçamento.");
  };

  const catLista = useMemo(() => {
    let arr = [...catalogo];
    return arr;
  }, [catalogo]);

  // ---------- Logo ----------
  const onPickLogo = async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataURL = reader.result;
      setLogoDataURL(dataURL);
      try {
        localStorage.setItem(LOGO_KEY, dataURL);
      } catch {}
      if (user && fbDb) {
        try {
          await setDoc(doc(fbDb, "users", user.uid, "meta", "logo"), {
            dataURL,
          });
        } catch {}
      }
      pushToast("Logo atualizada.");
    };
    reader.readAsDataURL(f);
  };

  // ---------- Sync remoto (baixar) ----------
  const syncDown = async (uid) => {
    if (!uid || !fbDb) return;
    try {
      // orcamentos
      const orcSnap = await getDocs(collection(fbDb, "users", uid, "orcamentos"));
      const orcs = orcSnap.docs.map((d) => d.data());
      if (orcs.length) {
        const sorted = [...orcs].sort((a, b) => Number(b._id) - Number(a._id));
        setOrcamentos(sorted);
        try {
          localStorage.setItem(ORCS_KEY, JSON.stringify(sorted));
        } catch {}
      }
      // favoritos
      const favSnap = await getDoc(doc(fbDb, "users", uid, "meta", "favoritos"));
      if (favSnap.exists()) {
        const list = favSnap.data()?.lista || [];
        setFavoritos(list);
        try {
          localStorage.setItem(FAV_KEY, JSON.stringify(list));
        } catch {}
      }
      // catalogo
      const catSnap = await getDocs(collection(fbDb, "users", uid, "catalogo"));
      const cats = catSnap.docs.map((d) => d.data());
      if (cats.length) {
        setCatalogo(cats.sort((a, b) => Number(b.id) - Number(a.id)));
        try {
          localStorage.setItem(CATA_KEY, JSON.stringify(cats));
        } catch {}
      }
      // logo
      const logoSnap = await getDoc(doc(fbDb, "users", uid, "meta", "logo"));
      if (logoSnap.exists()) {
        const l = logoSnap.data()?.dataURL || null;
        if (l) {
          setLogoDataURL(l);
          try {
            localStorage.setItem(LOGO_KEY, l);
          } catch {}
        }
      }
    } catch {}
  };

  // ---------- PDF (sem custos internos; perda embutida no unit) ----------
  const gerarPDF = () => {
    const docPdf = new jsPDF("p", "pt", "a4");
    const pageWidth = docPdf.internal.pageSize.getWidth();

    // Cabeçalho
    // Logo 1,5 cm -> ~42.5 pt
    const logoSizePt = 42.5;
    if (logoDataURL) {
      try {
        docPdf.addImage(
          logoDataURL,
          "PNG",
          pageWidth - logoSizePt - 40,
          30,
          logoSizePt,
          logoSizePt
        );
      } catch {}
    }
    docPdf.setFont("helvetica", "bold");
    docPdf.setFontSize(16);
    docPdf.text("Orçamento", 40, 50);
    docPdf.setFont("helvetica", "normal");
    docPdf.setFontSize(11);
    const linhasCab = [
      state.nomeOrcamento ? `Projeto: ${state.nomeOrcamento}` : null,
      state.cliente ? `Cliente: ${state.cliente}` : null,
      state.contato ? `Contato: ${state.contato}` : null,
      state.condicaoPagamento
        ? `Condição de pagamento: ${state.condicaoPagamento}`
        : null,
    ].filter(Boolean);
    linhasCab.forEach((t, i) => docPdf.text(t, 40, 75 + i * 16));

    // Tabela de materiais — perda embutida no preço unitário
    const perda = toNumber(state.perdaPct) / 100;
    const rows = state.materiais
      .filter((m) => toNumber(m.qtd) > 0 && toNumber(m.unit) >= 0)
      .map((m) => {
        const qtd = toNumber(m.qtd);
        const unitOriginal = toNumber(m.unit);
        const unitAjustado = unitOriginal * (1 + perda); // embute perda no unit
        const total = qtd * unitAjustado;
        return [
          m.descricao || "—",
          String(qtd),
          brl(unitAjustado),
          brl(total),
        ];
      });

    autoTable(docPdf, {
      startY: 120,
      head: [["Descrição", "Qtd", "Preço unit.", "Total"]],
      body: rows,
      styles: { font: "helvetica", fontSize: 10 },
      headStyles: { fillColor: [0, 0, 0], textColor: [255, 255, 255] }, // cabeçalho preto
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
      theme: "striped",
      tableWidth: "auto",
      margin: { left: 40, right: 40 },
    });

    // Totais (apenas valores para o cliente)
    const y = docPdf.lastAutoTable.finalY + 20;
    docPdf.setFont("helvetica", "bold");
    docPdf.text("Totais", 40, y);
    docPdf.setFont("helvetica", "normal");
    const totalMateriaisPDF = rows.reduce((acc, r) => {
      const v = parseFloat(r[3].replace(/[^\d,.-]/g, "").replace(".", "").replace(",", "."));
      return acc + (isNaN(v) ? 0 : v);
    }, 0);

    const minutos = toNumber(state.minutosPorUnidade);
    const fixoMin = toNumber(state.custoFixoPorMin);
    const maoMin = toNumber(state.maoDeObraPorMin);
    const custoMO = minutos * maoMin;
    const custoFixo = minutos * fixoMin;
    const lucro = toNumber(state.lucroPct) / 100;
    const taxa = toNumber(state.taxaPct) / 100;
    const parcial = totalMateriaisPDF + custoMO + custoFixo;
    const semTaxas = parcial * (1 + lucro);
    const final = 1 - taxa === 0 ? parcial : semTaxas / (1 - taxa);

    const linhasTotais = [
      ["Subtotal de materiais", brl(totalMateriaisPDF)],
      ["Preço final (com taxas)", brl(final)],
    ];
    autoTable(docPdf, {
      startY: y + 10,
      head: [["Descrição", "Valor"]],
      body: linhasTotais,
      styles: { font: "helvetica", fontSize: 10 },
      headStyles: { fillColor: [0, 0, 0], textColor: [255, 255, 255] },
      columnStyles: { 1: { halign: "right" } },
      theme: "plain",
      margin: { left: 40, right: 40 },
    });

    // Observações
    const y2 = docPdf.lastAutoTable.finalY + 20;
    if (state.observacoes) {
      docPdf.setFont("helvetica", "bold");
      docPdf.text("Observações", 40, y2);
      docPdf.setFont("helvetica", "normal");
      docPdf.setFontSize(10);
      docPdf.text(state.observacoes, 40, y2 + 16, { maxWidth: pageWidth - 80 });
    }

    // Baixar
    const nome = state.nomeOrcamento?.trim() || "orcamento";
    docPdf.save(`${nome}.pdf`);
  };

  const compartilharPDF = async () => {
    try {
      const docPdf = new jsPDF("p", "pt", "a4");
      const pageWidth = docPdf.internal.pageSize.getWidth();

      // (mesmo conteúdo do gerarPDF, mas no final gerar Blob)
      const logoSizePt = 42.5;
      if (logoDataURL) {
        try {
          docPdf.addImage(
            logoDataURL,
            "PNG",
            pageWidth - logoSizePt - 40,
            30,
            logoSizePt,
            logoSizePt
          );
        } catch {}
      }
      docPdf.setFont("helvetica", "bold");
      docPdf.setFontSize(16);
      docPdf.text("Orçamento", 40, 50);
      docPdf.setFont("helvetica", "normal");
      docPdf.setFontSize(11);
      const linhasCab = [
        state.nomeOrcamento ? `Projeto: ${state.nomeOrcamento}` : null,
        state.cliente ? `Cliente: ${state.cliente}` : null,
        state.contato ? `Contato: ${state.contato}` : null,
        state.condicaoPagamento
          ? `Condição de pagamento: ${state.condicaoPagamento}`
          : null,
      ].filter(Boolean);
      linhasCab.forEach((t, i) => docPdf.text(t, 40, 75 + i * 16));

      const perda = toNumber(state.perdaPct) / 100;
      const rows = state.materiais
        .filter((m) => toNumber(m.qtd) > 0 && toNumber(m.unit) >= 0)
        .map((m) => {
          const qtd = toNumber(m.qtd);
          const unitOriginal = toNumber(m.unit);
          const unitAjustado = unitOriginal * (1 + perda);
          const total = qtd * unitAjustado;
          return [
            m.descricao || "—",
            String(qtd),
            brl(unitAjustado),
            brl(total),
          ];
        });

      autoTable(docPdf, {
        startY: 120,
        head: [["Descrição", "Qtd", "Preço unit.", "Total"]],
        body: rows,
        styles: { font: "helvetica", fontSize: 10 },
        headStyles: { fillColor: [0, 0, 0], textColor: [255, 255, 255] },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
        theme: "striped",
        tableWidth: "auto",
        margin: { left: 40, right: 40 },
      });

      const y = docPdf.lastAutoTable.finalY + 20;
      docPdf.setFont("helvetica", "bold");
      docPdf.text("Totais", 40, y);
      docPdf.setFont("helvetica", "normal");
      const totalMateriaisPDF = rows.reduce((acc, r) => {
        const v = parseFloat(r[3].replace(/[^\d,.-]/g, "").replace(".", "").replace(",", "."));
        return acc + (isNaN(v) ? 0 : v);
      }, 0);
      const minutos = toNumber(state.minutosPorUnidade);
      const fixoMin = toNumber(state.custoFixoPorMin);
      const maoMin = toNumber(state.maoDeObraPorMin);
      const custoMO = minutos * maoMin;
      const custoFixo = minutos * fixoMin;
      const lucro = toNumber(state.lucroPct) / 100;
      const taxa = toNumber(state.taxaPct) / 100;
      const parcial = totalMateriaisPDF + custoMO + custoFixo;
      const semTaxas = parcial * (1 + lucro);
      const final = 1 - taxa === 0 ? parcial : semTaxas / (1 - taxa);

      autoTable(docPdf, {
        startY: y + 10,
        head: [["Descrição", "Valor"]],
        body: [
          ["Subtotal de materiais", brl(totalMateriaisPDF)],
          ["Preço final (com taxas)", brl(final)],
        ],
        styles: { font: "helvetica", fontSize: 10 },
        headStyles: { fillColor: [0, 0, 0], textColor: [255, 255, 255] },
        columnStyles: { 1: { halign: "right" } },
        theme: "plain",
        margin: { left: 40, right: 40 },
      });

      const y2 = docPdf.lastAutoTable.finalY + 20;
      if (state.observacoes) {
        docPdf.setFont("helvetica", "bold");
        docPdf.text("Observações", 40, y2);
        docPdf.setFont("helvetica", "normal");
        docPdf.setFontSize(10);
        docPdf.text(state.observacoes, 40, y2 + 16, {
          maxWidth: pageWidth - 80,
        });
      }

      const nome = state.nomeOrcamento?.trim() || "orcamento";
      const blob = docPdf.output("blob");
      const file = new File([blob], `${nome}.pdf`, { type: "application/pdf" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `${nome}.pdf`,
          text: "Segue o orçamento em PDF.",
          files: [file],
        });
      } else {
        // fallback: baixar
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${nome}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      alert("Não foi possível compartilhar. Baixando o PDF...");
      gerarPDF();
    }
  };

  // ---------- Exclusão de conta (menu Conta) ----------
  const confirmDeleteAccount = async () => {
    const ok1 = window.confirm(
      "Tem certeza que deseja excluir permanentemente a sua conta?"
    );
    if (!ok1) return;
    const ok2 = window.confirm(
      "Confirma novamente: essa ação é IRREVERSÍVEL e todos os dados vinculados à conta podem ser removidos."
    );
    if (!ok2) return;
    const typed = window.prompt("Para confirmar, digite EXCLUIR:");
    if ((typed || "").trim().toUpperCase() !== "EXCLUIR") {
      alert("Texto incorreto. Operação cancelada.");
      return;
    }
    try {
      ensureFirebase();
      const u = getAuth().currentUser;
      if (!u) return;
      await deleteUser(u);
      pushToast("Conta excluída.");
    } catch (e) {
      if (e?.code === "auth/requires-recent-login") {
        alert("Por segurança, faça login novamente e tente excluir a conta.");
      } else {
        alert(e?.message || "Falha ao excluir a conta");
      }
    }
  };

  // ---------- UI ----------

  const Header = () => (
    <header className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {/* Logo/avatar 50px circular */}
        <div
          className="h-12 w-12 shrink-0 cursor-pointer overflow-hidden rounded-full border border-neutral-200 bg-neutral-100"
          title="Clique para definir/alterar sua logo (aparece no PDF)"
          onClick={() => logoInputRef.current?.click()}
        >
          {logoDataURL ? (
            <img src={logoDataURL} alt="logo" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
              Logo
            </div>
          )}
        </div>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPickLogo}
        />

        <div>
          <h1 className="text-2xl font-bold tracking-tight">WD ART’S — Orçamentos</h1>
          <p className="text-xs text-neutral-500">
            {user ? (
              <>
                Conectado: <span className="font-medium">{user.email}</span> —{" "}
                <span className="italic">{syncStatus}</span>
              </>
            ) : (
              <>Offline — seus dados ficam salvos no dispositivo</>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Abas */}
        <nav className="hidden gap-2 sm:flex">
          <button
            onClick={() => setTab("editor")}
            className={`rounded-2xl px-3 py-2 text-sm ${
              tab === "editor"
                ? "bg-black text-white"
                : "border border-neutral-300 bg-white shadow-sm hover:bg-neutral-100"
            }`}
          >
            Editor
          </button>
          <button
            onClick={() => setTab("orcamentos")}
            className={`rounded-2xl px-3 py-2 text-sm ${
              tab === "orcamentos"
                ? "bg-black text-white"
                : "border border-neutral-300 bg-white shadow-sm hover:bg-neutral-100"
            }`}
          >
            Meus orçamentos
          </button>
          <button
            onClick={() => setTab("catalogo")}
            className={`rounded-2xl px-3 py-2 text-sm ${
              tab === "catalogo"
                ? "bg-black text-white"
                : "border border-neutral-300 bg-white shadow-sm hover:bg-neutral-100"
            }`}
          >
            Gestor de materiais
          </button>
        </nav>

        {/* Auth / Menu usuário */}
        {user ? (
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm hover:bg-neutral-100"
            >
              Conta ▾
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-neutral-200 bg-white p-1 shadow-xl">
                <button
                  onClick={async () => {
                    try {
                      ensureFirebase();
                      await fbSignOut(getAuth());
                    } catch {}
                    setUserMenuOpen(false);
                  }}
                  className="w-full rounded-xl px-3 py-2 text-left hover:bg-neutral-100"
                >
                  Sair
                </button>
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    confirmDeleteAccount();
                  }}
                  className="w-full rounded-xl px-3 py-2 text-left text-red-600 hover:bg-red-50"
                >
                  Excluir conta
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setAuthOpen(true)}
            className="rounded-2xl bg-black px-4 py-2 text-white"
          >
            Entrar
          </button>
        )}
      </div>
    </header>
  );

  const Editor = () => (
    <div className="space-y-8">
      {/* Dados do orçamento */}
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Dados do orçamento</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LabeledInput
            label="Nome do orçamento / projeto"
            value={state.nomeOrcamento}
            onChange={(v) => setState((s) => ({ ...s, nomeOrcamento: v }))}
            placeholder="Ex.: Cartão de visita"
          />
          <LabeledInput
            label="Cliente"
            value={state.cliente}
            onChange={(v) => setState((s) => ({ ...s, cliente: v }))}
            placeholder="Nome do cliente"
          />
          <LabeledInput
            label="Contato"
            value={state.contato}
            onChange={(v) => setState((s) => ({ ...s, contato: v }))}
            placeholder="E-mail/Telefone"
          />
          <LabeledInput
            label="Condição de pagamento"
            value={state.condicaoPagamento}
            onChange={(v) => setState((s) => ({ ...s, condicaoPagamento: v }))}
            placeholder="Ex.: 50% entrada / 50% na entrega"
          />
          <LabeledTextarea
            label="Observações para o cliente"
            value={state.observacoes}
            onChange={(v) => setState((s) => ({ ...s, observacoes: v }))}
            placeholder="Ex.: Prazo de entrega, frete, garantia etc."
          />
        </div>
      </section>

      {/* Materiais */}
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Materiais</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setTab("catalogo")}
              className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm hover:bg-neutral-100"
            >
              Abrir gestor de materiais
            </button>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full table-auto border-collapse">
            <thead>
              <tr className="bg-neutral-100 text-left text-sm">
                <th className="p-2">ID</th>
                <th className="p-2">Descrição</th>
                <th className="p-2">Qtd usada</th>
                <th className="p-2">Preço unit (R$)</th>
                <th className="p-2">Total</th>
                <th className="p-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {state.materiais.map((m) => (
                <tr key={m.id} className="border-b">
                  <td className="p-2 text-center text-sm text-neutral-600">
                    {m.id}
                  </td>
                  <td className="p-2">
                    <input
                      value={m.descricao}
                      onChange={(e) =>
                        updateMaterial(m.id, { descricao: e.target.value })
                      }
                      placeholder="Ex.: Papel A4 90g"
                      className="w-full rounded-xl border border-neutral-300 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={m.qtd}
                      onChange={(e) => updateMaterial(m.id, { qtd: e.target.value })}
                      placeholder="0"
                      inputMode="decimal"
                      className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-right outline-none focus:ring-2 focus:ring-black/20"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={m.unit}
                      onChange={(e) =>
                        updateMaterial(m.id, { unit: e.target.value })
                      }
                      placeholder="0,00"
                      inputMode="decimal"
                      className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-right outline-none focus:ring-2 focus:ring-black/20"
                    />
                  </td>
                  <td className="p-2 text-right font-medium">
                    {brl(toNumber(m.qtd) * toNumber(m.unit))}
                  </td>
                  <td className="p-2">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => toggleFav(m.id)}
                        className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-100"
                        title="Favoritar/Desfavoritar"
                      >
                        ★
                      </button>
                      <button
                        onClick={() => removeMaterial(m.id)}
                        className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-100"
                      >
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="p-2 text-right font-semibold">
                  CUSTO TOTAL DE MATERIAL
                </td>
                <td className="p-2 text-right font-semibold">
                  {brl(computed.totalMateriais)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* botão + Material abaixo da tabela */}
        <div className="mt-4">
          <button
            onClick={addMaterial}
            className="w-full rounded-2xl bg-black px-4 py-2 text-white shadow-sm hover:bg-neutral-800 sm:w-auto"
          >
            + Adicionar material
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LabeledInput
            label="% de perda (desperdício/erro)"
            suffix="%"
            value={state.perdaPct}
            onChange={(v) => setState((s) => ({ ...s, perdaPct: v }))}
            placeholder="0,00"
            inputMode="decimal"
          />
        </div>
      </section>

      {/* Produção (custos internos — não vão ao PDF) */}
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Produção (por unidade)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LabeledInput
            label="Minutos para produzir uma unidade"
            value={state.minutosPorUnidade}
            onChange={(v) => setState((s) => ({ ...s, minutosPorUnidade: v }))}
            placeholder="0"
            inputMode="numeric"
          />
          <LabeledInput
            label="Mão de obra (R$/min)"
            prefix="R$"
            value={state.maoDeObraPorMin}
            onChange={(v) => setState((s) => ({ ...s, maoDeObraPorMin: v }))}
            placeholder="0,00"
            inputMode="decimal"
          />
          <LabeledInput
            label="Custo fixo (R$/min)"
            prefix="R$"
            value={state.custoFixoPorMin}
            onChange={(v) => setState((s) => ({ ...s, custoFixoPorMin: v }))}
            placeholder="0,00"
            inputMode="decimal"
          />
        </div>
      </section>

      {/* Precificação (resumo/cliente vê só o final no PDF) */}
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Precificação</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LabeledInput
            label="% de lucro desejada"
            suffix="%"
            value={state.lucroPct}
            onChange={(v) => setState((s) => ({ ...s, lucroPct: v }))}
            placeholder="0,00"
            inputMode="decimal"
          />
          <LabeledInput
            label="% de taxa (marketplace/gateway)"
            suffix="%"
            value={state.taxaPct}
            onChange={(v) => setState((s) => ({ ...s, taxaPct: v }))}
            placeholder="0,00"
            inputMode="decimal"
          />
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-neutral-200 p-4">
            <div className="mb-1 text-sm text-neutral-600">
              Valor parcial (custo total)
            </div>
            <div className="text-xl font-semibold">
              {brl(computed.custoParcial)}
            </div>
          </div>
          <div className="rounded-2xl border border-neutral-200 p-4">
            <div className="mb-1 text-sm text-neutral-600">Preço sem taxas</div>
            <div className="text-xl font-semibold">
              {brl(computed.precoSemTaxas)}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-black p-6 text-white shadow">
          <div className="text-sm/6 opacity-80">Preço final (com taxas)</div>
          <div className="mt-1 text-3xl font-extrabold tracking-tight">
            {Number.isNaN(computed.precoFinal)
              ? "—"
              : brl(computed.precoFinal)}
          </div>
          <div className="mt-2 text-xs opacity-80">
            Fórmula: final = sem taxas / (1 − % taxa)
          </div>
        </div>

        {computed.validacoes.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 rounded-2xl bg-red-50 p-3 pl-6 text-sm text-red-700">
            {computed.validacoes.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Ações */}
      <section className="flex flex-wrap gap-2">
        <button
          onClick={salvarOrcamento}
          className="rounded-2xl bg-black px-4 py-2 text-white shadow-sm hover:bg-neutral-800"
        >
          Salvar
        </button>
        <button
          onClick={salvarComoNovo}
          className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100"
        >
          Salvar como novo
        </button>
        <button
          onClick={gerarPDF}
          className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100"
        >
          Gerar PDF
        </button>
        <button
          onClick={compartilharPDF}
          className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100"
        >
          Compartilhar PDF
        </button>
        <button
          onClick={exportCSV}
          className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100"
        >
          Exportar CSV
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100"
        >
          Imprimir
        </button>
      </section>
    </div>
  );

  const MeusOrcamentos = () => {
    const lista = orcamentos
      .filter((o) =>
        (o.nomeOrcamento || "")
          .toLowerCase()
          .includes(orcQuery.trim().toLowerCase())
      )
      .sort((a, b) => Number(b._id) - Number(a._id));
    return (
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Meus orçamentos</h2>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              {/* avatar/logo também aqui */}
              <div className="h-8 w-8 overflow-hidden rounded-full border border-neutral-200 bg-neutral-100">
                {logoDataURL ? (
                  <img src={logoDataURL} alt="logo" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <span className="text-sm text-neutral-500">
                {user ? user.email : "Offline"}
              </span>
            </div>
            <input
              value={orcQuery}
              onChange={(e) => setOrcQuery(e.target.value)}
              placeholder="Buscar por nome…"
              className="w-48 rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20"
            />
          </div>
        </div>
        {/* Formulário oculto — só lista */}
        {lista.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-neutral-500">
            Nenhum orçamento salvo.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full table-auto border-collapse">
              <thead>
                <tr className="bg-neutral-100 text-left text-sm">
                  <th className="p-2">ID</th>
                  <th className="p-2">Nome</th>
                  <th className="p-2">Cliente</th>
                  <th className="p-2">Atualizado em</th>
                  <th className="p-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((o) => (
                  <tr key={o._id} className="border-b">
                    <td className="p-2 text-sm text-neutral-600">{o._id}</td>
                    <td className="p-2">{o.nomeOrcamento || "—"}</td>
                    <td className="p-2">{o.cliente || "—"}</td>
                    <td className="p-2">
                      {new Date(o.updatedAt || o.createdAt || Number(o._id)).toLocaleString(
                        "pt-BR"
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => carregarOrcamento(o)}
                          className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-100"
                        >
                          Abrir
                        </button>
                        <button
                          onClick={() => excluirOrcamento(o._id)}
                          className="rounded-xl border border-red-300 bg-white px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  };

  const GestorMateriais = () => (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Gestor de materiais</h2>
        <div className="flex items-center gap-2">
          <input
            value={favQuery}
            onChange={(e) => setFavQuery(e.target.value)}
            placeholder="Buscar favoritos…"
            className="w-48 rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20"
          />
          <button
            onClick={clearFavoritos}
            className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm hover:bg-neutral-100"
          >
            Limpar favoritos
          </button>
        </div>
      </div>

      {/* Cadastrar novo material */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <LabeledInput
          label="Nome"
          value={catForm.nome}
          onChange={(v) => setCatForm((f) => ({ ...f, nome: v }))}
          placeholder="Ex.: Papel A4 90g"
        />
        <LabeledInput
          label="Unidade"
          value={catForm.unidade}
          onChange={(v) => setCatForm((f) => ({ ...f, unidade: v }))}
          placeholder="Ex.: folha, metro, ml"
        />
        <LabeledInput
          label="Qtd padrão"
          value={catForm.quantidade}
          onChange={(v) => setCatForm((f) => ({ ...f, quantidade: v }))}
          placeholder="0"
          inputMode="numeric"
        />
        <LabeledInput
          label="Preço unitário (R$)"
          prefix="R$"
          value={catForm.preco}
          onChange={(v) => setCatForm((f) => ({ ...f, preco: v }))}
          placeholder="0,00"
          inputMode="decimal"
        />
        <LabeledInput
          label="Obs. (opcional)"
          value={catForm.obs}
          onChange={(v) => setCatForm((f) => ({ ...f, obs: v }))}
          placeholder="Marca, cor..."
        />
        <div className="sm:col-span-2 lg:col-span-5">
          <button
            onClick={salvarMaterialCatalogo}
            className="w-full rounded-2xl bg-black px-4 py-2 text-white shadow-sm hover:bg-neutral-800"
          >
            Cadastrar material
          </button>
        </div>
      </div>

      {/* Tabela do catálogo */}
      <div className="overflow-auto">
        <table className="w-full table-auto border-collapse">
          <thead>
            <tr className="bg-neutral-100 text-left">
              <th className="p-2">Nome</th>
              <th className="p-2">Unidade</th>
              <th className="p-2">Qtd padrão</th>
              <th className="p-2">Preço</th>
              <th className="p-2">Obs.</th>
              <th className="p-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {catLista.map((c) =>
              editCatId === c.id ? (
                <tr key={c.id} className="border-b">
                  <td className="p-2">
                    <input
                      value={editCatData.nome}
                      onChange={(e) =>
                        setEditCatData((d) => ({ ...d, nome: e.target.value }))
                      }
                      className="w-full rounded-xl border border-neutral-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={editCatData.unidade}
                      onChange={(e) =>
                        setEditCatData((d) => ({ ...d, unidade: e.target.value }))
                      }
                      className="w-full rounded-xl border border-neutral-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={editCatData.quantidade}
                      onChange={(e) =>
                        setEditCatData((d) => ({ ...d, quantidade: e.target.value }))
                      }
                      className="w-full rounded-xl border border-neutral-300 px-2 py-1 text-right"
                      inputMode="numeric"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={editCatData.preco}
                      onChange={(e) =>
                        setEditCatData((d) => ({ ...d, preco: e.target.value }))
                      }
                      className="w-full rounded-xl border border-neutral-300 px-2 py-1 text-right"
                      inputMode="decimal"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={editCatData.obs}
                      onChange={(e) =>
                        setEditCatData((d) => ({ ...d, obs: e.target.value }))
                      }
                      className="w-full rounded-xl border border-neutral-300 px-2 py-1"
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={salvarEdicaoMaterial}
                        className="rounded-xl border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100"
                      >
                        Salvar
                      </button>
                      <button
                        onClick={cancelarEdicaoMaterial}
                        className="rounded-xl border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100"
                      >
                        Cancelar
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={c.id} className="border-b">
                  <td className="p-2">{c.nome}</td>
                  <td className="p-2">{c.unidade || "—"}</td>
                  <td className="p-2">{String(c.quantidade ?? "—")}</td>
                  <td className="p-2">{brl(toNumber(c.preco))}</td>
                  <td className="p-2">{c.obs || "—"}</td>
                  <td className="p-2">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => addFromCatalog(c)}
                        className="rounded-xl border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100"
                      >
                        Adicionar ao orçamento
                      </button>
                      <button
                        onClick={() => iniciarEdicaoMaterial(c)}
                        className="rounded-xl border border-neutral-300 bg-white px-3 py-1 hover:bg-neutral-100"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => removerMaterialCatalogo(c.id)}
                        className="rounded-xl border border-red-300 bg-white px-3 py-1 text-red-600 hover:bg-red-50"
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {/* Favoritos rápidos */}
      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-neutral-700">
          Materiais favoritos
        </h3>
        {favoritos.length === 0 ? (
          <div className="rounded-xl border border-dashed p-4 text-center text-neutral-500">
            Você pode favoritar itens no editor do orçamento (★) e eles aparecerão aqui.
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {favoritos
              .filter((f) =>
                f.descricao
                  .toLowerCase()
                  .includes(favQuery.trim().toLowerCase())
              )
              .map((f, i) => (
                <button
                  key={i}
                  onClick={() => addFavToMateriais(f)}
                  className="flex items-center justify-between rounded-xl border border-neutral-300 bg-white px-3 py-2 text-left hover:bg-neutral-100"
                  title="Adicionar ao orçamento"
                >
                  <span className="truncate">{f.descricao}</span>
                  <span className="shrink-0 text-sm text-neutral-600">
                    {brl(toNumber(f.unit))}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>
    </section>
  );

  // ---------- CSV ----------
  function exportCSV() {
    const linhas = [];
    linhas.push([
      "ID",
      "Descrição",
      "Qtd usada",
      "Valor unitário (R$)",
      "Valor usado (R$)",
    ]);
    state.materiais.forEach((m) => {
      const qtd = toNumber(m.qtd);
      const unit = toNumber(m.unit);
      linhas.push([m.id, m.descricao, qtd, unit, qtd * unit]);
    });

    const csv = linhas
      .map((row) =>
        row
          .map((cell) =>
            typeof cell === "number"
              ? String(cell).replace(".", ",")
              : String(cell)
          )
          .join(";")
      )
      .join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "orcamento.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Auth modal ----------
  const AuthModal = () =>
    authOpen ? (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              {authMode === "signin" ? "Entrar" : "Criar conta"}
            </h3>
            <button
              onClick={() => setAuthOpen(false)}
              className="rounded-xl border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
            >
              Fechar
            </button>
          </div>
          <div className="space-y-3">
            <LabeledInput
              label="E-mail"
              value={authEmail}
              onChange={setAuthEmail}
              placeholder="voce@exemplo.com"
            />
            <LabeledInput
              label="Senha"
              value={authPass}
              onChange={setAuthPass}
              placeholder="••••••••"
            />
            {authMode === "signin" ? (
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      ensureFirebase();
                      await signInWithEmailAndPassword(
                        getAuth(),
                        authEmail,
                        authPass
                      );
                      setAuthOpen(false);
                    } catch (e) {
                      const code = e?.code || "";
                      const msg = authMsg(code);
                      if (code === "auth/user-not-found") {
                        if (
                          window.confirm(
                            msg + " Deseja criar uma conta agora?"
                          )
                        )
                          setAuthMode("signup");
                      } else if (
                        code === "auth/invalid-credential" ||
                        code === "auth/wrong-password"
                      ) {
                        if (
                          window.confirm(
                            msg + " Deseja enviar e-mail de redefinição?"
                          )
                        )
                          await offerReset(authEmail);
                      } else {
                        alert(msg);
                      }
                    }
                  }}
                  className="flex-1 rounded-2xl bg-black px-4 py-2 text-white"
                >
                  Entrar
                </button>
                <button
                  onClick={() => setAuthMode("signup")}
                  className="flex-1 rounded-2xl border border-neutral-300 bg-white px-4 py-2"
                >
                  Criar conta
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      ensureFirebase();
                      await createUserWithEmailAndPassword(
                        getAuth(),
                        authEmail,
                        authPass
                      );
                      setAuthOpen(false);
                    } catch (e) {
                      const code = e?.code || "";
                      if (code === "auth/email-already-in-use") {
                        const goSignIn = window.confirm(
                          "Este e-mail já está cadastrado. Deseja entrar com ele?"
                        );
                        if (goSignIn) {
                          setAuthMode("signin");
                        } else {
                          const send = window.confirm(
                            "Deseja enviar e-mail de redefinição de senha para este endereço?"
                          );
                          if (send) await offerReset(authEmail);
                        }
                      } else {
                        alert(authMsg(code));
                      }
                    }
                  }}
                  className="flex-1 rounded-2xl bg-black px-4 py-2 text-white"
                >
                  Criar conta
                </button>
                <button
                  onClick={() => setAuthMode("signin")}
                  className="flex-1 rounded-2xl border border-neutral-300 bg-white px-4 py-2"
                >
                  Já tenho conta
                </button>
              </div>
            )}
            <div className="text-center">
              <button
                onClick={() => offerReset(authEmail)}
                className="text-sm text-neutral-600 underline"
              >
                Esqueci minha senha
              </button>
            </div>
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className="min-h-screen bg-neutral-50 py-8">
      <div className="mx-auto max-w-6xl px-4">
        <Header />

        {/* Tabs responsivas (mobile) */}
        <div className="mb-4 flex gap-2 sm:hidden">
          <button
            onClick={() => setTab("editor")}
            className={`flex-1 rounded-2xl px-3 py-2 text-sm ${
              tab === "editor"
                ? "bg-black text-white"
                : "border border-neutral-300 bg-white shadow-sm hover:bg-neutral-100"
            }`}
          >
            Editor
          </button>
          <button
            onClick={() => setTab("orcamentos")}
            className={`flex-1 rounded-2xl px-3 py-2 text-sm ${
              tab === "orcamentos"
                ? "bg-black text-white"
                : "border border-neutral-300 bg-white shadow-sm hover:bg-neutral-100"
            }`}
          >
            Meus orçamentos
          </button>
          <button
            onClick={() => setTab("catalogo")}
            className={`flex-1 rounded-2xl px-3 py-2 text-sm ${
              tab === "catalogo"
                ? "bg-black text-white"
                : "border border-neutral-300 bg-white shadow-sm hover:bg-neutral-100"
            }`}
          >
            Gestor de materiais
          </button>
        </div>

        {tab === "editor" && <Editor />}
        {tab === "orcamentos" && <MeusOrcamentos />}
        {tab === "catalogo" && <GestorMateriais />}

        <footer className="mt-8 text-center text-xs text-neutral-500">
          Dica: salve sua página como PWA para usar offline; dados ficam no
          dispositivo e sincronizam quando logado.
        </footer>

        {/* LGPD Banner */}
        {!lgpdAccepted && (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
            <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-neutral-800">
                Utilizamos seus dados (e-mail e conteúdos de orçamentos) apenas
                para fornecer o serviço e sincronizar entre dispositivos. Ao
                continuar, você concorda com nossa{" "}
                <button
                  onClick={() => setLgpdShowModal(true)}
                  className="underline"
                >
                  Política de Privacidade
                </button>
                .
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setLgpdShowModal(true)}
                  className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm shadow-sm hover:bg-neutral-100"
                >
                  Ler política
                </button>
                <button
                  onClick={acceptLGPD}
                  className="rounded-2xl bg-black px-4 py-2 text-sm text-white shadow-sm hover:bg-neutral-800"
                >
                  Aceitar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* LGPD Modal */}
        {lgpdShowModal && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Política de Privacidade</h3>
                <button
                  onClick={() => setLgpdShowModal(false)}
                  className="rounded-xl border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100"
                >
                  Fechar
                </button>
              </div>
              <div className="prose prose-sm max-w-none text-neutral-800">
                <p>
                  Coletamos apenas e-mail (para autenticação) e os dados de
                  orçamentos/suas configurações. Usamos para fornecer o serviço,
                  gerar PDFs e sincronizar entre dispositivos. Não vendemos seus
                  dados. Você pode solicitar a exclusão definitiva a qualquer
                  momento usando a funcionalidade de exclusão de conta.
                </p>
                <ul>
                  <li>Base legal: execução de contrato e consentimento (LGPD).</li>
                  <li>Retenção: enquanto a conta estiver ativa ou conforme obrigações legais.</li>
                  <li>
                    Direitos: confirmação de tratamento, acesso, correção,
                    anonimização, portabilidade e exclusão.
                  </li>
                </ul>
                <p>Ao clicar em “Aceitar”, você consente com esta política.</p>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setLgpdShowModal(false)}
                  className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm shadow-sm hover:bg-neutral-100"
                >
                  Fechar
                </button>
                <button
                  onClick={acceptLGPD}
                  className="rounded-2xl bg-black px-4 py-2 text-sm text-white shadow-sm hover:bg-neutral-800"
                >
                  Aceitar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-4 right-4 z-50 rounded-xl bg-black px-4 py-2 text-sm text-white shadow-lg">
            {toast.msg}
          </div>
        )}

        {/* Auth modal */}
        <AuthModal />
      </div>
    </div>
  );
}

// =============== INPUTS ===============
function LabeledInput({
  label,
  prefix,
  suffix,
  value,
  onChange,
  placeholder,
  inputMode,
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-800">
        {label}
      </span>
      <div className="flex items-stretch overflow-hidden rounded-xl border border-neutral-300 focus-within:ring-2 focus-within:ring-black/20">
        {prefix && (
          <span className="flex items-center px-3 text-neutral-500">
            {prefix}
          </span>
        )}
        <input
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          className="min-w-0 flex-1 bg-white px-3 py-2 outline-none"
        />
        {suffix && (
          <span className="flex items-center px-3 text-neutral-500">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function LabeledTextarea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-800">
        {label}
      </span>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[80px] w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-black/20"
      ></textarea>
    </label>
  );
}
