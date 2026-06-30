import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, push, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, setPersistence, inMemoryPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
import { firebaseConfig, VAPID_KEY } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

await setPersistence(auth, inMemoryPersistence);
if (auth.currentUser && auth.currentUser.isAnonymous) await signOut(auth);

let messaging = null;
try { messaging = getMessaging(app); } catch (e) { console.warn("Messaging indisponível:", e); }

const ADMIN_LOGIN_DOMAIN = "@admin.local";
const ADMIN_USERS = {
  claranjeiras: "Claranjeiras", hiary: "Hiary", igor: "Igor",
  vinicius: "Vinícius", rilton: "Rilton", paula: "Paula", bianca: "Bianca"
};

const CONFIG_QUADRAS_PADRAO = {
  1: { ativa: true, nome: "Quadra 1" },
  2: { ativa: true, nome: "Quadra 2" },
  3: { ativa: true, nome: "Quadra 3" },
  4: { ativa: false, nome: "Quadra 4" },
  5: { ativa: false, nome: "Quadra 5" }
};

let fila = [], filaKeys = [], filaContatos = {}, historico = [], quadras = [];
let configQuadras = {};
let whatsappAvisoAtivo = true, inscricoesOnlineAtivas = true;
let editandoId = null;
let historicoAberto = false;
let historicoDiasExpandidos = new Set();
let filaJaCarregouUmaVez = false;
let filaSnackbarSilenciadoAte = 0;
let adminUsuarioAtual = "", adminNomeAtual = "";
let adminReadyResolve;
const adminReady = new Promise((resolve) => { adminReadyResolve = resolve; });
let adminReadyLiberado = false;
let notificacoesSolicitadas = false;
let tipoSelecionado = "45";

// ---------- Helpers ----------

