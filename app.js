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

const CLIENT_TAB_ID = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let lastLocalMutationAt = 0;
let lastCrossTabSyncAt = 0;
let firebasePushTimer = null;
let firebaseWriteInFlight = false;
let firebasePendingPush = false;
let hasCompletedInitialFirebaseLoad = false;

const INITIAL_STORE = {
  _rev: 0,
  _updatedAt: 0,
  _sourceTabId: '',
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
      const incoming = ev.data.store;
      if (incoming._sourceTabId && incoming._sourceTabId === CLIENT_TAB_ID) return;
      lastCrossTabSyncAt = Date.now();
      const { mergedStore } = mergeIncomingStore(memoryStore, incoming);
      memoryStore = mergedStore;
      updateKnownSnapshotsFromStore(memoryStore);
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
  copy._boardRev = Number(copy._boardRev || 0);
  copy._clockRev = Number(copy._clockRev || 0);
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
  copy.clockLastTickAt = Number(copy.clockLastTickAt || 0);
  copy.isFinal = Boolean(copy.isFinal);
  copy.clockUpdatedAt = Number(copy.clockUpdatedAt || Date.now());
  copy.activeBanner = copy.activeBanner && typeof copy.activeBanner === 'object' ? copy.activeBanner : null;
  copy.createdAt = Number(copy.createdAt || Date.now());
  return copy;
}

