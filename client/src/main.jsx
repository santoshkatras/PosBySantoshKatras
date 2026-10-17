import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app.jsx';
import './buttons.css';
import { AuthProvider } from './auth.jsx';
import { FeedbackProvider } from './feedback.jsx';
import './hrms.css';
import './extra.css';
import './tables.css';
import { installKeyboard } from './keyboard.js';

installKeyboard();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <FeedbackProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </FeedbackProvider>
    </AuthProvider>
  </StrictMode>,
);
