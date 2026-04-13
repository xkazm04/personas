'use strict';
const fs = require('fs');
const outPath = require('path').join(__dirname, '../.planning/i18n/translated-fr.json');
const out = JSON.parse(fs.readFileSync(outPath, 'utf8'));

function t(k, v) { out[k] = v; }

// deployment.status
t('deployment.status.no_token_configured', "Aucun jeton configuré");

// deployment.api_playground
t('deployment.api_playground.title', "Bac à sable API");
t('deployment.api_playground.request_body', "Corps de la requête");
t('deployment.api_playground.response_label', "Réponse");
t('deployment.api_playground.send_request', "Envoyer la requête");
t('deployment.api_playground.sending', "Envoi...");
t('deployment.api_playground.empty_response', "(réponse vide)");
t('deployment.api_playground.snippets', "Extraits");

// deployment.connection
t('deployment.connection.orchestrator_url_label', "URL du serveur cloud");
t('deployment.connection.orchestrator_prefix', "https://");
t('deployment.connection.enter_api_key', "Entrez la clé API");
t('deployment.connection.connect', "Connecter");
t('deployment.connection.connected', "Connecté");
t('deployment.connection.disconnect', "Déconnecter");
t('deployment.connection.diagnose', "Diagnostiquer");
t('deployment.connection.diagnosing', "Diagnostic...");
t('deployment.connection.diagnostics_title', "Diagnostics");
t('deployment.connection.url_protocol_error', "L'URL doit utiliser http ou https");
t('deployment.connection.url_hostname_error', "L'URL ne contient pas de nom d'hôte");
t('deployment.connection.url_invalid', "URL invalide");

// deployment.deployments_panel
t('deployment.deployments_panel.deploy_persona', "Déployer le persona");
t('deployment.deployments_panel.select_persona', "Sélectionnez un persona à déployer");
t('deployment.deployments_panel.all_deployed', "Tous les personas sont déjà déployés");

// deployment.exec_detail
t('deployment.exec_detail.fetching_output', "Récupération de la sortie...");
t('deployment.exec_detail.no_output', "Aucune sortie");

// deployment.oauth_panel
t('deployment.oauth_panel.connect_anthropic', "Connecter le compte Anthropic");
t('deployment.oauth_panel.open_auth_instruction', "Ouvrez la page d'authentification, connectez-vous et collez le code ci-dessous.");
t('deployment.oauth_panel.paste_code', "Coller le code d'autorisation");
t('deployment.oauth_panel.refresh_auth_link', "Actualiser le lien d'authentification");
t('deployment.oauth_panel.token_connected', "Jeton connecté");
t('deployment.oauth_panel.token_expired', "Jeton expiré");
t('deployment.oauth_panel.token_unknown', "Statut du jeton inconnu");
t('deployment.oauth_panel.expires', "Expire");
t('deployment.oauth_panel.scopes', "Portées");

// deployment.trigger_form
t('deployment.trigger_form.new_cloud_trigger', "Nouveau déclencheur cloud");
t('deployment.trigger_form.persona_must_be_deployed', "Persona (doit être déployé)");
t('deployment.trigger_form.select_persona', "Sélectionnez un persona");
t('deployment.trigger_form.trigger_type', "Type de déclencheur");
t('deployment.trigger_form.schedule_cron', "Planification (cron)");
t('deployment.trigger_form.create_trigger', "Créer le déclencheur");
t('deployment.trigger_form.creating', "Création...");

// deployment.chart
t('deployment.chart.daily_executions', "Exécutions quotidiennes");

// deployment.deploy_card
t('deployment.deploy_card.test_deployment', "Tester le déploiement");
t('deployment.deploy_card.pause_deployment', "Suspendre le déploiement");
t('deployment.deploy_card.resume_deployment', "Reprendre le déploiement");
t('deployment.deploy_card.remove_deployment', "Supprimer le déploiement");
t('deployment.deploy_card.copy_endpoint', "Copier le point de terminaison");
t('deployment.deploy_card.open_endpoint', "Ouvrir le point de terminaison");

// deployment.schedules
t('deployment.schedules.recent_firings', "Déclenchements récents");
t('deployment.schedules.no_firings', "Aucun déclenchement récent");

// deployment.dashboard
t('deployment.dashboard.title', "Déploiements");
t('deployment.dashboard.subtitle', "Tous les déploiements cloud et GitLab");
t('deployment.dashboard.refresh', "Actualiser");
t('deployment.dashboard.total', "Total");
t('deployment.dashboard.active', "Actif");
t('deployment.dashboard.paused', "Suspendu");
t('deployment.dashboard.cloud', "Cloud");
t('deployment.dashboard.gitlab', "GitLab");
t('deployment.dashboard.col_name', "Nom");
t('deployment.dashboard.col_target', "Cible");
t('deployment.dashboard.col_status', "Statut");
t('deployment.dashboard.col_invocations', "Invocations");
t('deployment.dashboard.col_health', "Santé (7j)");
t('deployment.dashboard.col_last_activity', "Dernière activité");
t('deployment.dashboard.col_created', "Créé");
t('deployment.dashboard.col_actions', "Actions");
t('deployment.dashboard.no_targets_title', "Aucune cible de déploiement connectée");
t('deployment.dashboard.no_targets_hint', "Connectez-vous à l'exécution cloud ou à GitLab dans les onglets respectifs pour voir les déploiements ici.");
t('deployment.dashboard.no_match_filters', "Aucun déploiement ne correspond aux filtres");
t('deployment.dashboard.no_deployments', "Aucun déploiement");
t('deployment.dashboard.adjust_filters', "Essayez d'ajuster votre recherche ou vos filtres.");
t('deployment.dashboard.deploy_hint', "Déployez des personas depuis les onglets Cloud ou GitLab.");
t('deployment.dashboard.showing_of', "Affichage de {showing} sur {total} déploiement{plural}");
t('deployment.dashboard.total_invocations', "Invocations totales :");
t('deployment.dashboard.search_placeholder', "Rechercher des déploiements...");
t('deployment.dashboard.filter', "Filtrer");
t('deployment.dashboard.filter_target', "Cible");
t('deployment.dashboard.filter_status', "Statut");
t('deployment.dashboard.filter_all', "Tout");
t('deployment.dashboard.bulk_selected', "{count} sélectionné(s)");
t('deployment.dashboard.bulk_pause', "Suspendre ({count})");
t('deployment.dashboard.bulk_resume', "Reprendre ({count})");
t('deployment.dashboard.bulk_delete_confirm', "Supprimer {count} ?");
t('deployment.dashboard.bulk_delete', "Supprimer ({count})");
t('deployment.dashboard.clear_selection', "Effacer la sélection");
t('deployment.dashboard.test_deployment', "Tester le déploiement");
t('deployment.dashboard.action_pause', "Suspendre");
t('deployment.dashboard.action_resume', "Reprendre");
t('deployment.dashboard.action_undeploy', "Annuler le déploiement");
t('deployment.dashboard.open_gitlab', "Ouvrir dans GitLab");
t('deployment.dashboard.open_endpoint', "Ouvrir le point de terminaison");
t('deployment.dashboard.no_data', "Aucune donnée");
t('deployment.dashboard.success_rate', "Taux de réussite");
t('deployment.dashboard.volume', "Volume");
t('deployment.dashboard.errors', "Erreurs");
t('deployment.dashboard.stage_initializing', "Initialisation");
t('deployment.dashboard.stage_thinking', "Réflexion");
t('deployment.dashboard.stage_tool_calling', "Appel d'outil");
t('deployment.dashboard.stage_processing_result', "Traitement du résultat");
t('deployment.dashboard.stage_generating', "Génération");
t('deployment.dashboard.stage_completed', "Terminé");
t('deployment.dashboard.stage_failed', "Échoué");
t('deployment.dashboard.tool_calls', "{count} appels d'outils");

