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

### Les événements de forage

Environ tous les quart d'heure, le puits pose une question : venue d'eau, trépan
coincé, porte verrouillée de l'intérieur. Chacun propose deux réponses, sans
bonne réponse évidente — on échange du sédiment contre du temps, de la sécurité
contre du savoir. Certains choix sont des paris affichés (« 55 % de réussite »).

Ils existent pour deux raisons précises :

- **combler les strates larges.** *La Nappe* fait 45 m et *le Socle* 50 m : on y
  passait une heure sans que rien de neuf n'arrive ;
- **rendre le monde interrogatif.** Sans eux, le jeu ne demande jamais rien au
  joueur : le carnet raconte, les artefacts intriguent, mais tout se subit.

La fenêtre affiche les conséquences **chiffrées sur l'état du moment** :
« +19,0 G σ (2 min 30 de production) » contre « prochain mètre 293 M → 234 M σ
pendant 3 min ». Sans ces valeurs, les deux options ne sont pas dans la même
unité et le choix revient à tirer à pile ou face — un dilemme n'a d'intérêt que
si le joueur peut l'évaluer. Les paris montrent leurs deux issues avec leurs
probabilités.

Certains choix ouvrent des **effets temporaires** (production, coût de descente)
affichés en haut de la colonne du puits avec leur décompte. Un effet peut être
**différé** (`delay`) pour s'enchaîner au lieu de se superposer : accorder une
pause arrête d'abord le chantier, *puis* l'équipe reposée produit mieux —
simultanés, les deux se neutralisaient et la scène n'avait plus de sens.

Ils devraient **rythmer sans accélérer**. Le groupe témoin du banc d'essai
mesure aujourd'hui **+11 % de profondeur en 8 h** (25 parties) : ce n'est pas
neutre, et c'est un réglage à reprendre. La mesure a longtemps sauté de +2 % à
+22 % d'une exécution à l'autre, parce que 12 parties ne suffisaient pas — la
série avec événements est bien plus dispersée que le témoin. À 25 parties, le
chiffre se stabilise et le verdict est clair.

**Deux leçons d'équilibrage, apprises par la mesure :**

- *Un événement ne doit pas être une récompense avec un choix de couleur.* La
  première version offrait un bonus dans les deux branches : +13 % de vitesse.
- *Une pénalité se paie sur le débit, pas sur le stock.* Retirer du sédiment ne
  coûte presque rien à qui réinvestit tout — la réserve est déjà proche de zéro
  et le plancher `max(0, …)` absorbe le reste. Ajouter des coûts en sédiment n'a
  strictement rien changé à la mesure. Les coûts passent donc par un effet
  « Chantier ralenti » (production ×0,5), qu'aucune stratégie n'esquive.

### Expliquer le jeu sans le déflorer

Un joueur a atteint **200 m sans jamais combler son puits**. Il jugeait l'arbre
Mémoire sur son contenu — « le premier nœud utile coûte 45 éclats » — sans
savoir que *chaque éclat donne déjà +10 % de production à vie, sans rien
acheter*. Cette information n'existait que dans un compteur affichant « +0 % »
tant qu'on n'avait pas comblé : **il fallait avoir compris pour pouvoir
comprendre.** Ce n'est pas une erreur de joueur, c'est un défaut du jeu.

Trois réponses, complémentaires :

- **Aides contextuelles** (`HINTS` dans `content.js`) — une fenêtre au moment
  précis où une mécanique se débloque, jamais avant. Une seule à la fois : trois
  fenêtres d'affilée se ferment sans être lues.
- **Onglet Aide** — les mêmes textes, consultables ensuite à tout moment. Il ne
  contient *que* les mécaniques déjà rencontrées : le sujet du jeu reste de ne
  pas savoir ce qu'il y a en dessous.
- **Panneau de comblement explicite** — il affiche désormais « bonus permanent
  ×1,0 → ×2,3 » avant l'action, pas après.

Règle générale : **aucune aide ne parle d'une mécanique non débloquée.**

### Le Savoir ne doit jamais dormir

Une fois les 18 recherches terminées, le Savoir ne servait plus à rien — un
joueur en avait 20 millions inutilisés. Une ressource sans usage casse la boucle
qui la produit : les artefacts perdaient d'un coup la moitié de leur intérêt.

Trois **recherches répétables** (Approfondissement, Étaiement, Prospection)
closent l'arbre. Leur coût est multiplié à chaque niveau (×1,9 à ×2,3), donc
elles absorbent n'importe quelle quantité de savoir sans jamais devenir
gratuites, pour un effet composé modeste par niveau.

### Les doctrines de chantier

À chaque comblement, on engage une **doctrine** pour toute la fouille suivante.
Elle donne beaucoup dans un domaine et retire dans un autre :

