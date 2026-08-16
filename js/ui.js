/* =========================================================================
   ui.js — Tout le DOM. Aucune règle de jeu ici.

   STRATÉGIE DE RENDU (importante dans un incrémental) :
   on ne reconstruit PAS le HTML à 60 fps. On sépare deux choses :
     · build*()   → crée les éléments, seulement quand la structure change
                    (achat, déblocage, changement d'onglet) → drapeaux *Dirty
     · refresh()  → 60 fps, met à jour uniquement des textes et des classes
                    via des références gardées en mémoire (UI.refs)
   Reconstruire tout à chaque image ferait ramer la page et casserait
   le survol/scroll de l'utilisateur.
   ========================================================================= */

const UI = {
  shopDirty: true,
  wellDirty: true,
  collectionDirty: true,
  statsDirty: true,
  logDirty: true,
  flashArtefact: null,
  refs: { tools: {}, upgrades: {}, research: {}, meta: {} },
  tab: 'outils',
};

/* -------------------------------------------------------------------------
   TOASTS — messages courts en bas d'écran.
   ------------------------------------------------------------------------- */
function toast(msg, ms = 2600) {
  const box = $('toasts');
  if (!box) return;
  /* Plafond à 3. Quand plusieurs succès tombent d'un coup — retour d'un long
     hors-ligne, franchissement d'un palier — la pile recouvrait la moitié de
     l'écran, y compris la fenêtre d'événement qui attend une réponse. */
  while (box.children.length >= 3) box.firstChild.remove();
  const t = el('div', 'toast', msg);
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms - 400);
  setTimeout(() => t.remove(), ms);
}

/* =========================================================================
   1. BANDEAU DE RESSOURCES
   ========================================================================= */
UI.refreshHeader = function () {
  const c = S.calc;
  $('res-sediment').textContent = fmt(S.sediment);
  $('res-rate').textContent = fmt(c.sedPerSec, 2) + ' σ/s';
  $('res-knowledge').textContent = fmt(S.knowledge);
  $('res-depth').textContent = fmtInt(S.depth) + ' m';

  const shardBox = $('res-shard-box');
  if (S.shardsTotal > 0 || S.shards > 0) {
    shardBox.classList.remove('hidden');
    $('res-shards').textContent = fmtInt(S.shards);
  } else {
    shardBox.classList.add('hidden');
  }
};

/* =========================================================================
   2. LE PUITS — colonne de strates + barre de descente
   ========================================================================= */
UI.buildWell = function () {
  const col = $('well-col');
  col.innerHTML = '';

  /* On n'affiche que les strates déjà touchées + LA suivante, floutée.
     POURQUOI ? Le sujet du jeu est de ne pas savoir ce qu'il y a en dessous.
     Révéler la liste complète tuerait la seule vraie tension du jeu. */
  const cur = Engine.strataAt(S.depth);
  const reachedIdx = STRATA.reduce((acc, s, i) => (S.bestDepth >= s.depth ? i : acc), 0);
  const lastIdx = Math.min(reachedIdx + 1, STRATA.length - 1);

  for (let i = 0; i <= lastIdx; i++) {
    const s = STRATA[i];
    const unknown = i > reachedIdx;
    const next = STRATA[i + 1];
    const span = (next ? next.depth : s.depth + 90) - s.depth;

    const seg = el('div', 'strat' + (unknown ? ' unknown' : '') + (s === cur ? ' active' : ''));
    seg.style.setProperty('--c', s.color);
    seg.style.flexGrow = Math.max(1, Math.sqrt(span));   // racine : compresse les strates larges
    seg.innerHTML = unknown
      ? `<span class="strat-name">? ? ?</span><span class="strat-depth">${fmtInt(s.depth)} m</span>`
      : `<span class="strat-name">${s.name}</span><span class="strat-depth">${fmtInt(s.depth)} m</span>`;
    col.appendChild(seg);
  }

  /* Le curseur de position est un élément unique, déplacé à chaque frame. */
  const cursor = el('div', 'well-cursor');
  cursor.id = 'well-cursor';
  cursor.innerHTML = '<span></span>';
  col.appendChild(cursor);
  UI.refs.cursor = cursor;
};

