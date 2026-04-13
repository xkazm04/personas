'use strict';
const fs = require('fs');
const outPath = require('path').join(__dirname, '../.planning/i18n/translated-fr.json');
const out = JSON.parse(fs.readFileSync(outPath, 'utf8'));

function t(k, v) { out[k] = v; }

// vault.features.rotation_policy
t('vault.features.rotation_policy.oauth_refresh_active', "Actualisation du jeton OAuth active");
t('vault.features.rotation_policy.oauth_refresh_active_auto', "Actualisation du jeton OAuth active (auto)");
t('vault.features.rotation_policy.auto_rotation_active', "Rotation automatique active");
t('vault.features.rotation_policy.rotation_paused', "Rotation suspendue");
t('vault.features.rotation_policy.rotate_now', "Faire pivoter maintenant");
t('vault.features.rotation_policy.enable_rotation', "Activer la rotation");
t('vault.features.rotation_policy.enabling', "Activation...");
t('vault.features.rotation_policy.remove_policy_tooltip', "Supprimer la politique de rotation");
t('vault.features.rotation_policy.save', "Enregistrer");
t('vault.features.rotation_policy.cancel', "Annuler");
t('vault.features.rotation_policy.rotation_failed', "Échec de la rotation : {error}");
t('vault.features.rotation_policy.remove_failed', "Impossible de supprimer la politique : {error}");
t('vault.features.rotation_policy.update_failed', "Impossible de mettre à jour la période de rotation : {error}");
t('vault.features.rotation_policy.enable_failed', "Impossible d'activer la rotation : {error}");
t('vault.features.rotation_policy.last_rotated', "Dernière rotation {time}");

// vault.features.anomaly
t('vault.features.anomaly.healthy', "Sain");
t('vault.features.anomaly.transient_issues', "Problèmes temporaires");
t('vault.features.anomaly.degrading', "En dégradation");
t('vault.features.anomaly.permanent_errors', "Erreurs persistantes");
t('vault.features.anomaly.critical', "Critique");
t('vault.features.anomaly.stale', "obsolète");
t('vault.features.anomaly.samples', "{count} vérifications");
t('vault.features.anomaly.permanent', "Persistant : {rate}");
t('vault.features.anomaly.transient', "Temporaire : {rate}");
t('vault.features.anomaly.tolerance', "Tolérance : {rate}");

// vault.features.rotation_badge
t('vault.features.rotation_badge.disabled', "Désactivée");
t('vault.features.rotation_badge.perm_errors', "Erreurs persistantes");
t('vault.features.rotation_badge.degrading', "En dégradation");
t('vault.features.rotation_badge.backoff', "En attente de nouvelle tentative");

// vault.features.audit
t('vault.features.audit.empty', "Aucune entrée d'audit. Les opérations seront enregistrées au fur et à mesure.");
t('vault.features.audit.op_decrypted', "Déchiffré");
t('vault.features.audit.op_created', "Créé");
t('vault.features.audit.op_updated', "Mis à jour");
t('vault.features.audit.op_deleted', "Supprimé");
t('vault.features.audit.op_healthcheck', "Test de connexion");
t('vault.features.audit.filter_all', "tout");

// vault.card
t('vault.card.scope_mismatch', "Portées non concordantes");
t('vault.card.scope_missing_one', "{count} portée demandée non accordée : ");
t('vault.card.scope_missing_other', "{count} portées demandées non accordées : ");
t('vault.card.reauthorize', "Réautoriser");

// vault.forms
t('vault.forms.auth_oauth', "OAuth");
t('vault.forms.auth_api_key', "Clé API");
t('vault.forms.auth_mcp', "MCP");
t('vault.forms.healthcheck_passed', "Test de connexion réussi");
t('vault.forms.healthcheck_failed', "Échec du test de connexion");
t('vault.forms.healthcheck_running', "Test de connexion en cours...");
t('vault.forms.technical_details', "Détails techniques");
t('vault.forms.how_to_get', "Comment obtenir");
t('vault.forms.how_to_get_suffix', "les identifiants");
t('vault.forms.back_to_catalog', "Retour au catalogue");
t('vault.forms.new_credential', "Nouvel identifiant");
t('vault.forms.configure_mcp', "Configurer la connexion au serveur MCP");
t('vault.forms.configure_fields', "Configurer les champs de l'identifiant");
t('vault.forms.detect', "Détecter");
t('vault.forms.auto_add', "Ajout automatique");

// vault.type_picker
t('vault.type_picker.title', "Ajouter un identifiant");
t('vault.type_picker.subtitle', "Choisissez le type de connexion");
t('vault.type_picker.ai_built', "Connecteur créé par IA");
t('vault.type_picker.ai_built_hint', "Décrivez ce à quoi vous voulez vous connecter et l'IA crée la configuration pour vous — aucune configuration requise.");
t('vault.type_picker.ai_built_use', "Idéal pour : Slack, GitHub, Notion, Linear, Jira");
t('vault.type_picker.most_popular', "Plus populaire");
t('vault.type_picker.mcp_server', "Serveur d'outils IA");
t('vault.type_picker.mcp_server_hint', "Connectez-vous à un serveur d'outils IA — collez l'adresse et c'est prêt.");
t('vault.type_picker.mcp_server_use', "Idéal pour : serveurs d'outils et plugins compatibles MCP");
t('vault.type_picker.web_service', "Service web");
t('vault.type_picker.web_service_hint', "Connectez-vous à n'importe quel service web — nous vous guidons étape par étape.");
t('vault.type_picker.web_service_use', "Idéal pour : API REST, webhooks ou services absents du catalogue");
t('vault.type_picker.database', "Base de données");
t('vault.type_picker.database_hint', "Connectez-vous à votre base de données — collez les informations de connexion et choisissez vos tables.");
t('vault.type_picker.database_use', "Idéal pour : PostgreSQL, MySQL, SQLite, MongoDB");
t('vault.type_picker.desktop_app', "Application de bureau");
t('vault.type_picker.desktop_app_hint', "Associez les applications déjà installées sur votre ordinateur comme VS Code, Docker ou Obsidian en un clic.");
t('vault.type_picker.desktop_app_use', "Idéal pour : VS Code, Docker, Obsidian, outils CLI locaux");
t('vault.type_picker.ai_wizard', "Assistant de configuration IA");
t('vault.type_picker.ai_wizard_hint', "Laissez l'IA trouver vos services et tout configurer automatiquement — suivez simplement les étapes.");
t('vault.type_picker.ai_wizard_recommended', "Recommandé pour les débutants");
t('vault.type_picker.ai_wizard_use', "Idéal pour : première configuration ou si vous ne savez pas quoi choisir");
t('vault.type_picker.ai_wizard_cta', "Pas sûr ? Commencez ici");
t('vault.type_picker.workspace_connect', "Connexion Espace de travail");
t('vault.type_picker.workspace_connect_hint', "Une connexion Google crée automatiquement les identifiants Gmail, Calendar, Drive et Sheets");
t('vault.type_picker.auto_discover', "Détection automatique des identifiants");
t('vault.type_picker.auto_discover_hint', "Analysez votre système à la recherche de clés API, profils AWS, variables d'environnement, etc.");

// vault.body
t('vault.body.authorizing', "Autorisation avec {name}...");
t('vault.body.authorize_with', "Autoriser avec {name}");
t('vault.body.authorize_hint', "Ouvre la connexion {name} et enregistre votre accès après approbation.");
t('vault.body.consent_completed', "Consentement {name} accordé à {time}");
t('vault.body.update_failed', "Échec de la mise à jour de l'identifiant");
t('vault.body.delete_credential', "Supprimer l'identifiant");

// vault.connector
t('vault.connector.filter_all', "Tout");
t('vault.connector.filter_connected', "Connecté");
t('vault.connector.filter_available', "Disponible");

