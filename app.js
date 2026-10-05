// Configuración de Firebase proporcionada por el usuario
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAF9mD20ez0bJ1LuiFsCrmasaMsCioSZGM",
  authDomain: "estadisticas-4d227.firebaseapp.com",
  databaseURL: "https://estadisticas-4d227-default-rtdb.firebaseio.com",
  projectId: "estadisticas-4d227",
  storageBucket: "estadisticas-4d227.firebasestorage.app",
  messagingSenderId: "678617147888",
  appId: "1:678617147888:web:13b411e54a60cb1fd09535",
  measurementId: "G-QDM5YN61NB"
};

const STORAGE_KEY = 'basket_stats_store_v2';
const DB_PATH = 'basket_app_data';

let memoryStore = null;
let firebaseDb = null;
let firebaseRef = null;
let firebaseSetFn = null;
let firebaseStatus = 'connecting';
let firebaseErrorMsg = '';
let isApplyingRemoteUpdate = false;

const INITIAL_STORE = {
  activeTournamentId: '',
  activeGameId: '',
  activeStandaloneBoardId: '',
  activeStandaloneBaseballBoardId: '',
  tournaments: [],
  teams: [],
  players: [],
  games: [],
  standaloneBoards: [],
  standaloneBaseballBoards: []
};

const obsBroadcastChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('basket_obs_sync_v1') : null;
if (obsBroadcastChannel) {
  obsBroadcastChannel.onmessage = (ev) => {
    if (ev.data && ev.data.type === 'STORE_SYNC' && ev.data.store) {
      memoryStore = normalizeStore(ev.data.store);
      window.dispatchEvent(new Event('storeUpdated'));
    }
  };
}

function getEmptyPlayerStats() {
  return {
    pts1: 0, miss1: 0,
    pts2: 0, miss2: 0,
    pts3: 0, miss3: 0,
    pf: 0, // Falta personal
    of: 0, // Falta ofensiva (no cuenta para el bonus)
    tf: 0, // Falta técnica (2 TF = expulsión)
    secondsPlayed: 0, // Tiempo jugado en segundos
    plusMinus: 0,     // +/- con jugador en cancha
    rebOff: 0, rebDef: 0,
    ast: 0, stl: 0, blk: 0, tov: 0
  };
}

function getEmptyBaseballPlayerStats() {
  return {
    ab: 0,  // Turnos oficiales al bate (At Bats)
    h: 0,   // Hits totales
    r: 0,   // Carreras anotadas (Runs)
    d2b: 0, // Dobles (2B)
    t3b: 0, // Triples (3B)
    hr: 0,  // Home Runs (HR)
    rbi: 0, // Carreras impulsadas (RBI)
    k: 0,   // Ponches (Strikeouts)
    bb: 0   // Bases por bolas (Walks)
  };
}

function formatBaseballAvg(val) {
  const num = Number(val) || 0;
  if (num <= 0) return '.000';
  if (num >= 1) return num.toFixed(3);
  return num.toFixed(3).replace(/^0/, '');
}

function normalizeStandaloneBoard(b) {
  const copy = { ...b };
  copy.id = copy.id || uid('board');
  copy.tournamentName = copy.tournamentName !== undefined ? copy.tournamentName : 'TORNEO DE BALONCESTO';
  copy.tourneyTextColor = copy.tourneyTextColor || '#ffffff';
  copy.homeName = copy.homeName || 'WSH';
  copy.awayName = copy.awayName || 'IND';
  copy.homeColor = copy.homeColor || '#2b3244';
  copy.awayColor = copy.awayColor || '#1d294b';
  copy.homeTextColor = copy.homeTextColor || '#ffffff';
  copy.awayTextColor = copy.awayTextColor || '#ffffff';
  copy.homeLogo = copy.homeLogo || '';
  copy.awayLogo = copy.awayLogo || '';
  copy.homeLogoFit = copy.homeLogoFit || 'cover';
  copy.awayLogoFit = copy.awayLogoFit || 'cover';
  copy.homeScore = Number(copy.homeScore || 0);
  copy.awayScore = Number(copy.awayScore || 0);
  copy.period = Number(copy.period || 1);
  copy.clockSeconds = typeof copy.clockSeconds === 'number' ? copy.clockSeconds : 600;
  copy.clockRunning = Boolean(copy.clockRunning);
  copy.isFinal = Boolean(copy.isFinal);
  copy.clockUpdatedAt = Number(copy.clockUpdatedAt || Date.now());
  copy.activeBanner = copy.activeBanner && typeof copy.activeBanner === 'object' ? copy.activeBanner : null;
  copy.createdAt = Number(copy.createdAt || Date.now());
  return copy;
}

function normalizeStandaloneBaseballBoard(b) {
  const copy = { ...b };
  copy.id = copy.id || uid('bbboard');
  copy.batterText = copy.batterText !== undefined ? copy.batterText : '4. FRANCE   0-0, .000 AVG';
  copy.batterTextColor = copy.batterTextColor || '#ffffff';
  copy.batterBgColor = copy.batterBgColor || '#0b0e14';
  copy.awayName = copy.awayName || 'SD';
  copy.homeName = copy.homeName || 'MIL';
  copy.awayColor = copy.awayColor || '#0f131a';
  copy.homeColor = copy.homeColor || '#0f131a';
  copy.awayTextColor = copy.awayTextColor || '#ffffff';
  copy.homeTextColor = copy.homeTextColor || '#ffffff';
  copy.frameColor = copy.frameColor || '#eab308';
  copy.awayLogo = copy.awayLogo || '';
  copy.homeLogo = copy.homeLogo || '';
  copy.awayLogoFit = copy.awayLogoFit || 'contain';
  copy.homeLogoFit = copy.homeLogoFit || 'contain';
  copy.awayScore = Number(copy.awayScore || 0);
  copy.homeScore = Number(copy.homeScore || 0);
  copy.awayHits = Number(copy.awayHits || 0);
  copy.homeHits = Number(copy.homeHits || 0);
  copy.awayErrors = Number(copy.awayErrors || 0);
  copy.homeErrors = Number(copy.homeErrors || 0);
  copy.inningRuns = copy.inningRuns && typeof copy.inningRuns === 'object' ? copy.inningRuns : { away: {}, home: {} };
  if (!copy.inningRuns.away) copy.inningRuns.away = {};
  if (!copy.inningRuns.home) copy.inningRuns.home = {};
  copy.inning = Math.max(1, Number(copy.inning || 1));
  copy.half = copy.half === 'bottom' ? 'bottom' : 'top'; // 'top' = ▲, 'bottom' = ▼
  copy.outs = Math.min(2, Math.max(0, Number(copy.outs || 0)));
  copy.balls = Math.min(3, Math.max(0, Number(copy.balls || 0)));
  copy.strikes = Math.min(2, Math.max(0, Number(copy.strikes || 0)));
  copy.isFinal = Boolean(copy.isFinal);
  const rawBases = copy.bases && typeof copy.bases === 'object' ? copy.bases : {};
  copy.bases = {
    first: Boolean(rawBases.first),
    second: Boolean(rawBases.second),
    third: Boolean(rawBases.third)
  };
  copy.hrAnimation = copy.hrAnimation && typeof copy.hrAnimation === 'object' ? copy.hrAnimation : null;
  copy.kAnimation = copy.kAnimation && typeof copy.kAnimation === 'object' ? copy.kAnimation : null;
  copy.playBadgeAnimation = copy.playBadgeAnimation && typeof copy.playBadgeAnimation === 'object' ? copy.playBadgeAnimation : null;
  copy.createdAt = Number(copy.createdAt || Date.now());
  return copy;
}

