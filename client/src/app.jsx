import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import {
  CataloguePage,
  DashboardPage,
  LocationsPage,
  LoginPage,
  MenuPage,
  ModulePage,
  SettingsPage,
  SignupPage,
  StockPage,
  UsersPage,
} from './pages.jsx';
import { Shell } from './shell.jsx';

function Boot() {
  return (
    <div className="boot">
      <span className="spinner" />
      Loading Stockkeep…
    </div>
  );
}

function Guest({ children }) {
  const { ready, session } = useAuth();
  if (!ready) return <Boot />;
  if (session) return <Navigate to="/dashboard" replace />;
  return children;
}

function Private() {
  const { ready, session } = useAuth();
  if (!ready) return <Boot />;
  if (!session) return <Navigate to="/login" replace />;
  return <Shell />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Guest><LoginPage /></Guest>} />
      <Route path="/signup" element={<Guest><SignupPage /></Guest>} />
      <Route path="/" element={<Private />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="catalogue" element={<CataloguePage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="locations" element={<LocationsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="menu/:slug" element={<MenuPage />} />
        <Route path="m/:feature" element={<ModulePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
