'use strict';
const fs = require('fs');
const outPath = require('path').join(__dirname, '../.planning/i18n/translated-fr.json');
const out = JSON.parse(fs.readFileSync(outPath, 'utf8'));

function t(k, v) { out[k] = v; }

// templates.matrix
t('templates.matrix.preparing', "Préparation de la construction...");
t('templates.matrix.analyzing', "Analyse de votre intention...");
t('templates.matrix.building', "Construction des dimensions de l'agent...");
t('templates.matrix.waiting_input', "En attente de votre saisie...");
t('templates.matrix.draft_ready', "Brouillon prêt pour révision");
t('templates.matrix.testing', "Test de l'agent...");
t('templates.matrix.test_complete', "Test terminé");
t('templates.matrix.promoted', "Agent promu");
t('templates.matrix.build_failed', "Échec de la construction");
t('templates.matrix.phase_subtext_analyzing', "Compréhension de votre intention...");
t('templates.matrix.phase_subtext_resolving', "Construction de la configuration de l'agent...");
t('templates.matrix.phase_subtext_awaiting_input', "Votre saisie est nécessaire — cliquez sur une dimension en surbrillance");
t('templates.matrix.phase_subtext_draft_ready', "Toutes les dimensions résolues — prêt pour les tests");
t('templates.matrix.dim_tasks', "Tâches");
t('templates.matrix.dim_apps', "Applications et services");
t('templates.matrix.dim_schedule', "Quand il s'exécute");
t('templates.matrix.dim_review', "Révision humaine");
t('templates.matrix.dim_memory', "Mémoire");
t('templates.matrix.dim_errors', "Gestion des erreurs");
t('templates.matrix.dim_messages', "Messages");
t('templates.matrix.dim_events', "Événements");
t('templates.matrix.generating', "Génération...");
t('templates.matrix.continue_build', "Continuer la construction");
t('templates.matrix.all_resolved', "Toutes les dimensions résolues");
t('templates.matrix.answers_ready', "{count} réponse(s) prête(s) — cliquez sur Continuer");
t('templates.matrix.input_needed', "Votre saisie est nécessaire");
t('templates.matrix.answer_progress', "{answered} répondu(s), {remaining} restant(s)");
t('templates.matrix.cell_edit', "Modifier");
t('templates.matrix.cell_done', "Terminé");
t('templates.matrix.cancel_test', "Annuler le test");
t('templates.matrix.test_agent', "Tester l'agent");
t('templates.matrix.starting_test', "Démarrage du test...");
t('templates.matrix.apply_changes', "Appliquer les modifications");
t('templates.matrix.discard', "Abandonner");
t('templates.matrix.build_complete', "Construction terminée");
t('templates.matrix.adjust_placeholder', "Ajustez quoi que ce soit...");
t('templates.matrix.answer_placeholder', "Votre réponse...");

// templates.page
t('templates.page.title', "Modèles agentiques");
t('templates.page.subtitle_one', "{count} modèle disponible");
t('templates.page.subtitle_other', "{count} modèles disponibles");

// templates.explore
t('templates.explore.ready_to_deploy', "Prêt à déployer");
t('templates.explore.ready_to_deploy_hint', "Modèles avec tous les connecteurs configurés");
t('templates.explore.adoption_count_one', "{count} adoption");
t('templates.explore.adoption_count_other', "{count} adoptions");
t('templates.explore.popular_in', "Populaire dans {role}");
t('templates.explore.configure_to_unlock', "Configurez des connecteurs pour débloquer les modèles prêts à déployer");
t('templates.explore.hero_title', "Qu'est-ce que vous voulez automatiser ?");
t('templates.explore.hero_subtitle', "Parcourez par cas d'usage ou recherchez des modèles adaptés à vos besoins de workflow.");
t('templates.explore.hero_search_placeholder', "Rechercher des modèles par mot-clé ou décrire votre besoin...");
t('templates.explore.templates_count_one', "{count} modèle");
t('templates.explore.templates_count_other', "{count} modèles");
t('templates.explore.view_all', "Voir tout");
t('templates.explore.most_adopted', "Les plus adoptés");
t('templates.explore.whats_your_role', "Quel est votre rôle ?");
t('templates.explore.categories_for_role', "{count} catégories avec des modèles d'agents spécialisés pour les workflows {role}.");
t('templates.explore.role_templates', "Modèles {role}");
t('templates.explore.by_role', "Par rôle");
t('templates.explore.by_need', "Par besoin");
t('templates.explore.classic', "Classique");

// templates.opportunities
t('templates.opportunities.title', "Opportunités d'automatisation");
t('templates.opportunities.subtitle', "Workflows que vous pouvez débloquer");
t('templates.opportunities.ready_now', "Prêt maintenant");
t('templates.opportunities.add_connector', "Ajouter");
t('templates.opportunities.unlock_more', "pour débloquer {count} de plus");
t('templates.opportunities.explore_templates', "Explorer les modèles {label}");

// templates.recommended
t('templates.recommended.title', "Recommandés pour vous");
t('templates.recommended.subtitle', "Basés sur vos connecteurs");
t('templates.recommended.no_recommendations', "Aucune recommandation disponible pour le moment.");

// templates.trending
t('templates.trending.title', "Les plus adoptés cette semaine");

// templates.empty
t('templates.empty.no_templates', "Aucun modèle généré");
t('templates.empty.no_templates_hint', "Utilisez le bouton Synthétiser une équipe dans l'en-tête ou la compétence Claude Code pour générer des modèles.");
t('templates.empty.no_search_results', "Aucun modèle correspondant");
t('templates.empty.no_search_results_hint', "Essayez d'ajuster vos termes de recherche ou filtres.");
t('templates.empty.clear_search', "Effacer la recherche");
t('templates.empty.waiting_for_draft', "En attente du brouillon du persona");
t('templates.empty.waiting_for_draft_hint', "L'IA génère un brouillon basé sur vos sélections. Cela prend généralement quelques secondes.");

// templates.banners
t('templates.banners.draft_prefix', "Brouillon : ");
t('templates.banners.step_click_resume', "Étape : {step} — cliquez pour reprendre");
t('templates.banners.discard_draft', "Abandonner le brouillon");
t('templates.banners.adoption_in_progress', "Adoption du modèle en cours");
t('templates.banners.click_to_view_progress', "Cliquer pour voir la progression");
t('templates.banners.rebuilding', "Reconstruction : {name}");
t('templates.banners.status_testing', "Test");
t('templates.banners.status_completed', "Terminé");
t('templates.banners.status_failed', "Échoué");
t('templates.banners.click_to_view_result', "Cliquer pour voir le résultat");
t('templates.banners.click_to_view_output', "Cliquer pour voir la sortie");

// templates.search
t('templates.search.switch_to_keyword', "Passer à la recherche par mot-clé");
t('templates.search.switch_to_ai', "Passer à la recherche IA");
t('templates.search.few_results', "Peu de résultats");
t('templates.search.try_ai_search', "Essayer la recherche IA");
t('templates.search.ai_searching', "Recherche avec IA — les résultats apparaîtront quand prêts...");
t('templates.search.ai_results_one', "{count} résultat");
t('templates.search.ai_results_other', "{count} résultats");
t('templates.search.show_log', "Afficher le journal");
t('templates.search.hide_log', "Masquer le journal");
t('templates.search.placeholder_default', "Rechercher des modèles... (essayez catégorie: difficulté: installation:)");
t('templates.search.placeholder_ai', "Décrivez ce dont vous avez besoin, puis appuyez sur Entrée...");
t('templates.search.placeholder_add_more', "Ajouter des filtres ou rechercher...");
t('templates.search.list_view', "Vue liste");
t('templates.search.explore_view', "Vue exploration");
t('templates.search.comfortable_view', "Vue confortable");
t('templates.search.compact_view', "Vue compacte");
t('templates.search.recommended_for_you', "Recommandés pour vous");
t('templates.search.connectors_label', "Connecteurs");
t('templates.search.components_label', "Composants");
t('templates.search.search_connectors', "Rechercher des connecteurs...");
t('templates.search.search_components', "Rechercher des composants...");
t('templates.search.no_matching_connectors', "Aucun connecteur correspondant");
t('templates.search.no_connectors_available', "Aucun connecteur disponible");
t('templates.search.no_matching_components', "Aucun composant correspondant");
t('templates.search.no_components_available', "Aucun composant disponible");
t('templates.search.clear_all', "Tout effacer");
t('templates.search.admin_tools', "Outils d'administration");
t('templates.search.deduplicate', "Dédupliquer");
t('templates.search.backfill_pipelines', "Remplissage rétroactif des pipelines");
t('templates.search.backfill_tools', "Remplissage rétroactif des outils");
t('templates.search.coverage_all', "Tout");
t('templates.search.coverage_ready', "Prêt");
t('templates.search.coverage_partial', "Partiel");
t('templates.search.autocomplete_categories', "Catégories");
t('templates.search.autocomplete_difficulty', "Difficulté");
t('templates.search.autocomplete_setup_time', "Temps d'installation");
t('templates.search.autocomplete_suggestions', "Suggestions");

// templates.list
t('templates.list.template_name', "Nom du modèle");
t('templates.list.components', "Composants");
t('templates.list.adoptions', "Adoptions");

// templates.row_actions
t('templates.row_actions.row_actions_label', "Actions de ligne");
t('templates.row_actions.view_details', "Voir les détails");
t('templates.row_actions.rebuild', "Reconstruire");
t('templates.row_actions.delete_template', "Supprimer le modèle");

// templates.connector_readiness
t('templates.connector_readiness.click_to_add', "cliquer pour ajouter un identifiant");
t('templates.connector_readiness.ready', "Prêt");
t('templates.connector_readiness.partial', "Partiel");
t('templates.connector_readiness.setup_needed', "Installation requise");
t('templates.connector_readiness.needs_setup', "Nécessite une installation");
t('templates.connector_readiness.not_ready', "Non prêt");
t('templates.connector_readiness.needs_credential', "nécessite un identifiant");
t('templates.connector_readiness.not_installed', "non installé");

