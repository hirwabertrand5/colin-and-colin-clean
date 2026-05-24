import { useEffect, useRef, useCallback } from 'react';

interface UseAutoLogoutOptions {
  timeout?: number; // in milliseconds
  onLogout: () => void;
  enabled?: boolean;
}

export const useAutoLogout = ({
  timeout = 15 * 60 * 1000, // 15 minutes default
  onLogout,
  enabled = true
}: UseAutoLogoutOptions) => {
  const timeoutRef = useRef<NodeJS.Timeout>();
  const lastActivityRef = useRef<number>(Date.now());

  const resetTimer = useCallback(() => {
    if (!enabled) return;

    lastActivityRef.current = Date.now();

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      // Check if user has been inactive for the full timeout period
      const timeSinceLastActivity = Date.now() - lastActivityRef.current;
      if (timeSinceLastActivity >= timeout) {
        onLogout();
      }
    }, timeout);
  }, [timeout, onLogout, enabled]);

  const handleActivity = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (!enabled) return;

    // Activity events to track
    const events = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click'
    ];

    // Add event listeners
    events.forEach(event => {
      document.addEventListener(event, handleActivity, true);
    });

    // Start the timer
    resetTimer();

    // Cleanup
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleActivity, true);
      });

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [handleActivity, resetTimer, enabled]);

  // Return a function to manually reset the timer (useful for programmatic resets)
  return {
    resetTimer: () => resetTimer(),
    getTimeUntilLogout: () => {
      const elapsed = Date.now() - lastActivityRef.current;
      return Math.max(0, timeout - elapsed);
    }
  };
};