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
| `--fond-chat` | `#1f1d1d` | `#ffffff` | `.chat-shell`, toute la conversation |
| `--fond-msgs` | `#211f1f` | `#fafafa` | `.msgs`, le fil défilant |
| `--fond-row` | `#1f1d1d` | `#f4f4f4` | `.row.bot`, un cran au-dessus |
| `--fond-side` | `#141414` | `#f7f7f7` | `.sidebar` entière |
| `--fond-side-pied` | `#141414` | `#f2f1f0` | `.side-pied` |
| `--fond-share` | `#454242` | `#454242` | bouton Partager |
| `--fond-share-survol` | `#555250` | `#555250` | son survol |
| `--fond-partage-texte` | `#f2f2f2` | `#f2f2f2` | texte de Partager |

Ces huit-là sont les seuls à porter une valeur identique dans les deux thèmes :
le bouton Partager doit rester lisible sur les deux (§11).

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

Règle issue de corrections réelles : **un contrôle sans dossier n'est pas un
bouton.** `#btn-fichiers`, `#btn-navigateur`, `#btn-reglages`, `#btn-contexte`
sont transparents ; la surface n'apparaît qu'au survol et au focus.

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

1. Quelle palette pour `.row.bot` : `--fond-row` (`#1f1d1d`) ou aucun fond ?
2. `--code-fond` s'inverse entre les thèmes : le garder pour quoi ?
3. Faut-il conserver la media query sombre, ou tout porter dans les blocs 3 et 5 ?
4. Réduire les 37 tailles de police à une échelle de 6 à 8 ?
5. Regrouper les 15 rayons littéraux sur les 3 jetons ?
6. Nettoyer les règles mortes et contradictoires du §11.4 et §11.5 ?