// vault.auto_cred
t('vault.auto_cred.guided_setup', "Configuration guidée");
t('vault.auto_cred.auto_setup', "Configuration automatique");
t('vault.auto_cred.guided_consent_body', "Claude vous guidera étape par étape dans la création des identifiants. Les URL s'ouvriront automatiquement dans votre navigateur.");
t('vault.auto_cred.auto_consent_body', "Claude a conçu les informations de connexion. Une fenêtre de navigateur s'ouvrira pour créer l'identifiant réel en votre nom.");
t('vault.auto_cred.what_will_happen', "Ce qui va se passer :");
t('vault.auto_cred.log_in_first', "Connectez-vous d'abord.");
t('vault.auto_cred.log_in_hint', "Assurez-vous d'être déjà inscrit et connecté à {label} dans votre navigateur avant de démarrer. Cela permet à l'automatisation d'accéder directement à vos paramètres de compte.");
t('vault.auto_cred.your_consent', "Votre consentement est requis.");
t('vault.auto_cred.guided_consent_hint', "Rien n'est enregistré sans votre approbation explicite. Vous créerez l'identifiant vous-même en suivant les instructions guidées.");
t('vault.auto_cred.auto_consent_hint', "Rien n'est enregistré sans votre approbation explicite. Si une page de connexion ou un CAPTCHA apparaît, le navigateur se mettra en pause pour que vous puissiez intervenir manuellement.");
t('vault.auto_cred.view_docs', "Voir la documentation des identifiants");
t('vault.auto_cred.start_guided', "Démarrer la configuration guidée");
t('vault.auto_cred.start_browser', "Démarrer la session navigateur");
t('vault.auto_cred.browser_error_title', "Échec de la configuration automatique");
t('vault.auto_cred.setup_manually', "Configurer manuellement");
t('vault.auto_cred.retry', "Réessayer");
t('vault.auto_cred.what_happened', "Ce qui s'est passé");
t('vault.auto_cred.session_duration', "Session exécutée pendant {seconds}s");
t('vault.auto_cred.actions_performed_one', "{count} action navigateur effectuée");
t('vault.auto_cred.actions_performed_other', "{count} actions navigateur effectuées");
t('vault.auto_cred.last_url', "Dernière URL : {url}");
t('vault.auto_cred.captcha_encountered', "Une invite de connexion/CAPTCHA a été rencontrée");
t('vault.auto_cred.last_actions', "Dernières actions :");
t('vault.auto_cred.session_log', "Journal de session ({count} entrées)");
t('vault.auto_cred.step_confirmed', "Étape confirmée — en attente de détection");
t('vault.auto_cred.action_required', "Action requise");
t('vault.auto_cred.open_in_browser', "Ouvrir dans le navigateur");
t('vault.auto_cred.completed_step', "J'ai terminé cette étape");
t('vault.auto_cred.input_requested', "Saisie demandée");

// vault.vector
t('vault.vector.documents_tab', "Documents");
t('vault.vector.search_tab', "Recherche");
t('vault.vector.settings_tab', "Paramètres");
t('vault.vector.ingest_title', "Ajouter des documents");
t('vault.vector.ingest_hint', "Déposez des fichiers ici ou cliquez pour parcourir");
t('vault.vector.ingest_drop', "Déposez des fichiers pour les ajouter");
t('vault.vector.ingest_supported', "Pris en charge : txt, md, html, csv, json, yaml, fichiers de code");
t('vault.vector.starting_ingestion', "Traitement des fichiers...");
t('vault.vector.no_valid_files', "Aucun chemin de fichier valide trouvé. Essayez de déposer des fichiers individuels.");
t('vault.vector.no_documents', "Aucun document");
t('vault.vector.no_documents_hint', "Déposez des fichiers, collez du texte ou analysez un répertoire pour commencer à construire votre base de connaissances.");
t('vault.vector.refresh', "Actualiser");
t('vault.vector.paste_text', "Coller du texte");
t('vault.vector.directory', "Répertoire");
t('vault.vector.delete_document', "Supprimer le document");
t('vault.vector.document_count_one', "{count} document");
t('vault.vector.document_count_other', "{count} documents");
t('vault.vector.show_full', "Afficher l'extrait complet");
t('vault.vector.show_less', "Afficher moins");
t('vault.vector.copy_content', "Copier le contenu");
t('vault.vector.kb_info', "Infos sur la base de connaissances");
t('vault.vector.embedding_model', "Modèle de recherche");
t('vault.vector.dimensions', "Dimensions");
t('vault.vector.chunk_size', "Taille de section");
t('vault.vector.chunk_overlap', "Chevauchement de section");
t('vault.vector.statistics', "Statistiques");
t('vault.vector.documents', "Documents");
t('vault.vector.chunks', "Sections");
t('vault.vector.local_embedding', "Recherche locale");
t('vault.vector.local_embedding_hint', "L'indexation de la recherche s'exécute localement avec {model} ({dims} dim). Aucune donnée ne quitte votre machine. Le modèle (~23 Mo) est téléchargé à la première utilisation et enregistré localement.");

// vault.design_modal
t('vault.design_modal.title', "Concevoir un identifiant");
t('vault.design_modal.error_title', "Une erreur est survenue");
t('vault.design_modal.error_unexpected', "Une erreur inattendue s'est produite.");
t('vault.design_modal.error_parse_failed', "L'IA n'a pas pu générer un connecteur valide à partir de votre description.");
t('vault.design_modal.error_timeout', "La requête a pris trop de temps et a été interrompue. Cela peut arriver avec des demandes très générales.");
t('vault.design_modal.error_cli_missing', "L'interface CLI Claude n'est pas installée sur ce système.");
t('vault.design_modal.error_env_conflict', "Une variable d'environnement en conflit bloque l'interface CLI. Redémarrez l'application pour corriger cela automatiquement.");
t('vault.design_modal.error_backend', "Le backend IA a renvoyé une erreur inattendue.");
t('vault.design_modal.technical_details', "Détails techniques");
t('vault.design_modal.how_to_fix', "Comment corriger cela");
t('vault.design_modal.original_request', "Votre demande d'origine (conservée) :");
t('vault.design_modal.start_over', "Recommencer");
t('vault.design_modal.try_again_with', "Réessayer avec votre demande");

// vault.desktop
t('vault.desktop.installed', "Installé");
t('vault.desktop.running', "En cours d'exécution");
t('vault.desktop.not_installed', "Non installé");

// vault.graph
t('vault.graph.no_dependencies', "Aucune dépendance");
t('vault.graph.connection_count_one', "{count} connexion");
t('vault.graph.connection_count_other', "{count} connexions");
t('vault.graph.dep_count_one', "{count} dép.");
t('vault.graph.dep_count_other', "{count} dép.");
t('vault.graph.not_tested', "Non testé");
t('vault.graph.healthy', "Sain");
t('vault.graph.unhealthy', "Défaillant");

// vault.wizard
t('vault.wizard.detected', "Détecté ({count})");
t('vault.wizard.available', "Disponible ({count})");
t('vault.wizard.already_added', "Déjà ajouté ({count})");
t('vault.wizard.no_match', "Aucun service ne correspond à \"{search}\"");
t('vault.wizard.already_added_badge', "Déjà ajouté");
t('vault.wizard.local', "Local");
t('vault.wizard.cli_auth', "Auth CLI");
t('vault.wizard.session', "Session");

// vault.playground
t('vault.playground.mcp_input_schema', "Schéma d'entrée");
t('vault.playground.mcp_run', "Exécuter");
t('vault.playground.mcp_error', "Erreur");
t('vault.playground.mcp_success', "Succès");
t('vault.playground.mcp_empty', "(vide)");
t('vault.playground.mcp_discover', "Découvrir les outils du serveur MCP");
t('vault.playground.mcp_discover_hint', "Connectez-vous au serveur MCP pour découvrir les outils disponibles et les tester.");
t('vault.playground.mcp_discover_button', "Découvrir les outils");
t('vault.playground.response_empty', "(réponse vide)");
t('vault.playground.header', "En-tête");
t('vault.playground.value', "Valeur");