// deployment misc
t('deployment.cloud_trigger_schedule', "Planifié (Cron)");
t('deployment.cloud_trigger_polling', "Interrogation");
t('deployment.cloud_trigger_webhook', "Webhook");
t('deployment.cloud_trigger_chain', "Chaîne");
t('deployment.cloud_trigger_manual', "Manuel");
t('deployment.cloud_healthy', "Sain");
t('deployment.cron_every_5min', "Toutes les 5 min");
t('deployment.cron_every_15min', "Toutes les 15 min");
t('deployment.cron_every_hour', "Toutes les heures");
t('deployment.cron_every_6hours', "Toutes les 6 heures");
t('deployment.cron_daily_midnight', "Tous les jours à minuit UTC");
t('deployment.cron_daily_9am', "Tous les jours à 9h UTC");
t('deployment.cron_weekdays_9am', "Jours ouvrés à 9h UTC");
t('deployment.cron_weekly_sun', "Hebdomadaire (dim. minuit UTC)");

// sharing
t('sharing.export_title', "Exporter le bundle");
t('sharing.export_subtitle', "Sélectionnez les ressources exposées à inclure dans le bundle .persona signé.");
t('sharing.seal_enclave_title', "Sceller l'enclave");
t('sharing.seal_enclave_subtitle', "Créez une enclave persona scellée cryptographiquement avec des contraintes d'exécution.");
t('sharing.mode_bundle', "Bundle");
t('sharing.mode_enclave', "Enclave");
t('sharing.no_resources_exposed', "Aucune ressource exposée. Exposez d'abord des ressources dans les paramètres réseau.");
t('sharing.select_all', "Tout sélectionner");
t('sharing.deselect_all', "Tout désélectionner");
t('sharing.selected_of_total', "{selected} sur {total} sélectionnés");
t('sharing.cancel', "Annuler");
t('sharing.share_link', "Lien de partage");
t('sharing.creating_link', "Création...");
t('sharing.link_copied', "Lien copié !");
t('sharing.copy_to_clipboard', "Copier dans le presse-papier");
t('sharing.copying', "Copie...");
t('sharing.copied', "Copié !");
t('sharing.export_to_file', "Exporter vers un fichier");
t('sharing.exporting', "Export...");
t('sharing.seal_enclave_btn', "Sceller l'enclave");
t('sharing.sealing', "Scellage...");
t('sharing.enclave_info', "Les enclaves sont scellées cryptographiquement et signées avec votre identité. Le destinataire peut vérifier l'authenticité mais ne peut pas modifier le persona ni extraire les identifiants.");
t('sharing.label_persona', "Persona");
t('sharing.select_persona_placeholder', "Sélectionnez un persona...");
t('sharing.label_max_cost', "Coût maximum (USD)");
t('sharing.label_max_turns', "Nombre maximum de tours");
t('sharing.label_allow_persistence', "Autoriser l'enclave à persister des données sur l'hôte");
t('sharing.import_title', "Importer le bundle");
t('sharing.import_subtitle', "Importez un bundle .persona signé d'un pair de confiance.");
t('sharing.verify_enclave_title', "Vérifier l'enclave");
t('sharing.verify_enclave_subtitle', "Vérifiez une enclave persona scellée d'un créateur de confiance.");
t('sharing.choose_file', "Choisir un fichier");
t('sharing.paste_from_clipboard', "Coller depuis le presse-papier");
t('sharing.share_link_placeholder', "Collez le lien de partage ou l'URL personas://...");
t('sharing.open', "Ouvrir");
t('sharing.import_pick_hint', "Choisissez un fichier, collez des données du presse-papier ou utilisez un lien de partage (lien profond personas://) d'une autre instance Personas.");
t('sharing.verifying_enclave', "Vérification de l'enclave...");
t('sharing.verifying_bundle', "Vérification du bundle...");
t('sharing.importing_resources', "Importation des ressources...");
t('sharing.close', "Fermer");
t('sharing.import_btn', "Importer");
t('sharing.import_anyway', "Importer quand même");
t('sharing.clipboard_empty', "Le presse-papier est vide");
t('sharing.signature_verified', "Signature vérifiée");
t('sharing.signature_mismatch', "Signature non concordante");
t('sharing.unverified_signature', "Signature non vérifiée");
t('sharing.trusted_peer', "Pair de confiance");
t('sharing.unknown_peer', "Pair inconnu");
t('sharing.resources_in_bundle', "{count} ressource{plural} dans le bundle");
t('sharing.conflict', "conflit");
t('sharing.naming_conflicts_detected', "Conflits de nommage détectés");
t('sharing.skip_conflicting', "Ignorer les ressources conflictuelles");
t('sharing.rename_prefix_label', "Préfixe de renommage");
t('sharing.rename_prefix_placeholder', "ex. importé-");
t('sharing.danger_trusted_title', "La signature ne correspond pas à la clé de confiance de ce pair.");
t('sharing.danger_trusted_body', "Le bundle prétend provenir d'un pair connu mais la vérification de signature a échoué. Cela pourrait indiquer une altération. Ne continuez que si vous êtes certain que la source est sûre.");
t('sharing.danger_trusted_confirm', "Je comprends les risques et veux importer ce bundle");
t('sharing.danger_unknown_title', "Ce bundle provient d'un signataire inconnu et ne peut pas être vérifié.");
t('sharing.danger_unknown_body', "Le signataire n'est pas dans votre liste de pairs de confiance, donc la signature ne peut pas être vérifiée. Ajoutez d'abord l'expéditeur comme pair de confiance, ou continuez uniquement si vous faites entièrement confiance à la source.");
t('sharing.danger_unknown_confirm', "Je comprends les risques et veux importer ce bundle non vérifié");
t('sharing.signature_valid', "Signature valide");
t('sharing.invalid_signature', "Signature invalide");
t('sharing.content_intact', "Contenu intact");
t('sharing.content_tampered', "Contenu altéré");
t('sharing.trusted_creator', "Créateur de confiance");
t('sharing.unknown_creator', "Créateur inconnu");
t('sharing.creator_identity', "Identité du créateur");
t('sharing.execution_policy', "Politique d'exécution");
t('sharing.max_cost_label', "Coût max :");
t('sharing.max_turns_label', "Tours max :");
t('sharing.persistence_label', "Persistance :");
t('sharing.persistence_allowed', "Autorisée");
t('sharing.persistence_denied', "Refusée");
t('sharing.capabilities_label', "Capacités :");
t('sharing.capabilities_none', "Aucune");
t('sharing.network_sharing_title', "Réseau et partage");
t('sharing.network_sharing_subtitle', "Gérez votre identité, vos pairs de confiance et vos ressources partagées");
t('sharing.exposed_resources', "Ressources exposées");
t('sharing.expose_resource', "Exposer une ressource");
t('sharing.loading_exposed', "Chargement des ressources exposées...");
t('sharing.no_resources_hint', "Aucune ressource exposée. Exposez des personas ou d'autres ressources pour les inclure dans des bundles.");
t('sharing.resource_type_label', "Type de ressource");
t('sharing.access_level_label', "Niveau d'accès");
t('sharing.resource_label', "Ressource");
t('sharing.resource_id_placeholder', "ID de ressource");
t('sharing.tags_label', "Tags (séparés par des virgules, optionnel)");
t('sharing.tags_placeholder', "ex. automatisation, devops");
t('sharing.fields_exposed', "{count} champ{plural} exposé{plural}");
t('sharing.your_identity', "Votre identité");
t('sharing.peer_id_label', "ID du pair");
t('sharing.copy_identity_card', "Copier la carte d'identité");
t('sharing.display_name_label', "Nom d'affichage");
t('sharing.save', "Enregistrer");
t('sharing.edit', "Modifier");
t('sharing.loading_identity', "Chargement de l'identité...");
t('sharing.trusted_peers', "Pairs de confiance");
t('sharing.add_peer', "Ajouter un pair");
t('sharing.paste_identity_card', "Coller la carte d'identité");
t('sharing.paste_card_placeholder', "Collez la carte d'identité en base64 ici...");
t('sharing.notes_placeholder', "Notes (optionnel)");
t('sharing.add_trusted_peer', "Ajouter un pair de confiance");
t('sharing.no_trusted_peers', "Aucun pair de confiance. Partagez votre carte d'identité avec d'autres pour commencer.");
t('sharing.import_complete', "Importation terminée");
t('sharing.resources_imported', "{count} ressource{plural} importée{plural}");
t('sharing.skipped_conflicts', "{count} ignoré(s) (conflits)");
t('sharing.confirm', "Confirmer");
t('sharing.scope_none_label', "Aucun accès réseau");
t('sharing.scope_none_desc', "Ce persona ne nécessite pas d'accès réseau externe.");
t('sharing.scope_restricted_label', "Domaines connus uniquement");
t('sharing.scope_restricted_desc', "Ce persona accède à des services externes spécifiques.");
t('sharing.scope_unrestricted_label', "Accès illimité");
t('sharing.scope_unrestricted_desc', "Ce persona peut accéder à n'importe quel point de terminaison externe.");
t('sharing.domains', "Domaines");
t('sharing.integrations', "Intégrations");
t('sharing.api_endpoints', "Points de terminaison API");
t('sharing.network_status', "Statut réseau");
t('sharing.checking_network', "Vérification du statut réseau...");
t('sharing.status_online', "En ligne");
t('sharing.status_offline', "Hors ligne");
t('sharing.stat_status', "Statut");
t('sharing.stat_port', "Port");
t('sharing.stat_discovered', "Découvert");
t('sharing.stat_connected', "Connecté");
t('sharing.disconnect', "Déconnecter");
t('sharing.connect', "Connecter");
t('sharing.view_details', "Voir les détails");
t('sharing.peer_info', "Infos du pair");
t('sharing.trust_label', "Confiance");
t('sharing.trusted', "De confiance");
t('sharing.unknown', "Inconnu");
t('sharing.first_seen', "Première vue");
t('sharing.last_seen', "Dernière vue");
t('sharing.address', "Adresse");
t('sharing.shared_resources', "Ressources partagées");
t('sharing.sync_manifest', "Synchroniser le manifeste");
t('sharing.no_shared_resources', "Aucune ressource partagée. Synchronisez le manifeste pour vérifier.");
t('sharing.discovered_peers', "Pairs découverts");
t('sharing.refresh', "Actualiser");
t('sharing.scanning_network', "Analyse du réseau local...");
t('sharing.lan_hint', "Les autres instances de Personas sur le même réseau local apparaîtront ici automatiquement.");
t('sharing.message_throughput', "Débit des messages");
t('sharing.sent', "Envoyés");
t('sharing.received', "Reçus");
t('sharing.dropped_buffer_full', "Supprimés (tampon plein)");
t('sharing.rate_limited', "Débit limité");
t('sharing.connection_lifecycle', "Cycle de vie de la connexion");
t('sharing.attempts', "Tentatives");
t('sharing.established', "Établie");
t('sharing.avg_connect_time', "Temps de connexion moyen");
t('sharing.disconnects', "Déconnexions");
t('sharing.rejected_capacity', "Rejetés (capacité)");
t('sharing.manifest_sync', "Synchronisation du manifeste");
t('sharing.sync_rounds', "Cycles de synchronisation");
t('sharing.success_fail', "Succès / Échec");
t('sharing.avg_sync_duration', "Durée de synchronisation moyenne");
t('sharing.entries_received', "Entrées reçues");

