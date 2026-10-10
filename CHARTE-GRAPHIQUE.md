# Charte graphique — Athena

**Relevé automatique du CSS, pas une intention.** Chaque valeur ci-dessous est
lue dans `design/athena-demo.css` (6 476 lignes, 940 blocs, 63 jetons). Les
écarts entre ce que le code fait et ce qu'on croyait qu'il faisait sont
signalés en §11 — c'est la partie la plus utile de ce document.

Fichier de référence unique : `design/athena-demo.css`.
`docs/design/athena-demo.css` est un **miroir généré**
(`node tools/prepare-assets.js`), ignoré par git. On n'écrit jamais dedans.

---

## 1. Intention

Un instrument de travail, pas un produit grand public. Dense, sobre, sans effet.
Le contenu — le fil de discussion et le plan de raisonnement — occupe l'écran ;
la décoration n'en occupe aucune.

Corollaire : **aucune animation n'est décorative.** Les dix animations
existantes signalent toutes un état réel.

---

## 2. Architecture des thèmes — à lire avant toute couleur

C'est le point qui surprend le plus, et la source de plusieurs bugs passés.

| Ordre | Emplacement | Rôle | Jetons |
|---|---|---|---|
| 1 | `:root` (L26) | base **claire** | 62 |
| 2 | `@media (prefers-color-scheme: dark)` → `:root` (L133) | sombre si l'OS le demande | 32 |
| 3 | `:root` (L3316) | **sombre inconditionnel**, `color-scheme: dark` | 34 |
| 4 | `:root` (L3876) | accents tardifs (`--lien`, `--ok`, `--ambre-texte`, `--marque`) | 4 |
| 5 | `html[data-theme="light"]` (L5158) | clair **forcé** | 41 |

Conséquences réelles, vérifiées au navigateur :

- Le bloc 3 écrase le bloc 2, plus haut dans le fichier. **La media query 2 est
  donc inerte pour la plupart des propriétés** : l'application est sombre par
  défaut, quelle que soit la préférence de l'OS.
- `theme-loader.js` pose `data-theme="dark"` au chargement. Mesuré : que
  l'OS soit en light ou en dark, la page démarre en `data-theme="dark"`.
- Le thème clair n'existe donc que par `data-theme="light"`.

**Corollat important, et défaut réel** : les huit `--fond-*` de surface et les
jetons de code (§3.2, §3.5) ne sont déclarés que dans le **bloc 1** et le
**bloc 5**. Le bloc 3 ne les redéfinit pas — ils résolvent donc par repli sur
les valeurs du bloc 1. Ça fonctionne aujourd'hui parce que ces valeurs sont
sombres, mais c'est un accident, pas une intention : le jour où quelqu'un
changera une valeur du bloc 1, le bloc 3 suivra sans le vouloir.

> **Piège à connaître** : un jeton ne peut pas être défini par lui-même.
> `--texte: var(--texte)` est **invalide** en CSS et rend le jeton vide. C'est
> arrivé ici : la consolidation des littéraux avait remplacé `#171717` par
> `var(--texte)` y compris dans la déclaration de `--texte`, en deux endroits
> du bloc clair. Résultat mesuré : thème clair avec un jeton vide, texte rendu
> en noir pur et `--primaire`跟进 cassé. Le thème sombre restait intact, donc
> le défaut n'apparaissait qu'en basculant le thème. Corrigé en `eb`.

**Consigne** : toute nouvelle couleur doit être déclarée dans **deux** endroits
minimum — le bloc 3 (sombre) et le bloc 5 (clair). Une couleur déclarée dans le
bloc 1 seulement reste sombre en thème clair, et c'est arrivé (§11, §5).

---

## 3. Palette complète

63 jetons. Colonnes : valeur par défaut (bloc 3, sombre) · valeur forcée claire
(bloc 5). `—` = non redéfini, donc valeur du bloc 1.

### 3.1 Surfaces et texte

| Jeton | Sombre | Clair | Rôle |
|---|---|---|---|
| `--fond` | `#0f0f0f` | `#ffffff` | fond de page |
| `--carte` | `#181818` | `#ffffff` | cartes, panneaux |
| `--carte-doux` | `#242424` | `#f4f4f4` | surfaces inertes |
| `--texte` | `#f1f1f1` | `#171717` | texte courant |
| `--texte-doux` | `#b0b0b0` | `#616161` | texte secondaire |
| `--bord` | `#3d3d3d` | `#e4e4e4` | séparation |
| `--bord-fort` | `#505050` | `#c8c8c8` | séparation appuyée |

### 3.2 Surfaces de zone (créées le 2026-10-07)