// templates.detail_modal
t('templates.detail_modal.adopted', "{count} adopté(s)");
t('templates.detail_modal.reference_patterns', "Schémas de référence");
t('templates.detail_modal.adopt_as_persona', "Adopter comme persona");
t('templates.detail_modal.try_it', "Essayer");
t('templates.detail_modal.design_unavailable', "Données de conception non disponibles pour ce modèle.");

// templates.overview_tab
t('templates.overview_tab.loading_metrics', "Chargement des métriques de performance...");
t('templates.overview_tab.metrics_unavailable', "Métriques de performance non disponibles");
t('templates.overview_tab.metrics_load_error', "Impossible de charger les métriques pour ce modèle.");
t('templates.overview_tab.incomplete_data', "Données de performance incomplètes");
t('templates.overview_tab.incomplete_data_hint', "Certaines requêtes de métriques ont échoué. Les valeurs ci-dessous peuvent ne pas refléter l'utilisation réelle.");
t('templates.overview_tab.performance', "Performance");
t('templates.overview_tab.adoptions_label', "Adoptions");
t('templates.overview_tab.executions_label', "Exécutions");
t('templates.overview_tab.success_label', "Succès");
t('templates.overview_tab.avg_cost_label', "Coût moyen");
t('templates.overview_tab.quality_score', "Score de qualité");
t('templates.overview_tab.use_case_flows', "Flux de cas d'usage");
t('templates.overview_tab.nodes', "{count} nœuds");
t('templates.overview_tab.edges', "{count} arêtes");
t('templates.overview_tab.suggested_adjustment', "Ajustement suggéré");
t('templates.overview_tab.adjustment_attempt', "(tentative {attempt}/3)");
t('templates.overview_tab.dimension_completion', "Complétion des dimensions");
t('templates.overview_tab.dimensions_score', "({score}/9 dimensions)");

// templates.review_detail
t('templates.review_detail.design_unavailable', "Données de conception non disponibles pour ce modèle.");
t('templates.review_detail.use_case_flows', "Flux de cas d'usage");
t('templates.review_detail.view_diagram', "Voir le diagramme");
t('templates.review_detail.apply_rerun', "Appliquer et relancer");
t('templates.review_detail.adopt_as_new_persona', "Adopter comme nouveau persona");
t('templates.review_detail.view_raw_json', "Voir le JSON brut");
t('templates.review_detail.hide_raw_json', "Masquer le JSON brut");
t('templates.review_detail.used_references', "Ce modèle a utilisé des schémas de référence issus de révisions précédentes réussies");

// templates.rebuild_modal
t('templates.rebuild_modal.title', "Reconstruire le modèle");
t('templates.rebuild_modal.template_instruction', "Instruction du modèle");
t('templates.rebuild_modal.custom_direction', "Direction personnalisée (optionnel)");
t('templates.rebuild_modal.custom_direction_placeholder', "Ajoutez des exigences spécifiques, des axes de concentration ou des contraintes pour cette reconstruction...");
t('templates.rebuild_modal.custom_direction_hint', "La reconstruction régénérera les 9 dimensions de données à l'aide du système de protocole.");
t('templates.rebuild_modal.rebuilding_with_cli', "Reconstruction du modèle avec Claude CLI...");
t('templates.rebuild_modal.waiting_for_output', "En attente de la sortie...");
t('templates.rebuild_modal.close_continues_bg', "Vous pouvez fermer cette boîte de dialogue — la reconstruction continuera en arrière-plan.");
t('templates.rebuild_modal.rebuild_complete', "Reconstruction terminée");
t('templates.rebuild_modal.rebuild_complete_hint', "Le modèle a été régénéré avec toutes les dimensions de données. La galerie se rafraîchira pour afficher les scores mis à jour.");
t('templates.rebuild_modal.rebuild_failed', "Échec de la reconstruction");
t('templates.rebuild_modal.unknown_error', "Une erreur inconnue s'est produite lors de la reconstruction.");
t('templates.rebuild_modal.start_rebuild', "Démarrer la reconstruction");
t('templates.rebuild_modal.cancel_rebuild', "Annuler la reconstruction");
t('templates.rebuild_modal.run_in_background', "Exécuter en arrière-plan");

// templates.preview_modal
t('templates.preview_modal.preview_title', "Aperçu : {name}");
t('templates.preview_modal.sandboxed_hint', "Exécution en bac à sable à tour unique — aucun persona créé");
t('templates.preview_modal.try_this_template', "Essayer ce modèle");
t('templates.preview_modal.try_description', "Exécutez une exécution en bac à sable à tour unique pour voir comment ce persona se comporte. Utilise le prompt système du modèle avec des entrées fictives — rien n'est enregistré.");
t('templates.preview_modal.run_preview', "Lancer l'aperçu");
t('templates.preview_modal.no_design_data', "Aucune donnée de conception disponible pour ce modèle.");
t('templates.preview_modal.ready', "Prêt");
t('templates.preview_modal.running', "En cours...");
t('templates.preview_modal.completed', "Terminé");
t('templates.preview_modal.execution_failed', "Échec de l'exécution");
t('templates.preview_modal.run_again', "Relancer");
t('templates.preview_modal.close_test_continues', "Vous pouvez fermer — le test continuera en arrière-plan");

// templates.expanded
t('templates.expanded.adopt', "Adopter");
t('templates.expanded.try_it', "Essayer");
t('templates.expanded.flows', "Flux");
t('templates.expanded.use_cases', "Cas d'usage");
t('templates.expanded.architecture', "Architecture");
t('templates.expanded.events', "Événements");
t('templates.expanded.reviews_label', "Révisions");
t('templates.expanded.notifications', "Notifications");

// templates.matrix_cmd
t('templates.matrix_cmd.identity', "Identité");
t('templates.matrix_cmd.instructions', "Instructions");
t('templates.matrix_cmd.tool_guidance', "Guidance des outils");
t('templates.matrix_cmd.examples', "Exemples");
t('templates.matrix_cmd.error_handling', "Gestion des erreurs");
t('templates.matrix_cmd.initializing', "Initialisation...");
t('templates.matrix_cmd.initializing_hint', "Création du brouillon d'agent et démarrage de la CLI");
t('templates.matrix_cmd.describe', "Décrire");
t('templates.matrix_cmd.import_label', "Importer");
t('templates.matrix_cmd.describe_placeholder', "Décrivez ce que votre agent doit faire... (Entrée pour générer)");
t('templates.matrix_cmd.additional_instructions', "Instructions supplémentaires...");
t('templates.matrix_cmd.web_search', "Recherche web");
t('templates.matrix_cmd.web_browse', "Navigation web");
t('templates.matrix_cmd.build_label', "Construire");
t('templates.matrix_cmd.adjust_placeholder', "Ajustez quoi que ce soit...");
t('templates.matrix_cmd.test_agent', "Tester l'agent");
t('templates.matrix_cmd.save_version', "Enregistrer la version");

// templates.questionnaire
t('templates.questionnaire.header', "{label} — Question {current} sur {total}");
t('templates.questionnaire.answered', "{count} répondu(s)");
t('templates.questionnaire.cancel_setup', "Annuler la configuration");
t('templates.questionnaire.type_your_answer', "Entrez votre réponse...");
t('templates.questionnaire.type_answer', "Entrez votre réponse...");
t('templates.questionnaire.default_label', "Par défaut : {value}");
t('templates.questionnaire.select_project', "Sélectionnez un projet de base de code...");
t('templates.questionnaire.navigate_hint', "naviguer");
t('templates.questionnaire.navigate', "naviguer");
t('templates.questionnaire.skip_all', "Tout ignorer");
t('templates.questionnaire.submit_answers', "Soumettre les réponses");
t('templates.questionnaire.answer_remaining', "Répondre aux restantes ({count})");
t('templates.questionnaire.next', "Suivant");
t('templates.questionnaire.setup', "Configuration");

// templates.sandbox_banner
t('templates.sandbox_banner.community_sandbox', "Modèle communautaire — Mode bac à sable");
t('templates.sandbox_banner.event_emission_disabled', "Émission d'événements désactivée");
t('templates.sandbox_banner.chain_triggers_disabled', "Déclencheurs en chaîne désactivés");
t('templates.sandbox_banner.webhook_triggers_disabled', "Déclencheurs webhook désactivés");
t('templates.sandbox_banner.polling_triggers_disabled', "Déclencheurs d'interrogation désactivés");
t('templates.sandbox_banner.human_review_required', "Révision humaine requise");
t('templates.sandbox_banner.budget_cap_enforced', "Plafond budgétaire appliqué");
t('templates.sandbox_banner.max_concurrent_one', "Max {max} exécution simultanée");
t('templates.sandbox_banner.max_concurrent_other', "Max {max} exécutions simultanées");

