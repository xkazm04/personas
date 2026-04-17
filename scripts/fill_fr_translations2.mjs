/**
 * Second-pass: fill remaining 962 missing French keys.
 */
import { readFileSync, writeFileSync } from 'fs';

const FR_PATH = 'C:/Users/kazda/kiro/personas/src/i18n/fr.ts';

const TRANSLATIONS = {
  // vault.reauth_banner
  "vault.reauth_banner.access_revoked": ") -- l'accès a été révoqué. Veuillez ré-autoriser pour reprendre les automatisations.",
  "vault.reauth_banner.reconnect": "Reconnecter",

  // vault.cli_capture
  "vault.cli_capture.cta": "Importer depuis la CLI locale",
  "vault.cli_capture.hint": "Utilisez une CLI locale déjà connectée plutôt que de coller une clé API.",
  "vault.cli_capture.running": "Exécution de la CLI locale...",
  "vault.cli_capture.success": "Identifiants capturés depuis la CLI",
  "vault.cli_capture.token_ttl_notice": "Ce token expire dans {seconds}s et sera actualisé automatiquement.",
  "vault.cli_capture.source_label": "CLI",
  "vault.cli_capture.missing_binary": "`{binary}` n'est pas installé ou ne se trouve pas dans un emplacement autorisé.",
  "vault.cli_capture.unauthenticated": "Vous n'êtes pas connecté à {binary}. {instruction}",
  "vault.cli_capture.capture_failed": "Capture CLI échouée : {detail}",
  "vault.cli_capture.timeout": "La capture CLI a expiré. Essayez d'exécuter la commande manuellement d'abord.",

  // vault.design_phases remaining
  "vault.design_phases.setup_instructions": "Instructions de configuration",
  "vault.design_phases.all_steps_complete": "Toutes les étapes terminées -- remplissez les champs ci-dessous et testez votre connexion.",
  "vault.design_phases.use_template": "Utiliser",
  "vault.design_phases.recipe_used_one": "-- utilisé {count} fois",
  "vault.design_phases.recipe_used_other": "-- utilisé {count} fois",
  "vault.design_phases.instruction_placeholder": "ex. Slack, OpenAI, GitHub, Stripe...",

  // vault.auto_cred_extra remaining
  "vault.auto_cred_extra.browser_automation_warning": "L'automatisation du navigateur est en cours. N'interagissez pas avec la fenêtre — elle reprendra quand c'est terminé.",
  "vault.auto_cred_extra.desktop_bridge_title": "{{label}} nécessite l'application desktop",
  "vault.auto_cred_extra.desktop_bridge_hint": "Ce connecteur pilote une session navigateur native qui ne fonctionne que dans l'application desktop Personas.",
  "vault.auto_cred_extra.review_extracted": "Réviser les identifiants extraits",
  "vault.auto_cred_extra.review_extracted_hint": "Valeurs extraites du navigateur -- vérifiez avant d'enregistrer",
  "vault.auto_cred_extra.completeness_partial": "{filled} sur {total} champs requis remplis. Complétez les champs manquants avant d'enregistrer.",
  "vault.auto_cred_extra.universal_auto_setup": "Configuration automatique universelle",
  "vault.auto_cred_extra.universal_auto_setup_hint": "Fournissez une URL et une description, et l'IA naviguera sur le site pour découvrir et créer les identifiants API automatiquement.",
  "vault.auto_cred_extra.service_url_label": "URL du service",
  "vault.auto_cred_extra.service_url_placeholder": "https://app.example.com ou https://developer.example.com",
  "vault.auto_cred_extra.what_do_you_need": "De quoi avez-vous besoin ?",
  "vault.auto_cred_extra.description_placeholder": "ex. J'ai besoin d'une clé API pour leur API REST pour lire et écrire des données. Le portail développeur dispose d'une section Clés API dans les Paramètres.",
  "vault.auto_cred_extra.discover_credentials": "Découvrir les identifiants",
  "vault.auto_cred_extra.discovered_label": "Découvert : {label}",
  "vault.auto_cred_extra.fields_discovered_one": "{count} champ découvert",
  "vault.auto_cred_extra.fields_discovered_other": "{count} champs découverts",
  "vault.auto_cred_extra.extracted_values_label": "Valeurs extraites",
  "vault.auto_cred_extra.no_fields_discovered": "Aucun champ découvert. Réessayez avec une description plus précise.",
  "vault.auto_cred_extra.fields_captured_partial": "{filled}/{total} champs capturés",
  "vault.auto_cred_extra.credential_stored": "L'identifiant {label} a été enregistré de manière sécurisée.",

  // vault.negotiator_extra
  "vault.negotiator_extra.panel_title": "Négociateur d'identifiants IA",
  "vault.negotiator_extra.planning_description": "L'IA analyse le portail développeur et génère un plan de provisionnement étape par étape...",

  // vault.workspace_panel remaining
  "vault.workspace_panel.selected_count": "{selected} sur {total} sélectionné(s)",
  "vault.workspace_panel.select_all": "Tout sélectionner",
  "vault.workspace_panel.connect_services_one": "Connecter {count} service avec un seul compte",
  "vault.workspace_panel.connect_services_other": "Connecter {count} services avec un seul compte",
  "vault.workspace_panel.granting_access_one": "Cela accordera l'accès à {count} service",
  "vault.workspace_panel.granting_access_other": "Cela accordera l'accès à {count} services",
  "vault.workspace_panel.credentials_created_one": "{count} identifiant créé depuis un seul compte.",
  "vault.workspace_panel.credentials_created_other": "{count} identifiants créés depuis un seul compte.",
  "vault.workspace_panel.sign_in_browser": "Connectez-vous avec votre compte Google dans la fenêtre du navigateur.",

  // deployment.api_playground
  "deployment.api_playground.request_body_placeholder": "Votre prompt ici...",

  // deployment.connection
  "deployment.connection.orchestrator_url_placeholder": "https://votre-orchestrateur.example.com",

  // deployment.deployments_panel
  "deployment.deployments_panel.no_deployments_yet": "Aucun déploiement pour l'instant. Sélectionnez un persona ci-dessus pour le déployer comme point de terminaison API cloud.",
  "deployment.deployments_panel.active_deployments": "Déploiements actifs",

  // deployment.exec_detail
  "deployment.exec_detail.label_status": "Statut :",
  "deployment.exec_detail.label_duration": "Durée :",
  "deployment.exec_detail.label_cost": "Coût :",
  "deployment.exec_detail.label_tokens": "Tokens :",
  "deployment.exec_detail.label_started": "Démarré :",
  "deployment.exec_detail.label_completed": "Terminé :",
  "deployment.exec_detail.label_input": "Entrée :",
  "deployment.exec_detail.view_output": "Voir la sortie",
  "deployment.exec_detail.output_prefix": "Sortie (",
  "deployment.exec_detail.output_lines_suffix": "lignes)",

  // deployment.oauth_panel
  "deployment.oauth_panel.open_auth_window": "Ouvrir la fenêtre d'autorisation",
  "deployment.oauth_panel.complete_authorization": "Terminer l'autorisation",
  "deployment.oauth_panel.refresh_token": "Actualiser le token",
  "deployment.oauth_panel.open_authorization_window": "Ouvrir la fenêtre d'autorisation",
  "deployment.oauth_panel.token_unknown_msg": "La validité du token n'a pas pu être vérifiée. Actualisez le token pour confirmer qu'il est toujours actif.",
  "deployment.oauth_panel.connect_anthropic_msg": "Connectez votre compte Anthropic pour activer l'authentification OAuth pour les exécutions cloud.",
  "deployment.oauth_panel.token_expired_msg_prefix": "Ce token OAuth a expiré",

  // deployment.trigger_form
  "deployment.trigger_form.cron_expression": "Expression cron",
  "deployment.trigger_form.utc_suffix": "(UTC)",
  "deployment.trigger_form.webhook_info": "Un point de terminaison webhook sera créé pour ce déclencheur. Vous pouvez configurer le filtrage de charge utile après la création.",

  // deployment.chart
  "deployment.chart.tooltip_runs": "Exécutions :",
  "deployment.chart.tooltip_cost": "Coût :",
  "deployment.chart.tooltip_success": "Succès :",

  // deployment.deploy_card
  "deployment.deploy_card.budget_label": "Budget :",
  "deployment.deploy_card.label_invocations": "Invocations :",
  "deployment.deploy_card.label_last_called": "Dernier appel :",
  "deployment.deploy_card.label_created": "Créé :",

  // deployment.history
  "deployment.history.clear_filters": "Effacer les filtres",
  "deployment.history.execution_history": "Historique des exécutions",

  // deployment.schedules
  "deployment.schedules.label_type": "Type :",
  "deployment.schedules.label_status": "Statut :",
  "deployment.schedules.label_last_triggered": "Dernier déclenchement :",
  "deployment.schedules.label_next_trigger": "Prochain déclenchement :",
  "deployment.schedules.label_cron": "Cron :",
  "deployment.schedules.loading_firings": "Chargement...",

  // overview.messages
  "overview.messages.id_label": "ID :",
  "overview.messages.confirm_delete_title": "Confirmer la suppression",
  "overview.messages.close_message": "Fermer le détail du message",

  // overview.memories
  "overview.memories.no_memories_hint": "Lorsque les agents s'exécutent, ils peuvent stocker des notes et apprentissages utiles ici.",
  "overview.memories.no_memories_match": "Aucune mémorisation ne correspond aux filtres actuels",
  "overview.memories.list_aria_label": "Liste des mémorisations",
  "overview.memories.add_memory_btn": "Ajouter une mémorisation",
  "overview.memories.no_filter_match": "Aucune mémorisation ne correspond à vos filtres. Essayez d'ajuster votre recherche.",

  // overview.memory_review
  "overview.memory_review.all_conflicts_resolved": "Tous les conflits résolus",
  "overview.memory_review.keep_prefix": "Conserver «",
  "overview.memory_review.keep_suffix": "»",

  // overview.leaderboard
  "overview.leaderboard.fleet_avg": "Moy. flotte :",
  "overview.leaderboard.refresh_label": "Actualiser le classement",
  "overview.leaderboard.computing_scores": "Calcul des scores des agents...",
  "overview.leaderboard.single_agent_has_data": "dispose de données.",
  "overview.leaderboard.add_more_agents": "Ajoutez d'autres agents pour voir les classements. Actuellement seulement {name}",
  "overview.leaderboard.open_agent": "Ouvrir l'agent",
  "overview.leaderboard.no_agent_data_title": "Aucune donnée d'agent pour l'instant",
  "overview.leaderboard.no_agent_data_hint": "Exécutez des agents pour voir les classements de performance. Le classement nécessite un historique d'exécution et des données de santé pour calculer les scores.",

  // overview.health_extra
  "overview.health_extra.score_prefix": "Score :",
  "overview.health_extra.uptime_30d_prefix": "Disponibilité 30j :",
  "overview.health_extra.updated_prefix": "Mis à jour",
  "overview.health_extra.consecutive_failures_one": "{count} échec consécutif",
  "overview.health_extra.consecutive_failures_other": "{count} échecs consécutifs",

  // overview.burn_rate_extra
  "overview.burn_rate_extra.active_personas_subtitle": "{count} personas actifs · limite mensuelle locale",

  // overview.predictive_alerts_extra
  "overview.predictive_alerts_extra.per_month": "/mois",
  "overview.predictive_alerts_extra.confidence_pct": "% conf.",

  // overview.annotate_modal
  "overview.annotate_modal.annotation_placeholder": "ex. La vérification webhook Stripe nécessite le corps de la requête brut, pas le JSON analysé",

  // overview.knowledge_row
  "overview.knowledge_row.execution_trend_label": "Tendance des exécutions",

  // overview.knowledge_graph
  "overview.knowledge_graph.mock_pattern": "Schéma fictif",
  "overview.knowledge_graph.seed_tooltip": "Générer un schéma fictif (dev uniquement)",
  "overview.knowledge_graph.all_types": "Tous les types",
  "overview.knowledge_graph.all_scopes": "Toutes les portées",
  "overview.knowledge_graph.failure_drilldown_prefix": "Analyse des échecs :",
  "overview.knowledge_graph.failure_date_filter": "Affichage des schémas d'échec actifs à partir du {date}",
  "overview.knowledge_graph.data_unavailable": "Données de connaissances indisponibles",
  "overview.knowledge_graph.loading_patterns": "Chargement des schémas de connaissances...",
  "overview.knowledge_graph.drilldown_toggle_title": "Afficher/masquer l'analyse des échecs",
  "overview.knowledge_graph.no_patterns_yet": "Aucun schéma de connaissances pour l'instant",
  "overview.knowledge_graph.no_patterns_yet_hint": "Exécutez des agents pour constituer des schémas de connaissances. Les agents s'améliorent au fil du temps.",
  "overview.knowledge_graph.no_patterns_match": "Aucun schéma ne correspond aux filtres actuels",
  "overview.knowledge_graph.recent_learnings": "Apprentissages récents",
  "overview.knowledge_graph.curating_manually": "Vous organisez des documents manuellement ?",
  "overview.knowledge_graph.obsidian_tip": "Pour moins de ~1000 notes, un connecteur Obsidian peut synchroniser votre coffre directement.",

  // overview.focused_decision
  "overview.focused_decision.video_not_supported": "Votre navigateur ne prend pas en charge la lecture vidéo.",
  "overview.focused_decision.reject_this": "Rejeter ceci",
  "overview.focused_decision.accept_this": "Accepter ceci",

  // overview.review_focus
  "overview.review_focus.video_not_supported": "Votre navigateur ne prend pas en charge la lecture vidéo.",

  // overview.bulk_action_bar
  "overview.bulk_action_bar.pending_reviews_selected_one": "{count} révision en attente sélectionnée",
  "overview.bulk_action_bar.pending_reviews_selected_other": "{count} révisions en attente sélectionnées",

  // overview.review_inbox
  "overview.review_inbox.drag_to_resize": "Glisser pour redimensionner",

  // overview.healing_issues_panel
  "overview.healing_issues_panel.ai_healing_title": "Guérison IA",
  "overview.healing_issues_panel.diagnosis_label": "Diagnostic :",
  "overview.healing_issues_panel.fixes_applied": "Correctifs appliqués",
  "overview.healing_issues_panel.alert_history_title": "Historique des alertes",
  "overview.healing_issues_panel.all_agents_global": "Tous les agents (global)",
  "overview.healing_issues_panel.add_rule": "Ajouter une règle",
  "overview.healing_issues_panel.no_rules_configured": "Aucune règle d'alerte configurée. Ajoutez une règle pour commencer à surveiller.",
  "overview.healing_issues_panel.confidence_pct_suffix": "% de confiance",
  "overview.healing_issues_panel.spike_on": "pic sur",
  "overview.healing_issues_panel.correlated_events_prefix": "Événements corrélés (",
  "overview.healing_issues_panel.circuit_breaker_label": "disjoncteur",
  "overview.healing_issues_panel.auto_disabled_message": "Ce persona a été automatiquement désactivé comme réponse disjoncteur aux échecs répétés.",
  "overview.healing_issues_panel.execution_label": "Exécution :",
  "overview.healing_issues_panel.issue_marked_as": "Ce problème est marqué comme",
  "overview.healing_issues_panel.retry_in_progress": "Tentative en cours — le statut sera mis à jour quand c'est terminé.",
  "overview.healing_issues_panel.resolve_issue_title": "Marquer le problème comme résolu",

  // templates.gallery
  "templates.gallery.template_details_tabs_aria": "Détails du modèle",

  // templates.matrix
  "templates.matrix.answer_cell": "Réponse : {cell}",
  "templates.matrix.working_on": "En cours : {cells}",
  "templates.matrix.draft_ready_label": "Brouillon prêt",
  "templates.matrix.editing_cell": "Modification : {cell}",
  "templates.matrix.protocol_active": "Protocole actif",
  "templates.matrix.matrix_unavailable": "Données de matrice indisponibles.",
  "templates.matrix.persona_matrix_title": "Matrice de persona",
  "templates.matrix.cell_status_analyzing": "Analyse",
  "templates.matrix.cell_status_answered": "Répondu",
  "templates.matrix.cell_status_resolved": "Résolu",
  "templates.matrix.cell_status_input_needed": "Entrée requise",
  "templates.matrix.cell_status_missing_credential": "Identifiant manquant",
  "templates.matrix.cell_status_error": "Erreur",

  // templates.search
  "templates.search.coverage_filter_aria": "Filtre de couverture",
  "templates.search.search_suggestions_aria": "Suggestions de recherche",
  "templates.search.clear_search_aria": "Effacer la recherche",
  "templates.search.search_with_ai_aria": "Rechercher avec l'IA",

  // templates.questionnaire
  "templates.questionnaire.previous_question": "Question précédente",
  "templates.questionnaire.next_question": "Question suivante",
  "templates.questionnaire.go_to_question": "Aller à la question {number}",
  "templates.questionnaire.question_answered_suffix": " (répondue)",
  "templates.questionnaire.question_unanswered_suffix": " (sans réponse)",

  // templates.n8n
  "templates.n8n.dropzone_aria": "Déposer le fichier de workflow ou cliquer pour parcourir",
  "templates.n8n.paste_aria": "Contenu JSON du workflow",
  "templates.n8n.url_aria": "URL du workflow",
  "templates.n8n.url_placeholder": "https://raw.githubusercontent.com/.../workflow.json",
  "templates.n8n.url_format_github": "github.com/*/blob/*",
  "templates.n8n.url_format_gist": "gist.github.com/*",
  "templates.n8n.url_format_raw": "point de terminaison JSON brut",
  "templates.n8n.question_view_mode_aria": "Mode d'affichage des questions",
  "templates.n8n.wizard_progress_aria": "Progression de l'assistant d'import",
  "templates.n8n.wizard_steps_aria": "Étapes de l'assistant",
  "templates.n8n.transform_progress_aria": "Progression de la transformation",

  // templates.adopt_modal
  "templates.adopt_modal.credentials_required_title": "Identifiants requis",
  "templates.adopt_modal.credentials_required_body": "Ce modèle nécessite au moins un identifiant de chaque catégorie ci-dessous avant que l'adoption puisse continuer. Cliquez sur « Ajouter un identifiant » — vous reviendrez ici automatiquement une fois la configuration terminée.",
  "templates.adopt_modal.answered_of_total": "{answered} / {total} répondu(es)",
  "templates.adopt_modal.blocked_count": "{count} bloqué(s)",
  "templates.adopt_modal.question_number_of": "Question {current} sur {total}",
  "templates.adopt_modal.question_number_aria": "Question {number}",
  "templates.adopt_modal.navigate_hint": "pour naviguer",
  "templates.adopt_modal.enter_to_advance": "pour avancer",
  "templates.adopt_modal.previous": "Précédent",
  "templates.adopt_modal.live_preview": "Aperçu en direct",

  // releases.whats_new (all)
  "releases.whats_new.title": "Nouveautés",
  "releases.whats_new.loading": "Chargement des notes de version...",
  "releases.whats_new.no_updates": "Aucune mise à jour disponible",
  "releases.whats_new.version_label": "Version {version}",
  "releases.whats_new.released_on": "Publié le {date}",
  "releases.whats_new.new_features": "Nouvelles fonctionnalités",
  "releases.whats_new.improvements": "Améliorations",
  "releases.whats_new.bug_fixes": "Corrections de bugs",
  "releases.whats_new.breaking_changes": "Changements majeurs",
  "releases.whats_new.current_version": "Version actuelle : {version}",
  "releases.whats_new.up_to_date": "Vous êtes à jour",
  "releases.whats_new.update_available": "Mise à jour disponible",
  "releases.whats_new.install_update": "Installer la mise à jour",
  "releases.whats_new.view_changelog": "Voir le journal des modifications",
  "releases.whats_new.dismiss": "Ignorer",
  "releases.whats_new.close": "Fermer",
  "releases.whats_new.read_more": "Lire plus",
  "releases.whats_new.whats_new_badge": "Nouveau",
  "releases.whats_new.previous_releases": "Versions précédentes",
  "releases.whats_new.check_for_updates": "Vérifier les mises à jour",
  "releases.whats_new.checking": "Vérification...",
  "releases.whats_new.latest_version": "Dernière version",
  "releases.whats_new.changelog_empty": "Aucune entrée de journal des modifications",
  "releases.whats_new.install_restart": "Installer et redémarrer",
  "releases.whats_new.downloading": "Téléchargement...",
  "releases.whats_new.installed": "Installé",
  "releases.whats_new.failed_to_check": "Échec de la vérification des mises à jour",
  "releases.whats_new.failed_to_install": "Échec de l'installation",
  "releases.whats_new.release_notes": "Notes de version",
  "releases.whats_new.update_prompt": "Une nouvelle version de Personas est disponible. Installez maintenant pour bénéficier des dernières fonctionnalités et corrections.",
  "releases.whats_new.skip_version": "Passer cette version",
  "releases.whats_new.remind_later": "Me rappeler plus tard",
  "releases.whats_new.changes_count": "{count} changement(s)",
  "releases.whats_new.auto_update": "Mise à jour automatique",
  "releases.whats_new.auto_update_hint": "Installer automatiquement les mises à jour au redémarrage",
  "releases.whats_new.show_prerelease": "Afficher les versions préliminaires",
  "releases.whats_new.stable_only": "Versions stables uniquement",
  "releases.whats_new.build_info": "Info de build",
  "releases.whats_new.platform": "Plateforme",
  "releases.whats_new.commit": "Commit",
  "releases.whats_new.channel": "Canal",
  "releases.whats_new.channel_stable": "Stable",
  "releases.whats_new.channel_beta": "Beta",
  "releases.whats_new.channel_nightly": "Nightly",
  "releases.whats_new.feature_flag_hint": "Certaines fonctionnalités peuvent nécessiter un redémarrage pour prendre effet",
  "releases.whats_new.highlights": "Points forts",
  "releases.whats_new.all_changes": "Tous les changements",

  // plugins.dev_tools (all remaining)
  "plugins.dev_tools.title": "Dev Tools",
  "plugins.dev_tools.projects_tab": "Projets",
  "plugins.dev_tools.context_tab": "Contexte",
  "plugins.dev_tools.scanner_tab": "Analyseur",
  "plugins.dev_tools.runner_tab": "Exécuteur",
  "plugins.dev_tools.lifecycle_tab": "Cycle de vie",
  "plugins.dev_tools.triage_tab": "Tri",
  "plugins.dev_tools.no_project_selected": "Aucun projet sélectionné",
  "plugins.dev_tools.select_project": "Sélectionner un projet",
  "plugins.dev_tools.add_project": "Ajouter un projet",
  "plugins.dev_tools.project_name": "Nom du projet",
  "plugins.dev_tools.project_path": "Chemin du projet",
  "plugins.dev_tools.browse_path": "Parcourir...",
  "plugins.dev_tools.save_project": "Enregistrer le projet",
  "plugins.dev_tools.delete_project": "Supprimer le projet",
  "plugins.dev_tools.no_projects": "Aucun projet configuré",
  "plugins.dev_tools.add_first_project": "Ajoutez votre premier projet de base de code",
  "plugins.dev_tools.project_saved": "Projet enregistré",
  "plugins.dev_tools.project_deleted": "Projet supprimé",
  "plugins.dev_tools.loading_projects": "Chargement des projets...",
  "plugins.dev_tools.project_name_placeholder": "ex. Mon application",
  "plugins.dev_tools.project_path_placeholder": "/chemin/vers/votre/projet",
  "plugins.dev_tools.invalid_path": "Chemin de répertoire invalide",
  "plugins.dev_tools.path_required": "Le chemin est requis",
  "plugins.dev_tools.name_required": "Le nom est requis",
  "plugins.dev_tools.scan_codebase": "Analyser la base de code",
  "plugins.dev_tools.scanning": "Analyse en cours...",
  "plugins.dev_tools.scan_complete": "Analyse terminée",
  "plugins.dev_tools.scan_failed": "Analyse échouée",
  "plugins.dev_tools.files_found": "{count} fichier(s) trouvé(s)",
  "plugins.dev_tools.context_generated": "Contexte généré",
  "plugins.dev_tools.copy_context": "Copier le contexte",
  "plugins.dev_tools.context_copied": "Contexte copié",
  "plugins.dev_tools.no_context": "Aucun contexte disponible",
  "plugins.dev_tools.generate_context": "Générer le contexte",
  "plugins.dev_tools.generating_context": "Génération du contexte...",
  "plugins.dev_tools.context_size": "{size} caractères",
  "plugins.dev_tools.files_scanned": "{count} fichier(s) analysé(s)",
  "plugins.dev_tools.last_scanned": "Dernière analyse : {time}",
  "plugins.dev_tools.rescan": "Ré-analyser",
  "plugins.dev_tools.exclude_patterns": "Patterns d'exclusion",
  "plugins.dev_tools.add_exclude_pattern": "Ajouter un pattern d'exclusion",
  "plugins.dev_tools.exclude_placeholder": "ex. node_modules, *.log",
  "plugins.dev_tools.include_patterns": "Patterns d'inclusion",
  "plugins.dev_tools.max_file_size": "Taille max. de fichier",
  "plugins.dev_tools.max_depth": "Profondeur max.",
  "plugins.dev_tools.settings_saved": "Paramètres enregistrés",
  "plugins.dev_tools.run_command": "Exécuter la commande",
  "plugins.dev_tools.command_placeholder": "Entrez une commande...",
  "plugins.dev_tools.command_output": "Sortie de la commande",
  "plugins.dev_tools.clear_output": "Effacer la sortie",
  "plugins.dev_tools.running_command": "Exécution de la commande...",
  "plugins.dev_tools.command_failed": "Commande échouée",
  "plugins.dev_tools.exit_code": "Code de sortie : {code}",
  "plugins.dev_tools.connected_agents": "Agents connectés",
  "plugins.dev_tools.no_connected_agents": "Aucun agent connecté",
  "plugins.dev_tools.connect_agent": "Connecter un agent",
  "plugins.dev_tools.disconnect_agent": "Déconnecter l'agent",
  "plugins.dev_tools.agent_connected": "Agent connecté",
  "plugins.dev_tools.agent_disconnected": "Agent déconnecté",
  "plugins.dev_tools.workspace_label": "Espace de travail",
  "plugins.dev_tools.branch_label": "Branche",
  "plugins.dev_tools.commit_label": "Commit",
  "plugins.dev_tools.language_label": "Langage",
  "plugins.dev_tools.framework_label": "Framework",
  "plugins.dev_tools.dependencies_count": "{count} dépendance(s)",
  "plugins.dev_tools.open_in_ide": "Ouvrir dans l'IDE",
  "plugins.dev_tools.copy_path": "Copier le chemin",
  "plugins.dev_tools.path_copied": "Chemin copié",
  "plugins.dev_tools.project_settings": "Paramètres du projet",
  "plugins.dev_tools.edit_project": "Modifier le projet",
  "plugins.dev_tools.confirm_delete": "Supprimer ce projet ?",
  "plugins.dev_tools.cancel": "Annuler",
  "plugins.dev_tools.confirm": "Confirmer",
  "plugins.dev_tools.file_tree": "Arborescence",
  "plugins.dev_tools.search_files": "Rechercher des fichiers...",
  "plugins.dev_tools.no_files": "Aucun fichier trouvé",
  "plugins.dev_tools.loading_tree": "Chargement de l'arborescence...",
  "plugins.dev_tools.collapse_all": "Tout réduire",
  "plugins.dev_tools.expand_all": "Tout développer",
  "plugins.dev_tools.file_count": "{count} fichier(s)",
  "plugins.dev_tools.directory_count": "{count} dossier(s)",
  "plugins.dev_tools.total_size": "Taille totale : {size}",
  "plugins.dev_tools.attach_to_agent": "Joindre à l'agent",
  "plugins.dev_tools.detach_from_agent": "Détacher de l'agent",
  "plugins.dev_tools.context_attached": "Contexte joint à l'agent",
  "plugins.dev_tools.context_detached": "Contexte détaché de l'agent",
  "plugins.dev_tools.view_context": "Voir le contexte",
  "plugins.dev_tools.edit_context": "Modifier le contexte",
  "plugins.dev_tools.save_context": "Enregistrer le contexte",
  "plugins.dev_tools.context_saved": "Contexte enregistré",
  "plugins.dev_tools.context_placeholder": "Contexte de la base de code pour votre agent...",
  "plugins.dev_tools.auto_refresh": "Actualisation auto.",
  "plugins.dev_tools.manual_refresh": "Actualisation manuelle",
  "plugins.dev_tools.refresh_interval": "Intervalle d'actualisation",

  // plugins.dev_projects (all)
  "plugins.dev_projects.title": "Projets",
  "plugins.dev_projects.add_project": "Ajouter un projet",
  "plugins.dev_projects.no_projects": "Aucun projet pour l'instant",
  "plugins.dev_projects.project_name": "Nom du projet",
  "plugins.dev_projects.project_path": "Chemin",
  "plugins.dev_projects.save": "Enregistrer",
  "plugins.dev_projects.cancel": "Annuler",
  "plugins.dev_projects.delete": "Supprimer",
  "plugins.dev_projects.edit": "Modifier",
  "plugins.dev_projects.confirm_delete": "Supprimer ce projet ?",
  "plugins.dev_projects.name_placeholder": "ex. Backend API",
  "plugins.dev_projects.path_placeholder": "/chemin/vers/le/projet",
  "plugins.dev_projects.browse": "Parcourir",
  "plugins.dev_projects.last_scanned": "Dernière analyse : {time}",
  "plugins.dev_projects.never_scanned": "Jamais analysé",
  "plugins.dev_projects.scan_now": "Analyser maintenant",
  "plugins.dev_projects.scanning": "Analyse...",
  "plugins.dev_projects.files_count": "{count} fichier(s)",
  "plugins.dev_projects.open_folder": "Ouvrir le dossier",
  "plugins.dev_projects.copy_path": "Copier le chemin",
  "plugins.dev_projects.connected_agents_count": "{count} agent(s) connecté(s)",
  "plugins.dev_projects.no_connected_agents": "Aucun agent connecté",
  "plugins.dev_projects.project_settings": "Paramètres",
  "plugins.dev_projects.branch": "Branche : {branch}",
  "plugins.dev_projects.language_detected": "Langage : {lang}",
  "plugins.dev_projects.framework_detected": "Framework : {fw}",
  "plugins.dev_projects.type_label": "Type",
  "plugins.dev_projects.description_label": "Description",
  "plugins.dev_projects.description_placeholder": "Description courte du projet...",
  "plugins.dev_projects.tags_label": "Tags",
  "plugins.dev_projects.add_tag": "Ajouter un tag",
  "plugins.dev_projects.tag_placeholder": "ex. backend, api, python",
  "plugins.dev_projects.auto_scan_label": "Analyse automatique",
  "plugins.dev_projects.auto_scan_hint": "Ré-analyser automatiquement lors des changements de fichiers",
  "plugins.dev_projects.exclude_patterns_label": "Patterns d'exclusion",
  "plugins.dev_projects.add_pattern": "Ajouter un pattern",
  "plugins.dev_projects.pattern_placeholder": "ex. node_modules/**",
  "plugins.dev_projects.max_depth_label": "Profondeur maximale",
  "plugins.dev_projects.max_file_size_label": "Taille max. de fichier",
  "plugins.dev_projects.save_settings": "Enregistrer les paramètres",

  // plugins.dev_context (all)
  "plugins.dev_context.title": "Contexte",
  "plugins.dev_context.no_project": "Aucun projet sélectionné",
  "plugins.dev_context.loading": "Chargement du contexte...",
  "plugins.dev_context.generate": "Générer le contexte",
  "plugins.dev_context.generating": "Génération...",
  "plugins.dev_context.copy": "Copier",
  "plugins.dev_context.copied": "Copié",
  "plugins.dev_context.size_label": "Taille : {size}",
  "plugins.dev_context.files_label": "Fichiers : {count}",
  "plugins.dev_context.last_generated": "Généré {time}",
  "plugins.dev_context.regenerate": "Régénérer",
  "plugins.dev_context.attach_to_agent": "Joindre à l'agent",

  // plugins.dev_scanner (all)
  "plugins.dev_scanner.title": "Analyseur de code",
  "plugins.dev_scanner.scan": "Analyser",
  "plugins.dev_scanner.scanning": "Analyse en cours...",
  "plugins.dev_scanner.no_project": "Aucun projet sélectionné",
  "plugins.dev_scanner.results_title": "Résultats de l'analyse",
  "plugins.dev_scanner.no_issues": "Aucun problème trouvé",
  "plugins.dev_scanner.issues_count": "{count} problème(s) trouvé(s)",
  "plugins.dev_scanner.severity_error": "Erreur",
  "plugins.dev_scanner.severity_warning": "Avertissement",
  "plugins.dev_scanner.severity_info": "Info",
  "plugins.dev_scanner.file_label": "Fichier",
  "plugins.dev_scanner.line_label": "Ligne",
  "plugins.dev_scanner.message_label": "Message",
  "plugins.dev_scanner.fix_with_ai": "Corriger avec l'IA",
  "plugins.dev_scanner.view_file": "Voir le fichier",
  "plugins.dev_scanner.filter_severity": "Filtrer par sévérité",
  "plugins.dev_scanner.filter_file": "Filtrer par fichier",
  "plugins.dev_scanner.last_scan": "Dernière analyse : {time}",

  // plugins.dev_runner (all)
  "plugins.dev_runner.title": "Exécuteur",
  "plugins.dev_runner.run": "Exécuter",
  "plugins.dev_runner.running": "En cours...",
  "plugins.dev_runner.stop": "Arrêter",
  "plugins.dev_runner.clear": "Effacer",
  "plugins.dev_runner.no_project": "Aucun projet sélectionné",
  "plugins.dev_runner.command_placeholder": "Entrez une commande à exécuter...",
  "plugins.dev_runner.output_label": "Sortie",
  "plugins.dev_runner.no_output": "Aucune sortie pour l'instant",
  "plugins.dev_runner.exit_code": "Code de sortie : {code}",
  "plugins.dev_runner.duration": "Durée : {duration}",
  "plugins.dev_runner.saved_commands": "Commandes enregistrées",
  "plugins.dev_runner.save_command": "Enregistrer la commande",
  "plugins.dev_runner.command_name_placeholder": "Nom de la commande...",
  "plugins.dev_runner.delete_command": "Supprimer",
  "plugins.dev_runner.no_saved_commands": "Aucune commande enregistrée",
  "plugins.dev_runner.environment_label": "Variables d'environnement",
  "plugins.dev_runner.add_env_var": "Ajouter une variable",
  "plugins.dev_runner.working_dir_label": "Répertoire de travail",
  "plugins.dev_runner.shell_label": "Shell",
  "plugins.dev_runner.timeout_label": "Délai d'expiration (s)",

  // plugins.dev_lifecycle (all)
  "plugins.dev_lifecycle.title": "Cycle de vie",
  "plugins.dev_lifecycle.no_project": "Aucun projet sélectionné",
  "plugins.dev_lifecycle.pipeline_label": "Pipeline",
  "plugins.dev_lifecycle.stage_label": "Étape",
  "plugins.dev_lifecycle.run_pipeline": "Exécuter le pipeline",
  "plugins.dev_lifecycle.running": "En cours...",
  "plugins.dev_lifecycle.pipeline_complete": "Pipeline terminé",
  "plugins.dev_lifecycle.pipeline_failed": "Échec du pipeline",
  "plugins.dev_lifecycle.stage_passed": "Étape réussie",
  "plugins.dev_lifecycle.stage_failed": "Étape échouée",
  "plugins.dev_lifecycle.stage_skipped": "Étape ignorée",
  "plugins.dev_lifecycle.no_pipelines": "Aucun pipeline configuré",
  "plugins.dev_lifecycle.add_pipeline": "Ajouter un pipeline",
  "plugins.dev_lifecycle.pipeline_name": "Nom du pipeline",
  "plugins.dev_lifecycle.pipeline_stages": "Étapes",
  "plugins.dev_lifecycle.add_stage": "Ajouter une étape",
  "plugins.dev_lifecycle.stage_name": "Nom de l'étape",
  "plugins.dev_lifecycle.stage_command": "Commande",
  "plugins.dev_lifecycle.stage_required": "Requise",
  "plugins.dev_lifecycle.delete_stage": "Supprimer l'étape",
  "plugins.dev_lifecycle.save_pipeline": "Enregistrer le pipeline",
  "plugins.dev_lifecycle.delete_pipeline": "Supprimer le pipeline",
  "plugins.dev_lifecycle.confirm_delete": "Supprimer ce pipeline ?",
  "plugins.dev_lifecycle.history_label": "Historique",
  "plugins.dev_lifecycle.no_history": "Aucun historique disponible",
  "plugins.dev_lifecycle.duration_label": "Durée : {duration}",
  "plugins.dev_lifecycle.triggered_by": "Déclenché par : {trigger}",
  "plugins.dev_lifecycle.view_logs": "Voir les journaux",
  "plugins.dev_lifecycle.rerun": "Ré-exécuter",
  "plugins.dev_lifecycle.status_label": "Statut",
  "plugins.dev_lifecycle.trigger_on_push": "Déclencher au push",
  "plugins.dev_lifecycle.trigger_on_pr": "Déclencher sur PR",
  "plugins.dev_lifecycle.trigger_manual": "Manuel uniquement",
  "plugins.dev_lifecycle.environment_label": "Environnement",
  "plugins.dev_lifecycle.production": "Production",
  "plugins.dev_lifecycle.staging": "Staging",
  "plugins.dev_lifecycle.development": "Développement",
  "plugins.dev_lifecycle.notifications_label": "Notifications",
  "plugins.dev_lifecycle.notify_on_failure": "Notifier en cas d'échec",
  "plugins.dev_lifecycle.notify_on_success": "Notifier en cas de succès",

  // plugins.dev_triage (all)
  "plugins.dev_triage.title": "Tri",
  "plugins.dev_triage.no_project": "Aucun projet sélectionné",
  "plugins.dev_triage.scan_issues": "Analyser les problèmes",
  "plugins.dev_triage.scanning": "Analyse en cours...",
  "plugins.dev_triage.no_issues": "Aucun problème trouvé",
  "plugins.dev_triage.issues_count": "{count} problème(s)",
  "plugins.dev_triage.priority_high": "Haute",
  "plugins.dev_triage.priority_medium": "Moyenne",
  "plugins.dev_triage.priority_low": "Faible",

  // plugins.drive (all)
  "plugins.drive.title": "Drive",
  "plugins.drive.connect": "Connecter Google Drive",
  "plugins.drive.connected_as": "Connecté en tant que {email}",
  "plugins.drive.disconnect": "Déconnecter",
  "plugins.drive.browse": "Parcourir les fichiers",
  "plugins.drive.search_placeholder": "Rechercher dans Drive...",
  "plugins.drive.loading": "Chargement...",
  "plugins.drive.no_files": "Aucun fichier trouvé",
  "plugins.drive.upload": "Téléverser",
  "plugins.drive.create_folder": "Créer un dossier",
  "plugins.drive.folder_name_placeholder": "Nom du dossier...",
  "plugins.drive.download": "Télécharger",
  "plugins.drive.delete": "Supprimer",
  "plugins.drive.rename": "Renommer",
  "plugins.drive.share": "Partager",
  "plugins.drive.copy_link": "Copier le lien",
  "plugins.drive.link_copied": "Lien copié",
  "plugins.drive.file_size": "Taille : {size}",
  "plugins.drive.modified_at": "Modifié : {time}",
  "plugins.drive.owner": "Propriétaire : {owner}",
  "plugins.drive.type_label": "Type",
  "plugins.drive.select_file": "Sélectionner ce fichier",
  "plugins.drive.selected_files": "{count} fichier(s) sélectionné(s)",
  "plugins.drive.attach_to_agent": "Joindre à l'agent",
  "plugins.drive.files_attached": "Fichiers joints à l'agent",
  "plugins.drive.root_label": "Mon Drive",
  "plugins.drive.shared_label": "Partagé avec moi",
  "plugins.drive.recent_label": "Récents",
  "plugins.drive.starred_label": "Suivis",
  "plugins.drive.trash_label": "Corbeille",
  "plugins.drive.quota_used": "{used} utilisé(s) sur {total}",
  "plugins.drive.sync_status": "Statut de synchronisation",
  "plugins.drive.last_sync": "Dernière sync. : {time}",
  "plugins.drive.sync_now": "Synchroniser maintenant",
  "plugins.drive.syncing": "Synchronisation...",
  "plugins.drive.sort_by_name": "Trier par nom",
  "plugins.drive.sort_by_date": "Trier par date",
  "plugins.drive.sort_by_size": "Trier par taille",
  "plugins.drive.view_list": "Vue liste",
  "plugins.drive.view_grid": "Vue grille",
  "plugins.drive.filter_type": "Filtrer par type",
  "plugins.drive.all_types": "Tous les types",
  "plugins.drive.documents": "Documents",
  "plugins.drive.spreadsheets": "Tableurs",
  "plugins.drive.presentations": "Présentations",
  "plugins.drive.images": "Images",
  "plugins.drive.videos": "Vidéos",
  "plugins.drive.audio": "Audio",
  "plugins.drive.pdfs": "PDF",
  "plugins.drive.folders": "Dossiers",
  "plugins.drive.upload_progress": "Téléversement : {percent}%",
  "plugins.drive.upload_complete": "Téléversement terminé",
  "plugins.drive.upload_failed": "Échec du téléversement",
  "plugins.drive.delete_confirm": "Supprimer ce fichier ?",
  "plugins.drive.move_to_trash": "Déplacer vers la corbeille",
  "plugins.drive.restore": "Restaurer",
  "plugins.drive.permanent_delete": "Supprimer définitivement",
  "plugins.drive.preview": "Aperçu",
  "plugins.drive.open_in_drive": "Ouvrir dans Drive",
  "plugins.drive.not_connected": "Drive non connecté",
  "plugins.drive.connect_hint": "Connectez Google Drive pour accéder à vos fichiers depuis vos agents",

  // plugins.obsidian (all)
  "plugins.obsidian.title": "Obsidian",
  "plugins.obsidian.connect_vault": "Connecter le coffre Obsidian",
  "plugins.obsidian.vault_path": "Chemin du coffre",
  "plugins.obsidian.browse_vault": "Parcourir...",
  "plugins.obsidian.connected_vault": "Coffre connecté : {path}",
  "plugins.obsidian.disconnect": "Déconnecter",
  "plugins.obsidian.search_notes": "Rechercher des notes...",
  "plugins.obsidian.loading": "Chargement...",
  "plugins.obsidian.no_notes": "Aucune note trouvée",
  "plugins.obsidian.notes_count": "{count} note(s)",
  "plugins.obsidian.attach_note": "Joindre la note",
  "plugins.obsidian.open_note": "Ouvrir dans Obsidian",
  "plugins.obsidian.view_note": "Voir la note",
  "plugins.obsidian.note_title": "Titre",
  "plugins.obsidian.note_tags": "Tags",
  "plugins.obsidian.note_modified": "Modifié : {time}",
  "plugins.obsidian.note_size": "Taille : {size}",
  "plugins.obsidian.filter_tag": "Filtrer par tag",
  "plugins.obsidian.all_tags": "Tous les tags",
  "plugins.obsidian.filter_folder": "Filtrer par dossier",
  "plugins.obsidian.all_folders": "Tous les dossiers",
  "plugins.obsidian.sort_by_name": "Trier par nom",
  "plugins.obsidian.sort_by_date": "Trier par date",
  "plugins.obsidian.sync_vault": "Synchroniser le coffre",
  "plugins.obsidian.syncing": "Synchronisation...",
  "plugins.obsidian.last_sync": "Dernière sync. : {time}",
  "plugins.obsidian.never_synced": "Jamais synchronisé",
  "plugins.obsidian.vault_not_found": "Coffre introuvable au chemin indiqué",
  "plugins.obsidian.select_notes": "Sélectionner les notes",
  "plugins.obsidian.selected_count": "{count} sélectionnée(s)",
  "plugins.obsidian.attach_selected": "Joindre les sélectionnées",
  "plugins.obsidian.notes_attached": "Notes jointes à l'agent",
  "plugins.obsidian.graph_view": "Vue graphe",
  "plugins.obsidian.list_view": "Vue liste",
  "plugins.obsidian.no_vault_connected": "Aucun coffre Obsidian connecté",
  "plugins.obsidian.connect_hint": "Connectez votre coffre Obsidian pour accéder à vos notes depuis vos agents",
  "plugins.obsidian.invalid_path": "Chemin de coffre invalide",
  "plugins.obsidian.path_required": "Le chemin du coffre est requis",
  "plugins.obsidian.save": "Enregistrer",
  "plugins.obsidian.cancel": "Annuler",
  "plugins.obsidian.recent_notes": "Notes récentes",
  "plugins.obsidian.pinned_notes": "Notes épinglées",
  "plugins.obsidian.pin_note": "Épingler la note",
  "plugins.obsidian.unpin_note": "Désépingler la note",
  "plugins.obsidian.copy_link": "Copier le lien",
  "plugins.obsidian.link_copied": "Lien copié",
  "plugins.obsidian.preview_note": "Aperçu de la note",
  "plugins.obsidian.note_content": "Contenu de la note",
  "plugins.obsidian.word_count": "{count} mot(s)",
  "plugins.obsidian.char_count": "{count} caractère(s)",

  // plugins.obsidian_brain
  "plugins.obsidian_brain": "Cerveau Obsidian",

  // plugins.artist remaining
  "plugins.artist.title": "Studio artistique",
  "plugins.artist.blender_tab": "Blender",
  "plugins.artist.gallery_tab": "Galerie",
  "plugins.artist.media_studio_tab": "Studio média",
  "plugins.artist.loading": "Chargement...",
  "plugins.artist.no_project": "Aucun projet sélectionné",
  "plugins.artist.new_session": "Nouvelle session",
  "plugins.artist.session_name": "Nom de la session",
  "plugins.artist.session_placeholder": "Nom de la session créative...",
  "plugins.artist.save_session": "Enregistrer la session",
  "plugins.artist.delete_session": "Supprimer la session",
  "plugins.artist.sessions_label": "Sessions",
  "plugins.artist.no_sessions": "Aucune session pour l'instant",
  "plugins.artist.start_creating": "Commencez à créer",
  "plugins.artist.generate": "Générer",
  "plugins.artist.generating": "Génération...",
  "plugins.artist.prompt_placeholder": "Décrivez ce que vous souhaitez créer...",
  "plugins.artist.style_label": "Style",
  "plugins.artist.model_label": "Modèle",
  "plugins.artist.size_label": "Taille",
  "plugins.artist.quality_label": "Qualité",
  "plugins.artist.save_to_gallery": "Enregistrer dans la galerie",
  "plugins.artist.download": "Télécharger",
  "plugins.artist.copy_prompt": "Copier le prompt",
  "plugins.artist.prompt_copied": "Prompt copié",
  "plugins.artist.clear": "Effacer",
  "plugins.artist.history_label": "Historique",
  "plugins.artist.no_history": "Aucun historique pour l'instant",
  "plugins.artist.generation_failed": "Génération échouée",
  "plugins.artist.view_full": "Vue plein écran",
  "plugins.artist.close_preview": "Fermer l'aperçu",
  "plugins.artist.add_to_canvas": "Ajouter au canevas",
  "plugins.artist.canvas_label": "Canevas",
  "plugins.artist.clear_canvas": "Effacer le canevas",
  "plugins.artist.export_canvas": "Exporter le canevas",
  "plugins.artist.zoom_in": "Zoom avant",
  "plugins.artist.zoom_out": "Zoom arrière",
  "plugins.artist.fit_to_screen": "Ajuster à l'écran",
  "plugins.artist.grid_toggle": "Afficher/masquer la grille",
  "plugins.artist.snap_to_grid": "Aligner sur la grille",
  "plugins.artist.undo": "Annuler",
  "plugins.artist.redo": "Rétablir",

  // plugins.artist_gallery
  "plugins.artist_gallery.all_assets": "Toutes les ressources",
  "plugins.artist_gallery.search_placeholder": "Rechercher des ressources...",
  "plugins.artist_gallery.no_assets": "Aucune ressource pour l'instant",
  "plugins.artist_gallery.upload": "Téléverser",
  "plugins.artist_gallery.filter_type": "Filtrer par type",
  "plugins.artist_gallery.sort_label": "Trier",
  "plugins.artist_gallery.delete_asset": "Supprimer la ressource",
  "plugins.artist_gallery.asset_details": "Détails de la ressource",
  "plugins.artist_gallery.copy_url": "Copier l'URL",
  "plugins.artist_gallery.url_copied": "URL copiée",
  "plugins.artist_gallery.tags_label": "Tags",
  "plugins.artist_gallery.add_tag": "Ajouter un tag",

  // plugins.artist_media_studio
  "plugins.artist_media_studio.new_composition": "Nouvelle composition",
  "plugins.artist_media_studio.save_composition": "Enregistrer la composition",
  "plugins.artist_media_studio.export_composition": "Exporter la composition",
  "plugins.artist_media_studio.composition_name": "Nom de la composition",
  "plugins.artist_media_studio.no_compositions": "Aucune composition pour l'instant",

  // plugins.research_lab
  "plugins.research_lab.title": "Laboratoire de recherche",
  "plugins.research_lab.new_project": "Nouveau projet",
  "plugins.research_lab.no_projects": "Aucun projet de recherche",
  "plugins.research_lab.loading": "Chargement...",
  "plugins.research_lab.sources_tab": "Sources",
  "plugins.research_lab.hypotheses_tab": "Hypothèses",
  "plugins.research_lab.experiments_tab": "Expériences",
  "plugins.research_lab.findings_tab": "Résultats",
  "plugins.research_lab.report_tab": "Rapport",
  "plugins.research_lab.add_source": "Ajouter une source",
  "plugins.research_lab.add_hypothesis": "Ajouter une hypothèse",
  "plugins.research_lab.add_experiment": "Ajouter une expérience",
  "plugins.research_lab.add_finding": "Ajouter un résultat",

  // settings
  "settings.account": "Compte",
  "settings.appearance": "Apparence",
  "settings.engine": "Moteur",
  "settings.byom": "BYOM",

  // settings.portability remaining
  "settings.portability.export_all": "Tout exporter",
  "settings.portability.import_backup": "Importer une sauvegarde",
  "settings.portability.exporting": "Export en cours...",
  "settings.portability.importing": "Import en cours...",
  "settings.portability.export_complete": "Export terminé",
  "settings.portability.import_complete": "Import terminé",

  // shared.sidebar_extra
  "shared.sidebar_extra.schedules_label": "Planifications",
  "shared.sidebar_extra.quality_gates": "Filtres de contenu",
  "shared.sidebar_extra.config_resolution": "Configuration de l'agent",
  "shared.sidebar_extra.search_placeholder": "Rechercher...",
  "shared.sidebar_extra.new_agent": "Nouvel agent",
  "shared.sidebar_extra.all_agents": "Tous les agents",
  "shared.sidebar_extra.recent_label": "Récents",
  "shared.sidebar_extra.favorites_label": "Favoris",
  "shared.sidebar_extra.no_recent": "Aucun agent récent",
  "shared.sidebar_extra.no_favorites": "Aucun favori",
  "shared.sidebar_extra.pinned_label": "Épinglés",

  // shared.progress_extra
  "shared.progress_extra.step_label": "Étape {current}/{total}",
  "shared.progress_extra.elapsed_label": "Temps écoulé : {elapsed}",
  "shared.progress_extra.remaining_label": "Temps restant : {remaining}",
  "shared.progress_extra.overall_progress": "Progression globale",
  "shared.progress_extra.phase_label": "Phase : {phase}",
  "shared.progress_extra.operation_label": "Opération : {operation}",
  "shared.progress_extra.retry_label": "Tentative {count}",
  "shared.progress_extra.success_label": "Succès",
  "shared.progress_extra.error_label": "Erreur",
  "shared.progress_extra.warning_label": "Avertissement",
  "shared.progress_extra.info_label": "Information",

  // shared.use_cases_extra
  "shared.use_cases_extra.trigger_type_label": "Type de déclencheur",
  "shared.use_cases_extra.trigger_active_label": "Déclencheur actif",
  "shared.use_cases_extra.subscription_label": "Abonnement",
  "shared.use_cases_extra.no_trigger_configured": "Aucun déclencheur configuré",
  "shared.use_cases_extra.run_count_label": "{count} exécution(s)",
  "shared.use_cases_extra.last_run_label": "Dernier lancement : {time}",
  "shared.use_cases_extra.success_rate_label": "Taux de succès : {rate}%",
  "shared.use_cases_extra.avg_duration_label": "Durée moy. : {duration}",
  "shared.use_cases_extra.avg_cost_label": "Coût moy. : {cost}",
  "shared.use_cases_extra.configure_notifications": "Configurer les notifications",

  // shared.draft_editor
  "shared.draft_editor.system_prompt_label": "Prompt système",
  "shared.draft_editor.use_cases_label": "Cas d'usage",
  "shared.draft_editor.add_use_case": "Ajouter un cas d'usage",
  "shared.draft_editor.use_case_title_placeholder": "Titre du cas d'usage...",
  "shared.draft_editor.use_case_description_placeholder": "Description du cas d'usage...",
  "shared.draft_editor.remove_use_case": "Supprimer le cas d'usage",
  "shared.draft_editor.tools_label": "Outils",
  "shared.draft_editor.no_tools": "Aucun outil assigné",
  "shared.draft_editor.triggers_label": "Déclencheurs",
  "shared.draft_editor.no_triggers": "Aucun déclencheur configuré",
  "shared.draft_editor.edit_tabs_label": "Onglets de modification",
  "shared.draft_editor.request_ai_adjustments": "Demander des ajustements IA",
  "shared.draft_editor.edit_raw_json_hint": "Modifier le JSON brut",
  "shared.draft_editor.no_custom_sections": "Aucune section personnalisée",
  "shared.draft_editor.no_content_to_preview": "Aucun contenu à afficher en aperçu",

  // shared.terminal_extra
  "shared.terminal_extra.copy_output": "Copier la sortie",
  "shared.terminal_extra.download_log": "Télécharger le journal",
  "shared.terminal_extra.wrap_lines": "Retour à la ligne",
  "shared.terminal_extra.font_size_label": "Taille de police",
  "shared.terminal_extra.theme_label": "Thème",
  "shared.terminal_extra.clear_terminal": "Effacer le terminal",
  "shared.terminal_extra.fullscreen": "Plein écran",

  // shared.forms_extra
  "shared.forms_extra.char_count": "{count}/{max} caractères",
  "shared.forms_extra.optional_label": "(facultatif)",
  "shared.forms_extra.required_label": "(requis)",
  "shared.forms_extra.field_hint": "Astuce : {hint}",
  "shared.forms_extra.validation_error": "Erreur de validation : {message}",

  // shared.execution_detail
  "shared.execution_detail.input_section": "Entrée",
  "shared.execution_detail.output_section": "Sortie",
  "shared.execution_detail.metadata_section": "Métadonnées",
  "shared.execution_detail.timeline_section": "Chronologie",
  "shared.execution_detail.ai_analysis": "Analyse IA",

  // shared.reasoning_trace
  "shared.reasoning_trace.thinking_label": "Réflexion",
  "shared.reasoning_trace.step_label": "Étape {n}",
  "shared.reasoning_trace.conclusion_label": "Conclusion",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function escapeValue(val) {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function findInsertionPoints(lines) {
  const result = new Map();
  const stack = [];
  let inExport = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!inExport) {
      if (/^export\s+const\s+\w+\s*=\s*\{/.test(trimmed)) {
        inExport = true;
        stack.push({ key: '__root__', startLine: i });
      }
      continue;
    }

    const dqRe = /"(?:[^"\\]|\\.)*"/g;
    const sqRe = /'(?:[^'\\]|\\.)*'/g;
    const stripped = trimmed.replace(dqRe, '""').replace(sqRe, "''");

    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    const netClose = closes - opens;

    const keyMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/);
    if (keyMatch) {
      const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
      const afterColon = stripped.slice(stripped.indexOf(':') + 1);
      if (afterColon.includes('{') && opens > closes) {
        stack.push({ key, startLine: i });
      }
    }

    for (let c = 0; c < netClose; c++) {
      if (stack.length > 0) {
        const frame = stack.pop();
        const dotPath = stack.map(f => f.key).filter(k => k !== '__root__').concat(frame.key).join('.');
        result.set(dotPath, i);
      }
    }
  }
  return result;
}

