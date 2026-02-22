# ARTISAN_SUPER_SYSTEM_v1
Date: 2026-02-08  
Version: 1.1.0  
Status: READY FOR DEV  
Mode: KLAWD orchestration multi-OPUS

---

## 1) UX fiche artisan (OPUS-01)

### 1.1 Objectif produit
La fiche artisan MVP doit convertir en 3 etapes:
1. Rassurer en 5 secondes.
2. Prouver la competence en 20 secondes.
3. Transformer en demande en moins de 45 secondes.

Ordre de conversion client recommande:
1. Identite + score confiance + badges.
2. Portfolio (preuve visuelle).
3. Avis clients (preuve sociale).
4. CTA principal "Demander cet artisan".

### 1.2 Blueprint champs (MVP essentiel)

| Bloc | Champ (backend) | UI label | Type | Regle | Obligatoire |
|---|---|---|---|---|---|
| A | `photo_url` | Photo profil | upload image | 1 photo, ratio 1:1 | Oui |
| A | `first_name` | Prenom | input text | 2-40 chars | Oui |
| A | `last_name` | Nom | input text | 2-40 chars | Oui |
| A | `metier_principal` | Metier | select | 1 valeur | Oui |
| A | `ville` | Ville | select | 1 valeur | Oui |
| A | `quartier` | Quartier | input/select | 2-60 chars | Oui |
| A | `zone_intervention_km` | Zone intervention | slider/select | 1-50 km | Oui |
| A | `langues[]` | Langues parlees | multi-select | 1-5 | Non |
| A | `bio` | Bio | textarea | max 200 chars | Oui |
| B | `annees_experience` | Annees experience | input number | 0-50 | Oui |
| B | `statut_pro` | Statut | select | `independant|entreprise|apprenti` | Oui |
| B | `nom_entreprise` | Nom entreprise | input text | requis si `entreprise` | Conditionnel |
| B | `description` | Description expertise | textarea | max 300 chars | Oui |
| B | `types_projets[]` | Types de projets | multi-select | 1-8 | Oui |
| C | `specialites[]` | Specialites | tags multi | max 5 | Oui |
| C | `competences_techniques[]` | Competences techniques | tags multi | max 20 | Non |
| C | `materiaux[]` | Materiaux maitrises | tags multi | max 20 | Non |
| D | `galerie_photos[]` | Galerie | upload multi | max 10, min 3 recommande | Oui |
| D | `projets[]` | Projets detailles | repeater cards | max 5 | Oui |
| D | `projets[].title` | Titre projet | input text | 3-80 chars | Oui |
| D | `projets[].description` | Resume projet | textarea | 20-300 chars | Oui |
| D | `projets[].photos[]` | Photos projet | upload multi | 1-6 | Oui |
| D | `projets[].avant_apres` | Avant/Apres | toggle bool | true si dispo | Non |
| H | `note_moyenne` | Note globale | computed | 0-5 | Auto |
| H | `missions_completees` | Missions realisees | computed | >=0 | Auto |
| H | `badges[]` | Badges confiance | computed | via moteur badges | Auto |
| H | `recent_reviews[]` | Avis recents | computed | 3-10 avis | Auto |

### 1.3 UX logique complete (artisan)
Flow edition profil en 4 steps:
1. Identite.
2. Experience.
3. Specialites.
4. Portfolio.

Regles UX:
1. Sauvegarde brouillon automatique toutes les 2-3 secondes apres modification.
2. Validation locale par step.
3. Resume de completion visible en haut en permanence.
4. CTA dynamique:
   - Si step invalide: "Completer ce bloc".
   - Si step valide: "Continuer".
   - Dernier step: "Publier mon profil".
5. Confirmation finale affiche:
   - Score completion profil.
   - Prochains gains rapides pour depasser 80%.

### 1.4 Barre progression + scoring completion %

Formule score completion profil (0-100) proposee, compatible backend:

| Critere | Points |
|---|---|
| Photo profil | 10 |
| Nom complet | 5 |
| Telephone verifie | 10 |
| Ville + quartier | 5 |
| Zone intervention | 5 |
| Metier principal | 5 |
| Bio (<=200) | 10 |
| Specialites (>=1) | 5 |
| Annees experience | 5 |
| Tarif renseigne | 5 |
| CNI chargee | 10 |
| Diplome charge | 5 |
| Galerie >= 3 photos | 10 |
| Horaires renseignees | 5 |
| Moyen paiement renseigne | 5 |
| **Total** | **100** |