// templates.n8n
t('templates.n8n.credential_label', "Identifiant : {name}");
t('templates.n8n.n8n_type_label', "Type n8n : {type}");
t('templates.n8n.test', "Tester");
t('templates.n8n.link_existing', "Lier l'existant");
t('templates.n8n.add_new', "Ajouter nouveau");
t('templates.n8n.best_match', "Meilleure correspondance");
t('templates.n8n.other_credentials', "Autres identifiants");
t('templates.n8n.no_stored_credentials', "Aucun identifiant stocké trouvé");
t('templates.n8n.no_entities_selected', "Aucune entité sélectionnée.");
t('templates.n8n.go_back_to_analyze', "Retournez à l'étape Analyser pour sélectionner les outils et déclencheurs.");
t('templates.n8n.entities_generated', "Entités générées par la transformation.");
t('templates.n8n.entities_from_workflow', "Éléments de votre workflow n8n associés à ce persona.");
t('templates.n8n.ready_count', "{count} prêt(s)");
t('templates.n8n.missing_count', "{count} manquant(s)");
t('templates.n8n.edit_selection', "Modifier la sélection");
t('templates.n8n.test_all', "Tout tester");
t('templates.n8n.connectors_count', "Connecteurs ({count})");
t('templates.n8n.general_tools_count', "Outils généraux ({count})");
t('templates.n8n.triggers_count', "Déclencheurs ({count})");
t('templates.n8n.no_use_cases_design', "Aucun cas d'usage structuré trouvé dans le contexte de conception.");
t('templates.n8n.no_use_cases_yet', "Aucun cas d'usage généré.");
t('templates.n8n.use_adjustment_hint', "Utilisez le champ d'ajustement ci-dessous pour demander la génération de cas d'usage.");
t('templates.n8n.use_cases_identified', "{count} cas d'usage identifié(s)");
t('templates.n8n.informational_only', "Ce cas d'usage est informatif uniquement");
t('templates.n8n.view_example_output', "Voir la sortie exemple");
t('templates.n8n.test_use_case', "Tester ce cas d'usage");
t('templates.n8n.save_to_test', "Enregistrer pour tester");
t('templates.n8n.example_output', "Sortie exemple :");
t('templates.n8n.no_sample_data', "// Aucune donnée d'exemple fournie");
t('templates.n8n.capabilities_label', "Capacités");
t('templates.n8n.request_ai_adjustments', "Demander des ajustements IA");
t('templates.n8n.adjustment_placeholder', "Exemple : Ajouter plus de cas d'usage, rendre la gestion des erreurs plus stricte...");
t('templates.n8n.apply', "Appliquer");
t('templates.n8n.use_cases_tab', "Cas d'usage");
t('templates.n8n.tools_and_connectors_tab', "Outils et connecteurs");
t('templates.n8n.test_output', "Sortie de test");
t('templates.n8n.lines_count', "{count} lignes");
t('templates.n8n.import_error', "Erreur d'importation");
t('templates.n8n.dismiss', "Ignorer");
t('templates.n8n.partial_session_restore', "Restauration de session partielle");
t('templates.n8n.analyzing_workflow', "Analyse du workflow et préparation de la transformation...");
t('templates.n8n.usually_one_minute', "Prend généralement environ 1 minute");
t('templates.n8n.import_another', "Importer un autre");
t('templates.n8n.platform_confirm', "Cela ressemble à un workflow {platform}, mais nous n'en sommes pas sûrs. Est-ce correct ?");
t('templates.n8n.yes_thats_right', "Oui, c'est correct");
t('templates.n8n.no_reupload', "Non, re-télécharger");
t('templates.n8n.tools_count', "{count} outils");
t('templates.n8n.triggers_count_summary', "{count} déclencheurs");
t('templates.n8n.connectors_count_summary', "{count} connecteurs");
t('templates.n8n.selected_for_import', "sélectionné(s) pour importation");
t('templates.n8n.tools_header', "Outils ({count})");
t('templates.n8n.triggers_header', "Déclencheurs ({count})");
t('templates.n8n.connectors_header', "Connecteurs ({count})");
t('templates.n8n.previous_imports', "Importations précédentes");
t('templates.n8n.sessions_count', "{count} session(s)");

// triggers.builder
t('triggers.builder.add_persona_action', "Ajouter un persona");
t('triggers.builder.auto_layout', "Mise en page automatique");
t('triggers.builder.cancel', "Annuler");
t('triggers.builder.canvas_templates', "Modèles de canvas");
t('triggers.builder.connected_listeners', "Écouteurs connectés");
t('triggers.builder.connected_personas', "Personas connectés");
t('triggers.builder.current_name', "Nom actuel");
t('triggers.builder.custom_event_placeholder', "custom.event.type");
t('triggers.builder.done', "Terminé");
t('triggers.builder.double_click_edit', "Double-cliquer pour modifier");
t('triggers.builder.events', "Événements");
t('triggers.builder.filter_events_placeholder', "Filtrer les événements...");
t('triggers.builder.filter_personas_placeholder', "Filtrer les personas...");
t('triggers.builder.hide_sidebar', "Masquer la barre latérale");
t('triggers.builder.impact_preview', "Aperçu de l'impact");
t('triggers.builder.init_handlers_title', "Gestionnaires initiaux");
t('triggers.builder.layout', "Mise en page");
t('triggers.builder.marketplace', "Marketplace");
t('triggers.builder.new_name', "Nouveau nom");
t('triggers.builder.no_events_filter', "Aucun événement ne correspond au filtre");
t('triggers.builder.no_matches', "Aucune correspondance");
t('triggers.builder.no_matching_events', "Aucun événement correspondant");
t('triggers.builder.no_personas_connected', "Aucun persona connecté");
t('triggers.builder.no_personas_created', "Aucun persona créé");
t('triggers.builder.note_placeholder', "Ajouter une note...");
t('triggers.builder.personas', "Personas");
t('triggers.builder.refresh', "Actualiser");
t('triggers.builder.rename', "Renommer");
t('triggers.builder.rename_event_action', "Renommer l'événement");
t('triggers.builder.rename_event_desc', "Mettre à jour le type d'événement dans toutes les références.");
t('triggers.builder.rename_event_type', "Renommer le type d'événement");
t('triggers.builder.rename_placeholder', "nouveau.type.evenement");
t('triggers.builder.renaming', "Renommage...");
t('triggers.builder.show_sidebar', "Afficher la barre latérale");
t('triggers.builder.source', "Source");
t('triggers.builder.source_personas', "Personas sources");
t('triggers.builder.use_template', "Utiliser le modèle");

// triggers.studio
t('triggers.studio.building_blocks', "Blocs de construction");
t('triggers.studio.clear', "Effacer");
t('triggers.studio.clear_canvas', "Effacer le canvas");
t('triggers.studio.drag_or_click_to_add', "Glisser ou cliquer pour ajouter");
t('triggers.studio.export', "Exporter");
t('triggers.studio.export_chain', "Exporter la chaîne");
t('triggers.studio.import', "Importer");
t('triggers.studio.import_chain', "Importer la chaîne");
t('triggers.studio.logic_gates', "Portes logiques");
t('triggers.studio.persona_steps', "Étapes de persona");
t('triggers.studio.remove_from_chain', "Retirer de la chaîne");
t('triggers.studio.studio_title', "Studio de déclencheurs");
t('triggers.studio.trigger_sources', "Sources de déclencheurs");
t('triggers.studio.unsaved_changes', "Modifications non enregistrées");

// triggers.subscription_list
t('triggers.subscription_list.active', "Actif");
t('triggers.subscription_list.browse_marketplace', "Parcourir le marketplace");
t('triggers.subscription_list.col_actions', "Actions");
t('triggers.subscription_list.col_event_type', "Type d'événement");
t('triggers.subscription_list.col_events', "Événements");
t('triggers.subscription_list.col_feed', "Flux");
t('triggers.subscription_list.col_last_event', "Dernier événement");
t('triggers.subscription_list.col_status', "Statut");
t('triggers.subscription_list.error', "Erreur");
t('triggers.subscription_list.never', "Jamais");
t('triggers.subscription_list.no_active_subs', "Aucun abonnement actif");
t('triggers.subscription_list.unsubscribe', "Se désabonner");

// triggers.type_selector
t('triggers.type_selector.trigger_type', "Type de déclencheur");

// trigger types and descriptions
t('triggers.type_manual', "Manuel");
t('triggers.type_schedule', "Planifié");
t('triggers.type_webhook', "Webhook");
t('triggers.type_polling', "Vérification auto");
t('triggers.type_event_listener', "Écouteur d'événements");
t('triggers.type_file_watcher', "Surveillance de fichiers");
t('triggers.type_clipboard', "Presse-papier");
t('triggers.type_app_focus', "Focus d'application");
t('triggers.type_chain', "Chaîne");
t('triggers.type_composite', "Combiné");
t('triggers.desc_manual', "Exécuter à la demande");
t('triggers.desc_schedule', "Exécuter selon un minuteur ou un cron");
t('triggers.desc_polling', "Vérifier un point de terminaison");
t('triggers.desc_webhook', "Écouteur de webhook HTTP");
t('triggers.desc_event_listener', "Réagir aux événements internes");
t('triggers.desc_file_watcher', "Réagir aux changements du système de fichiers");
t('triggers.desc_clipboard', "Réagir aux changements du presse-papier");
t('triggers.desc_app_focus', "Réagir aux changements de focus d'application");
t('triggers.desc_chain', "Déclencher après la fin d'un autre agent");
t('triggers.desc_composite', "Conditions multiples + fenêtre temporelle");
t('triggers.category_pull', "Surveiller");
t('triggers.category_push', "Écouter");
t('triggers.category_compose', "Combiner");
t('triggers.category_pull_desc', "Interroger les changements à intervalle");
t('triggers.category_push_desc', "Recevoir des signaux externes");
t('triggers.category_compose_desc', "Chaîner ou composer des déclencheurs");
t('triggers.rate_per_minute', "Par minute");
t('triggers.rate_per_5_minutes', "Par 5 minutes");
t('triggers.rate_per_hour', "Par heure");

