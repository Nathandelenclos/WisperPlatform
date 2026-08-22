import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from './api/http';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Une erreur métier ou d'autorisation ne se rejoue pas ; le transitoire, deux fois.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      // Backoff exponentiel avec gigue : deux onglets ne rappellent pas en cadence.
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 15_000) * (0.7 + Math.random() * 0.6),
    },
    mutations: { retry: false },
  },
});

const container = document.getElementById('root');
if (container === null) throw new Error('Élément racine #root introuvable.');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