// overview.observability
t('overview.observability.title', "Observabilité");
t('overview.observability.subtitle', "Surveillez la santé des exécutions, les coûts et les anomalies de tous vos agents");
t('overview.observability.alert_rules', "Règles d'alerte");
t('overview.observability.refresh_metrics', "Actualiser les métriques");

// overview.workflows
t('overview.workflows.title', "Workflows");
t('overview.workflows.subtitle', "Opérations d'arrière-plan actives et récentes dans votre espace de travail");
t('overview.workflows.no_jobs', "Aucune tâche d'arrière-plan en cours ou récente");
t('overview.workflows.jobs_hint', "Les tâches apparaissent ici lors des transformations N8n, des adoptions de modèles, des générations de modèles ou du débogage de requêtes");
t('overview.workflows.all_types', "Tous les types");
t('overview.workflows.no_filter_match', "Aucune tâche ne correspond aux filtres actuels");
t('overview.workflows.auto_refreshing', "Actualisation automatique pendant l'exécution des tâches");
t('overview.workflows.cancel_failed', "Échec de l'annulation de la tâche de workflow");

// overview.dashboard
t('overview.dashboard.title', "Tableau de bord");
t('overview.dashboard.subtitle', "Vue d'ensemble opérationnelle et état du système");
t('overview.dashboard.greeting_morning', "Bonjour");
t('overview.dashboard.greeting_afternoon', "Bon après-midi");
t('overview.dashboard.greeting_evening', "Bonsoir");
t('overview.dashboard.default_user', "Opérateur");
t('overview.dashboard.pending_reviews_prompt', "révisions en attente");
t('overview.dashboard.requiring_attention', "nécessitant votre attention.");
t('overview.dashboard.empty_cta', "Créez votre premier agent pour commencer.");
t('overview.dashboard.pipeline_failed', "Échec du chargement de {source}");
t('overview.dashboard.empty_title', "Bienvenue dans Personas");
t('overview.dashboard.empty_subtitle', "Créez votre premier agent pour commencer à voir les métriques d'exécution, les graphiques de trafic et l'activité ici.");
t('overview.dashboard.create_persona', "Créer un persona");
t('overview.dashboard.from_templates', "Depuis les modèles");

// overview.execution_metrics
t('overview.execution_metrics.title', "Métriques d'exécution");
t('overview.execution_metrics.total_executions', "Exécutions totales");
t('overview.execution_metrics.total_cost', "Coût total");
t('overview.execution_metrics.success_rate', "Taux de réussite");
t('overview.execution_metrics.avg_latency', "Latence moyenne");
t('overview.execution_metrics.cost_anomalies', "Anomalies de coût détectées");
t('overview.execution_metrics.no_data', "Aucune donnée d'exécution pour la période sélectionnée");
t('overview.execution_metrics.cost_per_day', "Coût par jour");
t('overview.execution_metrics.executions_by_status', "Exécutions par statut");
t('overview.execution_metrics.success_rate_trend', "Tendance du taux de réussite");
t('overview.execution_metrics.latency_distribution', "Distribution de la latence (p50 / p95 / p99)");
t('overview.execution_metrics.top_personas_by_cost', "Meilleurs personas par coût");
t('overview.execution_metrics.cost_spike', "Pic de coût");
t('overview.execution_metrics.above_avg', "au-dessus de la moyenne");
t('overview.execution_metrics.top_executions', "Meilleures exécutions :");
t('overview.execution_metrics.executions_label', "{count} exécutions");