// trigger templates
t('triggers.tpl_fw_error_logs', "Analyser automatiquement les journaux d'erreurs");
t('triggers.tpl_fw_error_logs_desc', "Se déclenche quand de nouveaux fichiers .log apparaissent ou changent dans un dossier");
t('triggers.tpl_fw_csv_data', "Traiter les nouveaux fichiers CSV");
t('triggers.tpl_fw_csv_data_desc', "Se déclenche quand des fichiers CSV sont ajoutés ou modifiés");
t('triggers.tpl_fw_config_changes', "Surveiller les changements de fichiers de configuration");
t('triggers.tpl_fw_config_changes_desc', "Se déclenche sur les changements de fichiers de configuration JSON, YAML ou TOML");
t('triggers.tpl_cb_url_summarize', "Résumer automatiquement les URL copiées");
t('triggers.tpl_cb_url_summarize_desc', "Se déclenche quand vous copiez une URL dans votre presse-papier");
t('triggers.tpl_cb_error_message', "Diagnostiquer automatiquement les messages d'erreur");
t('triggers.tpl_cb_error_message_desc', "Se déclenche quand vous copiez du texte contenant des erreurs ou exceptions");
t('triggers.tpl_cb_code_snippet', "Formater automatiquement les extraits de code");
t('triggers.tpl_cb_code_snippet_desc', "Se déclenche quand vous copiez du texte semblable à du code (définitions de fonctions, imports)");

t('triggers.webhook_listener', "écouteur de webhook");
t('triggers.custom_endpoint', "point de terminaison personnalisé");
t('triggers.every_interval', "toutes les {interval}");
t('triggers.from_source', "depuis {source}");

// triggers.schedule
t('triggers.schedule.interval_label', "Intervalle");
t('triggers.schedule.preset_1m', "1 min");
t('triggers.schedule.preset_5m', "5 min");
t('triggers.schedule.preset_15m', "15 min");
t('triggers.schedule.preset_1h', "1 heure");
t('triggers.schedule.preset_6h', "6 heures");
t('triggers.schedule.preset_24h', "24 heures");
t('triggers.schedule.custom', "Personnalisé");
t('triggers.schedule.mode_interval', "Intervalle");
t('triggers.schedule.mode_cron', "Cron");
t('triggers.schedule.cron_label', "Expression de planification");
t('triggers.schedule.cron_placeholder', "0 9 * * 1-5");
t('triggers.schedule.cron_loading', "Aperçu...");
t('triggers.schedule.cron_weekday_9am', "Jours ouvrés 9h");
t('triggers.schedule.cron_every_hour', "Toutes les heures");
t('triggers.schedule.cron_daily_midnight', "Tous les jours minuit");
t('triggers.schedule.cron_weekly_monday', "Hebdomadaire lundi");
t('triggers.schedule.next_runs', "Prochaines exécutions");
t('triggers.schedule.invalid_cron', "Expression de planification invalide");

// triggers.add
t('triggers.add.create_trigger', "Créer un déclencheur");
t('triggers.add.creating', "Création...");

// triggers.detail
t('triggers.detail.test_fire', "Test de déclenchement");
t('triggers.detail.test_firing', "Déclenchement...");
t('triggers.detail.validate_and_fire', "Valider la configuration du déclencheur, puis déclencher");
t('triggers.detail.validating', "Validation...");
t('triggers.detail.dry_run', "Test");
t('triggers.detail.dry_running', "En cours...");
t('triggers.detail.simulate_hint', "Aperçu de ce qui se passerait sans exécuter réellement");
t('triggers.detail.simulating', "Simulation...");
t('triggers.detail.delete', "Supprimer");
t('triggers.detail.delete_confirm', "Confirmer la suppression");
t('triggers.detail.delete_trigger', "Supprimer le déclencheur");
t('triggers.detail.activity_log', "Journal d'activité");
t('triggers.detail.no_activity', "Aucune activité enregistrée");
t('triggers.detail.webhook_url', "URL du webhook");
t('triggers.detail.webhook_secret', "Clé de sécurité");
t('triggers.detail.copied', "Copié !");
t('triggers.detail.copy_curl', "Copier le curl d'exemple");
t('triggers.detail.last_fired', "Dernier déclenchement");
t('triggers.detail.never_fired', "Jamais déclenché");
t('triggers.detail.fire_count_one', "Déclenché {count} fois");
t('triggers.detail.fire_count_other', "Déclenché {count} fois");

// triggers.list
t('triggers.list.empty_title', "Aucun déclencheur configuré");
t('triggers.list.empty_hint', "Les déclencheurs permettent à vos agents de s'exécuter automatiquement — selon un calendrier, quand un fichier change, quand des données arrivent, et plus encore.");
t('triggers.list.create_first', "Créer votre premier déclencheur");
t('triggers.list.event_triggers', "Déclencheurs d'événements");
t('triggers.list.budget_unavailable', "Données de budget non disponibles");
t('triggers.list.unknown_budget', "Budget inconnu");
t('triggers.list.budget_exceeded', "Budget mensuel dépassé — déclencheur suspendu");
t('triggers.list.budget', "Budget");

// triggers.config
t('triggers.config.no_persona', "Aucun persona sélectionné");
t('triggers.config.title', "Déclencheurs");
t('triggers.config.add_trigger', "Ajouter un déclencheur");
t('triggers.config.empty', "Aucun déclencheur configuré. Ajoutez-en un pour automatiser ce persona.");

// triggers.countdown
t('triggers.countdown.due_now', "Dû maintenant");
t('triggers.countdown.fires_in', "Se déclenche dans {time}");

// triggers.polling
t('triggers.polling.endpoint_label', "URL à vérifier");
t('triggers.polling.endpoint_placeholder', "https://api.example.com/status");
t('triggers.polling.check_interval', "Vérifier toutes les {interval}");
t('triggers.polling.content_hash', "Détecter les changements uniquement");

// triggers.webhook
t('triggers.webhook.url_label', "URL du webhook");
t('triggers.webhook.secret_label', "Clé de sécurité (optionnel)");
t('triggers.webhook.secret_placeholder', "Clé secrète pour vérifier les données entrantes");

// triggers.file_watcher
t('triggers.file_watcher.paths_label', "Chemins surveillés");
t('triggers.file_watcher.path_placeholder', "/chemin/à/surveiller");
t('triggers.file_watcher.add_path', "Ajouter un chemin");
t('triggers.file_watcher.events_label', "Événements de fichiers");
t('triggers.file_watcher.event_modify', "Modifier");
t('triggers.file_watcher.event_create', "Créer");
t('triggers.file_watcher.event_delete', "Supprimer");
t('triggers.file_watcher.recursive', "Récursif");
t('triggers.file_watcher.glob_filter', "Motif de fichier");
t('triggers.file_watcher.glob_placeholder', "*.json");

// triggers.clipboard
t('triggers.clipboard.content_type', "Type de contenu");
t('triggers.clipboard.type_text', "Texte");
t('triggers.clipboard.type_image', "Image");
t('triggers.clipboard.pattern_label', "Motif de correspondance");
t('triggers.clipboard.pattern_placeholder', "ex. https?://.*");
t('triggers.clipboard.interval_label', "Intervalle de vérification (secondes)");

// triggers.app_focus
t('triggers.app_focus.app_names_label', "Noms d'applications");
t('triggers.app_focus.app_placeholder', "ex. Chrome, Firefox");
t('triggers.app_focus.add_app', "Ajouter une application");
t('triggers.app_focus.title_pattern', "Motif de titre de fenêtre");
t('triggers.app_focus.title_placeholder', "ex. .*GitHub.*");
t('triggers.app_focus.interval_label', "Intervalle de vérification (secondes)");

// triggers.event_listener
t('triggers.event_listener.event_type_label', "Type d'événement");
t('triggers.event_listener.event_type_placeholder', "ex. persona.execution.completed");
t('triggers.event_listener.source_filter_label', "Filtre de source");
t('triggers.event_listener.source_filter_placeholder', "ex. persona:abc123");

// triggers.composite
t('triggers.composite.conditions_label', "Conditions");
t('triggers.composite.add_condition', "Ajouter une condition");
t('triggers.composite.operator_all', "Toutes les conditions doivent correspondre");
t('triggers.composite.operator_any', "N'importe quelle condition peut correspondre");
t('triggers.composite.window_label', "Fenêtre temporelle (secondes)");

// triggers.rate_limit
t('triggers.rate_limit.title', "Limites de vitesse");
t('triggers.rate_limit.max_fires', "Exécutions max");
t('triggers.rate_limit.per_window', "Période");
t('triggers.rate_limit.window_seconds', "{seconds}s");
t('triggers.rate_limit.window_minutes', "{minutes}m");
t('triggers.rate_limit.window_hours', "{hours}h");
t('triggers.rate_limit.currently_limited', "Actuellement suspendu (limite atteinte)");

// triggers.dry_run
t('triggers.dry_run.title', "Résultat du test");
t('triggers.dry_run.would_fire', "Se déclencherait");
t('triggers.dry_run.would_not_fire', "Ne se déclencherait pas");
t('triggers.dry_run.matched_conditions', "Conditions remplies");
t('triggers.dry_run.payload_preview', "Aperçu des données");

// triggers tabs
t('triggers.tab_live_stream', "Flux en direct");
t('triggers.tab_live_stream_subtitle', "Hub d'événements en temps réel — les agents publient et s'abonnent aux événements via ce bus partagé");
t('triggers.tab_builder', "Constructeur");
t('triggers.tab_builder_subtitle', "Connectez les personas aux sources d'événements — chaque événement traversant le bus, avec les personas qui l'écoutent");
t('triggers.tab_rate_limits', "Limites de vitesse");
t('triggers.tab_rate_limits_subtitle', "Limitation, profondeur de file d'attente et limites de simultanéité pour les déclencheurs");
t('triggers.tab_test', "Test");
t('triggers.tab_test_subtitle', "Déclenchez des événements de test dans le bus pour valider les écouteurs et le routage");
t('triggers.tab_smee_relay', "Relais local");
t('triggers.tab_smee_relay_subtitle', "Transférez les webhooks depuis des points de terminaison publics vers votre bus d'événements local");
t('triggers.tab_cloud_webhooks', "Événements cloud");
t('triggers.tab_cloud_webhooks_subtitle', "Points de terminaison webhook exposés par les agents cloud déployés");
t('triggers.tab_dead_letter', "File de lettres mortes");
t('triggers.tab_dead_letter_subtitle', "Événements ayant échoué à la livraison — inspecter, réessayer ou supprimer");
t('triggers.tab_studio', "Studio de chaînes");
t('triggers.tab_studio_subtitle', "Composez visuellement des chaînes de déclencheurs à plusieurs étapes avec routage conditionnel");
t('triggers.tab_shared', "Marketplace");
t('triggers.tab_shared_subtitle', "Découvrez et abonnez-vous aux événements partagés par d'autres personas");