Barre progression:
1. `0-39%`: "Profil en construction".
2. `40-69%`: "Base solide".
3. `70-89%`: "Presque pret pour convertir".
4. `90-100%`: "Profil premium".

Nudges automatiques:
1. Si `< 3 photos`: "Ajoutez 3 photos pour gagner +10 points".
2. Si pas de bio: "Une bio claire augmente la confiance client".
3. Si pas de verification: "Verifiez votre telephone pour debloquer plus de missions".

### 1.5 Structure ecran mobile
Ordre mobile:
1. Hero sticky: avatar, nom, metier, zone, score confiance, bouton CTA.
2. Bloc specialites (chips max 5 visibles).
3. Bloc portfolio (carousel + avant/apres).
4. Bloc avis (note, compteur, 3 avis recents).
5. Bloc details (experience, langues, bio).
6. CTA sticky bas d ecran: "Demander cet artisan".

### 1.6 Structure ecran desktop
Layout desktop en 2 colonnes:
1. Colonne gauche (35%): identite, score confiance, badges, CTA sticky.
2. Colonne droite (65%): portfolio, avis, description longue, competences.
3. Header fixe avec breadcrumb + statut dispo.

---

## 2) State machine commande + communication (OPUS-02)

### 2.1 Etats metier (vue client)
1. `demande_envoyee`
2. `acceptee`
3. `artisan_en_route`
4. `mission_en_cours`
5. `terminee`

Etats techniques internes recommandes (robustesse):
`devis_envoye`, `paiement_escrow`, `validee_client`, `annulee`, `expiree`, `litige`.

### 2.2 Transitions officielles

| From | To | Acteur | Trigger | Guard |
|---|---|---|---|---|
| `demande_envoyee` | `acceptee` | Artisan | Bouton "Accepter mission" | mission non expiree |
| `acceptee` | `artisan_en_route` | Artisan | Bouton "Je suis en route" | mission active + artisan assigne |
| `artisan_en_route` | `mission_en_cours` | Artisan | Bouton "Arrive sur place" | geoloc optionnelle |
| `mission_en_cours` | `terminee` | Artisan | Bouton "Mission terminee" | check-list pre-fin cochee |
| `terminee` | `validee_client` (interne) | Client/System | Bouton "Je valide" ou auto-timeout | avertissement accepte |

### 2.3 Permissions exactes

| Action | demande_envoyee | acceptee | artisan_en_route | mission_en_cours | terminee |
|---|---|---|---|---|---|
| Client annuler | Oui | Oui | Non | Non | Non |
| Artisan annuler | Oui | Oui | Non | Non | Non |
| Client voir telephone artisan | Non | Non | Oui | Oui | Oui |
| Chat interne client/artisan | Oui | Oui | Oui | Oui | Oui |
| Artisan changer statut | Non | Oui | Oui | Oui | Non |
| Client valider fin | Non | Non | Non | Non | Oui |

### 2.4 Regles critiques
1. Telephone masque par defaut.
2. Telephone visible uniquement a la transition `artisan_en_route`.
3. Annulation libre avant `artisan_en_route`.
4. Apres `artisan_en_route`: annulation bloquee, seul `litige` possible.
5. Validation finale client doit afficher avertissement obligatoire:
   - "En validant, le paiement est libere a l artisan et l action est irreversible."

### 2.5 Rule engine backend
Endpoint unique:
`POST /api/requests/{id}/transition`

Payload:
```json
{
  "target_status": "artisan_en_route",
  "expected_current_status": "acceptee",
  "actor_role": "artisan",
  "reason": "depart_confirme"
}
```

Controle serveur:
1. Verifier transition autorisee (`current -> target`).
2. Verifier role autorise.
3. Verifier guard metier (annulation, etat terminal, timeout).
4. Ecrire `status_history[]`.
5. Emettre event.
6. Envoyer notifications push + message interne.
7. Retourner etat actuel + actions encore possibles.

Idempotence:
1. Si deja dans `target_status`, reponse 200 sans duplication.
2. Lock optimiste via `updated_at` ou `version`.

### 2.6 Logique blocage annulation
Code erreur recommande: `409 CANCEL_BLOCKED_EN_ROUTE`

Message systeme:
"Annulation indisponible apres depart artisan. Ouvrez un litige si necessaire."

Actions UI forcees:
1. Afficher bouton "Ouvrir un litige".
2. Masquer bouton "Annuler".
3. Enregistrer tentative annulation dans audit log.