// vault.playground_extra
t('vault.playground_extra.add_tag', "Ajouter un tag...");
t('vault.playground_extra.body_label', "Corps");
t('vault.playground_extra.credential_id', "ID d'identifiant");
t('vault.playground_extra.enabled', "Activé");
t('vault.playground_extra.header_col', "En-tête");
t('vault.playground_extra.id', "ID");
t('vault.playground_extra.name', "Nom");
t('vault.playground_extra.no_endpoints', "Aucun point de terminaison");
t('vault.playground_extra.no_endpoints_hint', "Chargez une spécification OpenAPI pour voir les points de terminaison disponibles.");
t('vault.playground_extra.no_recipes', "Aucune recette");
t('vault.playground_extra.parse_load', "Analyser et charger");
t('vault.playground_extra.parsing', "Analyse en cours...");
t('vault.playground_extra.paste_placeholder', "Collez la spécification OpenAPI ici...");
t('vault.playground_extra.paste_spec_title', "Coller une spécification OpenAPI");
t('vault.playground_extra.path_parameters', "Paramètres de chemin");
t('vault.playground_extra.query_parameters', "Paramètres de requête");
t('vault.playground_extra.recipes_title', "Recettes");
t('vault.playground_extra.truncated_warning', "Réponse tronquée");
t('vault.playground_extra.value_col', "Valeur");

// vault.ingest
t('vault.ingest.save_name', "Enregistrer sous le nom");
t('vault.ingest.rename_credential', "Renommer l'identifiant");

// vault.databases
t('vault.databases.col_database', "Base de données");
t('vault.databases.col_type', "Type");
t('vault.databases.col_tables', "Tables");
t('vault.databases.col_queries', "Requêtes");
t('vault.databases.col_created', "Créé");
t('vault.databases.no_credentials', "Aucun identifiant de base de données");
t('vault.databases.no_credentials_hint', "Ajoutez un identifiant de base de données dans le Coffre-fort pour commencer.");
t('vault.databases.no_matching', "Aucun identifiant correspondant");
t('vault.databases.no_matching_hint', "Essayez d'ajuster vos filtres ou votre terme de recherche.");
t('vault.databases.all_types', "Tous les types");
t('vault.databases.schema_manager', "Gestionnaire de schéma");
t('vault.databases.save_name', "Enregistrer sous le nom");
t('vault.databases.rename_credential', "Renommer l'identifiant");
t('vault.databases.tab_tables', "Tables");
t('vault.databases.tab_queries', "Requêtes");
t('vault.databases.tab_console', "Console");
t('vault.databases.tab_chat', "Chat");
t('vault.databases.query_success', "Requête exécutée avec succès");
t('vault.databases.no_rows', "Aucun résultat");
t('vault.databases.copied', "Copié");
t('vault.databases.click_copy_column', "Cliquer pour copier la colonne");
t('vault.databases.click_copy_cell', "Cliquer pour copier la cellule");
t('vault.databases.row_count_one', "{count} ligne");
t('vault.databases.row_count_other', "{count} lignes");
t('vault.databases.results_truncated', "Résultats tronqués");
t('vault.databases.generated_label', "Généré");
t('vault.databases.copy_sql', "Copier le SQL");
t('vault.databases.run_query', "Exécuter la requête");
t('vault.databases.rerun_query', "Réexécuter la requête");
t('vault.databases.executing', "Exécution...");
t('vault.databases.placeholder_initial', "Décrivez votre requête en langage naturel...");
t('vault.databases.placeholder_followup', "Demandez une modification ou posez une question de suivi...");
t('vault.databases.generating_query', "Génération de la requête...");
t('vault.databases.ask_plain_english', "Demandez en langage courant");
t('vault.databases.describe_query', "Décrivez ce que vous voulez interroger");
t('vault.databases.query_generated', "Requête générée");
t('vault.databases.query_failed', "Échec de la requête");
t('vault.databases.cancelled', "Annulé");
t('vault.databases.loading_columns', "Chargement des colonnes...");
t('vault.databases.no_properties', "Aucune propriété");
t('vault.databases.no_columns', "Aucune colonne");
t('vault.databases.col_column', "Colonne");
t('vault.databases.col_property', "Propriété");
t('vault.databases.col_notion_type', "Type Notion");
t('vault.databases.col_field_type', "Type de champ");
t('vault.databases.nullable', "Nullable");
t('vault.databases.default_val', "Valeur par défaut");
t('vault.databases.column_count_one', "{count} colonne");
t('vault.databases.column_count_other', "{count} colonnes");
t('vault.databases.property_count_one', "{count} propriété");
t('vault.databases.property_count_other', "{count} propriétés");
t('vault.databases.redis_hint', "Entrez une commande Redis");
t('vault.databases.sql_hint', "Entrez une requête SQL");
t('vault.databases.executing_query', "Exécution de la requête...");
t('vault.databases.redis_placeholder', "Entrez une commande Redis...");
t('vault.databases.convex_placeholder', "Entrez une requête Convex...");
t('vault.databases.sql_placeholder', "Entrez une requête SQL...");
t('vault.databases.running', "En cours...");
t('vault.databases.safe_mode', "Mode sécurisé");
t('vault.databases.write_mode', "Mode écriture");
t('vault.databases.safe_mode_on', "Mode sécurisé activé");
t('vault.databases.safe_mode_off', "Mode sécurisé désactivé");
t('vault.databases.recent', "Récent");
t('vault.databases.modifies_data', "Modifie les données");
t('vault.databases.modifies_data_hint', "Cette requête modifie les données. Le mode sécurisé est activé — passez en mode écriture pour exécuter les requêtes de modification.");
t('vault.databases.modifies_data_hint_short', "Activez le mode écriture pour exécuter.");
t('vault.databases.execute_anyway', "Exécuter quand même");
t('vault.databases.select_or_create', "Sélectionner ou créer");
t('vault.databases.new_query', "Nouvelle requête");
t('vault.databases.query_title_placeholder', "Nom de la requête...");
t('vault.databases.no_saved_queries', "Aucune requête enregistrée");
t('vault.databases.saved', "Enregistré");
t('vault.databases.saving', "Enregistrement...");
t('vault.databases.save', "Enregistrer");
t('vault.databases.run', "Exécuter");
t('vault.databases.debugging', "Débogage");
t('vault.databases.ai_run', "Exécution IA");
t('vault.databases.safe', "Sécurisé");
t('vault.databases.write', "Écriture");
t('vault.databases.redis_run_hint', "Maj+Entrée pour exécuter");
t('vault.databases.sql_run_hint', "Maj+Entrée pour exécuter");
t('vault.databases.testing', "Test...");
t('vault.databases.test_connection', "Tester la connexion");
t('vault.databases.copy_select_query', "Copier la requête SELECT");
t('vault.databases.copy_table_name', "Copier le nom de la table");
t('vault.databases.pin', "Épingler");
t('vault.databases.pinned', "Épinglé");
t('vault.databases.pin_table', "Épingler la table");
t('vault.databases.loading_key_info', "Chargement des informations sur la clé...");
t('vault.databases.type_label', "Type");
t('vault.databases.use_console_hint', "Utilisez la console pour exécuter des requêtes.");
t('vault.databases.select_db_hint', "Sélectionnez une base de données pour commencer.");
t('vault.databases.select_table_hint', "Sélectionnez une table pour afficher son schéma.");
t('vault.databases.select_key_hint', "Sélectionnez une clé pour afficher ses informations.");
t('vault.databases.loading', "Chargement...");
t('vault.databases.no_databases_found', "Aucune base de données trouvée");
t('vault.databases.no_tables_found', "Aucune table trouvée");
t('vault.databases.no_matching_tables', "Aucune table correspondante");
t('vault.databases.no_keys_found', "Aucune clé trouvée");
t('vault.databases.no_matching_keys', "Aucune clé correspondante");
t('vault.databases.key_count_one', "{count} clé");
t('vault.databases.key_count_other', "{count} clés");
t('vault.databases.database_count_one', "{count} base de données");
t('vault.databases.database_count_other', "{count} bases de données");
t('vault.databases.table_count_one', "{count} table");
t('vault.databases.table_count_other', "{count} tables");
t('vault.databases.filter_keys', "Filtrer les clés");
t('vault.databases.filter_databases', "Filtrer les bases de données");
t('vault.databases.filter_tables', "Filtrer les tables");
t('vault.databases.refresh', "Actualiser");
t('vault.databases.introspection_unavailable', "Introspection non disponible");

