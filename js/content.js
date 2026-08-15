/* =========================================================================
   content.js — TOUT le contenu du jeu, en données pures.

   PRINCIPE DE CONCEPTION : aucune logique ici, uniquement des tableaux et
   des objets. Le moteur (engine.js) lit ces données et les applique.
   POURQUOI ? Parce qu'ajouter une strate, un outil ou une recherche doit se
   faire en éditant CE fichier seulement, sans jamais toucher au moteur.
   C'est ce qui rend un incrémental extensible sans devenir un plat de nouilles.

   VOCABULAIRE DES EFFETS (champ `fx`) — lu par engine.computeStats() :
     prodMult          : multiplicateur de la production de sédiment  (×)
     toolCostMult      : multiplicateur du prix des outils            (×, <1 = moins cher)
     digCostMult       : multiplicateur du coût de descente           (×, <1 = moins cher)
     digGrowth         : retranché au taux de croissance du coût/mètre (pt de %)
     artefactChanceMult: multiplicateur de la chance de trouver un artefact
     knowledgeMult     : multiplicateur du savoir gagné
     flag              : débloque une capacité booléenne (autoDig, offline…)
     custom            : effet particulier, codé en dur dans engine.js
   ========================================================================= */

/* -------------------------------------------------------------------------
   CONSTANTES D'ÉQUILIBRAGE
   Tout ce qui gouverne la courbe de progression est ici, en un seul endroit.
   ------------------------------------------------------------------------- */
const BAL = {
  digBase: 15,          // coût en sédiment du tout premier mètre
  digGrowth: 0.075,     // +7,5 % de coût par mètre (c'est LA courbe du jeu)
  toolRatio: 1.15,      // chaque exemplaire d'un outil coûte +15 % (standard du genre)
  artefactChance: 0.20, // 20 % de chance de trouver un artefact par mètre creusé
  offlineCapH: 8,       // heures de progression hors-ligne maximum
  shardDiv: 45,         // profondeur/45 avant mise en puissance → nb d'éclats
  shardPow: 1.45,       // exposant : plus on va profond, plus ça paie
  shardBonus: 0.10,     // +10 % de production par éclat gagné à vie
};

/* -------------------------------------------------------------------------
   LES STRATES — la colonne vertébrale narrative.
   `depth` = profondeur d'entrée. `hardness` multiplie le coût de descente.
   `knowledge` = savoir donné par un artefact de cette strate.
   ------------------------------------------------------------------------- */
const STRATA = [
  {
    id: 'humus', name: 'Terre végétale', depth: 0, hardness: 1, knowledge: 5,
    color: '#6b5136',
    intro: "Vous plantez la bêche. Racines, vers, cailloux. On commence toujours par le facile.",
  },
  {
    id: 'argile', name: 'Argile bleue', depth: 15, hardness: 2.2, knowledge: 15,
    color: '#4a5c6b',
    intro: "L'argile colle aux outils et sent le fond d'étang. Elle conserve tout ce qu'on lui confie.",
  },
  {
    id: 'calcaire', name: 'Calcaire fossilifère', depth: 40, hardness: 5, knowledge: 40,
    color: '#9a927f',
    intro: "La roche est truffée de coquillages. Une mer dormait ici, il y a très longtemps.",
  },
  {
    id: 'nappe', name: 'La Nappe', depth: 75, hardness: 12, knowledge: 100,
    color: '#2f5d6e',
    intro: "L'eau monte plus vite qu'on ne creuse. Il faudra pomper. Elle est étrangement tiède.",
  },
  {
    id: 'granite', name: 'Socle granitique', depth: 120, hardness: 35, knowledge: 275,
    color: '#6a6a72',
    intro: "Le socle. Trois cents millions d'années sans une fissure. Théoriquement, plus rien d'humain en dessous.",
  },
  {
    id: 'cite', name: 'La Cité Noyée', depth: 170, hardness: 110, knowledge: 750,
    color: '#7a5c46',
    intro: "Le trépan a percé dans le vide. En dessous : des murs. Des rues. Sous le socle. Ce n'est pas possible, et pourtant c'est mesurable.",
  },
  {
    id: 'silence', name: 'Le Grand Silence', depth: 230, hardness: 400, knowledge: 2000,
    color: '#26262b',
    intro: "Plus de fossiles, plus de failles, plus de bruit sismique. Une paroi noire, lisse, sans grain. Quelqu'un a poncé la planète.",
  },
  {
    id: 'machine', name: 'La Machinerie', depth: 300, hardness: 1800, knowledge: 6000,
    color: '#7d5a2a',
    intro: "Des dents d'engrenage hautes comme des immeubles. Elles tournent encore. Très lentement. Depuis très longtemps.",
  },
  {
    id: 'reseau', name: 'Le Réseau', depth: 380, hardness: 9000, knowledge: 17500,
    color: '#3f7d6a',
    intro: "Des filaments s'écartent devant le trépan avant qu'il ne les touche. Le forage n'est plus une intrusion : c'est une conversation.",
  },
  {
    id: 'coeur', name: 'Le Cœur', depth: 470, hardness: 50000, knowledge: 50000,
    color: '#8b2f3f',
    intro: "Une cavité. Au centre, quelque chose de petit qui bat. La planète n'est pas un monde : c'est un emballage.",
  },
];

