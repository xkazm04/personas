# Personas — French style guide (fr)

Companion to `docs/i18n/glossary.md`. Read the glossary first — this file makes
its rules concrete for French and resolves the term choices §2 leaves open.
Where this file and observed `fr.json` strings disagree, **this file wins**:
about a quarter of `fr.json` is still raw English (ignore those as voice
evidence) and a further slice is drifted terminology from before this guide
existed (named explicitly in Pitfalls below). Do not propagate the drift.

## Register & address

Use **vous**, always — never *tu / ton / ta / toi*. Personas is a professional
developer tool addressed to an operator, and French is one of the languages
that grammatically distinguishes formal address, so the glossary's formal-only
rule applies without exception, including in the Athena companion chat surface
(a few shipped strings there slipped into *tu* — see Pitfalls #3; don't
reproduce that pattern in new strings).

This means: possessives are *votre / vos* (never *ton / ta / tes*), imperatives
are the **vous**-form (*"Sélectionnez"*, not *"Sélectionne"*), and object
pronouns are *vous* (*"cela vous concerne"*, not *"cela te concerne"*).

## Casing

**Sentence case everywhere.** Capitalize only the first word of a label/title
and genuine proper nouns (Personas, Claude, Anthropic, GitHub, Slack, the
product's own borrowed feature names — Director, Twin, Brain, Cockpit). Do not
mirror English Title Case.

- Right: `"Moniteur de personas"`, `"Connexion espace de travail"`, `"Créer un persona"`
- Wrong: `"Moniteur De Personas"`, `"Connexion Espace De Travail"`

**Buttons are short imperatives**, `vous`-form, no trailing period:
`"Enregistrer"`, `"Annuler"`, `"Promouvoir"`, `"Lancer la vérification"`. If your
translated label is pushing a button wider than its English source, cut a word
before you cut meaning — see Length discipline.

## Typography & punctuation

- **Ellipsis**: always the single glyph `…` (U+2026). Never three periods
  `...`. (The shipped file currently has both — 205 real ellipses against 497
  literal `...`; when you touch a string with `...`, fix it, but this is not a
  license to bulk-edit strings outside your task.)
- **Quotation marks**: French guillemets `«` `»`, never English `" "` or
  typographic `“ ”`. Example: `« {query} »`.
- **Non-breaking space (U+00A0)** is mandatory:
  - before `:` `;` `!` `?`
  - before the closing guillemet `»` and after the opening guillemet `«`
  - Correct: `Statut :`, `« {query} »` (that ` ` is a literal
    non-breaking space character, not the two characters backslash-u — insert
    U+00A0 itself). A plain space is visually identical in most editors but is
    typographically wrong and is what most of the shipped file currently uses;
    use the real character in anything you newly translate.
- **Placeholders**: `{count}`, `{name}`, etc. keep their exact spelling — see
  the FORMAT CONTRACT. You may reorder a placeholder to match French word
  order (e.g. adjective-noun inversions), never rename or recase it.
- **Numbers/dates**: never hardcode a French-formatted number or date into a
  string; the app formats those at runtime.
- No RTL marks or ZWNJ apply to French (Latin script, LTR) — that guidance is
  for the Arabic/Hindi/Bengali locales, not this one.

## Length discipline

French strings run **~15–25% longer than English** on average, and up to
~35% longer for compound or legally-precise phrasing (consent text, error
detail). Budget for it:

- **Buttons/badges/tab chips**: prefer a short infinitive-as-imperative noun
  over a full clause. `"Lancer"` beats `"Démarrer l'exécution"` where context
  already establishes the object. Drop articles in badges where French allows
  it (`"Brouillon"`, not `"Le brouillon"`).
- **Narrow columns / status pills**: reuse the shipped short forms already in
  the termbase (`"Échec"`, `"Terminé"`, `"En cours"`) rather than inventing
  longer synonyms.
- A button whose French label wraps to two lines is a bug — shorten the
  wording, don't shrink the font or change the layout.

## Loanword policy

Decisive per term (see Termbase for the full list); the general pattern:

- **Stays borrowed** (proper names / product surfaces, capitalized, treated as
  masculine nouns when an article is needed): `Personas`, `Claude`, `Director`,
  `Twin`, `Brain`, `Cockpit`. These are surface/feature names, not common
  nouns — don't lowercase or translate them even though `director`/`brain` are
  ordinary English words.
- **Stays borrowed, lowercase** (naturalized tech vocabulary already dominant
  in shipped French copy and in French developer speech generally):
  `persona` (the common noun — see the Personas trap in the glossary; this is
  the single most important call in this document, see Pitfalls #1), `twin`
  (lowercase common-noun use, e.g. *"créer un twin"*), `workflow`.
- **Always translated to a native French word**: `agent`, `capacité`,
  `connecteur`, `identifiant`, `coffre-fort`, `recette`, `modèle`,
  `déclencheur`, `exécution`, `planification`, `déploiement`,
  `auto-réparation`, `flotte`, `brouillon`, `promouvoir`, `révision`,
  `approbation`, `vue d'ensemble`, `moniteur`, `événement`, `alerte`,
  `chaîne`, `compétence`, `niveau`.
- **Never translate** (per the glossary's do-not-translate list): brand names,
  technical identifiers (API, CLI, JSON, MCP, OAuth, SQLite, npm, git, KPI,
  LLM, GPU/CPU/RAM, …), placeholders, `·`, URLs, code identifiers, enum/status
  codes, user-generated content. Pricing-tier **names** (Starter, Team,
  Builder) fall in this bucket too — only the generic word "tier" itself gets
  translated.

When in doubt between borrowing and translating a term not listed here: if the
word already reads as normal French tech jargon in professional speech (as
`workflow` now does), prefer borrowing over an accurate-but-stilted native
coinage — a bad literal translation reads worse to a French developer than
the English loanword does.

## Termbase

| English | French | note |
|---|---|---|
| persona | **persona** (emprunté, invariable, **masculin**: *un persona*, *le persona*, *les personas*) | Le nom central du produit. Ne **jamais** le rendre par « agent » — c'est la dérive la plus fréquente du fichier actuel (voir Pitfalls #1). Masculin par analogie avec d'autres emprunts en *-a* déjà masculins en français (*un agenda*, *un visa*). |
| agent | **agent** | Traduction directe et distincte de *persona* — jamais utilisée l'une pour l'autre. Règle mécanique : le mot source dicte le mot cible (« persona » → *persona*, « agent » → *agent*), aucun jugement au cas par cas nécessaire. |
| capability | **capacité** / **capacités** | Jamais « fonctionnalité » (feature) ni « compétence » (réservé à *skill*) — une capability est un contrat que le persona remplit. |
| connector | **connecteur** / **connecteurs** | Jamais « plugin » ni « connexion » (réservée à l'instance liée = *credential*). « Appli(s) » existe dans quelques onglets très étroits déjà expédiés — toléré là, ne pas en créer de nouveaux. |
| credential | **identifiant** / **identifiants** | Jamais « certificat ». Couvre clé API, jeton OAuth, etc. |
| vault | **coffre-fort** | Jamais « cave » ni « entrepôt ». Note : le libellé de navigation (`sidebar.keys`) reste « Identifiants », pas « Coffre-fort » — deux clés, un seul écran ; ne pas les faire converger. |
| recipe | **recette** | Reste distinct de *template* — la recette est paramétrable, le modèle est prêt à l'emploi. |
| template | **modèle** / **modèles** | Reste distinct de *recipe*. |
| trigger | **déclencheur** / **déclencheurs** | Forme courte « Quand » tolérée seulement dans une puce d'onglet à 3 mots déjà en place (Quand / Applis / Validation) ; ne pas généraliser cette forme courte. |
| execution | **exécution** | Le nom. Voir *run* pour le verbe et pour la version familière du nom. |
| run | (verbe) **lancer** / **exécuter** ; (nom, familier) **exécution** | « Lancer » démarre un test/une analyse/une comparaison (*"Lancer l'arène"*) ; « Exécuter » quand l'objet direct est le persona ou l'exécution elle-même (*"Exécuter maintenant"*, *"Exécuter l'agent"*). Le nom reste identique à *execution*. |
| schedule | **planification** | |
| deployment | **déploiement** | |
| healing | **réparation** / **auto-réparation** | **Jamais** « guérison » / « guéri » — calque médical déjà présent dans une partie du fichier (voir Pitfalls #2) ; c'est une correction à faire à chaque contact, pas en masse. |
| fleet | **flotte** | |
| draft | **brouillon** | |
| promote | **promouvoir** (verbe) / **promu** (statut) | Jamais « annoncer » (advertise). |
| review | **révision** / **révisions** | Préféré à « revue » (qui signifie aussi *magazine* en français, ambigu) ; « revue » subsiste dans une clé historique (`sidebar.manual_review`) — ne pas reproduire ce choix ailleurs. |
| approval | **approbation** | Cohérent avec *review* : on approuve une révision. |
| lab | **Laboratoire** | Forme longue pour le titre d'onglet (déjà utilisée : `tab_lab`). « Lab » emprunté est toléré seulement dans un badge trop étroit pour « Laboratoire ». |
| overview | **vue d'ensemble** | |
| monitor | (nom) **Moniteur** ; (verbe) **surveiller** | |
| cockpit | **cockpit** (emprunté) | Métaphore conservée telle quelle, comme *Twin*/*Brain*/*Director*. |
| event | **événement** / **événements** | |
| alert | **alerte** / **alertes** | |
| chain | **chaîne** / **chaînes** | |
| workflow | **workflow** (emprunté) | Déjà majoritairement emprunté dans le fichier existant. Réserver « flux de travail » aux phrases narratives longues où l'anglicisme alourdit la lecture (ex. une phrase d'explication complète, pas un libellé de champ). |
| skill | **compétence** / **compétences** | Distinct de *capability* : la compétence est le paquet d'instructions invocable, la capacité est le contrat rempli. |
| tier | **niveau** | Traduire le mot générique seulement — les **noms** de niveaux (Starter, Team, Builder) restent en anglais, intouchés. |
| twin | **twin** (emprunté, masculin: *un twin*, *le twin actif*) | |
| director | **Director** (emprunté, nom propre, masculin: *le Director*) | Nom du méta-persona intégré au produit — se comporte comme *Personas*/*Claude* (un nom propre), jamais traduit, jamais en minuscule. |
| brain | **Brain** (nom propre du plugin) / **mémoire** (métaphore générique) | Comme titre d'onglet/nom de plugin, reste « Brain ». Comme concept générique dans une phrase (« sa mémoire longue durée »), se traduit par « mémoire ». |

## Pitfalls

1. **Collapsing *persona* into *agent*.** A large slice of already-shipped
   strings translated the English source word **persona** with the French
   word **agent** (e.g. English `"Select persona"` shipped as
   `"Sélectionner un agent"`; `"No persona selected"` as `"Aucun agent
   sélectionné"`). This erases the one distinction the glossary requires.
   - Wrong: `"Select a persona"` → *"Sélectionner un agent"*
   - Right: `"Select a persona"` → *"Sélectionner un persona"*

2. **Medical calque on *healing*.** Part of the shipped file translates
   *healing* as *guérison* / *guéri* — the literal medical sense (cure). The
   product's healing is automatic remediation of a failing persona, not
   medicine.
   - Wrong: `"Auto-healed"` → *"Auto-guéri"*
   - Right: `"Auto-healed"` → *"Auto-réparé"*

3. **Informal *tu* leaking into companion chat.** A few Athena/companion
   strings use *tu/ta/ton* instead of the mandatory *vous*.
   - Wrong: `"What can you do?"` → *"Que peux-tu faire ?"*
   - Right: `"What can you do?"` → *"Que pouvez-vous faire ?"*

4. **Literal three-dot ellipsis instead of the real glyph.** Loading/pending
   states frequently use `...` (three periods) instead of `…`.
   - Wrong: `"Loading…"` → *"Chargement..."*
   - Right: `"Loading…"` → *"Chargement…"*

5. **Missing non-breaking space around French punctuation.** Colons and
   guillemets are set with a plain space instead of U+00A0, which lets the
   punctuation mark start a new line on its own — a classic French-typography
   bug.
   - Wrong: `"Status:"` → *"Statut :"* (regular space)
   - Right: `"Status:"` → *"Statut :"* (U+00A0 before the colon)

6. **Gender agreement drift on the borrowed noun *persona*.** Because
   `persona` ends in *-a*, some strings default to feminine agreement
   (*"toutes les personas"*) while the rest of the product treats it as
   masculine (*"tous les personas"*, *"un persona"*). Masculine is the
   decision (see Termbase) — always agree articles/adjectives accordingly.
   - Wrong: `"Shows all personas"` → *"Affiche toutes les personas"*
   - Right: `"Shows all personas"` → *"Affiche tous les personas"*