// vault.dependencies
t('vault.dependencies.simulate_revocation', "Simuler la révocation");
t('vault.dependencies.blast_radius', "Rayon d'impact");
t('vault.dependencies.impact_high', "Impact élevé");
t('vault.dependencies.impact_medium', "Impact moyen");
t('vault.dependencies.impact_low', "Impact faible");
t('vault.dependencies.affected_agents', "Agents affectés");
t('vault.dependencies.affected_events', "Événements affectés");
t('vault.dependencies.no_credentials_graph', "Aucun identifiant dans le graphe");
t('vault.dependencies.no_credentials_graph_hint', "Ajoutez des identifiants pour voir leurs dépendances.");
t('vault.dependencies.no_credential_selected', "Aucun identifiant sélectionné");
t('vault.dependencies.no_credential_selected_hint', "Sélectionnez un identifiant pour afficher son graphe de dépendances.");
t('vault.dependencies.credentials_label', "Identifiants");
t('vault.dependencies.relationships', "Relations");
t('vault.dependencies.more_relationships', "Plus de relations");
t('vault.dependencies.kind_credentials', "Identifiants");
t('vault.dependencies.kind_agents', "Agents");
t('vault.dependencies.kind_events', "Événements");
t('vault.dependencies.severity_low', "Faible");
t('vault.dependencies.severity_medium', "Moyen");
t('vault.dependencies.severity_high', "Élevé");
t('vault.dependencies.severity_critical', "Critique");
t('vault.dependencies.not_tested', "Non testé");
t('vault.dependencies.healthy', "Sain");
t('vault.dependencies.unhealthy', "Défaillant");
t('vault.dependencies.dep_count_one', "{count} dépendance");
t('vault.dependencies.dep_count_other', "{count} dépendances");
t('vault.dependencies.connection_count_one', "{count} connexion");
t('vault.dependencies.connection_count_other', "{count} connexions");
t('vault.dependencies.personas_would_stop', "Les personas s'arrêteraient");
t('vault.dependencies.workflows_would_break', "Les workflows seraient interrompus");
t('vault.dependencies.nodes_broken', "Nœuds cassés");
t('vault.dependencies.failover_credentials', "Identifiants de basculement");
t('vault.dependencies.suggested_mitigations', "Atténuations suggérées");
t('vault.dependencies.mitigation_failover', "Basculer vers un identifiant alternatif");
t('vault.dependencies.mitigation_pause', "Suspendre les agents affectés");
t('vault.dependencies.mitigation_schedule', "Planifier la rotation");
t('vault.dependencies.mitigation_create', "Créer un identifiant de remplacement");
t('vault.dependencies.revocation_simulation', "Simulation de révocation");
t('vault.dependencies.personas_affected', "Personas affectés");
t('vault.dependencies.workflows_broken', "Workflows interrompus");
t('vault.dependencies.daily_execs_lost', "Exécutions quotidiennes perdues");
t('vault.dependencies.daily_cost_impact', "Impact sur le coût quotidien");
t('vault.dependencies.sim_low', "Faible");

// vault.shared
t('vault.shared.add', "Ajouter");
t('vault.shared.no_connector_available', "Aucun connecteur disponible");
t('vault.shared.request_builder', "Générateur de requêtes");
t('vault.shared.close', "Fermer");
t('vault.shared.response', "Réponse");
t('vault.shared.truncated_warning', "Réponse tronquée");
t('vault.shared.no_endpoints', "Aucun point de terminaison");
t('vault.shared.no_endpoints_hint', "Chargez une spécification pour voir les points de terminaison disponibles.");
t('vault.shared.upload_spec', "Charger une spécification");
t('vault.shared.paste_openapi', "Coller OpenAPI");
t('vault.shared.paste_spec_title', "Coller une spécification OpenAPI");
t('vault.shared.paste_spec_placeholder', "Collez la spécification OpenAPI ici (JSON ou YAML)...");
t('vault.shared.parsing', "Analyse en cours...");
t('vault.shared.parse_and_load', "Analyser et charger");
t('vault.shared.loading_api', "Chargement de l'API...");
t('vault.shared.example_endpoints_one', "{count} point de terminaison exemple");
t('vault.shared.example_endpoints_other', "{count} points de terminaison exemples");
t('vault.shared.filter', "Filtrer");
t('vault.shared.stop', "Arrêter");
t('vault.shared.run_all', "Tout exécuter");
t('vault.shared.no_endpoints_match', "Aucun point de terminaison correspondant");
t('vault.shared.no_endpoints_match_hint', "Essayez d'ajuster vos filtres.");
t('vault.shared.loading_recipes', "Chargement des recettes...");
t('vault.shared.recipes', "Recettes");
t('vault.shared.recipes_subtitle', "Workflows pré-configurés pour ce connecteur");
t('vault.shared.new_recipe', "Nouvelle recette");
t('vault.shared.no_recipes', "Aucune recette");
t('vault.shared.no_recipes_hint', "Créez votre première recette pour automatiser des tâches courantes.");
t('vault.shared.create_first_recipe', "Créer la première recette");
t('vault.shared.failed_delete_recipe', "Échec de la suppression de la recette");
t('vault.shared.create_recipe', "Créer une recette");
t('vault.shared.recipe_what', "Que doit faire cette recette ?");
t('vault.shared.recipe_placeholder', "Décrivez ce que la recette doit accomplir...");
t('vault.shared.generate_with_ai', "Générer avec l'IA");
t('vault.shared.starting', "Démarrage...");
t('vault.shared.generated_recipe', "Recette générée");
t('vault.shared.name_label', "Nom");
t('vault.shared.description_label', "Description");
t('vault.shared.prompt_template', "Modèle de prompt");
t('vault.shared.example_result', "Exemple de résultat");
t('vault.shared.accept_save', "Accepter et enregistrer");
t('vault.shared.regenerate', "Régénérer");
t('vault.shared.open_settings', "Ouvrir les paramètres");
t('vault.shared.created_label', "Créé");
t('vault.shared.updated_label', "Mis à jour");
t('vault.shared.recent_activity', "Activité récente");
t('vault.shared.no_recorded_activity', "Aucune activité enregistrée");
t('vault.shared.mcp_tools_label', "Outils MCP");
t('vault.shared.discovering', "Découverte...");
t('vault.shared.discover_tools', "Découvrir les outils");
t('vault.shared.discover_mcp', "Découvrir MCP");
t('vault.shared.discover_mcp_hint', "Connectez-vous au serveur MCP pour découvrir les outils disponibles.");
t('vault.shared.input_schema', "Schéma d'entrée");
t('vault.shared.no_input_params', "Aucun paramètre d'entrée");
t('vault.shared.test_tool', "Tester l'outil");
t('vault.shared.execute_tool', "Exécuter l'outil");
t('vault.shared.running_tool', "Exécution de l'outil...");
t('vault.shared.no_tools_found', "Aucun outil trouvé");
t('vault.shared.no_tools_hint', "Découvrez les outils MCP disponibles.");
t('vault.shared.test_connection', "Tester la connexion");
t('vault.shared.edit_fields', "Modifier les champs");
t('vault.shared.failed_update', "Échec de la mise à jour");
t('vault.shared.delete_credential_confirm', "Êtes-vous sûr de vouloir supprimer cet identifiant ?");
t('vault.shared.confirm', "Confirmer");
t('vault.shared.delete_credential', "Supprimer l'identifiant");
t('vault.shared.services', "Services");
t('vault.shared.events', "Événements");
t('vault.shared.vector_kb', "Base de connaissances vectorielle");
t('vault.shared.kb_not_found', "Base de connaissances introuvable");
t('vault.shared.scan_directory', "Analyser le répertoire");
t('vault.shared.directory_path', "Chemin du répertoire");
t('vault.shared.no_directory', "Aucun répertoire");
t('vault.shared.browsing', "Navigation...");
t('vault.shared.browse', "Parcourir");
t('vault.shared.file_patterns', "Modèles de fichiers");
t('vault.shared.file_patterns_hint', "Motifs glob pour inclure/exclure des fichiers (ex. : **/*.ts)");
t('vault.shared.scan_ingest', "Analyser et indexer");
t('vault.shared.scanning', "Analyse...");
t('vault.shared.drop_to_ingest', "Déposez pour indexer");
t('vault.shared.drop_supported', "Pris en charge : txt, md, html, csv, json, yaml, fichiers de code");
t('vault.shared.starting_ingestion', "Démarrage de l'indexation...");
t('vault.shared.preparing_ingestion', "Préparation de l'indexation...");
t('vault.shared.ingestion_failed', "Échec de l'indexation");
t('vault.shared.ingestion_done', "Indexation terminée");
t('vault.shared.processing_file', "Traitement du fichier {name}...");
t('vault.shared.processing', "Traitement...");
t('vault.shared.file_progress', "{current}/{total} fichiers");
t('vault.shared.paste_text', "Coller du texte");
t('vault.shared.title_label', "Titre");
t('vault.shared.title_placeholder', "Entrez un titre...");
t('vault.shared.content_label', "Contenu");
t('vault.shared.content_placeholder', "Collez le contenu ici...");
t('vault.shared.ingest', "Indexer");
t('vault.shared.ingesting', "Indexation...");
t('vault.shared.show_full_chunk', "Afficher la section complète");
t('vault.shared.show_less', "Afficher moins");
t('vault.shared.browse_files', "Parcourir les fichiers");
t('vault.shared.directory', "Répertoire");
t('vault.shared.search_kb', "Rechercher dans la base de connaissances");
t('vault.shared.search_kb_hint', "Recherchez dans les documents indexés");
t('vault.shared.search_placeholder', "Rechercher...");
t('vault.shared.search', "Rechercher");
t('vault.shared.results_label', "Résultats");
t('vault.shared.press_enter', "Appuyez sur Entrée pour rechercher");
t('vault.shared.no_results', "Aucun résultat");
t('vault.shared.no_results_hint', "Essayez un autre terme de recherche.");
t('vault.shared.kb_info', "Infos sur la base de connaissances");
t('vault.shared.statistics', "Statistiques");
t('vault.shared.local_embedding', "Recherche locale");
t('vault.shared.label_id', "ID");
t('vault.shared.label_status', "Statut");
t('vault.shared.label_embedding_model', "Modèle d'embedding");
t('vault.shared.label_dimensions', "Dimensions");
t('vault.shared.label_chunk_size', "Taille de section");
t('vault.shared.label_chunk_overlap', "Chevauchement de section");
t('vault.shared.label_created', "Créé");
t('vault.shared.label_updated', "Mis à jour");
t('vault.shared.label_documents', "Documents");
t('vault.shared.label_chunks', "Sections");
t('vault.shared.status_indexed', "Indexé");
t('vault.shared.status_error', "Erreur");
t('vault.shared.save_name', "Enregistrer sous le nom");
t('vault.shared.rename_credential', "Renommer l'identifiant");
t('vault.shared.no_documents_heading', "Aucun document");
t('vault.shared.no_documents_description', "Déposez des fichiers, collez du texte ou analysez un répertoire pour commencer.");
t('vault.shared.delete_document', "Supprimer le document");
t('vault.shared.chunks_label', "Sections");