/* -------------------------------------------------------------------------
   LES OUTILS — sources de sédiment (σ/s).
   `cost` = prix du 1er exemplaire, `prod` = σ/s par exemplaire.
   `unlock` = profondeur MAXIMALE atteinte requise pour le voir apparaître.
   Le ratio prod/coût se dégrade volontairement : les gros outils sont moins
   « rentables à l'unité » mais franchissent des ordres de grandeur.
   ------------------------------------------------------------------------- */
const TOOLS = [
  { id: 'mains',    name: 'Mains nues',              cost: 10,     prod: 0.3,    unlock: 0,   desc: "Dix doigts et de la bonne volonté." },
  { id: 'pelle',    name: 'Pelle de terrassier',     cost: 100,    prod: 2,      unlock: 0,   desc: "Le manche est neuf. Ça ne durera pas." },
  { id: 'pioche',   name: 'Pioche à percussion',     cost: 1.1e3,  prod: 8,      unlock: 5,   desc: "Pour quand la terre commence à répondre." },
  { id: 'ouvrier',  name: "Équipe d'ouvriers",       cost: 1.2e4,  prod: 47,     unlock: 15,  desc: "Ils ne posent pas de questions. Encore." },
  { id: 'treuil',   name: 'Treuil à godets',         cost: 1.3e5,  prod: 260,    unlock: 30,  desc: "Remonte la terre pendant que vous descendez." },
  { id: 'foreuse',  name: 'Foreuse pneumatique',     cost: 1.4e6,  prod: 1.4e3,  unlock: 55,  desc: "Le bruit couvre tout le reste. C'est appréciable." },
  { id: 'pompe',    name: "Pompe d'assèchement",     cost: 2.0e7,  prod: 7.8e3,  unlock: 78,  desc: "L'eau part quelque part. Personne ne sait où." },
  { id: 'tunnelier',name: 'Tunnelier vertical',      cost: 3.3e8,  prod: 4.4e4,  unlock: 118, desc: "Douze mètres de diamètre. On ne recule plus." },
  { id: 'sonde',    name: 'Sonde thermique',         cost: 5.1e9,  prod: 2.6e5,  unlock: 168, desc: "Fond la roche au lieu de la casser." },
  { id: 'resonateur',name:'Résonateur sismique',     cost: 7.5e10, prod: 1.6e6,  unlock: 228, desc: "La roche se désagrège d'elle-même, par accord." },
  { id: 'desintegrateur', name: 'Désintégrateur',    cost: 1.0e12, prod: 1.0e7,  unlock: 298, desc: "Retire la matière de l'équation. Ne pas regarder dedans." },
  { id: 'faille',   name: 'Faille gravitationnelle',cost: 1.4e13, prod: 6.5e7,  unlock: 378, desc: "Le puits se creuse en tombant vers lui-même." },
];

/* -------------------------------------------------------------------------
   AMÉLIORATIONS D'OUTILS — générées, pas écrites à la main.

   POURQUOI générer ? 12 outils × 4 paliers = 48 améliorations. Les écrire une
   par une serait 48 occasions de faire une faute de frappe. La règle est
   simple et régulière : à 10/25/50/100 exemplaires, la production DOUBLE.
   ------------------------------------------------------------------------- */
