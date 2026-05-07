import { useCallback, useEffect, useState } from "react";
import {
  langfuseClearConfig,
  langfuseGetConfig,
  langfuseSaveConfig,
  langfuseTestConnection,
} from "@/api/langfuse";
import type { LangfuseConfig } from "@/lib/bindings/LangfuseConfig";
import type { LangfuseSaveRequest } from "@/lib/bindings/LangfuseSaveRequest";
import type { LangfuseTestResult } from "@/lib/bindings/LangfuseTestResult";
import { toastCatch } from "@/lib/silentCatch";

export interface UseLangfuseSettings {
  config: LangfuseConfig | null;
  loading: boolean;
  testing: boolean;
  saving: boolean;
  lastTest: LangfuseTestResult | null;
  refresh: () => Promise<void>;
  test: (host: string, publicKey: string, secretKey: string) => Promise<LangfuseTestResult>;
  save: (request: LangfuseSaveRequest) => Promise<LangfuseTestResult>;
  clear: () => Promise<void>;
}

export function useLangfuseSettings(): UseLangfuseSettings {
  const [config, setConfig] = useState<LangfuseConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastTest, setLastTest] = useState<LangfuseTestResult | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await langfuseGetConfig();
      setConfig(next);
    } catch (e) {
      toastCatch("Langfuse:refresh", "Failed to load Langfuse settings")(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const test = useCallback(
    async (host: string, publicKey: string, secretKey: string) => {
      setTesting(true);
      try {
        const result = await langfuseTestConnection(host, publicKey, secretKey);
        setLastTest(result);
        return result;
      } finally {
        setTesting(false);
      }
    },
    [],
  );

  const save = useCallback(
    async (request: LangfuseSaveRequest) => {
      setSaving(true);
      try {
        const result = await langfuseSaveConfig(request);
        setLastTest(result);
        if (result.ok) {
          await refresh();
        }
        return result;
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  const clear = useCallback(async () => {
    setSaving(true);
    try {
      await langfuseClearConfig();
      setLastTest(null);
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [refresh]);

  return { config, loading, testing, saving, lastTest, refresh, test, save, clear };
}