// vault.manager
t('vault.manager.title', "Coffre-fort");
t('vault.manager.credentials_stored_one', "{count} identifiant stocké");
t('vault.manager.credentials_stored_other', "{count} identifiants stockés");
t('vault.manager.search_catalog', "Rechercher dans le catalogue");
t('vault.manager.search_credentials', "Rechercher des identifiants");
t('vault.manager.clear_search', "Effacer la recherche");
t('vault.manager.loading_credentials', "Chargement des identifiants...");
t('vault.manager.no_rotation_support', "Pas de support de rotation");
t('vault.manager.refresh_oauth_one', "Actualiser {count} jeton OAuth");
t('vault.manager.refresh_oauth_other', "Actualiser {count} jetons OAuth");
t('vault.manager.refreshing', "Actualisation...");
t('vault.manager.rotate_count', "Rotation de {count} identifiant(s)");
t('vault.manager.rotate', "Faire pivoter");
t('vault.manager.cancel_healthcheck', "Annuler le test");
t('vault.manager.test_all_credentials', "Tester tous les identifiants");
t('vault.manager.test_all', "Tout tester");
t('vault.manager.daily_progress', "Progression quotidienne");
t('vault.manager.testing_progress', "Progression des tests");

// vault.bulk_healthcheck
t('vault.bulk_healthcheck.title', "Test de santé en masse");
t('vault.bulk_healthcheck.needs_attention', "Nécessite une attention");
t('vault.bulk_healthcheck.slowest_responses', "Réponses les plus lentes");

// vault.health_bar
t('vault.health_bar.healthy', "Sain");
t('vault.health_bar.needs_attention', "Nécessite une attention");
t('vault.health_bar.untested', "Non testé");

// vault.breadcrumb
t('vault.breadcrumb.aria_label', "Fil d'Ariane");

// vault.credential_card
t('vault.credential_card.deleting', "Suppression...");
t('vault.credential_card.no_connector', "Aucun connecteur");
t('vault.credential_card.stored_result', "Résultat enregistré");
t('vault.credential_card.delete_credential', "Supprimer l'identifiant");
t('vault.credential_card.corrupted', "Corrompu");
t('vault.credential_card.corrupted_tooltip', "Cet identifiant est corrompu et ne peut pas être utilisé.");
t('vault.credential_card.field_count_one', "{count} champ");
t('vault.credential_card.field_count_other', "{count} champs");
t('vault.credential_card.add_tag_placeholder', "Ajouter un tag...");
t('vault.credential_card.add_tag_button', "Ajouter un tag");
t('vault.credential_card.remove_tag', "Supprimer le tag");
t('vault.credential_card.copy_credential_id', "Copier l'ID de l'identifiant");
t('vault.credential_card.refresh_oauth', "Actualiser OAuth");
t('vault.credential_card.refresh', "Actualiser");

// vault.vault_badge
t('vault.vault_badge.needs_attention', "Nécessite une attention");
t('vault.vault_badge.secure', "Sécurisé");
t('vault.vault_badge.unencrypted', "Non chiffré");
t('vault.vault_badge.encrypted', "Chiffré");
t('vault.vault_badge.encrypted_fallback', "Chiffré (secours)");
t('vault.vault_badge.vault_needs_attention', "Le Coffre-fort nécessite une attention");
t('vault.vault_badge.vault_secure', "Coffre-fort sécurisé");
t('vault.vault_badge.aes_title', "Chiffrement AES-256-GCM");
t('vault.vault_badge.aes_detail', "Les identifiants sont chiffrés avec AES-256-GCM.");
t('vault.vault_badge.keychain_title', "Trousseau système");
t('vault.vault_badge.fallback_key_title', "Clé de secours");
t('vault.vault_badge.keychain_detail', "La clé de chiffrement est stockée dans le trousseau système.");
t('vault.vault_badge.fallback_key_detail', "La clé de chiffrement est stockée en mémoire (secours).");
t('vault.vault_badge.local_title', "Stockage local");
t('vault.vault_badge.local_detail', "Les identifiants sont stockés localement sur votre appareil.");
t('vault.vault_badge.encrypting', "Chiffrement...");
t('vault.vault_badge.encrypt_now_one', "Chiffrer {count} identifiant maintenant");
t('vault.vault_badge.encrypt_now_other', "Chiffrer {count} identifiants maintenant");
t('vault.vault_badge.encrypt_done_one', "{count} identifiant chiffré");
t('vault.vault_badge.encrypt_done_other', "{count} identifiants chiffrés");
t('vault.vault_badge.encrypt_partial', "Chiffrement partiel");