function formatarTimer(s) { return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`; }
function formatarHora(d) { return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function formatarChegada(d) { return new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function formatarData(d) { return d.toLocaleDateString("pt-BR"); }
function formatarTempoRelativo(minutos) {
  const total = Math.max(0, Math.round(Number(minutos) || 0));
  if (total <= 0) return "agora";
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60), m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
function escaparHtml(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escaparAttr(v) { return String(v ?? "").replace(/'/g, "&#39;").replace(/"/g, "&quot;"); }
function formatarNomesPareados(jogadores = []) {
  const nomes = (jogadores || []).filter(Boolean).map((n) => escaparHtml(n));
  if (nomes.length === 0) return "";
  const linhas = [];
  for (let i = 0; i < nomes.length; i += 2) {
    linhas.push(nomes.slice(i, i + 2).join(" • "));
  }
  return linhas.map((l) => `<div class="nomes-linha">${l}</div>`).join("");
}
function maskQL(v) {
  const n = v.replace(/\D/g, "").slice(0, 4);
  return n.length <= 2 ? n : `${n.slice(0, 2)}/${n.slice(2)}`;
}
function normalizarWhatsapp(v) {
  let n = String(v || "").replace(/\D/g, "");
  if (n.length === 10 || n.length === 11) n = "55" + n;
  return n.length >= 12 ? n : "";
}

document.addEventListener("input", (e) => {
  if (e.target.classList?.contains("p-ql")) e.target.value = maskQL(e.target.value);
  if (e.target.id?.startsWith("edit_") && e.target.id.endsWith("_ql")) e.target.value = maskQL(e.target.value);
});

// ---------- Generic modal ----------

function abrirModalGeral({ titulo = "Aviso", texto = "", tipo = "alerta", placeholder = "", valorInicial = "" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("modalGeral");
    const icon = document.getElementById("modalGeralIcon");
    const tituloEl = document.getElementById("modalGeralTitulo");
    const textoEl = document.getElementById("modalGeralTexto");
    const input = document.getElementById("modalGeralInput");
    const acoes = document.getElementById("modalGeralAcoes");
    const btnCancelar = document.getElementById("modalGeralCancelar");
    const btnConfirmar = document.getElementById("modalGeralConfirmar");

    const isAlert = tipo === "alerta", isPrompt = tipo === "prompt", isDanger = tipo === "danger";

    icon.innerHTML = `<i class="ri-${isDanger ? "alert-line" : isPrompt ? "edit-2-line" : isAlert ? "information-line" : "question-line"}"></i>`;
    tituloEl.textContent = titulo;
    textoEl.textContent = texto;
    input.style.display = isPrompt ? "block" : "none";
    input.value = valorInicial || "";
    input.placeholder = placeholder || "";
    acoes.classList.toggle("single", isAlert);
    btnCancelar.style.display = isAlert ? "none" : "inline-flex";
    btnConfirmar.textContent = isAlert ? "OK" : "Confirmar";
    btnConfirmar.classList.toggle("btn-danger", isDanger);
    btnConfirmar.classList.toggle("btn-solid", !isDanger);

    function fechar(resultado) {
      overlay.classList.remove("show");
      btnCancelar.onclick = null;
      btnConfirmar.onclick = null;
      input.onkeydown = null;
      resolve(resultado);
    }

    btnCancelar.onclick = () => fechar(isPrompt ? null : false);
    btnConfirmar.onclick = () => fechar(isPrompt ? input.value : true);
    input.onkeydown = (e) => { if (e.key === "Enter") fechar(input.value); if (e.key === "Escape") fechar(null); };

    overlay.classList.add("show");
    if (isPrompt) setTimeout(() => input.focus(), 80);
  });
}
const avisoAdmin = (texto, titulo = "Aviso") => abrirModalGeral({ titulo, texto, tipo: "alerta" });
const confirmarAdmin = (texto, titulo = "Confirmar", perigo = false) => abrirModalGeral({ titulo, texto, tipo: perigo ? "danger" : "confirm" });
const perguntarAdmin = (texto, titulo = "Informar", placeholder = "") => abrirModalGeral({ titulo, texto, tipo: "prompt", placeholder });

// ---------- Snackbar ----------

function mostrarSnackbar(texto, tipo = "info") {
  const root = document.getElementById("snackbarRoot");
  const item = document.createElement("div");
  item.className = `snackbar ${tipo}`;
  item.textContent = texto;
  root.appendChild(item);
  requestAnimationFrame(() => item.classList.add("show"));
  setTimeout(() => { item.classList.remove("show"); setTimeout(() => item.remove(), 250); }, 2600);
}

// ---------- Login ----------

function dadosAdminPorEmail(email) {
  const usuario = String(email || "").split("@")[0].trim().toLowerCase();
  return { usuario, nome: ADMIN_USERS[usuario] || usuario || "Administrador" };
}

function atualizarUsuarioLogadoAdmin(user) {
  const dados = dadosAdminPorEmail(user?.email || "");
  adminUsuarioAtual = dados.usuario;
  adminNomeAtual = dados.nome;
  document.getElementById("accountName").textContent = adminNomeAtual || "Administrador";
  document.getElementById("accountLogin").textContent = adminUsuarioAtual ? `@${adminUsuarioAtual}` : "@---";
}

function liberarPainelAdmin() {
  document.body.classList.remove("locked");
  if (!adminReadyLiberado) { adminReadyLiberado = true; adminReadyResolve(); }
  if (!notificacoesSolicitadas) {
    notificacoesSolicitadas = true;
    setTimeout(() => { if (Notification.permission !== "denied") ativarNotificacoes(); }, 1500);
  }
}
function bloquearPainelAdmin() {
  document.body.classList.add("locked");
  setTimeout(() => document.getElementById("loginUser")?.focus(), 100);
}

async function usuarioEhAdmin(user) {
  if (!user) return false;
  const snap = await get(ref(db, `admins/${user.uid}`));
  return snap.exists() && snap.val() === true;
}

function mostrarErroLogin(msg) {
  const erro = document.getElementById("loginError");
  erro.textContent = msg || "Usuário ou senha incorretos.";
  erro.classList.add("show");
}
function limparErroLogin() { document.getElementById("loginError").classList.remove("show"); }

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  limparErroLogin();
  const usuario = document.getElementById("loginUser").value.trim().toLowerCase();
  const senha = document.getElementById("loginPass").value;
  if (!usuario || !senha) return mostrarErroLogin("Informe usuário e senha.");
  if (!ADMIN_USERS[usuario]) {
    mostrarErroLogin("Usuário ou senha incorretos.");
    document.getElementById("loginPass").value = "";
    return;
  }
  try {
    if (auth.currentUser && auth.currentUser.isAnonymous) await signOut(auth);
    const cred = await signInWithEmailAndPassword(auth, `${usuario}${ADMIN_LOGIN_DOMAIN}`, senha);
    const permitido = await usuarioEhAdmin(cred.user);
    if (!permitido) {
      await signOut(auth);
      bloquearPainelAdmin();
      mostrarErroLogin("Este usuário não tem permissão de administrador.");
      return;
    }
    atualizarUsuarioLogadoAdmin(cred.user);
    document.getElementById("loginPass").value = "";
    liberarPainelAdmin();
  } catch (err) {
    console.error("Erro no login admin:", err);
    bloquearPainelAdmin();
    mostrarErroLogin("Usuário ou senha incorretos.");
    document.getElementById("loginPass").value = "";
  }
});

document.getElementById("btnLogout").addEventListener("click", async () => {
  adminUsuarioAtual = ""; adminNomeAtual = "";
  await signOut(auth);
  bloquearPainelAdmin();
  irParaTela(0);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) return bloquearPainelAdmin();
  try {
    const permitido = await usuarioEhAdmin(user);
    if (permitido) { atualizarUsuarioLogadoAdmin(user); liberarPainelAdmin(); }
    else { await signOut(auth); bloquearPainelAdmin(); }
  } catch (err) {
    console.error("Erro ao verificar permissão admin:", err);
    bloquearPainelAdmin();
  }
});

// ---------- Notifications ----------

async function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("sw.js?v=1.0", { scope: "/" });
}

async function ativarNotificacoes() {
  try {
    if (!("Notification" in window) || !messaging) return;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    const swReg = await registrarServiceWorker();
    if (!swReg) return;
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (!token) return;
    await set(ref(db, "adminTokens/" + encodeURIComponent(token)), {
      token, userAgent: navigator.userAgent, atualizadoEm: Date.now(), origem: location.hostname
    });
  } catch (e) { console.error("Erro ao ativar notificações:", e); }
}

if (messaging) {
  onMessage(messaging, (payload) => {
    if (payload?.notification && Notification.permission === "granted") {
      new Notification(payload.notification.title || "Laranjeiras Admin", { body: payload.notification.body || "" });
    }
  });
}

// ---------- Theme ----------

document.getElementById("themeToggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const icon = document.querySelector("#themeToggle i");
  icon.className = document.body.classList.contains("dark") ? "ri-sun-line" : "ri-moon-line";
  localStorage.setItem("tema", document.body.classList.contains("dark") ? "dark" : "light");
});
if (localStorage.getItem("tema") === "dark") {
  document.body.classList.add("dark");
}

// ---------- Screens (Início / Menu) ----------

const screensTrack = document.getElementById("screensTrack");
const screensWrap = document.getElementById("screensWrap");
const tabInicio = document.getElementById("tabInicio");
const tabMenu = document.getElementById("tabMenu");
let telaAtual = 0;

function irParaTela(idx) {
  if (telaAtual === idx) return;
  telaAtual = idx;
  screensTrack.classList.toggle("go-menu", idx === 1);
  tabInicio.classList.toggle("active", idx === 0);
  tabMenu.classList.toggle("active", idx === 1);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
tabInicio.addEventListener("click", () => irParaTela(0));
tabMenu.addEventListener("click", () => irParaTela(1));

document.getElementById("addPanelToggle").addEventListener("click", () => {
  document.getElementById("addPanelToggle").closest(".add-panel").classList.toggle("open");
});

document.getElementById("queueList").addEventListener("scroll", () => atualizarSombraFila(), { passive: true });

(function setupSwipeTelas() {
  let startX = null, startY = null, decided = false, isHorizontal = false;
  screensWrap.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; decided = false; isHorizontal = false;
  }, { passive: true });
  screensWrap.addEventListener("touchmove", (e) => {
    if (startX === null) return;
    const t = e.touches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) { decided = true; isHorizontal = Math.abs(dx) > Math.abs(dy); }
    }
  }, { passive: true });
  screensWrap.addEventListener("touchend", (e) => {
    if (startX === null || !isHorizontal) { startX = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    if (dx < -60 && telaAtual === 0) irParaTela(1);
    if (dx > 60 && telaAtual === 1) irParaTela(0);
    startX = null;
  });
})();

// ---------- Ripple feedback ----------

document.addEventListener("pointerdown", (e) => {
  const alvo = e.target.closest(".btn, .icon-btn, .queue-actions button, .court-toggle-btn, .toggle-pill, .tabbar-btn");
  if (!alvo) return;
  const rect = alvo.getBoundingClientRect();
  const tamanho = Math.max(rect.width, rect.height) * 1.4;
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  ripple.style.width = ripple.style.height = `${tamanho}px`;
  ripple.style.left = `${e.clientX - rect.left - tamanho / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - tamanho / 2}px`;
  alvo.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
});

// ---------- Quadras helpers ----------

function montarConfigQuadras(valor) {
  const base = JSON.parse(JSON.stringify(CONFIG_QUADRAS_PADRAO));
  if (valor && typeof valor === "object") {
    Object.keys(valor).forEach((id) => {
      base[id] = { ...base[id], ...valor[id] };
      if (typeof base[id].ativa !== "boolean") base[id].ativa = id <= 3;
      if (!base[id].nome) base[id].nome = `Quadra ${id}`;
    });
  }
  return base;
}

function normalizarQuadras(lista) {
  const existentes = Array.isArray(lista) ? lista.filter(Boolean) : Object.values(lista || {}).filter(Boolean);
  const mapa = {};
  existentes.forEach((q) => { if (q && q.id) mapa[q.id] = q; });
  for (let id = 1; id <= 5; id++) {
    if (!mapa[id]) mapa[id] = { id, ocupada: false, rodando: false, pausada: false, tempoRestante: 0, jogo: null, hEntrada: "", hSaida: "", horaTerminoAbsoluta: 0 };
  }
  return Object.values(mapa).sort((a, b) => a.id - b.id);
}

function quadraAtiva(id) { return (configQuadras?.[id] || CONFIG_QUADRAS_PADRAO[id])?.ativa !== false; }
function getQuadrasAtivas() { return (quadras || []).filter((q) => q && quadraAtiva(q.id)); }
function getIdsQuadrasAtivas() { return getQuadrasAtivas().map((q) => q.id); }

function getTempoQuadraParaPrevisao(q) {
  if (!q || !q.ocupada) return { id: q?.id || "-", tempoSeg: 0, incerta: false };
  if (q.rodando && !q.pausada) return { id: q.id, tempoSeg: Math.max(0, q.tempoRestante || 0), incerta: false };
  if (q.pausada) return { id: q.id, tempoSeg: Math.max(0, q.tempoRestante || 0), incerta: true };
  return { id: q.id, tempoSeg: Math.max(0, q.tempoRestante || ((q.jogo?.duracao || 45) * 60)), incerta: true };
}

function calcularProgresso(q) {
  const total = Math.max(1, (q?.jogo?.duracao || 45) * 60);
  const restante = Math.max(0, Number(q?.tempoRestante) || 0);
  return Math.max(0, Math.min(100, (restante / total) * 100));
}

function salvarQuadras() { set(ref(db, "quadras"), quadras); }
function salvarHistorico() { set(ref(db, "historico"), historico); }

function prepararEncerramentoParaHistorico(q) {
  if (!q || !q.jogo) return;
  const agora = new Date();
  const fimPrevistoMs = Number(q.horaTerminoAbsoluta || 0);
  const jogoJaZerou = q.rodando && fimPrevistoMs > 0 && Date.now() >= fimPrevistoMs;
  if (jogoJaZerou) {
    const fimPrevisto = new Date(fimPrevistoMs);
    q.hFimReal = q.hSaida || formatarHora(fimPrevisto);
    q.encerradoEm = fimPrevisto.toISOString();
  } else {
    q.hFimReal = formatarHora(agora);
    q.encerradoEm = agora.toISOString();
  }
}

function salvarJogoNoHistorico(q) {
  if (!q || !q.jogo) return;
  historico.unshift({
    id: Date.now() + Math.random(),
    n: q.jogo.nomes || "", detalhes: q.jogo.detalhes || "", q: q.id,
    t: q.hEntrada || "", f: q.hFimReal || q.hSaida || formatarHora(new Date()),
    data: q.encerradoEm || new Date().toISOString(),
    duracao: q.jogo.duracao || 45, jogadores: q.jogo.jogadores || [], qls: q.jogo.qls || [], chegada: q.jogo.chegada || ""
  });
  salvarHistorico();
}

// ---------- Court actions ----------

window.togglePausa = function (i) {
  const q = quadras.find((x) => x.id === i);
  if (!q || !q.ocupada) return;
  q.pausada = !q.pausada;
  if (!q.pausada && q.rodando) {
    q.horaTerminoAbsoluta = Date.now() + q.tempoRestante * 1000;
    q.hSaida = formatarHora(new Date(q.horaTerminoAbsoluta));
  }
  salvarQuadras();
};

async function despacharFila(idx, quadraId) {
  const q = quadras.find((x) => x.id === quadraId);
  if (!q) return avisoAdmin(`Quadra ${quadraId} não encontrada.`);
  filaSnackbarSilenciadoAte = Date.now() + 900;
  const j = fila[idx];
  const key = filaKeys[idx];
  fila.splice(idx, 1);
  filaKeys.splice(idx, 1);
  q.jogo = j; q.ocupada = true; q.rodando = false; q.pausada = false;
  q.tempoRestante = j.duracao * 60; q.notificadoFim = false; q.encerradoEm = null; q.hFimReal = "";
  if (key) {
    try {
      await Promise.all([remove(ref(db, `fila/${key}`)), remove(ref(db, `filaContatos/${key}`)).catch(() => null)]);
      salvarQuadras();
      mostrarSnackbar(`Jogo chamado para a Quadra ${quadraId}. A fila andou.`, "success");
    } catch (e) { avisoAdmin("Erro ao chamar: " + e); }
  }
}

window.chamar = function (i) {
  if (fila.length === 0) return avisoAdmin("Fila vazia!");
  if (!quadraAtiva(i)) return avisoAdmin(`Quadra ${i} está desativada.`);
  despacharFila(0, i);
};

window.chamarDireto = async function (id) {
  const idsAtivos = getIdsQuadrasAtivas();
  const resposta = await perguntarAdmin(`Para qual quadra? (${idsAtivos.join(", ")})`, "Chamar para quadra", idsAtivos.join(", "));
  const i = parseInt(resposta);
  if (!idsAtivos.includes(i)) return;
  const q = quadras.find((x) => x.id === i);
  if (q?.ocupada) return avisoAdmin("Quadra ocupada!");
  const idx = fila.findIndex((x) => x.id === id);
  if (idx === -1) return;
  despacharFila(idx, i);
};

window.iniciarPartida = function (i) {
  const q = quadras.find((x) => x.id === i);
  const ag = new Date();
  q.rodando = true; q.pausada = false;
  q.hEntrada = formatarHora(ag);
  q.hSaida = formatarHora(new Date(ag.getTime() + q.jogo.duracao * 60000));
  q.horaTerminoAbsoluta = ag.getTime() + q.tempoRestante * 1000;
  q.notificadoFim = false; q.encerradoEm = null; q.hFimReal = "";
  salvarQuadras();
  mostrarSnackbar(`Partida iniciada na Quadra ${i}.`, "success");
};

window.ajustarInicio = async function (i) {
  const q = quadras.find((x) => x.id === i);
  const hm = await perguntarAdmin("Que horas começou?", "Ajustar início", "Ex: 14:30");
  if (!hm || !hm.includes(":")) return;
  const [h, m] = hm.split(":");
  const ag = new Date();
  const ini = new Date();
  ini.setHours(parseInt(h)); ini.setMinutes(parseInt(m)); ini.setSeconds(0);
  if (ini > ag) return avisoAdmin("Hora de início não pode ser no futuro!");
  q.rodando = true; q.pausada = false;
  q.hEntrada = formatarHora(ini);
  q.hSaida = formatarHora(new Date(ini.getTime() + q.jogo.duracao * 60000));
  q.horaTerminoAbsoluta = ini.getTime() + q.jogo.duracao * 60000;
  q.tempoRestante = Math.max(0, Math.ceil((q.horaTerminoAbsoluta - ag) / 1000));
  q.notificadoFim = false; q.encerradoEm = null; q.hFimReal = "";
  salvarQuadras();
};

window.reiniciarTimer = async function (i) {
  if (!(await confirmarAdmin("Reiniciar o tempo?", "Reiniciar timer"))) return;
  const q = quadras.find((x) => x.id === i);
  if (!q.ocupada) return;
  const ag = new Date();
  q.tempoRestante = q.jogo.duracao * 60; q.pausada = false;
  q.hEntrada = formatarHora(ag);
  q.hSaida = formatarHora(new Date(ag.getTime() + q.jogo.duracao * 60000));
  q.horaTerminoAbsoluta = ag.getTime() + q.tempoRestante * 1000;
  q.notificadoFim = false; q.encerradoEm = null; q.hFimReal = "";
  salvarQuadras();
};

window.sair = async function (i) {
  const q = quadras.find((x) => x.id === i);
  if (!q || !q.ocupada) return avisoAdmin("Quadra já está livre!");
  if (!(await confirmarAdmin(`Encerrar jogo da Quadra ${i}?`, "Encerrar jogo", true))) return;
  if (q.rodando && q.jogo) { prepararEncerramentoParaHistorico(q); salvarJogoNoHistorico(q); }
  q.ocupada = false; q.rodando = false; q.pausada = false; q.jogo = null;
  q.tempoRestante = 0; q.horaTerminoAbsoluta = 0; q.hEntrada = ""; q.hSaida = ""; q.encerradoEm = null; q.hFimReal = "";
  salvarQuadras();
  mostrarSnackbar(`Quadra ${i} liberada.`, "info");
};

window.repetirJogo = async function (i) {
  const q = quadras.find((x) => x.id === i);
  if (!q || !q.ocupada || !q.jogo) return;
  if (!(await confirmarAdmin(`Rodar novamente o jogo da Quadra ${i}?`, "Rodar novamente"))) return;
  prepararEncerramentoParaHistorico(q);
  salvarJogoNoHistorico(q);
  const agora = new Date();
  const novoJogo = { ...q.jogo, id: Date.now(), chegada: new Date().toISOString() };
  q.jogo = novoJogo; q.ocupada = true; q.rodando = true; q.pausada = false;
  q.tempoRestante = (novoJogo.duracao || 45) * 60;
  q.hEntrada = formatarHora(agora);
  q.hSaida = formatarHora(new Date(agora.getTime() + q.tempoRestante * 1000));
  q.horaTerminoAbsoluta = agora.getTime() + q.tempoRestante * 1000;
  q.notificadoFim = false; q.encerradoEm = null; q.hFimReal = "";
  salvarQuadras();
};

window.mover = async function (o) {
  const idsAtivos = getIdsQuadrasAtivas();
  const resp = await perguntarAdmin(`Para qual quadra? (${idsAtivos.join(", ")})`, "Mover para quadra", idsAtivos.join(", "));
  const d = parseInt(resp);
  if (!idsAtivos.includes(d) || d === o) return;
  const qO = quadras.find((x) => x.id === o);
  const qD = quadras.find((x) => x.id === d);
  if (!qO || !qD) return avisoAdmin("Quadra não encontrada.");

  if (qD.ocupada) {
    if (!(await confirmarAdmin(`Quadra ${d} ocupada. Inverter?`, "Inverter quadras"))) return;
    const t = { ...qD };
    Object.assign(qD, { jogo: qO.jogo, tempoRestante: qO.tempoRestante, horaTerminoAbsoluta: qO.horaTerminoAbsoluta, rodando: qO.rodando, pausada: qO.pausada, hEntrada: qO.hEntrada, hSaida: qO.hSaida, encerradoEm: qO.encerradoEm || null, hFimReal: qO.hFimReal || "", ocupada: true });
    Object.assign(qO, { jogo: t.jogo, tempoRestante: t.tempoRestante, horaTerminoAbsoluta: t.horaTerminoAbsoluta, rodando: t.rodando, pausada: t.pausada, hEntrada: t.hEntrada, hSaida: t.hSaida, encerradoEm: t.encerradoEm || null, hFimReal: t.hFimReal || "", ocupada: true });
  } else {
    Object.assign(qD, { jogo: qO.jogo, tempoRestante: qO.tempoRestante, hSaida: qO.hSaida, hEntrada: qO.hEntrada, encerradoEm: qO.encerradoEm || null, hFimReal: qO.hFimReal || qO.hSaida || "", horaTerminoAbsoluta: qO.horaTerminoAbsoluta, ocupada: true, rodando: qO.rodando, pausada: qO.pausada });
    Object.assign(qO, { ocupada: false, rodando: false, pausada: false, jogo: null, encerradoEm: null, hFimReal: "" });
  }
  salvarQuadras();
};

// ---------- Add to queue ----------

document.getElementById("tipoJogoGroup").addEventListener("click", (e) => {
  const btn = e.target.closest(".segmented-opt");
  if (!btn) return;
  tipoSelecionado = btn.dataset.valor;
  document.querySelectorAll("#tipoJogoGroup .segmented-opt").forEach((b) => b.classList.toggle("active", b === btn));
  document.getElementById("playersGrid").classList.toggle("is-duplas", tipoSelecionado === "60");
});

function perguntarWhatsappAdmin() {
  if (!whatsappAvisoAtivo) return Promise.resolve({ desejaWhatsapp: false, whatsapp: "" });
  return new Promise((resolve) => {
    const overlay = document.getElementById("modalWhatsapp");
    const titulo = document.getElementById("wppTitulo");
    const texto = document.getElementById("wppTexto");
    const inputWrap = document.getElementById("wppInputWrap");
    const input = document.getElementById("wppInput");
    const erro = document.getElementById("wppErro");
    const btnCancelar = document.getElementById("wppCancelar");
    const btnConfirmar = document.getElementById("wppConfirmar");

    let etapa = "pergunta";
    function fechar(resultado) {
      overlay.classList.remove("show");
      btnCancelar.onclick = null; btnConfirmar.onclick = null;
      resolve(resultado || { desejaWhatsapp: false, whatsapp: "" });
    }
    function mostrarPergunta() {
      etapa = "pergunta";
      titulo.textContent = "Receber aviso?";
      texto.textContent = "Salvar um número de WhatsApp para avisar quando a vez estiver chegando?";
      inputWrap.style.display = "none"; erro.style.display = "none"; input.value = "";
      btnCancelar.textContent = "Agora não"; btnConfirmar.textContent = "Salvar WhatsApp";
    }
    function mostrarNumero() {
      etapa = "numero";
      titulo.textContent = "WhatsApp para aviso";
      texto.textContent = "Digite o número com DDD para receber o aviso.";
      inputWrap.style.display = "block"; erro.style.display = "none";
      btnCancelar.textContent = "Cancelar"; btnConfirmar.textContent = "Salvar";
      setTimeout(() => input.focus(), 80);
    }
    mostrarPergunta();
    overlay.classList.add("show");
    btnCancelar.onclick = () => fechar({ desejaWhatsapp: false, whatsapp: "" });
    btnConfirmar.onclick = () => {
      if (etapa === "pergunta") return mostrarNumero();
      const numero = normalizarWhatsapp(input.value || "");
      if (!numero || numero.length < 12) { erro.style.display = "block"; input.focus(); return; }
      fechar({ desejaWhatsapp: true, whatsapp: numero });
    };
  });
}

document.getElementById("btnAdicionarFila").addEventListener("click", async () => {
  const n = [1, 2, 3, 4].map((i) => document.getElementById(`j${i}_nome`).value.trim()).filter((x) => x !== "");
  const ql = [1, 2, 3, 4].map((i) => document.getElementById(`j${i}_ql`).value.trim()).filter((x) => x !== "");
  const min = tipoSelecionado === "45" ? 2 : 3;
  if (n.length < min) return avisoAdmin(`Mínimo ${min} jogadores!`);
  const avisoWpp = await perguntarWhatsappAdmin();
  const nj = {
    id: Date.now(), nomes: n.join(" • "), detalhes: ql.join(", "), duracao: parseInt(tipoSelecionado),
    chegada: new Date().toISOString(), jogadores: n, qls: ql, origem: "admin",
    criadoPorUid: auth.currentUser?.uid || "admin", desejaWhatsapp: avisoWpp.desejaWhatsapp
  };
  try {
    const novoRef = await push(ref(db, "fila"), nj);
    if (avisoWpp.desejaWhatsapp && avisoWpp.whatsapp) {
      const contato = { whatsapp: avisoWpp.whatsapp, criadoPorUid: auth.currentUser?.uid || "admin", criadoEm: Date.now(), origem: "admin" };
      filaContatos[novoRef.key] = contato;
      renderFila();
      await set(ref(db, `filaContatos/${novoRef.key}`), contato).catch((e) => console.error(e));
    }
    document.querySelectorAll("#playersGrid input").forEach((i) => (i.value = ""));
    mostrarSnackbar("Inscrição adicionada à fila.", "success");
  } catch (e) { avisoAdmin("Erro ao adicionar: " + e); }
});

window.removerFila = async function (id) {
  if (!(await confirmarAdmin("Remover este jogo da fila?", "Remover da fila", true))) return;
  const index = fila.findIndex((item) => item.id === id);
  if (index !== -1 && filaKeys[index]) {
    const key = filaKeys[index];
    try {
      await Promise.all([remove(ref(db, `fila/${key}`)), remove(ref(db, `filaContatos/${key}`)).catch(() => null)]);
      mostrarSnackbar("Inscrição removida da fila.", "warning");
    } catch (e) { avisoAdmin("Erro ao remover: " + e); }
  }
};

// ---------- WhatsApp notify ----------

function obterWhatsappInscricao(inscricao, contatoPrivado) {
  const fontes = [typeof contatoPrivado === "string" ? contatoPrivado : "", contatoPrivado?.whatsapp, inscricao?.whatsapp];
  for (const f of fontes) { const num = normalizarWhatsapp(f); if (num) return num; }
  return "";
}
function inscricaoOptouWhatsapp(inscricao, contatoPrivado) {
  return inscricao?.desejaWhatsapp === true || !!obterWhatsappInscricao(inscricao, contatoPrivado);
}

window.avisarWhatsapp = async function (chaveFila, numeroInicial, posicao, quadra, horario) {
  if (Number(posicao) !== 1) return avisoAdmin("O aviso só está disponível para o primeiro da fila.");
  let n = normalizarWhatsapp(numeroInicial);
  if (!n && chaveFila && filaContatos[chaveFila]) n = obterWhatsappInscricao({}, filaContatos[chaveFila]);
  if (!n) return avisoAdmin("Esta inscrição marcou WhatsApp, mas o número não foi encontrado.");
  const previsaoTexto = quadra && horario && quadra !== "-"
    ? `Você é o próximo da fila para a Quadra ${quadra}, com previsão por volta de ${horario}.`
    : "Você é o próximo da fila. Acompanhe a chamada pelo aplicativo ou procure o fiscal.";
  const mensagem = `Olá! Sua vez está chegando.\n\n${previsaoTexto}\n\nFique por perto e acompanhe a chamada.`;
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(mensagem)}`, "_blank");
};