const UPGRADE_TIERS = [
  { need: 10,  mult: 12,     label: 'Affûtage' },
  { need: 25,  mult: 140,    label: 'Renfort' },
  { need: 50,  mult: 1800,   label: 'Motorisation' },
  { need: 100, mult: 25000,  label: 'Surcharge' },
];

const UPGRADES = [];
TOOLS.forEach((t) => {
  UPGRADE_TIERS.forEach((tier, i) => {
    UPGRADES.push({
      id: `up_${t.id}_${i}`,
      name: `${tier.label} : ${t.name}`,
      desc: `${t.name} produit deux fois plus.`,
      cost: t.cost * tier.mult,
      tool: t.id,
      need: tier.need,      // nb d'exemplaires requis pour que l'amélioration apparaisse
    });
  });
});

/* Améliorations globales : elles ne visent pas un outil mais tout le chantier.
   `needDepth` = profondeur maximale atteinte requise. */
const GLOBAL_UPGRADES = [
  { id: 'g_gants',   name: 'Gants de cuir',        desc: "Toute la production ×1,5.",              cost: 5e3,   needDepth: 8,   fx: { prodMult: 1.5 } },
  { id: 'g_etais',   name: 'Étais de bois',        desc: "Descente 10 % moins chère.",             cost: 6e4,   needDepth: 22,  fx: { digCostMult: 0.90 } },
  { id: 'g_lampes',  name: 'Lampes à acétylène',   desc: "Toute la production ×2.",                cost: 8e5,   needDepth: 45,  fx: { prodMult: 2 } },
  { id: 'g_tamis',   name: 'Tamis fin',            desc: "Chance d'artefact ×1,4.",                cost: 9e6,   needDepth: 65,  fx: { artefactChanceMult: 1.4 } },
  { id: 'g_rails',   name: 'Rails de fond',        desc: "Toute la production ×2,5.",              cost: 4e8,   needDepth: 100, fx: { prodMult: 2.5 } },
  { id: 'g_beton',   name: 'Cuvelage béton',       desc: "Descente 15 % moins chère.",             cost: 7e9,   needDepth: 145, fx: { digCostMult: 0.85 } },
  { id: 'g_syndicat',name: 'Convention collective',desc: "Toute la production ×3.",                cost: 2e11,  needDepth: 190, fx: { prodMult: 3 } },
  { id: 'g_scanner', name: 'Scanner à muons',      desc: "Chance d'artefact ×1,6.",                cost: 5e12,  needDepth: 240, fx: { artefactChanceMult: 1.6 } },
  { id: 'g_ia',      name: 'Pilotage autonome',    desc: "Toute la production ×4.",                cost: 3e14,  needDepth: 310, fx: { prodMult: 4 } },
  { id: 'g_accord',  name: 'Accord avec le Réseau',desc: "Toute la production ×6.",                cost: 8e16,  needDepth: 390, fx: { prodMult: 6 } },
];

/* -------------------------------------------------------------------------
   RECHERCHES — achetées avec du Savoir. Réinitialisées au comblement.
   `req` = prérequis (ids d'autres recherches).
   ------------------------------------------------------------------------- */