// vault.delete_dialog
t('vault.delete_dialog.title', "Supprimer l'identifiant");
t('vault.delete_dialog.cannot_undo', "Cette action est irréversible.");
t('vault.delete_dialog.label_name', "Nom");
t('vault.delete_dialog.label_type', "Type");
t('vault.delete_dialog.unverified_warning', "Cet identifiant n'a pas été vérifié.");

// vault.card_body
t('vault.card_body.failed_update', "Échec de la mise à jour");
t('vault.card_body.authorizing_with', "Autorisation avec {name}...");
t('vault.card_body.authorize_with', "Autoriser avec {name}");
t('vault.card_body.authorize_hint', "Ouvre la connexion {name} et enregistre votre accès après approbation.");
t('vault.card_body.consent_completed', "Consentement {name} accordé à {time}");

// vault.card_details
t('vault.card_details.tab_intelligence', "Intelligence");
t('vault.card_details.tab_rotation', "Rotation");
t('vault.card_details.tab_token_lifetime', "Durée de vie du jeton");
t('vault.card_details.tab_services', "Services");
t('vault.card_details.tab_events', "Événements");
t('vault.card_details.tab_audit', "Audit");

// vault.intelligence_tab
t('vault.intelligence_tab.loading', "Chargement...");
t('vault.intelligence_tab.tab_overview', "Vue d'ensemble");
t('vault.intelligence_tab.tab_dependents', "Dépendants");
t('vault.intelligence_tab.tab_audit_log', "Journal d'audit");
t('vault.intelligence_tab.total_accesses', "Accès totaux");
t('vault.intelligence_tab.distinct_personas', "Personas distincts");
t('vault.intelligence_tab.last_24h', "Dernières 24h");
t('vault.intelligence_tab.last_7d', "7 derniers jours");
t('vault.intelligence_tab.no_usage', "Aucune utilisation");
t('vault.intelligence_tab.last_accessed_days', "Dernier accès il y a {days} jours");
t('vault.intelligence_tab.first_accessed', "Premier accès");
t('vault.intelligence_tab.last_accessed', "Dernier accès");
t('vault.intelligence_tab.no_dependents', "Aucun dépendant");
t('vault.intelligence_tab.no_dependents_hint', "Aucun agent n'utilise cet identifiant.");
t('vault.intelligence_tab.dependents_warning_one', "{count} agent dépend de cet identifiant");
t('vault.intelligence_tab.dependents_warning_other', "{count} agents dépendent de cet identifiant");
t('vault.intelligence_tab.link_structural', "Structurel");
t('vault.intelligence_tab.link_observed', "Observé");
t('vault.intelligence_tab.via_connector', "Via connecteur");

// vault.token_metrics
t('vault.token_metrics.loading', "Chargement...");
t('vault.token_metrics.no_metrics', "Aucune métrique disponible");
t('vault.token_metrics.trend_warning', "Avertissement de tendance");
t('vault.token_metrics.total_refreshes', "Actualisations totales");
t('vault.token_metrics.failure_rate', "Taux d'échec");
t('vault.token_metrics.avg_lifetime', "Durée de vie moyenne");
t('vault.token_metrics.avg_drift', "Dérive moyenne");
t('vault.token_metrics.recent_ttls', "TTL récents");
t('vault.token_metrics.recent_refreshes', "Actualisations récentes");

// vault.rotation_section
t('vault.rotation_section.corrupted_warning', "Avertissement de corruption");
t('vault.rotation_section.anomaly_warning', "Anomalie détectée");
t('vault.rotation_section.history', "Historique");
t('vault.rotation_section.oauth_refresh_active', "Actualisation du jeton OAuth active");
t('vault.rotation_section.oauth_refresh_active_auto', "Actualisation du jeton OAuth active (auto)");
t('vault.rotation_section.auto_rotation_active', "Rotation automatique active");
t('vault.rotation_section.rotation_paused', "Rotation suspendue");
t('vault.rotation_section.rotate_now', "Faire pivoter maintenant");
t('vault.rotation_section.rotation_failed', "Échec de la rotation");
t('vault.rotation_section.remove_policy_failed', "Échec de la suppression de la politique");
t('vault.rotation_section.remove_policy_tooltip', "Supprimer la politique de rotation");
t('vault.rotation_section.rotate_every', "Faire pivoter tous les");
t('vault.rotation_section.days', "jours");
t('vault.rotation_section.update_period_failed', "Échec de la mise à jour de la période");
t('vault.rotation_section.no_policy', "Aucune politique");
t('vault.rotation_section.enabling', "Activation...");
t('vault.rotation_section.enable_rotation', "Activer la rotation");
t('vault.rotation_section.enable_failed', "Échec de l'activation");

// vault.event_config
t('vault.event_config.event_triggers', "Déclencheurs d'événements");
t('vault.event_config.scheduled_rotation', "Rotation planifiée");
t('vault.event_config.scheduled_rotation_desc', "Rotation automatique selon un calendrier");
t('vault.event_config.expiration_threshold', "Seuil d'expiration");
t('vault.event_config.expiration_threshold_desc', "Rotation avant expiration du jeton");
t('vault.event_config.healthcheck_failure', "Échec du test de santé");
t('vault.event_config.healthcheck_failure_desc', "Rotation en cas d'échec du test de santé");
t('vault.event_config.cron_schedule', "Planification cron");
t('vault.event_config.cron_daily', "Quotidien");
t('vault.event_config.cron_weekly', "Hebdomadaire");
t('vault.event_config.cron_monthly', "Mensuel");
t('vault.event_config.cron_6h', "Toutes les 6 heures");
t('vault.event_config.rotate_when_expiring', "Faire pivoter avant expiration");
t('vault.event_config.expiration_hint', "Jours avant expiration pour déclencher la rotation");
t('vault.event_config.polling_interval', "Intervalle d'interrogation");
t('vault.event_config.checks_per_day', "Vérifications par jour");
t('vault.event_config.seconds_10', "10 secondes");
t('vault.event_config.seconds_30', "30 secondes");
t('vault.event_config.minute_1', "1 minute");
t('vault.event_config.minutes_2', "2 minutes");
t('vault.event_config.minutes_5', "5 minutes");
t('vault.event_config.minutes_10', "10 minutes");
t('vault.event_config.healthcheck_auto_rotate', "Rotation automatique en cas d'échec");
t('vault.event_config.last_evaluated', "Dernière évaluation");

// vault.credential_forms
t('vault.credential_forms.encrypted_keychain', "Chiffré via le trousseau système");
t('vault.credential_forms.encrypted_at_rest', "Chiffré au repos");
t('vault.credential_forms.copy_value', "Copier la valeur");
t('vault.credential_forms.paste_from_clipboard', "Coller depuis le presse-papier");
t('vault.credential_forms.get_credentials', "Obtenir les identifiants");
t('vault.credential_forms.how_to_get_credentials', "Comment obtenir les identifiants");
t('vault.credential_forms.healthcheck_required', "Test de connexion requis");
t('vault.credential_forms.back_to_catalog', "Retour au catalogue");
t('vault.credential_forms.new_credential', "Nouvel identifiant");
t('vault.credential_forms.configure_fields', "Configurer les champs");
t('vault.credential_forms.oauth_required', "Utilisez le bouton d'autorisation ci-dessous pour connecter cet identifiant.");