UI.refreshWell = function () {
  const cost = Engine.digCost(S.depth);
  const pct = clamp(S.sediment / cost, 0, 1);

  $('dig-fill').style.width = (pct * 100).toFixed(2) + '%';
  $('dig-cost').textContent = fmt(cost) + ' σ';
  $('dig-strata').textContent = Engine.strataAt(S.depth).name;

  /* Estimation du temps jusqu'au prochain mètre — l'info la plus utile du jeu. */
  const eta = $('dig-eta');
  if (S.sediment >= cost) {
    eta.textContent = S.calc.autoDig ? 'descente auto' : 'prêt';
    eta.className = 'ready';
  } else if (S.calc.sedPerSec > 0) {
    eta.textContent = fmtTime((cost - S.sediment) / S.calc.sedPerSec);
    eta.className = '';
  } else {
    eta.textContent = '—';
    eta.className = '';
  }

  const btn = $('btn-descend');
  btn.disabled = S.sediment < cost;
  btn.classList.toggle('pulse', S.sediment >= cost && !S.calc.autoDig);

  /* Le sélecteur de descente auto n'existe qu'une fois la recherche trouvée. */
  $('auto-ctl').classList.toggle('hidden', !S.calc.autoDig);

  /* Position du curseur dans la colonne (proportionnelle à la profondeur
     affichée, bornée par la dernière strate connue). */
  if (UI.refs.cursor) {
    const col = $('well-col');
    const segs = [...col.querySelectorAll('.strat')];
    let top = 0;
    for (let i = 0; i < segs.length; i++) {
      const s = STRATA[i], next = STRATA[i + 1];
      const end = next ? next.depth : s.depth + 90;
      if (S.depth < end || i === segs.length - 1) {
        const f = clamp((S.depth - s.depth) / (end - s.depth), 0, 1);
        top = segs[i].offsetTop + segs[i].offsetHeight * f;
        break;
      }
    }
    UI.refs.cursor.style.top = top + 'px';
  }
};

/* =========================================================================
   3. ONGLETS
   ========================================================================= */
UI.setTab = function (name) {
  UI.tab = S.tab = name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('hidden', p.id !== 'pane-' + name));
  UI.shopDirty = UI.collectionDirty = UI.statsDirty = true;
};

/* ---- 3a. OUTILS ---------------------------------------------------------- */
UI.buildTools = function () {
  const box = $('list-tools');
  box.innerHTML = '';
  UI.refs.tools = {};

  const visible = TOOLS.filter((t) => Engine.toolUnlocked(t));
  /* On montre aussi le PROCHAIN outil verrouillé : une carotte visible. */
  const nextLocked = TOOLS.find((t) => !Engine.toolUnlocked(t));

  visible.forEach((t) => {
    const card = el('div', 'card tool');
    card.innerHTML = `
      <div class="card-main">
        <div class="card-title">${t.name} <span class="owned" data-r="owned">0</span></div>
        <div class="card-desc">${t.desc}</div>
        <div class="card-sub"><span data-r="each"></span></div>
      </div>
      <div class="card-buy">
        <div class="price" data-r="price">—</div>
        <div class="qty" data-r="qty"></div>
      </div>`;
    card.onclick = () => { if (Engine.buyTool(t.id)) UI.pop(card); };
    box.appendChild(card);
    UI.refs.tools[t.id] = {
      card,
      owned: card.querySelector('[data-r=owned]'),
      price: card.querySelector('[data-r=price]'),
      qty:   card.querySelector('[data-r=qty]'),
      each:  card.querySelector('[data-r=each]'),
    };
  });

  if (nextLocked) {
    const lock = el('div', 'card locked',
      `<div class="card-main"><div class="card-title">? ? ?</div>
       <div class="card-desc">Se révèle à <b>${fmtInt(nextLocked.unlock)} m</b> de profondeur.</div></div>`);
    box.appendChild(lock);
  }
};

UI.refreshTools = function () {
  for (const id in UI.refs.tools) {
    const r = UI.refs.tools[id];
    const t = BY_ID.tool[id];
    const n = S.tools[id] || 0;
    const qty = Engine.buyQty(id);
    const price = Engine.toolCostBulk(id, qty);

    r.owned.textContent = n;
    r.price.textContent = fmt(price) + ' σ';
    r.qty.textContent = qty > 1 ? '×' + qty : '';
    r.each.textContent = n
      ? `${fmt(t.prod * S.calc.toolMult[id] * S.calc.prodMult, 2)} σ/s chacun · total ${fmt(n * t.prod * S.calc.toolMult[id] * S.calc.prodMult)} σ/s`
      : `${fmt(t.prod * S.calc.toolMult[id] * S.calc.prodMult, 2)} σ/s`;
    r.card.classList.toggle('afford', S.sediment >= price);
  }
};