t('triggers.full_event_log', "Journal complet des événements");
t('triggers.on_label', "Activé");
t('triggers.off_label', "Désactivé");
t('triggers.throttled_label', "Limité");
t('triggers.queued_label', "{count} en file");
t('triggers.unknown_budget_label', "Budget inconnu");
t('triggers.budget_label', "Budget");
t('triggers.or_use_templates', "ou utiliser des modèles");
t('triggers.schedule_mode_label', "Mode de planification");
t('triggers.test_fire_label', "Test de déclenchement");
t('triggers.dry_run_label', "Test à blanc");
t('triggers.copy_sample_curl', "Copier le curl d'exemple");
t('triggers.event_listener_label', "Écouteur d'événements");
t('triggers.execution_history', "Historique des exécutions");
t('triggers.could_not_load_history', "Impossible de charger l'historique");
t('triggers.no_executions_recorded', "Aucune exécution enregistrée pour ce déclencheur");
t('triggers.replaying_label', "Relecture...");
t('triggers.replay_label', "Relire");
t('triggers.local_time', "heure locale");
t('triggers.describe_trigger', "Décrivez votre déclencheur");
t('triggers.could_not_parse', "Impossible d'analyser un déclencheur depuis cette description. Essayez quelque chose comme");
t('triggers.rate_limiting', "Limitation du débit");
t('triggers.max_executions', "Exécutions max");
t('triggers.cooldown_label', "Délai entre déclenchements (secondes)");
t('triggers.max_concurrent_label', "Exécutions simultanées max");
t('triggers.unlimited_hint', "0 = illimité");
t('triggers.window_usage', "Utilisation de la fenêtre");
t('triggers.concurrent_label', "Simultané");
t('triggers.cooldown_stat', "Délai");
t('triggers.queued_stat', "En file");
t('triggers.clear_all_limits', "Effacer toutes les limites");
t('triggers.dry_run_result_title', "Résultat du test à blanc");
t('triggers.all_checks_passed', "Toutes les vérifications réussies");
t('triggers.validation_failed', "Échec de la validation");
t('triggers.simulated_event', "Événement simulé");
t('triggers.matched_subscriptions_title', "Abonnements correspondants");
t('triggers.no_subscriptions_activated', "Aucun abonnement ne serait activé");
t('triggers.active_hours', "Heures actives");
t('triggers.only_fire_during_active', "Déclencher uniquement pendant les heures actives");
t('triggers.weekdays_preset', "Jours ouvrés");
t('triggers.every_day_preset', "Tous les jours");
t('triggers.hmac_secret_label', "Secret HMAC");
t('triggers.hmac_help', "Les webhooks entrants doivent inclure un en-tête de signature HMAC valide. Un secret sera généré automatiquement si laissé vide.");
t('triggers.auto_generated_hint', "Généré automatiquement si laissé vide");
t('triggers.webhook_url_note', "Une URL de webhook unique sera affichée après la création avec un bouton de copie");
t('triggers.hide_secret', "Masquer le secret");
t('triggers.show_secret', "Afficher le secret");
t('triggers.generate_secret', "Générer un secret aléatoire");
t('triggers.watch_subdirs', "Surveiller les sous-répertoires récursivement");
t('triggers.text_pattern_help', "Se déclenche uniquement quand le texte du presse-papier correspond à ce motif");
t('triggers.app_names_help', "Laisser vide pour déclencher sur tout changement de focus d'application");
t('triggers.source_filter_optional', "Filtre de source (optionnel)");
t('triggers.op_all_label', "TOUT (ET)");
t('triggers.op_all_desc', "Toutes les conditions doivent correspondre");
t('triggers.op_any_label', "N'IMPORTE LEQUEL (OU)");
t('triggers.op_any_desc', "Au moins une condition");
t('triggers.op_sequence_label', "Séquence");
t('triggers.op_sequence_desc', "Conditions dans l'ordre");
t('triggers.time_window_help', "Toutes les conditions doivent être remplies dans cette fenêtre temporelle");
t('triggers.credential_event_help', "Lier à un événement d'identifiant au lieu d'un point de terminaison personnalisé");
t('triggers.none_use_endpoint', "Aucun — utiliser l'URL du point de terminaison à la place");
t('triggers.disabled_label', "Désactivé");
t('triggers.manual_label', "Manuel");
t('triggers.pending_label', "En attente");
t('triggers.fire_label', "Déclencher");
t('triggers.webhook_label', "Webhook");
t('triggers.chain_label', "Chaîne");
t('triggers.poll_interval_label', "Intervalle d'interrogation (secondes)");
t('triggers.endpoint_url', "URL du point de terminaison");
t('triggers.dev_mode_warning', "Mode dev — cette URL n'est accessible que localement");
t('triggers.conditions_met', "{met}/{total} conditions remplies");
t('triggers.suppressed_label', "supprimé");
t('triggers.request_inspector', "Inspecteur de requêtes");
t('triggers.errors_count', "{count} erreurs");
t('triggers.could_not_load_log', "Impossible de charger le journal des requêtes");
t('triggers.no_webhook_requests', "Aucune requête webhook reçue");
t('triggers.clear_all', "Tout effacer");
t('triggers.all_statuses', "Tous les statuts");
t('triggers.all_types', "Tous les types");
t('triggers.target_agent_label', "Agent cible");
t('triggers.broadcast_label', "diffusion");
t('triggers.live_label', "En direct");
t('triggers.paused_label', "En pause");
t('triggers.connecting_label', "Connexion");
t('triggers.events_per_min', "événements/min");
t('triggers.received_label', "reçus");
t('triggers.in_buffer', "en tampon");
t('triggers.resume_label', "Reprendre");
t('triggers.pause_label', "Pause");
t('triggers.no_events_title', "Aucun événement sur le bus");
t('triggers.no_events_desc', "Les événements apparaîtront ici en temps réel lorsque les agents publient et s'abonnent via le bus d'événements partagé.");
t('triggers.connecting_to_bus', "Connexion au bus d'événements...");
t('triggers.event_data', "Données d'événement");
t('triggers.copy_json', "Copier le JSON");
t('triggers.no_event_data', "Aucune donnée d'événement");
t('triggers.publish_test_event', "Publier un événement de test");
t('triggers.publish_test_desc', "Déclenchez un événement de test dans le bus pour vérifier les abonnements et le routage des agents.");
t('triggers.event_type_form_label', "Type d'événement");
t('triggers.payload_json_label', "Charge utile (JSON)");
t('triggers.publishing_label', "Publication...");
t('triggers.publish_event', "Publier l'événement");
t('triggers.event_published', "Événement publié");
t('triggers.dead_letter_help', "Événements dont le traitement a échoué après épuisement de toutes les tentatives. Vous pouvez les réessayer manuellement ou les supprimer.");
t('triggers.no_dead_letters', "Aucun événement en lettres mortes");
t('triggers.all_events_processed', "Tous les événements traités avec succès");
t('triggers.exhausted_label', "Épuisé");
t('triggers.no_active_relays', "Aucun relais actif");
t('triggers.smee_relays', "Relais Smee");
t('triggers.add_relay', "Ajouter un relais");
t('triggers.create_relay', "Créer un relais");
t('triggers.label_field', "Libellé");
t('triggers.channel_url_label', "URL du canal");
t('triggers.route_to_agent', "Router vers l'agent");
t('triggers.broadcast_to_all', "Diffuser à tous");
t('triggers.event_filter_label', "Filtre d'événements");
t('triggers.no_smee_relays', "Aucun relais Smee configuré");
t('triggers.smee_relay_desc', "Ajoutez un relais Smee pour recevoir les webhooks GitHub et les événements tiers en temps réel via le bus d'événements.");
t('triggers.add_first_relay', "Ajouter le premier relais");
t('triggers.how_it_works', "Comment ça marche");
t('triggers.live_stream', "Flux en direct");
t('triggers.cloud_not_connected', "Cloud non connecté");
t('triggers.cloud_not_connected_desc', "Connectez-vous à un orchestrateur cloud pour recevoir les webhooks tiers");
t('triggers.cloud_relay_active', "Relais cloud actif");
t('triggers.cloud_webhook_triggers', "Déclencheurs de webhook cloud");
t('triggers.add_webhook', "Ajouter un webhook");
t('triggers.deployed_persona', "Persona déployé");
t('triggers.select_persona', "Sélectionnez un persona...");
t('triggers.create_webhook', "Créer un webhook");
t('triggers.no_webhook_triggers', "Aucun déclencheur webhook");
t('triggers.no_webhook_triggers_desc', "Créez un déclencheur webhook sur un persona déployé pour recevoir des POST tiers");
t('triggers.recent_firings', "Déclenchements récents");
t('triggers.no_firings', "Aucun déclenchement enregistré");
t('triggers.no_rate_limits', "Aucune limite de vitesse configurée");
t('triggers.no_rate_limits_desc', "Ajoutez des limites de vitesse à vos déclencheurs pour contrôler la fréquence d'exécution.");
t('triggers.rate_limits_heading', "Limites de vitesse");
t('triggers.triggers_configured', "déclencheurs configurés");
t('triggers.running_stat', "en cours");
t('triggers.throttled_stat', "limité");
t('triggers.browse_label', "Parcourir");
t('triggers.my_subscriptions', "Mes abonnements");
t('triggers.search_feeds', "Rechercher des flux...");
t('triggers.loading_catalog', "Chargement du catalogue...");
t('triggers.no_feeds', "Aucun flux d'événements partagé disponible");
t('triggers.no_feeds_hint', "Cliquez sur Actualiser pour récupérer les derniers flux depuis le cloud");

