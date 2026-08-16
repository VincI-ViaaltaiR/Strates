/* =========================================================================
   state.js — L'état du jeu, sa sauvegarde et sa remise à zéro.

   RÈGLE D'OR : `S` ne contient QUE des données sérialisables (nombres,
   chaînes, objets simples). Pas de fonction, pas de référence DOM.
   POURQUOI ? Parce que la sauvegarde est un simple JSON.stringify(S).
   Si l'état est propre, la sauvegarde est gratuite et incassable.
   ========================================================================= */

const SAVE_KEY = 'strates_save_v1';

/* Ce qui SURVIT à un comblement (prestige) est marqué ci-dessous.
   Tout le reste repart de zéro. */
function newRun(keep = {}) {
  return {
    /* --- Ressources de la partie en cours --- */
    sediment: keep.sediment || 0,
    knowledge: keep.knowledge || 0,
    depth: 0,
    maxDepth: 0,

    /* --- Possessions de la partie en cours --- */
    tools: keep.tools || {},        // { pelle: 12, pioche: 3, ... }
    upgrades: {},                   // { up_pelle_0: true, ... }
    /* `research` peut être pré-remplie : le Protocole de comblement, une fois
       découvert, n'a pas à être racheté à chaque fouille (voir doPrestige). */
    research: keep.research || {},  // { stratigraphie: true, ... }

    /* --- Événements de forage --- */
    buffs: [],            // effets temporaires actifs : [{ name, until, prodMult… }]
    pendingEvent: null,   // id de l'événement en attente de réponse (survit au rechargement)
    nextEventAt: 0,       // horodatage : pas de nouvel événement avant

    /* --- Statistiques de la run --- */
    runStart: Date.now(),
    runSediment: 0,
  };
}

/* État persistant complet : run en cours + tout ce qui traverse les runs. */
function newGame() {
  return Object.assign(newRun(), {
    /* --- Doctrines de chantier --- */
    doctrine: 'aucune',     // doctrine de la fouille EN COURS
    nextDoctrine: 'aucune', // celle qui prendra effet au prochain comblement
    doctrineRuns: {},       // { ingenierie: 2, … } fouilles menées sous chacune
    mastered: {},           // { ingenierie: true, … } maîtrises acquises

    /* --- PERSISTANT : survit au comblement --- */
    artefacts: {},        // { tesson: 3, silex: 1, ... }  (nb d'exemplaires trouvés)
    meta: {},             // { fondations: true, ... }
    shards: 0,            // éclats disponibles à dépenser
    shardsTotal: 0,       // éclats gagnés à vie → bonus de production passif
    prestiges: 0,
    achievements: {},     // { a_first: true, ... }
    hintsSeen: {},        // aides contextuelles déjà montrées (persistantes)

    /* --- Statistiques globales --- */
    totalSediment: 0,
    totalDepthDug: 0,
    bestDepth: 0,
    playTime: 0,
    started: Date.now(),

    /* --- Journal (lore + événements). On plafonne pour ne pas gonfler la save --- */
    log: [],
    logSeq: 0,

    /* --- Divers --- */
    lastSave: Date.now(),
    seenStrata: {},       // strates dont l'intro a déjà été jouée
    buyMode: 1,           // 1 | 10 | 100 | -1 (max) : mode d'achat des outils
    autoMode: 'safe',     // 'off' | 'safe' | 'max' : politique de descente auto
    tab: 'outils',
  });
}

/* L'objet d'état global. Un seul, volontairement mutable et partagé :
   dans un incrémental, l'immutabilité coûterait très cher à 60 fps. */
let S = newGame();

/* -------------------------------------------------------------------------
   SAUVEGARDE
   ------------------------------------------------------------------------- */
/* `S.calc` contient uniquement des valeurs RECALCULÉES à chaque image
   (multiplicateurs, production…). Les sauvegarder gonflerait le fichier pour
   rien et, pire, risquerait de figer des valeurs périmées au chargement.
   On les écarte donc systématiquement. */
function saveData() {
  const { calc, ...rest } = S;
  return rest;
}

function saveGame(silent = false) {
  S.lastSave = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData()));
    if (!silent) toast('Partie sauvegardée.');
    return true;
  } catch (e) {
    // Cas typique : navigation privée, ou quota dépassé.
    toast('⚠ Sauvegarde impossible (stockage local bloqué).');
    console.error(e);
    return false;
  }
}

function loadGame() {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch (e) {
    console.warn('Stockage local inaccessible.');
  }
  if (!raw) return false;

  try {
    const data = JSON.parse(raw);
    // Fusion défensive : si on ajoute un champ dans une future version,
    // les vieilles sauvegardes n'ont pas ce champ → newGame() fournit le défaut.
    S = Object.assign(newGame(), data);
    // Les sous-objets doivent aussi être garantis non-nuls.
    ['tools','upgrades','research','artefacts','meta','achievements','seenStrata',
     'doctrineRuns','mastered','hintsSeen'].forEach((k) => {
      if (!S[k] || typeof S[k] !== 'object') S[k] = {};
    });
    if (!Array.isArray(S.log)) S.log = [];
    if (!Array.isArray(S.buffs)) S.buffs = [];
    return true;
  } catch (e) {
    console.error('Sauvegarde corrompue :', e);
    return false;
  }
}

function wipeGame() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  S = newGame();
}

/* Export / import en base64 : permet de déplacer sa partie d'un PC à l'autre
   sans serveur. `btoa` ne gère pas l'UTF-8 seul, d'où le encodeURIComponent. */
function exportSave() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(saveData()))));
}

function importSave(str) {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
    if (typeof data.depth !== 'number') throw new Error('format inattendu');
    S = Object.assign(newGame(), data);
    saveGame(true);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

/* -------------------------------------------------------------------------
   JOURNAL — la voix du jeu. Chaque entrée : { t: type, m: message, d: profondeur }
   ------------------------------------------------------------------------- */
function logMsg(type, message, depth) {
  /* `k` = numéro de série de l'entrée. Il permet à l'interface de savoir
     lesquelles sont NOUVELLES, et donc de n'insérer (et n'animer) que
     celles-là au lieu de reconstruire tout le carnet à chaque événement. */
  S.logSeq = (S.logSeq || 0) + 1;
  S.log.unshift({ t: type, m: message, d: depth ?? Math.floor(S.depth), k: S.logSeq });
  if (S.log.length > 120) S.log.length = 120;  // plafond : la save reste légère
  UI.logDirty = true;
}