// ---------- Edit queue item ----------

window.abrirEdicao = function (id) {
  const it = fila.find((x) => x.id === id);
  if (!it) return;
  editandoId = id;
  [1, 2, 3, 4].forEach((i) => {
    document.getElementById(`edit_j${i}_nome`).value = it.jogadores?.[i - 1] || "";
    document.getElementById(`edit_j${i}_ql`).value = it.qls?.[i - 1] || "";
  });
  document.getElementById("edit_tipo").value = it.duracao;
  document.querySelector(".modal-players").classList.toggle("is-duplas", it.duracao === 60);
  document.getElementById("modalEdit").classList.add("show");
};

document.getElementById("edit_tipo").addEventListener("change", (e) => {
  document.querySelector(".modal-players").classList.toggle("is-duplas", e.target.value === "60");
});

document.getElementById("btnEditCancelar").addEventListener("click", () => {
  document.getElementById("modalEdit").classList.remove("show");
  editandoId = null;
});

document.getElementById("btnEditSalvar").addEventListener("click", async () => {
  if (!editandoId) return;
  const index = fila.findIndex((x) => x.id === editandoId);
  if (index === -1) return;
  const it = fila[index];
  const ehDupla = document.getElementById("edit_tipo").value === "60";
  const n = [], ql = [];
  [1, 2].forEach((i) => {
    const nome = document.getElementById(`edit_j${i}_nome`).value.trim();
    if (nome) { n.push(nome); ql.push(document.getElementById(`edit_j${i}_ql`).value.trim()); }
  });
  if (ehDupla) {
    [3, 4].forEach((i) => {
      const nome = document.getElementById(`edit_j${i}_nome`).value.trim();
      if (nome) { n.push(nome); ql.push(document.getElementById(`edit_j${i}_ql`).value.trim()); }
    });
  }
  const min = ehDupla ? 3 : 2;
  if (n.length < min) return avisoAdmin(`Mínimo ${min} jogadores!`);
  it.nomes = n.join(" • "); it.detalhes = ql.join(", "); it.duracao = ehDupla ? 60 : 45;
  it.jogadores = n; it.qls = ql;
  if (filaKeys[index]) {
    try {
      await set(ref(db, `fila/${filaKeys[index]}`), it);
      document.getElementById("modalEdit").classList.remove("show");
      editandoId = null;
    } catch (e) { avisoAdmin("Erro ao salvar: " + e); }
  }
});