const RESEARCH = [
  { id: 'stratigraphie', name: 'Stratigraphie', cost: 8, req: [],
    desc: "Lire les couches avant de frapper. Coût de descente −10 %.", fx: { digCostMult: 0.90 } },

  { id: 'outillage', name: 'Outillage affûté', cost: 20, req: ['stratigraphie'],
    desc: "Production ×1,3.", fx: { prodMult: 1.3 } },

  { id: 'treuil_auto', name: 'Descente assistée', cost: 45, req: ['stratigraphie'],
    desc: "DÉBLOQUE la descente automatique : le puits s'approfondit dès que le sédiment suffit.", fx: { flag: 'autoDig' } },

  { id: 'tamisage', name: 'Tamisage systématique', cost: 90, req: ['treuil_auto'],
    desc: "Chance d'artefact ×1,5.", fx: { artefactChanceMult: 1.5 } },

  { id: 'metallurgie', name: 'Métallurgie', cost: 175, req: ['outillage'],
    desc: "Les outils coûtent 8 % moins cher.", fx: { toolCostMult: 0.92 } },

  { id: 'archivage', name: 'Archivage', cost: 320, req: ['tamisage'],
    desc: "Chaque artefact DIFFÉRENT de la collection donne +3 % de production.", fx: { custom: 'archivage' } },

  { id: 'carottage', name: 'Carottage', cost: 600, req: ['metallurgie'],
    desc: "Coût de descente −15 %.", fx: { digCostMult: 0.85 } },

  { id: 'equipes_nuit', name: 'Équipes de nuit', cost: 1100, req: ['archivage'],
    desc: "DÉBLOQUE la progression hors-ligne (50 % du rendement, 8 h max).", fx: { flag: 'offline' } },

  { id: 'hydraulique', name: 'Hydraulique', cost: 2000, req: ['carottage'],
    desc: "Production ×1,8.", fx: { prodMult: 1.8 } },

  { id: 'datation', name: 'Datation isotopique', cost: 3600, req: ['equipes_nuit'],
    desc: "Savoir ×2.", fx: { knowledgeMult: 2 } },

  { id: 'combler', name: 'Protocole de comblement', cost: 4500, req: ['datation'],
    desc: "DÉBLOQUE le comblement du puits (prestige) : tout recommence, en mieux.", fx: { flag: 'prestige' } },

  { id: 'alliages', name: 'Alliages profonds', cost: 10000, req: ['hydraulique'],
    desc: "Les outils coûtent 8 % moins cher (cumulatif).", fx: { toolCostMult: 0.92 } },

  { id: 'cartographie', name: 'Cartographie du puits', cost: 18000, req: ['combler'],
    desc: "Le coût du mètre croît moins vite : +7,5 %/m → +7,2 %/m. Discret, décisif.", fx: { digGrowth: 0.003 } },

  { id: 'sismographie', name: 'Sismographie', cost: 32000, req: ['alliages'],
    desc: "Production multipliée par (1 + profondeur ÷ 150).", fx: { custom: 'sismographie' } },

  { id: 'resonance', name: 'Résonance', cost: 60000, req: ['cartographie'],
    desc: "Production ×2,5.", fx: { prodMult: 2.5 } },

  { id: 'xenologie', name: 'Xénologie', cost: 120000, req: ['sismographie'],
    desc: "Savoir ×3.", fx: { knowledgeMult: 3 } },

  { id: 'forage_continu', name: 'Forage continu', cost: 250000, req: ['resonance'],
    desc: "Coût de descente −25 %.", fx: { digCostMult: 0.75 } },

  { id: 'singularite', name: 'Singularité contrôlée', cost: 500000, req: ['xenologie', 'forage_continu'],
    desc: "Production ×6.", fx: { prodMult: 6 } },
];

/* -------------------------------------------------------------------------
   ARTEFACTS — la collection. ELLE SURVIT AU COMBLEMENT.
   C'est le fil narratif : chaque pièce raconte que quelque chose cloche.
   `bonus` : { prodMult | knowledgeMult | artefactChanceMult | digCostMult }
   ------------------------------------------------------------------------- */