// overview.execution_list
t('overview.execution_list.recorded', "{count} exécutions enregistrées");
t('overview.execution_list.recorded_one', "{count} exécution enregistrée");
t('overview.execution_list.list', "Liste");
t('overview.execution_list.metrics', "Métriques");
t('overview.execution_list.show_list', "Afficher la liste des exécutions");
t('overview.execution_list.show_metrics', "Afficher le tableau de bord des métriques");
t('overview.execution_list.showing', "Affichage de {count} sur {total}");
t('overview.execution_list.load_more', "Charger plus");
t('overview.execution_list.filter_all', "Tout");
t('overview.execution_list.filter_running', "En cours");
t('overview.execution_list.filter_completed', "Terminé");
t('overview.execution_list.filter_failed', "Échoué");
t('overview.execution_list.col_persona', "Persona");
t('overview.execution_list.col_status', "Statut");
t('overview.execution_list.col_duration', "Durée");
t('overview.execution_list.col_started', "Démarré");
t('overview.execution_list.col_id', "ID");
t('overview.execution_list.all_statuses', "Tous les statuts");
t('overview.execution_list.all_personas', "Tous les personas");
t('overview.execution_list.no_agents', "Aucun agent créé");
t('overview.execution_list.no_agents_hint', "Créez votre premier agent pour voir l'activité d'exécution ici.");
t('overview.execution_list.unknown_persona', "Inconnu");
t('overview.execution_list.healing_retry', "Nouvelle tentative de guérison #{count}");

// overview.review
t('overview.review.title', "Révisions manuelles");
t('overview.review.subtitle', "{count} révisions");
t('overview.review.pending_count', "{count} en attente");
t('overview.review.cloud_count', "{count} cloud");
t('overview.review.mock_review', "Révision fictive");
t('overview.review.seed_tooltip', "Initialiser une révision fictive (développement uniquement)");
t('overview.review.empty_title', "Aucune révision en attente");
t('overview.review.empty_subtitle', "Les éléments nécessitant une approbation apparaîtront ici lorsque les agents demandent une révision humaine.");
t('overview.review.filter_all', "Tout");
t('overview.review.filter_pending', "En attente");
t('overview.review.filter_approved', "Approuvé");
t('overview.review.filter_rejected', "Rejeté");
t('overview.review.source_all', "Tout");
t('overview.review.source_local', "Local");
t('overview.review.source_cloud', "Cloud");
t('overview.review.approve', "Approuver");
t('overview.review.reject', "Rejeter");
t('overview.review.approve_all', "Tout approuver");
t('overview.review.reject_all', "Tout rejeter");
t('overview.review.accept', "Accepter");
t('overview.review.accept_all', "Tout accepter");
t('overview.review.reject_all_items', "Tout rejeter");
t('overview.review.processing', "Traitement...");
t('overview.review.deselect', "Désélectionner");
t('overview.review.select_all', "Tout sélectionner");
t('overview.review.confirm_bulk', "{count} révisions ?");
t('overview.review.confirm_bulk_one', "{count} révision ?");
t('overview.review.pending_selected', "révisions en attente sélectionnées");
t('overview.review.pending_selected_one', "révision en attente sélectionnée");
t('overview.review.unknown_persona', "Persona inconnu");
t('overview.review.severity_label', "gravité");
t('overview.review.cloud_badge', "Cloud");
t('overview.review.execution_link', "Exécution");
t('overview.review.context_label', "Contexte");
t('overview.review.you', "Vous");
t('overview.review.agent', "Agent");
t('overview.review.review_status', "Révision {status}");
t('overview.review.decisions_label', "Décisions");
t('overview.review.decisions_count', "({count} éléments)");
t('overview.review.accepted_label', "accepté");
t('overview.review.rejected_label', "rejeté");
t('overview.review.undecided_label', "indécis");
t('overview.review.reply_placeholder', "Répondre à cette révision...");
t('overview.review.cloud_reply_placeholder', "Message de réponse (optionnel)...");
t('overview.review.cloud_action_hint', "Approuvez ou rejetez cette révision cloud");
t('overview.review.reply_hint', "Entrée pour envoyer — Maj+Entrée pour nouvelle ligne");
t('overview.review.send_message', "Envoyer le message");
t('overview.review.approve_with_count', "Approuver ({accepted}/{total})");
t('overview.review.all_caught_up', "Tout est à jour ! Aucune révision en attente.");
t('overview.review.queue_label', "File d'attente");
t('overview.review.select_action', "Sélectionner une action");
t('overview.review.required', "(requis)");
t('overview.review.add_notes', "Ajouter des notes");
t('overview.review.notes_placeholder', "Ajouter des notes de révision...");
t('overview.review.select_action_first', "Sélectionnez d'abord une action suggérée");
t('overview.review.split', "Fractionner");
t('overview.review.table', "Tableau");
t('overview.review.split_tooltip', "Vue fractionnée avec chat");
t('overview.review.table_tooltip', "Tableau uniquement");
t('overview.review.review_detail', "Détail de la révision");
t('overview.review.select_review', "Sélectionnez une révision à afficher");
t('overview.review.technical_context', "Contexte technique");

// overview.messages_view
t('overview.messages_view.title', "Messages");
t('overview.messages_view.threads_subtitle', "{count} fils de discussion");
t('overview.messages_view.threads_subtitle_one', "{count} fil de discussion");
t('overview.messages_view.messages_subtitle', "{count} messages enregistrés");
t('overview.messages_view.messages_subtitle_one', "{count} message enregistré");
t('overview.messages_view.mock_message', "Message fictif");
t('overview.messages_view.seed_tooltip', "Initialiser un message fictif (développement uniquement)");
t('overview.messages_view.flat_view', "Vue plate");
t('overview.messages_view.threaded_view', "Vue en fils");
t('overview.messages_view.mark_all_read', "Marquer tout comme lu");
t('overview.messages_view.threads_of', "{count} sur {total} fils");
t('overview.messages_view.no_threads', "Aucun fil de discussion");
t('overview.messages_view.no_threads_hint', "Les fils sont créés automatiquement lorsque les agents produisent des messages lors des exécutions.");
t('overview.messages_view.no_messages', "Aucun message");
t('overview.messages_view.no_messages_hint', "Les messages sont créés lorsque les agents s'exécutent et communiquent entre eux.");
t('overview.messages_view.no_filter_match', "Aucun message ne correspond aux filtres actuels");
t('overview.messages_view.loading_replies', "Chargement des réponses...");
t('overview.messages_view.load_more', "Charger plus ({count} restants)");
t('overview.messages_view.col_title', "Titre");
t('overview.messages_view.col_priority', "Priorité");
t('overview.messages_view.col_delivery', "Livraison");
t('overview.messages_view.col_status', "Statut");
t('overview.messages_view.col_created', "Créé");
t('overview.messages_view.all_priorities', "Toutes les priorités");
t('overview.messages_view.all_statuses', "Tous les statuts");
t('overview.messages_view.read', "Lu");
t('overview.messages_view.unread', "Non lu");
t('overview.messages_view.new_badge', "Nouveau");
t('overview.messages_view.failed_count', "{count} échec(s)");
t('overview.messages_view.pending_count', "{count} en attente");
t('overview.messages_view.sent_count', "{count} envoyé(s)");
t('overview.messages_view.message_label', "Message");
t('overview.messages_view.from_label', "De {name}");
t('overview.messages_view.content_label', "Contenu");
t('overview.messages_view.view_execution', "Voir l'exécution");
t('overview.messages_view.type_label', "Type :");
t('overview.messages_view.delivery_status', "Statut de livraison");
t('overview.messages_view.no_channels', "Aucun canal de livraison configuré");
t('overview.messages_view.confirm_delete', "Confirmer la suppression");
t('overview.messages_view.improve_agent', "Améliorer l'agent");
t('overview.messages_view.improvement_started', "Amélioration démarrée — vous serez notifié quand c'est terminé");
t('overview.messages_view.what_could_be_better', "Qu'est-ce qui pourrait être amélioré ?");
t('overview.messages_view.improve_placeholder', "Décrivez comment cette sortie pourrait être améliorée...");
t('overview.messages_view.submit_improvement', "Soumettre l'amélioration");
t('overview.messages_view.starting', "Démarrage...");
t('overview.messages_view.unknown_persona', "Inconnu");

