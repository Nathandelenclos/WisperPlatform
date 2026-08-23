import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/http';
import { App } from './App';
import { I18nProvider } from './i18n';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // A business or authorisation error is not replayed; a transient one, twice.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      // Exponential backoff with jitter: two tabs do not poll in lockstep.
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 15_000) * (0.7 + Math.random() * 0.6),
    },
    mutations: { retry: false },
  },
});

const container = document.getElementById('root');
if (container === null) throw new Error('Root element #root not found.');

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
