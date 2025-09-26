// ==== Auth handlers (mantém JSX limpo e evita desequilíbrio de chaves) ====
const handleForgot = async () => {
  try {
    ensureFirebase();
    if (!authEmail) { alert('Informe seu e-mail.'); return; }
    await sendPasswordResetEmail(getAuth(), authEmail);
    pushToast('E-mail de redefinição enviado.');
  } catch (e) { alert(e?.message || 'Falha ao enviar redefinição'); }
};

const handleSignIn = async () => {
  try {
    ensureFirebase();
    await signInWithEmailAndPassword(getAuth(), authEmail, authPass);
    setAuthOpen(false);
  } catch (e) {
    const code = e?.code || '';
    const msg = authMsg(code);
    if (code === 'auth/user-not-found') {
      if (window.confirm(msg + ' Deseja criar uma conta agora?')) setAuthMode('signup');
    } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
      if (window.confirm(msg + ' Deseja enviar e-mail de redefinição?')) await offerReset(authEmail);
    } else {
      alert(msg);
    }
  }
};

const handleSignUp = async () => {
  try {
    if (authPass !== signupPass2) { alert('As senhas não conferem.'); return; }
    ensureFirebase();
    const cred = await createUserWithEmailAndPassword(getAuth(), authEmail, authPass);
    if (signupLogoDataUrl) {
      try {
        await setDoc(doc(fbDb, 'users', cred.user.uid, 'meta', 'profile'), { logoDataUrl: signupLogoDataUrl, updatedAt: serverTimestamp() });
        setState((s)=> ({...s, logoDataUrl: signupLogoDataUrl}));
      } catch {}
    }
    setAuthOpen(false);
    setSignupPass2("");
    pushToast('Conta criada.');
  } catch (e) {
    const code = e?.code || '';
    if (code === 'auth/email-already-in-use') {
      const goSignIn = window.confirm('Este e-mail já está cadastrado. Deseja entrar com ele?');
      if (goSignIn) {
        setAuthMode('signin');
      } else {
        const send = window.confirm('Deseja enviar e-mail de redefinição de senha para este endereço?');
        if (send) await offerReset(authEmail);
      }
    } else {
      alert(authMsg(code));
    }
  }
};
