// TODO(i18n-ko): translate from English placeholders. Structure must match en.ts exactly.
export const ko = {
  settings: {
    byom: {
      sidebarLabel: '모델 제공자',
      title: '모델 제공자',
      subtitle: '에이전트가 사용할 AI 모델을 선택하세요',
      loadingSubtitle: '로딩 중...',
      policyToggleTitle: '모델 제공자 규칙',
      policyToggleDescription: '활성화하면 제공자 선택이 구성된 규칙을 따릅니다',
      policyToggleLabel: '모델 제공자 규칙',
      corruptTitle: '모델 제공자 정책이 손상됨',
      unsavedSection: '모델 제공자 정책',
    },
    qualityGates: {
      sidebarLabel: '콘텐츠 필터',
      title: '콘텐츠 필터',
      subtitle: '{count}개의 활성 필터 규칙',
      loadingSubtitle: '로딩 중...',
      errorSubtitle: '구성 로드 오류',
      description:
        '콘텐츠 필터는 실행 중 AI가 생성한 메모리와 리뷰를 검토합니다. ' +
        '패턴은 각 제출물의 결합된 제목과 콘텐츠에 대해 부분 문자열로 일치됩니다. ' +
        '패턴이 일치하면 구성된 작업이 적용됩니다. 이러한 필터는 운영 노이즈가 지식 기반을 오염시키는 것을 방지합니다.',
      loadingMessage: '콘텐츠 필터 구성을 로드하는 중...',
    },
    configResolution: {
      sidebarLabel: '에이전트 구성',
      title: '에이전트 구성 개요',
      subtitle: '각 에이전트에 대해 어떤 계층(에이전트 / 워크스페이스 / 전역)이 각 설정을 제공하는지 표시',
    },
    ambientContext: {
      title: '데스크톱 인식',
      toggleLabel: '데스크톱 인식',
      description:
        '데스크톱 인식은 클립보드, 파일 변경 및 앱 포커스 신호를 캡처하여 에이전트에게 데스크톱 워크플로우에 대한 인식을 제공합니다.',
    },
  },
};