// ---------- Config toggles ----------

document.getElementById("btnToggleWhatsapp").addEventListener("click", async () => {
  const novoValor = !whatsappAvisoAtivo;
  if (!(await confirmarAdmin(`Deseja ${novoValor ? "ativar" : "desativar"} o aviso por WhatsApp?`, "Aviso pelo WhatsApp"))) return;
  set(ref(db, "config/whatsappAvisoAtivo"), novoValor).catch((e) => avisoAdmin("Erro: " + e));
});

document.getElementById("btnToggleInscricoes").addEventListener("click", async () => {
  const novoValor = !inscricoesOnlineAtivas;
  if (!(await confirmarAdmin(`Deseja ${novoValor ? "abrir" : "fechar"} as inscrições online?`, "Inscrições online"))) return;
  set(ref(db, "config/inscricoesOnlineAtivas"), novoValor).catch((e) => avisoAdmin("Erro: " + e));
});

window.toggleQuadraAtiva = async function (id) {
  const cfgAtual = configQuadras[id] || CONFIG_QUADRAS_PADRAO[id];
  const novaAtiva = !(cfgAtual.ativa !== false);
  const q = quadras.find((x) => x.id === id);
  if (!novaAtiva) {
    if (getIdsQuadrasAtivas().length <= 1) return avisoAdmin("É preciso manter pelo menos uma quadra ativa.");
    if (q && q.ocupada) return avisoAdmin(`A Quadra ${id} está ocupada. Encerre ou mova o jogo antes de desativar.`);
  }
  if (!(await confirmarAdmin(`Deseja ${novaAtiva ? "ativar" : "desativar"} a Quadra ${id}?`, "Quadras ativas"))) return;
  set(ref(db, `config/quadras/${id}`), { ...(cfgAtual || {}), nome: `Quadra ${id}`, ativa: novaAtiva }).catch((e) => avisoAdmin("Erro: " + e));
};

