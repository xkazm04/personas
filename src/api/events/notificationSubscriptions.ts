import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { NotificationSubscription } from "@/lib/bindings/NotificationSubscription";
import type { CreateNotificationSubscriptionInput } from "@/lib/bindings/CreateNotificationSubscriptionInput";
import type { UpdateNotificationSubscriptionInput } from "@/lib/bindings/UpdateNotificationSubscriptionInput";
import type { NotificationTestResult } from "@/lib/bindings/NotificationTestResult";

export const listNotificationSubscriptions = () =>
  invoke<NotificationSubscription[]>("list_notification_subscriptions");

export const getNotificationSubscription = (id: string) =>
  invoke<NotificationSubscription>("get_notification_subscription", { id });

export const createNotificationSubscription = (
  input: CreateNotificationSubscriptionInput,
) => invoke<NotificationSubscription>("create_notification_subscription", { input });

export const updateNotificationSubscription = (
  id: string,
  input: UpdateNotificationSubscriptionInput,
) => invoke<NotificationSubscription>("update_notification_subscription", { id, input });

export const deleteNotificationSubscription = (id: string) =>
  invoke<void>("delete_notification_subscription", { id });

export const testNotificationSubscription = (id: string) =>
  invoke<NotificationTestResult>("test_notification_subscription", { id });