// settings.account
t('settings.account.dismiss', "Ignorer");
t('settings.account.waiting_sign_in', "En attente de la connexion...");
t('settings.account.complete_sign_in', "Terminez la connexion dans la fenêtre contextuelle");
t('settings.account.cancel', "Annuler");
t('settings.account.telemetry_title', "Télémétrie de dépannage");
t('settings.account.telemetry_description', "Lorsqu'activé, des rapports de plantage anonymes et des analyses d'utilisation des fonctionnalités sont envoyés pour aider à identifier et corriger les bugs. Aucune donnée personnelle, identifiant ou contenu d'exécution n'est jamais inclus.");
t('settings.account.telemetry_toggle', "Envoyer la télémétrie anonyme");
t('settings.account.telemetry_on', "Les rapports de plantage et les analyses d'utilisation sont actifs.");
t('settings.account.telemetry_off', "La télémétrie est désactivée. Aucune donnée n'est envoyée à Sentry.");
t('settings.account.telemetry_restart', "Redémarrez l'application pour que ce changement prenne effet");

// settings.appearance_extra
t('settings.appearance_extra.simple', "Simple");
t('settings.appearance_extra.simple_hint', "Fonctionnalités principales uniquement");
t('settings.appearance_extra.full', "Complet");
t('settings.appearance_extra.full_hint', "Afficher l'interface complète");
t('settings.appearance_extra.dev', "Dev");
t('settings.appearance_extra.dev_hint', "Débloquer les outils de développement");

// settings.appearance
t('settings.appearance.title', "Apparence");
t('settings.appearance.interface_mode', "Mode d'interface");
t('settings.appearance.interface_mode_hint', "Le mode simple n'affiche que les fonctionnalités principales. Le mode puissance déverrouille l'interface complète.");
t('settings.appearance.theming', "Thèmes");
t('settings.appearance.default_tab', "Par défaut");
t('settings.appearance.custom_tab', "Personnalisé");
t('settings.appearance.timezone', "Fuseau horaire");
t('settings.appearance.preview_action', "Action");
t('settings.appearance.preview_card_title', "Titre de la carte");
t('settings.appearance.preview_muted_text', "Texte de description secondaire avec contenu atténué");
t('settings.appearance.preview_ok', "OK");
t('settings.appearance.preview_warn', "Avert.");
t('settings.appearance.preview_err', "Err.");
t('settings.appearance.language_translations', "Langue et traductions");
t('settings.appearance.translation_keys', "{count} clés de traduction");
t('settings.appearance.translation_coverage', "{covered} sur {total} clés ({pct}%)");
t('settings.appearance.coverage_full', "Complet");
t('settings.appearance.coverage_hint', "Couverture des traductions — cliquez pour exporter");
t('settings.appearance.contribute_title', "Contribuer aux traductions");
t('settings.appearance.contribute_hint', "Aidez à traduire Personas dans votre langue. Exportez un fichier de langue ci-dessus, traduisez les valeurs et soumettez via GitHub.");
t('settings.appearance.contribute_github', "Contribuer sur GitHub");

// settings.notifications
t('settings.notifications.title', "Notifications");
t('settings.notifications.subtitle', "Contrôlez quelles alertes de guérison déclenchent des notifications");
t('settings.notifications.severity_critical_label', "Critique");
t('settings.notifications.severity_high_label', "Élevé");
t('settings.notifications.severity_medium_label', "Moyen");
t('settings.notifications.severity_low_label', "Faible");

// settings.engine
t('settings.engine.title', "Moteur");
t('settings.engine.operation', "Opération");

// settings.ambient
t('settings.ambient.title', "Fusion de contexte ambiant");
t('settings.ambient.description', "Le contexte ambiant capture le presse-papier, les changements de fichiers et les signaux de focus d'application pour donner aux personas une conscience de votre workflow de bureau.");
t('settings.ambient.events_broadcast', "{count} événements diffusés");
t('settings.ambient.subscribers', "{count} abonné");
t('settings.ambient.subscribers_plural', "{count} abonnés");
t('settings.ambient.live_context', "Fenêtre de contexte en direct");
t('settings.ambient.total_signals', "{count} signaux totaux");
t('settings.ambient.no_signals', "Aucun signal récent capturé");
t('settings.ambient.sensory_policy', "Politique sensorielle");
t('settings.ambient.reset_defaults', "Réinitialiser aux valeurs par défaut");
t('settings.ambient.clipboard', "Presse-papier");
t('settings.ambient.file_changes', "Changements de fichiers");
t('settings.ambient.app_focus', "Focus d'application");
t('settings.ambient.focus_filter', "Filtre d'application en focus");
t('settings.ambient.focus_filter_hint', "Capturer les signaux uniquement quand ces applications sont en focus. Vide = capturer depuis n'importe quelle application.");
t('settings.ambient.focus_filter_placeholder', "ex. Code.exe");
t('settings.ambient.add', "Ajouter");
t('settings.ambient.context_rules', "Règles de contexte");
t('settings.ambient.add_rule', "Ajouter une règle");
t('settings.ambient.context_rules_hint', "Définissez des motifs qui déclenchent des actions proactives de persona lorsque le contexte du bureau correspond.");
t('settings.ambient.rule_name_placeholder', "Nom de règle (ex. \"Aide au débogage des plantages\")");
t('settings.ambient.match_sources', "Sources correspondantes (vide = toutes)");
t('settings.ambient.summary_contains_placeholder', "Le résumé contient (ex. \"erreur\", \"Code.exe\")");
t('settings.ambient.file_glob_placeholder', "Glob de fichier (ex. *.rs)");
t('settings.ambient.app_filter_placeholder', "Filtre d'application (ex. Code.exe)");
t('settings.ambient.action', "Action");
t('settings.ambient.action_trigger', "Déclencher l'exécution");
t('settings.ambient.action_emit', "Émettre un événement");
t('settings.ambient.action_log', "Journaliser uniquement");
t('settings.ambient.cooldown', "Délai (sec)");
t('settings.ambient.cancel', "Annuler");
t('settings.ambient.create_rule', "Créer une règle");
t('settings.ambient.no_rules', "Aucune règle de contexte définie");
t('settings.ambient.all_sources', "toutes les sources");

// settings.byom
t('settings.byom.title', "Apportez votre propre modèle");
t('settings.byom.subtitle', "Configurez les fournisseurs approuvés, les restrictions de conformité et le routage optimisé pour les coûts");
t('settings.byom.loading', "Chargement...");
t('settings.byom.unsaved_changes', "Modifications non enregistrées");
t('settings.byom.reset', "Réinitialiser");
t('settings.byom.save_policy', "Enregistrer la politique");
t('settings.byom.fix_errors', "Corrigez toutes les erreurs avant d'enregistrer");
t('settings.byom.policy_corrupted', "Politique BYOM corrompue");
t('settings.byom.policy_corrupted_desc', "Le JSON de politique stocké n'a pas pu être analysé. Toutes les restrictions de fournisseur sont actuellement inactives et les exécutions sont bloquées. Réinitialisez la politique pour restaurer le fonctionnement normal.");
t('settings.byom.reset_policy', "Réinitialiser la politique");
t('settings.byom.policy_enforcement', "Application de la politique BYOM");
t('settings.byom.policy_enforcement_desc', "Lorsqu'activé, la sélection du fournisseur suit vos règles configurées");
t('settings.byom.tab_providers', "Fournisseurs");
t('settings.byom.tab_keys', "Clés API");
t('settings.byom.tab_routing', "Routage des coûts");
t('settings.byom.tab_compliance', "Conformité");
t('settings.byom.tab_audit', "Journal d'audit");
t('settings.byom.allowed_providers', "Fournisseurs autorisés");
t('settings.byom.allowed_providers_hint', "Sélectionnez les fournisseurs approuvés par votre organisation. Laissez vide pour autoriser tous.");
t('settings.byom.allowed', "Autorisé");
t('settings.byom.blocked_providers', "Fournisseurs bloqués");
t('settings.byom.blocked_providers_hint', "Bloquez explicitement des fournisseurs spécifiques. Prend le dessus sur la liste autorisée.");
t('settings.byom.blocked', "Bloqué");
t('settings.byom.provider_usage', "Utilisation du fournisseur");
t('settings.byom.usage_trends', "Tendances sur 30 jours");
t('settings.byom.executions', "Exécutions");
t('settings.byom.cost', "Coût");
t('settings.byom.avg_duration', "Durée moyenne");
t('settings.byom.failovers', "{count} basculements");
t('settings.byom.no_trend_data', "Aucune donnée de tendance");
t('settings.byom.test_connection', "Tester la connexion");
t('settings.byom.testing', "Test...");
t('settings.byom.reachable', "Accessible");
t('settings.byom.unreachable', "Inaccessible");
t('settings.byom.api_key_title', "Gestion des clés API");
t('settings.byom.api_key_hint', "Configurez les clés API et les points de terminaison pour les fournisseurs de modèles personnalisés. Les clés sont stockées chiffrées dans la base de données locale.");
t('settings.byom.verify', "Vérifier");
t('settings.byom.remove_key', "Supprimer la clé");
t('settings.byom.save', "Enregistrer");
t('settings.byom.stored', "Stocké");
t('settings.byom.error', "Erreur");
t('settings.byom.routing_title', "Règles de routage optimisé pour les coûts");
t('settings.byom.routing_hint', "Router les tâches vers des fournisseurs/modèles spécifiques selon la complexité");
t('settings.byom.routing_empty', "Aucune règle de routage configurée. Ajoutez des règles pour optimiser les coûts par complexité de tâche.");
t('settings.byom.add_rule', "Ajouter une règle");
t('settings.byom.rule_name_placeholder', "Nom de règle");
t('settings.byom.complexity', "Complexité");
t('settings.byom.provider', "Fournisseur");
t('settings.byom.model_optional', "Modèle (optionnel)");
t('settings.byom.compliance_title', "Restrictions axées sur la conformité");
t('settings.byom.compliance_hint', "Restreindre les fournisseurs pour des types de workflows spécifiques (ex. HIPAA, SOC2)");
t('settings.byom.compliance_empty', "Aucune règle de conformité configurée. Ajoutez des règles pour restreindre les fournisseurs pour les workflows sensibles.");
t('settings.byom.compliance_name_placeholder', "Nom de règle (ex. HIPAA)");
t('settings.byom.workflow_tags', "Tags de workflow (séparés par des virgules)");
t('settings.byom.workflow_tags_placeholder', "hipaa, santé, pii");
t('settings.byom.allowed_providers_label', "Fournisseurs autorisés");
t('settings.byom.audit_title', "Journal d'audit du fournisseur");
t('settings.byom.audit_hint', "Trace de conformité montrant quel fournisseur a géré chaque exécution");
t('settings.byom.audit_empty', "Aucune entrée d'audit. Les entrées sont enregistrées automatiquement pour chaque exécution.");
t('settings.byom.audit_provider', "Fournisseur");
t('settings.byom.audit_model', "Modèle");
t('settings.byom.audit_persona', "Persona");
t('settings.byom.audit_status', "Statut");
t('settings.byom.audit_cost', "Coût");
t('settings.byom.audit_time', "Heure");
t('settings.byom.failover', "basculement");