const ARTEFACTS = [
  // — Terre végétale —
  { id: 'tesson',    strata: 'humus', name: 'Tesson de poterie', bonus: { prodMult: 1.02 },
    text: "Un bord de jarre, tourné à la main. Quelqu'un a mangé ici avant vous." },
  { id: 'piece',     strata: 'humus', name: 'Pièce corrodée', bonus: { knowledgeMult: 1.02 },
    text: "Le profil d'un souverain. Aucun catalogue numismatique ne le référence." },
  { id: 'racine',    strata: 'humus', name: 'Racine pétrifiée', bonus: { prodMult: 1.02 },
    text: "Elle plonge tout droit vers le bas. Beaucoup plus bas qu'un arbre n'a besoin." },

  // — Argile bleue —
  { id: 'silex',     strata: 'argile', name: 'Lame de silex', bonus: { prodMult: 1.03 },
    text: "Le tranchant est encore vif. Douze mille ans d'argile, aucune oxydation." },
  { id: 'os',        strata: 'argile', name: 'Os long', bonus: { knowledgeMult: 1.03 },
    text: "Fémur humain. Percé en son centre, proprement, par quelque chose de rond." },
  { id: 'ambre',     strata: 'argile', name: "Perle d'ambre", bonus: { artefactChanceMult: 1.05 },
    text: "L'insecte prisonnier n'appartient à aucun ordre connu. Il a huit ailes." },

  // — Calcaire —
  { id: 'ammonite',  strata: 'calcaire', name: 'Ammonite', bonus: { prodMult: 1.04 },
    text: "Spirale parfaite. La première chose belle que le puits vous rende." },
  { id: 'dent',      strata: 'calcaire', name: 'Dent de squale', bonus: { knowledgeMult: 1.04 },
    text: "Sept centimètres. La mer était là, et elle avait faim." },
  { id: 'empreinte', strata: 'calcaire', name: 'Empreinte de pas', bonus: { digCostMult: 0.98 },
    text: "Dans un calcaire marin de 90 millions d'années. Cinq orteils. Une chaussure." },

  // — La Nappe —
  { id: 'amphore',   strata: 'nappe', name: 'Amphore scellée', bonus: { prodMult: 1.05 },
    text: "Encore pleine. Le liquide à l'intérieur est parfaitement transparent et refuse de geler." },
  { id: 'pieu',      strata: 'nappe', name: 'Pieu de bois noir', bonus: { digCostMult: 0.97 },
    text: "Taillé, enfoncé, aligné avec d'autres. Une palissade. À quatre-vingts mètres." },
  { id: 'anneau',    strata: 'nappe', name: 'Anneau de bronze', bonus: { artefactChanceMult: 1.06 },
    text: "Trop grand pour un doigt. Trop petit pour un poignet. Parfait pour une chaîne." },

  // — Granite —
  { id: 'carotte',   strata: 'granite', name: 'Carotte anormale', bonus: { prodMult: 1.06 },
    text: "Le laboratoire renvoie le même mot trois fois : « contamination ». Il n'y a pas de contamination." },
  { id: 'quartz',    strata: 'granite', name: 'Veine de quartz laiteux', bonus: { knowledgeMult: 1.06 },
    text: "Elle court à l'horizontale sur des kilomètres. Comme un câble." },
  { id: 'clou',      strata: 'granite', name: 'Clou de fer forgé', bonus: { artefactChanceMult: 1.08 },
    text: "Cent quarante mètres. Dans du granite vieux de trois cents millions d'années. Un clou." },

  // — La Cité Noyée —
  { id: 'tablette',  strata: 'cite', name: 'Tablette gravée', bonus: { knowledgeMult: 1.08 },
    text: "L'écriture se lit de haut en bas. Vers le bas. Toujours vers le bas." },
  { id: 'statuette', strata: 'cite', name: 'Statuette sans visage', bonus: { prodMult: 1.08 },
    text: "Le visage n'a pas été effacé : il n'a jamais été sculpté. Chez aucune des mille sept cents statuettes." },
  { id: 'cle',       strata: 'cite', name: 'Clé à sept dents', bonus: { digCostMult: 0.95 },
    text: "Vous n'avez trouvé aucune serrure. Vous continuez à descendre." },
  { id: 'masque',    strata: 'cite', name: 'Masque de basalte', bonus: { artefactChanceMult: 1.10 },
    text: "Il regarde vers le bas, lui aussi. Ils regardaient tous ce que vous êtes en train de déterrer." },

  // — Le Grand Silence —
  { id: 'paroi',     strata: 'silence', name: 'Fragment de paroi', bonus: { prodMult: 1.10 },
    text: "Zéro rugosité mesurable. Ce n'est pas poli : c'est fabriqué à cette échelle." },
  { id: 'vide',      strata: 'silence', name: "Échantillon de vide", bonus: { digCostMult: 0.94 },
    text: "Le conteneur est vide et pèse trois cents grammes de plus qu'à vide." },
  { id: 'note',      strata: 'silence', name: 'Note manuscrite', bonus: { knowledgeMult: 1.10 },
    text: "« Ne pas s'arrêter au Cœur. » C'est votre écriture. Vous ne l'avez pas écrite." },

  // — La Machinerie —
  { id: 'engrenage', strata: 'machine', name: "Dent d'engrenage", bonus: { prodMult: 1.12 },
    text: "Usure mesurée : compatible avec une rotation continue depuis 4,1 milliards d'années." },
  { id: 'cable',     strata: 'machine', name: 'Câble supraconducteur', bonus: { artefactChanceMult: 1.12 },
    text: "Il transporte encore du courant. Le circuit n'est pas coupé. Il attend." },
  { id: 'plaque',    strata: 'machine', name: "Plaque d'identification", bonus: { knowledgeMult: 1.12 },
    text: "Un numéro de série. Et, en dessous : « UNITÉ 3 / 9 »." },

  // — Le Réseau —
  { id: 'filament',  strata: 'reseau', name: 'Filament réactif', bonus: { prodMult: 1.15 },
    text: "Il s'écarte de la main qui l'approche. Puis il revient. Puis il s'enroule." },
  { id: 'noeud',     strata: 'reseau', name: 'Nœud de calcul', bonus: { knowledgeMult: 1.15 },
    text: "Il traite quelque chose. Depuis toujours. La sortie est la planète elle-même." },
  { id: 'echo',      strata: 'reseau', name: 'Écho enregistré', bonus: { digCostMult: 0.92 },
    text: "Le bruit de votre premier coup de bêche. Enregistré ici. Il y a très, très longtemps." },

  // — Le Cœur —
  { id: 'graine',    strata: 'coeur', name: 'La Graine', bonus: { prodMult: 1.25 },
    text: "Petite, tiède, et manifestement pas finie de pousser." },
  { id: 'battement', strata: 'coeur', name: 'Un battement', bonus: { knowledgeMult: 1.25 },
    text: "Toutes les 11,3 secondes. Exactement le rythme auquel vous creusez." },
  { id: 'nom',       strata: 'coeur', name: 'Un nom', bonus: { digCostMult: 0.90 },
    text: "Gravé sur la coque interne, en neuf alphabets. Le neuvième est le vôtre." },
];