/* ---- 3b. AMÉLIORATIONS --------------------------------------------------- */
UI.buildUpgrades = function () {
  const box = $('list-upgrades');
  box.innerHTML = '';
  UI.refs.upgrades = {};

  /* Une amélioration n'apparaît que si ses conditions d'apparition sont
     remplies ET qu'elle n'est pas achetée. Sinon la liste ferait 58 lignes
     illisibles dès la première minute. */
  const avail = [];
  UPGRADES.forEach((u) => {
    if (!S.upgrades[u.id] && (S.tools[u.tool] || 0) >= u.need) avail.push(u);
  });
  GLOBAL_UPGRADES.forEach((u) => {
    if (!S.upgrades[u.id] && S.bestDepth >= u.needDepth) avail.push(u);
  });
  avail.sort((a, b) => a.cost - b.cost);

  if (!avail.length) {
    box.innerHTML = `<p class="empty">Aucune amélioration disponible.<br>
      Elles se débloquent en accumulant des exemplaires d'un même outil
      (10, 25, 50, 100) et en descendant plus bas.</p>`;
    return;
  }

  avail.forEach((u) => {
    const card = el('div', 'card upg');
    card.innerHTML = `
      <div class="card-main">
        <div class="card-title">${u.name}</div>
        <div class="card-desc">${u.desc}</div>
      </div>
      <div class="card-buy"><div class="price">${fmt(u.cost)} σ</div></div>`;
    card.onclick = () => { if (Engine.buyUpgrade(u.id)) { UI.pop(card); UI.shopDirty = true; } };
    box.appendChild(card);
    UI.refs.upgrades[u.id] = { card, cost: u.cost };
  });
};

UI.refreshUpgrades = function () {
  for (const id in UI.refs.upgrades) {
    const r = UI.refs.upgrades[id];
    r.card.classList.toggle('afford', S.sediment >= r.cost);
  }
  const n = Object.keys(UI.refs.upgrades).length;
  $('badge-upgrades').textContent = n || '';
  $('badge-upgrades').classList.toggle('hidden', !n);
};

/* ---- 3c. RECHERCHE ------------------------------------------------------- */
UI.buildResearch = function () {
  const box = $('list-research');
  box.innerHTML = '';
  UI.refs.research = {};

  RESEARCH.forEach((r) => {
    const done = !!S.research[r.id];
    const open = Engine.researchAvailable(r);
    /* Les recherches trop lointaines restent masquées : on ne montre que
       celles faites, ouvertes, ou dont un seul prérequis manque. */
    const oneAway = r.req.length && r.req.filter((q) => !S.research[q]).length === 1;
    if (!done && !open && !oneAway) return;

    /* NB : classe « research » et non « res » — `.res` est déjà pris par les
       compteurs du bandeau (text-align:right), ce qui alignait tout le texte
       des recherches à droite. Les noms de classe sont un espace de noms
       global : dans une feuille unique, il faut les choisir comme tels. */
    const card = el('div', 'card research' + (done ? ' done' : '') + (!open && !done ? ' locked' : ''));
    const reqTxt = r.req.length
      ? `<div class="card-sub">Requiert : ${r.req.map((q) => BY_ID.research[q].name).join(', ')}</div>` : '';
    card.innerHTML = `
      <div class="card-main">
        <div class="card-title">${r.name}${done ? ' <span class="chk">✓</span>' : ''}</div>
        <div class="card-desc">${r.desc}</div>
        ${done ? '' : reqTxt}
      </div>
      ${done ? '' : `<div class="card-buy"><div class="price">${fmt(r.cost)} ✦</div></div>`}`;
    if (!done && open) card.onclick = () => { if (Engine.buyResearch(r.id)) { UI.pop(card); UI.shopDirty = true; } };
    box.appendChild(card);
    if (!done && open) UI.refs.research[r.id] = { card, cost: r.cost };
  });
};

UI.refreshResearch = function () {
  let n = 0;
  for (const id in UI.refs.research) {
    const r = UI.refs.research[id];
    const ok = S.knowledge >= r.cost;
    r.card.classList.toggle('afford', ok);
    if (ok) n++;
  }
  $('badge-research').textContent = n || '';
  $('badge-research').classList.toggle('hidden', !n);
};

