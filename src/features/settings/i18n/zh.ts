// TODO(i18n-zh): translate from English placeholders. Structure must match en.ts exactly.
export const zh = {
  settings: {
    byom: {
      sidebarLabel: '模型提供商',
      title: '模型提供商',
      subtitle: '选择您的智能体使用哪些AI模型',
      loadingSubtitle: '加载中...',
      policyToggleTitle: '模型提供商规则',
      policyToggleDescription: '启用后，提供商选择将遵循您配置的规则',
      policyToggleLabel: '模型提供商规则',
      corruptTitle: '模型提供商策略已损坏',
      unsavedSection: '模型提供商策略',
    },
    qualityGates: {
      sidebarLabel: '内容过滤器',
      title: '内容过滤器',
      subtitle: '{count} 条活跃过滤规则',
      loadingSubtitle: '加载中...',
      errorSubtitle: '加载配置时出错',
      description:
        '内容过滤器在执行期间审查AI生成的记忆和评审。' +
        '模式作为子字符串与每个提交的标题和内容进行匹配。' +
        '当模式匹配时，将应用配置的操作。这些过滤器可防止操作噪音污染您的知识库。',
      loadingMessage: '正在加载内容过滤器配置...',
    },
    configResolution: {
      sidebarLabel: '智能体配置',
      title: '智能体配置概览',
      subtitle: '显示每个智能体的每项设置由哪个层级（智能体/工作区/全局）提供',
    },
    ambientContext: {
      title: '桌面感知',
      toggleLabel: '桌面感知',
      description:
        '桌面感知捕获剪贴板、文件更改和应用焦点信号，让您的智能体了解您的桌面工作流程。',
    },
  },
};