function renderConfigQuadras() {
  document.getElementById("courtsToggleGrid").innerHTML = Object.keys(CONFIG_QUADRAS_PADRAO).map((id) => {
    const ativa = (configQuadras[id] || CONFIG_QUADRAS_PADRAO[id]).ativa !== false;
    return `<button type="button" class="court-toggle-btn ${ativa ? "active" : ""}" onclick="toggleQuadraAtiva(${id})">Q${id}</button>`;
  }).join("");
}
function atualizarBotaoWhatsapp() {
  const btn = document.getElementById("btnToggleWhatsapp");
  btn.textContent = whatsappAvisoAtivo ? "Ativo" : "Desativado";
  btn.classList.toggle("off", !whatsappAvisoAtivo);
}
function atualizarBotaoInscricoes() {
  const btn = document.getElementById("btnToggleInscricoes");
  btn.textContent = inscricoesOnlineAtivas ? "Abertas" : "Fechadas";
  btn.classList.toggle("off", !inscricoesOnlineAtivas);
}

// ---------- History ----------

document.getElementById("btnHistorico").addEventListener("click", () => {
  historicoAberto = !historicoAberto;
  document.getElementById("historicoBody").classList.toggle("show", historicoAberto);
  if (historicoAberto) renderHistoricoAgrupado();
});

window.toggleDia = function (id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("show");
  if (el.classList.contains("show")) historicoDiasExpandidos.add(id);
  else historicoDiasExpandidos.delete(id);
};

window.apagarDoHistorico = async function (id) {
  if (!(await confirmarAdmin("Apagar este jogo do histórico?", "Apagar histórico", true))) return;
  historico = historico.filter((h) => h.id !== id);
  salvarHistorico();
  if (historicoAberto) renderHistoricoAgrupado();
};