/* ---- 3d. COLLECTION ------------------------------------------------------ */
UI.buildCollection = function () {
  const box = $('list-collection');
  box.innerHTML = '';

  const found = Object.keys(S.artefacts).length;
  $('coll-count').textContent = `${found} / ${ARTEFACTS.length}`;

  STRATA.forEach((st) => {
    const pool = ARTEFACTS_BY_STRATA[st.id] || [];
    const known = pool.filter((a) => S.artefacts[a.id]).length;
    /* On masque entièrement les strates jamais atteintes. */
    if (S.bestDepth < st.depth && !known) return;

    const grp = el('div', 'coll-group');
    grp.innerHTML = `<h4 style="--c:${st.color}">${st.name} <span>${known}/${pool.length}</span></h4>`;
    const grid = el('div', 'coll-grid');

    pool.forEach((a) => {
      const n = S.artefacts[a.id] || 0;
      const item = el('div', 'coll-item' + (n ? '' : ' unknown'));
      if (n) {
        const b = a.bonus;
        const bonusTxt =
          b.prodMult ? `+${Math.round((b.prodMult - 1) * 100)} % production` :
          b.knowledgeMult ? `+${Math.round((b.knowledgeMult - 1) * 100)} % savoir` :
          b.artefactChanceMult ? `+${Math.round((b.artefactChanceMult - 1) * 100)} % chance d'artefact` :
          b.digCostMult ? `−${Math.round((1 - b.digCostMult) * 100)} % coût de descente` : '';
        item.innerHTML = `<div class="ci-name">${a.name} ${n > 1 ? `<em>×${n}</em>` : ''}</div>
          <div class="ci-text">${a.text}</div>
          <div class="ci-bonus">${bonusTxt}</div>`;
      } else {
        item.innerHTML = `<div class="ci-name">non trouvé</div>
          <div class="ci-text">Continuez à creuser cette strate.</div>`;
      }
      grid.appendChild(item);
    });
    grp.appendChild(grid);
    box.appendChild(grp);
  });

  if (!box.children.length) {
    box.innerHTML = `<p class="empty">Rien encore. Les artefacts se trouvent en creusant :
      environ une chance sur cinq par mètre.</p>`;
  }
};

/* ---- 3e. MÉMOIRE (prestige) ---------------------------------------------- */
UI.buildMeta = function () {
  const box = $('list-meta');
  box.innerHTML = '';
  UI.refs.meta = {};

  META.forEach((m) => {
    const done = !!S.meta[m.id];
    const open = Engine.metaAvailable(m);
    const oneAway = m.req.length && m.req.filter((q) => !S.meta[q]).length >= 1;
    if (!done && !open && !oneAway) return;

    const card = el('div', 'card meta' + (done ? ' done' : '') + (!open && !done ? ' locked' : ''));
    card.innerHTML = `
      <div class="card-main">
        <div class="card-title">${m.name}${done ? ' <span class="chk">✓</span>' : ''}</div>
        <div class="card-desc">${m.desc}</div>
        ${done || open ? '' : `<div class="card-sub">Requiert : ${m.req.map((q) => BY_ID.meta[q].name).join(', ')}</div>`}
      </div>
      ${done ? '' : `<div class="card-buy"><div class="price">${m.cost} ◈</div></div>`}`;
    if (!done && open) card.onclick = () => {
      if (Engine.buyMeta(m.id)) { UI.pop(card); UI.shopDirty = true; toast('Mémoire gravée : ' + m.name); }
    };
    box.appendChild(card);
    if (!done && open) UI.refs.meta[m.id] = { card, cost: m.cost };
  });
};

