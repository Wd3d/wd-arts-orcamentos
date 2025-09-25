{/* LGPD Banner */}
{!lgpdAccepted && (
  <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
    <div className="mx-auto flex max-w-4xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-neutral-800">
        Utilizamos seus dados (e-mail e conteúdos de orçamentos) apenas para fornecer o serviço e sincronizar entre dispositivos.
        Ao continuar, você concorda com nossa{" "}
        <button onClick={() => setLgpdShowModal(true)} className="underline">
          Política de Privacidade
        </button>.
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
          Coletamos apenas e-mail (para autenticação) e os dados de orçamentos/suas configurações. Usamos para fornecer o serviço,
          gerar PDFs e sincronizar entre dispositivos. Não vendemos seus dados. Você pode solicitar a exclusão definitiva a
          qualquer momento usando o botão “Excluir conta”.
        </p>
        <ul>
          <li>Base legal: execução de contrato e consentimento (LGPD).</li>
          <li>Retenção: enquanto a conta estiver ativa ou conforme obrigações legais.</li>
          <li>Direitos: confirmação de tratamento, acesso, correção, anonimização, portabilidade e exclusão.</li>
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
