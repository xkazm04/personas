import { useState, useCallback } from 'react';
import { testCredentialDesignHealthcheck } from '@/api/tauriApi';

export interface HealthcheckMessage {
  success: boolean;
  message: string;
}

export interface HealthcheckState {
  isHealthchecking: boolean;
  healthcheckResult: HealthcheckMessage | null;
  testedHealthcheckConfig: Record<string, unknown> | null;
  lastSuccessfulTestAt: string | null;
  /** Run a healthcheck against the designed credential */
  runHealthcheck: (
    instruction: string,
    connector: Record<string, unknown>,
    values: Record<string, string>,
  ) => Promise<void>;
  /** Called when a credential field value changes — invalidates previous test */
  handleValuesChanged: (key: string, value: string) => void;
  /** Set the healthcheck result directly (e.g. from OAuth message sync) */
  setHealthcheckResult: (result: HealthcheckMessage | null) => void;
  /** Reset all healthcheck state */
  reset: () => void;
}

export function useHealthcheckState(): HealthcheckState {
  const [isHealthchecking, setIsHealthchecking] = useState(false);
  const [healthcheckResult, setHealthcheckResult] = useState<HealthcheckMessage | null>(null);
  const [testedHealthcheckConfig, setTestedHealthcheckConfig] = useState<Record<string, unknown> | null>(null);
  const [, setTestedValues] = useState<Record<string, string> | null>(null);
  const [lastSuccessfulTestAt, setLastSuccessfulTestAt] = useState<string | null>(null);

  const runHealthcheck = useCallback(async (
    instruction: string,
    connector: Record<string, unknown>,
    values: Record<string, string>,
  ) => {
    setIsHealthchecking(true);
    setHealthcheckResult(null);
    setTestedHealthcheckConfig(null);
    setTestedValues({ ...values });

    try {
      const response = await testCredentialDesignHealthcheck(instruction, connector, values);

      setHealthcheckResult({
        success: response.success,
        message: response.message,
      });

      if (response.healthcheck_config) {
        const skip = response.healthcheck_config.skip === true;
        if (!skip) {
          setTestedHealthcheckConfig(response.healthcheck_config);
          if (response.success) {
            setLastSuccessfulTestAt(new Date().toLocaleTimeString());
          }
        }
      }
    } catch (e) {
      setHealthcheckResult({
        success: false,
        message: e instanceof Error ? e.message : 'Failed to run healthcheck',
      });
      setTestedHealthcheckConfig(null);
      setLastSuccessfulTestAt(null);
    } finally {
      setIsHealthchecking(false);
    }
  }, []);

  const handleValuesChanged = useCallback((key: string, value: string) => {
    setTestedValues((prev) => {
      if (!prev) return prev;
      if (prev[key] === value) return prev;
      // Value changed — invalidate previous test
      setHealthcheckResult(null);
      setTestedHealthcheckConfig(null);
      setTestedValues(null);
      setLastSuccessfulTestAt(null);
      return null;
    });
  }, []);

  const reset = useCallback(() => {
    setIsHealthchecking(false);
    setHealthcheckResult(null);
    setTestedHealthcheckConfig(null);
    setTestedValues(null);
    setLastSuccessfulTestAt(null);
  }, []);

  return {
    isHealthchecking,
    healthcheckResult,
    testedHealthcheckConfig,
    lastSuccessfulTestAt,
    runHealthcheck,
    handleValuesChanged,
    setHealthcheckResult,
    reset,
  };
}