function normalizeGame(g) {
  const copy = { ...g };
  copy.sport = copy.sport || '';
  copy.period = Number(copy.period || 1);
  copy.clockSeconds = typeof copy.clockSeconds === 'number' ? copy.clockSeconds : 600;
  copy.clockRunning = Boolean(copy.clockRunning);
  copy.coachHome = copy.coachHome || '';
  copy.coachAway = copy.coachAway || '';
  copy.leadTimeHome = Number(copy.leadTimeHome || 0); // Segundos dominando Local
  copy.leadTimeAway = Number(copy.leadTimeAway || 0); // Segundos dominando Visitante
  copy.tiedTime = Number(copy.tiedTime || 0);         // Segundos empatados
  copy.biggestLeadHome = Number(copy.biggestLeadHome || 0);
  copy.biggestLeadAway = Number(copy.biggestLeadAway || 0);
  copy.biggestLeadHomeScore = copy.biggestLeadHomeScore || '';
  copy.biggestLeadAwayScore = copy.biggestLeadAwayScore || '';
  copy.leadChanges = Number(copy.leadChanges || 0);
  copy.timesTied = Number(copy.timesTied || 0);
  copy.lastLeader = copy.lastLeader || 'none'; // 'none' | 'home' | 'away' | 'tie'
  copy.stats = copy.stats || {};
  copy.startersHome = Array.isArray(copy.startersHome) ? copy.startersHome : (copy.startersHome ? Object.values(copy.startersHome) : []);
  copy.startersAway = Array.isArray(copy.startersAway) ? copy.startersAway : (copy.startersAway ? Object.values(copy.startersAway) : []);
  copy.startersConfirmed = Boolean(copy.startersConfirmed);
  copy.onCourtHome = Array.isArray(copy.onCourtHome) ? copy.onCourtHome : (copy.onCourtHome ? Object.values(copy.onCourtHome) : []);
  copy.onCourtAway = Array.isArray(copy.onCourtAway) ? copy.onCourtAway : (copy.onCourtAway ? Object.values(copy.onCourtAway) : []);
  copy.teamFouls = copy.teamFouls || {};
  copy.timeoutsUsed = copy.timeoutsUsed || {
    H1: { home: 0, away: 0 },
    H2: { home: 0, away: 0 },
    OT: {}
  };
  copy.logsPuntos = Array.isArray(copy.logsPuntos) ? copy.logsPuntos : (copy.logsPuntos ? Object.values(copy.logsPuntos) : []);
  copy.logsRA = Array.isArray(copy.logsRA) ? copy.logsRA : (copy.logsRA ? Object.values(copy.logsRA) : []);
  copy.logs = Array.isArray(copy.logs) ? copy.logs : (copy.logs ? Object.values(copy.logs) : []);
  copy.quarterHistory = Array.isArray(copy.quarterHistory) ? copy.quarterHistory : (copy.quarterHistory ? Object.values(copy.quarterHistory) : []);
  copy.finishedAt = Number(copy.finishedAt || 0);
  copy.overlayConfig = copy.overlayConfig && typeof copy.overlayConfig === 'object' ? copy.overlayConfig : {};

  // Propiedades de Baseball
  copy.inning = Math.max(1, Number(copy.inning || 1));
  copy.half = copy.half === 'bottom' ? 'bottom' : 'top'; // 'top' = ▲ Visitante batea, 'bottom' = ▼ Local batea
  copy.outs = Math.min(2, Math.max(0, Number(copy.outs || 0)));
  copy.balls = Math.min(3, Math.max(0, Number(copy.balls || 0)));
  copy.strikes = Math.min(2, Math.max(0, Number(copy.strikes || 0)));
  const rawBases = copy.bases && typeof copy.bases === 'object' ? copy.bases : {};
  copy.bases = {
    first: rawBases.first || '',
    second: rawBases.second || '',
    third: rawBases.third || ''
  };
  copy.currentBatterId = copy.currentBatterId || '';
  copy.nextBatterAwayId = copy.nextBatterAwayId || '';
  copy.nextBatterHomeId = copy.nextBatterHomeId || '';
  copy.battingOrderAway = Array.isArray(copy.battingOrderAway) ? copy.battingOrderAway : (copy.battingOrderAway ? Object.values(copy.battingOrderAway) : []);
  copy.battingOrderHome = Array.isArray(copy.battingOrderHome) ? copy.battingOrderHome : (copy.battingOrderHome ? Object.values(copy.battingOrderHome) : []);
  copy.baseballStats = copy.baseballStats && typeof copy.baseballStats === 'object' ? copy.baseballStats : {};
  copy.runsAdjustHome = Number(copy.runsAdjustHome || 0);
  copy.runsAdjustAway = Number(copy.runsAdjustAway || 0);
  copy.errorsHome = Number(copy.errorsHome || 0);
  copy.errorsAway = Number(copy.errorsAway || 0);
  copy.inningRuns = copy.inningRuns && typeof copy.inningRuns === 'object' ? copy.inningRuns : { away: {}, home: {} };
  if (!copy.inningRuns.away) copy.inningRuns.away = {};
  if (!copy.inningRuns.home) copy.inningRuns.home = {};
  copy.logsBaseball = Array.isArray(copy.logsBaseball) ? copy.logsBaseball : (copy.logsBaseball ? Object.values(copy.logsBaseball) : []);
  copy.hrAnimation = copy.hrAnimation && typeof copy.hrAnimation === 'object' ? copy.hrAnimation : null;
  copy.kAnimation = copy.kAnimation && typeof copy.kAnimation === 'object' ? copy.kAnimation : null;
  copy.playBadgeAnimation = copy.playBadgeAnimation && typeof copy.playBadgeAnimation === 'object' ? copy.playBadgeAnimation : null;
  copy.baseballOverlayConfig = copy.baseballOverlayConfig && typeof copy.baseballOverlayConfig === 'object' ? copy.baseballOverlayConfig : {};

  return copy;
}

