# Charte graphique — Athena

Cette charte décrit **ce que fait réellement le CSS**, pas une intention. Chaque
valeur ci-dessous a été relevée dans `design/athena-demo.css`. Les écarts sont
signalés comme tels : une charte qui ment sur le code est pire qu'aucune charte.

Fichier de référence unique : `design/athena-demo.css`.
`docs/design/athena-demo.css` est un **miroir généré** (`node tools/prepare-assets.js`),
ignoré par git. On n'écrit jamais dedans.

---

## 1. Intention

Un instrument de travail, pas un produit grand public. Dense, sobre, sans
effet. L'interface doit disparaître derrière la tâche : le fil de discussion et
le plan de raisonnement sont le contenu, pas la décoration.

Corollaire : **aucune animation n'est décorative**. Les seules animations
existantes signalent un état réel (diffusion, progression, chargement).

---

## 2. Couleur

### 2.1 Le thème est monochrome — c'est un choix, pas une économie

Le thème principal ne contient **aucune couleur de statut** : pas de vert
« succès », pas d'ambre « alerte », pas de rouge « erreur ». Tout passe par le
noir, les gris et la **graine** (épaisseur de trait, fond, apostrophe).

`--danger-fond / --danger-bord / --danger-texte` sont eux-mêmes gris : le
danger est signalé par le contraste, pas par le rouge.

Conséquence à respecter : **un état ne se code pas par une teinte.** Quand une
functionalité demande de distinguer des états, le faire par la graine. C'est ce
qui tient en thème clair comme en thème sombre, et c'est accessible aux daltonismes.

> Écart à surveiller : `html[data-theme="light"]` et `prefers-color-scheme: dark`
> redéfinissent les mêmes noms de tokens. Toute couleur en dur casse l'un des
> deux, silencieusement.

### 2.2 Tokens (noms exacts)

| Groupe | Tokens | Rôle |
|---|---|---|
| Texte | `--texte`, `--texte-doux` | courant, secondaire |
| Bordures | `--bord`, `--bord-fort` | séparation, séparation appuyée |
| Danger | `--danger-fond`, `--danger-bord`, `--danger-texte` | échec, refus |
| Alerte | `--ambre-fond`, `--ambre-bord`, `--ambre-texte` | avertissement |
| Neutre | `--gris-fond`, `--gris-bord`, `--gris-texte` | surfaces inertes |
| Code | `--code-fond` | blocs de code |
| Surfaces | `--carte`, `--primaire`, `--primaire-doux`, `--primaire-texte`, `--heros` | cartes, accent |
| Effet | `--ombre` | ombre unique, en deux couches |

**Règle** : aucune couleur littérale dans une règle. Passer par un token. Un
littéral est un bug latent — il ne suit ni le thème, ni le contraste, ni le
mode sombre. (Lot traité : `.btn-fichiers`, 4 littéraux supprimés.)

### 2.3 Accent couleur

L'accent n'existe pas sous forme de « bleu de marque ». Les points d'accent
sont obtenus par le contraste de graine. C'est cohérent avec 2.1 : on ne
surtint pas un état pour lui donner plus d'importance.

---

## 3. Typographie

- Une seule famille, héritée. Aucune police de marque.
- Échelle courte, en `rem`. Les corps de texte du fil sont en `rem` afin de
  suivre le zoom utilisateur ; les libellés compacts descendent à `0.66rem`.
- Les libellés d'en-tête sont en capitales avec `letter-spacing` léger et
  `font-weight: 700`.
- Les nombres qui changent en continu (horloge d'une conversation, compte de
  segments) sont en `font-variant-numeric: tabular-nums`, pour ne pas sautiller.

---

## 4. Rayons

Trois valeurs, une seule échelle, aucune exception :

| Token | Valeur | Usage | Occurrences |
|---|---|---|---|
| `--rayon-s` | 8px | petits contrôles, puces, badges | 25 |
| `--rayon` | 12px | cartes, champs | 14 |
| `--rayon-l` | 16px | grandes surfaces, panneaux | 7 |

Un rayon hors de ces trois valeurs est à considérer comme une erreur.

---

## 5. Profondeur

**L'ombre est unique** : `--ombre`, deux couches, basse opacité. Il n'existe
pas de « niveau 2 » ou « niveau 3 » d'ombre. L'ombre ne sert pas à créer une
hiérarchie de hauteur, seulement à décoller un élément du fond.

La profondeur qui compte est le **z-index**, et il est explicite :

