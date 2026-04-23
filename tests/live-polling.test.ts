import { describe, expect, it } from 'vitest';

import { createLivePollFailureTracker, isLiveSessionTerminalStatus } from '../src/routes/live-polling.js';

describe('isLiveSessionTerminalStatus', () => {
  it('should treat completed and failed as terminal statuses', () => {
    expect(isLiveSessionTerminalStatus('completed')).toBe(true);
    expect(isLiveSessionTerminalStatus('failed')).toBe(true);
    expect(isLiveSessionTerminalStatus('running')).toBe(false);
    expect(isLiveSessionTerminalStatus('queued')).toBe(false);
    expect(isLiveSessionTerminalStatus(undefined)).toBe(false);
  });
});

describe('createLivePollFailureTracker', () => {
  it('should retry after the first transient failure and interrupt after the second consecutive failure', () => {
    const tracker = createLivePollFailureTracker();

    expect(tracker.recordFailure('running')).toEqual({
      action: 'retry',
      failureCount: 1
    });
    expect(tracker.recordFailure('running')).toEqual({
      action: 'interrupt',
      failureCount: 2
    });
  });

  it('should reset the failure counter after a successful poll', () => {
    const tracker = createLivePollFailureTracker();

    expect(tracker.recordFailure('running')).toEqual({
      action: 'retry',
      failureCount: 1
    });

    expect(tracker.recordSuccess('running')).toEqual({
      shouldStopPolling: false
    });

    expect(tracker.recordFailure('running')).toEqual({
      action: 'retry',
      failureCount: 1
    });
  });

  it('should ignore failures that arrive after a terminal session has already rendered', () => {
    const tracker = createLivePollFailureTracker();

    expect(tracker.recordSuccess('completed')).toEqual({
      shouldStopPolling: true
    });

    expect(tracker.recordFailure('completed')).toEqual({
      action: 'ignore',
      failureCount: 0
    });
  });
});
