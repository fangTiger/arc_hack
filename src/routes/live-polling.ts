export type LivePollTerminalStatus = 'queued' | 'running' | 'completed' | 'failed';

export const isLiveSessionTerminalStatus = (status?: string | null): status is 'completed' | 'failed' =>
  status === 'completed' || status === 'failed';

export const createLivePollFailureTracker = (failureThreshold = 2) => {
  let consecutiveFailures = 0;

  return {
    reset(): void {
      consecutiveFailures = 0;
    },
    recordSuccess(status?: LivePollTerminalStatus | null): { shouldStopPolling: boolean } {
      consecutiveFailures = 0;
      return {
        shouldStopPolling: isLiveSessionTerminalStatus(status)
      };
    },
    recordFailure(lastKnownStatus?: LivePollTerminalStatus | null): {
      action: 'retry' | 'interrupt' | 'ignore';
      failureCount: number;
    } {
      if (isLiveSessionTerminalStatus(lastKnownStatus)) {
        return {
          action: 'ignore',
          failureCount: consecutiveFailures
        };
      }

      consecutiveFailures += 1;

      return {
        action: consecutiveFailures >= failureThreshold ? 'interrupt' : 'retry',
        failureCount: consecutiveFailures
      };
    }
  };
};
