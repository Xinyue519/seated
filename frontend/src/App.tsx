import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useApp } from './store/AppStore';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import ExplorePage from './pages/ExplorePage';
import SavedPage from './pages/SavedPage';
import ReservationsPage from './pages/ReservationsPage';
import SettingsPage from './pages/SettingsPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useApp();
  return state.authed ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<ExplorePage />} />
        <Route path="saved" element={<SavedPage />} />
        <Route path="reservations" element={<ReservationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
