/**
 * Fills missing French keys in fr.ts by inserting translated values.
 * Strategy: parse fr.ts line by line, track structure, and insert missing keys
 * at the right positions.
 */
import { readFileSync, writeFileSync } from 'fs';

const FR_PATH = 'C:/Users/kazda/kiro/personas/src/i18n/fr.ts';
const EN_PATH = 'C:/Users/kazda/kiro/personas/src/i18n/en.ts';
const MISSING_PATH = 'C:/Users/kazda/AppData/Local/Temp/en_missing_for_fr.json';

// ── Translations ────────────────────────────────────────────────────────────
// All 1467 missing keys translated to French.
// Placeholders ({count}, {{name}}, etc.) and brand names preserved exactly.
const TRANSLATIONS = {
  "common.optional": "facultatif",
  "sidebar.quality_gates": "Filtres de contenu",
  "sidebar.config_resolution": "Configuration de l'agent",

  // agents.executions
  "agents.executions.depth_label": "Profondeur :",
  "agents.executions.active_count_label": "Actif ({count})",
  "agents.executions.completed_count_label": "Terminé ({count})",
  "agents.executions.metadata_section": "Métadonnées",
  "agents.executions.chain_id_prefix": "Chaîne : {id}",
  "agents.executions.chain_total_duration": "Total : {duration}",
  "agents.executions.zero_ms": "0ms",
  "agents.executions.tool_calls_count": "{count} appel d'outil",
  "agents.executions.tool_calls_count_other": "{count} appels d'outils",
  "agents.executions.unique_tools_count": "({count} unique)",
  "agents.executions.prev_error_nav": "Erreur précédente (Maj+E)",
  "agents.executions.next_error_nav": "Erreur suivante (E)",
  "agents.executions.runner_input_placeholder": "{\"key\": \"value\"}",

  // agents.lab
  "agents.lab.objective_warning": "Problème avec l'objectif de fitness",
  "agents.lab.objective_fallback_toast": "L'évolution a utilisé les poids de fitness par défaut — vérifiez les paramètres de l'objectif",

  // agents.design
  "agents.design.conv_controls_aria": "Contrôles de la conversation de conception",

  // agents.connectors
  "agents.connectors.auto_input_schema_placeholder": "string",
  "agents.connectors.auto_github_token_needs": "Votre token nécessite les portées {scopes}. Mettez à jour votre token sur github.com/settings/tokens.",
  "agents.connectors.auto_fallback_title": "Bascule vers le connecteur direct en cas d'échec",

  // agents.model_config
  "agents.model_config.model_name_placeholder_override": "ex. claude-sonnet-4-20250514",

  // agents.settings_status
  "agents.settings_status.speak_as": "Parler en tant que",
  "agents.settings_status.no_twins_configured": "Aucun jumeau configuré. Ouvrez le plugin Jumeau pour en créer un — cet agent pourra alors l'adopter.",
  "agents.settings_status.twin_profile_aria": "Profil de jumeau adopté par cet agent",

  // agents.tool_runner
  "agents.tool_runner.input_json_placeholder": "valeur",

  // agents.prompt_editor
  "agents.prompt_editor.sections_aria": "Sections du prompt",

  // vault.list
  "vault.list.sort_label": "Trier :",

  // vault.import
  "vault.import.parse_secrets": "Analyser les secrets",
  "vault.import.selected_for_import": "sélectionné(s) pour import",
  "vault.import.auto_detected": "Détecté automatiquement",
  "vault.import.sync_supported": "Synchronisation supportée",
  "vault.import.secrets_found_one": "{count} secret trouvé",
  "vault.import.secrets_found_other": "{count} secrets trouvés",
  "vault.import.import_secrets_one": "Importer {count} secret",
  "vault.import.import_secrets_other": "Importer {count} secrets",

  // vault.card
  "vault.card.reauthorize_scopes": "Ré-autoriser avec des portées supplémentaires",

  // vault.forms
  "vault.forms.connection_test_heading": "Test de connexion",
  "vault.forms.test_connection_btn": "Tester la connexion",
  "vault.forms.credential_fields_heading": "Champs d'identifiants",
  "vault.forms.how_to_get_connector": "Comment obtenir les identifiants {connectorLabel}",
  "vault.forms.authorization_complete": "Autorisation terminée",
  "vault.forms.copied_to_clipboard": "Copié dans le presse-papiers",
  "vault.forms.credential_name": "Nom de l'identifiant",
  "vault.forms.credential_name_placeholder": "Nommez cet identifiant — ex. Mon compte {label}, {label} Production",
  "vault.forms.authorizing_with": "Autorisation avec {label}...",
  "vault.forms.authorize_with": "Autoriser avec {label}",
  "vault.forms.oauth_consent_hint": "Ouvre {label} dans votre navigateur. Accordez l'accès, puis revenez ici.",
  "vault.forms.oauth_connected_at": "{label} connecté à {time}",

  // vault.auto_cred
  "vault.auto_cred.cancel_session": "Annuler la session",
  "vault.auto_cred.test_connection": "Tester la connexion",
  "vault.auto_cred.testing": "Test en cours...",
  "vault.auto_cred.re_run_browser": "Relancer le navigateur",
  "vault.auto_cred.discard": "Ignorer",
  "vault.auto_cred.save_credential": "Enregistrer l'identifiant",
  "vault.auto_cred.save_procedure": "Enregistrer la procédure",
  "vault.auto_cred.procedure_saved": "Procédure enregistrée",

  // vault.databases
  "vault.databases.not_null": "NON NULL",
  "vault.databases.ctrl_enter": "Ctrl+Entrée",

  // vault.dependencies
  "vault.dependencies.sim_critical": "La révocation de {credentialName} casserait {workflows} workflow{workflowPlural} et stopperait {personas} persona{personaPlural}.",
  "vault.dependencies.sim_high": "La révocation de {credentialName} impacterait {personas} persona{personaPlural} dans votre espace de travail.",
  "vault.dependencies.sim_medium": "La révocation de {credentialName} a un rayon d'impact limité.",
  "vault.dependencies.per_day": "/jour",

  // vault.shared
  "vault.shared.copied": "Copié",
  "vault.shared.kb_count_summary": "-- {docs} docs, {chunks} fragments",
  "vault.shared.default_patterns": "Par défaut :",
  "vault.shared.add_pattern_placeholder": "*.pdf",
  "vault.shared.distance_label": "distance :",
  "vault.shared.chunk_label": "fragment :",
  "vault.shared.copy_credential_id": "Copier l'ID de l'identifiant",
  "vault.shared.request_body": "Corps de la requête",
  "vault.shared.add_tag_title": "Ajouter un tag",
  "vault.shared.local_embedding_hint": "Les embeddings sont générés localement avec {model} ({dims}-dim). Aucune donnée ne quitte votre machine. Le modèle (~23Mo) est téléchargé au premier usage et mis en cache localement.",
  "vault.shared.api_path_placeholder": "/api/v1/resource",
  "vault.shared.json_body_placeholder": "valeur",
  "vault.shared.sending": "Envoi...",
  "vault.shared.send": "Envoyer",
  "vault.shared.search_results_one": "{count} résultat pour \"{query}\"",
  "vault.shared.search_results_other": "{count} résultats pour \"{query}\"",

  // vault.bulk_healthcheck
  "vault.bulk_healthcheck.passed_count": "{count} réussi(s)",
  "vault.bulk_healthcheck.failed_count": "{count} échoué(s)",
  "vault.bulk_healthcheck.total_count": "{count} total",

  // vault.token_metrics
  "vault.token_metrics.fallback_used": "Secours ({fallback}s) utilisé dans {rate}% des actualisations ({count}/{total}) — le fournisseur omet",

  // vault.reauth_banner
  "vault.reauth_banner.access_revoked": ") -- l'accès a été révoqué. Veuillez ré-autoriser pour reprendre les automatisations.",
  "vault.reauth_banner.reconnect": "Reconnecter",

  // vault.rotation_section
  "vault.rotation_section.last_rotated": "Dernière rotation {time}",

  // vault.event_config
  "vault.event_config.loading": "Chargement des événements...",

  // vault.credential_forms
  "vault.credential_forms.open_to_generate": "Ouvrez {label} pour générer une clé API ou un token",
  "vault.credential_forms.already_configured": "Identifiant déjà configuré -- mettez à jour ci-dessous pour remplacer",
  "vault.credential_forms.setup_instructions_label": "Instructions de configuration",
  "vault.credential_forms.no_fields_defined": "Aucun champ d'identifiant défini pour ce connecteur.",

  // vault.audit_log
  "vault.audit_log.loading": "Chargement de la chronologie d'audit...",
  "vault.audit_log.total_accesses": "{count} total",
  "vault.audit_log.personas_one": "{count} persona",
  "vault.audit_log.personas_other": "{count} personas",
  "vault.audit_log.accesses_24h": "{count} en 24h",
  "vault.audit_log.anomalies_one": "{count} anomalie",
  "vault.audit_log.anomalies_other": "{count} anomalies",
  "vault.audit_log.no_anomalies": "Aucune anomalie",
  "vault.audit_log.show_all": "Afficher les {count} entrées",

  // vault.credential_import
  "vault.credential_import.sync_hint": "Surveille le coffre externe pour les changements et met à jour les identifiants automatiquement via interrogation.",
  "vault.credential_import.interval_15min": "15 min",
  "vault.credential_import.interval_30min": "30 min",
  "vault.credential_import.interval_1hr": "1 heure",
  "vault.credential_import.interval_6hr": "6 heures",
  "vault.credential_import.interval_24hr": "24 heures",

  // vault.wizard_detect
  "vault.wizard_detect.set_up_credentials": "Configurer les identifiants",
  "vault.wizard_detect.clear_selection": "Effacer la sélection",
  "vault.wizard_detect.set_up_services": "Configurer {count} service{plural}",
  "vault.wizard_detect.setting_up": "Configuration {current} sur {total}",
  "vault.wizard_detect.wizard_title": "Assistant de configuration des identifiants",
  "vault.wizard_detect.choose_service": "Choisissez un service à configurer",
  "vault.wizard_detect.ai_walk_description": "L'IA vous guidera étape par étape pour obtenir les identifiants API.",
  "vault.wizard_detect.wizard_subtitle": "Configuration guidée par IA",
  "vault.wizard_detect.wizard_subtitle_batch": "Configuration de {count} service{plural}",

  // vault.autopilot
  "vault.autopilot.from_url": "Depuis une URL",
  "vault.autopilot.paste_content": "Coller le contenu",
  "vault.autopilot.openapi_spec_url": "URL de la spec OpenAPI",
  "vault.autopilot.openapi_format_hint": "Supporte les specs OpenAPI 3.x et Swagger 2.x en format JSON ou YAML",
  "vault.autopilot.parsing_spec": "Analyse de la spec...",
  "vault.autopilot.parse_analyze": "Analyser",
  "vault.autopilot.connector_in_catalog": "{connectorLabel} est maintenant disponible dans votre catalogue de connecteurs avec {toolCount} définitions d'outils.",
  "vault.autopilot.generated_tools": "Outils générés ({count})",
  "vault.autopilot.credential_fields": "Champs d'identifiants",
  "vault.autopilot.open_playground": "Ouvrir le playground",
  "vault.autopilot.copy_connector_id": "Copier l'ID du connecteur",
  "vault.autopilot.go_to_catalog": "Aller au catalogue",
  "vault.autopilot.response_headers": "En-têtes de réponse ({count})",
  "vault.autopilot.base_url_placeholder": "https://api.example.com",
  "vault.autopilot.openapi_url_placeholder": "https://api.example.com/openapi.json",
  "vault.autopilot.auth_schemes": "schémas d'auth.",
  "vault.autopilot.body_placeholder": "valeur",

  // vault.foraging
  "vault.foraging.start_scan": "Lancer l'analyse",
  "vault.foraging.checking_env": "Vérification des variables d'environnement, fichiers de config et identifiants des outils dev",
  "vault.foraging.importing": "Import des identifiants dans le coffre...",
  "vault.foraging.scan_again": "Relancer l'analyse",
  "vault.foraging.back_to_vault": "Retour au coffre",
  "vault.foraging.already_in_vault": "Déjà dans le coffre",
  "vault.foraging.imported": "Importé",
  "vault.foraging.to_vault": "dans le coffre",
  "vault.foraging.credentials_found_one": "{count} identifiant trouvé",
  "vault.foraging.credentials_found_other": "{count} identifiants trouvés",
  "vault.foraging.selected": "sélectionné(s)",
  "vault.foraging.import_to_vault_one": "Importer {count} identifiant dans le coffre",
  "vault.foraging.import_to_vault_other": "Importer {count} identifiants dans le coffre",
  "vault.foraging.env_var_one": "{count} var. d'env.",
  "vault.foraging.env_var_other": "{count} vars. d'env.",
  "vault.foraging.import_server": "Importer",
  "vault.foraging.sources_in": "sources dans",
  "vault.foraging.progress_aria": "Progression de la collecte",
  "vault.foraging.scanned_sources": "{count} sources analysées en {ms}ms",

  // vault.desktop_discovery
  "vault.desktop_discovery.connect_description": "Connectez des applications locales ou importez des serveurs MCP Claude Desktop",
  "vault.desktop_discovery.detected_apps_tab": "Apps détectées ({count})",
  "vault.desktop_discovery.claude_mcp_tab": "Claude MCP ({count})",
  "vault.desktop_discovery.scanning": "Analyse des apps desktop...",
  "vault.desktop_discovery.detected_on_system": "Détecté sur votre système",
  "vault.desktop_discovery.not_detected": "Non détecté",
  "vault.desktop_discovery.no_apps": "Aucune app desktop détectée. Essayez d'actualiser.",
  "vault.desktop_discovery.reading_config": "Lecture de la configuration Claude Desktop...",
  "vault.desktop_discovery.mcp_servers_found_one": "{count} serveur MCP trouvé dans la configuration Claude Desktop. Importez-les comme identifiants pour les utiliser avec vos agents.",
  "vault.desktop_discovery.mcp_servers_found_other": "{count} serveurs MCP trouvés dans la configuration Claude Desktop. Importez-les comme identifiants pour les utiliser avec vos agents.",
  "vault.desktop_discovery.no_mcp_config": "Aucune configuration MCP Claude Desktop trouvée.",
  "vault.desktop_discovery.mcp_config_hint": "Si vous avez Claude Desktop installé, assurez-vous que des serveurs MCP y sont configurés dans les paramètres.",
  "vault.desktop_discovery.permission_required": "Permission requise",
  "vault.desktop_discovery.approve_description": "demande les capacités suivantes. Révisez et approuvez pour activer ce connecteur.",
  "vault.desktop_discovery.approve_connect": "Approuver et connecter",

  // vault.picker_section
  "vault.picker_section.credential_name": "Nom de l'identifiant",
  "vault.picker_section.add_project_first": "Ajoutez d'abord un projet dans Dev Tools pour connecter une base de code à vos agents.",
  "vault.picker_section.go_to_dev_tools": "Accéder à Dev Tools",
  "vault.picker_section.workspace_connect_description": "Une connexion Google crée automatiquement les identifiants Gmail, Calendar, Drive et Sheets",
  "vault.picker_section.foraging_description": "Analysez votre système de fichiers pour trouver les clés API, profils AWS, variables d'env. et plus encore",
  "vault.picker_section.no_setup_guide": "Aucun guide de configuration disponible pour ce connecteur. Consultez la documentation ci-dessous.",
  "vault.picker_section.open_setup_page": "Ouvrir la page de configuration {label}",

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

  // vault.design_phases
  "vault.design_phases.credential_saved_message": "L'identifiant {label} a été enregistré de manière sécurisée.",
  "vault.design_phases.revision_count": "(révision {count})",
  "vault.design_phases.connector_added_to_catalog": "connecteur ajouté à votre catalogue -- maintenant disponible pour d'autres personas et l'adoption de modèles.",
  "vault.design_phases.view_credential": "Voir l'identifiant",
  "vault.design_phases.refine_hint": "Besoin d'ajuster les portées, d'ajouter des champs ou de modifier la configuration ?",
  "vault.design_phases.refine_placeholder": "ex. ajouter des portées d'écriture, ajouter un environnement de staging...",
  "vault.design_phases.refine": "Affiner",
  "vault.design_phases.linked_to_existing": "Votre identifiant sera lié à la définition de connecteur existante.",
  "vault.design_phases.no_existing_connector": "-- aucun connecteur {name} existant n'a été trouvé dans votre catalogue.",
  "vault.design_phases.new_connector_will_be_registered": "Lorsque vous enregistrez cet identifiant, la définition de connecteur générée par IA sera automatiquement enregistrée dans votre catalogue de connecteurs -- la rendant réutilisable pour d'autres personas et l'adoption de modèles.",
  "vault.design_phases.refine_request": "Pas tout à fait ? Affinez votre demande",
  "vault.design_phases.auto_provision_hint": "-- laissez l'IA vous guider étape par étape pour obtenir vos identifiants {label}.",
  "vault.design_phases.credential_name_label": "Nom de l'identifiant",
  "vault.design_phases.credentials_secure_notice": "Les identifiants sont stockés de manière sécurisée dans le coffre et sont disponibles pour l'exécution des outils des agents.",
  "vault.design_phases.tested_successfully_at": "Testé avec succès à {time}",

  // vault.auto_cred_extra
  "vault.auto_cred_extra.auto_credential_title": "Identifiant automatique",
  "vault.auto_cred_extra.starting_browser": "Démarrage du navigateur automatisé...",
  "vault.auto_cred_extra.open_browser": "Ouvrir le navigateur automatisé",
  "vault.auto_cred_extra.browser_opened": "Navigateur ouvert",
  "vault.auto_cred_extra.waiting_for_credentials": "En attente des identifiants...",
  "vault.auto_cred_extra.credentials_captured": "Identifiants capturés",
  "vault.auto_cred_extra.browser_failed": "Échec du navigateur",
  "vault.auto_cred_extra.close_browser": "Fermer le navigateur",
  "vault.auto_cred_extra.instructions": "Instructions",
  "vault.auto_cred_extra.step_open": "Cliquez sur « Ouvrir le navigateur automatisé »",
  "vault.auto_cred_extra.step_login": "Connectez-vous ou naviguez vers votre tableau de bord {label}",
  "vault.auto_cred_extra.step_generate": "Générez ou copiez votre clé API",
  "vault.auto_cred_extra.step_capture": "Les identifiants seront capturés automatiquement",
  "vault.auto_cred_extra.step_return": "Revenez ici pour enregistrer",
  "vault.auto_cred_extra.detected_fields": "Champs détectés",
  "vault.auto_cred_extra.no_fields_detected": "Aucun champ détecté pour l'instant",
  "vault.auto_cred_extra.session_timeout": "La session a expiré",
  "vault.auto_cred_extra.session_timeout_desc": "La session du navigateur a expiré. Relancez pour réessayer.",

  // vault.workspace_panel
  "vault.workspace_panel.title": "Connexion à l'espace de travail",
  "vault.workspace_panel.subtitle": "Connectez votre compte Google pour accéder à Gmail, Calendar, Drive et Sheets",
  "vault.workspace_panel.connect_google": "Connecter Google Workspace",
  "vault.workspace_panel.connected_as": "Connecté en tant que {email}",
  "vault.workspace_panel.disconnect": "Déconnecter",
  "vault.workspace_panel.gmail": "Gmail",
  "vault.workspace_panel.calendar": "Calendar",
  "vault.workspace_panel.drive": "Drive",
  "vault.workspace_panel.sheets": "Sheets",
  "vault.workspace_panel.scopes_granted": "Portées accordées",

  // vault.negotiator_extra
  "vault.negotiator_extra.browser_closed": "Navigateur fermé",
  "vault.negotiator_extra.capture_timeout": "Délai de capture dépassé",

  // overview.healing_issues_panel
  "overview.healing_issues_panel.title": "Problèmes de guérison",
  "overview.healing_issues_panel.no_issues": "Aucun problème de guérison actif",
  "overview.healing_issues_panel.all_resolved": "Tous les problèmes résolus",
  "overview.healing_issues_panel.loading": "Chargement des problèmes...",
  "overview.healing_issues_panel.issue_count_one": "{count} problème",
  "overview.healing_issues_panel.issue_count_other": "{count} problèmes",
  "overview.healing_issues_panel.auto_fixed": "Corrigé automatiquement",
  "overview.healing_issues_panel.manual_required": "Action manuelle requise",
  "overview.healing_issues_panel.view_execution": "Voir l'exécution",
  "overview.healing_issues_panel.apply_fix": "Appliquer le correctif",
  "overview.healing_issues_panel.dismiss": "Ignorer",
  "overview.healing_issues_panel.agent_label": "Agent :",
  "overview.healing_issues_panel.error_label": "Erreur :",
  "overview.healing_issues_panel.fix_label": "Correctif :",
  "overview.healing_issues_panel.occurred_label": "Survenu :",
  "overview.healing_issues_panel.category_label": "Catégorie :",
  "overview.healing_issues_panel.no_fix_available": "Aucun correctif automatique disponible",

  // overview.knowledge_graph
  "overview.knowledge_graph.title": "Graphe de connaissances",
  "overview.knowledge_graph.no_data": "Aucune donnée de connaissances",
  "overview.knowledge_graph.loading": "Chargement du graphe...",
  "overview.knowledge_graph.nodes_one": "{count} nœud",
  "overview.knowledge_graph.nodes_other": "{count} nœuds",
  "overview.knowledge_graph.edges_one": "{count} connexion",
  "overview.knowledge_graph.edges_other": "{count} connexions",
  "overview.knowledge_graph.filter_placeholder": "Filtrer les connaissances...",
  "overview.knowledge_graph.zoom_in": "Zoom avant",
  "overview.knowledge_graph.zoom_out": "Zoom arrière",
  "overview.knowledge_graph.reset_view": "Réinitialiser la vue",
  "overview.knowledge_graph.export": "Exporter",
  "overview.knowledge_graph.node_type": "Type :",
  "overview.knowledge_graph.node_agent": "Agent :",
  "overview.knowledge_graph.node_created": "Créé :",
  "overview.knowledge_graph.node_connections": "Connexions :",
  "overview.knowledge_graph.empty_hint": "Les connaissances apparaîtront au fur et à mesure que vos agents exécutent des tâches",

  // overview.leaderboard
  "overview.leaderboard.title": "Classement des agents",
  "overview.leaderboard.no_data": "Aucune donnée de classement",
  "overview.leaderboard.rank": "Rang",
  "overview.leaderboard.agent": "Agent",
  "overview.leaderboard.score": "Score",
  "overview.leaderboard.executions": "Exécutions",
  "overview.leaderboard.success_rate": "Taux de succès",
  "overview.leaderboard.avg_cost": "Coût moy.",
  "overview.leaderboard.trend": "Tendance",
  "overview.leaderboard.loading": "Chargement du classement...",

  // overview.memories
  "overview.memories.title": "Mémorisations",
  "overview.memories.no_memories": "Aucune mémorisation pour l'instant",
  "overview.memories.loading": "Chargement des mémorisations...",
  "overview.memories.search_placeholder": "Rechercher les mémorisations...",
  "overview.memories.memory_count_one": "{count} mémorisation",
  "overview.memories.memory_count_other": "{count} mémorisations",
  "overview.memories.delete_memory": "Supprimer la mémorisation",

  // overview.health_extra
  "overview.health_extra.overall_health": "Santé globale",
  "overview.health_extra.agents_healthy": "{count} agent(s) sain(s)",
  "overview.health_extra.agents_degraded": "{count} agent(s) dégradé(s)",
  "overview.health_extra.agents_failing": "{count} agent(s) en échec",
  "overview.health_extra.run_full_check": "Lancer une vérification complète",
  "overview.health_extra.last_checked": "Dernière vérification : {time}",

  // overview.messages
  "overview.messages.title": "Messages",
  "overview.messages.no_messages": "Aucun message pour l'instant",
  "overview.messages.mark_read": "Marquer comme lu",
  "overview.messages.mark_all_read": "Tout marquer comme lu",

  // overview.memory_review
  "overview.memory_review.title": "Révision des mémorisations",
  "overview.memory_review.approve": "Approuver",
  "overview.memory_review.reject": "Rejeter",
  "overview.memory_review.no_pending": "Aucune mémorisation en attente",

  // overview.focused_decision
  "overview.focused_decision.title": "Décision ciblée",
  "overview.focused_decision.approve": "Approuver",
  "overview.focused_decision.reject": "Rejeter",
  "overview.focused_decision.no_items": "Aucun élément en attente",

  // overview.burn_rate_extra
  "overview.burn_rate_extra.daily_rate": "Taux journalier",

  // overview.annotate_modal
  "overview.annotate_modal.title": "Annoter",

  // overview.knowledge_row
  "overview.knowledge_row.view_details": "Voir les détails",

  // overview.review_focus
  "overview.review_focus.title": "Focus révision",

  // overview.review_inbox
  "overview.review_inbox.title": "Boîte de révision",

  // overview.predictive_alerts_extra
  "overview.predictive_alerts_extra.predicted_failure": "Échec prédit",
  "overview.predictive_alerts_extra.confidence": "Confiance : {percent}%",

  // overview.bulk_action_bar
  "overview.bulk_action_bar.selected_count": "{count} sélectionné(s)",
  "overview.bulk_action_bar.clear_selection": "Effacer la sélection",

  // deployment.exec_detail
  "deployment.exec_detail.title": "Détail de l'exécution",
  "deployment.exec_detail.agent": "Agent",
  "deployment.exec_detail.status": "Statut",
  "deployment.exec_detail.started": "Démarré",
  "deployment.exec_detail.duration": "Durée",
  "deployment.exec_detail.cost": "Coût",
  "deployment.exec_detail.model": "Modèle",
  "deployment.exec_detail.input": "Entrée",
  "deployment.exec_detail.output": "Sortie",
  "deployment.exec_detail.error": "Erreur",
  "deployment.exec_detail.close": "Fermer",

  // deployment.oauth_panel
  "deployment.oauth_panel.title": "Autorisation OAuth",
  "deployment.oauth_panel.connect": "Connecter",
  "deployment.oauth_panel.connected": "Connecté",
  "deployment.oauth_panel.disconnect": "Déconnecter",
  "deployment.oauth_panel.authorizing": "Autorisation en cours...",
  "deployment.oauth_panel.error": "Erreur d'autorisation",
  "deployment.oauth_panel.retry": "Réessayer",
  "deployment.oauth_panel.scopes_label": "Portées requises",

  // deployment.schedules
  "deployment.schedules.title": "Planifications",
  "deployment.schedules.no_schedules": "Aucune planification configurée",
  "deployment.schedules.add_schedule": "Ajouter une planification",
  "deployment.schedules.next_run": "Prochain lancement : {time}",
  "deployment.schedules.last_run": "Dernier lancement : {time}",
  "deployment.schedules.enabled": "Activée",
  "deployment.schedules.disabled": "Désactivée",

  // deployment.deploy_card
  "deployment.deploy_card.deploy": "Déployer",
  "deployment.deploy_card.deploying": "Déploiement...",
  "deployment.deploy_card.deployed": "Déployé",
  "deployment.deploy_card.failed": "Échec du déploiement",

  // deployment.trigger_form
  "deployment.trigger_form.title": "Formulaire de déclencheur",
  "deployment.trigger_form.save": "Enregistrer le déclencheur",
  "deployment.trigger_form.cancel": "Annuler",

  // deployment.chart
  "deployment.chart.no_data": "Aucune donnée",
  "deployment.chart.loading": "Chargement du graphique...",
  "deployment.chart.executions": "Exécutions",

  // deployment.deployments_panel
  "deployment.deployments_panel.no_deployments": "Aucun déploiement",
  "deployment.deployments_panel.refresh": "Actualiser",

  // deployment.history
  "deployment.history.title": "Historique",
  "deployment.history.no_history": "Aucun historique disponible",

  // deployment.api_playground
  "deployment.api_playground.title": "Playground API",

  // deployment.connection
  "deployment.connection.connected": "Connecté",

  // templates.generation
  "templates.generation.title": "Génération de modèle",
  "templates.generation.generating": "Génération en cours...",
  "templates.generation.generated": "Modèle généré",
  "templates.generation.failed": "Génération échouée",
  "templates.generation.describe_placeholder": "Décrivez le modèle d'agent que vous souhaitez générer...",
  "templates.generation.generate_btn": "Générer",
  "templates.generation.name_label": "Nom du modèle",
  "templates.generation.category_label": "Catégorie",
  "templates.generation.use_cases_label": "Cas d'usage",
  "templates.generation.tools_label": "Outils recommandés",
  "templates.generation.connectors_label": "Connecteurs",
  "templates.generation.adopt_this": "Adopter ce modèle",
  "templates.generation.preview_label": "Aperçu",
  "templates.generation.complexity_label": "Complexité",
  "templates.generation.est_setup_label": "Configuration est.",
  "templates.generation.save_to_catalog": "Enregistrer dans le catalogue",
  "templates.generation.saved": "Enregistré dans le catalogue",
  "templates.generation.edit_before_save": "Modifier avant d'enregistrer",
  "templates.generation.similar_templates": "Modèles similaires",
  "templates.generation.generate_another": "Générer un autre",
  "templates.generation.generation_hint": "L'IA créera une configuration d'agent complète : prompt, outils, déclencheurs et cas d'usage.",
  "templates.generation.tags_label": "Tags",
  "templates.generation.domain_label": "Domaine",
  "templates.generation.triggers_label": "Déclencheurs",
  "templates.generation.prompt_preview": "Aperçu du prompt",
  "templates.generation.no_prompt": "Aucun prompt généré",
  "templates.generation.refine_prompt": "Affiner le modèle",
  "templates.generation.regenerate": "Régénérer",
  "templates.generation.copy_prompt": "Copier le prompt",
  "templates.generation.prompt_copied": "Prompt copié",
  "templates.generation.section_identity": "Identité",
  "templates.generation.section_behavior": "Comportement",
  "templates.generation.section_integration": "Intégration",
  "templates.generation.error_empty_description": "Veuillez décrire le modèle souhaité",
  "templates.generation.error_generation_failed": "La génération du modèle a échoué. Veuillez réessayer.",
  "templates.generation.back_to_catalog": "Retour au catalogue",
  "templates.generation.create_agent_from_template": "Créer un agent depuis ce modèle",

  // templates.adopt_modal
  "templates.adopt_modal.title": "Adopter le modèle",
  "templates.adopt_modal.subtitle": "Configurer l'agent depuis ce modèle",
  "templates.adopt_modal.agent_name_label": "Nom de l'agent",
  "templates.adopt_modal.agent_name_placeholder": "Donnez un nom à votre agent...",
  "templates.adopt_modal.description_label": "Description",
  "templates.adopt_modal.customize_label": "Personnaliser",
  "templates.adopt_modal.review_label": "Réviser",
  "templates.adopt_modal.adopt_btn": "Adopter",
  "templates.adopt_modal.adopting": "Adoption en cours...",
  "templates.adopt_modal.adopted": "Adopté avec succès",
  "templates.adopt_modal.failed": "Adoption échouée",
  "templates.adopt_modal.view_agent": "Voir l'agent",
  "templates.adopt_modal.credentials_section": "Identifiants requis",
  "templates.adopt_modal.no_credentials_needed": "Aucun identifiant requis",
  "templates.adopt_modal.set_up_credentials": "Configurer les identifiants",
  "templates.adopt_modal.tools_section": "Outils inclus",
  "templates.adopt_modal.triggers_section": "Déclencheurs inclus",
  "templates.adopt_modal.use_cases_section": "Cas d'usage",
  "templates.adopt_modal.prompt_section": "Prompt de l'agent",
  "templates.adopt_modal.model_section": "Modèle",
  "templates.adopt_modal.identity_section": "Identité",
  "templates.adopt_modal.icon_label": "Icône",
  "templates.adopt_modal.color_label": "Couleur",
  "templates.adopt_modal.group_label": "Groupe",
  "templates.adopt_modal.step_configure": "Configurer",
  "templates.adopt_modal.step_review": "Réviser",
  "templates.adopt_modal.step_adopt": "Adopter",
  "templates.adopt_modal.back": "Retour",
  "templates.adopt_modal.next": "Suivant",
  "templates.adopt_modal.cancel": "Annuler",
  "templates.adopt_modal.template_label": "Modèle :",
  "templates.adopt_modal.complexity_label": "Complexité :",
  "templates.adopt_modal.est_time_label": "Temps est. :",

  // templates.matrix
  "templates.matrix.title": "Matrice de modèles",
  "templates.matrix.no_templates": "Aucun modèle disponible",
  "templates.matrix.loading": "Chargement des modèles...",
  "templates.matrix.filter_all": "Tous",
  "templates.matrix.filter_by_category": "Filtrer par catégorie",
  "templates.matrix.search_placeholder": "Rechercher des modèles...",
  "templates.matrix.adopted_badge": "Adopté",
  "templates.matrix.adopt_btn": "Adopter",
  "templates.matrix.preview_btn": "Aperçu",
  "templates.matrix.complexity_simple": "Simple",
  "templates.matrix.complexity_intermediate": "Intermédiaire",
  "templates.matrix.complexity_advanced": "Avancé",
  "templates.matrix.tools_count": "{count} outil(s)",
  "templates.matrix.connectors_count": "{count} connecteur(s)",

  // templates.matrix_variants
  "templates.matrix_variants.title": "Variantes",
  "templates.matrix_variants.no_variants": "Aucune variante disponible",
  "templates.matrix_variants.base_template": "Modèle de base",
  "templates.matrix_variants.variant_label": "Variante {index}",
  "templates.matrix_variants.diff_label": "Différences",
  "templates.matrix_variants.adopt_variant": "Adopter cette variante",
  "templates.matrix_variants.compare_label": "Comparer",
  "templates.matrix_variants.tags_label": "Tags",
  "templates.matrix_variants.best_for": "Idéal pour",
  "templates.matrix_variants.no_diff": "Identique au modèle de base",
  "templates.matrix_variants.loading": "Chargement des variantes...",

  // templates.n8n
  "templates.n8n.title": "Import n8n",
  "templates.n8n.subtitle": "Importez un workflow n8n pour créer un agent",
  "templates.n8n.upload_label": "Déposer le fichier de workflow n8n",
  "templates.n8n.or_paste": "Ou coller le JSON du workflow",
  "templates.n8n.paste_placeholder": "Collez votre JSON de workflow n8n ici...",
  "templates.n8n.parse_btn": "Analyser le workflow",
  "templates.n8n.parsing": "Analyse en cours...",
  "templates.n8n.import_btn": "Importer comme agent",
  "templates.n8n.importing": "Import en cours...",
  "templates.n8n.imported": "Importé avec succès",
  "templates.n8n.parse_error": "Erreur d'analyse : fichier de workflow invalide",
  "templates.n8n.nodes_found": "{count} nœud(s) trouvé(s)",

  // templates.questionnaire
  "templates.questionnaire.title": "Questionnaire",
  "templates.questionnaire.next": "Suivant",
  "templates.questionnaire.back": "Retour",
  "templates.questionnaire.finish": "Terminer",
  "templates.questionnaire.skip": "Passer",

  // templates.search
  "templates.search.placeholder": "Rechercher des modèles...",
  "templates.search.no_results": "Aucun modèle trouvé",
  "templates.search.clear": "Effacer",
  "templates.search.results_count": "{count} résultat(s)",

  // templates.gallery
  "templates.gallery.title": "Galerie de modèles",

  // templates.diagrams
  "templates.diagrams.title": "Diagrammes",

  // templates.connector_edit
  "templates.connector_edit.title": "Modifier le connecteur",

  // templates.trigger_edit
  "templates.trigger_edit.title": "Modifier le déclencheur",

  // releases.whats_new
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

  // plugins.dev_tools
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

  // plugins.dev_projects
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

  // plugins.dev_context
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

  // plugins.dev_scanner
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

  // plugins.dev_runner
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

  // plugins.dev_lifecycle
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

  // plugins.dev_triage
  "plugins.dev_triage.title": "Tri",
  "plugins.dev_triage.no_project": "Aucun projet sélectionné",
  "plugins.dev_triage.scan_issues": "Analyser les problèmes",
  "plugins.dev_triage.scanning": "Analyse en cours...",
  "plugins.dev_triage.no_issues": "Aucun problème trouvé",
  "plugins.dev_triage.issues_count": "{count} problème(s)",
  "plugins.dev_triage.priority_high": "Haute",
  "plugins.dev_triage.priority_medium": "Moyenne",
  "plugins.dev_triage.priority_low": "Faible",

  // plugins.drive
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

  // plugins.obsidian
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

  // plugins.artist
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

  // plugins.drive_label / drive_desc
  "plugins.drive_label": "Google Drive",
  "plugins.drive_desc": "Accédez à vos fichiers Google Drive depuis vos agents",

  // media_studio
  "media_studio.undo": "Annuler",
  "media_studio.redo": "Rétablir",
  "media_studio.clip_actions": "Actions sur le clip",
  "media_studio.action_split": "Couper",
  "media_studio.action_extract_audio": "Extraire l'audio",
  "media_studio.action_strip_audio": "Supprimer l'audio",
  "media_studio.action_keep_audio": "Conserver l'audio",
  "media_studio.action_save_thumbnail": "Enregistrer la miniature",
  "media_studio.action_trim_to_file": "Rogner vers fichier",
  "media_studio.extracting_audio": "Extraction de l'audio...",
  "media_studio.extract_audio_done": "Audio extrait",
  "media_studio.saving_thumbnail": "Enregistrement de la miniature...",
  "media_studio.thumbnail_saved": "Miniature enregistrée",
  "media_studio.trimming_file": "Rognage du fichier...",
  "media_studio.trim_done": "Rognage terminé",
  "media_studio.effects": "Effets",
  "media_studio.speed": "Vitesse",
  "media_studio.fade_in": "Fondu entrant",
  "media_studio.fade_out": "Fondu sortant",
  "media_studio.normalize": "Normaliser",
  "media_studio.normalize_hint": "Normaliser le volume audio de ce clip",
  "media_studio.strip_audio_hint": "Supprimer la piste audio de ce clip",

  // research_lab
  "research_lab.graph": "Graphe",
  "research_lab.recent_projects": "Projets récents",
  "research_lab.view_all": "Tout afficher",
  "research_lab.edit_project": "Modifier le projet",
  "research_lab.save_changes": "Enregistrer les modifications",
  "research_lab.project_name_placeholder": "Titre du projet...",
  "research_lab.project_description_placeholder": "Description du projet...",
  "research_lab.project_thesis_placeholder": "Thèse ou question de recherche principale...",
  "research_lab.clear_vault": "Vider le coffre",
  "research_lab.domain_cs": "Informatique",
  "research_lab.domain_biology": "Biologie",
  "research_lab.domain_chemistry": "Chimie",
  "research_lab.domain_physics": "Physique",
  "research_lab.domain_mathematics": "Mathématiques",
  "research_lab.domain_business": "Commerce",
  "research_lab.domain_medicine": "Médecine",
  "research_lab.domain_general": "Général",
  "research_lab.no_matching_sources": "Aucune source correspondante",
  "research_lab.filter_sources_placeholder": "Filtrer les sources...",
  "research_lab.source_title": "Titre",
  "research_lab.source_title_placeholder": "Titre de la source...",
  "research_lab.source_type": "Type",
  "research_lab.source_year": "Année",
  "research_lab.source_year_placeholder": "ex. 2024",
  "research_lab.source_authors": "Auteurs",
  "research_lab.source_authors_placeholder": "ex. Dupont, J., Martin, M.",
  "research_lab.source_url": "URL",
  "research_lab.source_url_placeholder": "https://...",
  "research_lab.source_doi": "DOI",
  "research_lab.source_doi_placeholder": "10.xxxx/xxxxx",
  "research_lab.source_abstract": "Résumé",
  "research_lab.source_abstract_placeholder": "Résumé ou notes sur cette source...",
  "research_lab.source_type_arxiv": "arXiv",
  "research_lab.source_type_scholar": "Google Scholar",
  "research_lab.source_type_pubmed": "PubMed",
  "research_lab.source_type_web": "Web",
  "research_lab.source_type_pdf": "PDF",
  "research_lab.source_type_manual": "Manuel",
  "research_lab.hypothesis_statement": "Énoncé de l'hypothèse",
  "research_lab.hypothesis_statement_placeholder": "Énoncez clairement votre hypothèse...",
  "research_lab.hypothesis_rationale": "Justification",
  "research_lab.hypothesis_rationale_placeholder": "Pourquoi cette hypothèse est-elle plausible ?",
  "research_lab.experiment_name": "Nom de l'expérience",
  "research_lab.experiment_name_placeholder": "Nom descriptif de l'expérience...",
  "research_lab.methodology_placeholder": "Décrivez la méthodologie...",
  "research_lab.success_criteria_placeholder": "Définissez les critères de succès...",
  "research_lab.linked_hypothesis": "Hypothèse liée",
  "research_lab.no_linked_hypothesis": "Aucune hypothèse liée",
  "research_lab.linked_persona": "Agent lié",
  "research_lab.no_linked_persona": "Aucun agent lié",
  "research_lab.run_input": "Entrée d'exécution",
  "research_lab.run_input_placeholder": "Données d'entrée optionnelles pour cette exécution...",
  "research_lab.pass_pattern": "Schéma de réussite",
  "research_lab.pass_pattern_placeholder": "Regex ou texte à rechercher dans la sortie...",
  "research_lab.running_experiment": "Exécution de l'expérience...",
  "research_lab.view_runs": "Voir les exécutions",
  "research_lab.no_runs_yet": "Aucune exécution pour l'instant",
  "research_lab.run_passed": "Réussie",
  "research_lab.run_failed": "Échouée",
  "research_lab.run_duration": "Durée : {duration}",
  "research_lab.run_cost": "Coût : {cost}",
  "research_lab.run_number": "Exécution #{n}",
  "research_lab.runs_history": "Historique des exécutions",
  "research_lab.create_finding": "Créer un résultat",
  "research_lab.finding_title": "Titre du résultat",
  "research_lab.finding_title_placeholder": "Résumez votre résultat...",
  "research_lab.finding_description": "Description",
  "research_lab.finding_description_placeholder": "Décrivez le résultat en détail...",
  "research_lab.finding_category": "Catégorie",
  "research_lab.finding_category_placeholder": "ex. Résultat positif, Anomalie, Question ouverte",
  "research_lab.report_title": "Titre du rapport",
  "research_lab.report_title_placeholder": "Titre du rapport de recherche...",
  "research_lab.report_format": "Format du rapport",

  // settings
  "settings.settings_saved": "Paramètres enregistrés",
  "settings.account": "Compte",
  "settings.appearance": "Apparence",
  "settings.engine": "Moteur",
  "settings.byom": "BYOM",

  // settings.portability
  "settings.portability.export_all": "Tout exporter",
  "settings.portability.import_backup": "Importer une sauvegarde",
  "settings.portability.exporting": "Export en cours...",
  "settings.portability.importing": "Import en cours...",
  "settings.portability.export_complete": "Export terminé",
  "settings.portability.import_complete": "Import terminé",

  // design
  "design.conversation_truncated": "Conversation tronquée pour des raisons de performance",

  // schedules
  "schedules.missed_since": "Manqué depuis {time}",
  "schedules.every_interval": "Toutes les {interval}",
  "schedules.mark_for_recovery": "Marquer pour récupération",
  "schedules.run_once_now": "Exécuter une fois maintenant",
  "schedules.skip_dont_recover": "Passer (ne pas récupérer)",
  "schedules.overlaps_with": "Chevauchement avec {name}",
  "schedules.refresh_schedules": "Actualiser les planifications",
  "schedules.seed_mock_tooltip": "Générer des données de test",
  "schedules.schedule_view_aria": "Vue des planifications",

  // recipes
  "recipes.recipe_label": "Recette",
  "recipes.executed_label": "Exécutée",

  // sharing
  "sharing.enclave_hash_label": "Hachage de l'enclave",
  "sharing.refresh_peer_list": "Actualiser la liste des pairs",
  "sharing.peer_list_stale": "Liste des pairs obsolète",
  "sharing.network_data_stale": "Données réseau obsolètes",
  "sharing.peer_id_footer": "ID du pair",
  "sharing.remove_exposure": "Supprimer l'exposition",
  "sharing.revoke_trust": "Révoquer la confiance",
  "sharing.remove_peer": "Supprimer le pair",
  "sharing.share_link_tooltip": "Partager le lien",
  "sharing.copy_clipboard_tooltip": "Copier dans le presse-papiers",

  // gitlab
  "gitlab.trigger_on": "Déclencher sur",
  "gitlab.connecting_to_gitlab": "Connexion à GitLab...",
  "gitlab.deploying_to_gitlab": "Déploiement sur GitLab...",
  "gitlab.pipeline_hash": "Pipeline #{id}",

  // pipeline
  "pipeline.no_timeline_data": "Aucune donnée de chronologie disponible",
  "pipeline.clear_filter": "Effacer le filtre",
  "pipeline.filter_to_run": "Filtrer par exécution",
  "pipeline.new_memories_one": "{count} nouvelle mémorisation",
  "pipeline.new_memories_other": "{count} nouvelles mémorisations",

  // process_labels
  "process_labels.feedback_chat": "Conversation de retour",

  // execution
  "execution.needs_credential": "Identifiant requis",
  "execution.run_preview": "Aperçu avant exécution",
  "execution.close_preview": "Fermer l'aperçu",
  "execution.budget_limit": "Limite budgétaire",
  "execution.run_agent": "Exécuter l'agent",

  // triggers (all the missing ones)
  "triggers.cron_colon": "Cron :",
  "triggers.interval_colon": "Intervalle :",
  "triggers.event_colon": "Événement :",
  "triggers.endpoint_colon": "Point de terminaison :",
  "triggers.listens_for_colon": "Écoute :",
  "triggers.source_filter_colon": "Filtre source :",
  "triggers.hmac_colon": "HMAC :",
  "triggers.paths_colon": "Chemins :",
  "triggers.events_colon": "Événements :",
  "triggers.recursive_yes": "Oui",
  "triggers.filter_colon": "Filtre :",
  "triggers.watches_colon": "Surveille :",
  "triggers.pattern_colon": "Schéma :",
  "triggers.poll_every": "Interrogation toutes les {interval}",
  "triggers.apps_colon": "Applications :",
  "triggers.title_colon": "Titre :",
  "triggers.operator_colon": "Opérateur :",
  "triggers.window_colon": "Fenêtre :",
  "triggers.id_colon": "ID :",
  "triggers.type_colon": "Type :",
  "triggers.status_colon": "Statut :",
  "triggers.target_colon": "Cible :",
  "triggers.retry_hash": "Tentative #{count}",
  "triggers.model_colon": "Modèle :",
  "triggers.next_run_colon": "Prochain lancement :",
  "triggers.local_label": "local",
  "triggers.then_every": "puis toutes les {interval}",
  "triggers.source_colon": "Source :",
  "triggers.dry_run_target_colon": "Cible de test :",
  "triggers.matched_subscriptions_count": "{count} abonnement(s) correspondant(s)",
  "triggers.last_label": "Dernier :",
  "triggers.loading_history": "Chargement de l'historique...",
  "triggers.zero_unlimited": "0 = illimité",
  "triggers.category_section_label": "Catégorie : {category}",
  "triggers.no_persona_selected": "Aucun agent sélectionné",
  "triggers.quick_templates_label": "Modèles rapides",
  "triggers.quick_presets_label": "Préréglages rapides",
  "triggers.cron_expression_label": "Expression cron",
  "triggers.this_persona_will": "Cet agent va",
  "triggers.starting_from": "À partir de {time}",
  "triggers.per_day": "par jour",
  "triggers.last_poll_label": "Dernière interrogation :",
  "triggers.deployed_persona_label": "Agent déployé :",
  "triggers.fired_at_label": "Déclenché à :",
  "triggers.webhook_last_label": "Dernier webhook :",
  "triggers.relay_last_label": "Dernier relais :",
  "triggers.optional_label": "facultatif",
  "triggers.optional_comma_separated": "facultatif — séparé par des virgules",
  "triggers.get_channel_url_from": "Obtenez l'URL du canal depuis {source}",
  "triggers.setup_step1": "Créez un webhook entrant dans votre espace de travail {platform}",
  "triggers.setup_step2": "Copiez l'URL du webhook",
  "triggers.setup_step3": "Collez-la dans le champ URL du canal ci-dessus",
  "triggers.setup_step4": "Testez la connexion",
  "triggers.studio_empty_desc": "Faites glisser des agents sur le canevas ou cliquez sur Ajouter pour commencer",
  "triggers.studio_step1": "Faites glisser des agents depuis la barre latérale vers le canevas",
  "triggers.studio_step2": "Connectez les agents en faisant glisser entre les ports",
  "triggers.studio_step3": "Configurez les déclencheurs pour chaque agent",
  "triggers.studio_step4": "Activez le flux pour mettre en production",
  "triggers.gate_if_else": "Si/Sinon",
  "triggers.gate_if_else_desc": "Acheminez les événements selon une condition",
  "triggers.gate_classifier_desc": "Classez et acheminez les événements par type",
  "triggers.gate_fan_out": "Diffusion",
  "triggers.gate_fan_out_desc": "Envoyez les événements vers plusieurs agents",
  "triggers.palette_help": "Aide de la palette",
  "triggers.toolbar_title_auto_layout": "Mise en page automatique",
  "triggers.toolbar_title_add_note": "Ajouter une note",
  "triggers.toolbar_title_start_dry_run": "Démarrer le test",
  "triggers.toolbar_title_stop_dry_run": "Arrêter le test",
  "triggers.toolbar_title_assistant": "Assistant",
  "triggers.toolbar_dry_run": "Test",
  "triggers.canvas_assistant_title": "Assistant de canevas",
  "triggers.try_asking_hint": "Essayez de demander :",
  "triggers.assistant_placeholder": "Posez une question sur votre flux...",
  "triggers.disconnect_persona_title": "Déconnecter l'agent",
  "triggers.disconnect_will_no_longer": "ne recevra plus les événements de ce déclencheur.",
  "triggers.disconnect_events_reconnect": "Vous pouvez reconnecter l'agent ultérieurement.",
  "triggers.rename_also_updates": "Renommer mettra également à jour toutes les références.",
  "triggers.delete_connection_label": "Supprimer la connexion",
  "triggers.search_personas_placeholder": "Rechercher des agents...",
  "triggers.no_matching_personas_found": "Aucun agent correspondant trouvé",
  "triggers.clear_search_label": "Effacer la recherche",
  "triggers.dead_letter_source": "Source :",
  "triggers.dead_letter_id": "ID :",
  "triggers.event_data_label": "Données de l'événement",
  "triggers.shared_prefix": "Partagé",
  "triggers.nl_type_colon": "Type :",
  "triggers.nl_cron_colon": "Cron :",
  "triggers.nl_interval_colon": "Intervalle :",
  "triggers.nl_filter_colon": "Filtre :",
  "triggers.nl_could_not_parse": "Impossible d'analyser l'expression de déclencheur",
  "triggers.active_hours_every_day": "Heures actives chaque jour",
  "triggers.event_type_to_listen": "Type d'événement à écouter",
  "triggers.event_type_input_placeholder": "ex. order.placed, user.signup",
  "triggers.event_type_helper": "Entrez un type d'événement personnalisé ou choisissez parmi les types courants",
  "triggers.source_filter_optional_label": "Filtre source (facultatif)",
  "triggers.wildcard_hint": "Utilisez * comme joker — ex. « order.* » correspond à tous les événements de commande",
  "triggers.window_title_pattern_label": "Schéma de titre de fenêtre",
  "triggers.optional_regex_label": "Expression régulière facultative",
  "triggers.text_pattern_label": "Schéma de texte",
  "triggers.credential_event_label": "Événement d'identifiant",
  "triggers.refresh_label": "Actualiser",
  "triggers.copy_webhook_url_title": "Copier l'URL du webhook",
  "triggers.copy_webhook_secret_title": "Copier le secret du webhook",
  "triggers.delete_webhook_title": "Supprimer le webhook",
  "triggers.status_col_label": "Statut",
  "triggers.duration_col_label": "Durée",
  "triggers.cost_col_label": "Coût",
  "triggers.dead_letter_refresh": "Actualiser",
  "triggers.dead_letter_loading": "Chargement...",
  "triggers.dead_letter_retry": "Réessayer",
  "triggers.dead_letter_discard": "Ignorer",
  "triggers.dead_letter_payload": "Charge utile",
  "triggers.event_data_section_label": "Données de l'événement",
  "triggers.copy_event_data_title": "Copier les données de l'événement",
  "triggers.copied_label": "Copié",
  "triggers.error_section_label": "Erreur",
  "triggers.meta_event_id": "ID de l'événement",
  "triggers.meta_project": "Projet",
  "triggers.meta_processed": "Traité",
  "triggers.clear_stream": "Effacer le flux",
  "triggers.clear_stream_title": "Effacer le flux d'événements",
  "triggers.col_type": "Type",
  "triggers.col_source": "Source",
  "triggers.col_target_agent": "Agent cible",
  "triggers.col_status": "Statut",
  "triggers.col_time": "Heure",
  "triggers.queued_bare": "En attente",
  "triggers.pause_tooltip": "Suspendre le déclencheur",
  "triggers.resume_tooltip": "Reprendre le déclencheur",
  "triggers.relay_label_field": "Libellé",
  "triggers.relay_channel_url_field": "URL du canal",
  "triggers.relay_route_to_agent": "Acheminer vers l'agent",
  "triggers.optional_suffix": "(facultatif)",
  "triggers.relay_event_filter_field": "Filtre d'événements",
  "triggers.relay_event_filter_note": "Filtrez les événements entrants par type ou schéma",
  "triggers.relay_confirm_delete": "Supprimer ce relais ?",
  "triggers.setup_guide_step2": "Copiez l'URL du webhook",
  "triggers.setup_guide_step3": "Configurez votre service pour envoyer des événements à cette URL",
  "triggers.setup_guide_step4": "Testez en envoyant un événement test",
  "triggers.get_channel_url_prompt": "Obtenez l'URL du canal depuis votre service",
  "triggers.gate_if_else_label": "Si/Sinon",
  "triggers.gate_if_else_description": "Acheminez les événements selon une condition booléenne",
  "triggers.gate_classifier_label": "Classifieur",
  "triggers.gate_classifier_description": "Classifiez et acheminez les événements par catégorie détectée",
  "triggers.gate_fan_out_label": "Diffusion",
  "triggers.gate_fan_out_description": "Diffusez les événements vers plusieurs agents simultanément",
  "triggers.palette_help_text": "Faites glisser les éléments de la palette vers le canevas pour construire votre flux d'événements",
  "triggers.test_event_type_placeholder": "ex. order.placed",
  "triggers.result_id_prefix": "ID :",
  "triggers.result_type_prefix": "Type :",
  "triggers.result_status_prefix": "Statut :",
  "triggers.result_target_prefix": "Cible :",
  "triggers.tab_loading": "Chargement...",
  "triggers.smee_open_new_title": "Ouvrir dans un nouvel onglet",
  "triggers.relay_label_placeholder": "ex. Mon relais",
  "triggers.relay_channel_url_placeholder": "https://smee.io/...",
  "triggers.relay_filter_placeholder": "ex. order.*, user.signup",
  "triggers.dead_letter_retry_exhausted_title": "Tentatives épuisées",
  "triggers.dead_letter_discard_title": "Ignorer l'événement",
  "triggers.dead_letter_retry_title": "Ré-essayer l'événement",
  "triggers.replay_button_title": "Rejouer l'événement",
  "triggers.interval_seconds_placeholder": "ex. 3600",
  "triggers.cron_expression_placeholder": "ex. 0 9 * * 1-5",
  "triggers.app_focus_window_placeholder": "ex. Visual Studio Code",
  "triggers.app_focus_process_placeholder": "ex. code",
  "triggers.field_optional": "(facultatif)",
  "triggers.source_filter_input_placeholder": "ex. agent-id ou motif glob",
  "triggers.meta_source": "Source",
  "triggers.relay_last_event": "Dernier événement :",
  "triggers.relay_delete_title": "Supprimer le relais",
  "triggers.setup_guide_step1": "Créez un nouveau webhook entrant dans {platform}",
  "triggers.clipboard_pattern_placeholder": "ex. montant total :",
  "triggers.composite_event_type_placeholder": "ex. order.placed",
  "triggers.composite_debounce_placeholder": "ex. 5000",
  "triggers.file_watcher_path_placeholder": "ex. /chemin/vers/dossier",
  "triggers.file_watcher_pattern_placeholder": "ex. *.json",
  "triggers.polling_endpoint_placeholder": "ex. https://api.example.com/status",
  "triggers.more_tools_title": "Plus d'outils",
  "triggers.validate_and_fire_title": "Valider et déclencher",
  "triggers.simulate_trigger_title": "Simuler le déclencheur",

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
  // Escape double quotes and backslashes for insertion as a TS string
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Parse fr.ts to find where each key's section/subsection ends so we can
// insert missing leaf keys before the closing `},` of their parent object.
// Strategy: line-by-line scan tracking nesting stack.

const frSrc = readFileSync(FR_PATH, 'utf-8');
const frLines = frSrc.split('\n');

// Build a map: dotted-path → line index of the CLOSING `},` or `},` of its parent
// We'll insert missing keys just BEFORE the closing `},` of their parent.

// Track nesting: stack of {key, openLine}
function findInsertionPoints(lines) {
  // Returns Map<parentDottedPath, lineIndexOfClosingBrace>
  const result = new Map();
  const stack = []; // [{key, startLine}]
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

    // Check for object key opening
    const keyMatch = trimmed.match(/^(?:"([^"]+)"|'([^']+)'|([\w$]+))\s*:/);
    if (keyMatch) {
      const key = keyMatch[1] ?? keyMatch[2] ?? keyMatch[3];
      const afterColon = stripped.slice(stripped.indexOf(':') + 1);
      if (afterColon.includes('{') && opens > closes) {
        stack.push({ key, startLine: i });
      }
    }

    // Handle net closes
    const netClose = closes - opens;
    for (let c = 0; c < netClose; c++) {
      if (stack.length > 0) {
        const frame = stack.pop();
        const dotPath = stack.map(f => f.key).filter(k => k !== '__root__').concat(frame.key).join('.');
        // Record: this line i is where the closing brace is
        result.set(dotPath, i);
      }
    }
  }

  return result;
}

