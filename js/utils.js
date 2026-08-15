/* =========================================================================
   utils.js — Petits outils réutilisables partout dans le jeu.
   Aucune dépendance : ce fichier est chargé en premier.

   POURQUOI un fichier à part ? Le formatage des nombres est LE truc qu'on
   appelle des centaines de fois par seconde dans un incrémental. L'isoler
   permet de l'optimiser (ou de le changer de notation) sans toucher au reste.
   ========================================================================= */

/* Suffixes courts. Au-delà, on bascule en notation scientifique (1.23e33),
   parce qu'inventer des noms au-delà de "Yotta" ne rend service à personne. */
const SUFFIXES = ['', ' K', ' M', ' G', ' T', ' P', ' E', ' Z', ' Y'];

/**
 * Formate un nombre pour l'affichage.
 * @param {number} n      la valeur
 * @param {number} digits nb de décimales pour les petits nombres (< 1000)
 *
 * Règles choisies (lisibilité avant exactitude) :
 *  - < 1000        : on garde les décimales (utile pour "0.4 σ/s" au début)
 *  - < 1e27        : suffixe K/M/G/T/P/E/Z/Y, 2 décimales
 *  - au-delà       : notation scientifique
 */
function fmt(n, digits = 1) {
  if (n === Infinity) return '∞';
  if (!isFinite(n) || isNaN(n)) return '0';
  const neg = n < 0;
  n = Math.abs(n);

  let out;
  if (n < 1000) {
    // En dessous de 10 on montre les décimales, au-dessus c'est du bruit visuel.
    out = n < 10 ? n.toFixed(digits) : n.toFixed(n < 100 ? 1 : 0);
    // On enlève les ".0" inutiles
    if (out.endsWith('.0')) out = out.slice(0, -2);
  } else {
    // tier = combien de fois on peut diviser par 1000
    const tier = Math.floor(Math.log10(n) / 3);
    if (tier < SUFFIXES.length) {
      const scaled = n / Math.pow(1000, tier);
      out = scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0) + SUFFIXES[tier];
    } else {
      out = n.toExponential(2).replace('e+', 'e');
    }
  }
  return neg ? '-' + out : out;
}

/** Formate un entier "propre" (profondeur, compteurs) : 1 234 avec espaces fines. */
function fmtInt(n) {
  return Math.floor(n).toLocaleString('fr-FR');
}

/** Formate une durée en secondes → "3 j 4 h", "12 min 30 s", "45 s". */
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return Math.ceil(sec) + ' s';
  if (sec < 3600) return Math.floor(sec / 60) + ' min ' + Math.floor(sec % 60) + ' s';
  if (sec < 86400) return Math.floor(sec / 3600) + ' h ' + Math.floor((sec % 3600) / 60) + ' min';
  return Math.floor(sec / 86400) + ' j ' + Math.floor((sec % 86400) / 3600) + ' h';
}

/** Borne une valeur entre min et max. */
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Coût cumulé de N achats successifs d'un bâtiment à coût géométrique.
 * Formule de la somme d'une suite géométrique :
 *   base * r^owned * (r^n - 1) / (r - 1)
 * POURQUOI ? Pour proposer "Acheter x10 / x100" sans boucler 100 fois.
 */
function geoSum(base, ratio, owned, n) {
  return base * Math.pow(ratio, owned) * (Math.pow(ratio, n) - 1) / (ratio - 1);
}

/**
 * Combien peut-on acheter avec `money` ? (inverse de geoSum)
 * On résout n dans l'équation ci-dessus via un logarithme.
 */
function geoMaxAffordable(base, ratio, owned, money) {
  const c0 = base * Math.pow(ratio, owned);
  if (money < c0) return 0;
  const n = Math.log((money * (ratio - 1)) / c0 + 1) / Math.log(ratio);
  return Math.floor(n);
}

/** Raccourci DOM : document.getElementById. */
const $ = (id) => document.getElementById(id);

/** Crée un élément avec classe + html d'un coup. */
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Tirage aléatoire dans un tableau. */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
