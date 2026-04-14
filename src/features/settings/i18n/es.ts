// TODO(i18n-es): translate from English placeholders. Structure must match en.ts exactly.
export const es = {
  settings: {
    byom: {
      sidebarLabel: 'Proveedores de modelos',
      title: 'Proveedores de modelos',
      subtitle: 'Elige qué modelos de IA usan tus agentes',
      loadingSubtitle: 'Cargando...',
      policyToggleTitle: 'Reglas de proveedores de modelos',
      policyToggleDescription: 'Cuando está habilitado, la selección de proveedor sigue tus reglas configuradas',
      policyToggleLabel: 'Reglas de proveedores de modelos',
      corruptTitle: 'Política de proveedor de modelos corrupta',
      unsavedSection: 'Política de proveedor de modelos',
    },
    qualityGates: {
      sidebarLabel: 'Filtros de contenido',
      title: 'Filtros de contenido',
      subtitle: '{count} reglas de filtro activas',
      loadingSubtitle: 'Cargando...',
      errorSubtitle: 'Error al cargar la configuración',
      description:
        'Los filtros de contenido revisan los recuerdos y revisiones generados por IA durante la ejecución. ' +
        'Los patrones se comparan como subcadenas contra el título y contenido combinados de cada envío. ' +
        'Cuando un patrón coincide, se aplica la acción configurada. Estos filtros evitan que el ruido operativo contamine tu base de conocimientos.',
      loadingMessage: 'Cargando configuración de filtros de contenido...',
    },
    configResolution: {
      sidebarLabel: 'Configuración de agentes',
      title: 'Vista general de configuración de agentes',
      subtitle: 'Muestra qué nivel (agente / espacio de trabajo / global) proporciona cada ajuste por agente',
    },
    ambientContext: {
      title: 'Conciencia del escritorio',
      toggleLabel: 'Conciencia del escritorio',
      description:
        'La conciencia del escritorio captura señales del portapapeles, cambios de archivos y enfoque de aplicaciones para dar a tus agentes conciencia de tu flujo de trabajo en el escritorio.',
    },
  },
};
