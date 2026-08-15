/* =========================================================================
   main.js — Démarrage, boucle principale, branchement des contrôles.
   Le seul fichier qui « fait tourner » les autres.
   ========================================================================= */

const Game = {
  lastFrame: 0,
  saveTimer: 0,

  init() {
    /* --- MODE DÉMO (outil de développement) ---------------------------
       index.html?demo=7200 simule 2 h de jeu automatique avant d'afficher.
       Sert à vérifier l'interface en milieu/fin de partie sans y jouer
       réellement. En mode démo on NE charge NI ne sauvegarde la partie
       réelle : impossible d'écraser sa progression par erreur. */
    const demo = parseInt(new URLSearchParams(location.search).get('demo'), 10);
    if (demo > 0) {
      this.demoMode = true;
      this.runDemo(demo);
      this.bindUI();
      UI.setTab(new URLSearchParams(location.search).get('tab') || 'outils');
      UI.shopDirty = UI.wellDirty = UI.collectionDirty = UI.statsDirty = UI.logDirty = true;
      this.lastFrame = performance.now();
      if (new URLSearchParams(location.search).get('diag')) this.diagOverlay();
      requestAnimationFrame(this.loop.bind(this));
      return;
    }

    const loaded = loadGame();
    Engine.computeStats();

    /* --- Progression hors-ligne, avant tout affichage --- */
    if (loaded && S.lastSave) {
      const away = Date.now() - S.lastSave;
      const r = Engine.applyOffline(away);
      if (r) {
        setTimeout(() => Game.showOffline(r), 400);
      } else if (away > 60000) {
        // Le joueur était absent mais n'a pas encore la recherche « Équipes de nuit ».
        setTimeout(() => toast("Absent " + fmtTime(away / 1000) + " — le chantier était à l'arrêt."), 600);
      }
    }

    if (!loaded) {
      logMsg('strata', `<b>Terre végétale</b> — ${STRATA[0].intro}`, 0);
      logMsg('info', "Cliquez sur <b>Creuser à la bêche</b> pour produire vos premiers sédiments, puis achetez des outils.", 0);
    }

    this.bindUI();
    UI.setTab(S.tab || 'outils');
    UI.shopDirty = UI.wellDirty = UI.collectionDirty = UI.statsDirty = UI.logDirty = true;

    this.lastFrame = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  },

  /* -----------------------------------------------------------------------
     LA BOUCLE. requestAnimationFrame donne ~60 appels/seconde, mais on ne
     s'y fie PAS : on mesure le temps réellement écoulé (dt). Un onglet en
     arrière-plan tourne à 1 fps — sans dt réel, le joueur perdrait sa
     production. Le plafond à 1 s évite un saut monstrueux au réveil du PC
     (ce cas est couvert par la progression hors-ligne, pas par la boucle).
     ----------------------------------------------------------------------- */
  loop(now) {
    const dt = Math.min((now - this.lastFrame) / 1000, 1);
    this.lastFrame = now;

    Engine.tick(dt);
    UI.render();

    this.saveTimer += dt;
    if (this.saveTimer > 20 && !this.demoMode) { this.saveTimer = 0; saveGame(true); }

    requestAnimationFrame(this.loop.bind(this));
  },

  /* -----------------------------------------------------------------------
     CONTRÔLES
     ----------------------------------------------------------------------- */
  bindUI() {
    /* Bêche : clic manuel */
    $('btn-dig').addEventListener('click', (ev) => {
      const g = Engine.click();
      UI.floatGain(ev.clientX, ev.clientY - 10, '+' + fmt(g) + ' σ');
      UI.pop($('btn-dig'));
    });

    /* Descente manuelle */
    $('btn-descend').addEventListener('click', () => {
      if (Engine.descend()) UI.pop($('btn-descend'));
    });

    /* Onglets */
    document.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => UI.setTab(b.dataset.tab));
    });

    /* Mode d'achat 1 / 10 / 100 / max */
    document.querySelectorAll('.buymode').forEach((b) => {
      b.addEventListener('click', () => {
        S.buyMode = parseInt(b.dataset.n, 10);
        document.querySelectorAll('.buymode').forEach((x) => x.classList.toggle('on', x === b));
      });
    });

    /* Politique de descente automatique (arrêt / prudent / à fond) */
    document.querySelectorAll('.automode').forEach((b) => {
      b.classList.toggle('on', b.dataset.m === S.autoMode);
      b.addEventListener('click', () => {
        S.autoMode = b.dataset.m;
        document.querySelectorAll('.automode').forEach((x) => x.classList.toggle('on', x === b));
      });
    });

    /* Prestige, avec confirmation : c'est une action irréversible. */
    $('btn-prestige').addEventListener('click', () => {
      const gain = Engine.shardsFor(S.maxDepth);
      if (gain < 1) return;
      this.confirm(
        'Combler le puits ?',
        `Vous perdez le sédiment, les outils, les améliorations, les recherches et la profondeur.<br><br>
         Vous conservez : <b>la collection d'artefacts</b>, la mémoire gravée, les succès.<br>
         Vous gagnez : <b>${fmtInt(gain)} éclat(s) de mémoire</b> (+${Math.round(BAL.shardBonus * 100)} % de production chacun, définitivement).`,
        () => {
          const g = Engine.doPrestige();
          saveGame(true);
          UI.setTab('outils');
          toast(`Puits comblé. +${fmtInt(g)} ◈`);
        });
    });

    /* Menu options */
    $('btn-menu').addEventListener('click', () => $('modal-options').classList.remove('hidden'));
    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => b.closest('.modal').classList.add('hidden'));
    });

    $('opt-save').addEventListener('click', () => saveGame());
    $('opt-export').addEventListener('click', () => {
      const code = exportSave();
      $('opt-io').value = code;
      $('opt-io').select();
      try { document.execCommand('copy'); toast('Code copié dans le presse-papier.'); }
      catch (e) { toast('Sélectionnez le texte et copiez-le.'); }
    });
    $('opt-import').addEventListener('click', () => {
      const v = $('opt-io').value;
      if (!v.trim()) return toast('Collez d\'abord un code de sauvegarde.');
      if (importSave(v)) { toast('Sauvegarde importée.'); location.reload(); }
      else toast('⚠ Code invalide.');
    });
    $('opt-wipe').addEventListener('click', () => {
      this.confirm('Tout effacer ?', 'Sauvegarde, collection, éclats : <b>tout</b> disparaît. Irréversible.',
        () => { wipeGame(); location.reload(); });
    });

    /* Raccourcis clavier : Espace = bêche, D = descendre, S = sauvegarder. */
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); $('btn-dig').click(); }
      else if (e.key === 'd' || e.key === 'D') $('btn-descend').click();
      else if (e.key === 's' || e.key === 'S') saveGame();
    });

    /* Sauvegarde de sécurité quand on ferme l'onglet. */
    window.addEventListener('beforeunload', () => saveGame(true));
  },

  /* -----------------------------------------------------------------------
     MODE DÉMO — joue tout seul `seconds` secondes, instantanément.
     Même heuristique que tools/sim.html : cliquer au début, investir dans
     le meilleur ratio production/prix, descendre avec du surplus.
     ----------------------------------------------------------------------- */
  runDemo(seconds) {
    S = newGame();
    Engine.computeStats();
    const dt = 0.5;
    let t = 0, step = 0;

    while (t < seconds) {
      Engine.tick(dt);
      t += dt;
      const cps = t < 180 ? 4 : t < 900 ? 1 : 0;
      for (let i = 0; i < cps * dt; i++) Engine.click();

      if (++step % 4 === 0) {
        for (const r of RESEARCH) Engine.buyResearch(r.id);
        for (const u of UPGRADES.concat(GLOBAL_UPGRADES)) {
          const visible = u.tool ? (S.tools[u.tool] || 0) >= u.need : S.bestDepth >= u.needDepth;
          if (visible && !S.upgrades[u.id] && S.sediment > u.cost * 1.6) Engine.buyUpgrade(u.id);
        }
        let guard = 40;
        while (guard-- > 0) {
          let best = null, ratio = 0;
          for (const tool of TOOLS) {
            if (!Engine.toolUnlocked(tool)) continue;
            const cost = Engine.toolCost(tool.id);
            if (cost > S.sediment) continue;
            const r = (tool.prod * S.calc.toolMult[tool.id]) / cost;
            if (r > ratio) { ratio = r; best = tool; }
          }
          if (!best) break;
          S.buyMode = 1;
          Engine.buyTool(best.id);
        }
        if (!S.calc.autoDig) {
          let g = 500;
          while (g-- > 0 && S.sediment > Engine.digCost(S.depth) * 3 && Engine.descend(true)) {}
        }
      }
    }
    logMsg('info', `<b>MODE DÉMO</b> — ${fmtTime(seconds)} de jeu simulées. Rien n'est sauvegardé.`);

  },

  /* Diagnostic de mise en page pour les captures de développement.
     Lire offsetHeight force le navigateur à calculer la mise en page
     immédiatement : les mesures sont donc justes, sans attendre. */
  diagOverlay() {
    UI.render();
    const col = $('well-col');
    const d = el('div', '', `<pre style="margin:0;color:#e0a33e;font:12px ui-monospace,Consolas,monospace">
depth ............ ${S.depth}
bestDepth ........ ${S.bestDepth}
segments .strat .. ${col.querySelectorAll('.strat').length}
well-col height .. ${col.offsetHeight}
#well height ..... ${$('well').offsetHeight}
main height ...... ${document.querySelector('main').offsetHeight}
body height ...... ${document.body.offsetHeight}
innerHeight ...... ${window.innerHeight}
well-ctl height .. ${$('well-ctl').offsetHeight}
log entries ...... ${S.log.length}</pre>`);
    d.style.cssText = 'position:fixed;right:8px;top:80px;z-index:999;background:#000;border:1px solid #e0a33e;padding:10px';
    document.body.appendChild(d);
  },

  /* Petite boîte de confirmation maison (window.confirm est laid et bloquant). */
  confirm(title, html, onYes) {
    $('confirm-title').innerHTML = title;
    $('confirm-body').innerHTML = html;
    $('modal-confirm').classList.remove('hidden');
    $('confirm-no').classList.remove('hidden');
    const yes = $('confirm-yes');
    yes.textContent = 'Confirmer';
    const clone = yes.cloneNode(true);           // retire les anciens écouteurs
    yes.parentNode.replaceChild(clone, yes);
    clone.addEventListener('click', () => {
      $('modal-confirm').classList.add('hidden');
      onYes();
    });
  },

  showOffline(r) {
    let html = `Le chantier a tourné pendant <b>${fmtTime(r.seconds)}</b>`;
    if (r.rate < 1) html += ` à ${Math.round(r.rate * 100)} % de rendement`;
    html += '.';
    if (r.meters > 0) html += `<br>Le puits est descendu de <b>${fmtInt(r.meters)} m</b> en votre absence.`;
    $('confirm-title').innerHTML = 'À votre retour';
    $('confirm-body').innerHTML = html;
    $('modal-confirm').classList.remove('hidden');
    /* Ici il n'y a rien à refuser : on masque le bouton « Annuler ». */
    $('confirm-no').classList.add('hidden');
    const yes = $('confirm-yes');
    yes.textContent = 'Reprendre';
    const clone = yes.cloneNode(true);
    yes.parentNode.replaceChild(clone, yes);
    clone.addEventListener('click', () => $('modal-confirm').classList.add('hidden'));
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());
