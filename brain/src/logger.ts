export type LogSink = (event: Record<string, unknown>) => Promise<void> | void;

let sink: LogSink = event => {
  // Keep the portable Brain safe for Android/non-Node hosts. Node-specific
  // file logging is installed by src/nodeLogger.ts in the development server.
  console.log('[brain]', JSON.stringify({timestamp: new Date().toISOString(), ...event}));
};

export function setLogSink(nextSink: LogSink): void {
  sink = async event => {
    try {
      await nextSink(event);
    } catch (error) {
      console.warn('[brain] log sink failed:', error instanceof Error ? error.message : String(error));
    }
  };
}

export async function logEvent(event: Record<string, unknown>): Promise<void> {
  try {
    await sink(event);
  } catch (error) {
    console.warn('[brain] log failed:', error instanceof Error ? error.message : String(error));
  }
}
