# STRATES

Un jeu incrémental (*idle*) de fouille verticale. On creuse. On descend. On trouve
des choses qui ne devraient pas être là. On continue quand même.

---

## Lancer le jeu

Double-cliquez sur **`index.html`**. C'est tout.

Pas de Node, pas de npm, pas de serveur, pas de compilation. Les scripts sont
chargés en `<script>` classiques (pas de modules ES) précisément pour que le
jeu fonctionne en `file://`, en ouvrant simplement le fichier.

La partie est sauvegardée automatiquement toutes les 20 secondes dans le
`localStorage` du navigateur. **Vider les données du site efface la partie** —
le menu ☰ permet d'exporter/importer un code de sauvegarde.

---

## La boucle de jeu

```
   outils  ──produisent──▶  SÉDIMENT σ
      ▲                        │
      │                        │ paie
    achètent                   ▼
      │                    DESCENTE (1 m)
      │                        │
      │                        ├──▶ nouvelles STRATES  → nouveaux outils, lore
      │                        └──▶ ARTEFACTS → SAVOIR ✦ → RECHERCHES
      └────────────────────────────────────────────────┘

   à ~200 m : COMBLEMENT (prestige) → ÉCLATS ◈ → bonus permanents → on recommence plus vite
```

Quatre ressources, chacune avec un rôle distinct :

| Ressource | Rôle | Survit au comblement ? |
|---|---|---|
| **Sédiment σ** | monnaie courante : outils, améliorations, descente | non |
| **Savoir ✦** | monnaie de recherche, gagné en exhumant des artefacts | non (sauf méta) |
| **Éclats ◈** | monnaie de prestige, dépensée dans l'arbre Mémoire | oui |
| **Collection** | les artefacts trouvés, chacun donnant un bonus permanent | **oui, toujours** |

### L'arbitrage central

Le sédiment sert **à la fois** à acheter des outils et à descendre. Descendre
ouvre du contenu ; investir accélère tout. Le sélecteur **Descente auto**
(arrêt / prudent / à fond), débloqué par la recherche *Descente assistée*, rend
ce choix explicite :

- **arrêt** — rien ne part dans le puits, tout reste disponible pour les achats ;
- **prudent** — ne descend qu'avec 20× le prix du mètre d'avance ;
- **à fond** — descend dès que possible, plus rien à dépenser.

C'est le levier principal du jeu : on alterne phases d'investissement et
phases de poussée.

---

## Formules d'équilibrage

Tout est regroupé dans la constante `BAL`, en haut de [`js/content.js`](js/content.js) :

```js
digBase: 15          // coût en sédiment du tout premier mètre
digGrowth: 0.075     // +7,5 % de coût par mètre  ← LA courbe du jeu
toolRatio: 1.15      // chaque exemplaire d'un outil coûte +15 %
artefactChance: 0.20 // 20 % de chance d'artefact par mètre
shardDiv: 45         // profondeur/45 …
shardPow: 1.45       // … puissance 1,45 → nombre d'éclats
shardBonus: 0.10     // +10 % de production par éclat gagné à vie
```

Le coût d'un mètre est :

```
coût(d) = 15 × 1,075^d × dureté(strate) × réductions
```

L'exponentielle garantit qu'aucune production, si grande soit-elle, ne
« termine » le puits : il y a toujours un mètre de plus. Les paliers de dureté
au changement de strate créent les murs qui motivent l'investissement.

---

## Architecture

Six fichiers, une responsabilité chacun, chargés dans cet ordre :

| Fichier | Rôle | Ne connaît pas |
|---|---|---|
| [`js/utils.js`](js/utils.js) | formatage des grands nombres, sommes géométriques, helpers DOM | le jeu |
| [`js/content.js`](js/content.js) | **toutes les données** : strates, outils, améliorations, recherches, artefacts, méta, succès | la logique |
| [`js/state.js`](js/state.js) | l'état `S`, sauvegarde/chargement, export/import, journal | l'affichage |
| [`js/engine.js`](js/engine.js) | calculs, achats, descente, tick, hors-ligne, prestige | **le DOM** |
| [`js/ui.js`](js/ui.js) | tout le rendu DOM | les règles |
| [`js/main.js`](js/main.js) | démarrage, boucle, contrôles clavier/souris | — |

Deux principes tiennent l'ensemble :

**1. `engine.js` ne touche jamais au DOM.** C'est ce qui permet de simuler 8 h
de jeu en 200 ms (progression hors-ligne, banc d'essai) et de savoir où
chercher quand un chiffre est faux.

**2. `content.js` ne contient aucune logique.** Ajouter une strate, un outil ou
une recherche se fait en éditant ce seul fichier. Les effets sont déclarés dans
un petit vocabulaire (`prodMult`, `digCostMult`, `flag`…) que le moteur
interprète — voir l'en-tête du fichier.

### Rendu

On ne reconstruit pas le HTML à 60 fps. Les fonctions `build*()` créent les
éléments seulement quand la structure change (drapeaux `UI.*Dirty`), et
`refresh*()` ne met à jour que des textes et des classes via des références
gardées en mémoire.

---

## Outils de développement

### Banc d'essai — `tools/sim.html`

Double-cliquez dessus. Il fait jouer un joueur automatique pendant 8 h de temps
de jeu (calculées en ~200 ms), avant et après un comblement, puis affiche :

- les jalons de profondeur horodatés (10 m, 50 m, 100 m…) ;
- l'état final (production, multiplicateurs, recherches, artefacts) ;
- la courbe des coûts du puits ;
- une série de contrôles de cohérence des données.

**Relancez-le après chaque modification de `BAL` ou de `content.js`.** C'est le
seul moyen honnête de savoir si un changement d'équilibrage améliore ou casse
la courbe.

### Mode démo — `index.html?demo=N`

Simule `N` secondes de jeu automatique avant d'afficher l'interface. Sert à
vérifier l'affichage en milieu ou en fin de partie sans y jouer réellement.

```
index.html?demo=20000                  ≈ 5 h 30 de jeu, onglet Outils
index.html?demo=20000&tab=collection   idem, onglet Collection
index.html?demo=20000&diag=1           + mesures de mise en page
```

En mode démo, la partie réelle n'est **ni chargée ni sauvegardée** : aucun
risque d'écraser sa progression.

---

## Contenu actuel

10 strates (0 → 470 m) · 12 outils · 58 améliorations · 18 recherches ·
31 artefacts · 10 nœuds de mémoire · 20 succès.

Repères mesurés au banc d'essai (jeu actif, sans temps hors-ligne) :

| | 1re fouille | après 1 comblement (+120 %) |
|---|---|---|
| 50 m | 27 min | 6 min |
| 100 m | 1 h 20 | 16 min |
| 170 m — *La Cité Noyée* | 3 h 54 | 57 min |
| 230 m — *Le Grand Silence* | 6 h 47 | 2 h 25 |
| 380 m — *Le Réseau* | — | 7 h 15 |

Le Cœur (470 m) demande une troisième fouille.

---

## Pistes pour la suite

- Événements aléatoires en cours de forage (poche de gaz, effondrement, chambre scellée)
- Un deuxième axe de prestige au-delà du Cœur
- Sons et musique d'ambiance
- Objectifs quotidiens / défis de fouille