function renderHistoricoAgrupado() {
  const div = document.getElementById("historicoBody");
  if (historico.length === 0) {
    div.innerHTML = `<div class="hist-header"><strong>Histórico</strong><button class="btn btn-outline btn-small" id="btnExportarTudo"><i class="ri-download-2-line"></i> Exportar</button></div><div class="empty-state">Nenhum jogo finalizado</div>`;
    document.getElementById("btnExportarTudo")?.addEventListener("click", exportarParaExcel);
    return;
  }
  const ag = {};
  historico.forEach((j) => {
    const d = formatarData(new Date(j.data));
    (ag[d] = ag[d] || []).push(j);
  });
  const datas = Object.keys(ag).sort((a, b) => new Date(b.split("/").reverse().join("-")) - new Date(a.split("/").reverse().join("-")));
  let html = `<div class="hist-header"><strong>Histórico (${historico.length})</strong><div class="hist-export-row"><select id="dataExportar">${datas.map((d) => `<option value="${d}">${d}</option>`).join("")}</select><button class="btn btn-outline btn-small" id="btnExportarData"><i class="ri-download-2-line"></i></button></div></div>`;
  datas.forEach((dk) => {
    const idDia = `dia-${dk.replace(/\//g, "-")}`;
    const expandido = historicoDiasExpandidos.has(idDia);
    html += `<div class="hist-day"><div class="hist-day-head" onclick="toggleDia('${idDia}')"><span>${dk} (${ag[dk].length})</span><i class="ri-arrow-down-s-line"></i></div><div class="hist-day-games ${expandido ? "show" : ""}" id="${idDia}">`;
    ag[dk].forEach((j) => {
      html += `<div class="hist-game-item"><div><strong>${escaparHtml(j.n)}</strong><br><small>${j.t} - ${j.f} · ${escaparHtml(j.detalhes || "")} · Q${j.q}</small></div><button onclick="apagarDoHistorico(${j.id})"><i class="ri-delete-bin-line"></i></button></div>`;
    });
    html += `</div></div>`;
  });
  div.innerHTML = html;
  document.getElementById("btnExportarData")?.addEventListener("click", exportarPorData);
}

function exportarPorData() {
  const ds = document.getElementById("dataExportar")?.value;
  if (!ds) return avisoAdmin("Selecione uma data!");
  const jogos = historico.filter((j) => formatarData(new Date(j.data)) === ds);
  if (!jogos.length) return avisoAdmin("Nenhum jogo nesta data!");
  gerarXLSX(jogos, ds);
}
function exportarParaExcel() {
  if (!historico.length) return avisoAdmin("Nenhum dado!");
  gerarXLSX(historico, null);
}

function gerarXLSX(lista, dataFiltro) {
  if (typeof XLSX === "undefined") return avisoAdmin("Biblioteca de exportação não carregada.");
  const wb = XLSX.utils.book_new();
  const dataE = dataFiltro || new Date().toLocaleDateString("pt-BR");
  const ws = {};
  const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  const border = (style = "thin") => ({ style, color: { rgb: "000000" } });
  const makeBorder = ({ top = "thin", bottom = "thin", left = "thin", right = "thin" } = {}) => ({ top: border(top), bottom: border(bottom), left: border(left), right: border(right) });
  function estiloBase({ bold = false, size = 12, fill = null, b = makeBorder() } = {}) {
    const s = { font: { name: "Arial", sz: size, bold }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: b };
    if (fill) s.fill = { patternType: "solid", fgColor: { rgb: fill } };
    return s;
  }
  function setCell(addr, value, style) { ws[addr] = { v: value ?? "", t: "s", s: style || estiloBase() }; }

  ws["!merges"] = [{ s: { r: 0, c: 1 }, e: { r: 0, c: 6 } }, { s: { r: 0, c: 7 }, e: { r: 0, c: 8 } }];
  setCell("B1", "FILA ÚNICA - LARANJEIRAS", estiloBase({ bold: true, size: 16, b: makeBorder({ top: "medium", bottom: "medium", left: "medium", right: "medium" }) }));
  setCell("H1", `Data: ${dataE}`, estiloBase({ bold: true, size: 16, b: makeBorder({ top: "medium", bottom: "medium", left: "medium", right: "medium" }) }));

  const headers = ["", "Quadra", "Jogador(es)", "Q/L", "Jogador(es)", "Q/L", "Chegada", "Entrada", "Saída"];
  headers.forEach((h, i) => { if (i) setCell(`${COLS[i]}3`, h, estiloBase({ size: 12, fill: i === 6 ? "D9D9D9" : null, b: makeBorder({ top: "medium", bottom: "medium" }) })); });

  let linha = 4;
  lista.slice().sort((a, b) => new Date(a.data) - new Date(b.data)).forEach((j) => {
    const jogadores = j.jogadores || [], qls = j.qls || [];
    const chegada = j.chegada ? formatarChegada(j.chegada) : "";
    const r1 = linha, r2 = linha + 1;
    setCell(`B${r1}`, j.q || "", estiloBase({ b: makeBorder({ top: "medium" }) }));
    setCell(`C${r1}`, jogadores[0] || "", estiloBase({ b: makeBorder({ top: "medium" }) }));
    setCell(`D${r1}`, qls[0] || "", estiloBase({ b: makeBorder({ top: "medium" }) }));
    setCell(`E${r1}`, jogadores[1] || "", estiloBase({ b: makeBorder({ top: "medium" }) }));
    setCell(`F${r1}`, qls[1] || "", estiloBase({ b: makeBorder({ top: "medium" }) }));
    setCell(`G${r1}`, chegada, estiloBase({ fill: "D9D9D9", b: makeBorder({ top: "medium" }) }));
    setCell(`H${r1}`, j.t || "", estiloBase({ b: makeBorder({ top: "medium" }) }));
    setCell(`I${r1}`, j.f || "", estiloBase({ b: makeBorder({ top: "medium" }) }));
    setCell(`B${r2}`, "", estiloBase({ b: makeBorder({ bottom: "medium" }) }));
    setCell(`C${r2}`, jogadores[2] || "", estiloBase({ b: makeBorder({ bottom: "medium" }) }));
    setCell(`D${r2}`, qls[2] || "", estiloBase({ b: makeBorder({ bottom: "medium" }) }));
    setCell(`E${r2}`, jogadores[3] || "", estiloBase({ b: makeBorder({ bottom: "medium" }) }));
    setCell(`F${r2}`, qls[3] || "", estiloBase({ b: makeBorder({ bottom: "medium" }) }));
    setCell(`G${r2}`, "", estiloBase({ fill: "D9D9D9", b: makeBorder({ bottom: "medium" }) }));
    setCell(`H${r2}`, "", estiloBase({ b: makeBorder({ bottom: "medium" }) }));
    setCell(`I${r2}`, "", estiloBase({ b: makeBorder({ bottom: "medium" }) }));
    ws["!merges"].push(
      { s: { r: r1 - 1, c: 1 }, e: { r: r2 - 1, c: 1 } },
      { s: { r: r1 - 1, c: 6 }, e: { r: r2 - 1, c: 6 } },
      { s: { r: r1 - 1, c: 7 }, e: { r: r2 - 1, c: 7 } },
      { s: { r: r1 - 1, c: 8 }, e: { r: r2 - 1, c: 8 } }
    );
    linha += 2;
  });

  ws["!cols"] = [{ wch: 3 }, { wch: 10 }, { wch: 26 }, { wch: 10 }, { wch: 26 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 12 }];
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linha - 2, c: 8 } });
  XLSX.utils.book_append_sheet(wb, ws, "Fila");
  XLSX.writeFile(wb, `Fila_Laranjeiras_${dataE.replace(/\//g, "-")}.xlsx`);
  avisoAdmin("Planilha exportada!", "Exportação concluída");
}

