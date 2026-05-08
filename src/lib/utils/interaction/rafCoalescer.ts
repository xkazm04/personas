export function createRafCoalescer<T extends unknown[]>(
  callback: (...args: T) => void,
) {
  let frame: number | null = null;
  let latestArgs: T | null = null;

  const cancel = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    latestArgs = null;
  };

  const schedule = (...args: T) => {
    latestArgs = args;
    if (frame !== null) return;

    frame = requestAnimationFrame(() => {
      frame = null;
      const argsToRun = latestArgs;
      latestArgs = null;
      if (argsToRun) {
        callback(...argsToRun);
      }
    });
  };

  return { schedule, cancel };
}
