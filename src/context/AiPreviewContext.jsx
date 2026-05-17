/**
 * AI Preview Context
 *
 * Responsibilities:
 * - store the latest AI structured preview plan
 * - expose lightweight preview lifecycle status
 * - provide set/clear actions for preview consumers
 *
 * Non-responsibilities:
 * - do not store database baseline tasks
 * - do not derive preview tasks (that belongs to pure selector utilities)
 * - do not write database
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const AiPreviewContext = createContext({
  structuredPlan: null,
  status: 'idle',
  setStructuredPlan: () => {},
  clearStructuredPlan: () => {},
  setStatus: () => {},
});

export function AiPreviewProvider({ children }) {
  const [structuredPlan, setStructuredPlanState] = useState(null);
  const [status, setStatus] = useState('idle');

  const setStructuredPlan = useCallback((nextPlan) => {
    setStructuredPlanState(nextPlan || null);
    setStatus(nextPlan ? 'ready' : 'idle');
  }, []);

  const clearStructuredPlan = useCallback(() => {
    setStructuredPlanState(null);
    setStatus('idle');
  }, []);

  const value = useMemo(() => ({
    structuredPlan,
    status,
    setStructuredPlan,
    clearStructuredPlan,
    setStatus,
  }), [structuredPlan, status, setStructuredPlan, clearStructuredPlan]);

  return (
    <AiPreviewContext.Provider value={value}>
      {children}
    </AiPreviewContext.Provider>
  );
}

export function useAiPreview() {
  return useContext(AiPreviewContext);
}