// ---------- Render: courts ----------

function renderQuadras() {
  const container = document.getElementById("courtsRow");
  const ativas = getQuadrasAtivas().filter(Boolean);
  if (!quadras || quadras.length === 0) {
    container.innerHTML = `<div class="court-skel"></div><div class="court-skel"></div><div class="court-skel"></div>`;
    return;
  }

  container.innerHTML = ativas.map((q) => {
    if (!q.ocupada) {
      return `<div class="court-card free">
        <div class="court-badge free">Q${q.id}</div>
        <div class="court-free-msg-rich"><i class="ri-tennis-ball-line"></i></div>
        <div class="court-players">Livre</div>
        <div class="court-free-msg">Disponível para próximo jogo</div>
        <button class="btn btn-solid btn-block ${fila.length === 0 ? "is-empty" : ""}" onclick="chamar(${q.id})"><i class="ri-megaphone-line"></i> Chamar</button>
      </div>`;
    }
    const duracao = q.jogo?.duracao || 45;
    const tipoTexto = duracao === 60 ? "Duplas" : "Simples";
    const jogoEncerrado = !!q.encerradoEm || (q.rodando && (q.tempoRestante || 0) <= 0);
    const quaseAcabando = q.rodando && !q.pausada && !jogoEncerrado && (q.tempoRestante || 0) <= 300;
    const statusTexto = jogoEncerrado ? `Encerrado ${(q.hFimReal || q.hSaida) ? "às " + (q.hFimReal || q.hSaida) : ""}` : q.pausada ? "Pausada" : q.rodando ? `Termina ${q.hSaida}` : "Aguardando início";
    const estadoClasse = `${jogoEncerrado ? "finished" : q.pausada ? "paused" : q.rodando ? "running" : ""} ${quaseAcabando ? "ending-soon" : ""}`.trim();

    const acoes = jogoEncerrado
      ? `<button class="btn btn-danger" onclick="sair(${q.id})">Encerrar</button><button class="btn btn-solid" onclick="repetirJogo(${q.id})"><i class="ri-restart-line"></i> Repetir</button>`
      : (q.rodando || q.pausada)
        ? `<button class="btn btn-outline" onclick="mover(${q.id})">Mover</button><button class="btn btn-outline" onclick="reiniciarTimer(${q.id})"><i class="ri-restart-line"></i></button><button class="btn btn-outline" onclick="ajustarInicio(${q.id})">Início</button><button class="btn ${q.pausada ? "btn-solid" : "btn-accent"}" onclick="togglePausa(${q.id})">${q.pausada ? "Retomar" : "Pausa"}</button><button class="btn btn-danger" onclick="sair(${q.id})">Sair</button>`
        : `<button class="btn btn-solid" onclick="iniciarPartida(${q.id})">Iniciar</button><button class="btn btn-danger" onclick="sair(${q.id})">Cancelar</button>`;

    return `<div class="court-card ${estadoClasse}">
      <div class="court-top">
        <div class="court-badge">Q${q.id}</div>
        <div>
          <div class="court-players">${formatarNomesPareados(q.jogo?.jogadores)}</div>
          <div class="court-meta">${statusTexto} <span class="type-chip ${duracao === 60 ? "dupla" : "simples"}">${tipoTexto}</span></div>
        </div>
      </div>
      <div id="timer-q${q.id}" class="court-timer">${formatarTimer(q.tempoRestante || 0)}</div>
      <div class="progress-track"><div id="progress-q${q.id}" class="progress-bar ${quaseAcabando ? "ending" : ""} ${jogoEncerrado ? "finished" : ""}" style="width:${calcularProgresso(q)}%"></div></div>
      <div class="court-actions">${acoes}</div>
    </div>`;
  }).join("");
}

function atualizarProgressoQuadra(q) {
  const barra = document.getElementById(`progress-q${q.id}`);
  if (!barra) return;
  const restante = Math.max(0, Number(q.tempoRestante) || 0);
  barra.style.width = `${calcularProgresso(q)}%`;
  barra.classList.toggle("ending", restante > 0 && restante <= 300);
  barra.classList.toggle("finished", restante <= 0 || !!q.encerradoEm);
}

// ---------- Render: queue ----------

const ehDispositivoTouch = window.matchMedia("(pointer: coarse)").matches;
let posicoesAnteriores = new Map();

function atualizarSombraFila() {
  const corpo = document.getElementById("queueList");
  if (!corpo) return;
  const temMais = corpo.scrollHeight > corpo.clientHeight + 4 && corpo.scrollTop + corpo.clientHeight < corpo.scrollHeight - 4;
  corpo.classList.toggle("has-more", temMais);
}

function renderFila(animar = false) {
  const countEl = document.getElementById("filaCount");
  const corpo = document.getElementById("queueList");
  countEl.textContent = fila.length;

  if (fila.length === 0) {
    corpo.innerHTML = `<div class="empty-state-rich"><i class="ri-walk-line"></i><strong>Fila vazia</strong><span>Adicione um jogo para iniciar a organização.</span></div>`;
    corpo.classList.remove("has-more");
    posicoesAnteriores = new Map();
    return;
  }

  let ts = getQuadrasAtivas().map((q) => getTempoQuadraParaPrevisao(q));
  const agora = Date.now();
  const html = [];

  fila.forEach((j, idx) => {
    let previsaoHtml;
    if (ts.length > 0) {
      ts.sort((a, b) => a.tempoSeg - b.tempoSeg);
      const qE = ts[0];
      const dp = new Date(agora + qE.tempoSeg * 1000);
      const minutosPrevisao = Math.max(0, Math.round((dp.getTime() - agora) / 60000));
      j._quadraPrevista = qE.id;
      j._horaPrevista = formatarHora(dp);
      qE.tempoSeg += (j.duracao || 45) * 60;
      previsaoHtml = `Q${qE.id} · ${formatarHora(dp)} · ${formatarTempoRelativo(minutosPrevisao)}${qE.incerta ? " · sujeita a alteração" : ""}`;
    } else {
      previsaoHtml = "Aguardando quadra disponível";
    }

    const tipoTexto = (j.duracao || 45) === 60 ? "Duplas" : "Simples";
    const chegada = j.chegada ? formatarChegada(j.chegada) : "--:--";
    const detalhes = j.detalhes || "Sem Q/L";
    const chaveFila = filaKeys[idx] || "";
    const contatoPrivado = chaveFila ? filaContatos[chaveFila] : null;
    const numeroWhatsapp = obterWhatsappInscricao(j, contatoPrivado);
    const podeAvisar = idx === 0 && inscricaoOptouWhatsapp(j, contatoPrivado);
    const btnWpp = podeAvisar ? `<button class="btn-wpp-q" onclick="avisarWhatsapp('${escaparAttr(chaveFila)}', '${escaparAttr(numeroWhatsapp)}', ${idx + 1}, '${escaparAttr(j._quadraPrevista || "-")}', '${escaparAttr(j._horaPrevista || "--:--")}')" title="Avisar por WhatsApp"><i class="ri-whatsapp-line"></i></button>` : "";

    const posicaoAtual = idx + 1;
    const posicaoAntiga = posicoesAnteriores.get(j.id);
    const posMudou = posicaoAntiga !== undefined && posicaoAntiga !== posicaoAtual;
    const posHtml = posMudou
      ? `<span class="queue-pos pos-anim"><span class="pos-old">#${posicaoAntiga}</span><span class="pos-new">#${posicaoAtual}</span></span>`
      : `<span class="queue-pos">#${posicaoAtual}</span>`;

    const itemHtml = `<div class="queue-item">
      <div class="queue-item-top">
        ${posHtml}
        <div class="queue-names">${formatarNomesPareados(j.jogadores)}</div>
        <span class="type-chip ${(j.duracao || 45) === 60 ? "dupla" : "simples"}">${tipoTexto}</span>
      </div>
      <div class="queue-meta">
        <span>${previsaoHtml}</span>
        <span class="dot"></span><span>${chegada}</span>
        <span class="dot"></span><span>${escaparHtml(detalhes)}</span>
      </div>
      <div class="queue-actions">
        ${btnWpp}
        <button class="btn-call-direct" onclick="chamarDireto(${j.id})" title="Chamar"><i class="ri-play-line"></i></button>
        <button class="btn-edit-q" onclick="abrirEdicao(${j.id})" title="Editar"><i class="ri-edit-2-line"></i></button>
        <button class="btn-remove-q" onclick="removerFila(${j.id})" title="Remover"><i class="ri-close-line"></i></button>
      </div>
    </div>`;

    if (ehDispositivoTouch) {
      html.push(`<div class="queue-swipe" data-id="${j.id}">
        <div class="queue-swipe-bg"><i class="ri-delete-bin-line"></i></div>
        ${itemHtml}
      </div>`);
    } else {
      html.push(itemHtml);
    }
  });

  corpo.classList.toggle("queue-list-animate", animar);
  corpo.innerHTML = html.join("");
  if (ehDispositivoTouch) ativarSwipeParaRemover();

  posicoesAnteriores = new Map(fila.map((j, idx) => [j.id, idx + 1]));
  atualizarSombraFila();
}

