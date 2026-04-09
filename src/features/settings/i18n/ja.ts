// TODO(i18n-ja): translate from English placeholders. Structure must match en.ts exactly.
export const ja = {
  settings: {
    byom: {
      sidebarLabel: 'モデルプロバイダー',
      title: 'モデルプロバイダー',
      subtitle: 'エージェントが使用するAIモデルを選択',
      loadingSubtitle: '読み込み中...',
      policyToggleTitle: 'モデルプロバイダールール',
      policyToggleDescription: '有効にすると、プロバイダーの選択は設定したルールに従います',
      policyToggleLabel: 'モデルプロバイダールール',
      corruptTitle: 'モデルプロバイダーポリシーが破損しています',
      unsavedSection: 'モデルプロバイダーポリシー',
    },
    qualityGates: {
      sidebarLabel: 'コンテンツフィルター',
      title: 'コンテンツフィルター',
      subtitle: '{count} 件のアクティブなフィルタールール',
      loadingSubtitle: '読み込み中...',
      errorSubtitle: '設定の読み込みエラー',
      description:
        'コンテンツフィルターは実行中にAIが生成したメモリとレビューを確認します。' +
        'パターンは各送信のタイトルとコンテンツの結合に対してサブストリングとして照合されます。' +
        'パターンが一致すると、設定されたアクションが適用されます。これらのフィルターは運用ノイズがナレッジベースを汚染するのを防ぎます。',
      loadingMessage: 'コンテンツフィルター設定を読み込み中...',
    },
    configResolution: {
      sidebarLabel: 'エージェント設定',
      title: 'エージェント設定の概要',
      subtitle: '各エージェントの各設定をどのティア（エージェント/ワークスペース/グローバル）が提供するかを表示',
    },
    ambientContext: {
      title: 'デスクトップ認識',
      toggleLabel: 'デスクトップ認識',
      description:
        'デスクトップ認識はクリップボード、ファイル変更、アプリフォーカスのシグナルをキャプチャし、エージェントにデスクトップワークフローの認識を提供します。',
    },
  },
};