function normalizeStore(data) {
  const base = data && typeof data === 'object' ? data : {};
  const rawGames = Array.isArray(base.games) ? base.games : (base.games ? Object.values(base.games) : []);
  const rawBoards = Array.isArray(base.standaloneBoards) ? base.standaloneBoards : (base.standaloneBoards ? Object.values(base.standaloneBoards) : []);
  const rawBbBoards = Array.isArray(base.standaloneBaseballBoards) ? base.standaloneBaseballBoards : (base.standaloneBaseballBoards ? Object.values(base.standaloneBaseballBoards) : []);
  return {
    activeTournamentId: base.activeTournamentId || '',
    activeGameId: base.activeGameId || '',
    activeStandaloneBoardId: base.activeStandaloneBoardId || '',
    activeStandaloneBaseballBoardId: base.activeStandaloneBaseballBoardId || '',
    tournaments: Array.isArray(base.tournaments) ? base.tournaments : (base.tournaments ? Object.values(base.tournaments) : []),
    teams: Array.isArray(base.teams) ? base.teams : (base.teams ? Object.values(base.teams) : []),
    players: Array.isArray(base.players) ? base.players : (base.players ? Object.values(base.players) : []),
    games: rawGames.map(normalizeGame),
    standaloneBoards: rawBoards.map(normalizeStandaloneBoard),
    standaloneBaseballBoards: rawBbBoards.map(normalizeStandaloneBaseballBoard)
  };
}

function loadStore() {
  if (memoryStore) return memoryStore;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      memoryStore = normalizeStore(JSON.parse(raw));
      return memoryStore;
    }
  } catch (e) {
    console.error('Error leyendo cache local:', e);
  }
  memoryStore = normalizeStore(INITIAL_STORE);
  return memoryStore;
}

function saveStore(store) {
  memoryStore = normalizeStore(store);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore));
  } catch (e) {
    console.error('Error guardando en localStorage:', e);
  }
  if (obsBroadcastChannel && !isApplyingRemoteUpdate) {
    try {
      obsBroadcastChannel.postMessage({ type: 'STORE_SYNC', store: memoryStore });
    } catch (e) {}
  }
  window.dispatchEvent(new Event('storeUpdated'));

  if (firebaseRef && firebaseSetFn && !isApplyingRemoteUpdate) {
    firebaseSetFn(firebaseRef, memoryStore)
      .then(() => {
        setFirebaseStatus('connected', '');
      })
      .catch((err) => {
        if (err && (err.code === 'PERMISSION_DENIED' || String(err.message).includes('permission_denied') || String(err.message).includes('PERMISSION_DENIED'))) {
          setFirebaseStatus('permission_denied', 'Permiso denegado en reglas de Firebase');
        } else {
          setFirebaseStatus('offline', err.message || 'Error de conexión con Firebase');
        }
      });
  }
}

function setFirebaseStatus(status, msg) {
  firebaseStatus = status;
  firebaseErrorMsg = msg || '';
  window.dispatchEvent(new CustomEvent('firebaseStatusChanged', {
    detail: { status: firebaseStatus, message: firebaseErrorMsg }
  }));
}

function getFirebaseStatus() {
  return { status: firebaseStatus, message: firebaseErrorMsg };
}