// overview.events
t('overview.events.title', "Événements");
t('overview.events.subtitle', "{filtered} sur {total} événements");
t('overview.events.subtitle_one', "{filtered} sur {total} événement");
t('overview.events.mock_event', "Événement fictif");
t('overview.events.seed_tooltip', "Initialiser un événement fictif (développement uniquement)");
t('overview.events.search_placeholder', "Rechercher des événements par type, source ou charge utile...");
t('overview.events.loading_older', "Chargement des événements plus anciens...");
t('overview.events.load_older', "Charger les événements plus anciens");
t('overview.events.no_events', "Aucun événement");
t('overview.events.no_events_hint', "Les événements des webhooks, exécutions et actions de personas apparaîtront ici au fur et à mesure de l'exécution de vos agents.");
t('overview.events.no_filter_match', "Aucun événement ne correspond aux filtres actuels");
t('overview.events.save_view', "Enregistrer la vue");
t('overview.events.view_name_placeholder', "Nom de la vue (ex. 'Webhooks échoués cette semaine')");
t('overview.events.views_label', "Vues :");
t('overview.events.delete_view', "Supprimer la vue");
t('overview.events.clear_filters', "Effacer tous les filtres");
t('overview.events.col_trigger', "Déclencheur");
t('overview.events.col_persona', "Persona");
t('overview.events.col_event_name', "Nom de l'événement");
t('overview.events.col_status', "Statut");
t('overview.events.col_created', "Créé");
t('overview.events.all_statuses', "Tous les statuts");
t('overview.events.all_types', "Tous les types");
t('overview.events.all_triggers', "Tous les déclencheurs");
t('overview.events.source_event', "Événement");
t('overview.events.source_manual', "Manuel");
t('overview.events.source_system', "Système");
t('overview.events.source_scheduled', "Planifié");
t('overview.events.event_detail_title', "Événement :");
t('overview.events.event_detail_status', "Statut :");
t('overview.events.event_id', "ID de l'événement");
t('overview.events.project', "Projet");
t('overview.events.source', "Source");
t('overview.events.processed', "Traité");
t('overview.events.event_data', "Données de l'événement");
t('overview.events.error', "Erreur");

// overview.health
t('overview.health.title', "Santé des agents");
t('overview.health.subtitle', "Surveillance de la santé en temps réel de tous les agents");
t('overview.health.all_healthy', "Tous les agents sont sains");
t('overview.health.all_healthy_hint', "Chaque agent surveillé fonctionne normalement");
t('overview.health.no_agents', "Aucun agent");
t('overview.health.no_agents_hint', "Créez des agents pour commencer à surveiller leur santé");
t('overview.health.success_rate', "Taux de réussite");
t('overview.health.avg_latency', "Latence moyenne");
t('overview.health.executions', "Exécutions");
t('overview.health.last_execution', "Dernière exécution");
t('overview.health.never_executed', "Jamais");
t('overview.health.cost', "Coût");
t('overview.health.healthy', "Sain");
t('overview.health.warning', "Avertissement");
t('overview.health.critical', "Critique");
t('overview.health.unknown', "Inconnu");
t('overview.health.burn_rate', "Projection du taux de consommation");
t('overview.health.monthly_budget', "Budget mensuel");
t('overview.health.current_burn', "Consommation actuelle");
t('overview.health.projected', "Projeté");
t('overview.health.days_remaining', "Jours restants");
t('overview.health.cascade_title', "Analyse en cascade");
t('overview.health.predictive_alerts', "Alertes prédictives");
t('overview.health.no_alerts', "Aucune alerte prédictive pour le moment");
t('overview.health.status_page', "Page de statut");
t('overview.health.operational', "Opérationnel");
t('overview.health.degraded', "Dégradé");
t('overview.health.outage', "Panne");

// overview.leaderboard
t('overview.leaderboard.title', "Classement des agents");
t('overview.leaderboard.subtitle', "Classement des performances de tous les agents");
t('overview.leaderboard.no_data', "Aucune donnée de classement disponible");
t('overview.leaderboard.no_data_hint', "Exécutez vos agents pour commencer à construire des classements de performance");
t('overview.leaderboard.reliability', "Fiabilité");
t('overview.leaderboard.speed', "Vitesse");
t('overview.leaderboard.efficiency', "Efficacité");
t('overview.leaderboard.cost_effectiveness', "Rapport coût-efficacité");
t('overview.leaderboard.overall', "Général");

// overview.analytics
t('overview.analytics.title', "Analyses");
t('overview.analytics.subtitle', "Tendances et schémas d'exécution");
t('overview.analytics.loading', "Chargement des analyses...");
t('overview.analytics.no_data', "Aucune donnée d'analyse disponible");
t('overview.analytics.executions_over_time', "Exécutions dans le temps");
t('overview.analytics.success_failure', "Succès vs Échec");
t('overview.analytics.cost_breakdown', "Répartition des coûts");
t('overview.analytics.total_executions', "Exécutions totales");
t('overview.analytics.total_cost', "Coût total");
t('overview.analytics.avg_success_rate', "Taux de réussite moyen");
t('overview.analytics.active_agents', "Agents actifs");
t('overview.analytics.saved_views', "Vues enregistrées");
t('overview.analytics.create_view', "Créer une vue");
t('overview.analytics.health_issues', "Problèmes de santé");
t('overview.analytics.rotation_overview', "Vue d'ensemble de la rotation");

// overview.usage
t('overview.usage.title', "Utilisation");
t('overview.usage.subtitle', "Coût et consommation des ressources");
t('overview.usage.chart_error', "Échec du chargement du graphique");
t('overview.usage.chart_error_hint', "Une erreur est survenue lors du rendu de ce graphique");
t('overview.usage.try_again', "Réessayer");

// overview.cron_agents
t('overview.cron_agents.title', "Agents planifiés");
t('overview.cron_agents.subtitle', "Agents s'exécutant selon des planifications automatiques");
t('overview.cron_agents.no_agents', "Aucun agent planifié");
t('overview.cron_agents.no_agents_hint', "Ajoutez un déclencheur cron à n'importe quel agent pour le voir ici");

// overview.timeline
t('overview.timeline.title', "Chronologie des activités");
t('overview.timeline.subtitle', "Vue unifiée de toutes les activités des agents");
t('overview.timeline.no_activity', "Aucune activité récente");

// overview.realtime_viz
t('overview.realtime_viz.title', "Bus d'événements");
t('overview.realtime_viz.filter_events', "Filtrer les événements");
t('overview.realtime_viz.pause', "Pause");
t('overview.realtime_viz.resume', "Reprendre");
t('overview.realtime_viz.clear', "Effacer");
t('overview.realtime_viz.total_events', "Total des événements");
t('overview.realtime_viz.events_per_sec', "Événements/sec");
t('overview.realtime_viz.active_lanes', "Voies actives");
t('overview.realtime_viz.event_type', "Type d'événement");
t('overview.realtime_viz.source', "Source");
t('overview.realtime_viz.target', "Cible");
t('overview.realtime_viz.timestamp', "Horodatage");
t('overview.realtime_viz.payload', "Charge utile");
t('overview.realtime_viz.saved_views', "Vues enregistrées");
t('overview.realtime_viz.save_current', "Enregistrer la vue actuelle");