function normalizeStandaloneBaseballBoard(b) {
  const copy = { ...b };
  copy.id = copy.id || uid('bbboard');
  copy._boardRev = Number(copy._boardRev || 0);
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

let lastKnownGamesSnapshot = {};

const BASKET_ADDITIVE_STAT_KEYS = [
  'pts1', 'miss1', 'pts2', 'miss2', 'pts3', 'miss3',
  'pf', 'of', 'tf', 'secondsPlayed',
  'rebOff', 'rebDef', 'ast', 'stl', 'blk', 'tov'
];

const BASEBALL_ADDITIVE_STAT_KEYS = [
  'ab', 'h', 'r', 'd2b', 't3b', 'hr', 'rbi', 'k', 'bb'
];

function buildGameSnapshotForDiff(g) {
  if (!g || !g.id) return null;
  const statsCopy = {};
  if (g.stats && typeof g.stats === 'object') {
    Object.keys(g.stats).forEach(pid => {
      statsCopy[pid] = { ...g.stats[pid] };
    });
  }
  const bbStatsCopy = {};
  if (g.baseballStats && typeof g.baseballStats === 'object') {
    Object.keys(g.baseballStats).forEach(pid => {
      bbStatsCopy[pid] = { ...g.baseballStats[pid] };
    });
  }
  const tfCopy = JSON.parse(JSON.stringify(g.teamFouls || {}));
  const toCopy = JSON.parse(JSON.stringify(g.timeoutsUsed || {}));
  const innRunsCopy = JSON.parse(JSON.stringify(g.inningRuns || { away: {}, home: {} }));
  return {
    period: Number(g.period || 1),
    clockSeconds: Number(g.clockSeconds || 0),
    clockRunning: Boolean(g.clockRunning),
    status: g.status || '',
    stats: statsCopy,
    baseballStats: bbStatsCopy,
    teamFouls: tfCopy,
    timeoutsUsed: toCopy,
    inningRuns: innRunsCopy,
    runsAdjustHome: Number(g.runsAdjustHome || 0),
    runsAdjustAway: Number(g.runsAdjustAway || 0),
    errorsHome: Number(g.errorsHome || 0),
    errorsAway: Number(g.errorsAway || 0),
    logsPuntosLen: Array.isArray(g.logsPuntos) ? g.logsPuntos.length : 0,
    logsRALen: Array.isArray(g.logsRA) ? g.logsRA.length : 0,
    logsBaseballLen: Array.isArray(g.logsBaseball) ? g.logsBaseball.length : 0
  };
}

function updateKnownSnapshotsFromStore(store) {
  if (!store || !Array.isArray(store.games)) return;
  const nextMap = {};
  store.games.forEach(g => {
    if (g && g.id) {
      nextMap[g.id] = buildGameSnapshotForDiff(g);
    }
  });
  lastKnownGamesSnapshot = nextMap;
}

function didGameHaveManualReduction(prevSnap, nextGame) {
  if (!prevSnap || !nextGame) return false;
  // 1. Verificar si disminuyó el historial de jugadas (borrado manual con ✕)
  const nextLogsP = Array.isArray(nextGame.logsPuntos) ? nextGame.logsPuntos.length : 0;
  const nextLogsRA = Array.isArray(nextGame.logsRA) ? nextGame.logsRA.length : 0;
  const nextLogsBb = Array.isArray(nextGame.logsBaseball) ? nextGame.logsBaseball.length : 0;
  if (nextLogsP < prevSnap.logsPuntosLen || nextLogsRA < prevSnap.logsRALen || nextLogsBb < prevSnap.logsBaseballLen) {
    return true;
  }

  // 2. Verificar si disminuyó alguna estadística de jugador de baloncesto (edición manual con ✏️)
  const prevStats = prevSnap.stats || {};
  const nextStats = nextGame.stats || {};
  for (const pid of Object.keys(prevStats)) {
    const pSt = prevStats[pid] || {};
    const nSt = nextStats[pid] || {};
    for (const k of BASKET_ADDITIVE_STAT_KEYS) {
      if (k === 'secondsPlayed') continue;
      if (Number(nSt[k] || 0) < Number(pSt[k] || 0)) {
        return true;
      }
    }
    if (Number(nSt.secondsPlayed || 0) + 2 < Number(pSt.secondsPlayed || 0)) {
      return true;
    }
  }

  // 3. Verificar si disminuyó alguna estadística de bateador de baseball (edición manual con ✏️)
  const prevBb = prevSnap.baseballStats || {};
  const nextBb = nextGame.baseballStats || {};
  for (const pid of Object.keys(prevBb)) {
    const pSt = prevBb[pid] || {};
    const nSt = nextBb[pid] || {};
    for (const k of BASEBALL_ADDITIVE_STAT_KEYS) {
      if (Number(nSt[k] || 0) < Number(pSt[k] || 0)) {
        return true;
      }
    }
  }

  // 4. Verificar si disminuyeron faltas de equipo o tiempos muertos
  const prevTF = prevSnap.teamFouls || {};
  const nextTF = nextGame.teamFouls || {};
  for (const qKey of Object.keys(prevTF)) {
    const pq = prevTF[qKey] || {};
    const nq = nextTF[qKey] || {};
    if (Number(nq.home || 0) < Number(pq.home || 0) || Number(nq.away || 0) < Number(pq.away || 0)) {
      return true;
    }
  }

  const prevTO = prevSnap.timeoutsUsed || {};
  const nextTO = nextGame.timeoutsUsed || {};
  for (const stage of ['H1', 'H2']) {
    const ps = prevTO[stage] || {};
    const ns = nextTO[stage] || {};
    if (Number(ns.home || 0) < Number(ps.home || 0) || Number(ns.away || 0) < Number(ps.away || 0)) {
      return true;
    }
  }

  if (
    Number(nextGame.runsAdjustHome || 0) < prevSnap.runsAdjustHome ||
    Number(nextGame.runsAdjustAway || 0) < prevSnap.runsAdjustAway ||
    Number(nextGame.errorsHome || 0) < prevSnap.errorsHome ||
    Number(nextGame.errorsAway || 0) < prevSnap.errorsAway
  ) {
    return true;
  }

  return false;
}

function mergeLogsById(localLogs = [], remoteLogs = []) {
  const seen = new Set();
  const merged = [];
  const combined = [...(Array.isArray(localLogs) ? localLogs : []), ...(Array.isArray(remoteLogs) ? remoteLogs : [])];
  for (const item of combined) {
    if (!item || typeof item !== 'object') continue;
    const key = item.id || `${item.period || item.inning || ''}_${item.clock || item.time || ''}_${item.actorLabel || item.playerName || ''}_${item.detailText || item.label || item.text || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

function mergeGamePair(localGame, remoteGame) {
  if (!localGame) return { game: remoteGame, needsRepush: false };
  if (!remoteGame) return { game: localGame, needsRepush: true };

  let needsRepush = false;
  const lStatsRev = Number(localGame._statsRev || 0);
  const rStatsRev = Number(remoteGame._statsRev || 0);
  const lManualRev = Number(localGame._manualEditRev || 0);
  const rManualRev = Number(remoteGame._manualEditRev || 0);
  const lClockRev = Number(localGame._clockStateRev || 0);
  const rClockRev = Number(remoteGame._clockStateRev || 0);

  // Base general del partido (quintetos en cancha, bateador en turno, bases, configuración de overlay)
  const baseSource = lStatsRev > rStatsRev ? localGame : remoteGame;
  if (lStatsRev > rStatsRev) {
    needsRepush = true;
  }
  const merged = normalizeGame(JSON.parse(JSON.stringify(baseSource)));
  merged._statsRev = Math.max(lStatsRev, rStatsRev);
  merged._manualEditRev = Math.max(lManualRev, rManualRev);
  merged._clockStateRev = Math.max(lClockRev, rClockRev);

  // =========================================================================
  // 1. FUSIÓN INQUEBRANTABLE DE ESTADÍSTICAS, FALTAS Y LOGS
  // Regla de oro: Lo que se anota con un click NUNCA se quita solo.
  // Solo disminuye si hubo una edición manual explícita (_manualEditRev mayor).
  // =========================================================================
  if (rManualRev > lManualRev) {
    // Otro dispositivo hizo una edición manual con el lápiz ✏️ o borró del historial ✕
    merged.stats = JSON.parse(JSON.stringify(remoteGame.stats || {}));
    merged.baseballStats = JSON.parse(JSON.stringify(remoteGame.baseballStats || {}));
    merged.teamFouls = JSON.parse(JSON.stringify(remoteGame.teamFouls || {}));
    merged.timeoutsUsed = JSON.parse(JSON.stringify(remoteGame.timeoutsUsed || {}));
    merged.logsPuntos = JSON.parse(JSON.stringify(remoteGame.logsPuntos || []));
    merged.logsRA = JSON.parse(JSON.stringify(remoteGame.logsRA || []));
    merged.logsBaseball = JSON.parse(JSON.stringify(remoteGame.logsBaseball || []));
    merged.inningRuns = JSON.parse(JSON.stringify(remoteGame.inningRuns || { away: {}, home: {} }));
    merged.runsAdjustHome = Number(remoteGame.runsAdjustHome || 0);
    merged.runsAdjustAway = Number(remoteGame.runsAdjustAway || 0);
    merged.errorsHome = Number(remoteGame.errorsHome || 0);
    merged.errorsAway = Number(remoteGame.errorsAway || 0);
  } else if (lManualRev > rManualRev) {
    // Este dispositivo hizo una edición manual y el paquete remoto es viejo
    merged.stats = JSON.parse(JSON.stringify(localGame.stats || {}));
    merged.baseballStats = JSON.parse(JSON.stringify(localGame.baseballStats || {}));
    merged.teamFouls = JSON.parse(JSON.stringify(localGame.teamFouls || {}));
    merged.timeoutsUsed = JSON.parse(JSON.stringify(localGame.timeoutsUsed || {}));
    merged.logsPuntos = JSON.parse(JSON.stringify(localGame.logsPuntos || []));
    merged.logsRA = JSON.parse(JSON.stringify(localGame.logsRA || []));
    merged.logsBaseball = JSON.parse(JSON.stringify(localGame.logsBaseball || []));
    merged.inningRuns = JSON.parse(JSON.stringify(localGame.inningRuns || { away: {}, home: {} }));
    merged.runsAdjustHome = Number(localGame.runsAdjustHome || 0);
    merged.runsAdjustAway = Number(localGame.runsAdjustAway || 0);
    merged.errorsHome = Number(localGame.errorsHome || 0);
    merged.errorsAway = Number(localGame.errorsAway || 0);
    needsRepush = true;
  } else {
    // Ningún dispositivo ha restado estadísticas manualmente -> Fusión aditiva Math.max
    const allPlayerIds = new Set([
      ...Object.keys(localGame.stats || {}),
      ...Object.keys(remoteGame.stats || {})
    ]);
    const mergedStats = {};
    allPlayerIds.forEach(pid => {
      const lSt = (localGame.stats && localGame.stats[pid]) || getEmptyPlayerStats();
      const rSt = (remoteGame.stats && remoteGame.stats[pid]) || getEmptyPlayerStats();
      const mSt = { ...getEmptyPlayerStats(), ...(lStatsRev >= rStatsRev ? lSt : rSt) };
      for (const k of BASKET_ADDITIVE_STAT_KEYS) {
        const lVal = Number(lSt[k] || 0);
        const rVal = Number(rSt[k] || 0);
        mSt[k] = Math.max(lVal, rVal);
        if (k !== 'secondsPlayed' && lVal > rVal) {
          needsRepush = true;
        }
      }
      mergedStats[pid] = mSt;
    });
    merged.stats = mergedStats;

    // Baseball stats aditivas
    const allBbPlayerIds = new Set([
      ...Object.keys(localGame.baseballStats || {}),
      ...Object.keys(remoteGame.baseballStats || {})
    ]);
    const mergedBbStats = {};
    allBbPlayerIds.forEach(pid => {
      const lBb = (localGame.baseballStats && localGame.baseballStats[pid]) || getEmptyBaseballPlayerStats();
      const rBb = (remoteGame.baseballStats && remoteGame.baseballStats[pid]) || getEmptyBaseballPlayerStats();
      const mBb = { ...getEmptyBaseballPlayerStats() };
      for (const k of BASEBALL_ADDITIVE_STAT_KEYS) {
        const lVal = Number(lBb[k] || 0);
        const rVal = Number(rBb[k] || 0);
        mBb[k] = Math.max(lVal, rVal);
        if (lVal > rVal) {
          needsRepush = true;
        }
      }
      mergedBbStats[pid] = mBb;
    });
    merged.baseballStats = mergedBbStats;

    // Faltas colectivas por cuarto (teamFouls)
    const allQKeys = new Set([
      ...Object.keys(localGame.teamFouls || {}),
      ...Object.keys(remoteGame.teamFouls || {})
    ]);
    const mergedTF = {};
    allQKeys.forEach(qk => {
      const lq = (localGame.teamFouls && localGame.teamFouls[qk]) || { home: 0, away: 0 };
      const rq = (remoteGame.teamFouls && remoteGame.teamFouls[qk]) || { home: 0, away: 0 };
      const hMax = Math.max(Number(lq.home || 0), Number(rq.home || 0));
      const aMax = Math.max(Number(lq.away || 0), Number(rq.away || 0));
      if (Number(lq.home || 0) > Number(rq.home || 0) || Number(lq.away || 0) > Number(rq.away || 0)) {
        needsRepush = true;
      }
      mergedTF[qk] = { home: hMax, away: aMax };
    });
    merged.teamFouls = mergedTF;

    // Tiempos muertos (timeoutsUsed)
    const lTO = localGame.timeoutsUsed || { H1: { home: 0, away: 0 }, H2: { home: 0, away: 0 }, OT: {} };
    const rTO = remoteGame.timeoutsUsed || { H1: { home: 0, away: 0 }, H2: { home: 0, away: 0 }, OT: {} };
    const mergedTO = {
      H1: {
        home: Math.max(Number((lTO.H1 && lTO.H1.home) || 0), Number((rTO.H1 && rTO.H1.home) || 0)),
        away: Math.max(Number((lTO.H1 && lTO.H1.away) || 0), Number((rTO.H1 && rTO.H1.away) || 0))
      },
      H2: {
        home: Math.max(Number((lTO.H2 && lTO.H2.home) || 0), Number((rTO.H2 && rTO.H2.home) || 0)),
        away: Math.max(Number((lTO.H2 && lTO.H2.away) || 0), Number((rTO.H2 && rTO.H2.away) || 0))
      },
      OT: { ...(rTO.OT || {}), ...(lTO.OT || {}) }
    };
    const otKeys = new Set([...Object.keys(lTO.OT || {}), ...Object.keys(rTO.OT || {})]);
    otKeys.forEach(otk => {
      const lot = (lTO.OT && lTO.OT[otk]) || { home: 0, away: 0 };
      const rot = (rTO.OT && rTO.OT[otk]) || { home: 0, away: 0 };
      mergedTO.OT[otk] = {
        home: Math.max(Number(lot.home || 0), Number(rot.home || 0)),
        away: Math.max(Number(lot.away || 0), Number(rot.away || 0))
      };
    });
    merged.timeoutsUsed = mergedTO;

    // Historiales de jugadas (unión sin duplicados)
    merged.logsPuntos = mergeLogsById(localGame.logsPuntos, remoteGame.logsPuntos);
    merged.logsRA = mergeLogsById(localGame.logsRA, remoteGame.logsRA);
    merged.logsBaseball = mergeLogsById(localGame.logsBaseball, remoteGame.logsBaseball);
    if (
      merged.logsPuntos.length > (remoteGame.logsPuntos || []).length ||
      merged.logsRA.length > (remoteGame.logsRA || []).length ||
      merged.logsBaseball.length > (remoteGame.logsBaseball || []).length
    ) {
      needsRepush = true;
    }

    // Carreras por entrada y ajustes en Baseball
    merged.runsAdjustHome = Math.max(Number(localGame.runsAdjustHome || 0), Number(remoteGame.runsAdjustHome || 0));
    merged.runsAdjustAway = Math.max(Number(localGame.runsAdjustAway || 0), Number(remoteGame.runsAdjustAway || 0));
    merged.errorsHome = Math.max(Number(localGame.errorsHome || 0), Number(remoteGame.errorsHome || 0));
    merged.errorsAway = Math.max(Number(localGame.errorsAway || 0), Number(remoteGame.errorsAway || 0));

    const lInn = localGame.inningRuns || { away: {}, home: {} };
    const rInn = remoteGame.inningRuns || { away: {}, home: {} };
    const mergedInn = { away: {}, home: {} };
    ['away', 'home'].forEach(sideKey => {
      const keys = new Set([...Object.keys(lInn[sideKey] || {}), ...Object.keys(rInn[sideKey] || {})]);
      keys.forEach(ik => {
        mergedInn[sideKey][ik] = Math.max(Number((lInn[sideKey] && lInn[sideKey][ik]) || 0), Number((rInn[sideKey] && rInn[sideKey][ik]) || 0));
      });
    });
    merged.inningRuns = mergedInn;
  }

  // =========================================================================
  // 2. FUSIÓN DEL RELOJ Y PERÍODO (SIN SALTOS ATRÁS NI LAG)
  // =========================================================================
  if (lClockRev > rClockRev) {
    merged.period = localGame.period;
    merged.clockRunning = localGame.clockRunning;
    merged.clockSeconds = localGame.clockSeconds;
    merged.clockOwnerTabId = localGame.clockOwnerTabId;
    needsRepush = true;
  } else if (rClockRev > lClockRev) {
    merged.period = remoteGame.period;
    merged.clockRunning = remoteGame.clockRunning;
    merged.clockSeconds = remoteGame.clockSeconds;
    merged.clockOwnerTabId = remoteGame.clockOwnerTabId;
  } else {
    // Mismo estado de reloj y período: si está corriendo, el tiempo solo baja (Math.min)
    merged.period = remoteGame.period;
    merged.clockRunning = remoteGame.clockRunning;
    if (merged.clockRunning && localGame.period === remoteGame.period) {
      merged.clockSeconds = Math.min(Number(localGame.clockSeconds || 0), Number(remoteGame.clockSeconds || 0));
    } else {
      merged.clockSeconds = remoteGame.clockSeconds;
    }
  }

  merged.leadTimeHome = Math.max(Number(localGame.leadTimeHome || 0), Number(remoteGame.leadTimeHome || 0));
  merged.leadTimeAway = Math.max(Number(localGame.leadTimeAway || 0), Number(remoteGame.leadTimeAway || 0));
  merged.tiedTime = Math.max(Number(localGame.tiedTime || 0), Number(remoteGame.tiedTime || 0));
  merged.biggestLeadHome = Math.max(Number(localGame.biggestLeadHome || 0), Number(remoteGame.biggestLeadHome || 0));
  merged.biggestLeadAway = Math.max(Number(localGame.biggestLeadAway || 0), Number(remoteGame.biggestLeadAway || 0));

  return { game: merged, needsRepush };
}

function mergeIncomingStore(localStore, remoteRaw) {
  const remoteStore = normalizeStore(remoteRaw);
  if (!localStore) {
    return { mergedStore: remoteStore, needsRepush: false };
  }

  let anyNeedsRepush = false;
  const localGamesMap = new Map((localStore.games || []).map(g => [g.id, g]));
  const remoteGamesMap = new Map((remoteStore.games || []).map(g => [g.id, g]));
  const allGameIds = new Set([...remoteGamesMap.keys(), ...localGamesMap.keys()]);

  const mergedGames = [];
  allGameIds.forEach(gid => {
    const lG = localGamesMap.get(gid);
    const rG = remoteGamesMap.get(gid);
    if (lG && rG) {
      const { game, needsRepush } = mergeGamePair(lG, rG);
      mergedGames.push(game);
      if (needsRepush) anyNeedsRepush = true;
    } else if (rG) {
      mergedGames.push(rG);
    } else if (lG) {
      // Si se acaba de crear localmente hace menos de 10 segundos, conservarlo
      if (Date.now() - lastLocalMutationAt < 10000) {
        mergedGames.push(lG);
        anyNeedsRepush = true;
      }
    }
  });

  // Conservar también jugadores recién agregados en vivo desde baseball/basket
  const localPlayersMap = new Map((localStore.players || []).map(p => [p.id, p]));
  const remotePlayersMap = new Map((remoteStore.players || []).map(p => [p.id, p]));
  const mergedPlayers = [...remoteStore.players];
  localPlayersMap.forEach((lp, pid) => {
    if (!remotePlayersMap.has(pid) && (Date.now() - lastLocalMutationAt < 10000)) {
      mergedPlayers.push(lp);
      anyNeedsRepush = true;
    }
  });

  // Fusionar Pizarras Independientes de Baloncesto
  const localBoardsMap = new Map((localStore.standaloneBoards || []).map(b => [b.id, b]));
  const remoteBoardsMap = new Map((remoteStore.standaloneBoards || []).map(b => [b.id, b]));
  const allBoardIds = new Set([...remoteBoardsMap.keys(), ...localBoardsMap.keys()]);
  const mergedBoards = [];
  allBoardIds.forEach(bid => {
    const lB = localBoardsMap.get(bid);
    const rB = remoteBoardsMap.get(bid);
    if (lB && rB) {
      const lBRev = Number(lB._boardRev || 0);
      const rBRev = Number(rB._boardRev || 0);
      const lCRev = Number(lB._clockRev || 0);
      const rCRev = Number(rB._clockRev || 0);
      const baseB = normalizeStandaloneBoard(JSON.parse(JSON.stringify(lBRev > rBRev ? lB : rB)));
      if (lBRev > rBRev) anyNeedsRepush = true;
      baseB._boardRev = Math.max(lBRev, rBRev);
      baseB._clockRev = Math.max(lCRev, rCRev);
      if (lCRev > rCRev) {
        baseB.period = lB.period;
        baseB.clockRunning = lB.clockRunning;
        baseB.clockSeconds = lB.clockSeconds;
        anyNeedsRepush = true;
      } else if (rCRev > lCRev) {
        baseB.period = rB.period;
        baseB.clockRunning = rB.clockRunning;
        baseB.clockSeconds = rB.clockSeconds;
      } else if (baseB.clockRunning && lB.period === rB.period) {
        baseB.clockSeconds = Math.min(Number(lB.clockSeconds || 0), Number(rB.clockSeconds || 0));
      }
      mergedBoards.push(baseB);
    } else if (rB) {
      mergedBoards.push(rB);
    } else if (lB && (Date.now() - lastLocalMutationAt < 10000)) {
      mergedBoards.push(lB);
      anyNeedsRepush = true;
    }
  });

  // Fusionar Pizarras Independientes de Baseball
  const localBbBoardsMap = new Map((localStore.standaloneBaseballBoards || []).map(b => [b.id, b]));
  const remoteBbBoardsMap = new Map((remoteStore.standaloneBaseballBoards || []).map(b => [b.id, b]));
  const allBbBoardIds = new Set([...remoteBbBoardsMap.keys(), ...localBbBoardsMap.keys()]);
  const mergedBbBoards = [];
  allBbBoardIds.forEach(bid => {
    const lB = localBbBoardsMap.get(bid);
    const rB = remoteBbBoardsMap.get(bid);
    if (lB && rB) {
      const lBRev = Number(lB._boardRev || 0);
      const rBRev = Number(rB._boardRev || 0);
      const baseB = normalizeStandaloneBaseballBoard(JSON.parse(JSON.stringify(lBRev > rBRev ? lB : rB)));
      if (lBRev > rBRev) anyNeedsRepush = true;
      baseB._boardRev = Math.max(lBRev, rBRev);
      mergedBbBoards.push(baseB);
    } else if (rB) {
      mergedBbBoards.push(rB);
    } else if (lB && (Date.now() - lastLocalMutationAt < 10000)) {
      mergedBbBoards.push(lB);
      anyNeedsRepush = true;
    }
  });

  const mergedStore = {
    ...remoteStore,
    _rev: Math.max(Number(localStore._rev || 0), Number(remoteStore._rev || 0)),
    players: mergedPlayers,
    games: mergedGames,
    standaloneBoards: mergedBoards,
    standaloneBaseballBoards: mergedBbBoards
  };

  return { mergedStore, needsRepush: anyNeedsRepush };
}

function normalizeGame(g) {
  const copy = { ...g };
  copy._statsRev = Number(copy._statsRev || 0);
  copy._manualEditRev = Number(copy._manualEditRev || 0);
  copy._clockStateRev = Number(copy._clockStateRev || 0);
  copy.clockOwnerTabId = String(copy.clockOwnerTabId || '');
  copy.sport = copy.sport || '';
  copy.period = Number(copy.period || 1);
  copy.clockSeconds = typeof copy.clockSeconds === 'number' ? copy.clockSeconds : 600;
  copy.clockRunning = Boolean(copy.clockRunning);
  copy.clockLastTickAt = Number(copy.clockLastTickAt || 0);
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
    _rev: Number(base._rev || 0),
    _updatedAt: Number(base._updatedAt || 0),
    _sourceTabId: String(base._sourceTabId || ''),
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
      updateKnownSnapshotsFromStore(memoryStore);
      return memoryStore;
    }
  } catch (e) {
    console.error('Error leyendo cache local:', e);
  }
  memoryStore = normalizeStore(INITIAL_STORE);
  updateKnownSnapshotsFromStore(memoryStore);
  return memoryStore;
}

function flushFirebasePush() {
  if (firebasePushTimer) {
    clearTimeout(firebasePushTimer);
    firebasePushTimer = null;
  }
  if (!firebaseRef || !firebaseSetFn || isApplyingRemoteUpdate || !memoryStore) return;
  if (firebaseWriteInFlight) {
    firebasePendingPush = true;
    return;
  }

  firebaseWriteInFlight = true;
  firebasePendingPush = false;
  const payloadToSend = memoryStore;

  firebaseSetFn(firebaseRef, payloadToSend)
    .then(() => {
      firebaseWriteInFlight = false;
      setFirebaseStatus('connected', '');
      if (firebasePendingPush) {
        flushFirebasePush();
      }
    })
    .catch((err) => {
      firebaseWriteInFlight = false;
      if (err && (err.code === 'PERMISSION_DENIED' || String(err.message).includes('permission_denied') || String(err.message).includes('PERMISSION_DENIED'))) {
        setFirebaseStatus('permission_denied', 'Permiso denegado en reglas de Firebase');
      } else {
        setFirebaseStatus('offline', err.message || 'Error de conexión con Firebase');
      }
    });
}

function scheduleFirebasePush(delayMs = 50) {
  if (!firebaseRef || !firebaseSetFn || isApplyingRemoteUpdate) return;
  if (firebaseWriteInFlight) {
    firebasePendingPush = true;
    return;
  }
  if (firebasePushTimer) {
    clearTimeout(firebasePushTimer);
  }
  if (delayMs <= 0) {
    flushFirebasePush();
  } else {
    firebasePushTimer = setTimeout(flushFirebasePush, delayMs);
  }
}

function saveStore(store, options = {}) {
  const isClockTick = Boolean(options && options.isClockTick);
  const isManualEdit = Boolean(options && options.isManualEdit);

  const prevRev = Number((memoryStore && memoryStore._rev) || 0);
  const incomingRev = Number((store && store._rev) || 0);
  // Contador lógico puro sin Date.now() para evitar desfase de reloj entre celular y PC
  const nextRev = Math.max(prevRev, incomingRev) + 1;

  const normalized = normalizeStore(store);
  normalized._rev = nextRev;
  normalized._updatedAt = Date.now();
  normalized._sourceTabId = CLIENT_TAB_ID;

  if (!isApplyingRemoteUpdate && Array.isArray(normalized.games)) {
    normalized.games.forEach(g => {
      const prevSnap = lastKnownGamesSnapshot[g.id];
      if (isManualEdit || didGameHaveManualReduction(prevSnap, g)) {
        g._manualEditRev = Number(g._manualEditRev || 0) + 1;
        g._statsRev = Number(g._statsRev || 0) + 1;
      } else if (!isClockTick) {
        g._statsRev = Number(g._statsRev || 0) + 1;
      }

      if (prevSnap) {
        const clockDiff = Math.abs(Number(g.clockSeconds || 0) - Number(prevSnap.clockSeconds || 0));
        if (
          Boolean(g.clockRunning) !== Boolean(prevSnap.clockRunning) ||
          Number(g.period || 1) !== Number(prevSnap.period || 1) ||
          clockDiff > 2
        ) {
          g._clockStateRev = Number(g._clockStateRev || 0) + 1;
        }
      }
    });
  }

  if (!isApplyingRemoteUpdate && !isClockTick) {
    if (Array.isArray(normalized.standaloneBoards)) {
      normalized.standaloneBoards.forEach(b => {
        b._boardRev = Number(b._boardRev || 0) + 1;
        b._clockRev = Number(b._clockRev || 0) + 1;
      });
    }
    if (Array.isArray(normalized.standaloneBaseballBoards)) {
      normalized.standaloneBaseballBoards.forEach(b => {
        b._boardRev = Number(b._boardRev || 0) + 1;
      });
    }
  }

  memoryStore = normalized;
  updateKnownSnapshotsFromStore(memoryStore);
  if (!isClockTick) {
    lastLocalMutationAt = Date.now();
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore));
  } catch (e) {
    console.error('Error guardando en localStorage:', e);
  }
  if (obsBroadcastChannel && !isApplyingRemoteUpdate) {
    try {
      obsBroadcastChannel.postMessage({ type: 'STORE_SYNC', store: memoryStore, sourceTabId: CLIENT_TAB_ID });
    } catch (e) {}
  }
  window.dispatchEvent(new Event('storeUpdated'));

  if (!isApplyingRemoteUpdate) {
    if (isClockTick) {
      scheduleFirebasePush(90);
    } else {
      // Cualquier anotación o falta se envía en 0ms al instante
      flushFirebasePush();
    }
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
          if (hasCompletedInitialFirebaseLoad) {
            // Ignorar el eco de nuestra propia pestaña
            if (remoteVal._sourceTabId && remoteVal._sourceTabId === CLIENT_TAB_ID) {
              return;
            }
          }

          const { mergedStore, needsRepush } = hasCompletedInitialFirebaseLoad
            ? mergeIncomingStore(memoryStore, remoteVal)
            : { mergedStore: normalizeStore(remoteVal), needsRepush: false };

          hasCompletedInitialFirebaseLoad = true;
          isApplyingRemoteUpdate = true;
          memoryStore = mergedStore;
          updateKnownSnapshotsFromStore(memoryStore);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore));
          } catch (e) {}
          window.dispatchEvent(new Event('storeUpdated'));
          isApplyingRemoteUpdate = false;

          // Si el paquete remoto traía datos viejos que intentaron borrar una anotación local,
          // re-empujar el estado fusionado inmediatamente a Firebase para que todos los dispositivos converjan
          if (needsRepush) {
            memoryStore._rev = Number(memoryStore._rev || 0) + 1;
            memoryStore._sourceTabId = CLIENT_TAB_ID;
            scheduleFirebasePush(30);
          }
        } else {
          hasCompletedInitialFirebaseLoad = true;
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
    winnerSide: 'none',
    winnerName: '',
    winnerShort: '',
    loserName: '',
    winnerRuns: awayTot.runs,
    loserRuns: homeTot.runs,
    summaryText: `⚾ JUEGO EN DEFINICIÓN (${awayTot.runs}-${homeTot.runs})`
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
      const incoming = JSON.parse(e.newValue);
      if (incoming && incoming._sourceTabId && incoming._sourceTabId === CLIENT_TAB_ID) return;
      lastCrossTabSyncAt = Date.now();
      const { mergedStore } = mergeIncomingStore(memoryStore, incoming);
      memoryStore = mergedStore;
      updateKnownSnapshotsFromStore(memoryStore);
      window.dispatchEvent(new Event('storeUpdated'));
    } catch (err) {}
  }
});

initFirebaseSync();