/* -------------------------------------------------------------------------
   MÉTA — achetée avec des Éclats de mémoire. SURVIT AU COMBLEMENT.
   ------------------------------------------------------------------------- */
const META = [
  { id: 'fondations',  name: 'Fondations',            cost: 2,   req: [],
    desc: "Le chantier redémarre avec 250 000 σ en réserve.", },
  { id: 'depot',       name: 'Dépôt d\'outils',        cost: 4,   req: ['fondations'],
    desc: "Redémarre avec 15 exemplaires des 4 premiers outils.", },
  { id: 'savoir_retenu', name: 'Savoir retenu',        cost: 7,   req: ['fondations'],
    desc: "Conserve 30 % du Savoir au comblement.", },
  { id: 'veine_riche', name: 'Veine riche',            cost: 12,  req: ['depot'],
    desc: "Chance d'artefact ×1,75, définitivement.", },
  { id: 'puits_stable', name: 'Puits stable',          cost: 18,  req: ['savoir_retenu'],
    desc: "Coût de descente −30 %, définitivement.", },
  { id: 'heritage',    name: 'Héritage',               cost: 28,  req: ['veine_riche'],
    desc: "Chaque artefact différent donne +3 % de production, sans recherche requise.", },
  { id: 'foreuse_eternelle', name: 'Foreuse éternelle', cost: 45, req: ['puits_stable'],
    desc: "Production ×4, définitivement.", },
  { id: 'echo_temporel', name: 'Écho temporel',        cost: 70,  req: ['heritage'],
    desc: "Hors-ligne débloqué d'office, à 100 % et jusqu'à 24 h.", },
  { id: 'memoire_vive', name: 'Mémoire vive',          cost: 110, req: ['foreuse_eternelle'],
    desc: "Descente automatique débloquée d'office. Éclats gagnés ×1,5.", },
  { id: 'oeil',        name: "L'Œil",                  cost: 180, req: ['echo_temporel', 'memoire_vive'],
    desc: "Production ×10. Vous commencez à comprendre ce que vous déterrez.", },
];

/* -------------------------------------------------------------------------
   SUCCÈS — petits objectifs, +2 % de production chacun.
   `check(S)` reçoit l'état complet et renvoie true/false.
   ------------------------------------------------------------------------- */
