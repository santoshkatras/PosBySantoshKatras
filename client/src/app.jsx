import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { OpeningStockPage } from './opening-stock.jsx';
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
  ItemLedgerPage,
  StockPage,
  UsersPage,
} from './pages.jsx';
import { Shell } from './shell.jsx';
import { JobListPage, ServiceBoardPage } from './service-board.jsx';
import { JobCardPage, NewJobPage } from './service-job.jsx';
import { CustomerHistoryPage, RemindersPage } from './customers.jsx';
import { PartyPage } from './party-master.jsx';

function Boot() {
  return (
    <div className="boot">
      <span className="spinner" />
      Loading SKPOS…
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
        <Route path="stock" element={<StockRoute />} />
        <Route path="ledger" element={<ItemLedgerPage />} />
        <Route path="locations" element={<LocationsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="service" element={<ServiceBoardPage />} />
        <Route path="service/new" element={<NewJobPage />} />
        <Route path="service/jobs" element={<JobListPage />} />
        <Route path="service/jobs/:id" element={<JobCardPage />} />
        <Route path="service/reminders" element={<RemindersPage />} />
        <Route path="customers" element={<PartyPage key="customer" kind="customer" />} />
        <Route path="suppliers" element={<PartyPage key="supplier" kind="supplier" />} />
        <Route path="customers/:id" element={<CustomerHistoryPage />} />
        <Route path="menu/:slug" element={<MenuPage />} />
        <Route path="m/:feature" element={<ModulePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Transactions → Opening Stock Entry opens the entry list; the rest is the stock screen.
function StockRoute() {
  const [params] = useSearchParams();
  return params.get('mode') === 'opening' ? <OpeningStockPage /> : <StockPage />;
}