const frLines = readFileSync(FR_PATH, 'utf-8').split('\n');
const insertionPoints = findInsertionPoints(frLines);

// Group by parent
const byParent = new Map();
for (const [fullKey, frVal] of Object.entries(TRANSLATIONS)) {
  const parts = fullKey.split('.');
  const leafKey = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join('.');
  if (!byParent.has(parentPath)) byParent.set(parentPath, []);
  byParent.get(parentPath).push({ leafKey, frVal, fullKey });
}

// Find which parents exist and which don't
const existingParents = [];
const missingParents = new Map(); // parentPath -> {keys, topLevel, subKey}

for (const [parent, keys] of byParent.entries()) {
  if (insertionPoints.has(parent)) {
    existingParents.push({ parent, keys, lineIdx: insertionPoints.get(parent) });
  } else {
    missingParents.set(parent, keys);
  }
}

// Sort existing parents descending by line for bottom-up insertion
existingParents.sort((a, b) => b.lineIdx - a.lineIdx);

function getIndent(lines, closingLineIdx) {
  for (let i = closingLineIdx - 1; i >= 0; i--) {
    const l = lines[i];
    const trimmed = l.trim();
    if (trimmed && !trimmed.startsWith('//')) {
      const match = l.match(/^(\s+)/);
      return match ? match[1] : '      ';
    }
  }
  return '      ';
}

