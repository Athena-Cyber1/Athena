# Changelog — Athena


---

## 2026-10-08 — commentaires déplacés du CSS

1 bandeaux décoratifs supprimés. 39 commentaires de justification réduits à une ligne. Le CSS dit QUOI ; ce fichier dit POURQUOI. Aucun raisonnement n est perdu : le texte d origine est ci-dessous.

### sans étiquette — =======================================================================…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* ==========================================================================
   Athéna — design MONOCHROME (demande explicite de l'utilisateur) :
   mode clair = blanc & noir, mode sombre = noir & blanc.
   Le ROUGE est réservé aux liens (--lien). Zéro émoji : icônes SVG inline
   (traits currentColor) + typographie sobre.
   Les variables ci-dessous sont les tokens consommés par l'importeur de
   design (/api/design + theme-loader.js) : un thème importé les redéfinit.

   CARTE DES COUCHES (la source l'emporte à spécificité égale) :
   1. :root clair + @media prefers-color-scheme: dark (tokens)
   2. base + composants (ordre : sidebar, en-tête, fil, bulles, cartes,
      composeur, modales, paramètres)
   3. @media (max-width: 940px / 600px / 480px) (responsive)
   4. patch sombre (surfaces codées pour le thème par défaut)
   5. @media (min-width: 721px) (cadrage 768 px — GAGNE TOUJOURS sur desktop)
   6. html[data-theme="light"] (surcharges du mode clair)
Règles collectives : bordures neutres = --bord/--bord-fort (jamais de
    hex en dur) ; rayons = --rayon-s/--rayon/--rayon-l ; ombres = --ombre ;
    z-index : ÈCHELLE NOMMÈE (plus de nombres en dur) —
      --z-dans (saisie, en-tête, pastille), --z-voile, --z-menu (menus),
      --z-toast (toasts), --z-hud (panneaux HUD + voile modale), --z-modale
      (modales et bandeau d'interpréteur).
   Accessibilité : :focus-visible global (anneau 2px, rayon préservé),
   cibles ∥ 24 px, contrastes texte ∥ 4.5:1 vérifiés (voir ARCHITECTURE §9).
   ========================================================================== */
```

</details>

### v20261007 (dz) : fond d — v20261007 (dz) : fond de bloc de code, SOMBRE dans les deux…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dz) : fond de bloc de code, SOMBRE dans les deux thèmes.
     `--code-fond` ne convient pas ici : il passe à #f4f4f4 en thème clair.
     Or un bloc de code doit rester une surface sombre même sur fond clair —
     c'est ce qui distingue du texte, et c'est ce que fait tout le monde. Ce
     jeton n'est volontairement PAS redéfini dans le bloc clair : c'est le seul
     moyen de garantir qu'il reste sombre. */
```

</details>

### v20261007 (ea) : l'ENCA — v20261007 (ea) : l'ENCADRAGE du code en ligne est distinct du…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (ea) : l'ENCADRAGE du code en ligne est distinct du fond des
     BLOCS. Un `code` posé dans une phrase est une marque en ligne ; un `pre`
     est une surface. Leur donner le même noir aplati faisait disparaître la
     différence entre « un mot en code » et « un bloc ». Le fond de l'encadrement
     est ici plus doux que celui des blocs, et son texte reste #ea553c. */
```

</details>

### v20261007 (dx) — SURFAC — v20261007 (dx) — SURFACES DE ZONE, en variables.

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dx) — SURFACES DE ZONE, en variables.
     Elles manquaient, et c'est pourquoi les couleurs étaient écrites en dur
     dans les règles : sans jeton, un littéral est le seul moyen d'exprimer une
     surface de zone. Conséquence observée : changer la couleur d'une zone
     imposait d aller chercher la valeur dans le CSS, et le thème clair ne
     pouvait pas la suivre — il ne savait pas quoi surcharger.
     Chaque surface a donc son jeton, avec son opposé en thème clair déclaré
     dans le bloc `html[data-theme="light"]` plus bas. */
```

</details>

### v20261007 (ea) : la zon — v20261007 (ea) : la zone de conversation et la barre latérale…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (ea) : la zone de conversation et la barre latérale ont deux
     valeurs distinctes. `.chat-shell` est le conteneur de conversation ; il
     était resté sur `--fond`, si bien que la couleur demandée pour l'écran
     principal n'était appliquée nulle part. `--fond-side` couvre TOUTE la
     barre latérale, pied compris. */
```

</details>

### v20261007 (dh) — ÈCHELL — v20261007 (dh) — ÈCHELLE DE Z-INDEX NOMMÈE.

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dh) — ÈCHELLE DE Z-INDEX NOMMÈE.
   Les valeurs étaient posées en dur et dispersées (0, 1, 3, 5, 6, 8, 20, 30,
   40, 60, 65) : impossible de vérifier si deux couches se chevauchent sans les
   compter à la main, et un ajout « au feeling » pouvait passer sous une
   modale. Chaque rangée est nommée. ATTENTION : chaque token vaut EXACTEMENT la
   valeur qu'il remplace — un `--z-dans` valant 3 alors que l'ancien 3 meant
   autre chose dégraderait l'empilement sans qu'on le voie au premier rendu. */
```

</details>

### sans étiquette — ———— Réglages de position (modifiez ici) ———— Largeur + décalages de la…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* ———— Réglages de position (modifiez ici) ————
     Largeur + décalages de la sidebar : une seule valeur à changer.
     `width` et `flex-basis` suivent --pos-sidebar-largeur ; la marge du
     mode « fermé » en est calculée ; `translateX` du voile mobile est
     piloté par --pos-sidebar-cachee / --pos-sidebar-ouverte. */
```

</details>

### v20261007 (dw) : police — v20261007 (dw) : police de base à 16px. Elle n'était fixée…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dw) : police de base à 16px. Elle n'était fixée nulle part, donc
     la racine restait à la valeur par défaut du navigateur (16px) — mais rien
     ne l'assurait : un reset plus tard, un style hérité, ou un navigateur
     réglé autrement suffisait à décaler toute l'échelle. Elle est donc
     déclarée explicitement, en rem pour suivre le zoom de l'utilisateur. */
```

</details>

### v20261007 (dr) : les qu — v20261007 (dr) : les quatre boutons d'action d'une…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dr) : les quatre boutons d'action d'une conversation sont
   regroupés. Il ne reste donc qu'UNE cible cliquable sur la ligne (le bouton
   « trois points »), au survol ou au focus — plus quatre zones mortelles à
   côté du titre. Les actions vivent dans un panneau à part, donc elles ne
   sont plus positionnées dans le flux de la ligne. */
```

</details>

### v20261007 (dw) : pannea — v20261007 (dw) : panneau VERTICAL, icône + libellé. Quatre…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dw) : panneau VERTICAL, icône + libellé. Quatre icônes de 27 px
   alignées horizontalement sans texte étaient une devinette : rien ne
   distinguait « Exporter en Markdown » d'« Èpingler », et rien n'était lisible
   au doigt — le panneau ne s'ouvre pas au survol. En colonne, chaque action se
   nomme et la zone de toucher devient confortable. */
```

</details>

### v20261007 (dx) : plus d — v20261007 (dx) : plus de trait de séparation. L'en-tête était…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dx) : plus de trait de séparation. L'en-tête était déjà
     transparent, mais une bordure basse dessinait un cadre de plus entre la
     barre latérale et le fil — alors que le composeur, lui, gardait le sien.
     Les deux ensemble donnaient une interface fragmentée en trois bandes
     fermées. Ni l'un ni l'autre ne sépare rien : le fond du fil le fait. */
```

</details>

### v20261007 (dz) — L'ENCA — v20261007 (dz) — L'ENCADRAGE POUVAIT ÉTRE COUPÈ.

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dz) — L'ENCADRAGE POUVAIT ÉTRE COUPÈ.
     `.bubble` est un enfant flex de `.row`, et un enfant flex a par défaut
     `min-width: auto` : il refuse de descendre sous la largeur intrinsèque de
     son contenu. Un tableau large, une URL longue ou une ligne de code sans
     espace le pushing donc au-delà de son `max-width`, et la bordure passait
     hors du cadre visible — le « cadrage coupé ».
     `min-width: 0` rend la réduction possible ; `overflow-x: auto` fait
     défiler le débordement À L'INTÈRIEUR de la bulle au lieu de le laisser
     déborder. Le second ne suffit pas seul : sans le premier, rien ne
     rétrécit. */
```

</details>

### v20261007 (dz) : le BLO — v20261007 (dz) : le BLOC de code passe au fond sombre lui…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dz) : le BLOC de code passe au fond sombre lui aussi.
     `--code-fond` vaut #f4f4f4 en thème clair : le code en bloc y était donc
     CLAIR, alors que le code en ligne venait d'être rendu sombre. Deux
     traitements pour la même chose dans une même bulle. Un bloc de code est
     une surface sombre dans les deux thèmes — c'est ce qui le distingue du
     texte. */
```

</details>

### v20261007 (dy) — HUD DE — ---------- v20261007 (dy) — HUD DES PARAMÇTRES ---------- Les…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* ---------- v20261007 (dy) — HUD DES PARAMÇTRES ----------
   Les paramètres étaient une VUE : ils remplaçaient le fil (msgsEl.replaceChildren).
   Ils sont désormais superposés, conversation intacte derrière. Le voile n'est
   pas un simple fond — sans lui, cliquer hors du panneau ne fermait rien et
   la personne perdait le fil des ses propres réglages. */
```

</details>

### v20261007 (ea) : centré — v20261007 (ea) : centré sur la COLONNE DE CONVERSATION, pas…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (ea) : centré sur la COLONNE DE CONVERSATION, pas sur la
     fenêtre. En `position: fixed` + `left: 50%`, le panneau était centré sur le
     viewport — donc décalé à droite d'environ la moitié de la barre latérale,
     puisque la conversation commence après elle. Visuellement « pas centré »,
     alors que la mesure disait 700px sur 1400 : la mesure était juste, c'est
     la référence qui ne l'était pas.
     `.chat-shell` est en `position: relative`, donc `absolute` y donne le bon
     cadre. Le voile suit : il ne couvre que la conversation, la barre latérale
     reste utilisable derrière — ce qui est plus utile que de tout voiler. */
```

</details>

### v20261007 (ds) : la puc — v20261007 (ds) : la puce est faite d'un bloc (nom + méta +…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (ds) : la puce est faite d'un bloc (nom + méta + état) et du
   bouton de retrait. Avant, le nom, la taille et l'état tenaient dans UNE
   chaîne, si longue qu'elle débordait la ligne et que l'info utile — l'échec
   — arrivait hors du champ de vision. `.file-chip-corps` en colonne laisse le
   nom prendre la largeur et les badges rester lisibles. */
```

</details>

### v20261007 (dz) — la pas — v20261007 (dz) — la pastille d'EXTENSION remplace les badges…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dz) — la pastille d'EXTENSION remplace les badges d'état.
   `.file-chip-meta`, `.file-chip-etat` (et ses variantes ok / attente) et
   `.file-chip-alerte` ont été SUPPRIMÈS : plus aucun élément ne porte ces
   classes depuis que la puce ne montre ni libellé ni icône d'état. Les laisser
   aurait été du code mort — 8 règles pour rien, et un risque de « réparation »
   par quelqu'un qui croirait le badge encore utilisé. */
```

</details>

### v20261007 (di) — FIN DE — v20261007 (di) — FIN DE LA GUERRE DE SPÈCIFICITÈ.

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (di) — FIN DE LA GUERRE DE SPÈCIFICITÈ.
   `.modale-actions button` est (0,1,1) : une classe + un type. Les variantes
   `.modale-principal` / `.modale-danger` n'étaient que (0,1,0) — donc battues
   sur background, color et border — et il fallu dix `!important` pour
   forcer. On scope les variantes à leur conteneur réel
   (`.modale-actions button.modale-principal` = 0,2,1) : le conflit
   disparaît par la structure du sélecteur, pas par la force.
   chat-demo.js construit ces boutons en `actions.appendChild(ok)`, le parent
   `.modale-actions` est donc garanti ; et même sans lui, l'ordre de la cascade
   ne joue plus.
   Styles INCHANGÈS : vérifié par mesure des styles calculés avant/après
   (fond, texte, bordure, graisse, corps, interlettrage, casse, rayon). */
```

</details>

### sans étiquette — ————— HUD navigateur (v1.5) : DOCKÈ À DROITE, coquille du rendu —————…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* ————— HUD navigateur (v1.5) : DOCKÈ À DROITE, coquille du rendu —————
   Même mécanique que .interpreteur (L.~5034) : position fixed à droite,
   largeur --hud-largeur réservée en padding par .page-demo.hud-ouvert (la
   conversation se rétracte, jamais recouverte), poignée #navigateur-bord,
   en-tête + fermeture. Le CONTENU est la page du modèle.
   Le corps dimensionne l'IMAGE au plus près du cadre (width/height auto +
   max-*) : la boîte de l'img vaut alors exactement son rendu, ce qui rend
   le clic reconverti en coordonnée PAGE exact — un object-fit:cover ferait
   mentir la conversion. */
```

</details>

### sans étiquette — P3 — ÈCHO LOCAL : une image poussée arrive ~20-40 ms après le geste, et…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* P3 — ÈCHO LOCAL : une image poussée arrive ~20-40 ms après le geste, et
   pendant ce temps la surface a l'air MORTE (« ça ne réagit pas »). On montre
   donc tout de suite, en local, ce que l'agent confirmera juste après :
   `::after` = point de visée suivi du curseur (aussi fort à l'appui),
   `::before` = frappe en attente avant son envoi. Tout passe par des
   pseudo-éléments pilotés en variables CSS : le corps ne reçoit AUCUN nœud,
   il doit contenir UNIQUEMENT la page (contrat de test). */
```

</details>

### v20261007 (U1) : le bad — v20261007 (U1) : le badge est masqué AU REPOS et visible dès…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (U1) : le badge est masqué AU REPOS et visible dès qu'il porte une
   information (session ouverte, ou action du modèle en cours). Avant,
   `display:none !important` neutralisait aussi les deux règles ci-dessous :
   l'état de la navigation était donc invisible alors que c'est précisément ce
   que ce bouton doit montrer. Le texte reste alimenté par majBadgeNavigateur. */
```

</details>

### v20261007 (dx) : cette — v20261007 (dx) : cette règle remettait un fond opaque et une…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dx) : cette règle remettait un fond opaque et une bordure basse,
     plus bas dans le fichier que la règle qui les avait supprimées — donc
     prioritaire, et annulant purement et simplement la demande. Deux règles
     qui se contredisent sur le même sélecteur, à 2 600 lignes d'écart : c'est
     le genre de衝突 que seul un relevé permet de voir. */
```

</details>

### v20261007 (dx) : le com — v20261007 (dx) : le composeur n'est plus cadré. C'est ICI que…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dx) : le composeur n'est plus cadré. C'est ICI que se
     trouvait le vrai cadre — fond #2b2b2b, bordure et ombre — pas sur
     .saisie-zone comme je l'avais d'abord cherché : .saisie-zone est le champ
     à l'intérieur, .composeur-carte est la boîte qui l'englobe. Je n'avais
     donc dégagé que l'intérieur du cadre, en laissant l'enveloppe.
     Le fond devient transparent : sans lui, la zone de saisie — maintenant
     transparente elle aussi — se retrouverait posée sur la surface du fil.
     Les jetons remplacent au passage 3 littéraux (#2b2b2b, #777, rgba(255)). */
```

</details>

### v20261007 (dz) : le cad — v20261007 (dz) : le cadre du COMPOSEUR revient (fond, bordure,…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dz) : le cadre du COMPOSEUR revient (fond, bordure, ombre) —
     c'est le seul repère de la zone de saisie, et sans lui le champ flottait
     dans le vide. En revanche le CHAMP lui-même, .saisie-zone, reste
     transparent : le fond est sur l'enveloppe, pas sur le texte. Deux plans
     superposés, un seul visible. */
```

</details>

### v20261007 (dz) : fond S — v20261007 (dz) : fond SOMBRE et non plus rouge, texte #ea553c.

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dz) : fond SOMBRE et non plus rouge, texte #ea553c.
     Le fond et la bordure étaient #3a2525 / #65413d — un brun rouge, choisi
     pour « faire code ». Conséquence : sur une bulle sombre, un bout de code
     en clair était la zone la plus claire de la page et sautait aux yeux ; en
     thème clair, le texte #f0b0a5 sur #3a2525 passait à 4.0:1, sous le seuil.
     Fond sombre dans les deux thèmes, texte #ea553c : la teinte est conservée,
     elle porte sur le TEXTE et non sur le fond. */
```

</details>

### v20261007 (dh) — BOUTON — v20261007 (dh) — BOUTON UNIQUE modèle + effort + température.

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dh) — BOUTON UNIQUE modèle + effort + température.
   Les trois réglages partageaient trois boutons (plus contexte et journal)
   dans un pied de 744 px : le conteneur passait à la ligne, la mention
   d'avertissement flottait seule en haut et les commandes en bas, sans lien
   visuel. Un bouton unique porte les trois valeurs, séparées par un filet
   vertical, et un panneau unique regroupe les trois listes. */
```

</details>

### v20261007 (dx) : le com — v20261007 (dx) : le composeur n'est plus cadré. Le fond…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dx) : le composeur n'est plus cadré. Le fond (#181818 en dur)
     était le vrai cadre — plus visible que la bordure de 1px qu'il portait.
     D'où le passage par un jeton : sans lui, « transparent » aurait laissé
     remonter la couleur de la zone derrière, et le fond sombre du fil
     aurait déborde visuellement dans le champ de saisie. */
```

</details>

### v20261007 (dh) — COUVER — v20261007 (dh) — COUVERTURE EXHAUSTIVE.

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dh) — COUVERTURE EXHAUSTIVE.
     Audit : le bloc ne listait que 5 animations sur 13 déclarées, et aucune des
     40 `transition:` du fichier. Le repère « l'IA réfléchit » (.thinking i)
     restait couvert, mais pas la pastille d'envoi, l'anneau de navigation, ni
     les transitions de survol. Ènumérer à la main ne tient pas : la moindre
     animation ajoutée ensuite repasse hors couverture, silencieusement.
     On pose donc un filet global — même famille que le `animation: none
     !important` déjà accepté plus haut pour `.reduce-animation`, donc pas une
     exception nouvelle au principe « pas de !important décoratif ».
     Les règles ci-dessous ne font que PRESERVER L'INFORMATION : sans elles,
     neutraliser l'animation du point de chargement le laisserait figé, donc
     illisible. */
```

</details>

### v20261007 (ea) : plus d — v20261007 (ea) : plus de FOND sur le composeur, le champ et…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (ea) : plus de FOND sur le composeur, le champ et l'en-tête.
   Le cadre est conservé — bordure et ombre — mais la surface disparaît : le
   composeur doit se poser sur la conversation, pas poser une carte dessus.
   Trois plans se superposaient (fond de zone, fond d'enveloppe, fond de champ)
   et c'est ce troisième qui rendait l'écran morcelé. */
```

</details>

### sans étiquette — BUG INTRODUIT EN e21ca90, CORRIGÉ ICI.

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* BUG INTRODUIT EN e21ca90, CORRIGÉ ICI.
     La consolidation des littéraux a remplacé `#171717` par `var(--texte)`
     Y COMPRIS DANS LA DÉCLARATION DE `--texte` elle-même :
         --texte: var(--texte);        ← circulaire
     Une propriété custom qui se référence elle-même est INVALIDE en CSS. Le
     jeton devenait vide, et tout ce qui en dépendait avec lui :
     `--primaire: var(--texte)`, `--texte-doux: var(--texte-doux)`.
     Mesure au navigateur, thème clair : `--texte` vide, texte rendu en
     `rgb(0,0,0)` — noir pur au lieu de #171717. Le thème sombre était intact,
     d'où un défaut invisible sauf en basculant le thème.
     Ces deux déclarations restent donc des LITTERAUX : un jeton ne peut pas
     être défini par lui-même. */
```

</details>

### v20261007 (ea) : les su — v20261007 (ea) : les surfaces de zone ont enfin un opposé en…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (ea) : les surfaces de zone ont enfin un opposé en clair.
     Sans ces jetons, un littéral écrit dans `.msgs` ou `.side-pied` aurait
     affiché du sombre sur un thème clair — c'est exactement le symptôme que
     donnaient les couleurs en dur.
     `--fond-chat` manquait : la zone de conversation restait SOMBRE en thème
     clair, faute d'opposé. C'est le genre d'oubli qu'un jeton sans valeur
     miroir rend invisible. */
```

</details>

### v20261007 (eb) : ces de — v20261007 (eb) : ces deux-là étaient `var(--texte)` et…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (eb) : ces deux-là étaient `var(--texte)` et `var(--texte-doux)`
     — c'est-à-dire CIRCULAIRES, parce que le remplacement avait visé la
     déclaration du jeton lui-même. Elles réapparaissaient 20 lignes plus bas,
     après les valeurs littérales que je venais de poser en tête de bloc, et
     ces dernières ne servaient donc à rien. Un jeton ne peut pas être défini
     par lui-même : ici, il est défini par une valeur. */
```

</details>

### v20261007 (dz) : DEUX r — v20261007 (dz) : DEUX règles `html .md pre`peaker…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dz) : DEUX règles `html[data-theme="light"] .md pre`peaker
   redéfinissaient `color: #171717` — le texte sombre du bloc. Le fond, lui,
   venait d'être rendu sombre : il ne restait qu'un texte quasi noir SUR fond
   quasi noir, mesuré à 1.08:1. Invisible.
   Ce commentaire historique (« le bloc garde son fond neutre ») est caduc : le
   fond n'est plus neutre, il est sombre, dans les deux thèmes. Il reste donc à
   fixer la couleur du bloc et de ses liens. */
```

</details>

### v20261007 (dx) : #parta — v20261007 (dx) : #partager sort de ces surcharges de thème…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dx) : #partager sort de ces surcharges de thème clair.
   Elles le forçaient à #171717 en fond et #333333 en texte : sur le cadre
   #454242 demandé, ce texte sombre sur fond sombre était ILLISIBLE. Trois
   règles pour un seul bouton, et chacune prenait le dessus sur la précédente.
   Le fond et la couleur du texte viennent maintenant des jetons, identiques
   dans les deux thèmes : le bouton garde son cadre dans les deux, et reste
   lisible dans les deux. */
```

</details>

### sans étiquette — ————— Focus clavier ————— Audit : `outline: none` supprimait le repère…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* ————— Focus clavier —————
   Audit : `outline: none` supprimait le repère de focus sur des zones clés.
   Vérification faite zone par zone :
   - `.saisie` / `.saisie-mirror` : le `outline: none` est VOLONTAIRE et sans
     perte — l'anneau est porté par `.composeur-carte:focus-within`
     (border-color + box-shadow 3px). Rien à rétablir ici.
   - `.saisie-mirror` est un div non focusable : sans anneau à restituer.
   - `.hudf-edition` et `.hnav-url` en revanche n'avaient RIEN (et pour la
     seconde seulement un changement de couleur de bordure) : anneau
     explicite ci-dessous. */
```

</details>

### v20261007 (dx) — le fon — v20261007 (dx) — le fond va sur .msgs et .side-pied, avec les…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dx) — le fond va sur .msgs et .side-pied, avec les jetons.
   J'avais mis #1A1C1C sur .row.bot : c'était la mauvaise cible. Une rangée est
   une bande de contenu qui se déplace, pas une zone ; la peindre donnait un
   rectangle sombre en travers du fil à chaque message, et le fond du fil
   lui-même restait celui du corps. */
```

</details>

### v20261007 (dz) : la cla — v20261007 (dz) : la classe est `.sidebar` (l'élément est…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dz) : la classe est `.sidebar` (l'élément est `<aside id="sidebar"
   class="sidebar">`), pas `.side`. J'avais écrit `.side`, un sélecteur qui ne
   désigne RIEN : la règle était inerte, et la mesure l'a montré — `.side`
   renvoyait « ABSENT » alors que `--fond-side` était bien défini. Une règle
   morte ne se voit pas au relecture ; elle se voit à la mesure. */
```

</details>

### v20261007 (dq) : bouton — v20261007 (dq) : boutons Fichiers / Navigateur SANS…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dq) : boutons Fichiers / Navigateur SANS ENCADREMENT.
   Ils partageaient le style « bouton plein » (fond #3a3a3a, bordure grise,
   4 couleurs en dur qui ne suivaient pas le thème). On les passe en
   transparent : seule la zone cliquable reste visible, l'icône et l'étiquette
   héritent de --texte-doux, et le fond n'apparaît qu'au survol / focus.
   Æa les aligne sur les autres contrôles de la barre de titre, qui sont déjà
   en zone de toucher translucide, et supprime les 4 littéraux de couleur. */
```

</details>

### v20261007 (dw) : largeu — v20261007 (dw) : largeur FIXE 450px et CENTRÈ. Le plan était…

<details><summary>Commentaire d origine (CSS)</summary>

```css
/* v20261007 (dw) : largeur FIXE 450px et CENTRÈ. Le plan était calé à gauche
  (768px + marge), ce qui le décentrait par rapport au fil de discussion et le
  faisait lire comme un encart. Centré, il redevient un bandeau de contexte.
  `border-box` est indispensable : en `content-box` (défaut), les 450px
  s'ajoutaient au remplissage et aux bordures, et le plan mesurait 474px au
  lieu des 450 demandés — un écart qu'on ne voit qu'en mesurant.
  Le max-width évite le débordement sous ~480px de fenêtre. */
```

</details>