const ACHIEVEMENTS = [
  { id: 'a_first',   name: 'Premier coup de bêche', desc: "Creuser un mètre.",              check: (S) => S.depth >= 1 },
  { id: 'a_d10',     name: 'Sous les racines',      desc: "Atteindre 10 m.",                check: (S) => S.maxDepth >= 10 },
  { id: 'a_d50',     name: 'Hors de portée',        desc: "Atteindre 50 m.",                check: (S) => S.maxDepth >= 50 },
  { id: 'a_d100',    name: 'Trois chiffres',        desc: "Atteindre 100 m.",               check: (S) => S.maxDepth >= 100 },
  { id: 'a_d170',    name: 'Ce n\'est pas possible',desc: "Atteindre la Cité Noyée.",       check: (S) => S.maxDepth >= 170 },
  { id: 'a_d230',    name: 'Écouter le silence',    desc: "Atteindre le Grand Silence.",    check: (S) => S.maxDepth >= 230 },
  { id: 'a_d300',    name: 'Ça tourne encore',      desc: "Atteindre la Machinerie.",       check: (S) => S.maxDepth >= 300 },
  { id: 'a_d470',    name: 'Le Cœur',               desc: "Atteindre 470 m.",               check: (S) => S.maxDepth >= 470 },
  { id: 'a_tool50',  name: 'Petite entreprise',     desc: "Posséder 50 outils au total.",   check: (S) => totalTools(S) >= 50 },
  { id: 'a_tool250', name: 'Chantier national',     desc: "Posséder 250 outils au total.",  check: (S) => totalTools(S) >= 250 },
  { id: 'a_tool1000',name: 'Industrie',             desc: "Posséder 1000 outils au total.", check: (S) => totalTools(S) >= 1000 },
  { id: 'a_art5',    name: 'Vitrine',               desc: "Collectionner 5 artefacts différents.",  check: (S) => Object.keys(S.artefacts).length >= 5 },
  { id: 'a_art15',   name: 'Cabinet de curiosités', desc: "Collectionner 15 artefacts différents.", check: (S) => Object.keys(S.artefacts).length >= 15 },
  { id: 'a_art30',   name: 'Musée',                 desc: "Collectionner 30 artefacts différents.", check: (S) => Object.keys(S.artefacts).length >= 30 },
  { id: 'a_res5',    name: 'Méthode',               desc: "Terminer 5 recherches.",         check: (S) => Object.keys(S.research).length >= 5 },
  { id: 'a_res12',   name: 'Doctrine',              desc: "Terminer 12 recherches.",        check: (S) => Object.keys(S.research).length >= 12 },
  { id: 'a_sed1e9',  name: 'Montagne',              desc: "Accumuler 1 G de sédiment.",     check: (S) => S.totalSediment >= 1e9 },
  { id: 'a_sed1e15', name: 'Continent',             desc: "Accumuler 1 P de sédiment.",     check: (S) => S.totalSediment >= 1e15 },
  { id: 'a_pres1',   name: 'Reboucher',             desc: "Combler le puits une fois.",     check: (S) => S.prestiges >= 1 },
  { id: 'a_pres5',   name: 'Recommencer',           desc: "Combler le puits 5 fois.",       check: (S) => S.prestiges >= 5 },
];

/** Helper utilisé par les succès : nombre total d'outils possédés. */
function totalTools(S) {
  let n = 0;
  for (const k in S.tools) n += S.tools[k];
  return n;
}

/* Index pratiques : accès O(1) par id, construits une fois au chargement. */
const BY_ID = {
  tool:     Object.fromEntries(TOOLS.map((t) => [t.id, t])),
  research: Object.fromEntries(RESEARCH.map((r) => [r.id, r])),
  artefact: Object.fromEntries(ARTEFACTS.map((a) => [a.id, a])),
  meta:     Object.fromEntries(META.map((m) => [m.id, m])),
  strata:   Object.fromEntries(STRATA.map((s) => [s.id, s])),
  upgrade:  Object.fromEntries(UPGRADES.concat(GLOBAL_UPGRADES).map((u) => [u.id, u])),
};

/* Artefacts regroupés par strate — évite de filtrer le tableau à chaque tirage. */
const ARTEFACTS_BY_STRATA = {};
ARTEFACTS.forEach((a) => {
  (ARTEFACTS_BY_STRATA[a.strata] ||= []).push(a);
});
