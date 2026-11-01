import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import PublicIntakeForm from './components/public/PublicIntakeForm';
import PublicFeedbackForm from './components/public/PublicFeedbackForm';

export type { User, UserRole } from './StaffApp';
const StaffApp = lazy(() => import('./StaffApp'));

/** Public invitations render independently of staff authentication and dashboard code. */
export default function App() {
  return <BrowserRouter><Routes>
    <Route path="/intake/form/:token" element={<PublicIntakeForm />} />
    <Route path="/intake/clarification/:token" element={<PublicIntakeForm clarification />} />
    <Route path="/public/feedback/:prospectId" element={<PublicFeedbackForm />} />
    <Route path="/*" element={<Suspense fallback={<div role="status" className="flex items-center justify-center min-h-screen">Loading...</div>}><StaffApp /></Suspense>} />
  </Routes></BrowserRouter>;
}