const DATE_TAG = '// @llm-translated 2026-04-17';
const outputLines = [...frLines];
let totalInserted = 0;

// Insert into existing parents
for (const { parent, keys, lineIdx } of existingParents) {
  const indent = getIndent(outputLines, lineIdx);
  const insertLines = [];
  for (const { leafKey, frVal } of keys) {
    insertLines.push(`${indent}${DATE_TAG}`);
    insertLines.push(`${indent}${leafKey}: "${escapeValue(frVal)}",`);
  }
  outputLines.splice(lineIdx, 0, ...insertLines);
  totalInserted += keys.length;
}

// Now find top-level closing braces for missing sections
const updatedPoints = findInsertionPoints(outputLines);

// Group missing parents by their top-level section
const missingBySectionGroup = new Map(); // topLevel -> [{subKey, leafKeys}]
for (const [parent, keys] of missingParents.entries()) {
  const parts = parent.split('.');
  const topLevel = parts[0];
  if (!missingBySectionGroup.has(topLevel)) missingBySectionGroup.set(topLevel, []);
  missingBySectionGroup.get(topLevel).push({ parent, subKey: parts[1], keys });
}

// Insert new subsections before the closing of their top-level section
// Sort top-levels by their closing line descending
const topLevelEntries = [...missingBySectionGroup.entries()].map(([topLevel, subs]) => {
  return { topLevel, subs, lineIdx: updatedPoints.get(topLevel) };
}).filter(e => e.lineIdx !== undefined);