UI.refreshMeta = function () {
  const gain = Engine.shardsFor(S.maxDepth);
  const unlocked = S.calc.prestigeUnlocked || S.prestiges > 0;

  $('meta-locked').classList.toggle('hidden', unlocked);
  $('meta-body').classList.toggle('hidden', !unlocked);
  if (!unlocked) return;

  $('meta-gain').textContent = fmtInt(gain);
  $('meta-have').textContent = fmtInt(S.shards);
  $('meta-total').textContent = fmtInt(S.shardsTotal);
  $('meta-bonus').textContent = '+' + Math.round(BAL.shardBonus * S.shardsTotal * 100) + ' %';
  $('meta-count').textContent = fmtInt(S.prestiges);

  /* Profondeur nécessaire pour gagner un éclat de plus : information clé
     pour décider « je pousse encore un peu » ou « je comble maintenant ». */
  const nextAt = Math.ceil(BAL.shardDiv * Math.pow(gain + 1, 1 / BAL.shardPow));
  $('meta-next').textContent = `+1 éclat à ${fmtInt(nextAt)} m`;

  const btn = $('btn-prestige');
  btn.disabled = gain < 1;
  btn.textContent = gain < 1 ? `Combler (0 éclat — descendez à ${BAL.shardDiv} m)` : `Combler le puits — +${fmtInt(gain)} ◈`;

  for (const id in UI.refs.meta) {
    UI.refs.meta[id].card.classList.toggle('afford', S.shards >= UI.refs.meta[id].cost);
  }
};

/* ---- 3e bis. DOCTRINES --------------------------------------------------- */
UI.buildDoctrines = function () {
  const box = $('doctrine-list');
  box.innerHTML = '';

  DOCTRINES.forEach((d) => {
    const runs = S.doctrineRuns[d.id] || 0;
    const done = !!S.mastered[d.id];
    const chosen = S.nextDoctrine === d.id;
    const active = S.doctrine === d.id;

    /* Progression de maîtrise : trois pastilles, pleines ou vides. C'est plus
       lisible qu'un « 2/3 » et ça donne envie de compléter la série. */
    let masteryHtml = '';
    if (d.mastery) {
      const pips = [0, 1, 2].map((i) =>
        `<span class="pip${i < Math.min(runs, MASTERY_RUNS) ? ' on' : ''}"></span>`).join('');
      masteryHtml = done
        ? `<div class="dc-mastery got">✓ ${d.mastery.name} — ${d.mastery.desc}</div>`
        : `<div class="dc-mastery">${pips} Maîtrise à ${MASTERY_RUNS} fouilles :
             <em>${d.mastery.name}</em> — ${d.mastery.desc}</div>`;
    }

    const card = el('div', 'doctrine' + (chosen ? ' chosen' : '') + (active ? ' active' : ''));
    card.style.setProperty('--c', d.color);
    card.innerHTML = `
      <div class="dc-head">
        <span class="dc-name">${d.name}</span>
        ${active ? '<span class="dc-tag">en cours</span>' : ''}
        ${chosen && !active ? '<span class="dc-tag next">prochaine</span>' : ''}
      </div>
      <div class="dc-motto">« ${d.motto} »</div>
      <div class="dc-desc">${d.desc}</div>
      ${masteryHtml}`;
    card.onclick = () => {
      S.nextDoctrine = d.id;
      UI.shopDirty = true;
      toast('Prochaine fouille : ' + d.name);
    };
    box.appendChild(card);
  });
};

/* Badge permanent dans la colonne du puits : la doctrine conditionne toute la
   partie, elle doit rester sous les yeux et non cachée dans un onglet. */
UI.refreshDoctrineBadge = function () {
  const badge = $('doctrine-badge');
  const d = BY_ID.doctrine[S.doctrine];
  if (!d || d.id === 'aucune') { badge.classList.add('hidden'); return; }
  badge.classList.remove('hidden');
  badge.style.setProperty('--c', d.color);
  badge.innerHTML = `<span class="db-lab">doctrine</span><span class="db-name">${d.name}</span>`;
};

/* ---- 3f. SUCCÈS & STATS -------------------------------------------------- */
UI.buildStats = function () {
  const box = $('list-ach');
  box.innerHTML = '';
  ACHIEVEMENTS.forEach((a) => {
    const got = !!S.achievements[a.id];
    box.appendChild(el('div', 'ach' + (got ? ' got' : ''),
      `<div class="ach-name">${got ? a.name : '???'}</div><div class="ach-desc">${a.desc}</div>`));
  });
  $('ach-count').textContent = `${Object.keys(S.achievements).length} / ${ACHIEVEMENTS.length}`;
};