// settings.admin
t('settings.admin.title', "Administration");
t('settings.admin.subtitle', "Outils de développement et utilitaires de test");
t('settings.admin.guided_tour', "Visite guidée");
t('settings.admin.tour_hint', "Forcer le démarrage ou réinitialiser la visite guidée d'intégration pour les tests e2e");
t('settings.admin.tour_active', "Active");
t('settings.admin.tour_completed', "Terminée");
t('settings.admin.tour_dismissed', "Ignorée");
t('settings.admin.tour_not_started', "Non démarrée");
t('settings.admin.progress', "Progression");
t('settings.admin.steps', "étapes");
t('settings.admin.current_step', "Étape actuelle");
t('settings.admin.step_status', "Statut de l'étape");
t('settings.admin.force_start', "Forcer le démarrage de la visite");
t('settings.admin.confirm_reset', "Confirmer la réinitialisation");
t('settings.admin.reset_state', "Réinitialiser l'état");
t('settings.admin.force_complete', "Forcer la complétion");
t('settings.admin.force_dismiss', "Forcer l'ignorance");
t('settings.admin.user_consent', "Consentement utilisateur");
t('settings.admin.consent_hint', "Réinitialiser le modal de consentement de première utilisation pour tester l'intégration");
t('settings.admin.consent_accepted', "Accepté");
t('settings.admin.consent_not_accepted', "Non accepté");
t('settings.admin.storage_key', "Clé de stockage");
t('settings.admin.reset_consent', "Réinitialiser le consentement");
t('settings.admin.reload_modal', "Recharger pour afficher le modal");

// settings.portability
t('settings.portability.title', "Portabilité des données");
t('settings.portability.subtitle', "Exporter, importer et migrer vos données d'espace de travail");
t('settings.portability.workspace_overview', "Vue d'ensemble de l'espace de travail");
t('settings.portability.loading_stats', "Chargement des statistiques de l'espace de travail...");
t('settings.portability.stats_error', "Échec du chargement des statistiques de l'espace de travail.");
t('settings.portability.error_label', "Erreur");
t('settings.portability.personas', "Personas");
t('settings.portability.teams', "Équipes");
t('settings.portability.tools', "Outils");
t('settings.portability.groups', "Groupes");
t('settings.portability.credentials', "Identifiants");
t('settings.portability.memories', "Mémoires");
t('settings.portability.test_suites', "Suites de tests");
t('settings.portability.export_import_title', "Export et import de l'espace de travail");
t('settings.portability.export_import_hint', "Exportez votre espace de travail dans une archive ZIP portable contenant les personas, équipes, identifiants et données associées. Choisissez exactement ce à inclure. L'import restaure depuis une archive précédemment exportée — les éléments importés sont créés comme de nouvelles entités (désactivés par défaut).");
t('settings.portability.exporting', "Export...");
t('settings.portability.exported', "Exporté !");
t('settings.portability.export_workspace', "Exporter l'espace de travail");
t('settings.portability.import_workspace', "Importer l'espace de travail");
t('settings.portability.import_label', "Importer");
t('settings.portability.imported', "Importé !");
t('settings.portability.cancel', "Annuler");
t('settings.portability.passphrase_optional', "Phrase secrète (optionnel)");
t('settings.portability.import_complete', "Importation terminée");
t('settings.portability.warnings', "Avertissements :");
t('settings.portability.export_title', "Exporter l'espace de travail");
t('settings.portability.export_subtitle', "Choisissez ce à inclure dans votre export");
t('settings.portability.close', "Fermer");
t('settings.portability.loading_data', "Chargement des données de l'espace de travail...");
t('settings.portability.select_all', "Tout sélectionner");
t('settings.portability.deselect_all', "Tout désélectionner");
t('settings.portability.items_selected', "{selected} sur {total} éléments sélectionnés");
t('settings.portability.of_selected', "{count} sur {total} sélectionné(s)");
t('settings.portability.encrypt_passphrase', "Chiffrer les identifiants avec une phrase secrète");
t('settings.portability.optional', "(optionnel)");
t('settings.portability.passphrase_placeholder', "Phrase secrète (min. 8 caractères)");
t('settings.portability.passphrase_too_short', "La phrase secrète doit contenir au moins 8 caractères");
t('settings.portability.passphrase_note', "Si définie, les secrets d'identifiants seront inclus dans l'export et protégés par chiffrement AES-256.");
t('settings.portability.auto_included_note', "Les groupes, outils, mémoires et suites de tests liés aux personas sélectionnés sont automatiquement inclus.");
t('settings.portability.no_passphrase_note', " Les secrets d'identifiants ne sont pas inclus sauf si une phrase secrète est définie ci-dessus.");
t('settings.portability.export_all', "Tout exporter");
t('settings.portability.export_items', "Exporter {count} élément");
t('settings.portability.export_items_plural', "Exporter {count} éléments");
t('settings.portability.credential_vault', "Coffre-fort d'identifiants");
t('settings.portability.credential_vault_hint', "Les exports d'espace de travail n'incluent pas les secrets d'identifiants. Utilisez cette section pour exporter et importer votre coffre-fort avec chiffrement AES-256 protégé par mot de passe.");
t('settings.portability.export_credentials', "Exporter les identifiants");
t('settings.portability.import_credentials', "Importer les identifiants");
t('settings.portability.passphrase_min', "Phrase secrète (min. 8 car.)");
t('settings.portability.passphrase_label', "Phrase secrète");
t('settings.portability.export', "Exporter");
t('settings.portability.credentials_exist', "{count} identifiant existe déjà");
t('settings.portability.credentials_exist_plural', "{count} identifiants existent déjà");
t('settings.portability.conflict_hint', "Choisissez comment gérer chaque conflit :");
t('settings.portability.skip', "Ignorer");
t('settings.portability.keep_both', "Conserver les deux");
t('settings.portability.replace', "Remplacer");
t('settings.portability.import_with_resolutions', "Importer avec résolutions");
t('settings.portability.cred_import_complete', "Importation d'identifiants terminée");
t('settings.portability.cred_imported', "{count} importé(s)");
t('settings.portability.cred_skipped', ", {count} ignoré(s)");
t('settings.portability.cred_replaced', ", {count} remplacé(s)");

// settings.config
t('settings.config.title', "Résolution de la configuration");
t('settings.config.subtitle', "Montre quel niveau (agent / espace de travail / global) fournit chaque paramètre par persona");
t('settings.config.refresh', "Actualiser");
t('settings.config.agent_level', "Niveau agent");
t('settings.config.workspace_level', "Espace de travail");
t('settings.config.global_level', "Global");
t('settings.config.not_set', "Non défini");
t('settings.config.overrides_inherited', "Remplace l'hérité");
t('settings.config.agent', "Agent");
t('settings.config.loading_agents', "Chargement des agents...");
t('settings.config.no_agents', "Aucun agent trouvé");

// settings.quality_gates
t('settings.quality_gates.title', "Portes de qualité");
t('settings.quality_gates.loading', "Chargement...");
t('settings.quality_gates.error_loading', "Erreur de chargement de la configuration");
t('settings.quality_gates.active_rules', "{count} règles de filtre actives");
t('settings.quality_gates.loading_config', "Chargement de la configuration des portes de qualité...");
t('settings.quality_gates.description', "Les portes de qualité filtrent les mémoires et révisions générées par IA lors de l'expédition des exécutions. Les motifs sont comparés en sous-chaînes avec le titre et contenu combinés de chaque soumission. Lorsqu'un motif correspond, l'action configurée est appliquée. Ces règles empêchent le bruit opérationnel (erreurs d'identifiants, traces de pile, rapports d'espace de travail vides) de polluer votre base de connaissances.");
t('settings.quality_gates.memory_filters', "Filtres de mémoire");
t('settings.quality_gates.memory_filters_desc', "Appliqués aux soumissions AgentMemory. Bloque les échecs opérationnels et les fuites d'identifiants pour ne pas être stockés comme mémoires de persona.");
t('settings.quality_gates.review_filters', "Filtres de révision");
t('settings.quality_gates.review_filters_desc', "Appliqués aux soumissions ManualReview. Filtre les erreurs d'infrastructure pour que seules les vraies décisions métier atteignent la file de révision.");
t('settings.quality_gates.rejected_categories', "Catégories rejetées");
t('settings.quality_gates.rules_count', "{count} règle");
t('settings.quality_gates.rules_count_plural', "{count} règles");
t('settings.quality_gates.reset_defaults', "Réinitialiser aux valeurs par défaut");
t('settings.quality_gates.confirm_reset', "Confirmer la réinitialisation ?");
t('settings.quality_gates.rules_hint', "Les règles sont chargées depuis la base de données à chaque expédition. Les changements prennent effet immédiatement.");