| Token | Valeur | Rôle |
|---|---|---|
| `--z-base` / `--z-dans` | 0 / 1 | saisie et son miroir |
| `--z-eco-echo` | 3 | écho de clic, capture d'image |
| `--z-collant` | 5 | en-tête collant |
| `--z-pastille` | 6 | pastille de progression |
| `--z-toast` | 8 | corps de toast |
| `--z-voile` | 20 | voiles de modale |
| `--z-menu` | 30 | barre latérale mobile |
| `--z-toast-hud` | 40 | panneau flottant HUD fichier |
| `--z-hud` | 60 | panneaux HUD |
| `--z-modale` | 65 | modales, bandeau interprète |

**Règle** : un `z-index` passe toujours par un token. Un nombre en dur est une
régression.

> **État vérifié** : 19 usages par token, **0** nombre en dur. Le seul
> contrevenu — un `z-index: 400` posé sur le menu d'actions des conversations —
> a été remis dans l'échelle (`--z-toast-hud`). Il était resté invisible parce
> qu'un seul `z-index` en dur sur tout le fichier ne se remarque pas au judgement : il
> faut le compter, pas le relire.

---

## 6. Points de rupture

| Largeur | Comportement |
|---|---|
| ≥ 940px | barre latérale visible, plan sur 768px |
| 721–940px | barre latérale masquée, plan ajusté |
| ≤ 720px | une colonne |
| ≤ 600px | composeur resserré |
| ≤ 480px | contrôles en icône seule |

`@media (hover: none)` est traité à part des largeurs : c'est le tactile. Un
contrôle sans survol doit rester identifiable, donc les actions de conversation
sont dans un panneau plutôt qu'au survol — sinon elles n'existent pas au doigt.

---

## 7. Mouvement

- `@media (prefers-reduced-motion: reduce)` est traité de façon exhaustive : les
  animations deviennent des fondus courts, jamais des durées nulles soudaines.
- Le défilement automatique est une fonction d'utilité, pas un effet : il ne se
  produit que si l'utilisateur est déjà en bas du fil.
- Animations existantes, toutes signalatrices d'état. Relevé exhaustif :
  `apparait`, `diffusion`, `fondu`, `hnav`, `hud`, `monte`, `plan`, `pulse`,
  `think`, `tourne`. Toute autre animation est à ajouter ici en même temps
  qu'elle est écrite.

---

## 8. Contrôle et survol

Règle issue de la correction de `.btn-fichiers` : **un contrôle qui n'a pas de
dossier n'est pas un bouton.** Les commandes de la barre de titre sont
transparentes ; la surface n'apparaît qu'au survol et au focus.

Une action destructive est identifiée par sa forme, pas seulement par sa
couleur : icône + infobulle + `aria-label` nommant l'objet (« Supprimer
« Test 3 » »).

---

## 9. États — obligation de forme

Chaque contrôle qui change d'état expose cet état **dans le DOM**, pas dans une
chaîne de caractères. C'est la règle qui a été appliquée à l'import de
fichiers, où l'état était collé au nom :

```
capture.png · 50 Ko · échec : extraction impossible
```

Un fichier en échec y était indiscernable d'un fichier indexé. La forme
obligatoire est un **badge** : icône dedicated, tonale par la graine,
lisible par un lecteur d'écran, tronquable proprement.

Corollaire : ne jamais announce un contenu qu'il n'y a pas. Un fichier indexé
dont le texte n'est pas lisible porte un badge d'avertissement **distinct** de
son état — sinon on annonce du vide comme du plein.

---

## 10. Ce que cette charte ne couvre pas

- Les proportions exactes de l'écran de conversation : elles sont pilotées par
  le plan, et le plan est un cadrage, pas un élément de style.
- Les règles `light` redéclarées une par une : elles devraient不作 miroir
  automatique des tokens. C'est une dette ouverte.
- La consolidation des couleurs littérales restantes : ouverte.

---

## Annexe — dettes connues

Ces points sont relevés, pas traités. Les lister ici vaut mieux que de les
faire passer pour des décisions.

1. **Littéraux de couleur** subsistant hors de `.btn-fichiers`.
2. **`html[data-theme="light"]`** : les mêmes noms de tokens sont redéfinis à la
   main dans plusieurs blocs. Toute divergence est invisible à la lecture.
3. **Consolidation des couleurs** : l'échelle est plus petite que l'usage.
4. **Fonctions longues et globales** : découpage non fait.