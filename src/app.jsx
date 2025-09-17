import React, { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// Calculadora de Precificação — versão PWA + Compartilhar PDF
// Inclui: geração de PDF (cliente, sem custos internos), favoritos, salvar orçamentos (localStorage),
// botão Compartilhar PDF (Web Share API) e registro de Service Worker para PWA.

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

  const [state, setState] = useState(initial);
  const [favoritos, setFavoritos] = useState([]);
  const [orcamentos, setOrcamentos] = useState([]);
  const [mostrarLista, setMostrarLista] = useState(false);

  // PWA install prompt
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstallable, setIsInstallable] = useState(false);

  // Carrega do localStorage
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setState(JSON.parse(raw));
        const favRaw = localStorage.getItem(FAV_KEY);
        if (favRaw) setFavoritos(JSON.parse(favRaw));
        const orcRaw = localStorage.getItem(ORCS_KEY);
        if (orcRaw) setOrcamentos(JSON.parse(orcRaw));
      }
    } catch {}
  }, []);

  // Salva estado atual
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch {}
  }, [state]);

  // Registrar Service Worker (PWA)
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Capturar evento de instalação (PWA)
  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };
    const onInstalled = () => setIsInstallable(false);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const instalarApp = async () => {
    try {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      setIsInstallable(false);
    } catch {}
  };

  // Persistência auxiliar
  const persistFavoritos = (next) => {
    setFavoritos(next);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch {}
  };
  const persistOrcamentos = (next) => {
    setOrcamentos(next);
    try { localStorage.setItem(ORCS_KEY, JSON.stringify(next)); } catch {}
  };

  // Derivações numéricas
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

    const custoMaoObra = minutos * maoObraMin; // interno
    const custoFixo = minutos * fixoMin; // interno

    const custoParcial = materiaisAjustados + custoMaoObra + custoFixo; // interno

    const lucro = toNumber(state.lucroPct) / 100; // interno
    const precoSemTaxas = custoParcial * (1 + lucro); // interno

    const taxa = toNumber(state.taxaPct) / 100;
    const precoFinal = (1 - taxa) === 0 ? NaN : precoSemTaxas / (1 - taxa); // mostrado ao cliente

    const quantidade = Math.max(1, Math.floor(toNumber(state.quantidade)) || 1);
    const totalGeral = Number.isFinite(precoFinal) ? precoFinal * quantidade : NaN;

    const validacoes = [];
    if (taxa >= 1) validacoes.push("A taxa não pode ser 100%.");
    if (perda < 0) validacoes.push("% de perda não pode ser negativa.");

    return {
      materiais,
      totalMateriais,
      perda,
      materiaisAjustados,
      minutos,
      custoMaoObra,
      custoFixo,
      custoParcial,
      precoSemTaxas,
      taxa,
      precoFinal,
      quantidade,
      totalGeral,
      validacoes,
    };
  }, [state]);

  // Ações básicas
  const addMaterial = () => {
    const nextId = (state.materiais.at(-1)?.id || 0) + 1;
    setState((s) => ({ ...s, materiais: [...s.materiais, { id: nextId, descricao: "", qtd: "", unit: "", fav: false }] }));
  };
  const removeMaterial = (id) => setState((s) => ({ ...s, materiais: s.materiais.filter((m) => m.id !== id) }));
  const updateMaterial = (id, patch) => setState((s) => ({ ...s, materiais: s.materiais.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));

  // Favoritos
  const toggleFavorito = (mat) => {
    const isFav = favoritos.some((f) => (f.descricao || "").trim() === (mat.descricao || "").trim());
    let next;
    if (isFav) {
      next = favoritos.filter((f) => (f.descricao || "").trim() !== (mat.descricao || "").trim());
    } else {
      next = [...favoritos, { descricao: mat.descricao || "", unitPadrao: toNumber(mat.unit) }];
    }
    persistFavoritos(next);
    updateMaterial(mat.id, { fav: !isFav });
  };
  const addFromFavorito = (fav) => {
    const nextId = (state.materiais.at(-1)?.id || 0) + 1;
    setState((s) => ({
      ...s,
      materiais: [
        ...s.materiais,
        { id: nextId, descricao: fav.descricao, qtd: "", unit: String(fav.unitPadrao ?? ""), fav: true },
      ],
    }));
  };
  const limparFavoritos = () => persistFavoritos([]);

  // Logo uploader
  const onLogoUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result || "";
      setState((s) => ({ ...s, logoDataUrl: String(dataUrl) }));
    };
    reader.readAsDataURL(file);
  };

  // Salvar/Reabrir orçamentos
  const salvarOrcamento = () => {
    const id = state._id || `${Date.now()}`;
    const payload = { ...state, _id: id, _savedAt: new Date().toISOString() };
    const exists = orcamentos.some((o) => o._id === id);
    const next = exists ? orcamentos.map((o) => (o._id === id ? payload : o)) : [payload, ...orcamentos];
    persistOrcamentos(next);
    setState((s) => ({ ...s, _id: id }));
    alert("Orçamento salvo!");
  };
  const carregarOrcamento = (id) => {
    const found = orcamentos.find((o) => o._id === id);
    if (found) setState(found);
    setMostrarLista(false);
  };
  const excluirOrcamento = (id) => {
    const next = orcamentos.filter((o) => o._id !== id);
    persistOrcamentos(next);
    if (state._id === id) setState(initial);
  };

  // ====== PDF builder (reutilizado por salvar e compartilhar) ======
  const buildPDF = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const marginX = 48;
    let y = 56;

    // helpers mm->pt
    const mm = (v) => v * 2.83465; // 1 mm = 2.83465 pt

    // Logo (sempre 1,5cm x 1,5cm)
    const hasLogo = !!state.logoDataUrl;
    const logoSize = mm(15);
    if (hasLogo) {
      try {
        doc.addImage(state.logoDataUrl, "PNG", marginX, y, logoSize, logoSize, undefined, "FAST");
      } catch {}
    }

    // Cabeçalho
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    const offsetX = hasLogo ? (logoSize + 12) : 0;

    y += hasLogo ? (logoSize + 10) : 30;

    // Dados do cliente
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Dados do cliente", marginX, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Nome: ${state.clienteNome || "—"}`, marginX, y); y += 14;
    if (state.clienteContato) { doc.text(`Contato: ${state.clienteContato}`, marginX, y); y += 14; }
    doc.text(`Quantidade: ${computed.quantidade}`, marginX, y); y += 18;

    // Tabela de itens (apenas materiais)
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
      styles: { fontSize: 10 },
      headStyles: { fillColor: [240, 240, 240] },
      margin: { left: marginX, right: marginX },
    });

    y = doc.lastAutoTable.finalY + 10;

    // Subtotal e preço (sem expor custos internos)
    doc.setFont("helvetica", "normal");
    doc.text(`Subtotal materiais: ${brl(computed.materiaisAjustados)}`, marginX, y); y += 14; y += 14;
    if (computed.perda > 0) { doc.text(`Materiais ajustados (c/ perda): ${brl(computed.materiaisAjustados)}`, marginX, y); y += 14; }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Preço unitário: ${Number.isFinite(computed.precoFinal) ? brl(computed.precoFinal) : "—"}`, marginX, y); y += 18;
    doc.text(`Total para ${computed.quantidade} un.: ${Number.isFinite(computed.totalGeral) ? brl(computed.totalGeral) : "—"}`, marginX, y); y += 22;

    // Observações/condições
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    if (state.prazoEntrega) { doc.text(`Prazo de entrega: ${state.prazoEntrega}`, marginX, y); y += 14; }
    if (state.condicoesPagamento) { doc.text(`Condições de pagamento: ${state.condicoesPagamento}`, marginX, y); y += 14; }
    if (state.validadeDias) { doc.text(`Validade deste orçamento: ${state.validadeDias} dias`, marginX, y); y += 14; }
    if (state.observacoes) {
      const obs = doc.splitTextToSize(`Observações: ${state.observacoes}`, 500);
      doc.text(obs, marginX, y); y += obs.length * 12 + 4;
    }

    const nomeArquivo = (state.orcamentoNome || "wd-arts").trim().replaceAll(" ", "-").toLowerCase();
    return { doc, nomeArquivo };
  };

  // Baixar PDF
  const gerarPDF = () => {
    const { doc, nomeArquivo } = buildPDF();
    doc.save(`orcamento-${nomeArquivo}.pdf`);
  };

  // Compartilhar PDF (Android/iOS compatíveis com Web Share API Nivel 2)
  const compartilharPDF = async () => {
    try {
      const { doc, nomeArquivo } = buildPDF();
      const blob = doc.output("blob");
      const file = new File([blob], `orcamento-${nomeArquivo}.pdf`, { type: "application/pdf" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Orçamento",
          text: state.orcamentoNome ? `Orçamento: ${state.orcamentoNome}` : "",
        });
      } else {
        // Fallback: abre em nova aba para o usuário salvar/compartilhar manualmente
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      }
    } catch (e) {
      alert("Não foi possível compartilhar. Tentando abrir o PDF...");
      const { doc } = buildPDF();
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    }
  };

  // Reset
  const resetar = () => setState(initial);

  return (
    <div className="min-h-screen bg-neutral-50 py-8">
      <div className="mx-auto max-w-6xl px-4">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Calculadora de Precificação</h1>
            <p className="text-sm text-neutral-600">Preencha e gere o PDF do orçamento sem expor custos internos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={addMaterial} className="rounded-2xl bg-black px-4 py-2 text-white shadow-sm hover:bg-neutral-800">+ Material</button>
            <button onClick={salvarOrcamento} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Salvar orçamento</button>
            <button onClick={() => setMostrarLista((v) => !v)} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Meus orçamentos</button>
            <button onClick={gerarPDF} className="rounded-2xl bg-black px-4 py-2 text-white shadow-sm hover:bg-neutral-800">Gerar PDF</button>
            <button onClick={compartilharPDF} className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 shadow-sm hover:bg-neutral-100">Compartilhar PDF</button>
            {isInstallable && (
              <button onClick={instalarApp} className="rounded-2xl border border-green-300 bg-white px-4 py-2 text-green-700 shadow-sm hover:bg-green-50">Instalar app</button>
            )}
            <button onClick={resetar} className="rounded-2xl border border-red-300 bg-white px-4 py-2 text-red-600 shadow-sm hover:bg-red-50">Resetar</button>
          </div>
        </header>

        {/* Meta do orçamento */}
        <section className="mb-6 grid gap-3 rounded-2xl bg-white p-4 shadow-sm md:grid-cols-2 lg:grid-cols-3">
          <LabeledInput label="Nome do orçamento / Projeto" value={state.orcamentoNome} onChange={(v) => setState((s) => ({ ...s, orcamentoNome: v }))} placeholder="Ex.: Lembrancinhas aniversário" />
          <LabeledInput label="Cliente" value={state.clienteNome} onChange={(v) => setState((s) => ({ ...s, clienteNome: v }))} placeholder="Nome do cliente" />
          <LabeledInput label="Contato (opcional)" value={state.clienteContato} onChange={(v) => setState((s) => ({ ...s, clienteContato: v }))} placeholder="WhatsApp / e-mail" />
          <LabeledInput label="Quantidade de unidades" value={state.quantidade} onChange={(v) => setState((s) => ({ ...s, quantidade: v }))} placeholder="1" />
          <LabeledInput label="Validade do orçamento (dias)" value={state.validadeDias} onChange={(v) => setState((s) => ({ ...s, validadeDias: v }))} placeholder="7" />
          <LabeledInput label="Prazo de entrega" value={state.prazoEntrega} onChange={(v) => setState((s) => ({ ...s, prazoEntrega: v }))} placeholder="Ex.: 5 a 7 dias úteis" />
          <LabeledInput label="Condições de pagamento" value={state.condicoesPagamento} onChange={(v) => setState((s) => ({ ...s, condicoesPagamento: v }))} placeholder="Pix / Cartão / 50% sinal" />
          <LabeledTextarea label="Observações (mostradas no PDF)" value={state.observacoes} onChange={(v) => setState((s) => ({ ...s, observacoes: v }))} placeholder="Ex.: Arte inclusa. Alterações após aprovação podem gerar custo adicional." />

          {/* Logo */}
          <div className="md:col-span-2 lg:col-span-3">
            <span className="mb-1 block text-sm font-medium text-neutral-800">Logo (aparece no PDF)</span>
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm hover:bg-neutral-100">
                Carregar logo
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onLogoUpload(e.target.files?.[0])} />
              </label>
              {state.logoDataUrl && <img src={state.logoDataUrl} alt="logo" className="h-10 w-auto rounded" />}
              {!state.logoDataUrl && <span className="text-xs text-neutral-500">Dica: use a versão com fundo transparente.</span>}
            </div>
          </div>
        </section>

        {/* Materiais */}
        <section className="mb-8 rounded-2xl bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Materiais</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm text-neutral-600">Favoritos:</div>
              <div className="flex flex-wrap gap-2">
                {favoritos.length === 0 && (
                  <span className="text-sm text-neutral-500">Nenhum favorito ainda</span>
                )}
                {favoritos.map((f, idx) => (
                  <button key={idx} onClick={() => addFromFavorito(f)} className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm hover:bg-neutral-100">
                    {f.descricao}
                  </button>
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

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <LabeledInput label="% de perda (desperdício/erro)" suffix="%" value={state.perdaPct} onChange={(v) => setState((s) => ({ ...s, perdaPct: v }))} placeholder="0,00" />
          </div>
          <div className="mt-2 text-right text-sm text-neutral-600">
            Materiais ajustados: <span className="font-semibold">{brl(computed.materiaisAjustados)}</span>
          </div>
        </section>

        {/* Produção — uso interno (não aparece no PDF) */}
        <section className="mb-8 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Produção (por unidade) — dados internos</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <LabeledInput label="Minutos para produzir uma unidade" value={state.minutosPorUnidade} onChange={(v) => setState((s) => ({ ...s, minutosPorUnidade: v }))} placeholder="0" />
            <LabeledInput label="Mão de obra (R$/min)" prefix="R$" value={state.maoDeObraPorMin} onChange={(v) => setState((s) => ({ ...s, maoDeObraPorMin: v }))} placeholder="0,00" />
            <LabeledInput label="Custo fixo (R$/min)" prefix="R$" value={state.custoFixoPorMin} onChange={(v) => setState((s) => ({ ...s, custoFixoPorMin: v }))} placeholder="0,00" />
          </div>
        </section>

        {/* Precificação */}
        <section className="mb-8 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Precificação</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <LabeledInput label="% de lucro desejada" suffix="%" value={state.lucroPct} onChange={(v) => setState((s) => ({ ...s, lucroPct: v }))} placeholder="0,00" />
            <LabeledInput label="% de taxa (marketplace/gateway)" suffix="%" value={state.taxaPct} onChange={(v) => setState((s) => ({ ...s, taxaPct: v }))} placeholder="0,00" />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-neutral-200 p-4">
              <div className="mb-1 text-sm text-neutral-600">Valor parcial (custo total)</div>
              <div className="text-xl font-semibold">{brl(computed.custoParcial)}</div>
            </div>
            <div className="rounded-2xl border border-neutral-200 p-4">
              <div className="mb-1 text-sm text-neutral-600">Preço sem taxas</div>
              <div className="text-xl font-semibold">{brl(computed.precoSemTaxas)}</div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-black p-6 text-white shadow">
            <div className="text-sm/6 opacity-80">Preço unitário (com taxas)</div>
            <div className="mt-1 text-3xl font-extrabold tracking-tight">{Number.isNaN(computed.precoFinal) ? "—" : brl(computed.precoFinal)}</div>
          </div>

          <div className="mt-3 text-right text-sm text-neutral-700">
            Total para {computed.quantidade} un.: <span className="font-semibold">{Number.isFinite(computed.totalGeral) ? brl(computed.totalGeral) : "—"}</span>
          </div>

          {computed.validacoes.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 rounded-2xl bg-red-50 p-3 pl-6 text-sm text-red-700">
              {computed.validacoes.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          )}
        </section>

        {/* Lista de orçamentos salvos */}
        {mostrarLista && (
          <section className="mb-8 rounded-2xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">Meus orçamentos</h2>
            {orcamentos.length === 0 ? (
              <div className="text-sm text-neutral-500">Nenhum orçamento salvo ainda.</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full table-auto border-collapse text-sm">
                  <thead>
                    <tr className="bg-neutral-100 text-left">
                      <th className="p-2">Nome</th>
                      <th className="p-2">Cliente</th>
                      <th className="p-2">Atualizado</th>
                      <th className="p-2 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orcamentos.map((o) => (
                      <tr key={o._id} className="border-b">
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

        <footer className="text-center text-xs text-neutral-500">
          Dica: os dados, favoritos e orçamentos ficam apenas no seu dispositivo (localStorage). Para manter um backup, gere o PDF e arquive com seus clientes.
        </footer>
      </div>
    </div>
  );
}

function LabeledInput({ label, prefix, suffix, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-800">{label}</span>
      <div className="flex items-stretch overflow-hidden rounded-xl border border-neutral-300 focus-within:ring-2 focus-within:ring-black/20">
        {prefix && <span className="flex items-center px-3 text-neutral-500">{prefix}</span>}
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="decimal" className="min-w-0 flex-1 bg-white px-3 py-2 outline-none" />
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

/*
==================== PWA: ARQUIVOS QUE VOCÊ PRECISA CRIAR NO PROJETO ====================

1) public/manifest.webmanifest
--------------------------------
{
  "name": "WD ART'S — Orçamentos",
  "short_name": "Orçamentos",
  "start_url": ".",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#111111",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}

→ Adicione no seu index.html dentro de <head>:
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#111111" />

2) public/sw.js (Service Worker simples para cache offline)
--------------------------------
const CACHE = 'wd-arts-cache-v1';
const OFFLINE_URL = '/';
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([OFFLINE_URL]);
    self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return; 
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const fresh = await fetch(event.request);
      cache.put(event.request, fresh.clone());
      return fresh;
    } catch (err) {
      return cache.match(OFFLINE_URL);
    }
  })());
});

3) Ícones PWA
--------------------------------
Crie as imagens em /public/icons conforme as dimensões acima (192x192, 512x512 e maskable 512x512). Use sua logo centralizada em fundo transparente.

4) HTTPS + domínio
--------------------------------
PWA exige site em HTTPS. Se publicar na Vercel/Netlify, já vem com HTTPS.

========================================================================================
*/