// overview.observability_extra
t('overview.observability_extra.auto_refresh_on', "Actualisation automatique activée");
t('overview.observability_extra.auto_refresh_off', "Actualisation automatique désactivée");
t('overview.observability_extra.total_cost', "Coût total");
t('overview.observability_extra.executions_label', "Exécutions");
t('overview.observability_extra.success_rate', "Taux de réussite");
t('overview.observability_extra.active_personas', "Personas actifs");
t('overview.observability_extra.system_trace', "Chronologie des traces système");
t('overview.observability_extra.ipc_performance', "Performance IPC");
t('overview.observability_extra.alert_rules_label', "Règles d'alerte");
t('overview.observability_extra.alert_history_label', "Historique des alertes");
t('overview.observability_extra.healing_issues', "Problèmes de santé");
t('overview.observability_extra.run_analysis', "Lancer l'analyse");

// overview.realtime_page
t('overview.realtime_page.pending', "en attente");
t('overview.realtime_page.success', "succès");
t('overview.realtime_page.in_window', "dans la fenêtre");
t('overview.realtime_page.test_flow', "Tester le flux");
t('overview.realtime_page.testing_flow', "Test du flux...");
t('overview.realtime_page.test_event_flow', "Tester le flux d'événements");
t('overview.realtime_page.resume', "Reprendre");
t('overview.realtime_page.pause', "Pause");
t('overview.realtime_page.resume_stream', "Reprendre le flux en temps réel");
t('overview.realtime_page.pause_stream', "Suspendre le flux en temps réel");
t('overview.realtime_page.search_events', "Rechercher des événements...");
t('overview.realtime_page.filter_type', "Type");
t('overview.realtime_page.filter_status', "Statut");
t('overview.realtime_page.filter_source', "Source");
t('overview.realtime_page.filter_agent', "Agent");
t('overview.realtime_page.clear', "Effacer");
t('overview.realtime_page.views', "Vues");
t('overview.realtime_page.no_saved_views', "Aucune vue enregistrée");
t('overview.realtime_page.save_current_filter', "Enregistrer le filtre actuel");
t('overview.realtime_page.view_name_placeholder', "Nom de la vue...");
t('overview.realtime_page.delete_saved_view', "Supprimer la vue enregistrée");
t('overview.realtime_page.event_log', "Journal des événements");
t('overview.realtime_page.entries', "{count} entrées");
t('overview.realtime_page.filter_events', "Filtrer les événements...");
t('overview.realtime_page.no_events', "Aucun événement");
t('overview.realtime_page.open_in_drawer', "Ouvrir dans le volet de détails");
t('overview.realtime_page.event_label', "Événement");
t('overview.realtime_page.status_label', "Statut");
t('overview.realtime_page.source_label', "Source");
t('overview.realtime_page.target_label', "Cible");
t('overview.realtime_page.id_label', "ID");
t('overview.realtime_page.error_label', "Erreur");
t('overview.realtime_page.payload_label', "Charge utile");
t('overview.realtime_page.close_event_details', "Fermer les détails de l'événement");
t('overview.realtime_page.reset_to_start', "Réinitialiser au début");
t('overview.realtime_page.cycle_speed', "Changer la vitesse de lecture");
t('overview.realtime_page.exit_replay', "Quitter la relecture");
t('overview.realtime_page.galaxy', "Galaxie");
t('overview.realtime_page.galaxy_desc', "Constellation orbitale avec traînées de comètes");
t('overview.realtime_page.lanes', "Voies");
t('overview.realtime_page.lanes_desc', "Diagramme de flux en voies horizontales");

// overview.memory_form
t('overview.memory_form.agent', "Agent");
t('overview.memory_form.category', "Catégorie");
t('overview.memory_form.title', "Titre");
t('overview.memory_form.title_placeholder', "ex. Toujours utiliser les unités métriques");
t('overview.memory_form.content', "Contenu");
t('overview.memory_form.content_placeholder', "Décrivez ce dont l'agent doit se souvenir...");
t('overview.memory_form.importance', "Importance");
t('overview.memory_form.tags', "Tags");
t('overview.memory_form.tags_hint', "(séparés par des virgules)");
t('overview.memory_form.tags_placeholder', "ex. unités, formatage, sortie");
t('overview.memory_form.save_memory', "Enregistrer la mémoire");
t('overview.memory_form.saving', "Enregistrement...");
t('overview.memory_form.created_success', "Mémoire créée avec succès");
t('overview.memory_form.fill_required', "Remplissez tous les champs requis pour enregistrer");
t('overview.memory_form.saving_memory', "Enregistrement de la mémoire...");

// overview.memory_filter
t('overview.memory_filter.search_placeholder', "Rechercher des mémoires...");
t('overview.memory_filter.all_agents', "Tous les agents");
t('overview.memory_filter.all_categories', "Toutes les catégories");

// overview.memory_actions
t('overview.memory_actions.dismiss_suggestion', "Ignorer la suggestion");
t('overview.memory_actions.memory_insights', "Insights mémoire");
t('overview.memory_actions.suggestions', "{count} suggestions");
t('overview.memory_actions.suggestions_one', "{count} suggestion");

// overview.memory_conflict
t('overview.memory_conflict.memory_a', "Mémoire A");
t('overview.memory_conflict.memory_b', "Mémoire B");
t('overview.memory_conflict.merge', "Fusionner");
t('overview.memory_conflict.keep', "Conserver");
t('overview.memory_conflict.vs', "vs");

// overview.observability_charts
t('overview.observability_charts.cost_over_time', "Coût dans le temps");
t('overview.observability_charts.executions_by_persona', "Exécutions par persona");
t('overview.observability_charts.execution_health', "Santé des exécutions");
t('overview.observability_charts.successful', "Réussi");
t('overview.observability_charts.failed', "Échoué");
t('overview.observability_charts.anomalies_detected', "{count} anomalies de coût détectées");
t('overview.observability_charts.anomaly_detected', "{count} anomalie de coût détectée");
t('overview.observability_charts.anomaly_click_hint', "Cliquez sur un marqueur diamant sur le graphique pour enquêter");
t('overview.observability_charts.clear_traces', "Effacer les traces terminées");
t('overview.observability_charts.all_operations', "Toutes les opérations");

// overview.health_extra
t('overview.health_extra.success', "Succès");
t('overview.health_extra.burn', "Consommation");
t('overview.health_extra.healing', "Guérison");
t('overview.health_extra.rollbacks', "Retours arrière");
t('overview.health_extra.improving', "En amélioration");
t('overview.health_extra.degrading', "En dégradation");
t('overview.health_extra.stable', "Stable");
t('overview.health_extra.success_pct', "{pct}% de réussite");
t('overview.health_extra.budget_exhaustion', "Épuisement du budget dans");
t('overview.health_extra.exhausted', "épuisé");
t('overview.health_extra.predicted_failure', "Pic d'échecs prédit dans");
t('overview.health_extra.loading_status', "Chargement des données de la page de statut...");
t('overview.health_extra.no_personas', "Aucun persona à afficher.");
t('overview.health_extra.score_label', "Score");
t('overview.health_extra.uptime_30d', "Disponibilité 30j");
t('overview.health_extra.updated', "Mis à jour {time}");
t('overview.health_extra.legend', "Légende :");
t('overview.health_extra.operational', "Opérationnel");
t('overview.health_extra.degraded', "Dégradé");
t('overview.health_extra.outage', "Panne");
t('overview.health_extra.no_data', "Aucune donnée");
t('overview.health_extra.success_rate_label', "Taux de réussite");
t('overview.health_extra.latency_p95', "Latence (p95)");
t('overview.health_extra.cost_anomalies', "Anomalies de coût");
t('overview.health_extra.detected', "{count} détecté(s)");
t('overview.health_extra.healing_issues', "Problèmes de santé");
t('overview.health_extra.open', "{count} ouvert(s)");
t('overview.health_extra.sla_compliance', "Conformité SLA");
t('overview.health_extra.consecutive_failures', "{count} échecs consécutifs");
t('overview.health_extra.consecutive_failure', "{count} échec consécutif");

