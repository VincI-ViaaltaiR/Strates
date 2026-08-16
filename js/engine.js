/* =========================================================================
   engine.js — Le moteur. Toute la logique du jeu, zéro DOM.

   POURQUOI séparer strictement moteur et affichage ?
   1) On peut tester le moteur sans navigateur (voir tools/sim.js).
   2) On peut faire tourner 8 heures de jeu hors-ligne en 3 ms, parce qu'on
      n'a rien à redessiner.
   3) Quand un chiffre est faux, on sait dans quel fichier chercher.
   ========================================================================= */

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

  /** La strate suivante, ou null si on est dans la dernière. */
  nextStrata(depth) {
    const cur = this.strataAt(depth);
    const i = STRATA.indexOf(cur);
    return STRATA[i + 1] || null;
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

    /* --- 2. Recherches --- */
    for (const id in S.research) {
      const r = BY_ID.research[id];
      if (r && r.fx) applyFx(r.fx);
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
      if (b.prodMult)           c.prodMult *= b.prodMult;
      if (b.digCostMult)        c.digCostMult *= b.digCostMult;
      if (b.artefactChanceMult) artChanceMult *= b.artefactChanceMult;
    }

    /* --- 8. Production totale = Σ(outils) × multiplicateur global --- */
    let base = 0;
    TOOLS.forEach((t) => {
      const n = S.tools[t.id] || 0;
      if (n) base += n * t.prod * c.toolMult[t.id];
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

  researchAvailable(r) {
    if (S.research[r.id]) return false;
    return r.req.every((q) => S.research[q]);
  },

  buyResearch(id) {
    const r = BY_ID.research[id];
    if (!r || !this.researchAvailable(r) || S.knowledge < r.cost) return false;
    S.knowledge -= r.cost;
    S.research[id] = true;
    this.computeStats();
    UI.shopDirty = true;
    logMsg('res', `Recherche terminée : <b>${r.name}</b>.`);
    return true;
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

    /* Entrée dans une nouvelle strate → texte d'ambiance, une seule fois. */
    const st = this.strataAt(S.depth);
    if (!S.seenStrata[st.id]) {
      S.seenStrata[st.id] = true;
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
    if (S.pendingEvent) return;                       // un seul à la fois
    if (S.playTime < (S.nextEventAt || 0)) return;    // temps de repos obligatoire
    if (Math.random() >= BAL.eventChance) return;

    const pool = EVENTS.filter((e) =>
      (!e.strata || e.strata.includes(strata.id)) && S.depth >= (e.minDepth || 0));
    if (!pool.length) return;

    const ev = pick(pool);
    S.pendingEvent = ev.id;
    S.nextEventAt = S.playTime + BAL.eventCooldown;
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

    if (fx.buff) {
      const b = fx.buff;
      if (b.prodMult) {
        /* On chiffre aussi le gain total sur la durée : « ×1,5 » ne dit rien,
           « ≈ +42 M σ sur 5 min » se compare à une somme immédiate. */
        const delta = c.sedPerSec * (b.prodMult - 1) * b.dur;
        out.push(`production ×${fmt(b.prodMult, 2)} pendant ${fmtTime(b.dur)} ` +
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

    if (fx.buff) {
      const b = Object.assign({}, fx.buff, { until: S.playTime + fx.buff.dur });
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

    if (isNew) {
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
    let n = Math.floor(Math.pow(depth / BAL.shardDiv, BAL.shardPow));
    if (S.meta.memoire_vive) n = Math.floor(n * 1.5);
    return n;
  },

  doPrestige() {
    const gain = this.shardsFor(S.maxDepth);
    if (gain < 1) return false;

    S.shards += gain;
    S.shardsTotal += gain;
    S.prestiges += 1;

    /* Ce que la méta permet d'emporter dans la nouvelle fouille. */
    const keep = {};
    if (S.meta.fondations)     keep.sediment = 250000;
    if (S.meta.savoir_retenu)  keep.knowledge = Math.floor(S.knowledge * 0.30);
    if (S.meta.depot) {
      keep.tools = {};
      TOOLS.slice(0, 4).forEach((t) => { keep.tools[t.id] = 15; });
    }

    const fresh = newRun(keep);
    Object.assign(S, fresh);
    S.seenStrata = {};          // on veut relire les textes de strate
    this.computeStats();

    logMsg('prestige', `Puits comblé. <b>+${fmt(gain)} éclats de mémoire</b>. Le chantier rouvre ailleurs.`, 0);
    UI.shopDirty = UI.wellDirty = UI.collectionDirty = true;
    return gain;
  },
};