// onboarding
t('onboarding.continue_button', "Continuer");
t('onboarding.done_button', "Terminé");
t('onboarding.scanning_tooltip', "Analyse de vos applications de bureau...");
t('onboarding.select_template_tooltip', "Sélectionnez d'abord un modèle");
t('onboarding.step_appearance', "Apparence");
t('onboarding.step_discover', "Bureau");
t('onboarding.step_pick_template', "Choisir un modèle");
t('onboarding.step_adopt', "Configurer l'agent");
t('onboarding.step_execute', "Première exécution");
t('onboarding.desktop_title', "Votre environnement de bureau");
t('onboarding.desktop_description', "Nous avons trouvé ces applications sur votre machine. Autorisez l'accès pour que vos agents puissent interagir directement avec elles.");
t('onboarding.desktop_empty', "Aucune application de bureau supportée détectée.");
t('onboarding.desktop_empty_hint', "Vous pouvez connecter des applications de bureau plus tard depuis la section Connexions.");
t('onboarding.risk_review', "Révision recommandée");
t('onboarding.risk_review_tooltip', "Cette application peut exécuter des commandes sur votre système — vérifiez avant d'autoriser");
t('onboarding.risk_safe', "Sûr à autoriser");
t('onboarding.risk_safe_tooltip', "Accès en lecture seule, sûr à autoriser");
t('onboarding.appearance_heading', "Configurez vos préférences");
t('onboarding.appearance_description', "Configurez la langue, la taille du texte et le thème. Vous pouvez les modifier à tout moment dans les Paramètres.");
t('onboarding.language_label', "Langue");
t('onboarding.text_size_label', "Taille du texte");
t('onboarding.dark_label', "Sombre");
t('onboarding.light_label', "Clair");
t('onboarding.brightness_label', "Luminosité");
t('onboarding.brightness_hint', "Si l'application semble trop sombre sur votre moniteur, augmentez la luminosité.");
t('onboarding.scanning_desktop', "Analyse du bureau...");
t('onboarding.approved', "Approuvé");
t('onboarding.approve', "Approuver");
t('onboarding.run_first_agent', "Exécutez votre premier agent");
t('onboarding.execute_description', "Exécutez {name} et voyez la sortie en temps réel.");
t('onboarding.agent_ready_hint', "Votre agent est prêt. Cliquez ci-dessous pour démarrer la première exécution.");
t('onboarding.run_agent', "Exécuter l'agent");
t('onboarding.execution_completed', "Exécution terminée avec succès");
t('onboarding.executing', "Exécution...");
t('onboarding.agent_output', "Sortie de l'agent");
t('onboarding.waiting_for_output', "En attente de la sortie...");
t('onboarding.execution_failed', "Échec du démarrage de l'exécution");
t('onboarding.loading_templates', "Chargement des modèles...");
t('onboarding.no_templates', "Aucun modèle de démarrage trouvé.");
t('onboarding.no_templates_hint', "Générez d'abord des modèles depuis la section Modèles.");
t('onboarding.pick_template_heading', "Choisissez un modèle de démarrage");
t('onboarding.pick_template_description', "Choisissez l'un de ces modèles populaires pour créer votre premier agent.");
t('onboarding.more_connectors', "+{count} de plus");
t('onboarding.getting_started', "Premiers pas");
t('onboarding.progress_appearance', "Apparence");
t('onboarding.progress_discover', "Détecter les apps de bureau");
t('onboarding.progress_pick_template', "Choisir un modèle");
t('onboarding.progress_adopt', "Adopter un agent");
t('onboarding.progress_execute', "Première exécution");
t('onboarding.tour_step_of', "Étape {current} sur {total}");
t('onboarding.minimize', "Réduire");
t('onboarding.end_tour', "Terminer la visite");
t('onboarding.back', "Retour");
t('onboarding.complete_tour', "Terminer la visite guidée");
t('onboarding.tour_loading', "Chargement...");
t('onboarding.tour_skip', "Ignorer");
t('onboarding.what_to_explore', "Quoi explorer");
t('onboarding.auto_complete_hint', "Prenez un moment pour explorer — cette étape se complétera automatiquement, ou cliquez sur Ignorer pour continuer.");
t('onboarding.resume_tour', "Reprendre la visite ({completed}/{total})");
t('onboarding.start_tour', "Démarrer la visite");
t('onboarding.connector_count_stat', "Plus de 200 connecteurs intégrés");
t('onboarding.connector_count_hint', "Pré-configurés avec les champs d'authentification et les tests de santé");
t('onboarding.categories_label', "Catégories");
t('onboarding.browsed_progress', "Parcouru {count}/2");
t('onboarding.connection_types_label', "Types de connexion");
t('onboarding.conn_api_key', "Clé API / Jeton");
t('onboarding.conn_api_key_desc', "Authentification standard — collez votre clé et c'est parti.");
t('onboarding.conn_oauth', "OAuth 2.0");
t('onboarding.conn_oauth_desc', "Flux d'autorisation sécurisé — cliquez pour autoriser, aucun secret à gérer.");
t('onboarding.conn_mcp', "Protocole MCP");
t('onboarding.conn_mcp_desc', "Model Context Protocol — connectez des outils IA via le transport stdio ou SSE.");
t('onboarding.conn_desktop', "Pont de bureau");
t('onboarding.conn_desktop_desc', "Intégrez directement avec les applications locales — VS Code, Terminal, Docker.");
t('onboarding.connect_once', "Connectez une fois, utilisez dans tous les agents");
t('onboarding.connect_once_hint', "Les identifiants sont partagés dans toute votre flotte d'agents. Configurez une connexion Slack une fois et chaque agent peut l'utiliser.");
t('onboarding.describe_intent', "Décrivez ce que votre agent doit faire. Soyez précis sur la tâche, les sources de données et la sortie souhaitée.");
t('onboarding.example_intents_label', "Intentions exemples");
t('onboarding.intent_field_hint', "Entrez votre intention dans le champ à droite, puis cliquez sur le bouton de lancement.");
t('onboarding.analyzing_hint', "L'IA analyse votre intention et peut poser des questions de clarification pour affiner la conception de l'agent.");
t('onboarding.questions_waiting_one', "{count} question en attente");
t('onboarding.questions_waiting_other', "{count} questions en attente");
t('onboarding.answer_questions_hint', "Répondez-y dans la matrice pour façonner la conception de votre agent.");
t('onboarding.answers_help_hint', "Vos réponses aident l'IA à choisir les bons connecteurs, déclencheurs et politiques.");
t('onboarding.matrix_heading', "La matrice d'agent à 8 dimensions :");
t('onboarding.matrix_completeness', "{pct}% complet");
t('onboarding.dim_use_cases', "Cas d'usage");
t('onboarding.dim_use_cases_desc', "Quels workflows votre agent gère");
t('onboarding.dim_connectors', "Connecteurs");
t('onboarding.dim_connectors_desc', "Services externes qu'il intègre");
t('onboarding.dim_triggers', "Déclencheurs");
t('onboarding.dim_triggers_desc', "Comment et quand il s'active");
t('onboarding.dim_human_review', "Révision humaine");
t('onboarding.dim_human_review_desc', "Quand il a besoin de votre approbation");
t('onboarding.dim_messages', "Messages");
t('onboarding.dim_messages_desc', "Comment il vous notifie des résultats");
t('onboarding.dim_memory', "Mémoire");
t('onboarding.dim_memory_desc', "Persistance des conversations entre les exécutions");
t('onboarding.dim_error_handling', "Gestion des erreurs");
t('onboarding.dim_error_handling_desc', "Stratégies de repli en cas d'échec");
t('onboarding.dim_events', "Événements");
t('onboarding.dim_events_desc', "Abonnements aux événements qu'il écoute");
t('onboarding.all_tests_passed', "Tous les tests réussis !");
t('onboarding.promote_hint', "Votre agent a été vérifié. Cliquez sur \"Promouvoir\" pour le rendre prêt pour la production.");
t('onboarding.some_tests_failed', "Certains tests ont échoué");
t('onboarding.refine_hint', "Vous pouvez affiner l'agent et relancer les tests, ou ignorer cette étape pour l'instant.");
t('onboarding.testing_description', "Les tests vérifient que les outils de votre agent fonctionnent correctement avec de vraies API.");
t('onboarding.what_testing_checks', "Ce que les tests vérifient :");
t('onboarding.test_check_api', "Chaque outil se connecte à son API cible");
t('onboarding.test_check_creds', "Les identifiants sont valides et ont les permissions correctes");
t('onboarding.test_check_format', "Les formats de réponse correspondent aux attentes");
t('onboarding.run_test_hint', "Cliquez sur \"Exécuter le test\" dans la matrice pour vérifier, puis promouvez en production.");
t('onboarding.agent_promoted', "Agent promu !");
t('onboarding.agent_promoted_hint', "Votre premier agent est en ligne. La visite guidée est presque terminée !");
t('onboarding.skip_build', "Ignorer la construction pour l'instant");
t('onboarding.dark_themes', "Thèmes sombres");
t('onboarding.light_themes', "Thèmes clairs");

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Batch 7 total keys:', Object.keys(out).length);
