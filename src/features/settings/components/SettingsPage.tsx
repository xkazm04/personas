import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
<<<<<<< HEAD
import AccountSettings from '@/features/settings/sub_account/components/AccountSettings';
import AppearanceSettings from '@/features/settings/sub_appearance/components/AppearanceSettings';
import NotificationSettings from '@/features/settings/sub_notifications/components/NotificationSettings';
import EngineSettings from '@/features/settings/sub_engine/components/EngineSettings';
import ByomSettings from '@/features/settings/sub_byom/components/ByomSettings';
import DataPortabilitySettings from '@/features/settings/sub_portability/components/DataPortabilitySettings';
import AdminSettings from '@/features/settings/sub_admin/components/AdminSettings';
=======
import AccountSettings from '@/features/settings/sub_account/AccountSettings';
import AppearanceSettings from '@/features/settings/sub_appearance/AppearanceSettings';
import NotificationSettings from '@/features/settings/sub_notifications/NotificationSettings';
import EngineSettings from '@/features/settings/sub_engine/EngineSettings';
import ByomSettings from '@/features/settings/sub_byom/ByomSettings';
import DataPortabilitySettings from '@/features/settings/sub_portability/DataPortabilitySettings';
import AdminSettings from '@/features/settings/sub_admin/AdminSettings';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

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
<<<<<<< HEAD
      className="flex-1 min-h-0 flex flex-col w-full overflow-hidden"
=======
      className="flex-1 min-h-0 flex flex-col overflow-hidden"
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
    >
      {content}
    </motion.div>
  );
}
