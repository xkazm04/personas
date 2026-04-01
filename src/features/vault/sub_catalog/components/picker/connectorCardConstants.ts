import { User, CreditCard, Building2 } from 'lucide-react';
import type { LicenseTier } from '@/lib/credentials/connectorLicensing';

export const LICENSE_ICON: Record<LicenseTier, typeof User> = {
  personal: User,
  paid: CreditCard,
  enterprise: Building2,
};