| Doctrine | Vise | Donne | Coûte |
|---|---|---|---|
| **Ingénierie** | les éclats | éclats ×1,7, production ×3 | artefacts ×0,4, savoir ×0,5 |
| **Archéologie** | le savoir | artefacts ×2,6, savoir ×1,8 | production ×0,6, descente ×2,2 |
| **Spéléologie** | la profondeur | descente ×0,15 | outils ×1,3, savoir ×0,85, artefacts ×0,7 |

Mener **3 fouilles** sous une même doctrine en acquiert la **maîtrise** : un
bonus permanent, conservé ensuite quelle que soit la doctrine suivie. C'est ce
qui récompense celui qui les essaie toutes plutôt que de camper sur une seule.

**Pourquoi elles existent.** Jusque-là, aucune décision n'était durable : tout
achat était cumulatif et optimal, toute recherche bonne à prendre. Un jeu sans
renoncement n'a pas de personnalité. Une doctrine est un engagement, et donc un
vrai choix.

### Trois leçons d'équilibrage, imposées par la mesure

Le profil de chaque doctrine est mesuré à chaque exécution du banc d'essai.
Trois principes en sont sortis, et ils valent pour tout ajout futur :

**1. `production ≪ savoir ≪ coût de descente`.** Le coût du mètre étant
exponentiel, multiplier la production par 2,5 ne rapporte qu'une douzaine de
mètres (log 2,5 / log 1,075). Le savoir, lui, achète les recherches qui
réduisent ce coût. Un bonus de production n'est donc *jamais* comparable à un
bonus de savoir, même à multiplicateur égal.

**2. Ne jamais toucher à `digGrowth` dans une doctrine.** Réduire la croissance
du coût au mètre est de très loin l'effet le plus puissant du jeu : testé à
−1,2 pt, la Spéléologie atteignait 453 m et raflait *du même coup* le plus
d'artefacts, de recherches et d'éclats. C'est structurel — la profondeur est
l'axe dont tout le reste découle, donc l'améliorer c'est tout améliorer. Une
doctrine se limite à `digCostMult`, qui décale la courbe sans changer sa pente.

**3. Chaque doctrine doit dominer une colonne, pas toutes.** C'est le critère
que le banc d'essai affiche ; s'il est violé, le choix n'en est plus un.

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

### Les deux horloges

La **simulation** tourne sur `setInterval` + `Date.now()` ; l'**affichage** sur
`requestAnimationFrame`. Cette séparation n'est pas cosmétique : le navigateur
*suspend* rAF dès que l'onglet passe en arrière-plan, ce qui gelait la partie
sans qu'elle soit pour autant comptée comme hors-ligne. Un intervalle, lui, est
seulement ralenti (~1 Hz) ; comme on mesure le temps réel écoulé, rien n'est
perdu. Un `visibilitychange` sert de filet si le navigateur gèle l'onglet.

Corollaire, valable pour tout le moteur : **les durées de jeu se comptent en
`S.playTime`, jamais avec `Date.now()`**. Les deux divergent dès qu'on simule
(8 h calculées en 0,3 s) ou qu'on rattrape du hors-ligne.

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

Double-cliquez dessus. Il fait jouer un joueur automatique sur **25 parties** de
8 h chacune, avant et après un comblement (le tout en ~12 secondes), puis
affiche :

- les jalons de profondeur, en **médiane [minimum – maximum]** ;
- un **groupe témoin** rejouant les 25 mêmes parties événements désactivés,
  pour mesurer leur effet réel ;
- le **profil des quatre doctrines** (profondeur / artefacts / recherches /
  éclats), pour vérifier qu'aucune ne domine toutes les colonnes ;
- l'état détaillé de la dernière partie et la courbe des coûts du puits ;
- une vingtaine de contrôles de cohérence des données.

**Pourquoi 25 parties et pas une seule.** Le jeu contient beaucoup de hasard :
sur une partie unique, la profondeur atteinte en 8 h varie de 230 à 300 m — un
écart *aussi grand que les effets qu'on cherche à mesurer*. Régler
l'équilibrage sur un run unique revient à confondre le bruit avec le signal,
et c'est exactement l'erreur qui a laissé passer un système d'événements 13 %
trop généreux. Même à 12 parties, la mesure sautait encore de +2 % à +22 %.

**Pourquoi un groupe témoin.** C'est la seule façon de mesurer l'effet d'un
système : le comparer à son absence, à méthode identique et sur le même nombre
de parties. Sans témoin, on compare un chiffre à un souvenir.

**Relancez-le après chaque modification de `BAL` ou de `content.js`.**

### Mode démo — `index.html?demo=N`

Simule `N` secondes de jeu automatique avant d'afficher l'interface. Sert à
vérifier l'affichage en milieu ou en fin de partie sans y jouer réellement.

```
index.html?demo=20000                  ≈ 5 h 30 de jeu, onglet Outils
index.html?demo=20000&tab=collection   idem, onglet Collection
index.html?demo=20000&diag=1           + mesures de mise en page
index.html?still=1                     fige les animations (captures d'écran)
```