// vault.audit_log
t('vault.audit_log.empty', "Aucune entrée d'audit");
t('vault.audit_log.empty_hint', "Les opérations seront enregistrées au fur et à mesure.");
t('vault.audit_log.access_events_hint', "Les événements d'accès apparaîtront ici.");

// vault.credential_import
t('vault.credential_import.import_from', "Importer depuis {source}");
t('vault.credential_import.import_from_vault', "Importer depuis le Coffre-fort externe");
t('vault.credential_import.import_subtitle', "Choisissez la source de vos secrets");
t('vault.credential_import.enable_sync', "Activer le mode synchronisation");
t('vault.credential_import.source_ref', "Référence source");
t('vault.credential_import.poll_interval', "Intervalle d'interrogation");

// vault.empty_state
t('vault.empty_state.heading', "Connectez votre premier service");
t('vault.empty_state.description', "Choisissez comment ajouter un identifiant");
t('vault.empty_state.catalog_heading', "Ajouter depuis le catalogue");
t('vault.empty_state.catalog_description', "Choisissez un service connu comme Slack, GitHub ou OpenAI. Champs et tests de connexion pré-configurés.");
t('vault.empty_state.ai_heading', "Identifiant conçu par IA");
t('vault.empty_state.ai_description', "Décrivez n'importe quel service et l'IA configurera les champs, le type d'authentification et le test de connexion pour vous.");
t('vault.empty_state.works_with_any', "Compatible avec n'importe quelle API");

// vault.credential_list
t('vault.credential_list.no_match', "Aucun identifiant correspondant");
t('vault.credential_list.no_match_hint', "Essayez d'ajuster vos filtres ou votre terme de recherche");

// vault.wizard_detect
t('vault.wizard_detect.no_services', "Aucun service ne correspond à \"{search}\"");
t('vault.wizard_detect.select_services', "Sélectionnez les services pour lesquels ajouter des identifiants, ou analysez pour détecter automatiquement.");
t('vault.wizard_detect.scanning', "Analyse des outils CLI et sessions navigateur...");
t('vault.wizard_detect.scan_button', "Analyser les services authentifiés");
t('vault.wizard_detect.search_services', "Rechercher des services...");
t('vault.wizard_detect.desktop_bridge', "Pont de bureau — détecté automatiquement");
t('vault.wizard_detect.batch_complete', "Configuration en lot terminée");
t('vault.wizard_detect.skip_service', "Ignorer ce service");
t('vault.wizard_detect.no_filter_match', "Essayez un autre terme de recherche ou effacez votre filtre.");

// vault.autopilot
t('vault.autopilot.title', "Pilote automatique API");
t('vault.autopilot.input_hint', "Collez l'URL ou le contenu d'une spécification OpenAPI pour générer automatiquement un connecteur");
t('vault.autopilot.preview_hint', "Vérifiez l'API analysée et sélectionnez les points de terminaison à inclure");
t('vault.autopilot.generated_hint', "Votre connecteur a été généré avec succès");
t('vault.autopilot.connector_generated', "Connecteur généré avec succès");
t('vault.autopilot.api_playground', "Bac à sable API");
t('vault.autopilot.api_playground_hint', "Testez vos outils API générés avant de les utiliser");
t('vault.autopilot.paste_spec', "Coller la spécification OpenAPI (JSON ou YAML)");
t('vault.autopilot.valid_url_error', "Entrez une URL valide (ex. https://api.example.com/openapi.json)");
t('vault.autopilot.authentication', "Authentification");
t('vault.autopilot.connector_name', "Nom du connecteur");
t('vault.autopilot.color', "Couleur");
t('vault.autopilot.endpoints_selected', "Points de terminaison ({selected}/{total} sélectionnés)");
t('vault.autopilot.generating', "Génération...");
t('vault.autopilot.generate_connector', "Générer le connecteur ({count} outils)");
t('vault.autopilot.base_url', "URL de base");
t('vault.autopilot.headers_label', "En-têtes");
t('vault.autopilot.header_name_placeholder', "Nom de l'en-tête");
t('vault.autopilot.query_parameters', "Paramètres de requête");
t('vault.autopilot.param_name_placeholder', "Nom du paramètre");
t('vault.autopilot.request_body', "Corps de la requête (JSON)");

// vault.foraging
t('vault.foraging.no_credentials_found', "Aucun identifiant trouvé");
t('vault.foraging.no_credentials_hint', "Essayez de définir des variables d'environnement comme OPENAI_API_KEY ou configurez ~/.aws/credentials.");
t('vault.foraging.scan_description', "Analysez votre système à la recherche d'identifiants existants — profils AWS, variables d'environnement, fichiers .env, configurations Docker, clés SSH, etc. Les identifiants découverts peuvent être importés dans votre Coffre-fort en un clic.");
t('vault.foraging.scan_locations', "Analyse : ~/.aws, ~/.kube, variables env, .env, ~/.npmrc, Docker, GitHub CLI, SSH");
t('vault.foraging.scan_privacy', "Aucun secret n'est téléchargé — l'analyse s'effectue entièrement sur votre machine.");
t('vault.foraging.scanning', "Analyse du système à la recherche d'identifiants...");
t('vault.foraging.scan_failed', "Échec de l'analyse");
t('vault.foraging.step_start', "Démarrer");
t('vault.foraging.step_scan', "Analyser");
t('vault.foraging.step_results', "Résultats");
t('vault.foraging.step_import', "Importer");
t('vault.foraging.step_done', "Terminé");
t('vault.foraging.step_completed', "(terminé)");
t('vault.foraging.step_current', "(en cours)");

// vault.desktop_discovery
t('vault.desktop_discovery.title', "Applications de bureau");
t('vault.desktop_discovery.allowed_binaries', "Binaires autorisés : ");

// vault.picker_section
t('vault.picker_section.no_connectors', "Aucun connecteur trouvé");
t('vault.picker_section.no_connectors_hint', "Essayez d'ajuster vos filtres ou votre terme de recherche.");
t('vault.picker_section.how_to_get', "Comment obtenir {label} {authLabel}");
t('vault.picker_section.required_fields', "Champs requis :");
t('vault.picker_section.filter_status', "Statut");
t('vault.picker_section.filter_purpose', "Objectif");
t('vault.picker_section.filter_category', "Catégorie");
t('vault.picker_section.filter_license', "Licence");

// vault.schemas
t('vault.schemas.none_configured', "Aucun configuré.");
t('vault.schemas.required_badge', "REQ");

// vault.design_phases
t('vault.design_phases.saving', "Enregistrement de l'identifiant...");
t('vault.design_phases.credential_created', "Identifiant créé");
t('vault.design_phases.step_connecting', "Connexion");
t('vault.design_phases.step_connecting_desc', "Établissement de la connexion à l'IA");
t('vault.design_phases.step_analyzing', "Analyse des exigences");
t('vault.design_phases.step_analyzing_desc', "Identification des schémas d'authentification");
t('vault.design_phases.step_designing', "Conception du connecteur");
t('vault.design_phases.step_designing_desc', "Génération des champs et des règles de validation");
t('vault.design_phases.step_healthcheck', "Génération du test de santé");
t('vault.design_phases.step_healthcheck_desc', "Configuration du point de terminaison de test");
t('vault.design_phases.typical_time', "Généralement 15 à 30 secondes");
t('vault.design_phases.saved_catalog', "Catalogue local enregistré");
t('vault.design_phases.search_catalog', "Rechercher dans le catalogue");
t('vault.design_phases.no_catalog', "Aucune entrée dans le catalogue. Enregistrez d'abord un connecteur testé avec succès.");
t('vault.design_phases.existing_connector', "Connecteur existant trouvé : ");
t('vault.design_phases.new_connector', "Nouveau connecteur découvert ");
t('vault.design_phases.auto_provision', "Provisionnement automatique disponible");
t('vault.design_phases.verified_setup', "Configuration vérifiée");
t('vault.design_phases.cached_recipe', "La recette en cache accélérera la conception");
t('vault.design_phases.idle_description', "Décrivez l'outil et le type d'identifiant. Claude générera les champs exacts dont vous avez besoin, puis vous pourrez les enregistrer en toute sécurité.");
t('vault.design_phases.from_catalog', "Depuis le catalogue");
t('vault.design_phases.any_service', "N'importe quel service...");
t('vault.design_phases.import_from', "Importer depuis...");
t('vault.design_phases.auto_setup', "Configuration automatique");
t('vault.design_phases.design_credential', "Concevoir un identifiant");
t('vault.design_phases.open_setup_page', "Ouvrir la page de configuration dans le navigateur");
t('vault.design_phases.mark_not_done', "Marquer comme non terminé");
t('vault.design_phases.mark_done', "Marquer comme terminé");
t('vault.design_phases.mark_step_complete', "Marquer l'étape comme terminée");
t('vault.design_phases.copy_to_clipboard', "Copier dans le presse-papier");

