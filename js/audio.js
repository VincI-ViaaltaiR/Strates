/* =========================================================================
   audio.js — Sons du chantier, entièrement SYNTHÉTISÉS.

   POURQUOI PAS DE FICHIERS AUDIO : le jeu doit rester un dossier qu'on ouvre
   par double-clic, sans serveur. Charger des .mp3 en `file://` est bloqué par
   certains navigateurs, alourdit le dépôt et complique le déploiement. L'API
   Web Audio permet de fabriquer chaque son à la volée, avec des oscillateurs
   et du bruit blanc — quelques lignes, zéro octet de données.

   RÈGLE : le navigateur interdit de démarrer l'audio avant un geste du
   joueur. On crée donc le contexte au PREMIER clic, jamais au chargement.
   ========================================================================= */

const Sfx = {
  ctx: null,
  master: null,

  /** Créé paresseusement, au premier geste réel du joueur. */
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = S.volume !== undefined ? S.volume : 0.35;
      this.master.connect(this.ctx.destination);
      return true;
    } catch (e) { return false; }
  },

  setVolume(v) {
    S.volume = v;
    if (this.master) this.master.gain.value = v;
  },

  /**
   * Une note : oscillateur + enveloppe descendante.
   * L'enveloppe est ce qui distingue un « toc » d'un « bip » : sans chute
   * rapide du gain, tout son synthétisé sonne comme une alarme.
   */
  tone(freq, dur, type = 'sine', gain = 0.5, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env); env.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  },

  /** Bruit blanc filtré : c'est ce qui « fait terre » plutôt que musique. */
  noise(dur, freq = 900, gain = 0.35, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(env); env.connect(this.master);
    src.start(t);
  },

  /* Chaque son est décrit par ce qu'il doit ÉVOQUER, pas par une mélodie :
     la bêche mord la terre, l'artefact tinte, la strate gronde. */
  play(what) {
    if (!S.sound || !this.ctx) return;
    switch (what) {
      case 'dig':                                   // coup de bêche
        this.noise(0.12, 700 + Math.random() * 400, 0.22);
        break;
      case 'descend':                               // un mètre de plus
        this.noise(0.22, 420, 0.28);
        this.tone(90, 0.18, 'sine', 0.18);
        break;
      case 'buy':                                   // achat d'outil
        this.tone(520, 0.07, 'triangle', 0.22);
        this.tone(780, 0.10, 'triangle', 0.18, 0.05);
        break;
      case 'artefact':                              // découverte inédite
        this.tone(880, 0.16, 'sine', 0.30);
        this.tone(1320, 0.26, 'sine', 0.24, 0.09);
        break;
      case 'strata':                                // nouvelle couche
        this.tone(70, 0.9, 'sine', 0.34);
        this.noise(0.7, 260, 0.24);
        break;
      case 'event':                                 // le puits vous interpelle
        this.tone(330, 0.14, 'square', 0.13);
        this.tone(247, 0.22, 'square', 0.11, 0.12);
        break;
      case 'research':
        this.tone(660, 0.10, 'triangle', 0.20);
        this.tone(990, 0.16, 'triangle', 0.16, 0.08);
        break;
      case 'success':                               // défi, succès
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.20, 'triangle', 0.20, i * 0.09));
        break;
      case 'prestige':                              // comblement
        this.noise(1.1, 200, 0.34);
        [392, 330, 262].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.22, i * 0.16));
        break;
      case 'heart':                                 // le Cœur, à 500 m
        [262, 330, 392, 523].forEach((f, i) => this.tone(f, 1.3, 'sine', 0.20, i * 0.28));
        this.tone(65, 2.4, 'sine', 0.26);
        break;
      case 'unit':                                  // départ vers une autre unité
        [523, 392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.7, 'sine', 0.22, i * 0.2));
        this.noise(1.6, 150, 0.3);
        break;
    }
  },
};
