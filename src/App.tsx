import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

export type { User, UserRole } from './StaffApp';
const StaffApp = lazy(() => import('./StaffApp'));
const PublicIntakeForm = lazy(() => import('./components/public/PublicIntakeForm'));
const PublicFeedbackForm = lazy(() => import('./components/public/PublicFeedbackForm'));

/** Public invitations render independently of staff authentication and dashboard code. */
export default function App() {
  return <BrowserRouter><Suspense fallback={<div role="status" className="flex items-center justify-center min-h-screen">Loading...</div>}><Routes>
    <Route path="/intake/form/:token" element={<PublicIntakeForm />} />
    <Route path="/intake/clarification/:token" element={<PublicIntakeForm clarification />} />
    <Route path="/public/feedback/:prospectId" element={<PublicFeedbackForm />} />
    <Route path="/*" element={<Suspense fallback={<div role="status" className="flex items-center justify-center min-h-screen">Loading...</div>}><StaffApp /></Suspense>} />
  </Routes></Suspense></BrowserRouter>;
}