UI.refreshStats = function () {
  const c = S.calc;
  const rows = [
    ['Production', fmt(c.sedPerSec, 2) + ' σ/s'],
    ['Multiplicateur global', '×' + fmt(c.prodMult, 2)],
    ['Chance d\'artefact', Math.round(c.artefactChance * 100) + ' %'],
    ['Coût de descente', '×' + fmt(c.digCostMult, 2)],
    ['Croissance du puits', '+' + ((BAL.digGrowth - c.digGrowth) * 100).toFixed(1) + ' % / m'],
    ['Multiplicateur de savoir', '×' + fmt(c.knowledgeMult, 2)],
    ['—', ''],
    ['Profondeur record', fmtInt(S.bestDepth) + ' m'],
    ['Sédiment total', fmt(S.totalSediment) + ' σ'],
    ['Mètres creusés (à vie)', fmtInt(S.totalDepthDug)],
    ['Artefacts trouvés', fmtInt(Object.values(S.artefacts).reduce((a, b) => a + b, 0))],
    ['Comblements', fmtInt(S.prestiges)],
    ['Temps de jeu', fmtTime(S.playTime)],
  ];
  $('stat-table').innerHTML = rows.map(([k, v]) =>
    k === '—' ? '<tr class="sep"><td colspan="2"></td></tr>' : `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
};

/* =========================================================================
   4. JOURNAL
   ========================================================================= */
/* On n'écrase JAMAIS tout le carnet : sinon chaque nouvelle entrée relance
   l'animation d'apparition des 120 lignes, et le panneau entier clignote en
   permanence (défaut repéré sur les captures de test). On insère seulement
   les entrées dont le numéro de série est supérieur au dernier rendu. */
UI.refreshLog = function () {
  const box = $('log');
  const inner = (e) => `<span class="le-d">${fmtInt(e.d)} m</span>${e.m}`;
  const line = (e) => `<div class="le le-${e.t}">${inner(e)}</div>`;
  const last = UI._lastLogK || 0;
  const fresh = S.log.filter((e) => (e.k || 0) > last);

  if (!box.children.length || fresh.length >= S.log.length) {
    /* Premier rendu (ou chargement d'une partie) : on pose tout d'un coup,
       sans animation — animer 120 lignes d'un historique n'a aucun sens. */
    box.innerHTML = S.log.map(line).join('');
    box.querySelectorAll('.le').forEach((x) => x.classList.add('no-anim'));
  } else {
    /* Du plus ancien au plus récent, pour que l'ordre final soit correct. */
    fresh.slice().reverse().forEach((e) => box.insertAdjacentHTML('afterbegin', line(e)));
    while (box.children.length > 120) box.lastChild.remove();
  }
  /* La première entrée peut avoir été MODIFIÉE sans être nouvelle (fusion des
     doublons) : on la réécrit systématiquement, ça ne coûte qu'une ligne. */
  if (box.firstChild && S.log.length) box.firstChild.innerHTML = inner(S.log[0]);
  UI._lastLogK = S.log.length ? (S.log[0].k || 0) : 0;
};

/* =========================================================================
   5. EFFETS VISUELS
   ========================================================================= */
UI.pop = function (element) {
  element.classList.remove('popped');
  void element.offsetWidth;          // force le navigateur à rejouer l'animation
  element.classList.add('popped');
};

UI.showArtefactFlash = function (a) {
  const box = $('artefact-flash');
  const st = BY_ID.strata[a.strata];
  box.innerHTML = `<div class="af-card" style="--c:${st.color}">
      <div class="af-label">Artefact exhumé</div>
      <div class="af-name">${a.name}</div>
      <div class="af-text">${a.text}</div>
    </div>`;
  box.classList.remove('hidden');
  clearTimeout(UI._flashTimer);
  UI._flashTimer = setTimeout(() => box.classList.add('hidden'), 5200);
  box.onclick = () => box.classList.add('hidden');
};

/* =========================================================================
   ÉVÉNEMENTS DE FORAGE
   ========================================================================= */
UI.showEventModal = function (ev) {
  const st = Engine.strataAt(S.depth);
  $('ev-strata').textContent = `${st.name} · ${fmtInt(S.depth)} m`;
  $('ev-title').textContent = ev.title;
  $('ev-text').textContent = ev.text;
  $('modal-event').querySelector('.event-box').style.setProperty('--c', st.color);

  const box = $('ev-choices');
  box.innerHTML = '';
  ev.choices.forEach((ch, i) => {
    const risky = ch.risk !== undefined;

    /* Les conséquences sont chiffrées ICI, sur l'état courant. Un choix qu'on
       ne peut pas évaluer n'est pas un choix : sans ces valeurs, comparer
       « du sédiment » à « une descente moins chère » revient à tirer à pile
       ou face. Pour un pari, on montre les DEUX issues avec leur probabilité. */
    let effects;
    if (risky) {
      const win  = Engine.previewFx(ch.fx || {}).join(' · ');
      const lose = Engine.previewFx(ch.fail || {}).join(' · ');
      effects =
        `<span class="evc-odds ok">${Math.round(ch.risk * 100)} %</span> ${win}<br>
         <span class="evc-odds ko">${Math.round((1 - ch.risk) * 100)} %</span> ${lose}`;
    } else {
      effects = Engine.previewFx(ch.fx || {}).join(' · ');
    }

    const b = el('button', 'ev-choice' + (risky ? ' risky' : ''),
      `<span class="evc-label">${ch.label}</span>
       <span class="evc-hint">${ch.hint || ''}</span>
       <span class="evc-fx">${effects}</span>`);
    b.addEventListener('click', () => {
      $('modal-event').classList.add('hidden');
      const r = Engine.resolveEvent(ev.id, i);
      if (r) toast((r.ok ? '' : '⚠ ') + ev.title + ' — ' + ch.label);
      saveGame(true);          // un événement est un moment : on le fige tout de suite
    });
    box.appendChild(b);
  });

  $('modal-event').classList.remove('hidden');
};

/* Bandeau des effets temporaires actifs. Sans lui, le joueur bénéficie d'un
   ×3 de production sans jamais savoir qu'il l'a, ni quand il s'arrête. */
UI.refreshBuffs = function () {
  const box = $('buffs');
  const live = (S.buffs || []).filter((b) => b.until > S.playTime);
  if (!live.length) { box.innerHTML = ''; box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = live.map((b) => {
    const bad = (b.prodMult && b.prodMult < 1) || (b.digCostMult && b.digCostMult > 1);
    return `<div class="buff${bad ? ' bad' : ''}">
        <span class="bf-name">${b.name}</span>
        <span class="bf-time">${fmtTime(b.until - S.playTime)}</span>
      </div>`;
  }).join('');
};

/* Nombre flottant au clic sur la bêche : le retour visuel qui rend le clic
   agréable. Sans lui, cliquer donne l'impression que rien ne se passe. */
UI.floatGain = function (x, y, txt) {
  const f = el('div', 'floatnum', txt);
  f.style.left = x + 'px';
  f.style.top = y + 'px';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 900);
};

/* =========================================================================
   6. BOUCLE DE RAFRAÎCHISSEMENT — appelée à chaque image par main.js
   ========================================================================= */
UI.render = function () {
  if (UI.shopDirty) {
    UI.buildTools(); UI.buildUpgrades(); UI.buildResearch(); UI.buildMeta();
    UI.buildDoctrines();
    UI.shopDirty = false;
  }
  /* Le puits ne se reconstruit que si sa STRUCTURE change (nouvelle strate
     révélée, ou strate courante différente). La descente d'un mètre, elle,
     ne bouge que le curseur — traité dans refreshWell(). Sans ce garde-fou,
     la colonne serait rebâtie 60 fois par seconde en descente automatique. */
  const reachedIdx = STRATA.reduce((acc, s, i) => (S.bestDepth >= s.depth ? i : acc), 0);
  const sig = reachedIdx + '|' + Engine.strataAt(S.depth).id;
  if (UI.wellDirty && sig !== UI._wellSig) { UI._wellSig = sig; UI.buildWell(); }
  UI.wellDirty = false;
  if (UI.collectionDirty) { UI.buildCollection(); UI.collectionDirty = false; }
  if (UI.statsDirty)      { UI.buildStats(); UI.statsDirty = false; }
  if (UI.logDirty)        { UI.refreshLog(); UI.logDirty = false; }
  if (UI.flashArtefact)   { UI.showArtefactFlash(UI.flashArtefact); UI.flashArtefact = null; }
  if (UI.showEvent)       { UI.showEventModal(UI.showEvent); UI.showEvent = null; }

  UI.refreshHeader();
  UI.refreshWell();
  UI.refreshDoctrineBadge();
  UI.refreshBuffs();
  UI.refreshTools();
  UI.refreshUpgrades();
  UI.refreshResearch();
  UI.refreshMeta();
  if (UI.tab === 'stats') UI.refreshStats();
};