const insertionPoints = findInsertionPoints(frLines);

// Group missing translations by parent path
const byParent = new Map();
for (const [fullKey, frVal] of Object.entries(TRANSLATIONS)) {
  const parts = fullKey.split('.');
  const leafKey = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join('.');
  if (!byParent.has(parentPath)) byParent.set(parentPath, []);
  byParent.get(parentPath).push({ leafKey, frVal, fullKey });
}

// Sort parents by their line number (descending) so insertions don't shift earlier lines
const parentEntries = [...byParent.entries()].map(([parent, keys]) => {
  const lineIdx = insertionPoints.get(parent);
  return { parent, keys, lineIdx };
}).filter(e => e.lineIdx !== undefined);

// Sort descending by line index
parentEntries.sort((a, b) => b.lineIdx - a.lineIdx);

// Track which keys were not placed (parent not found in fr.ts)
const unplaced = [];

// Check which parents exist
for (const [parent, keys] of byParent.entries()) {
  if (!insertionPoints.has(parent)) {
    unplaced.push(...keys.map(k => k.fullKey));
  }
}

// Now perform insertions (from bottom to top of file)
const outputLines = [...frLines];
const DATE_TAG = '// @llm-translated 2026-04-17';

// We need indentation. Look at existing lines in the parent to guess indent.
function getIndent(lines, closingLineIdx) {
  // Look at previous non-empty lines to find indent
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

let totalInserted = 0;
for (const { parent, keys, lineIdx } of parentEntries) {
  const indent = getIndent(outputLines, lineIdx);
  const insertLines = [];
  for (const { leafKey, frVal } of keys) {
    insertLines.push(`${indent}${DATE_TAG}`);
    insertLines.push(`${indent}${leafKey}: "${escapeValue(frVal)}",`);
  }
  // Insert BEFORE the closing brace line
  outputLines.splice(lineIdx, 0, ...insertLines);
  totalInserted += keys.length;
}

writeFileSync(FR_PATH, outputLines.join('\n'), 'utf-8');
console.log(`Inserted ${totalInserted} keys.`);
console.log(`Unplaced keys (parent not found): ${unplaced.length}`);
if (unplaced.length > 0) {
  console.log(unplaced.slice(0, 20).join('\n'));
}
