// TODO(i18n-fr): translate from English placeholders. Structure must match en.ts exactly.
export const fr = {
  settings: {
    byom: {
      sidebarLabel: 'Fournisseurs de modèles',
      title: 'Fournisseurs de modèles',
      subtitle: 'Choisissez quels modèles IA vos agents utilisent',
      loadingSubtitle: 'Chargement...',
      policyToggleTitle: 'Règles des fournisseurs de modèles',
      policyToggleDescription: 'Lorsque activé, la sélection du fournisseur suit vos règles configurées',
      policyToggleLabel: 'Règles des fournisseurs de modèles',
      corruptTitle: 'Politique du fournisseur de modèles corrompue',
      unsavedSection: 'Politique du fournisseur de modèles',
    },
    qualityGates: {
      sidebarLabel: 'Filtres de contenu',
      title: 'Filtres de contenu',
      subtitle: '{count} règles de filtrage actives',
      loadingSubtitle: 'Chargement...',
      errorSubtitle: 'Erreur de chargement de la configuration',
      description:
        'Les filtres de contenu examinent les souvenirs et avis générés par l\'IA pendant l\'exécution. ' +
        'Les motifs sont comparés comme sous-chaînes au titre et contenu combinés de chaque soumission. ' +
        'Lorsqu\'un motif correspond, l\'action configurée est appliquée. Ces filtres empêchent le bruit opérationnel de polluer votre base de connaissances.',
      loadingMessage: 'Chargement de la configuration des filtres de contenu...',
    },
    configResolution: {
      sidebarLabel: 'Configuration des agents',
      title: 'Vue d\'ensemble de la configuration des agents',
      subtitle: 'Montre quel niveau (agent / espace de travail / global) fournit chaque paramètre par agent',
    },
    ambientContext: {
      title: 'Conscience du bureau',
      toggleLabel: 'Conscience du bureau',
      description:
        'La conscience du bureau capture les signaux du presse-papiers, les changements de fichiers et le focus des applications pour donner à vos agents une conscience de votre flux de travail sur le bureau.',
    },
  },
};