| Jeton | Sombre | Clair | Zone |
|---|---|---|---|
| `--fond-chat` | `#1f1d1d` | `#ffffff` | `.chat-shell` **et** toute la zone de conversation : `.chat-tete`, `.msgs`, `.composeur`, `.composeur-carte`, `.hud-plan` |
| `--fond-row` | `#242222` | — | **`.row.bot .bubble` uniquement** — la bulle du modèle, jamais la rangée |
| `--fond-bulle-clair` | — | `#ffffff` | le fond de la bulle du modèle **en thème clair** |
| `--fond-side` | `#141414` | `#f7f7f7` | `.sidebar` entière |
| `--fond-side-pied` | `#141414` | `#f2f1f0` | `.side-pied` |
| `--fond-share` | `#454242` | `#454242` | bouton Partager |
| `--fond-share-survol` | `#555250` | `#555250` | son survol |
| `--fond-partage-texte` | `#f2f2f2` | `#f2f2f2` | texte de Partager |

Ces huit-là sont les seuls à porter une valeur identique dans les deux thèmes :
le bouton Partager doit rester lisible sur les deux (§11).

**Aucun conteneur ne porte de fond propre.** `.msgs`, `.composeur` et
`.chat-shell` partagent `--fond-chat` : c'est la règle. Un fond distinct sur un
conteneur crée une frontière visible là où il n'y a rien à séparer. Le jeton
`--fond-msgs` a été supprimé : deux valeurs quasi identiques pour un seul bloc.

Les séparations volontaires sont des **filets de 1px** (`--bord`) : en bas de
l'en-tête et au-dessus du composeur. Une bordure se lit mieux qu'un écart de
teinte, et elle reste cohérente entre les deux thèmes.

### 3.3 Accent

