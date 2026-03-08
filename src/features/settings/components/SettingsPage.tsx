import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import AccountSettings from '@/features/settings/sub_account/components/AccountSettings';
import AppearanceSettings from '@/features/settings/sub_appearance/components/AppearanceSettings';
import NotificationSettings from '@/features/settings/sub_notifications/components/NotificationSettings';
import EngineSettings from '@/features/settings/sub_engine/components/EngineSettings';
import ByomSettings from '@/features/settings/sub_byom/components/ByomSettings';
import DataPortabilitySettings from '@/features/settings/sub_portability/components/DataPortabilitySettings';
import AdminSettings from '@/features/settings/sub_admin/components/AdminSettings';

export default function SettingsPage() {
  const settingsTab = usePersonaStore((s) => s.settingsTab);

  const content = (() => {
    switch (settingsTab) {
      case 'account': return <AccountSettings />;
      case 'appearance': return <AppearanceSettings />;
      case 'notifications': return <NotificationSettings />;
      case 'engine': return <EngineSettings />;
      case 'byom': return <ByomSettings />;
      case 'portability': return <DataPortabilitySettings />;
      case 'admin': return <AdminSettings />;
      default: return <AccountSettings />;
    }
  })();

  return (
    <motion.div
      key={settingsTab}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
    >
      {content}
    </motion.div>
  );
}