// overview.system_health
t('overview.system_health.title', "Vérifications du système");
t('overview.system_health.subtitle', "Vérification de la préparation de votre environnement");
t('overview.system_health.re_run_checks', "Relancer les vérifications");
t('overview.system_health.ollama_title', "Clé API Ollama Cloud");
t('overview.system_health.ollama_subtitle', "Optionnel — déverrouille des modèles cloud gratuits (Qwen3 Coder, GLM-5, Kimi K2.5) pour tous les agents.");
t('overview.system_health.litellm_title', "Configuration du proxy LiteLLM");
t('overview.system_health.litellm_subtitle', "Optionnel — routez les agents via votre proxy LiteLLM pour la gestion des modèles et le suivi des coûts.");
t('overview.system_health.save_key', "Enregistrer la clé");
t('overview.system_health.save_configuration', "Enregistrer la configuration");
t('overview.system_health.litellm_footer', "Ces paramètres sont stockés localement et partagés par tous les agents configurés pour utiliser le fournisseur LiteLLM.");
t('overview.system_health.ipc_error', "Le pont applicatif ne répond pas. Essayez de redémarrer l'application. Vous pouvez continuer à explorer l'interface.");
t('overview.system_health.issues_warning', "Certaines vérifications ont signalé des problèmes. Vous pouvez continuer, mais certaines fonctionnalités peuvent ne pas fonctionner correctement.");

// overview.review_extra
t('overview.review_extra.add_note', "Ajouter une note (optionnel)...");
t('overview.review_extra.confirm', "Confirmer");
t('overview.review_extra.processing', "Traitement...");
t('overview.review_extra.clear_verdicts', "Effacer tous les verdicts");
t('overview.review_extra.retry_with_changes', "Réessayer avec des modifications");
t('overview.review_extra.reject_all', "Tout rejeter");
t('overview.review_extra.quick_actions', "Actions rapides");
t('overview.review_extra.accepted', "{count} accepté(s)");
t('overview.review_extra.rejected', "{count} rejeté(s)");
t('overview.review_extra.undecided', "{count} indécis");

// overview.widgets_extra
t('overview.widgets_extra.execution_health_chart', "Santé des exécutions");
t('overview.widgets_extra.cost_over_time_chart', "Coût dans le temps");
t('overview.widgets_extra.successful', "Réussi");
t('overview.widgets_extra.failed', "Échoué");
t('overview.widgets_extra.close', "Fermer");
t('overview.widgets_extra.dismiss_help', "Ignorer l'aide");
t('overview.widgets_extra.skip_tour', "Ignorer entièrement la visite guidée");

// overview.remote_control_card
t('overview.remote_control_card.connect_to_desktop', "Connecter au bureau");
t('overview.remote_control_card.connect_description', "Exécutez des agents en utilisant votre CLI de bureau via le contrôle à distance. Démarrez {command} sur votre ordinateur, puis connectez-vous ici.");
t('overview.remote_control_card.requires_subscription', "Nécessite un abonnement Claude Pro ou Max");

// overview.resume_setup_card
t('overview.resume_setup_card.resume_tour', "Reprendre la visite guidée");
t('overview.resume_setup_card.left_off_at', "Vous vous êtes arrêté à");
t('overview.resume_setup_card.steps_completed', "{completed}/{total} étapes terminées");
t('overview.resume_setup_card.skip_tour', "Ignorer entièrement la visite guidée");
t('overview.resume_setup_card.continue_label', "Continuer");

// overview.detail_modal
t('overview.detail_modal.close', "Fermer");

// overview.metric_help_popover
t('overview.metric_help_popover.help_for', "Aide pour {label}");
t('overview.metric_help_popover.dismiss_help', "Ignorer l'aide");
t('overview.metric_help_popover.healthy', "Sain :");
t('overview.metric_help_popover.click', "Cliquer :");
t('overview.metric_help_popover.got_it', "Compris, ne plus afficher");

// overview.install_button
t('overview.install_button.install_node', "Installer Node.js");
t('overview.install_button.install_cli', "Installer Claude CLI");
t('overview.install_button.downloading', "Téléchargement...");
t('overview.install_button.installing', "Installation...");
t('overview.install_button.installed_success', "Installé avec succès");
t('overview.install_button.installation_failed', "Échec de l'installation");
t('overview.install_button.try_manually', "Essayez manuellement :");
t('overview.install_button.retry', "Réessayer");
t('overview.install_button.official_page', "Page officielle");

// overview.section_card
t('overview.section_card.checking', "Vérification de {section}...");
t('overview.section_card.edit_key', "Modifier la clé");
t('overview.section_card.configure', "Configurer");
t('overview.section_card.edit_config', "Modifier la configuration");
t('overview.section_card.signing_in', "Connexion...");
t('overview.section_card.sign_in_google', "Se connecter avec Google");
t('overview.section_card.working', "En cours...");
t('overview.section_card.connect_claude', "Connecter à Claude Desktop");
t('overview.section_card.disconnect', "Déconnecter");

// overview.metrics_cards
t('overview.metrics_cards.cost_spike', "Pic de coût");
t('overview.metrics_cards.above_avg', "au-dessus de la moyenne");
t('overview.metrics_cards.top_executions', "Meilleures exécutions :");

// overview.event_log_item
t('overview.event_log_item.event_id', "ID de l'événement");
t('overview.event_log_item.project', "Projet");
t('overview.event_log_item.source', "Source");
t('overview.event_log_item.processed', "Traité");
t('overview.event_log_item.event_data', "Données de l'événement");
t('overview.event_log_item.copy_event_data', "Copier les données de l'événement");
t('overview.event_log_item.copied', "Copié");
t('overview.event_log_item.copy', "Copier");
t('overview.event_log_item.error', "Erreur");
t('overview.event_log_item.system', "Système");

// overview.burn_rate_extra
t('overview.burn_rate_extra.title', "Projections du taux de consommation");
t('overview.burn_rate_extra.daily_burn', "Consommation quotidienne");
t('overview.burn_rate_extra.projected_monthly', "Projection mensuelle");
t('overview.burn_rate_extra.at_risk', "À risque");
t('overview.burn_rate_extra.top_cost_drivers', "Principaux facteurs de coût");
t('overview.burn_rate_extra.budget_exhaustion_warnings', "Avertissements d'épuisement du budget");
t('overview.burn_rate_extra.exhausted', "Épuisé");
t('overview.burn_rate_extra.days_left', "{days}j restants");

// overview.cascade
t('overview.cascade.title', "Carte de cascade en chaîne");
t('overview.cascade.no_chains', "Aucune chaîne détectée — tous les personas fonctionnent indépendamment");

// overview.predictive_alerts_extra
t('overview.predictive_alerts_extra.title', "Alertes prédictives");
t('overview.predictive_alerts_extra.all_nominal', "Tous les systèmes nominaux");
t('overview.predictive_alerts_extra.no_alerts', "Aucune alerte prédictive — tous les personas dans des paramètres sains.");
t('overview.predictive_alerts_extra.budget_exhausted', "Budget épuisé");
t('overview.predictive_alerts_extra.budget_exhaustion_in', "Épuisement du budget dans {days}j");
t('overview.predictive_alerts_extra.failure_spike_predicted', "Pic de taux d'échec prédit dans {days}j");
t('overview.predictive_alerts_extra.excessive_healing', "Activité d'auto-guérison excessive");
t('overview.predictive_alerts_extra.critical_health', "Statut de santé critique");
t('overview.predictive_alerts_extra.byom_recommendations', "Recommandations de routage BYOM");