function ativarSwipeParaRemover() {
  document.querySelectorAll(".queue-swipe").forEach((wrap) => {
    let startX = null, startY = null, dx = 0, decided = false, isHorizontal = false;
    const LIMIAR = 70;

    wrap.addEventListener("touchstart", (e) => {
      e.stopPropagation();
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY; dx = 0; decided = false; isHorizontal = false;
      wrap.classList.remove("swiped");
    }, { passive: true });

    wrap.addEventListener("touchmove", (e) => {
      if (startX === null) return;
      e.stopPropagation();
      const t = e.touches[0];
      dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!decided) {
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { decided = true; isHorizontal = Math.abs(dx) > Math.abs(dy); }
      }
      if (decided && isHorizontal) {
        wrap.classList.add("dragging");
        const limitado = Math.min(0, Math.max(dx, -110));
        wrap.querySelector(".queue-item").style.transform = `translateX(${limitado}px)`;
      }
    }, { passive: true });

    wrap.addEventListener("touchend", async (e) => {
      e.stopPropagation();
      wrap.classList.remove("dragging");
      wrap.querySelector(".queue-item").style.transform = "";
      if (decided && isHorizontal && dx < -LIMIAR) {
        wrap.classList.add("swiped");
        const id = Number(wrap.dataset.id);
        const confirmou = await confirmarAdmin("Remover este jogo da fila?", "Remover da fila", true);
        if (confirmou) window.removerFila(id);
        else wrap.classList.remove("swiped");
      }
      startX = null; decided = false; isHorizontal = false;
    });
  });
}

// ---------- Firebase listeners ----------

await adminReady;

onValue(ref(db, "config/quadras"), (snapshot) => {
  if (!snapshot.exists()) {
    set(ref(db, "config/quadras"), CONFIG_QUADRAS_PADRAO);
    configQuadras = montarConfigQuadras(CONFIG_QUADRAS_PADRAO);
  } else {
    configQuadras = montarConfigQuadras(snapshot.val());
  }
  renderConfigQuadras();
  renderQuadras();
  renderFila();
});

onValue(ref(db, "config/whatsappAvisoAtivo"), (snapshot) => {
  whatsappAvisoAtivo = snapshot.exists() ? snapshot.val() !== false : true;
  atualizarBotaoWhatsapp();
  renderFila();
});

onValue(ref(db, "config/inscricoesOnlineAtivas"), (snapshot) => {
  inscricoesOnlineAtivas = snapshot.exists() ? snapshot.val() !== false : true;
  atualizarBotaoInscricoes();
});

onValue(ref(db, "fila"), (snapshot) => {
  const filaKeysAntes = filaKeys.slice();
  const d = snapshot.val();
  if (!d) { fila = []; filaKeys = []; }
  else {
    const entries = Object.entries(d);
    fila = entries.map(([, value]) => ({ ...value }));
    filaKeys = entries.map(([key]) => key);
  }
  if (filaJaCarregouUmaVez && Date.now() > filaSnackbarSilenciadoAte) {
    const primeiroMudou = filaKeysAntes.length > 0 && filaKeys.length > 0 && filaKeysAntes[0] !== filaKeys[0];
    const filaEncurtou = filaKeys.length < filaKeysAntes.length;
    if (primeiroMudou && filaEncurtou) {
      mostrarSnackbar(`A fila andou. Novo #1: ${fila[0]?.jogadores?.[0] || fila[0]?.nomes || "próxima inscrição"}.`, "info");
    }
  }
  const houveMudanca = filaJaCarregouUmaVez && (filaKeysAntes.length !== filaKeys.length || filaKeysAntes.some((k, i) => k !== filaKeys[i]));
  filaJaCarregouUmaVez = true;
  renderFila(houveMudanca);
  renderQuadras();
});

onValue(ref(db, "filaContatos"), (snapshot) => {
  filaContatos = snapshot.exists() ? snapshot.val() || {} : {};
  renderFila();
});

onValue(ref(db, "quadras"), (snapshot) => {
  if (!snapshot.exists()) {
    quadras = normalizarQuadras([]);
    set(ref(db, "quadras"), quadras);
  } else {
    quadras = normalizarQuadras(snapshot.val());
  }
  renderQuadras();
  renderFila();
});

onValue(ref(db, "historico"), (snapshot) => {
  const d = snapshot.val();
  if (!d) historico = [];
  else if (Array.isArray(d)) historico = d.filter((i) => i !== null);
  else historico = Object.values(d).filter((i) => i !== null);
});

// ---------- Timer tick ----------

let ultimoMinutoFila = null;
setInterval(() => {
  const agora = Date.now();
  let precisaSalvar = false;

  quadras.forEach((q) => {
    if (q && q.ocupada && q.rodando && !q.pausada && q.horaTerminoAbsoluta) {
      const r = Math.max(0, Math.ceil((q.horaTerminoAbsoluta - agora) / 1000));
      if (q.tempoRestante !== r) {
        q.tempoRestante = r;
        if (r === 0 && !q.encerradoEm) {
          q.encerradoEm = new Date(q.horaTerminoAbsoluta).toISOString();
          q.hFimReal = q.hSaida || formatarHora(new Date(q.horaTerminoAbsoluta));
          precisaSalvar = true;
        }
        const el = document.getElementById(`timer-q${q.id}`);
        if (el) el.textContent = formatarTimer(r);
        atualizarProgressoQuadra(q);
      }
    }
  });

  if (precisaSalvar) { salvarQuadras(); renderQuadras(); renderFila(); }

  const minutoAtual = Math.floor(agora / 60000);
  if (minutoAtual !== ultimoMinutoFila) { ultimoMinutoFila = minutoAtual; renderFila(); }
}, 1000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js?v=1.0").catch(() => {}); });
}
