// TODO(i18n-de): translate from English placeholders. Structure must match en.ts exactly.
export const de = {
  settings: {
    byom: {
      sidebarLabel: 'Modellanbieter',
      title: 'Modellanbieter',
      subtitle: 'Wählen Sie, welche KI-Modelle Ihre Agenten verwenden',
      loadingSubtitle: 'Wird geladen...',
      policyToggleTitle: 'Modellanbieter-Regeln',
      policyToggleDescription: 'Wenn aktiviert, folgt die Anbieterauswahl Ihren konfigurierten Regeln',
      policyToggleLabel: 'Modellanbieter-Regeln',
      corruptTitle: 'Modellanbieter-Richtlinie beschädigt',
      unsavedSection: 'Modellanbieter-Richtlinie',
    },
    qualityGates: {
      sidebarLabel: 'Inhaltsfilter',
      title: 'Inhaltsfilter',
      subtitle: '{count} aktive Filterregeln',
      loadingSubtitle: 'Wird geladen...',
      errorSubtitle: 'Fehler beim Laden der Konfiguration',
      description:
        'Inhaltsfilter prüfen KI-generierte Erinnerungen und Überprüfungen während der Ausführung. ' +
        'Muster werden als Teilzeichenketten gegen den kombinierten Titel und Inhalt jeder Einreichung abgeglichen. ' +
        'Wenn ein Muster übereinstimmt, wird die konfigurierte Aktion angewendet. Diese Filter verhindern, dass Betriebsrauschen Ihre Wissensbasis verunreinigt.',
      loadingMessage: 'Inhaltsfilter-Konfiguration wird geladen...',
    },
    configResolution: {
      sidebarLabel: 'Agenten-Konfiguration',
      title: 'Agenten-Konfigurationsübersicht',
      subtitle: 'Zeigt an, welche Ebene (Agent / Arbeitsbereich / Global) jede Einstellung pro Agent bereitstellt',
    },
    ambientContext: {
      title: 'Desktop-Erkennung',
      toggleLabel: 'Desktop-Erkennung',
      description:
        'Desktop-Erkennung erfasst Zwischenablage-, Dateiänderungs- und App-Fokus-Signale, um Ihren Agenten ein Bewusstsein für Ihren Desktop-Workflow zu geben.',
    },
  },
};
