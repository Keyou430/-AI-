import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const reportError = (kind: 'error' | 'unhandled-rejection', error: unknown) => {
  const value = error instanceof Error ? error : undefined;
  void window.electronAPI?.reportRuntimeError({ kind, name: value?.name, stack: value?.stack }).catch(() => {});
};
window.addEventListener('error', (event) => reportError('error', event.error));
window.addEventListener('unhandledrejection', (event) => reportError('unhandled-rejection', event.reason));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