topLevelEntries.sort((a, b) => b.lineIdx - a.lineIdx);

for (const { topLevel, subs, lineIdx } of topLevelEntries) {
  // For each missing sub-section, create a new block
  const topIndent = getIndent(outputLines, lineIdx);
  const subIndent = topIndent + '  ';
  const insertLines = [];

  // Sort subs alphabetically
  subs.sort((a, b) => a.subKey.localeCompare(b.subKey));

  for (const { subKey, keys } of subs) {
    insertLines.push(`${topIndent}${DATE_TAG}`);
    insertLines.push(`${topIndent}${subKey}: {`);
    for (const { leafKey, frVal } of keys) {
      insertLines.push(`${subIndent}${DATE_TAG}`);
      insertLines.push(`${subIndent}${leafKey}: "${escapeValue(frVal)}",`);
    }
    insertLines.push(`${topIndent}},`);
  }

  outputLines.splice(lineIdx, 0, ...insertLines);
  totalInserted += subs.reduce((s, sub) => s + sub.keys.length, 0);
}

// Handle completely new top-level sections (releases, etc.)
const topLevelsNeeded = [...missingBySectionGroup.keys()].filter(tl => !updatedPoints.has(tl));
if (topLevelsNeeded.length > 0) {
  // Find the closing brace of the entire export object
  const lines2 = outputLines;
  let closingIdx = lines2.length - 1;
  for (let i = lines2.length - 1; i >= 0; i--) {
    if (lines2[i].trim() === '};') {
      closingIdx = i;
      break;
    }
  }

  for (const topLevel of topLevelsNeeded) {
    const subs = missingBySectionGroup.get(topLevel);
    const topIndent = '  ';
    const subIndent = '    ';
    const leafIndent = '    ';
    const insertLines = [];
    insertLines.push(`${topIndent}${DATE_TAG}`);
    insertLines.push(`${topIndent}${topLevel}: {`);

    for (const { subKey, keys } of subs.sort((a,b) => a.subKey.localeCompare(b.subKey))) {
      if (subKey) {
        insertLines.push(`${subIndent}${DATE_TAG}`);
        insertLines.push(`${subIndent}${subKey}: {`);
        for (const { leafKey, frVal } of keys) {
          insertLines.push(`${leafIndent}  ${DATE_TAG}`);
          insertLines.push(`${leafIndent}  ${leafKey}: "${escapeValue(frVal)}",`);
        }
        insertLines.push(`${subIndent}},`);
      }
    }

    insertLines.push(`${topIndent}},`);
    outputLines.splice(closingIdx, 0, ...insertLines);
    totalInserted += subs.reduce((s, sub) => s + sub.keys.length, 0);
    closingIdx += insertLines.length; // adjust for next insertion
  }
}

writeFileSync(FR_PATH, outputLines.join('\n'), 'utf-8');
console.log(`Total inserted: ${totalInserted}`);
console.log(`Missing parents handled as new sections: ${[...missingParents.keys()].length}`);