// overview.annotate_modal
t('overview.annotate_modal.title', "Ajouter une annotation de connaissance");
t('overview.annotate_modal.persona_label', "Persona d'attribution");
t('overview.annotate_modal.scope_label', "Portée");
t('overview.annotate_modal.tool_name', "Nom de l'outil");
t('overview.annotate_modal.connector_type', "Type de connecteur / service");
t('overview.annotate_modal.annotation_label', "Annotation");
t('overview.annotate_modal.cancel', "Annuler");
t('overview.annotate_modal.saving', "Enregistrement...");
t('overview.annotate_modal.save_annotation', "Enregistrer l'annotation");

// overview.knowledge_row
t('overview.knowledge_row.annotation', "Annotation");
t('overview.knowledge_row.successes', "Succès");
t('overview.knowledge_row.failures', "Échecs");
t('overview.knowledge_row.avg_cost', "Coût moyen");
t('overview.knowledge_row.avg_duration', "Durée moyenne");
t('overview.knowledge_row.pattern_data', "Données de schéma");
t('overview.knowledge_row.collapse_details', "Réduire les détails");
t('overview.knowledge_row.expand_details', "Développer les détails");
t('overview.knowledge_row.verify_annotation', "Vérifier l'annotation");
t('overview.knowledge_row.dismiss_annotation', "Ignorer l'annotation");

// overview.focused_decision
t('overview.focused_decision.accept', "Accepter");
t('overview.focused_decision.reject', "Rejeter");
t('overview.focused_decision.media_unavailable', "Média non disponible");

// overview.review_focus
t('overview.review_focus.all_caught_up', "Tout est à jour");
t('overview.review_focus.no_pending', "Aucune révision en attente.");
t('overview.review_focus.queue', "File d'attente");
t('overview.review_focus.clear', "Effacer");
t('overview.review_focus.clear_all_verdicts', "Effacer tous les verdicts");
t('overview.review_focus.quick_actions', "Actions rapides");
t('overview.review_focus.reject_all', "Tout rejeter");
t('overview.review_focus.accept_all', "Tout accepter");
t('overview.review_focus.retry_with_changes', "Réessayer avec des modifications");

// overview.memory_card
t('overview.memory_card.confirm', "Confirmer");
t('overview.memory_card.cancel', "Annuler");

// overview.memory_detail
t('overview.memory_detail.title_label', "Titre");
t('overview.memory_detail.content_label', "Contenu");
t('overview.memory_detail.category_label', "Catégorie");
t('overview.memory_detail.importance_label', "Importance");
t('overview.memory_detail.tags_label', "Tags");
t('overview.memory_detail.view_source_execution', "Voir l'exécution source");
t('overview.memory_detail.delete_memory', "Supprimer la mémoire");
t('overview.memory_detail.close', "Fermer");

// overview.memory_table
t('overview.memory_table.agent', "Agent");
t('overview.memory_table.title', "Titre");
t('overview.memory_table.category', "Catégorie");
t('overview.memory_table.priority', "Priorité");
t('overview.memory_table.tags', "Tags");
t('overview.memory_table.created', "Créé");

// overview.review_results
t('overview.review_results.title', "Révision IA des mémoires");
t('overview.review_results.review_failed', "Échec de la révision");

// overview.anomaly_drilldown_extra
t('overview.anomaly_drilldown_extra.title', "Analyse approfondie des anomalies");
t('overview.anomaly_drilldown_extra.value_label', "Valeur :");
t('overview.anomaly_drilldown_extra.baseline_label', "Référence :");
t('overview.anomaly_drilldown_extra.correlating', "Corrélation des événements...");
t('overview.anomaly_drilldown_extra.likely_root_causes', "Causes probables");
t('overview.anomaly_drilldown_extra.correlated_events', "Événements corrélés");
t('overview.anomaly_drilldown_extra.no_correlated', "Aucun événement corrélé dans la fenêtre ±24h.");

// overview.healing_issue_modal
t('overview.healing_issue_modal.issue_resolved', "Problème résolu");
t('overview.healing_issue_modal.analysis', "Analyse");
t('overview.healing_issue_modal.suggested_fix', "Correction suggérée");
t('overview.healing_issue_modal.copied', "Copié");
t('overview.healing_issue_modal.copy_fix', "Copier la correction");
t('overview.healing_issue_modal.persona_auto_disabled', "Persona désactivé automatiquement");
t('overview.healing_issue_modal.persona_auto_disabled_desc', "Ce persona a été automatiquement désactivé après 5 échecs consécutifs. Examinez le schéma d'erreur ci-dessous et réactivez manuellement une fois la cause principale résolue.");
t('overview.healing_issue_modal.marking_resolved_note', "Marquer comme résolu signifie que vous avez traité ce problème en dehors du système de guérison.");
t('overview.healing_issue_modal.retry_in_progress', "Nouvelle tentative en cours — le statut sera mis à jour à la fin");
t('overview.healing_issue_modal.auto_resolved', "Ce problème a été résolu automatiquement");
t('overview.healing_issue_modal.close', "Fermer");
t('overview.healing_issue_modal.resolving', "Résolution…");
t('overview.healing_issue_modal.mark_resolved', "Marquer comme résolu");

// overview.healing_issues_panel
t('overview.healing_issues_panel.title', "Problèmes de santé");
t('overview.healing_issues_panel.analyzing', "Analyse...");
t('overview.healing_issues_panel.run_analysis', "Lancer l'analyse");
t('overview.healing_issues_panel.no_open_issues', "Aucun problème ouvert");
t('overview.healing_issues_panel.run_analysis_hint', "Lancez l'analyse pour vérifier les problèmes.");
t('overview.healing_issues_panel.healing_audit_log', "Journal d'audit de guérison");
t('overview.healing_issues_panel.no_silent_failures', "Aucun échec silencieux enregistré.");

// overview.healing_timeline
t('overview.healing_timeline.loading', "Chargement de la chronologie...");
t('overview.healing_timeline.no_events', "Aucun événement de guérison");
t('overview.healing_timeline.no_events_hint', "Lancez l'analyse pour construire la chronologie de résilience.");
t('overview.healing_timeline.knowledge_base', "Base de connaissances");
t('overview.healing_timeline.patterns_hint', "Schémas influençant les décisions de guérison");

// overview.ipc_panel
t('overview.ipc_panel.title', "Performance IPC");
t('overview.ipc_panel.by_command', "Par commande");
t('overview.ipc_panel.slowest_calls', "Appels les plus lents");
t('overview.ipc_panel.command', "Commande");
t('overview.ipc_panel.calls_header', "Appels");
t('overview.ipc_panel.duration_header', "Durée");
t('overview.ipc_panel.when_header', "Quand");

// overview.system_trace_extra
t('overview.system_trace_extra.no_traces', "Aucune trace système enregistrée");
t('overview.system_trace_extra.no_traces_hint', "Les traces apparaissent lors des opérations de conception, d'identifiant ou de modèle");
t('overview.system_trace_extra.all_operations', "Toutes les opérations");
t('overview.system_trace_extra.clear_completed', "Effacer les traces terminées");
t('overview.system_trace_extra.span', "Durée");

// overview.event_log_sidebar
t('overview.event_log_sidebar.title', "Journal des événements");
t('overview.event_log_sidebar.no_events', "Aucun événement");
t('overview.event_log_sidebar.open_detail_drawer', "Ouvrir dans le volet de détails");

// overview.chart_error
t('overview.chart_error.chart_unavailable', "Graphique non disponible");

// overview.realtime_idle
t('overview.realtime_idle.idle', "Inactif");

// overview.day_range
t('overview.day_range.apply', "Appliquer");

fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Batch 6 total keys:', Object.keys(out).length);
