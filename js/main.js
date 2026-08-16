/* =========================================================================
   main.js — Démarrage, boucle principale, branchement des contrôles.
   Le seul fichier qui « fait tourner » les autres.
   ========================================================================= */

const Game = {
  lastSim: 0,
  saveTimer: 0,

  init() {
    /* --- MODE DÉMO (outil de développement) ---------------------------
       index.html?demo=7200 simule 2 h de jeu automatique avant d'afficher.
       Sert à vérifier l'interface en milieu/fin de partie sans y jouer
       réellement. En mode démo on NE charge NI ne sauvegarde la partie
       réelle : impossible d'écraser sa progression par erreur. */
    /* ?still=1 — fige toutes les animations. Uniquement pour les captures
       automatisées : elles sont prises dès le chargement, donc en plein
       milieu des animations d'apparition. */
    if (new URLSearchParams(location.search).get('still')) {
      document.documentElement.classList.add('no-motion');
    }

    const demo = parseInt(new URLSearchParams(location.search).get('demo'), 10);
    if (demo > 0) {
      this.demoMode = true;
      this.runDemo(demo);
      this.bindUI();
      UI.setTab(new URLSearchParams(location.search).get('tab') || 'outils');
      UI.shopDirty = UI.wellDirty = UI.collectionDirty = UI.statsDirty = UI.logDirty = true;
      const q = new URLSearchParams(location.search);
      if (q.get('diag')) this.diagOverlay();
      /* Deux leviers réservés aux captures de développement : certains écrans
         ne s'ouvrent qu'après des dizaines d'heures de jeu réel et resteraient
         donc invisibles à toute vérification automatisée. */
      if (q.get('unlock')) {           // ouvre la couche « unités » (Cœur touché)
        S.heartReached = true;
        S.maxDepth = Math.max(S.maxDepth, HEART_DEPTH);
        S.fragments = 6;
        Engine.computeStats();
      }
      if (q.get('report')) {           // affiche un bilan de fouille d'exemple
        S.lastRun = {
          depth: Math.floor(S.maxDepth), shards: Engine.shardsFor(S.maxDepth),
          artefacts: S.runArtefacts | 0, events: S.runEvents | 0,
          research: Object.keys(S.research).length, sediment: S.runSediment,
          seconds: S.playTime, doctrine: S.doctrine, challenge: S.challenge,
          challengeDone: false, strata: Engine.strataAt(S.maxDepth).name,
        };
        this.showReport(S.lastRun);
      }
      this.startClocks();
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

    /* Un événement resté sans réponse doit revenir au rechargement de la
       page — sinon `pendingEvent` bloquerait tous les suivants à jamais. */
    if (S.pendingEvent) UI.showEvent = BY_ID.event[S.pendingEvent] || null;
    if (S.pendingEvent && !UI.showEvent) S.pendingEvent = null;   // événement supprimé du contenu

    this.bindUI();
    UI.setTab(S.tab || 'outils');
    UI.shopDirty = UI.wellDirty = UI.collectionDirty = UI.statsDirty = UI.logDirty = true;

    this.startClocks();
  },

  /* =======================================================================
     LES DEUX HORLOGES

     ERREUR CORRIGÉE : la simulation était pilotée par requestAnimationFrame.
     Or le navigateur SUSPEND rAF dès que l'onglet n'est plus au premier plan.
     Résultat : la partie gelait en arrière-plan sans être pour autant
     comptée comme hors-ligne. Pour un jeu idle, c'est une faute de fond —
     le genre repose entièrement sur « ça continue sans moi ».

     La correction consiste à séparer ce qui doit avancer de ce qui doit
     s'afficher :

       · SIMULATION  → setInterval + Date.now(). Un intervalle est seulement
                       RALENTI en arrière-plan (~1 Hz), jamais arrêté ; et
                       comme on mesure le temps réel écoulé, un tick lent
                       rattrape exactement ce qu'il doit.
       · AFFICHAGE   → requestAnimationFrame. Qu'il s'arrête quand l'onglet
                       est caché est une bonne chose : on économise le CPU
                       pour redessiner ce que personne ne regarde.
     ======================================================================= */
  startClocks() {
    this.lastSim = Date.now();

    this.simTimer = setInterval(() => this.step(), 200);

    /* Filet de sécurité : si le navigateur gèle carrément l'onglet (Firefox
       le fait après une longue inactivité), l'intervalle ne tourne plus du
       tout. Au retour de l'onglet, on rattrape immédiatement. */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.step();
    });

    const frame = () => { UI.render(); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  },

  /** Un pas de simulation, calé sur le temps RÉELLEMENT écoulé. */
  step() {
    const now = Date.now();
    let dt = (now - this.lastSim) / 1000;
    this.lastSim = now;
    if (!(dt > 0)) return;                 // horloge système reculée, ou 0

    /* Absence longue (veille du PC, onglet gelé) : ce n'est plus du
       rattrapage, c'est du hors-ligne — et donc soumis à ses règles. */
    if (dt > 300) {
      const r = Engine.applyOffline(dt * 1000);
      if (r) this.showOffline(r);
      return;
    }

    /* Rattrapage normal, par pas d'une seconde au plus : la descente
       automatique doit pouvoir suivre la montée du coût du mètre au lieu
       d'encaisser 60 secondes de production d'un seul bloc. */
    let guard = 400;
    while (dt > 0 && guard-- > 0) {
      const s = Math.min(dt, 1);
      Engine.tick(s);
      dt -= s;
      this.saveTimer += s;
    }

    if (this.saveTimer > 20 && !this.demoMode) { this.saveTimer = 0; saveGame(true); }
  },

  /* -----------------------------------------------------------------------
     CONTRÔLES
     ----------------------------------------------------------------------- */
  bindUI() {
    /* Le contexte audio ne peut naître que d'un geste réel du joueur : les
       navigateurs refusent tout son avant une interaction. On l'accroche donc
       au premier clic, quel qu'il soit, puis on se retire. */
    const wake = () => { Sfx.init(); document.removeEventListener('pointerdown', wake); };
    document.addEventListener('pointerdown', wake);

    /* Bêche : clic manuel */
    $('btn-dig').addEventListener('click', (ev) => {
      const g = Engine.click();
      Sfx.play('dig');
      UI.floatGain(ev.clientX, ev.clientY - 10, '+' + fmt(g) + ' σ');
      UI.pop($('btn-dig'));
    });

    /* Descente manuelle */
    $('btn-descend').addEventListener('click', () => {
      if (Engine.descend()) { Sfx.play('descend'); UI.pop($('btn-descend')); }
    });

    /* Son : interrupteur et volume */
    const snd = $('opt-sound-on'), vol = $('opt-volume');
    snd.checked = S.sound !== false;
    vol.value = Math.round((S.volume ?? 0.35) * 100);
    snd.addEventListener('change', () => {
      S.sound = snd.checked;
      if (S.sound) { Sfx.init(); Sfx.play('buy'); }
    });
    vol.addEventListener('input', () => {
      Sfx.init(); Sfx.setVolume(vol.value / 100);
    });
    vol.addEventListener('change', () => Sfx.play('buy'));

    /* Bilan de fouille */
    $('report-ok').addEventListener('click', () => $('modal-report').classList.add('hidden'));

    /* Départ vers une autre unité — le reset le plus dur du jeu */
    $('btn-leave').addEventListener('click', () => {
      if (!Engine.canLeaveUnit()) return;
      const gain = Engine.fragmentsFor(S.maxDepth);
      this.confirm('Quitter cette graine ?',
        `Vous perdez <b>tout</b> : sédiment, outils, recherches, profondeur, <b>éclats et
         mémoire gravée</b>, doctrines engagées.<br><br>
         Vous conservez : la collection d'artefacts, les succès, les maîtrises de doctrine,
         les défis relevés.<br><br>
         Vous gagnez : <b>${gain} fragment(s) d'unité ✧</b>, et une graine neuve avec sa
         propre nature.`,
        () => {
          const g = Engine.leaveUnit();
          saveGame(true);
          UI.setTab('outils');
          toast(`Unité ${S.unit} / 9 — +${g} ✧`);
        });
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
          this.showReport(S.lastRun);
        });
    });

    /* Aide contextuelle */
    $('hint-ok').addEventListener('click', () => {
      $('modal-hint').classList.add('hidden');
      UI.hintOpen = false;      // libère la file : l'aide suivante pourra sortir
    });

    /* Menu options */
    $('opt-version').textContent = 'v' + VERSION;
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

    /* Raccourcis clavier : Espace = bêche, D = descendre, S = sauvegarder.
       `e.repeat` vaut true quand le système REPÈTE la touche parce qu'elle
       reste enfoncée (~30 frappes/seconde). Sans ce filtre, garder Espace
       appuyé donne un auto-clic gratuit : un seul geste vaut trente coups de
       bêche. On n'accepte donc que les vraies pressions. */
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
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

      /* Le joueur simulé répond au hasard aux événements. Sans cela, le tout
         premier resterait en attente et bloquerait tous les suivants — l'état
         de démo ne ressemblerait plus à une vraie partie. */
      /* Le joueur simulé « lit » les aides au fil de l'eau, sans quoi la
         première bloquerait la file et l'onglet Aide resterait vide. */
      UI.showHint = null;

      if (S.pendingEvent && t < seconds - 60) {
        const ev = BY_ID.event[S.pendingEvent];
        Engine.resolveEvent(S.pendingEvent, Math.floor(Math.random() * ev.choices.length));
      }

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

  /** Bilan de la fouille qui vient de s'achever. */
  showReport(r) {
    if (!r) return;
    const doc = BY_ID.doctrine[r.doctrine];
    const ch = r.challenge && BY_ID.challenge[r.challenge];
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    $('report-title').textContent = `${fmtInt(r.depth)} m — ${r.strata}`;
    $('report-body').innerHTML = `<table class="report-table">
        ${row('Durée de la fouille', fmtTime(r.seconds))}
        ${row('Profondeur atteinte', fmtInt(r.depth) + ' m')}
        ${row('Sédiment extrait', fmt(r.sediment) + ' σ')}
        ${row('Artefacts exhumés', fmtInt(r.artefacts))}
        ${row('Recherches menées', fmtInt(r.research))}
        ${row('Décisions de forage', fmtInt(r.events))}
        ${doc && doc.id !== 'aucune' ? row('Doctrine', doc.name) : ''}
        ${ch ? row('Défi', ch.name + (r.challengeDone ? ' — relevé ✓' : ' — échoué')) : ''}
      </table>
      <div class="report-gain">+${fmtInt(r.shards)} éclat(s) de mémoire ◈</div>`;
    $('modal-report').classList.remove('hidden');
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