| Jeton | Sombre | Clair | Rôle |
|---|---|---|---|
| `--primaire` | `#f1f1f1` | `#171717` | action principale |
| `--primaire-fort` | `#ffffff` | `#000000` | survol de l'action |
| `--primaire-doux` | `#3b3b3b` | `#e9e9e9` | fond d'accent discret |
| `--primaire-texte` | `#f1f1f1` | `#171717` | texte sur `--primaire-doux` |
| `--sur-primaire` | `#202020` | — | texte **sur** `--primaire` |
| `--lien` | `#76a9ff` | `#0b5cad` | liens |
| `--violet` | `#b8b8b8` | `#333333` | (nom trompeur : c'est un gris) |
| `--violet-doux` | `#303030` | `#e4e4e4` | idem |
| `--violet-texte` | `#d0d0d0` | `#3a3a3a` | idem |
| `--marque` | `#d97757` | — | la marque |

### 3.4 États — le thème est **monochrome par choix**

| Jeton | Sombre | Clair |
|---|---|---|
| `--danger-fond` / `--bord` / `--texte` | `#3a3a3a` / `#606060` / `#f1f1f1` | `#f0f0f0` / `#c9c9c9` / `#141414` |
| `--ambre-fond` / `--bord` / `--texte` | `#343434` / `#505050` / `#e1b45c` | `#f1f1f1` / `#d2d2d2` / `#3a3a3a` |
| `--gris-fond` / `--bord` / `--texte` | `#303030` / `#4a4a4a` / `#b0b0b0` | `#ededed` / `#dcdcdc` / `#606060` |
| `--rouge-*` | alias de `--danger-*` | idem |
| `--ok` | `#f1f1f1` | `#111111` |

Le « danger » est gris : c'est la **graine** — épaisseur de trait, fond,
apostrophe — qui distingue un état, jamais la teinte. C'est ce qui tient en
clair comme en sombre et qui reste lisible aux daltonismes.

`--danger-fond` vaut `#3a3a3a` en sombre mais `--ambre-fond` aussi : les deux
états « vides » sont indiscernables par la couleur. Ils ne se distinguent que
par leur bordure.

### 3.5 Code

| Jeton | Sombre | Clair | Rôle |
|---|---|---|---|
| `--code-fond` | `#171717` | `#f4f4f4` | fond générique « code » |
| `--fond-code-bloc` | `#0d0d0d` | `#0d0d0d` | **fond des blocs**, sombre dans les deux |
| `--fond-code-inline` | `#1a1818` | `#1a1818` | **encadrement** du code en ligne |
| `--texte-code-bloc` | `#ea553c` | `#ea553c` | texte du code |
| `--texte-plan-bloc` | `#ffffff` | `#ffffff` | texte du plan |

`--fond-code-bloc` et `--fond-code-inline` sont volontairement **identiques dans
les deux thèmes** : le fond d'un bloc de code ne s'éclaircit pas. Données mesurées
: contraste `#ea553c` sur `#0d0d0d` = **5,43:1**, sur `#1a1818` = **5,43:1**.

`--code-fond` n'est utilisé que là où un fond clair de code est acceptable.
C'est un piège : il s'inverse entre les thèmes.

---

## 4. Rayons

Trois jetons, et **15 valeurs littérales** en dehors (4, 5, 6, 7, 8, 9, 10, 11,
13, 14, 15, 18, 20, 24, 999 px). L'échelle n'est donc pas tenue.

| Jeton | Valeur | Usage | Occurrences |
|---|---|---|---|
| `--rayon-s` | 8px | petits contrôles, puces | 25 |
| `--rayon` | 12px | cartes, champs | 14 |
| `--rayon-l` | 16px | grandes surfaces | 7 |

Littéraux les plus répandus : 24px (composeur, `border-radius: 24px`),
20px (composeur en fenêtre étroite), 14/18px (bulles), 999px (pastilles
arrondies), 4–11px (puces et badges).

---

### 4.1 Surface et halo — plus de filet

| Jeton | Sombre | Clair | Rôle |
|---|---|---|---|
| `--surface` | `#1f1d1d` | `#ffffff` | l'unique fond : en-tête, fil, composeur, carte, plan |
| `--halo` | `0 10px 30px -10px rgba(0,0,0,.55), 0 0 1px rgba(255,255,255,.04)` | `0 10px 30px -10px rgba(0,0,0,.14), 0 0 1px rgba(0,0,0,.06)` | la carte de saisie et le plan |

Un filet de 1px **coupe** l'écran : c'est une ligne nette, elle ne se laisse pas
ignorer. Un halo très diffus se dissout dans le fond. Les deux cartes portent
désormais le même halo — en-tête, plan et composeur forment une famille.

Le second terme du halo sombre (`rgba(255,255,255,.04)`) est indispensable :
sur fond noir, une ombre noire ne se voit pas du tout. C'est cette lumière
blanche, pas l'ombre, qui détache la carte. Le risque était réel, il est vérifié.

Mesuré au rastérisé, profil vertical sous le bord de la carte : 31,29,29 →
45,43,43 en sombre ; 255,255,255 → 241,241,241 en clair.

### 4.8 Un tour, un seul bloc continu (`ev`)

Un tour de l'assistant est **un seul `.row.bot`**, et son DOM est deja dans
l'ordre de lecture :

| ordre | noeud |
|---|---|
| 1 | le texte, les blocs de code |
| 2 | les cartes d'action, **sous le bloc de code de leur commande** |
| 3 | la synthese, si elle vient apres |
| 4 | le raisonnement, replie, une ligne |

C'est une regle de **construction**, pas de rendu. Aucun `order` en CSS : la
copie, le selectionneur de texte et la lecture d'ecran suivent le meme ordre que
l'oeil, parce que c'est le meme ordre.

#### Ce que le bloc `eu` avait rate

`eu` reputait regler la question avec `order`, en selectivityant
`.bubble.md > …`. Mesure sur un tour **reel** : ce selecteur ne designait
rien.

- la bulle porte `class="bubble"`, son contenu `class="md"` — `.bubble.md`
  exige un element qui ait **les deux**, ce qui n'arrive jamais ;
- `.md-pied-modele`, `.raisonnement-corps` et `.md-contenu` : **zero**
  occurrence dans `chat-demo.js`. Trois selecteurs pour du vide ;
- les actions vivent dans `.md`, pas dans `.bubble`.

Consequence : ni le deplacement du raisonnement, ni la disparition du
separateur de suite, ni le retrait des cartes n'avaient ete appliques. La
verification qui les validait avait mesure un DOM **fabrique par la sonde**, pas
celui de l'application — le selecteur de la sonde etait plus permissif que celui
du CSS.

La regle qui vaut : **un test qui mesure le DOM doit le construire avec le code
de l'application**, jamais a la main. Ici, piloter `genererReponse()` avec une
reponse et de vraies etapes de raisonnement donne la structure reelle en une
seconde.

#### Verification demandee — trois commandes et un texte long, dans les deux themes

Une seule bulle `.row.bot`, et **l'ordre du DOM** relu sur le DOM reel :

    .row.bot > .bubble > div.md > details.raisonnement

Le raisonnement est le **dernier enfant**, replie, titre
« Raisonnement · 3 etapes · 1 s ». L'ordre visuel, mesure par
`getBoundingClientRect().top` :

    y=317  p            y=561  p (synthese)
    y=358  p            y=602  details.activity-group
    y=467  pre          y=727  details.raisonnement

#### Un piege de mesure, deux fois

1. **L'ordre du DOM ne dit rien de l'ordre affiche.** `order` reordonne
   l'affichage sans deplacer un noeud. Comparer des positions prises avant que
   la feuille ne soit active donne un « non » faux.
2. **Un selecteur CSS trop permissif valide n'importe quoi.** `.bubble.md`
   ne matchait rien ; la sonde, elle, construisait une bulle qui avait bien les
   deux classes, donc « ça marchait » des deux cotes du papier.
### 4.7 Gras, émojis et zones (`et`)

**Le gras traverse le code.** `markdownInline` découpait le texte sur les
segments `code` AVANT le gras : un `**` qui englobe du code était coupé en deux,
et le gras disparaissait sans bruit. Les segments sont maintenant retirés
derrière un jeton avant toute mise en forme, puis restaurés à la fin — le gras
porte sur la chaîne entière. `tests/gras-code.test.cjs` verrouille 13 cas,
dont `**nom \`du code\`**` et l’orphelin `**`, qui reste du texte.

**Les émojis sont auto-hébergés.** 14 SVG dans `vendor/twemoji/72x72/`
(8,8 Ko). La bibliothèque était locale, les images venaient du CDN : hors ligne
le rendu retombait sur l’émoji système. La conversion porte maintenant sur tous
les conteneurs de texte — cartes d’action, plan, raisonnement — et non plus
seulement `.bubble` et `.md`. Taille relative : `1.25em`.

**En-tête et composeur : même traitement.** Mesure avant : même fond, mais
ombres différentes et l’en-tête n’avait **aucun flou** (`blur: none`) pendant
que le composeur était à `blur(8px)`. Les deux valent désormais
`0 0 14px 6px var(--surface)` et `blur(8px)`.

Piège Twemoji : la bibliothèque construit `<base><size><codepoint><ext>` et
`size` n’est pas configurable dans cette version — le sous-dossier `72x72/`
fait partie du chemin, et il faut `ext: '.svg'` explicite.

**Blocs de code et fichiers.** `.md pre` passe au rayon `--rayon-s`, à
`--bord-code`, et à un padding fluide borné par la hauteur de la barre de langue
(28 à 34px). `.file-bloc` reçoit la même surface, le même rayon, `--bord` et un
débordement masqué ; `.file-tete` est sur une seule ligne, à la hauteur de la
barre de langue des blocs de code.

**Le curseur de frappe est supprimé.** `.diffusion-curseur` clignotait une fois
par demi-seconde devant chaque lecture, et une animation infinie n’est jamais
décorative. Le fait que le texte arrive progressivement suffit, et l’état
« En cours » est porté par la carte d’action.

### 4.6 Espacement et carte d’action (`es`)

**Une seule échelle d’espaces**, base 4px : `--espace-1` (4px),
`--espace-2` (8px), `--espace-3` (12px), `--espace-4` (16px). Plus aucune
marge de flux écrite en valeur isolée.

| Rythme | Règle |
|---|---|
| entre deux blocs de même nature | `.bubble > * + *` → `--espace-3` |
| autour d’une carte d’action | `--espace-2` (elle encadre le texte, elle n’en est pas un morceau) |

**Une seule carte d’action.** `.trace-cmd*` et `.exec-terminal*` décrivaient
le même événement — une commande exécutée — avec deux formes. La carte ne
s’insère plus dans le `<pre>` du bloc `athena-exec`, et ce bloc est masqué :
l’événement apparaissait deux fois à l’écran.

Sous-éléments : `.action-tete`, `.action-sortie`, `.action-etat`. La carte
est un `details` replié par défaut, en retrait d’une colonne, bordure gauche
fine — elle ne se mélange pas au texte, elle s’y rattache.

**La sortie** : mono 0.8rem, fond unique `--fond-code-bloc`, un seul padding,
hauteur maximale 180px avec défilement interne. La troncature compte des
**lignes**, pas des caractères, et marque « … N lignes masquées ».

**Un seul vocabulaire d’états** : `En cours`, `Réussi`, `Échec`, écrits une
fois (`ETATS_ACTION`). Auparavant coexistaient « succès », « code=0 », « ok »
et « ✓ » — quatre façons de dire la même chose.

**Trois pièges de cascade rencontrés sur la sortie :**

1. `.md pre` a une spécificité (0,1,1) supérieure à `.action-sortie` (0,1,0) :
   le corail réservé au modèle écrasait `--texte`. Le sélecteur est qualifié
   `.md .action-sortie` (0,2,0).
2. `--fond-code-bloc` n’était déclaré QUE dans `:root` (sombre). En thème clair
   il héritait de `#0d0d0d` — un aplat quasi noir sur une page blanche. C’est
   exactement le piège « un jeton absent d’un thème hérite de l’autre et se
   trompe sans bruit ».
3. `--danger-texte` vaut `#f1f1f1` en thème sombre, **identique à `--texte`**
   (17,21:1). L’erreur n’avait donc aucun signal : elle s’affichait comme une
   sortie réussie. Le fichier déclare deux blocs `:root` qui se disputent les
   mêmes jetons ; le second écrase la valeur.

Mesures : sortie réussie `#171717` sur `#f6f6f6` (16,59:1) en clair, `#f1f1f1`
sur `#0d0d0d` (17,21:1) en sombre. Erreur `#8f1d1d` sur `#f6f6f6` (8,23:1) en
clair, `#ff756a` sur `#0d0d0d` (7,41:1) en sombre.

### 4.5 Bordure de focus et mention (`eq`)

| Élément | Règle | Mesure |
|---|---|---|
| `.saisie`, `.saisie-mirror` | `padding: 5px` — valeur identique sur les deux | `5px` mesuré sur les deux |
| `.composeur-carte:focus-within` | `border-color: #c7c7c7` — **une seule valeur, les deux thèmes** | repos `#e4e4e4` / `#3d3d3d`, focus `#c7c7c7` partout |
| `.composeur-pied > span` | `width: 100%`, `text-align: center` | mention `503..1239`, boutons `503..1239` — bords au pixel |

**Le jeton `--bord-actif` a été supprimé des deux thèmes.** Il était déclaré
avec deux valeurs différentes (`#6b6b6b` clair, `#8a8a8a` sombre) alors qu’il
ne représente qu’un seul état : la bordure au focus. Un jeton décliné par thème
ne peut pas désigner un état commun. La valeur est écrite une fois dans la règle
de focus.

**« Centré » et « aligné » ne sont pas la même chose.** Les centres de la
mention et du groupe de boutons ne différaient que de 1px : ils étaient déjà
centrés. Ce qui se voyait, c’était que la mention faisait 323px et les boutons
736px — deux rectangles de largeurs différentes se superposent, et ça se lit
même quand leurs centres coïncident. L’alignement se juge aux bords.

### 4.4 Le composeur, trois géométries (`ep`)

| Élément | Avant | Après |
|---|---|---|
| `.saisie-zone` / `.saisie` | zone 34px, `textarea` 24px → **10px de vide sous le texte** | les deux à **34px**, vide nul |
| `.composeur-pied > span` | en haut du pied (`offset` 0px) | en bas (`offset` 34px), `margin-top: auto` |
| bordure au repos | invisible (`border: none` du chantier `dx`) | `#e4e4e4` clair / `#3d3d3d` sombre |
| bordure au focus | — | `#6b6b6b` clair / `#8a8a8a` sombre (`--bord-actif`) |

**Le vide sous le texte n’était pas un problème de CSS.** La hauteur du
`textarea` est posée **en ligne** par `ajusterSaisie()` en JavaScript
(chat-demo.js), avec la formule `scrollHeight - 10`. Ce `- 10` compensait
un `padding: 10px 0` qui avait été mis à zéro pour centrer le texte : le
calcul retirait alors 10px de hauteur réellement vue. Cinq tentatives CSS
(`align-items`, `align-self`, `height: 100%`, `flex: 1`, `padding`) ont
échoué — aucune ne pouvait gagner contre un style en ligne. C’est la formule
qui a été corrigée, pas la mise en page.

**`margin-top: auto` ne fonctionnait pas en ligne.** `.composeur-pied` est un
`display: flex` sur une rangée unique : la marge verticale d’un enfant y est
ignorée. Le pied est devenu une colonne explicite, et la position de la
mention vient d’un `order: 1` plus un `margin-top: auto` — qui, lui, fonctionne
en colonne.

**La bordure était annulée par `border: none`**, posé par le chantier `dx`
avec le commentaire « le composeur n’est plus cadré ». Ce n’était pas une
règle concurrente de plus : c’était la cause racine. Retiré.

Piège de mesure : la page s’ouvre **avec le champ déjà focalisé**, donc lire
« la bordure au repos » après un clic mesurait en réalité la bordure au focus.
Les deux mesures se confondaient, et le jeton `--bord-actif` semblait
s’appliquer en permanence. Il faut sortır le focus avant toute lecture du
repos.

### 4.3 Carte de saisie et icônes (`eo`)

| Élément | Règle | Mesure |
|---|---|---|
| `.composeur-carte` | `border: 1px solid var(--bord)`, `:focus-within` → `var(--bord-fort)` | `rgb(228,228,228)` clair / `rgb(80,80,80)` sombre |
| `.saisie` | `padding: 0`, zone en `align-items: center` | texte aligné sur les deux icônes |
| `.hud-plan` | `top: calc(var(--header-h) + 10px)` | écart de 10px sous l’en-tête |
| `.btn-attacher`, `.btn-envoyer` | `color: var(--icone)` | noir en clair (21:1), blanc en sombre (16,78:1) |

Le jeton `--icone` est déclaré dans les **deux thèmes** : `#000000` en clair,
`#ffffff` en sombre.

Il n’existe **plus** de règle `html[data-theme="light"] .btn-envoyer`.
Sa spécificité (0,2,0) battait la règle de base (0,1,0) : l’icône d’envoi
restait grise en clair pendant que celle d’attacher devenait noire. Deux
icônes, même état, même couleur.

Le centrage de `.saisie` ne portait pas sur le `textarea` : la zone, le bouton
d’attache et le bouton d’envoi étaient déjà alignés à 10px du bord haut. C’est
le **texte** qui était décalé, par son propre `padding: 10px 4px 0`. Le
padding à zéro rend le bloc de texte superposable à la zone ; le miroir reçoit
la même correction, sinon un pixel d’écart se voit en surimpression.

### 4.2 Hauteurs et rayons fluides

| Jeton | Valeur | Rôle |
|---|---|---|
| `--header-h` | `clamp(48px, 6vh, 64px)` | hauteur de l'en-tête |
| `--composeur-pad` | `clamp(8px, 1.2vh, 14px)` | respiration verticale du composeur |
| `--rayon-fluide` | `clamp(14px, 1.2vw, 20px)` | rayon de la carte et du plan |
| `--colonne-max` | `780px` | largeur commune : bulles, carte, plan |

`flex-shrink: 0` sur `.chat-tete` est **obligatoire**, pas décoratif :
`.chat-shell` est un `flex-direction: column`, et sans lui une conversation
longue comprime l'en-tête de 54px à 21px. La mesure l'a montré, la relecture du
fichier ne l'aurait pas montré.

---
## 5. Profondeur

**Une seule ombre** : `--ombre`. Deux valeurs coexistent —
`0 2px 6px rgba(0,0,0,.5), 0 12px 30px rgba(0,0,0,.4)` (médias) et
`0 8px 24px rgba(0,0,0,.28)` (bloc 3). Aucune hiérarchie de hauteur : l'ombre
ne sert qu'à décoller.

La profondeur réelle est le **z-index**, sur une échelle explicite de 11 rangs :

| Jeton | Valeur | Usage |
|---|---|---|
| `--z-base` | 0 | saisie et miroir |
| `--z-dans` | 1 | `.saisie` au-dessus de son miroir |
| `--z-eco-echo` | 3 | écho de clic, capture d'image |
| `--z-collant` | 5 | en-tête collant |
| `--z-pastille` | 6 | pastille de progression |
| `--z-toast` | 8 | corps de toast |
| `--z-voile` | 20 | voiles, HUD paramètres |
| `--z-menu` | 30 | barre latérale mobile |
| `--z-toast-hud` | 40 | panneau flottant HUD fichier |
| `--z-hud` | 60 | panneaux HUD |
| `--z-modale` | 65 | modales, HUD des paramètres |

État actuel : **19 usages par jeton, 0 valeur en dur.**

---

## 6. Typographie

- **Police** : `"Inter", var(--font-geist-sans, system-ui), -apple-system,
  "Segoe UI", Roboto, "Noto Sans", "Liberation Sans", Arial, sans-serif`.
  Une seule famille pour tout. Le code utilise `--mono`.
- **Base** : `font-size: 16px` sur `body`, déclaré explicitement.
- **Échelle** : **37 valeurs distinctes**, de `0.58rem` à `1.35rem`.

| Niveau | Valeurs | Usage |
|---|---|---|
| Micro-libellé | 0.58 – 0.68rem | langue de `.code-lang`, badges |
| Libellé | 0.7 – 0.78rem | boutons, méta, extensions |
| Texte secondaire | 0.82 – 0.9rem | résumés, aperçus |
| Corps | 0.92 – 1.02rem | texte courant des bulles (`0.9375rem`) |
| Titre | 1.05 – 1.35rem | titres de vues |

C'est trop de valeurs : une échelle de 6 à 8 niveaux suffirait, et 37 tailles
distinctes rendent l'harmonie impossible à garantir.
- Nombres changeants (horloge d'une conversation) : `tabular-nums`.

---

## 7. Points de rupture

| Largeur | Comportement |
|---|---|
| ≥ 941px | barre latérale + plan |
| 940px | bascule de la barre latérale, `--hud-largeur` reserve de la place |
| 760px | ajustements de plan |
| 721px | seuil `min-width: 721px` — bascule inverse |
| 720px | une colonne |
| 600px | composeur resserré |
| 480px | contrôles en icône seule |

Media sans largeur : `prefers-color-scheme: dark` (inerte, §2) et
`prefers-reduced-motion: reduce`.

`--pos-sidebar-largeur: 300px` — **écart notable** : la largeur réelle de la
barre latérale est de 280px, la variable en annonce 300.

### 7.1 Cadre de la conversation — deux jetons, pas des mesures

| Jeton | Valeur | Ce qu'il règle |
|---|---|---|
| `--colonne` | `780px` | la largeur du **cadre** : `.row.bot`, `.row.user`, `.composeur-carte`, `.composeur-modele`, `.hud-plan` |
| `--marge-page` | `24px` | le retrait horizontal **partagé** de `.chat-tete`, `.msgs` et `.composeur` |
| `--composeur-pied` | `744px` | **exception** : la barre d'outils sous le champ |

Le fichier portait six largeurs concurrentes pour une seule zone — `880px`,
`900px`, `920px`, `744px`, et `780px` en dur à deux endroits — plus trois paires
de marges différentes (`24px`, `32px`, `58px`). Le composeur et le fil
partageaient le même cadre mais ne s'alignaient pas dessus.

Une seule largeur, un seul retrait : c'est la règle. Un nombre écrit en dur dans
une règle de composant est un défaut, pas une variante.

**Une exception assumée : `--composeur-pied` (744px).** Le pied aligné sur
`--colonne` avait pushed ses deux boutons de 18px vers la gauche. Le pied est une
barre d'outils, pas le cadre de rédaction, et son contenu est plus étroit que la
carte du champ. L'exception est écrite, pas subie.

---

## 8. Mouvement

**10 animations**, toutes signalatrices d'état :
`apparait`, `diffusion-clignote`, `fondu`, `hnav-pulse`, `hud-entree`, `monte`,
`plan-pulse`, `pulse`, `think-pulse`, `tourne`.

`prefers-reduced-motion` n'apparaît que **2 fois** dans le fichier. Une
interface doit, pour l'accessibilité doit neutraliser chaque
animation explicitement, pas seulement deux d'entre elles.

---

## 9. Contrôle et survol

**RÉVISÉE le 2026-10-07 (`en`).** La règle d'origine disait : *un contrôle
sans dossier n'est pas un bouton* — `#btn-fichiers`, `#btn-navigateur`,
`#btn-reglages`, `#btn-contexte` étaient transparents, la surface
n'apparaissant qu'au survol.

**Elle ne tient plus.** Les trois boutons de la barre d'outils (Fichiers,
Navigateur, Partager) partagent une base unique :

| Propriété | Valeur |
|---|---|
| `border` | `1px solid var(--bord)` — **visible dans les deux thèmes** |
| `background` | `var(--surface)` |
| `color` | `var(--texte-doux)` |
| survol | fond `--primaire-doux`, filet `--bord-fort`, texte `--texte` |

Un bouton transparent à filet invisible disparaissait dans le fond blanc.
La distinction se fait désormais par la **surface de survol**, pas par
l'absence de filet. Mesure : 6,19:1 le texte en clair, 7,74:1 en sombre.

Les zones qui gardent un fond nul et aucune bordure : `.saisie-zone`,
`.chat-tete`, `.composeur-carte`, `.hud-plan`, `.file-preview`.

Les zones sans fond, par décision : `.saisie-zone`, `.chat-tete`,
`.composeur-carte`, `.hud-plan`, `.file-preview`. Bordures conservées.

Une action destructive est nommée, jamais seulement colorée :
`aria-label="Supprimer « Test 3 »"`.

---

## 10. États dans le DOM — obligation

Un état qui change doit exister comme **élément**, pas comme glyphe dans une
chaîne. Règle tirée d'un défaut mesuré : un fichier en échec était
visuellement identique à un fichier indexé.

```
nom · taille · ✓ indexé · 4 seg. · ⚠ texte non lisible    ← avant
[PNG] photo.png [indexé]                                    ← après
```

Corollaires :

- une information utile porte son **badge** ;
- on n'annonce jamais un contenu qu'il n'y a pas : un fichier indexé dont le
  texte n'est pas lisible porte un avertissement distinct ;
- un état dans un panneau doit être atteignable au clavier (voir `.convo-actions`
  : `role="menu"`, flèches, Échap).

---

## 11. Défauts relevés

Ce sont les points à trancher. Ils sont mesurés, pas supposés.

### 11.1 Couleurs en dur : ~190 reste

Les 23 littéraux identiques à `--texte` / `--texte-doux` **dans les blocs
`data-theme="light"`** ont été remplacés (26 lignes). Le thème clair est
désormais 100 % tokenisé.

Restent des littéraux dans des composants **sans jeton** :

| Valeur | Occurrences | Où |
|---|---|---|
| `#e8e8e8` | 11 | groupe d'activité, HUD |
| `#3a3a3a` | 11 | idem |
| `#9e9e9e` | 7 | traces de commandes |
| `#a9a9a9` | 6 | districts |
| `#f2f2f2` | 6 | boutons |
| `#616161` | 6 | — |
| `#292929` | 5 | — |
| `#ededed` / `#e2e2e2` / `#eeeeee` / `#f1f1f1` | 5 chacun | — |
| `#171717` | 3 | 1 déclaration + 2 commentaires |
| `#bdbdbd`, `#a7a7a7`, `#262626`, `#111111` | 4 / 4 / 1 / 7 | — |

### 11.2 La media query sombre est inerte

Bloc 2 (L133) est écrasé par bloc 3 (L3316). Corriger une couleur dans la media
query ne change rien à l'écran. Corriger dans le bloc 3, oui.

### 11.3 Six palettes se chevauchent

Blocs 1, 2, 3, 4 et 5.redéfinissent `--primaire`, `--texte`, `--bord`… La
couleur effective est celle du dernier bloc qui parle, dans l'ordre du
fichier. `:root` (L26) est en grande partie inerte.

### 11.4 Règles qui se contredisent

`.chat-tete` : trois règles, à 2 600 lignes d'écart, dont deux remettaient fond
et bordure. Deux autres règles remettaient `background: #171717` sur un fond
sombre — contraste mesuré **1,08:1**, texte invisible. Les avoir corrigées en
amont n'aurait rien changé à l'écran.

`.composeur-carte` : trois règles, la cascade ne se comportait pas comme la
lecture le laissait croire.

### 11.5 Sélecteurs morts

`.side` ne désigne **rien** (la classe est `.sidebar`) : une règle inerte, avec
une variable correctement définie à côté. Invisible à la relecture, visible à
la mesure.

`.file-chip-meta`, `.file-chip-etat`, `.file-chip-alerte` : 8 règles pour des
classes qu'aucun élément ne porte plus.

### 11.6 `--pos-sidebar-largeur` : 300px annoncés, 280px réels

### 11.7 `prefers-reduced-motion` : 2 occurrences pour 10 animations

### 11.8 Typographie : 37 tailles, 15 rayons littéraux

### 11.9 Contrastes mesurés

| Paire | Ratio | Verdict |
|---|---|---|
| `#ea553c` sur `#0d0d0d` (bloc) | 5,43:1 | ✓ |
| `#ea553c` sur `#1a1818` (encadrement) | 5,43:1 | ✓ |
| `#f2f2f2` sur `#454242` (Partager) | 8,89:1 | ✓ |
| `#ffffff` sur `#f7f7f7` (barre latérale, clair) | 1,10:1 | **côté texte** |

---

## 12. Ce que cette charte ne couvre pas

- Les proportions du fil de discussion : elles sont pilotées par le plan, et le
  plan est un cadrage, pas un style.
- La largeur du HUD latéral (`--hud-largeur`, 640px par défaut, réglable).
- La consolidation des 190 littéraux et des 6 palettes : chantiers à part, avec
  vérification visuelle par cluster sur les deux thèmes.

---

## Annexe — décisions en attente

Aucune de ces décisions n'a été tranchée. Les corrections du 2026-10-07 (`ei`,
`ej`) ont été limitées aux défauts qui étaient **mesurables**, et ont laissé
de côté tout ce qui relevait d'un choix.

Les quatre points du §11 « à consulter » ont été **tranchés explicitement** le
2026-10-07 (`ej`), et ne sont donc plus en attente :

- **Partager** : bordure noire en thème clair, conservée en sombre.
- **Contour du champ** : supprimé dans les deux thèmes.
- **Bulle du modèle** : blanc pur en thème clair, inchangée en sombre.
- **Pied du composeur** : largeur propre via `--composeur-pied` (744px).

Restent ouverts :

1. `--bubble-max` (576px) est une valeur distincte de `--colonne` (780px). La
   bulle est plus étroite que le cadre pour que les lignes restent courtes.
2. `--code-fond` s'inverse entre les thèmes : le garder pour quoi ?
3. Faut-il conserver la media query sombre, ou tout porter dans les blocs 3 et 5 ?
4. Réduire les 37 tailles de police à une échelle de 6 à 8 ?
5. Regrouper les 15 rayons littéraux sur les 3 jetons ?
6. Nettoyer les règles mortes et contradictoires du §11.4 et §11.5 ?