### 2.7 Notifications (push + interne)
Evenements et templates:
1. `request.accepted` -> "Votre demande est acceptee."
2. `request.artisan_departed` -> "Votre artisan est en route."
3. `request.work_started` -> "La mission a commence."
4. `request.work_completed` -> "Mission terminee. Merci de valider."
5. `request.cancelled` -> "Demande annulee."
6. `request.disputed` -> "Litige ouvert, notre equipe intervient."

Architecture type Uber:
1. Transition synchrone courte.
2. Side effects asynchrones via event bus.
3. Notification service decouple.
4. Audit log systematique par transition.

---

## 3) UI polish global premium (OPUS-03)

### 3.1 Direction visuelle
Intent: sobre, noir/blanc premium, avec accents discrets.
Ne rien casser, uniquement elever la perception qualite.

### 3.2 Palette accent tres legere

| Token | Valeur | Usage |
|---|---|---|
| `neutral.canvas` | `#F7F7F5` | fond global |
| `neutral.surface` | `#FFFFFF` | cartes |
| `neutral.text` | `#171717` | texte principal |
| `neutral.muted` | `#6E6E68` | texte secondaire |
| `accent.steel` | `#62708A` | liens, focus, infos |
| `accent.sage` | `#667A6E` | categories artisan |
| `accent.sand` | `#8A7A5A` | premium, badges |
| `state.success` | `#2F9C62` | validation |
| `state.warning` | `#B78A3A` | alerte douce |
| `state.danger` | `#B65B5B` | actions risque |

Regles:
1. Accent colore <= 12% de la surface visible d un ecran.
2. Pas de gradient agressif.
3. Pas d ombres lourdes.

### 3.3 Hover, active, focus states
1. Hover card (web/desktop): border `+1` nuance, elevation legere.
2. Pressed bouton: scale `0.985`, duree `120ms`.
3. Focus clavier: anneau 2px `accent.steel` avec contraste AA.
4. Onglet actif: fond subtil + texte semibold.

### 3.4 Micro animations
1. Transition card: `160ms ease-out`.
2. Ouverture modal: fade + translateY 8px.
3. Skeleton shimmer pour chargements > 250ms.
4. Success feedback: check icon scale-in `180ms`.

### 3.5 Lisibilite + hierarchie premium
1. Titres: poids fort, taille moderee, interligne compacte.
2. Texte secondaire: contraste >= 4.5:1.
3. Chiffres importants (prix, note, score): style tabulaire.
4. Sections longues: separation via espace et sous-titres courts.

### 3.6 Spacing perfection
Systeme 4pt:
`4, 8, 12, 16, 20, 24, 32`.

Rythme:
1. Espace inter-composant principal: 16.
2. Espace interne cartes: 16-20.
3. Espace entre sections ecran: 24-32.

### 3.7 Micro-interactions a ajouter sans risque
1. Bouton CTA: etat loading inline + texte conserve.
2. Badges: apparition en fondu lors du load profil.
3. Status badge: transition couleur douce au changement etat.
4. Timeline mission: pulse discret sur etape en cours.

---

## 4) Scoring + credibilite artisan (OPUS-04)

### 4.1 Scores exposes au client
1. `score_confiance` (0-100)
2. `score_profil` (0-100)
3. `score_portfolio` (0-100)
4. `score_avis` (0-100)

### 4.2 Formules simples

#### a) Score profil complete
Score par points fixes (table section 1.4), total 100.

#### b) Score qualite portfolio
```text
score_portfolio =
  0.35 * score_volume_photos +
  0.35 * score_qualite_projets +
  0.20 * score_preuve_avant_apres +
  0.10 * score_recence_portfolio
```

Sous-scores:
1. `score_volume_photos`: 0 a 100 (0 photo -> 0, 10 photos -> 100).
2. `score_qualite_projets`: titre + description + photos par projet.
3. `score_preuve_avant_apres`: proportion projets avec `avant_apres=true`.
4. `score_recence_portfolio`: activite des 180 derniers jours.

#### c) Score avis clients
```text
bayesian_note = (5*3.5 + nb_avis*note_moyenne) / (5 + nb_avis)
score_note = ((bayesian_note - 1) / 4) * 100
score_volume = min(100, nb_avis / 30 * 100)
score_recence_avis = min(100, avis_90j / 12 * 100)

score_avis =
  0.70 * score_note +
  0.20 * score_volume +
  0.10 * score_recence_avis
```