`still=1` est indispensable pour les captures automatisées : elles sont prises
dès le chargement, c'est-à-dire pendant les animations d'apparition — les
fenêtres ressortaient vides sur les images. Le jeu respecte par ailleurs le
réglage système `prefers-reduced-motion`.

En mode démo, la partie réelle n'est **ni chargée ni sauvegardée** : aucun
risque d'écraser sa progression.

---

## Contenu actuel

10 strates (0 → 470 m) · 12 outils · 58 améliorations · 18 recherches
**+ 3 répétables sans limite** · 31 artefacts · 15 événements de forage ·
4 doctrines avec leurs maîtrises · 10 nœuds de mémoire · 20 succès ·
9 aides contextuelles.

Profil mesuré des doctrines (médiane sur 5 parties de 8 h, sans éclats) :

| | profondeur | artefacts | recherches | éclats |
|---|---|---|---|---|
| Aucune | 246 m | 20 | 15 | 11 |
| Ingénierie | 294 m | 18 | 14 | **25** |
| Archéologie | 271 m | **22** | **18** | 13 |
| Spéléologie | **294 m** | 19 | 15 | 15 |

Repères mesurés au banc d'essai — **médiane sur 7 parties**, jeu actif, sans
temps hors-ligne :

| | 1re fouille | après 1 comblement |
|---|---|---|
| 50 m | 26 min | 7 min |
| 100 m | 1 h 31 | 22 min |
| 170 m — *La Cité Noyée* | 3 h 43 | 1 h 04 |
| 230 m — *Le Grand Silence* | 6 h 52 | 2 h 14 |
| 380 m — *Le Réseau* | — | 5 h 53 |
| profondeur après 8 h | 240 m | 392 m |

Le Cœur (470 m) demande une troisième fouille. Le comblement s'ouvre dans
**7 parties sur 7**, vers 200 m.

Ces chiffres bougent d'une exécution à l'autre : la dispersion entre parties
est de l'ordre de ±10 %. Ne conclure à un changement d'équilibrage qu'au-delà.

---

## Partager le jeu

Le jeu est du HTML statique sans compilation : **n'importe quel hébergeur de
fichiers le sert tel quel**. Inutile de coder un menu ou un mécanisme de mise à
jour — servir le jeu depuis une URL rend le problème sans objet, puisque le
navigateur récupère la dernière version à chaque ouverture.

### GitHub Pages (recommandé)

Le dépôt est déjà sur GitHub. Dans **Settings → Pages** : source
« Deploy from a branch », branche `main`, dossier `/ (root)`, puis Save.
Une à deux minutes plus tard, le jeu est en ligne :

```
https://vinci-viaaltair.github.io/Strates/
```

Chaque `git push` met la page à jour automatiquement. La personne à qui vous
donnez l'adresse la met en favori et joue toujours à la dernière version.

Pages gratuit exige un **dépôt public**. Pour rester privé : **Cloudflare Pages**
ou **Netlify**, gratuits eux aussi, connectés au dépôt GitHub, avec le même
déploiement automatique à chaque push.

### La discipline à tenir : le cache

Un navigateur qui a déjà ouvert le jeu resservira ses fichiers en cache, et le
joueur restera bloqué sur une version périmée sans le savoir. D'où, à **chaque
livraison** :

1. incrémenter `VERSION` en haut de [`js/content.js`](js/content.js) ;
2. remplacer le `?v=…` des balises `<script>` et `<link>` de
   [`index.html`](index.html) par le même numéro.

La version s'affiche dans le menu **Options** : quand quelqu'un signale un
problème, la première question est toujours « quelle version ? ».

### Les sauvegardes ne suivent pas

Une partie est stockée dans le `localStorage`, qui est **lié au domaine**. La
partie jouée en local (`file://`) et celle jouée en ligne sont donc deux parties
distinctes. Le menu Options permet d'exporter un code et de le réimporter
ailleurs pour transférer sa progression.

### Sans hébergement

Envoyer le dossier zippé fonctionne (le destinataire dézippe et ouvre
`index.html`), mais il faudra renvoyer un fichier à chaque correction — c'est
précisément ce que l'URL évite.

## Pistes pour la suite

- **Reprendre le réglage des événements** — ils accélèrent de +13 %, mesuré sur
  25 parties. À traiter en durcissant les ralentissements, puis en re-mesurant.
- **Défis de fouille** — rejouer avec un handicap (sans descente auto, sans
  artefacts) pour un bonus permanent, à la manière d'Antimatter Dimensions
- **Une aide sur les doctrines dans le panneau lui-même** — l'aide contextuelle
  ne se déclenche qu'après le premier comblement
- Un deuxième axe de prestige au-delà du Cœur
- Sons et musique d'ambiance
