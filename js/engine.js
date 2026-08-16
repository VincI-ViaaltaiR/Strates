/* =========================================================================
   engine.js — Le moteur. Toute la logique du jeu, zéro DOM.

   POURQUOI séparer strictement moteur et affichage ?
   1) On peut tester le moteur sans navigateur (voir tools/sim.js).
   2) On peut faire tourner 8 heures de jeu hors-ligne en 3 ms, parce qu'on
      n'a rien à redessiner.
   3) Quand un chiffre est faux, on sait dans quel fichier chercher.
   ========================================================================= */

/**
 * Un effet d'événement peut porter un effet temporaire (`buff`) ou plusieurs
 * (`buffs`). On normalise en tableau une fois pour toutes.
 *
 * POURQUOI PLUSIEURS : une même décision combine souvent un avantage et son
 * prix — « accorder la pause » repose l'équipe ET arrête le chantier pendant
 * ce temps. Les deux doivent coexister.
 */
function buffList(fx) {
  return fx.buffs || (fx.buff ? [fx.buff] : []);
}

const Engine = {

  /* -----------------------------------------------------------------------
     LECTURES DÉRIVÉES — des fonctions pures, sans effet de bord.
     ----------------------------------------------------------------------- */

  /** Quelle strate à cette profondeur ? (parcours à rebours = première qui matche) */
  strataAt(depth) {
    for (let i = STRATA.length - 1; i >= 0; i--) {
      if (depth >= STRATA[i].depth) return STRATA[i];
    }
    return STRATA[0];
  },

  /**
   * Coût en sédiment pour gagner le mètre n° `d` (de d à d+1).
   * C'EST LA FORMULE CENTRALE DU JEU :
   *     base × (1 + croissance)^d × dureté(strate) × réductions
   * La croissance exponentielle garantit qu'aucune production, si grande
   * soit-elle, ne « termine » le puits — il y a toujours un mètre de plus.
   */
  digCost(d) {
    const c = S.calc;
    const growth = BAL.digGrowth - (c ? c.digGrowth : 0);
    return BAL.digBase
      * Math.pow(1 + growth, d)
      * this.strataAt(d).hardness
      * (c ? c.digCostMult : 1);
  },

  /** Prix du prochain exemplaire d'un outil (ou du n-ième). */
  toolCost(toolId, extra = 0) {
    const t = BY_ID.tool[toolId];
    const owned = (S.tools[toolId] || 0) + extra;
    return t.cost * Math.pow(BAL.toolRatio, owned) * S.calc.toolCostMult;
  },

  /** Prix cumulé de `n` exemplaires d'un coup (formule géométrique). */
  toolCostBulk(toolId, n) {
    const t = BY_ID.tool[toolId];
    const owned = S.tools[toolId] || 0;
    return geoSum(t.cost, BAL.toolRatio, owned, n) * S.calc.toolCostMult;
  },

  /** Combien d'exemplaires selon le mode d'achat courant (1/10/100/max) ? */
  buyQty(toolId) {
    if (S.buyMode > 0) return S.buyMode;
    const t = BY_ID.tool[toolId];
    const owned = S.tools[toolId] || 0;
    return Math.max(1, geoMaxAffordable(t.cost * S.calc.toolCostMult, BAL.toolRatio, owned, S.sediment));
  },

  /** Un outil est-il visible ? (profondeur record atteinte) */
  toolUnlocked(t) {
    /* Le défi « Outillage réduit » ferme les quatre derniers outils. */
    const lim = S.calc && S.calc.toolLimit;
    if (lim !== undefined && lim !== null && TOOLS.indexOf(t) >= lim) return false;
    return S.bestDepth >= t.unlock || (S.tools[t.id] || 0) > 0;
  },

  /**
   * Réserve exigée par la descente automatique, en multiples du coût du mètre.
   *
   * C'EST UN LEVIER DE JEU, pas un détail technique. Une descente auto sans
   * frein consomme le sédiment aussi vite qu'il arrive : le joueur ne peut
   * plus jamais rien acheter et sa production se fige. Les trois modes
   * rendent l'arbitrage explicite :
   *   arrêt    → tout le sédiment part dans les outils (phase d'investissement)
   *   prudent  → on ne descend qu'avec 20× le prix du mètre d'avance
   *   à fond   → on descend dès qu'on peut (phase de poussée)
   */
  autoFactor() {
    return S.autoMode === 'max' ? 1 : S.autoMode === 'safe' ? 20 : Infinity;
  },

  /* -----------------------------------------------------------------------
     computeStats() — recalcule TOUS les multiplicateurs.
     Appelée une fois par tick. Coût : ~120 itérations, totalement négligeable.
     Le résultat est stocké dans S.calc pour que l'UI et le moteur lisent
     la même chose au même instant.
     ----------------------------------------------------------------------- */
  computeStats() {
    const c = {
      prodMult: 1,
      toolCostMult: 1,
      digCostMult: 1,
      digGrowth: 0,          // retranché à BAL.digGrowth
      artefactChance: BAL.artefactChance,
      knowledgeMult: 1,
      shardMult: 1,          // multiplie les éclats gagnés au comblement
      autoDig: false,
      offline: false,
      offlineRate: 0.5,
      offlineCapH: BAL.offlineCapH,
      prestigeUnlocked: false,
      toolMult: {},          // multiplicateur propre à chaque outil
      sedPerSec: 0,
      clickPower: 0,
    };
    let artChanceMult = 1;

    /* --- 1. Améliorations d'outils : chacune DOUBLE l'outil visé --- */
    TOOLS.forEach((t) => { c.toolMult[t.id] = 1; });
    for (const id in S.upgrades) {
      const u = BY_ID.upgrade[id];
      if (!u) continue;
      if (u.tool) c.toolMult[u.tool] *= 2;
      else if (u.fx) applyFx(u.fx);
    }

    /* --- 2. Recherches. Une recherche répétable stocke son NIVEAU au lieu de
       `true` ; son effet s'applique autant de fois qu'elle a de niveaux. --- */
    for (const id in S.research) {
      const r = BY_ID.research[id];
      if (!r || !r.fx) continue;
      const lvl = r.repeat ? (S.research[id] | 0) : 1;
      for (let i = 0; i < lvl; i++) applyFx(r.fx);
    }

    /* --- 3. Artefacts : le bonus compte UNE fois par type découvert --- */
    let uniqueArtefacts = 0;
    for (const id in S.artefacts) {
      const a = BY_ID.artefact[id];
      if (!a) continue;
      uniqueArtefacts++;
      applyFx(a.bonus);
    }

    /* --- 4. Méta (éclats) : effets permanents --- */
    if (S.meta.veine_riche)        artChanceMult *= 1.75;
    if (S.meta.puits_stable)       c.digCostMult *= 0.70;
    if (S.meta.foreuse_eternelle)  c.prodMult *= 4;
    if (S.meta.oeil)               c.prodMult *= 10;
    if (S.meta.memoire_vive)       c.autoDig = true;
    if (S.meta.echo_temporel)    { c.offline = true; c.offlineRate = 1; c.offlineCapH = 24; }

    /* --- 4 bis. Doctrine de la fouille en cours, puis maîtrises acquises.
       La doctrine ne vaut que pour la fouille courante ; les maîtrises, elles,
       sont définitives et s'appliquent quelle que soit la doctrine suivie. */
    const doc = BY_ID.doctrine[S.doctrine];
    if (doc && doc.fx) applyFx(doc.fx);
    for (const id in S.mastered) {
      const m = BY_ID.doctrine[id];
      if (m && m.mastery) applyFx(m.mastery.fx);
    }

    /* --- 4 ter. La Graine, rapportée du Cœur. Définitive, survit à tout. --- */
    if (S.heartReached) applyFx(HEART_BONUS);

    /* --- 5. Éclats gagnés à vie : bonus passif additif (lisible) --- */
    c.prodMult *= 1 + BAL.shardBonus * S.shardsTotal;

    /* --- 6. Effets « custom » : trop particuliers pour le vocabulaire fx --- */
    if (S.research.archivage || S.meta.heritage) c.prodMult *= 1 + 0.03 * uniqueArtefacts;
    if (S.research.sismographie)                 c.prodMult *= 1 + S.depth / 150;

    /* --- 7. Succès : +2 % chacun. Petit, mais ça récompense l'exploration --- */
    c.prodMult *= 1 + 0.02 * Object.keys(S.achievements).length;

    /* --- 7 bis. Effets temporaires issus des événements de forage --- */
    for (const b of S.buffs || []) {
      if (b.until <= S.playTime) continue;
      if ((b.from || 0) > S.playTime) continue;   // effet différé, pas encore actif
      if (b.prodMult)           c.prodMult *= b.prodMult;
      if (b.digCostMult)        c.digCostMult *= b.digCostMult;
      if (b.artefactChanceMult) artChanceMult *= b.artefactChanceMult;
    }

    /* --- 7 quater. Défi armé, unité courante, fragments --- */
    const ch = S.challenge && BY_ID.challenge[S.challenge];
    if (ch) {
      if (ch.id === 'c_manuel')  c.autoDig = false;   // coupé, quoi qu'on ait cherché
      if (ch.id === 'c_aveugle') c.artefactChance = 0;
      if (ch.id === 'c_silence') c.noEvents = true;
      if (ch.id === 'c_pauvre')  c.toolLimit = TOOLS.length - 4;
    }
    for (const id in S.challengesDone) {
      const d = BY_ID.challenge[id];
      if (d) applyFx(d.fx);
    }
    if (S.unitTrait && BY_ID.trait[S.unitTrait]) applyFx(BY_ID.trait[S.unitTrait].fx);

    /* HÉRITAGE DES GRAINES — le pan de jeu qui donne un sens au voyage.
       Chaque unité quittée laisse 30 % de sa nature, et ces natures se
       CUMULENT : après plusieurs départs, on ne joue plus une planète mais la
       somme de toutes celles qu'on a traversées. C'est ce qui transforme le
       départ d'une perte sèche en une construction. */
    for (const id in S.traitsInherited || {}) {
      const t = BY_ID.trait[id];
      if (!t) continue;
      const times = S.traitsInherited[id] | 0;
      for (let i = 0; i < times; i++) {
        this.partialFx(t.fx, UNIT_INHERIT, c, (v) => { artChanceMult *= v; });
      }
    }
    for (const id in S.fragmentsBought) {
      const f = BY_ID.fragment[id];
      if (f && f.fx) applyFx(f.fx);
    }

    /* --- 8. Production totale.
       Chaque outil reçoit d'abord sa SYNERGIE : un pourcentage par exemplaire
       de l'outil qui le seconde. Le calcul se fait ici, après les
       multiplicateurs propres, pour que la synergie s'applique au total. --- */
    c.synergy = {};
    SYNERGIES.forEach((s) => {
      const n = S.tools[s.from] || 0;
      c.synergy[s.tool] = 1 + n * s.pct;
    });

    let base = 0;
    TOOLS.forEach((t) => {
      const n = S.tools[t.id] || 0;
      if (n) base += n * t.prod * c.toolMult[t.id] * (c.synergy[t.id] || 1);
    });
    c.sedPerSec = base * c.prodMult;

    /* Le clic manuel reste utile tout du long : 1 σ, ou 5 % de la prod/s. */
    c.clickPower = Math.max(1, c.sedPerSec * 0.05);

    /* Chance d'artefact, plafonnée à 90 % : garder une part de hasard. */
    c.artefactChance = Math.min(0.9, c.artefactChance * artChanceMult);
    c.uniqueArtefacts = uniqueArtefacts;

    S.calc = c;
    return c;

    /* Applique un bloc `fx` déclaratif. Défini ici (closure) pour lire `c`. */
    function applyFx(fx) {
      if (fx.prodMult)           c.prodMult *= fx.prodMult;
      if (fx.toolCostMult)       c.toolCostMult *= fx.toolCostMult;
      if (fx.digCostMult)        c.digCostMult *= fx.digCostMult;
      if (fx.digGrowth)          c.digGrowth += fx.digGrowth;
      if (fx.knowledgeMult)      c.knowledgeMult *= fx.knowledgeMult;
      if (fx.shardMult)          c.shardMult *= fx.shardMult;
      if (fx.artefactChanceMult) artChanceMult *= fx.artefactChanceMult;
      if (fx.flag === 'autoDig')  c.autoDig = true;
      if (fx.flag === 'offline')  c.offline = true;
      if (fx.flag === 'prestige') c.prestigeUnlocked = true;
    }
  },

  /* -----------------------------------------------------------------------
     ACTIONS DU JOUEUR
     ----------------------------------------------------------------------- */

  click() {
    const gain = S.calc.clickPower;
    S.sediment += gain;
    S.totalSediment += gain;
    S.runSediment += gain;
    return gain;
  },

  buyTool(toolId) {
    const qty = this.buyQty(toolId);
    const price = this.toolCostBulk(toolId, qty);
    if (S.sediment < price || qty < 1) return false;
    S.sediment -= price;
    S.tools[toolId] = (S.tools[toolId] || 0) + qty;
    Sfx.play('buy');
    this.computeStats();
    UI.shopDirty = true;
    return true;
  },

  buyUpgrade(id) {
    const u = BY_ID.upgrade[id];
    if (!u || S.upgrades[id] || S.sediment < u.cost) return false;
    S.sediment -= u.cost;
    S.upgrades[id] = true;
    this.computeStats();
    UI.shopDirty = true;
    logMsg('up', `Amélioration : <b>${u.name}</b>`);
    return true;
  },

  /** Niveau actuel d'une recherche (0 ou 1 pour les non-répétables). */
  researchLevel(id) {
    const v = S.research[id];
    return v === true ? 1 : (v | 0);
  },

  /** Prix du PROCHAIN niveau. Croît géométriquement pour les répétables. */
  researchCost(r) {
    if (!r.repeat) return r.cost;
    return r.cost * Math.pow(r.costMult, this.researchLevel(r.id));
  },

  researchAvailable(r) {
    if (S.research[r.id] && !r.repeat) return false;   // les répétables restent ouvertes
    return r.req.every((q) => S.research[q]);
  },

  buyResearch(id) {
    const r = BY_ID.research[id];
    if (!r || !this.researchAvailable(r)) return false;
    const price = this.researchCost(r);
    if (S.knowledge < price) return false;

    S.knowledge -= price;
    if (r.repeat) S.research[id] = this.researchLevel(id) + 1;
    else          S.research[id] = true;

    this.computeStats();
    UI.shopDirty = true;
    logMsg('res', r.repeat
      ? `<b>${r.name}</b> — niveau ${this.researchLevel(id)}.`
      : `Recherche terminée : <b>${r.name}</b>.`);
    return true;
  },

  /**
   * Achète toutes les améliorations abordables, de la moins chère à la plus
   * chère. L'ordre compte : commencer par les moins chères en fait entrer le
   * maximum, et certaines augmentent la production, ce qui n'aide pas ici mais
   * évite au joueur trente clics en fin de partie.
   */
  buyAllUpgrades() {
    const list = UPGRADES.concat(GLOBAL_UPGRADES)
      .filter((u) => !S.upgrades[u.id])
      .filter((u) => (u.tool ? (S.tools[u.tool] || 0) >= u.need : S.bestDepth >= u.needDepth))
      .sort((a, b) => a.cost - b.cost);
    let n = 0;
    for (const u of list) if (this.buyUpgrade(u.id)) n++;
    return n;
  },

  /** Idem pour les recherches disponibles, les moins chères d'abord. */
  buyAllResearch() {
    let n = 0, guard = 200;
    /* Boucle : acheter une recherche peut en ouvrir une autre (prérequis) ou
       ajouter un niveau à une répétable. On repasse tant que ça avance. */
    while (guard-- > 0) {
      const list = RESEARCH
        .filter((r) => this.researchAvailable(r))
        .sort((a, b) => this.researchCost(a) - this.researchCost(b));
      const before = n;
      for (const r of list) if (this.buyResearch(r.id)) { n++; break; }
      if (n === before) break;
    }
    return n;
  },

  metaAvailable(m) {
    if (S.meta[m.id]) return false;
    return m.req.every((q) => S.meta[q]);
  },

  buyMeta(id) {
    const m = BY_ID.meta[id];
    if (!m || !this.metaAvailable(m) || S.shards < m.cost) return false;
    S.shards -= m.cost;
    S.meta[id] = true;
    this.computeStats();
    UI.shopDirty = true;
    return true;
  },

  /* -----------------------------------------------------------------------
     LA DESCENTE — le geste central du jeu.
     Renvoie true si un mètre a été gagné.
     ----------------------------------------------------------------------- */
  descend(quiet = false) {
    const cost = this.digCost(S.depth);
    if (S.sediment < cost) return false;

    S.sediment -= cost;
    S.depth += 1;
    S.totalDepthDug += 1;
    if (S.depth > S.maxDepth) S.maxDepth = S.depth;
    if (S.depth > S.bestDepth) S.bestDepth = S.depth;

    /* Le Cœur : atteint une seule fois dans toute la vie de la partie, il
       accorde un bonus définitif. L'explication est portée par l'aide `h_coeur`,
       qui se déclenche au même seuil. */
    if (S.depth >= HEART_DEPTH && !S.heartReached) {
      S.heartReached = true;
      Sfx.play('heart');
      logMsg('coeur', `<b>LE CŒUR</b> — Vous emportez la Graine. Production et éclats ×1,25, ` +
        `définitivement. Le puits, lui, continue.`);
      this.computeStats();
    }

    /* Défi armé : atteindre la profondeur demandée le valide définitivement. */
    if (S.challenge && !S.challengesDone[S.challenge]) {
      const ch = BY_ID.challenge[S.challenge];
      if (ch && S.depth >= ch.depth) {
        S.challengesDone[S.challenge] = true;
        /* La contrainte se lève À L'INSTANT de la validation. La laisser courir
           jusqu'au prochain comblement transformait une réussite en punition :
           on avait gagné, et on subissait encore. */
        S.challenge = null;
        S.nextChallenge = null;
        Sfx.play('success');
        logMsg('defi', `<b>Défi relevé : ${ch.name}</b> — ${ch.reward} ` +
          `<i>La contrainte est levée sur-le-champ.</i>`);
        this.computeStats();
        UI.shopDirty = true;
      }
    }

    /* Entrée dans une nouvelle strate → texte d'ambiance, une seule fois. */
    const st = this.strataAt(S.depth);
    if (!S.seenStrata[st.id]) {
      S.seenStrata[st.id] = true;
      Sfx.play('strata');
      logMsg('strata', `<b>${st.name}</b> — ${st.intro}`);
    }

    /* Tirage d'artefact. */
    if (Math.random() < S.calc.artefactChance) this.findArtefact(st, quiet);

    /* Tirage d'événement. Jamais en mode silencieux : un événement attend une
       réponse du joueur, il n'a aucun sens pendant une simulation hors-ligne. */
    if (!quiet) this.rollEvent(st);

    UI.wellDirty = true;
    return true;
  },

  /* -----------------------------------------------------------------------
     ÉVÉNEMENTS DE FORAGE
     ----------------------------------------------------------------------- */

  /* TOUTES les durées liées aux événements (délai de repos, effets
     temporaires) sont comptées en TEMPS DE JEU — `S.playTime`, en secondes —
     et jamais avec Date.now().

     POURQUOI c'est important : l'horloge murale et le temps de jeu ne sont
     pas la même chose. Ils divergent dès qu'on simule (8 h de jeu calculées
     en 0,3 s au banc d'essai : tout se serait retrouvé bloqué par un délai de
     45 s « réelles »), et ils divergent aussi en progression hors-ligne.
     Le temps de jeu est la seule référence que le joueur perçoit réellement. */
  rollEvent(strata) {
    if (S.calc.noEvents) return;                      // défi « Chantier muet »
    if (S.pendingEvent) return;                       // un seul à la fois
    if (S.playTime < (S.nextEventAt || 0)) return;    // temps de repos obligatoire
    if (Math.random() >= BAL.eventChance) return;

    const pool = EVENTS.filter((e) =>
      (!e.strata || e.strata.includes(strata.id)) && S.depth >= (e.minDepth || 0));
    if (!pool.length) return;

    const ev = pick(pool);
    S.pendingEvent = ev.id;
    S.nextEventAt = S.playTime + BAL.eventCooldown;
    S.runEvents = (S.runEvents | 0) + 1;
    Sfx.play('event');
    UI.showEvent = ev;
  },

  /**
   * Traduit un bloc d'effets en conséquences CHIFFRÉES, calculées sur l'état
   * courant. Utilisé par la fenêtre d'événement, avant que le joueur choisisse.
   *
   * POURQUOI c'est indispensable : « du sédiment, tout de suite » face à
   * « descente moins chère pendant 3 min » n'est pas un choix, c'est un tirage
   * au sort — les deux options ne sont pas dans la même unité et leur valeur
   * dépend entièrement de la situation. En affichant « +18 M σ » contre
   * « prochain mètre : 236 M → 189 M σ », on rend les deux comparables.
   * Un dilemme n'est intéressant que si le joueur peut l'évaluer.
   */
  previewFx(fx) {
    const st = this.strataAt(S.depth);
    const c = S.calc;
    const out = [];

    if (fx.sedimentSec) {
      const v = c.sedPerSec * fx.sedimentSec;
      out.push(`${fx.sedimentSec > 0 ? '+' : '−'}${fmt(Math.abs(v))} σ ` +
               `<em>(${fmtTime(Math.abs(fx.sedimentSec))} de production)</em>`);
    }
    if (fx.sedimentFrac) {
      const v = S.sediment * fx.sedimentFrac;
      out.push(`${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))} σ ` +
               `<em>(${Math.round(Math.abs(fx.sedimentFrac) * 100)} % de la réserve)</em>`);
    }
    if (fx.knowledgeMul) {
      out.push(`+${fmt(st.knowledge * fx.knowledgeMul * c.knowledgeMult)} ✦`);
    }
    if (fx.artefact) out.push(`1 artefact de <em>${st.name}</em>`);
    if (fx.depth)    out.push(`${fx.depth > 0 ? '+' : '−'}${Math.abs(fx.depth)} m de profondeur`);

    for (const b of buffList(fx)) {
      const after = b.delay ? `<em>après ${fmtTime(b.delay)},</em> ` : '';
      if (b.prodMult) {
        /* On chiffre aussi le gain total sur la durée : « ×1,5 » ne dit rien,
           « ≈ +42 M σ sur 5 min » se compare à une somme immédiate. */
        const delta = c.sedPerSec * (b.prodMult - 1) * b.dur;
        out.push(after + `production ×${fmt(b.prodMult, 2)} pendant ${fmtTime(b.dur)} ` +
                 `<em>(≈ ${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))} σ)</em>`);
      }
      if (b.digCostMult) {
        const now = this.digCost(S.depth);
        out.push(`prochain mètre ${fmt(now)} → <b>${fmt(now * b.digCostMult)} σ</b> ` +
                 `<em>pendant ${fmtTime(b.dur)}</em>`);
      }
      if (b.artefactChanceMult) {
        out.push(`chance d'artefact ×${fmt(b.artefactChanceMult, 2)} pendant ${fmtTime(b.dur)}`);
      }
    }

    if (!out.length) out.push('aucune conséquence');
    return out;
  },

  /** Le joueur a tranché : on applique, on raconte, on referme. */
  resolveEvent(id, choiceIndex) {
    const ev = BY_ID.event[id];
    S.pendingEvent = null;
    if (!ev) return;
    const ch = ev.choices[choiceIndex];
    if (!ch) return;

    /* `risk` = probabilité de RÉUSSITE. En cas d'échec, c'est `fail` qui
       s'applique — et un choix risqué sans `fail` ne fait simplement rien. */
    let fx = ch.fx || {};
    let ok = true;
    if (ch.risk !== undefined && Math.random() >= ch.risk) { fx = ch.fail || {}; ok = false; }

    const parts = this.applyEventFx(fx);
    this.computeStats();

    const verdict = ch.risk === undefined ? '' : ok ? ' <i>Ça passe.</i>' : ' <i>Ça ne passe pas.</i>';
    logMsg('event', `<b>${ev.title}</b> — « ${ch.label} ».${verdict}` +
      (parts.length ? ' ' + parts.join(' · ') : ''));
    UI.shopDirty = true;
    return { ok, parts };
  },

  /** Applique un bloc d'effets d'événement et renvoie de quoi le raconter. */
  applyEventFx(fx) {
    const st = this.strataAt(S.depth);
    const out = [];

    const addSediment = (d) => {
      S.sediment = Math.max(0, S.sediment + d);
      if (d > 0) { S.totalSediment += d; S.runSediment += d; }
      out.push((d >= 0 ? '+' : '−') + fmt(Math.abs(d)) + ' σ');
    };

    if (fx.sedimentFrac) addSediment(S.sediment * fx.sedimentFrac);
    if (fx.sedimentSec)  addSediment(S.calc.sedPerSec * fx.sedimentSec);

    if (fx.knowledgeMul) {
      const g = st.knowledge * fx.knowledgeMul * S.calc.knowledgeMult;
      S.knowledge += g;
      out.push('+' + fmt(g) + ' ✦');
    }

    if (fx.artefact) {
      this.findArtefact(st, false);
      UI.collectionDirty = true;
    }

    if (fx.depth) {
      S.depth = Math.max(0, S.depth + fx.depth);
      if (S.depth > S.maxDepth)  S.maxDepth = S.depth;
      if (S.depth > S.bestDepth) S.bestDepth = S.depth;
      if (fx.depth > 0) S.totalDepthDug += fx.depth;
      out.push((fx.depth > 0 ? '+' : '−') + Math.abs(fx.depth) + ' m');
      UI.wellDirty = true;
    }

    for (const src of buffList(fx)) {
      /* `delay` décale le DÉMARRAGE de l'effet. Il sert à enchaîner deux
         effets au lieu de les superposer : accorder une pause arrête d'abord
         le chantier, PUIS l'équipe reposée produit mieux. Superposés, les deux
         se neutralisaient (×0,35 × ×1,4) et la scène n'avait plus de sens. */
      const from = S.playTime + (src.delay || 0);
      const b = Object.assign({}, src, { from, until: from + src.dur });
      /* Un même effet ne se cumule pas avec lui-même : il se renouvelle.
         Sinon deux « Forage accordé » d'affilée donneraient −70 % de coût. */
      S.buffs = S.buffs.filter((x) => x.name !== b.name);
      S.buffs.push(b);
      out.push(`<i>${b.name}</i> ${fmtTime(b.dur)}`);
    }

    return out;
  },

  findArtefact(strata, quiet) {
    const pool = ARTEFACTS_BY_STRATA[strata.id];
    if (!pool || !pool.length) return;
    const a = pick(pool);
    const isNew = !S.artefacts[a.id];
    S.artefacts[a.id] = (S.artefacts[a.id] || 0) + 1;

    /* Un artefact inédit vaut 3× plus de savoir : la découverte prime. */
    const gain = strata.knowledge * (isNew ? 3 : 1) * S.calc.knowledgeMult;
    S.knowledge += gain;

    S.runArtefacts = (S.runArtefacts || 0) + 1;

    if (isNew) {
      Sfx.play('artefact');
      logMsg('find', `<b>${a.name}</b> — ${a.text} <i>(+${fmt(gain)} savoir)</i>`);
      this.computeStats();          // le bonus de l'artefact s'applique tout de suite
      UI.collectionDirty = true;
      if (!quiet) UI.flashArtefact = a;
    } else if (!quiet) {
      /* Les doublons sont fréquents (plusieurs par minute en profondeur).
         Une ligne chacun noierait le récit sous la comptabilité : on FUSIONNE
         les doublons consécutifs d'un même artefact en une seule entrée qui
         se met à jour (« Tablette gravée ×7 — +13 K savoir »). */
      const top = S.log[0];
      if (top && top.t === 'dup' && top.a === a.id) {
        top.n += 1;
        top.g += gain;
        top.m = `${a.name} ×${top.n} — +${fmt(top.g)} savoir`;
        top.d = Math.floor(S.depth);
        UI.logDirty = true;
      } else {
        logMsg('dup', `${a.name} — +${fmt(gain)} savoir`);
        Object.assign(S.log[0], { a: a.id, g: gain, n: 1 });
      }
    }
  },

  /* -----------------------------------------------------------------------
     LE TICK — appelé ~60 fois par seconde avec dt en secondes.
     ----------------------------------------------------------------------- */
  tick(dt) {
    /* Purge des effets temporaires expirés, avant tout calcul. */
    if (S.buffs && S.buffs.length && S.buffs.some((b) => b.until <= S.playTime)) {
      S.buffs = S.buffs.filter((b) => b.until > S.playTime);
    }

    this.computeStats();

    const gain = S.calc.sedPerSec * dt;
    S.sediment += gain;
    S.totalSediment += gain;
    S.runSediment += gain;
    S.playTime += dt;

    /* Descente automatique. On borne le nombre de mètres par tick :
       sans cette borne, un joueur revenant avec 1e30 σ figerait l'onglet. */
    if (S.calc.autoDig && S.autoMode !== 'off') {
      const factor = this.autoFactor();
      let guard = 60;
      while (guard-- > 0 && S.sediment >= this.digCost(S.depth) * factor && this.descend()) {}
    }

    this.checkAchievements();
    this.checkHints();
  },

  /**
   * Aides contextuelles : on montre la PREMIÈRE non vue dont la condition est
   * remplie, et une seule à la fois. Enchaîner trois fenêtres d'explication
   * d'affilée ferait fermer les trois sans les lire.
   */
  checkHints() {
    if (UI.showHint || UI.hintOpen) return;
    for (const h of HINTS) {
      if (!S.hintsSeen[h.id] && h.when(S)) {
        S.hintsSeen[h.id] = true;
        S.helpUnread = (S.helpUnread | 0) + 1;
        UI.showHint = h;
        return;
      }
    }
  },

  checkAchievements() {
    for (const a of ACHIEVEMENTS) {
      if (!S.achievements[a.id] && a.check(S)) {
        S.achievements[a.id] = true;
        logMsg('ach', `Succès : <b>${a.name}</b> — ${a.desc}`);
        UI.statsDirty = true;
        toast('🏅 ' + a.name);
      }
    }
  },

  /* -----------------------------------------------------------------------
     HORS-LIGNE — on rejoue le temps écoulé sans rien afficher.
     ----------------------------------------------------------------------- */
  applyOffline(ms) {
    this.computeStats();
    if (!S.calc.offline) return null;

    const capped = Math.min(ms / 1000, S.calc.offlineCapH * 3600);
    if (capped < 30) return null;                     // moins de 30 s : on ignore

    const eff = capped * S.calc.offlineRate;
    const before = S.depth;

    /* On simule par pas de 10 s : assez fin pour que la descente auto suive
       la montée du coût, assez grossier pour rester instantané. */
    const step = 10;
    let t = 0, meters = 0;
    while (t < eff) {
      const d = Math.min(step, eff - t);
      const g = S.calc.sedPerSec * d;
      S.sediment += g;
      S.totalSediment += g;
      S.runSediment += g;
      if (S.calc.autoDig && S.autoMode !== 'off') {
        const factor = this.autoFactor();
        let guard = 500;
        while (guard-- > 0 && S.sediment >= this.digCost(S.depth) * factor && this.descend(true)) meters++;
      }
      t += d;
      this.computeStats();
    }
    S.playTime += capped;
    return { seconds: capped, rate: S.calc.offlineRate, meters, depthFrom: before };
  },

  /* -----------------------------------------------------------------------
     PRESTIGE — « combler le puits ».
     ----------------------------------------------------------------------- */
  shardsFor(depth) {
    if (depth < BAL.shardDiv) return 0;
    let n = Math.pow(depth / BAL.shardDiv, BAL.shardPow);
    if (S.meta.memoire_vive) n *= 1.5;
    n *= (S.calc && S.calc.shardMult) || 1;   // doctrine Ingénierie
    return Math.floor(n);
  },

  doPrestige() {
    const gain = this.shardsFor(S.maxDepth);
    if (gain < 1) return false;

    /* Bilan de la fouille qui s'achève : il rend visible ce qu'on vient de
       vivre, au seul moment où le jeu efface tout. Sans lui, trois heures de
       partie disparaissaient en une ligne de journal. */
    S.lastRun = {
      depth: Math.floor(S.maxDepth),
      shards: gain,
      artefacts: S.runArtefacts | 0,
      events: S.runEvents | 0,
      research: Object.keys(S.research).length,
      sediment: S.runSediment,
      seconds: (Date.now() - S.runStart) / 1000,
      doctrine: S.doctrine,
      challenge: S.challenge,
      challengeDone: !!(S.challenge && S.challengesDone[S.challenge]),
      strata: this.strataAt(S.maxDepth).name,
    };

    S.shards += gain;
    S.shardsTotal += gain;
    S.prestiges += 1;

    /* --- Doctrines : on crédite la fouille qui s'achève, puis on engage
       celle qui vient. La maîtrise s'obtient à MASTERY_RUNS fouilles menées
       jusqu'au bout sous la même doctrine. --- */
    const finished = S.doctrine;
    if (finished && finished !== 'aucune') {
      S.doctrineRuns[finished] = (S.doctrineRuns[finished] || 0) + 1;
      const d = BY_ID.doctrine[finished];
      if (d && d.mastery && !S.mastered[finished] && S.doctrineRuns[finished] >= MASTERY_RUNS) {
        S.mastered[finished] = true;
        logMsg('doctrine', `<b>Maîtrise : ${d.name}</b> — ${d.mastery.name}. ${d.mastery.desc}`, 0);
      }
    }
    const engaged = BY_ID.doctrine[S.nextDoctrine] ? S.nextDoctrine : 'aucune';

    /* Ce que la méta permet d'emporter dans la nouvelle fouille. */
    const keep = {};

    /* Le Protocole de comblement reste acquis. Le racheter à chaque fouille
       (4 500 savoir) ne serait pas un choix mais une taxe : on connaît déjà la
       technique. Il reste dans la liste, coché — et sert toujours de prérequis
       à la Cartographie du puits, qui, elle, se recherche à nouveau. */
    keep.research = { combler: true };
    if (S.meta.fondations)     keep.sediment = 250000;
    if (S.meta.savoir_retenu)  keep.knowledge = Math.floor(S.knowledge * 0.30);
    if (S.meta.depot) {
      keep.tools = {};
      TOOLS.slice(0, 4).forEach((t) => { keep.tools[t.id] = 15; });
    }

    const fresh = newRun(keep);
    Object.assign(S, fresh);
    S.seenStrata = {};          // on veut relire les textes de strate
    S.doctrine = engaged;
    S.nextDoctrine = engaged;   // reconduite par défaut, modifiable à tout moment
    this.computeStats();

    /* Le défi armé prend effet maintenant, pour la fouille qui commence. */
    S.challenge = S.nextChallenge || null;
    S.challengeFailed = false;

    Sfx.play('prestige');
    const dn = BY_ID.doctrine[engaged];
    logMsg('prestige', `Puits comblé. <b>+${fmt(gain)} éclats de mémoire</b>. ` +
      (engaged === 'aucune' ? 'Le chantier rouvre ailleurs.'
                            : `Nouvelle fouille sous doctrine <b>${dn.name}</b> — « ${dn.motto} »`), 0);
    UI.shopDirty = UI.wellDirty = UI.collectionDirty = true;
    return gain;
  },

  /* -----------------------------------------------------------------------
     LES UNITÉS — seconde couche de prestige, ouverte par le Cœur.
     ----------------------------------------------------------------------- */

  /**
   * Fragments que le départ rapporterait.
   *
   * CALIBRAGE CORRIGÉ : la première version donnait 1 fragment pour tout un
   * parcours jusqu'au Cœur, alors que le départ efface éclats et mémoire. Un
   * joueur a résumé le résultat sans détour : « ce n'est pas difficile, c'est
   * juste chiant ». Une couche de prestige doit rendre BEAUCOUP plus qu'elle
   * ne prend, sinon elle n'est qu'une punition déguisée en contenu.
   * Trois fragments dès le premier départ ouvrent immédiatement deux nœuds.
   */
  fragmentsFor(depth) {
    if (depth < HEART_DEPTH) return 0;
    return 3 + Math.floor((depth - HEART_DEPTH) / 60);
  },

  /** Applique une FRACTION d'un bloc d'effets (héritage des traits d'unité). */
  partialFx(fx, rate, c, addChance) {
    const soften = (v) => 1 + rate * (v - 1);
    if (fx.prodMult)           c.prodMult *= soften(fx.prodMult);
    if (fx.toolCostMult)       c.toolCostMult *= soften(fx.toolCostMult);
    if (fx.digCostMult)        c.digCostMult *= soften(fx.digCostMult);
    if (fx.knowledgeMult)      c.knowledgeMult *= soften(fx.knowledgeMult);
    if (fx.shardMult)          c.shardMult *= soften(fx.shardMult);
    if (fx.artefactChanceMult) addChance(soften(fx.artefactChanceMult));
  },

  canLeaveUnit() {
    return !!S.heartReached && S.maxDepth >= HEART_DEPTH;
  },

  /**
   * Quitter cette graine pour une autre. Le reset le plus dur du jeu : éclats,
   * mémoire gravée et doctrines disparaissent. Ne survivent que ce qui relève
   * de la CONNAISSANCE (collection, succès, maîtrises, défis) et les fragments.
   */
  leaveUnit() {
    if (!this.canLeaveUnit()) return false;
    const gain = this.fragmentsFor(S.maxDepth);

    S.fragments += gain;
    S.fragmentsTotal += gain;
    S.unitsLeft += 1;

    /* La nature de la graine qu'on abandonne entre dans l'héritage. */
    if (S.unitTrait) {
      S.traitsInherited = S.traitsInherited || {};
      S.traitsInherited[S.unitTrait] = (S.traitsInherited[S.unitTrait] | 0) + 1;
    }

    /* Les unités sont numérotées 3 → 9 puis reviennent à 1 : neuf en tout. */
    S.unit = (S.unit % 9) + 1;
    S.unitTrait = pick(UNIT_TRAITS).id;

    /* On ne repart PAS de rien : 30 % des éclats gagnés à vie restent acquis,
       donc le bonus passif ne s'effondre pas d'un coup. Repartir doit coûter,
       pas humilier. */
    const keptShards = Math.floor(S.shardsTotal * 0.3)
      + (S.fragmentsBought.f_pollen ? 25 : 0);

    Object.assign(S, newRun({}));
    S.shards = keptShards;
    S.shardsTotal = keptShards;
    S.prestiges = 0;
    S.meta = {};
    S.doctrine = 'aucune';
    S.nextDoctrine = 'aucune';
    S.seenStrata = {};
    S.heartReached = false;      // il faudra retoucher le Cœur de CETTE unité
    S.research = {};             // y compris le Protocole : nouvelle planète, nouveau chantier

    this.computeStats();
    Sfx.play('unit');
    const tr = BY_ID.trait[S.unitTrait];
    const inherited = Object.values(S.traitsInherited || {}).reduce((a, b) => a + b, 0);
    logMsg('unit', `<b>UNITÉ ${S.unit} / 9</b> — +${gain} fragment(s), ` +
      `${fmtInt(keptShards)} éclat(s) conservé(s). Cette graine-ci : <b>${tr.name}</b>. ${tr.desc}` +
      (inherited ? `<br><i>Héritage : ${inherited} nature(s) acquise(s) des graines précédentes.</i>` : ''), 0);
    UI.shopDirty = UI.wellDirty = UI.collectionDirty = UI.statsDirty = true;
    return gain;
  },

  fragmentAvailable(f) {
    if (S.fragmentsBought[f.id]) return false;
    return f.req.every((q) => S.fragmentsBought[q]);
  },

  buyFragment(id) {
    const f = BY_ID.fragment[id];
    if (!f || !this.fragmentAvailable(f) || S.fragments < f.cost) return false;
    S.fragments -= f.cost;
    S.fragmentsBought[id] = true;
    this.computeStats();
    Sfx.play('research');
    UI.shopDirty = true;
    return true;
  },
};