#### d) Score confiance global
```text
score_confiance =
  0.20 * score_profil +
  0.20 * score_portfolio +
  0.30 * score_avis +
  0.20 * score_fiabilite +
  0.10 * score_anciennete
```

### 4.3 Labels confiance
1. `85-100`: Elite.
2. `70-84`: Tres fiable.
3. `55-69`: Fiable.
4. `40-54`: Correct.
5. `0-39`: A renforcer.

### 4.4 Badges intelligents
1. `verifie`: CNI + telephone verifies.
2. `top_artisan`: score_confiance >= 80, top 10% metier, 15+ missions.
3. `reactif`: mediane reponse < 1h sur 30 jours.
4. `ponctuel`: >= 90% departs/arrivees a l heure.
5. `cinq_etoiles`: note >= 4.8 avec >= 10 avis.
6. `zero_annulation`: 20+ missions sans annulation artisan.
7. `expert_<specialite>`: 30+ missions specialite + note >= 4.5.
8. `fidelite_bronze|argent|or`: anciennete active 6/12/24 mois.

### 4.5 Ranking interne (tri recherche)
```text
ranking_score =
  0.40 * score_confiance +
  0.25 * score_proximite +
  0.15 * score_disponibilite +
  0.10 * score_match_service +
  0.10 * score_recence
```

Garde-fous:
1. Boost cold start limite pour nouveaux profils verifies.
2. Penalite si annulations recentes.
3. Penalite si absence activite longue.

---

## 5) Experience premium client (OPUS-05)

### 5.1 Micro textes rassurants
Remplacements recommandes:
1. "Paiement en attente" -> "Fonds securises jusqu a votre validation finale".
2. "Recherche artisan" -> "Nous contactons les artisans les plus fiables pres de vous".
3. "Mission terminee" -> "Mission terminee, verifiez le resultat avant liberation des fonds".
4. "Litige" -> "Nous avons bien recu votre signalement. Support en cours".

### 5.2 Confirmation flows obligatoires

#### a) Avant paiement
Ecran recap:
1. Artisan, service, montant total.
2. Delai estime.
3. Rappel securite:
   - "Le paiement reste protege jusqu a validation de fin de mission."
4. CTA unique: "Confirmer et securiser le paiement".

#### b) Avant validation finale mission
Modal obligatoire:
1. Titre: "Valider la mission ?"
2. Message: "Cette action libere le paiement a l artisan et ne peut pas etre annulee."
3. Choix:
   - `Retour` (secondaire)
   - `Valider la mission` (primaire, danger doux)

### 5.3 Warnings intelligents
1. Tentative annulation apres `artisan_en_route`:
   - "Annulation indisponible apres depart. Ouvrez un litige si besoin."
2. Detection partage numero avant depart dans chat:
   - "Pour votre protection, gardez les echanges dans l app avant la mise en route."
3. Prix anormalement bas:
   - "Ce prix est bien en dessous de la moyenne. Verifiez le detail du devis."
4. Long silence artisan:
   - "Pas de reponse recente. Nous pouvons vous proposer un autre artisan."

### 5.4 Zero chaos UX pattern
1. Une seule action primaire par ecran.
2. Timeline mission visible en permanence.
3. Prochaine action toujours explicite.
4. Etats vides utiles (jamais ecran vide sans guidance).
5. Toute erreur donne un chemin de sortie clair.

---

## 6) Recommandations finales (fusion ready-dev)

### 6.1 Priorites implementation
1. P0: verrouiller state machine + permissions + blocage annulation.
2. P0: gate telephone uniquement depuis `artisan_en_route`.
3. P1: finaliser scoring confiance + badges + ranking.
4. P1: harmoniser UX fiche artisan et completion score.
5. P2: deploy UI polish global via tokens design system.

### 6.2 Checklist livraison
1. API transitions idempotente + audit log.
2. Notification push + message interne sur chaque transition.
3. Ecran profil artisan mobile + desktop conformes au blueprint.
4. Calcul score automatique nightly + on-event.
5. Test E2E:
   - Demande -> Acceptee -> En route -> En cours -> Terminee -> Validee.
   - Blocage annulation apres en route.
   - Visibilite telephone uniquement a partir de en route.

### 6.3 Definition of done
1. Client comprend instantanement si artisan fiable.
2. Aucun etat ambigu dans la mission.
3. UX premium sans surcharge visuelle.
4. Flows critiques sans stress et sans ambiguite.