// vault.auto_cred_extra
t('vault.auto_cred_extra.preparing_guided', "Préparation des instructions de configuration guidée...");
t('vault.auto_cred_extra.starting_browser', "Démarrage de la session navigateur...");
t('vault.auto_cred_extra.no_log_output', "Aucune sortie de journal capturée.");
t('vault.auto_cred_extra.credential_saved', "Identifiant enregistré");
t('vault.auto_cred_extra.saving_connector', "Enregistrement de l'identifiant et du connecteur...");
t('vault.auto_cred_extra.partial_extraction', "Extraction partielle");
t('vault.auto_cred_extra.partial_hint', "Certains champs n'ont pas pu être remplis automatiquement. Veuillez compléter les champs manquants manuellement avant d'enregistrer.");
t('vault.auto_cred_extra.credential_name', "Nom de l'identifiant");
t('vault.auto_cred_extra.do_not_interact', "N'interagissez pas avec le navigateur.");
t('vault.auto_cred_extra.auto_setup_label', "Configuration automatique {label}");
t('vault.auto_cred_extra.analyzing_setup', "Analyse des procédures de configuration du connecteur...");
t('vault.auto_cred_extra.browser_hint', "L'automatisation du navigateur guidera la création de l'identifiant");
t('vault.auto_cred_extra.guided_badge', "Guidé");
t('vault.auto_cred_extra.playwright_badge', "Playwright MCP");
t('vault.auto_cred_extra.invalid_url', "Veuillez entrer une URL valide commençant par http:// ou https://");
t('vault.auto_cred_extra.playwright_available', "Automatisation navigateur Playwright disponible");
t('vault.auto_cred_extra.guided_mode', "Mode guidé (sans automatisation navigateur)");
t('vault.auto_cred_extra.all_fields_captured', "Tous les {count} champs capturés");
t('vault.auto_cred_extra.partial_badge', "Partiel");
t('vault.auto_cred_extra.test_to_save', "Testez la connexion pour activer l'enregistrement");
t('vault.auto_cred_extra.save_procedure_title', "Enregistrer la procédure navigateur pour ce connecteur (dev)");
t('vault.auto_cred_extra.copied', "Copié");
t('vault.auto_cred_extra.copy_log', "Copier le journal");
t('vault.auto_cred_extra.step_browser_navigate', "Accéder au formulaire de création de jeton/clé");
t('vault.auto_cred_extra.step_guided_instructions', "Claude fournit des instructions étape par étape");
t('vault.auto_cred_extra.step_browser_extract', "Extraire les valeurs d'identifiant générées");
t('vault.auto_cred_extra.step_guided_extract', "Claude extrait les valeurs de ses instructions");
t('vault.auto_cred_extra.step_browser_review', "Revenez ici pour vérifier avant d'enregistrer");
t('vault.auto_cred_extra.step_guided_review', "Vérifiez et enregistrez l'identifiant");
t('vault.auto_cred_extra.setup_context', "Contexte de configuration issus de l'analyse de conception :");

// vault.negotiator_extra
t('vault.negotiator_extra.checking_auth', "Vérification des authentifications existantes...");
t('vault.negotiator_extra.auto_provisioning', "Provisionnement automatique de clé API");
t('vault.negotiator_extra.generating_plan', "Génération du plan de provisionnement...");
t('vault.negotiator_extra.detecting_auth', "Détection de l'authentification existante...");
t('vault.negotiator_extra.start_auto', "Démarrer le provisionnement automatique");
t('vault.negotiator_extra.need_help', "Besoin d'aide pour cette étape ?");
t('vault.negotiator_extra.hide_help', "Masquer l'aide");
t('vault.negotiator_extra.ask_question', "Posez une question sur cette étape...");

// vault.workspace_panel
t('vault.workspace_panel.select_services', "Sélectionnez les services à connecter");
t('vault.workspace_panel.browser_sign_in', "Terminez la connexion dans votre navigateur...");
t('vault.workspace_panel.creating_credentials', "Création des identifiants...");
t('vault.workspace_panel.all_created', "Tous les identifiants créés");
t('vault.workspace_panel.some_failed', "Certains identifiants ont échoué");

// vault.gateway
t('vault.gateway.gateway_members', "{name} — membres de la passerelle");
t('vault.gateway.gateway_description', "Regroupez plusieurs identifiants MCP sous cette passerelle. Les personas associés héritent des outils de chaque membre activé, préfixés comme <display_name>::<tool>.");
t('vault.gateway.loading_members', "Chargement des membres…");
t('vault.gateway.current_members', "Membres actuels ({count})");
t('vault.gateway.no_members', "Aucun membre. Ajoutez-en un ci-dessous pour commencer à regrouper des outils.");
t('vault.gateway.disabled_suffix', " · désactivé");
t('vault.gateway.add_member_heading', "Ajouter un membre");
t('vault.gateway.no_eligible', "Aucun identifiant éligible. Ajoutez d'abord un identifiant MCP dans la liste des identifiants.");
t('vault.gateway.credential_label', "Identifiant");
t('vault.gateway.pick_credential', "Choisir un identifiant…");
t('vault.gateway.pick_error', "Choisissez un identifiant et donnez-lui un nom d'affichage court");
t('vault.gateway.display_name', "Nom d'affichage (préfixe d'outil)");
t('vault.gateway.display_name_placeholder', "ex. arcade, research_tools, docs");
t('vault.gateway.adding', "Ajout…");
t('vault.gateway.add_member', "Ajouter un membre");

// vault.pending_auth
t('vault.pending_auth.title', "Autorisation requise");
t('vault.pending_auth.tool_needs_consent', "L'outil {tool} nécessite un nouveau consentement OAuth avant de pouvoir être invoqué.");
t('vault.pending_auth.auth_url_label', "URL d'autorisation");
t('vault.pending_auth.step_1', "Cliquez sur Ouvrir l'URL d'autorisation pour accorder le consentement dans votre navigateur.");
t('vault.pending_auth.step_2', "Complétez le flux de consentement pour les portées demandées.");
t('vault.pending_auth.step_3', "Revenez ici et cliquez sur J'ai autorisé — réessayer.");
t('vault.pending_auth.reopen_url', "Rouvrir l'URL");
t('vault.pending_auth.open_auth_url', "Ouvrir l'URL d'autorisation");
t('vault.pending_auth.open_first', "Ouvrez d'abord l'URL et accordez le consentement");
t('vault.pending_auth.retrying', "Nouvelle tentative…");
t('vault.pending_auth.retry_authorized', "J'ai autorisé — réessayer");
t('vault.pending_auth.retry_failed', "Échec de la nouvelle tentative");

// vault.rotation_insight
t('vault.rotation_insight.perm_errors', "Erreurs permanentes détectées — rotation tentée, alerte envoyée.");
t('vault.rotation_insight.degrading', "Dégradation soutenue — rotation préventive déclenchée.");
t('vault.rotation_insight.backoff', "Échecs temporaires — backoff exponentiel actif.");

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Batch 5 total keys:', Object.keys(out).length);
