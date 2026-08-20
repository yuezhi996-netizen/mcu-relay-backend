import type { EventHub } from "./events.js";
import type { DataStore } from "./store.js";

export type CommandLifecycleMonitor = {
  readonly stop: () => Promise<void>;
};

type CommandLifecycleOptions = {
  readonly store: DataStore;
  readonly eventHub: EventHub;
  readonly intervalMs: number;
};

export const createCommandLifecycleMonitor = (options: CommandLifecycleOptions): CommandLifecycleMonitor => {
  let activeSweep: Promise<void> = Promise.resolve();
  const sweep = (): void => {
    activeSweep = activeSweep.then(async () => {
      const result = await options.store.advanceCommandLifecycle();
      for (const command of result.expired) options.eventHub.publish({ type: "command_expired", command });
      for (const command of result.requeued) options.eventHub.publish({ type: "command_requeued", command });
      for (const command of result.failed) options.eventHub.publish({ type: "command_failed", command });
    }).catch((error: unknown) => {
      console.error("command_expiry_sweep_failed", {
        reason: error instanceof Error ? error.message : "Unknown command expiry failure."
      });
    });
  };
  const timer = setInterval(sweep, options.intervalMs);
  timer.unref();
  sweep();
  return {
    stop: async () => {
      clearInterval(timer);
      await activeSweep;
    }
  };
};
