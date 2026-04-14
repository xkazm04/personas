// TODO(i18n-cs): translate from English placeholders. Structure must match en.ts exactly.
export const cs = {
  settings: {
    byom: {
      sidebarLabel: 'Poskytovatelé modelů',
      title: 'Poskytovatelé modelů',
      subtitle: 'Vyberte, které AI modely vaši agenti používají',
      loadingSubtitle: 'Načítání...',
      policyToggleTitle: 'Pravidla poskytovatelů modelů',
      policyToggleDescription: 'Když je povoleno, výběr poskytovatele se řídí vašimi nakonfigurovanými pravidly',
      policyToggleLabel: 'Pravidla poskytovatelů modelů',
      corruptTitle: 'Zásady poskytovatele modelů jsou poškozeny',
      unsavedSection: 'Zásady poskytovatele modelů',
    },
    qualityGates: {
      sidebarLabel: 'Filtry obsahu',
      title: 'Filtry obsahu',
      subtitle: '{count} aktivních pravidel filtrování',
      loadingSubtitle: 'Načítání...',
      errorSubtitle: 'Chyba při načítání konfigurace',
      description:
        'Filtry obsahu kontrolují AI generované vzpomínky a recenze během provádění. ' +
        'Vzory se porovnávají jako podřetězce proti kombinovanému názvu a obsahu každého podání. ' +
        'Když se vzor shoduje, použije se nakonfigurovaná akce. Tyto filtry zabraňují provoznímu šumu znečišťovat vaši znalostní bázi.',
      loadingMessage: 'Načítání konfigurace filtrů obsahu...',
    },
    configResolution: {
      sidebarLabel: 'Konfigurace agentů',
      title: 'Přehled konfigurace agentů',
      subtitle: 'Zobrazuje, která úroveň (agent / pracovní prostor / globální) poskytuje každé nastavení pro každého agenta',
    },
    ambientContext: {
      title: 'Povědomí o ploše',
      toggleLabel: 'Povědomí o ploše',
      description:
        'Povědomí o ploše zachycuje signály schránky, změny souborů a zaměření aplikací, aby vaši agenti měli přehled o vašem pracovním postupu na ploše.',
    },
  },
};