async function initFirebaseSync() {
  const sdkVersions = ['11.6.0', '10.14.1'];
  let appMod = null;
  let dbMod = null;

  for (const ver of sdkVersions) {
    try {
      appMod = await import(`https://www.gstatic.com/firebasejs/${ver}/firebase-app.js`);
      dbMod = await import(`https://www.gstatic.com/firebasejs/${ver}/firebase-database.js`);
      break;
    } catch (e) {}
  }

  if (!appMod || !dbMod) {
    setFirebaseStatus('offline', 'No se pudo cargar el SDK de Firebase');
    return;
  }

  try {
    const app = appMod.initializeApp(FIREBASE_CONFIG);
    firebaseDb = dbMod.getDatabase(app);
    firebaseRef = dbMod.ref(firebaseDb, DB_PATH);
    firebaseSetFn = dbMod.set;

    dbMod.onValue(
      firebaseRef,
      (snapshot) => {
        const remoteVal = snapshot.val();
        setFirebaseStatus('connected', '');
        if (remoteVal) {
          isApplyingRemoteUpdate = true;
          memoryStore = normalizeStore(remoteVal);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore));
          window.dispatchEvent(new Event('storeUpdated'));
          isApplyingRemoteUpdate = false;
        } else {
          const current = loadStore();
          if (current.tournaments.length > 0 || current.teams.length > 0) {
            firebaseSetFn(firebaseRef, current).catch(() => {});
          }
        }
      },
      (err) => {
        if (err && (err.code === 'PERMISSION_DENIED' || String(err.message).includes('permission_denied') || String(err.message).includes('PERMISSION_DENIED'))) {
          setFirebaseStatus('permission_denied', 'Reglas de Firebase en false');
        } else {
          setFirebaseStatus('offline', err.message || 'Sin conexión');
        }
      }
    );
  } catch (err) {
    setFirebaseStatus('offline', err.message);
  }
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function formatSecondsMMSS(totalSec) {
  const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseMMSS(str) {
  const clean = String(str || '').trim();
  if (clean.includes(':')) {
    const parts = clean.split(':');
    const m = parseInt(parts[0], 10) || 0;
    const s = parseInt(parts[1], 10) || 0;
    return Math.max(0, m * 60 + s);
  }
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : Math.max(0, Math.round(num * 60));
}

function getPeriodLabel(period) {
  const p = Number(period || 1);
  if (p <= 4) return `Q${p}`;
  return `OT${p - 4}`;
}

function ensureOnCourtPlayers(store, game) {
  let changed = false;
  const homePlayers = store.players.filter(p => p.teamId === game.homeTeamId).sort((a, b) => Number(a.number) - Number(b.number));
  const awayPlayers = store.players.filter(p => p.teamId === game.awayTeamId).sort((a, b) => Number(a.number) - Number(b.number));

  if (!Array.isArray(game.onCourtHome)) game.onCourtHome = [];
  if (!Array.isArray(game.onCourtAway)) game.onCourtAway = [];
  if (!Array.isArray(game.startersHome)) game.startersHome = [];
  if (!Array.isArray(game.startersAway)) game.startersAway = [];

  const validHomeIds = new Set(homePlayers.map(p => p.id));
  const validAwayIds = new Set(awayPlayers.map(p => p.id));

  game.onCourtHome = game.onCourtHome.filter(id => validHomeIds.has(id));
  game.onCourtAway = game.onCourtAway.filter(id => validAwayIds.has(id));
  game.startersHome = game.startersHome.filter(id => validHomeIds.has(id));
  game.startersAway = game.startersAway.filter(id => validAwayIds.has(id));

  if (game.startersHome.length === 0 && homePlayers.length > 0) {
    game.startersHome = homePlayers.slice(0, 5).map(p => p.id);
    changed = true;
  }
  if (game.startersAway.length === 0 && awayPlayers.length > 0) {
    game.startersAway = awayPlayers.slice(0, 5).map(p => p.id);
    changed = true;
  }
  if (game.onCourtHome.length === 0 && homePlayers.length > 0) {
    game.onCourtHome = [...game.startersHome];
    changed = true;
  }
  if (game.onCourtAway.length === 0 && awayPlayers.length > 0) {
    game.onCourtAway = [...game.startersAway];
    changed = true;
  }
  return changed;
}

// Devuelve la lista de jugadores del equipo poniendo SIEMPRE de primeros a los 5 Titulares que iniciaron el juego
function getOrderedTeamPlayersWithStartersFirst(store, game, side /* 'home' | 'away' */) {
  const teamId = side === 'home' ? game.homeTeamId : game.awayTeamId;
  const starterIds = side === 'home' ? (game.startersHome || []) : (game.startersAway || []);
  const starterSet = new Set(starterIds);

  const allTeamPlayers = store.players.filter(p => p.teamId === teamId);

  // Mantener a los 5 titulares primero (ordenados por dorsal) y luego los suplentes (ordenados por dorsal)
  const starters = allTeamPlayers
    .filter(p => starterSet.has(p.id))
    .sort((a, b) => Number(a.number) - Number(b.number))
    .map(p => ({ ...p, isStarter: true }));

  const bench = allTeamPlayers
    .filter(p => !starterSet.has(p.id))
    .sort((a, b) => Number(a.number) - Number(b.number))
    .map(p => ({ ...p, isStarter: false }));

  return [...starters, ...bench];
}

function getPlayerGameStats(game, playerId) {
  if (!game.stats) game.stats = {};
  if (!game.stats[playerId]) {
    game.stats[playerId] = getEmptyPlayerStats();
  }
  const s = { ...getEmptyPlayerStats(), ...game.stats[playerId] };
  game.stats[playerId] = s;

  const totalPts = (s.pts1 * 1) + (s.pts2 * 2) + (s.pts3 * 3);
  const totalReb = (s.rebOff || 0) + (s.rebDef || 0);
  const fgMade = (s.pts2 || 0) + (s.pts3 || 0);
  const fgAtt = fgMade + (s.miss2 || 0) + (s.miss3 || 0);
  const fgPct = fgAtt > 0 ? Math.round((fgMade / fgAtt) * 100) : 0;
  const ftMade = s.pts1 || 0;
  const ftAtt = ftMade + (s.miss1 || 0);
  const ftPct = ftAtt > 0 ? Math.round((ftMade / ftAtt) * 100) : 0;
  const t2Made = s.pts2 || 0;
  const t2Att = t2Made + (s.miss2 || 0);
  const t2Pct = t2Att > 0 ? Math.round((t2Made / t2Att) * 100) : 0;
  const t3Made = s.pts3 || 0;
  const t3Att = t3Made + (s.miss3 || 0);
  const t3Pct = t3Att > 0 ? Math.round((t3Made / t3Att) * 100) : 0;
  const totalFouls = (s.pf || 0) + (s.of || 0) + (s.tf || 0);
  const isFouledOut = totalFouls >= 5 || (s.tf || 0) >= 2;
  const fouledOutReason = (s.tf || 0) >= 2 ? '2 Faltas Técnicas' : (totalFouls >= 5 ? '5 Faltas Acumuladas' : '');

  // Valoración / Eficiencia FIBA: (PTS + REB + AST + ROB + TAP) - ((FG Att - FG Made) + (FT Att - FT Made) + PER)
  const missedFG = fgAtt - fgMade;
  const missedFT = ftAtt - ftMade;
  const efficiency = (totalPts + totalReb + (s.ast || 0) + (s.stl || 0) + (s.blk || 0)) - (missedFG + missedFT + (s.tov || 0));

  return {
    ...s,
    totalPts,
    totalReb,
    fgMade,
    fgAtt,
    fgPct,
    ftMade,
    ftAtt,
    ftPct,
    t2Made,
    t2Att,
    t2Pct,
    t3Made,
    t3Att,
    t3Pct,
    totalFouls,
    isFouledOut,
    fouledOutReason,
    efficiency,
    formattedTime: formatSecondsMMSS(s.secondsPlayed || 0)
  };
}

function getTeamGameTotals(store, game, teamId) {
  const teamPlayers = store.players.filter(p => p.teamId === teamId);
  const totals = {
    pts: 0, rebOff: 0, rebDef: 0, reb: 0,
    ast: 0, stl: 0, blk: 0, tov: 0,
    pf: 0, of: 0, tf: 0, totalFouls: 0,
    pts1: 0, miss1: 0, pts2: 0, miss2: 0, pts3: 0, miss3: 0,
    efficiency: 0
  };
  teamPlayers.forEach(p => {
    const st = getPlayerGameStats(game, p.id);
    totals.pts += st.totalPts;
    totals.rebOff += st.rebOff;
    totals.rebDef += st.rebDef;
    totals.reb += st.totalReb;
    totals.ast += st.ast;
    totals.stl += st.stl;
    totals.blk += st.blk;
    totals.tov += st.tov;
    totals.pf += st.pf;
    totals.of += st.of;
    totals.tf += st.tf;
    totals.totalFouls += st.totalFouls;
    totals.pts1 += st.pts1;
    totals.miss1 += st.miss1;
    totals.pts2 += st.pts2;
    totals.miss2 += st.miss2;
    totals.pts3 += st.pts3;
    totals.miss3 += st.miss3;
    totals.efficiency += st.efficiency;
  });
  const fgMade = totals.pts2 + totals.pts3;
  const fgAtt = fgMade + totals.miss2 + totals.miss3;
  const t2Att = totals.pts2 + totals.miss2;
  const t3Att = totals.pts3 + totals.miss3;
  const ftAtt = totals.pts1 + totals.miss1;

  totals.fgMade = fgMade;
  totals.fgAtt = fgAtt;
  totals.fgPct = fgAtt > 0 ? Math.round((fgMade / fgAtt) * 100) : 0;
  totals.t2Pct = t2Att > 0 ? Math.round((totals.pts2 / t2Att) * 100) : 0;
  totals.t3Pct = t3Att > 0 ? Math.round((totals.pts3 / t3Att) * 100) : 0;
  totals.ftPct = ftAtt > 0 ? Math.round((totals.pts1 / ftAtt) * 100) : 0;
  return totals;
}

// Actualizar métricas de mayor ventaja, cambios de líder y empates al cambiar el marcador
function updateGameLeadMetrics(store, game) {
  const homeTotals = getTeamGameTotals(store, game, game.homeTeamId);
  const awayTotals = getTeamGameTotals(store, game, game.awayTeamId);
  const hPts = homeTotals.pts;
  const aPts = awayTotals.pts;
  const diff = hPts - aPts;

  if (diff > 0) {
    if (diff > (game.biggestLeadHome || 0)) {
      game.biggestLeadHome = diff;
      game.biggestLeadHomeScore = `${hPts} - ${aPts} (${getPeriodLabel(game.period)})`;
    }
    if (game.lastLeader === 'away') {
      game.leadChanges = (game.leadChanges || 0) + 1;
    }
    game.lastLeader = 'home';
  } else if (diff < 0) {
    const awayLead = Math.abs(diff);
    if (awayLead > (game.biggestLeadAway || 0)) {
      game.biggestLeadAway = awayLead;
      game.biggestLeadAwayScore = `${aPts} - ${hPts} (${getPeriodLabel(game.period)})`;
    }
    if (game.lastLeader === 'home') {
      game.leadChanges = (game.leadChanges || 0) + 1;
    }
    game.lastLeader = 'away';
  } else if (hPts > 0 && aPts > 0 && diff === 0) {
    if (game.lastLeader === 'home' || game.lastLeader === 'away') {
      game.timesTied = (game.timesTied || 0) + 1;
      game.lastLeader = 'tie';
    }
  }
}

function getQuarterBonusFouls(game, period, side) {
  const key = String(period > 4 ? 4 : period);
  if (!game.teamFouls) game.teamFouls = {};
  if (!game.teamFouls[key]) game.teamFouls[key] = { home: 0, away: 0 };
  return game.teamFouls[key][side] || 0;
}

function getTimeoutsInfo(game, side) {
  const p = Number(game.period || 1);
  if (!game.timeoutsUsed) {
    game.timeoutsUsed = { H1: { home: 0, away: 0 }, H2: { home: 0, away: 0 }, OT: {} };
  }
  if (p <= 2) {
    const used = (game.timeoutsUsed.H1 && game.timeoutsUsed.H1[side]) || 0;
    return { max: 2, used, remaining: Math.max(0, 2 - used), stageLabel: '1ª Mitad' };
  } else if (p <= 4) {
    const used = (game.timeoutsUsed.H2 && game.timeoutsUsed.H2[side]) || 0;
    return { max: 3, used, remaining: Math.max(0, 3 - used), stageLabel: '2ª Mitad' };
  } else {
    const otKey = String(p);
    if (!game.timeoutsUsed.OT) game.timeoutsUsed.OT = {};
    if (!game.timeoutsUsed.OT[otKey]) game.timeoutsUsed.OT[otKey] = { home: 0, away: 0 };
    const used = game.timeoutsUsed.OT[otKey][side] || 0;
    return { max: 1, used, remaining: Math.max(0, 1 - used), stageLabel: `OT${p - 4}` };
  }
}

function recordStatAction(gameId, playerId, statKey, delta = 1, label = '') {
  const store = loadStore();
  const game = store.games.find(g => g.id === gameId);
  if (!game) return;

  if (game.status === 'Finalizado') {
    alert('🔒 Este partido está marcado como Finalizado y las anotaciones están cerradas. Puedes reabrirlo o editarlo si necesitas corregir algo.');
    return;
  }

  if (!game.stats) game.stats = {};
  if (!game.stats[playerId]) game.stats[playerId] = getEmptyPlayerStats();

  const currentVal = game.stats[playerId][statKey] || 0;
  game.stats[playerId][statKey] = Math.max(0, currentVal + delta);

  const player = store.players.find(p => p.id === playerId);
  const team = player ? store.teams.find(t => t.id === player.teamId) : null;

  if (delta > 0 && label && player) {
    if (!game.logsRA) game.logsRA = [];
    game.logsRA.unshift({
      id: uid('logra'),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      gameClock: formatSecondsMMSS(game.clockSeconds || 0),
      period: getPeriodLabel(game.period || 1),
      playerId: player.id,
      playerName: `#${player.number} ${player.name}`,
      teamName: team ? team.name : '',
      statKey,
      label
    });
  }

  saveStore(store);
}

function extractUidTimestamp(idStr) {
  const parts = String(idStr || '').split('_');
  if (parts.length >= 2) {
    const ts = Number(parts[1]);
    if (!isNaN(ts) && ts > 0) return ts;
  }
  return 0;
}

// Ordena los juegos activos/por anotar poniendo SIEMPRE los que están "En Vivo" arriba
function sortActiveGamesToScore(games) {
  return [...games].sort((a, b) => {
    const aLive = a.status === 'En Vivo' ? 1 : 0;
    const bLive = b.status === 'En Vivo' ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    const aTs = extractUidTimestamp(a.id);
    const bTs = extractUidTimestamp(b.id);
    return bTs - aTs;
  });
}

// Ordena los juegos finalizados poniendo SIEMPRE el último juego terminado arriba de primero
function sortFinishedGamesNewestFirst(games, allStoreGames = []) {
  return [...games].sort((a, b) => {
    const aFin = Number(a.finishedAt || 0);
    const bFin = Number(b.finishedAt || 0);
    if (aFin !== bFin) return bFin - aFin;
    const aTs = extractUidTimestamp(a.id);
    const bTs = extractUidTimestamp(b.id);
    if (aTs !== bTs) return bTs - aTs;
    return allStoreGames.indexOf(b) - allStoreGames.indexOf(a);
  });
}

function getGameSport(store, game) {
  if (!game) return 'basketball';
  if (game.sport === 'baseball' || game.sport === 'basketball') return game.sport;
  if (store && Array.isArray(store.tournaments)) {
    const t = store.tournaments.find(x => x.id === game.tournamentId);
    if (t && t.sport === 'baseball') return 'baseball';
  }
  return 'basketball';
}

function getBaseballPlayerStats(game, playerId) {
  if (!game.baseballStats) game.baseballStats = {};
  if (!game.baseballStats[playerId]) {
    game.baseballStats[playerId] = getEmptyBaseballPlayerStats();
  }
  const raw = { ...getEmptyBaseballPlayerStats(), ...game.baseballStats[playerId] };
  const d2b = Math.max(0, Number(raw.d2b || 0));
  const t3b = Math.max(0, Number(raw.t3b || 0));
  const hr = Math.max(0, Number(raw.hr || 0));
  const extraBaseHits = d2b + t3b + hr;
  const h = Math.max(extraBaseHits, Number(raw.h || 0));
  const ab = Math.max(h, Number(raw.ab || 0));
  const r = Math.max(0, Number(raw.r || 0));
  const rbi = Math.max(0, Number(raw.rbi || 0));
  const k = Math.max(0, Number(raw.k || 0));
  const bb = Math.max(0, Number(raw.bb || 0));

  const s1b = Math.max(0, h - extraBaseHits);
  const tb = s1b + (d2b * 2) + (t3b * 3) + (hr * 4);
  const avgNum = ab > 0 ? (h / ab) : 0;
  const obpNum = (ab + bb) > 0 ? ((h + bb) / (ab + bb)) : 0;
  const slgNum = ab > 0 ? (tb / ab) : 0;
  const opsNum = obpNum + slgNum;

  return {
    ab,
    h,
    r,
    d2b,
    t3b,
    hr,
    rbi,
    k,
    bb,
    s1b,
    tb,
    avgNum,
    avg: formatBaseballAvg(avgNum),
    obp: formatBaseballAvg(obpNum),
    slg: formatBaseballAvg(slgNum),
    ops: formatBaseballAvg(opsNum)
  };
}

function getBaseballTeamTotals(store, game, teamId) {
  const teamPlayers = store.players.filter(p => p.teamId === teamId);
  const totals = {
    ab: 0, r: 0, h: 0, d2b: 0, t3b: 0, hr: 0, rbi: 0, k: 0, bb: 0, tb: 0
  };
  teamPlayers.forEach(p => {
    const st = getBaseballPlayerStats(game, p.id);
    totals.ab += st.ab;
    totals.r += st.r;
    totals.h += st.h;
    totals.d2b += st.d2b;
    totals.t3b += st.t3b;
    totals.hr += st.hr;
    totals.rbi += st.rbi;
    totals.k += st.k;
    totals.bb += st.bb;
    totals.tb += st.tb;
  });

  const isHome = teamId === game.homeTeamId;
  const adj = Number(isHome ? (game.runsAdjustHome || 0) : (game.runsAdjustAway || 0));
  totals.runs = Math.max(0, totals.r + adj);
  totals.errors = Math.max(0, Number(isHome ? (game.errorsHome || 0) : (game.errorsAway || 0)));

  const avgNum = totals.ab > 0 ? (totals.h / totals.ab) : 0;
  const obpNum = (totals.ab + totals.bb) > 0 ? ((totals.h + totals.bb) / (totals.ab + totals.bb)) : 0;
  const slgNum = totals.ab > 0 ? (totals.tb / totals.ab) : 0;
  totals.avg = formatBaseballAvg(avgNum);
  totals.obp = formatBaseballAvg(obpNum);
  totals.slg = formatBaseballAvg(slgNum);
  totals.ops = formatBaseballAvg(obpNum + slgNum);

  return totals;
}

function getBaseballWinnerSummary(store, game) {
  if (!game) return null;
  const awayTeam = store.teams.find(t => t.id === game.awayTeamId);
  const homeTeam = store.teams.find(t => t.id === game.homeTeamId);
  const awayName = awayTeam ? awayTeam.name : 'Visitante';
  const homeName = homeTeam ? homeTeam.name : 'Local';
  const awayShort = awayTeam ? (awayTeam.shortName || awayTeam.name) : 'VIS';
  const homeShort = homeTeam ? (homeTeam.shortName || homeTeam.name) : 'LOC';
  const awayTot = getBaseballTeamTotals(store, game, game.awayTeamId);
  const homeTot = getBaseballTeamTotals(store, game, game.homeTeamId);

  if (homeTot.runs > awayTot.runs) {
    return {
      winnerSide: 'home',
      winnerName: homeName,
      winnerShort: homeShort,
      loserName: awayName,
      winnerRuns: homeTot.runs,
      loserRuns: awayTot.runs,
      summaryText: `🏆 GANA ${homeName.toUpperCase()} (${homeTot.runs}-${awayTot.runs})`
    };
  }
  if (awayTot.runs > homeTot.runs) {
    return {
      winnerSide: 'away',
      winnerName: awayName,
      winnerShort: awayShort,
      loserName: homeName,
      winnerRuns: awayTot.runs,
      loserRuns: homeTot.runs,
      summaryText: `🏆 GANA ${awayName.toUpperCase()} (${awayTot.runs}-${homeTot.runs})`
    };
  }
  return {
    winnerSide: 'tie',
    winnerName: 'Empate',
    winnerShort: 'EMP',
    loserName: '',
    winnerRuns: awayTot.runs,
    loserRuns: homeTot.runs,
    summaryText: `🏁 FINAL EMPATADO (${awayTot.runs}-${homeTot.runs})`
  };
}

// Verifica automáticamente si el equipo que cierra (Local / Baja ▼) en el 9° inning o en Extra Innings (10+)
// se va arriba en el marcador (Walk-Off / Dejar en el terreno). En ese instante gana automáticamente y pasa a FINAL.
function checkBaseballWalkOffWin(store, game) {
  if (!game || game.status === 'Finalizado') return false;
  const regInn = Number(game.regulationInnings || 9);
  const currInn = Number(game.inning || 1);

  if (currInn >= regInn && game.half === 'bottom') {
    const awayTot = getBaseballTeamTotals(store, game, game.awayTeamId);
    const homeTot = getBaseballTeamTotals(store, game, game.homeTeamId);
    if (homeTot.runs > awayTot.runs) {
      const homeTeam = store.teams.find(t => t.id === game.homeTeamId);
      const awayTeam = store.teams.find(t => t.id === game.awayTeamId);
      const homeName = homeTeam ? homeTeam.name : 'Local';
      const awayName = awayTeam ? awayTeam.name : 'Visitante';

      game.status = 'Finalizado';
      game.finishedAt = Date.now();
      game.balls = 0;
      game.strikes = 0;

      if (!Array.isArray(game.logsBaseball)) game.logsBaseball = [];
      game.logsBaseball.unshift({
        id: uid('bblog'),
        inning: `▼${currInn}`,
        teamName: homeTeam ? (homeTeam.shortName || homeTeam.name) : 'LOC',
        playerName: '🏆 FIN DEL JUEGO',
        text: `🏆 ¡VICTORIA DEJANDO EN EL TERRENO (WALK-OFF)! ${homeName} adelanta (${homeTot.runs}-${awayTot.runs}) en el cierre del ${currInn}° inning y gana a ${awayName}.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });
      return true;
    }
  }
  return false;
}

// Evalúa qué ocurre al caer el 3er Out de una entrada según las reglas oficiales del Béisbol:
// 1) Si el equipo que abre (Visitante / Alta ▲) en el 9° (o Extra Inning) falla su 3er out sin poder empatar o irse arriba, pierde de inmediato (FINAL).
// 2) Si el equipo que cierra (Local / Baja ▼) en el 9° (o Extra Inning) falla su 3er out sin poder empatar o adelantar, pierde de inmediato (FINAL).
// 3) Si cierran el 9° (o Extra Inning) empatados, pasa automáticamente al siguiente Extra Inning (Alta ▲ del Inning + 1).
function evaluateBaseballThirdOutTransition(store, game) {
  const regInn = Number(game.regulationInnings || 9);
  const currInn = Number(game.inning || 1);
  const awayTot = getBaseballTeamTotals(store, game, game.awayTeamId);
  const homeTot = getBaseballTeamTotals(store, game, game.homeTeamId);
  const awayTeam = store.teams.find(t => t.id === game.awayTeamId);
  const homeTeam = store.teams.find(t => t.id === game.homeTeamId);
  const awayName = awayTeam ? awayTeam.name : 'Visitante';
  const homeName = homeTeam ? homeTeam.name : 'Local';

  game.outs = 0;
  game.balls = 0;
  game.strikes = 0;
  game.bases = { first: '', second: '', third: '' };

  if (!Array.isArray(game.logsBaseball)) game.logsBaseball = [];

  if (game.half === 'top') {
    // Terminó la Alta (▲) del inning
    if (currInn >= regInn && homeTot.runs > awayTot.runs) {
      // El equipo que abre en el 9° (o extra inning) no pudo empatar ni irse arriba -> Pierde automáticamente
      game.status = 'Finalizado';
      game.finishedAt = Date.now();
      game.logsBaseball.unshift({
        id: uid('bblog'),
        inning: `▲${currInn}`,
        teamName: homeTeam ? (homeTeam.shortName || homeTeam.name) : 'LOC',
        playerName: '🏆 FIN DEL JUEGO',
        text: `🏁 ¡FINAL! ${awayName} no pudo empatar en la alta del ${currInn}° inning. Gana ${homeName} (${homeTot.runs}-${awayTot.runs}).`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });
      return { finished: true, winner: 'home' };
    }
    // Pasa a la Baja (▼) del mismo inning
    game.half = 'bottom';
    return { finished: false };
  } else {
    // Terminó la Baja (▼) del inning
    if (currInn >= regInn && awayTot.runs !== homeTot.runs) {
      // El que cierra en el 9° (o extra inning) no pudo empatar ni adelantar (o ya estaba arriba) -> Termina el partido
      game.status = 'Finalizado';
      game.finishedAt = Date.now();
      const winSide = awayTot.runs > homeTot.runs ? 'away' : 'home';
      const winTeam = winSide === 'away' ? awayTeam : homeTeam;
      const winName = winSide === 'away' ? awayName : homeName;
      const loseName = winSide === 'away' ? homeName : awayName;
      const winScore = winSide === 'away' ? awayTot.runs : homeTot.runs;
      const loseScore = winSide === 'away' ? homeTot.runs : awayTot.runs;

      game.logsBaseball.unshift({
        id: uid('bblog'),
        inning: `▼${currInn}`,
        teamName: winTeam ? (winTeam.shortName || winTeam.name) : 'FINAL',
        playerName: '🏆 FIN DEL JUEGO',
        text: `🏁 ¡FINAL! ${loseName} no pudo empatar o adelantar en el cierre del ${currInn}° inning. Gana ${winName} (${winScore}-${loseScore}).`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });
      return { finished: true, winner: winSide };
    }

    // Si están empatados al final del 9° (o si es antes del 9°), avanza al siguiente inning (Extra Innings si currInn >= 9)
    const nextInn = currInn + 1;
    game.half = 'top';
    game.inning = nextInn;
    if (currInn >= regInn && awayTot.runs === homeTot.runs) {
      game.logsBaseball.unshift({
        id: uid('bblog'),
        inning: `▲${nextInn}`,
        teamName: 'EXTRA',
        playerName: '⚾ EXTRA INNINGS',
        text: `⚾ Juego empatado (${awayTot.runs}-${homeTot.runs}) al cerrar el ${currInn}° inning. ¡Inicia el Extra Inning #${nextInn}!`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });
    }
    return { finished: false };
  }
}

function getBaseballBatterSummaryText(store, game) {
  if (!game) return 'ESPERANDO BATEADOR...';
  const cfg = game.baseballOverlayConfig || {};
  if (cfg.customBatterText && cfg.customBatterText.trim() !== '') {
    return cfg.customBatterText.trim();
  }
  if (game.status === 'Finalizado') {
    const winInfo = getBaseballWinnerSummary(store, game);
    if (winInfo) {
      return `🏁 FINAL DEL PARTIDO   •   ${winInfo.summaryText}`;
    }
  }
  const batterId = game.currentBatterId;
  if (!batterId) return 'AL BATE: SELECCIONA BATEADOR';
  const p = store.players.find(x => x.id === batterId);
  if (!p) return 'AL BATE: SELECCIONA BATEADOR';

  const st = getBaseballPlayerStats(game, p.id);
  const extras = [];
  if (st.hr > 0) extras.push(st.hr === 1 ? 'HR' : `${st.hr} HR`);
  if (st.t3b > 0) extras.push(st.t3b === 1 ? '3B' : `${st.t3b} 3B`);
  if (st.d2b > 0) extras.push(st.d2b === 1 ? '2B' : `${st.d2b} 2B`);
  if (st.rbi > 0) extras.push(`${st.rbi} RBI`);
  if (st.r > 0) extras.push(`${st.r} R`);
  extras.push(`${st.avg} AVG`);

  const numPrefix = p.number !== undefined && p.number !== '' ? `${p.number}. ` : '';
  return `${numPrefix}${String(p.name || '').toUpperCase()}   ${st.h}-${st.ab}, ${extras.join(', ')}`;
}

// Obtiene los jugadores de un equipo de Baseball en su orden de bateo (1° Bate, 2° Bate, 3° Bate... sin límite)
// Por defecto respeta el orden en que fueron creados o el orden manual guardado en el equipo/juego
function getTeamBaseballLineup(store, game, teamId) {
  const rawTeamPlayers = store.players.filter(p => p.teamId === teamId);
  // Orden base del equipo: si tienen battingOrder numérico, usarlo; si no, el orden de creación en store.players
  const baseOrdered = [...rawTeamPlayers].sort((a, b) => {
    const ao = typeof a.battingOrder === 'number' ? a.battingOrder : rawTeamPlayers.indexOf(a);
    const bo = typeof b.battingOrder === 'number' ? b.battingOrder : rawTeamPlayers.indexOf(b);
    return ao - bo;
  });

  if (!game) {
    return baseOrdered.map((p, idx) => ({ ...p, battingSlot: idx + 1 }));
  }

  const isHome = teamId === game.homeTeamId;
  const customOrder = isHome ? (game.battingOrderHome || []) : (game.battingOrderAway || []);
  const playerMap = new Map(baseOrdered.map(p => [p.id, p]));

  const finalOrder = [];
  const seen = new Set();

  customOrder.forEach(pid => {
    if (playerMap.has(pid) && !seen.has(pid)) {
      finalOrder.push(playerMap.get(pid));
      seen.add(pid);
    }
  });

  baseOrdered.forEach(p => {
    if (!seen.has(p.id)) {
      finalOrder.push(p);
      seen.add(p.id);
    }
  });

  return finalOrder.map((p, idx) => ({
    ...p,
    battingSlot: idx + 1
  }));
}

// Devuelve la cola rotativa de bateo donde SIEMPRE aparece de primero el jugador que va a batear ahora,
// seguido por el prevenido y los siguientes en el orden al bate.
function getRotatingBaseballQueueForTeam(store, game, teamId) {
  const lineup = getTeamBaseballLineup(store, game, teamId);
  if (lineup.length === 0 || !game) return [];

  const isHome = teamId === game.homeTeamId;
  let activeId = isHome ? game.nextBatterHomeId : game.nextBatterAwayId;

  // Si el currentBatterId pertenece a este equipo, ése es quien está al bate ahora mismo
  if (game.currentBatterId && lineup.some(p => p.id === game.currentBatterId)) {
    activeId = game.currentBatterId;
  }

  let startIdx = lineup.findIndex(p => p.id === activeId);
  if (startIdx < 0) startIdx = 0;

  const rotated = [];
  for (let i = 0; i < lineup.length; i++) {
    const item = lineup[(startIdx + i) % lineup.length];
    rotated.push({
      ...item,
      queuePosition: i // 0 = Al Bate Ahora, 1 = Prevenido (En Espera), 2 = En Hoyito...
    });
  }
  return rotated;
}

window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY && e.newValue) {
    try {
      memoryStore = normalizeStore(JSON.parse(e.newValue));
      window.dispatchEvent(new Event('storeUpdated'));
    } catch (err) {}
  }
});

initFirebaseSync();
