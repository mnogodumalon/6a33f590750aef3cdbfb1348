import '@/lib/sentry';
import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { ActionsProvider } from '@/context/ActionsContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorBusProvider } from '@/components/ErrorBus';
import { Layout } from '@/components/Layout';
import DashboardOverview from '@/pages/DashboardOverview';
import AdminPage from '@/pages/AdminPage';
import InteressentenPage from '@/pages/InteressentenPage';
import InteressentenDetailPage from '@/pages/InteressentenDetailPage';
import ObjektePage from '@/pages/ObjektePage';
import ObjekteDetailPage from '@/pages/ObjekteDetailPage';
import BesichtigungenPage from '@/pages/BesichtigungenPage';
import BesichtigungenDetailPage from '@/pages/BesichtigungenDetailPage';
import PublicFormInteressenten from '@/pages/public/PublicForm_Interessenten';
import PublicFormObjekte from '@/pages/public/PublicForm_Objekte';
import PublicFormBesichtigungen from '@/pages/public/PublicForm_Besichtigungen';
// <public:imports>
// </public:imports>
// <custom:imports>
const BesichtigungVereinbarenPage = lazy(() => import('@/pages/intents/BesichtigungVereinbarenPage'));
// </custom:imports>

export default function App() {
  return (
    <ErrorBoundary>
      <ErrorBusProvider>
        <HashRouter>
          <ActionsProvider>
            <Routes>
              <Route path="public/6a33f573e1f7f5947e3ad19d" element={<PublicFormInteressenten />} />
              <Route path="public/6a33f570d897d206f67e2416" element={<PublicFormObjekte />} />
              <Route path="public/6a33f5740e6503911d335dc6" element={<PublicFormBesichtigungen />} />
              {/* <public:routes> */}
              {/* </public:routes> */}
              <Route element={<Layout />}>
                <Route index element={<DashboardOverview />} />
                <Route path="interessenten" element={<InteressentenPage />} />
                <Route path="interessenten/:id" element={<InteressentenDetailPage />} />
                <Route path="objekte" element={<ObjektePage />} />
                <Route path="objekte/:id" element={<ObjekteDetailPage />} />
                <Route path="besichtigungen" element={<BesichtigungenPage />} />
                <Route path="besichtigungen/:id" element={<BesichtigungenDetailPage />} />
                <Route path="admin" element={<AdminPage />} />
                {/* <custom:routes> */}
                <Route path="intents/besichtigung-vereinbaren" element={<Suspense fallback={null}><BesichtigungVereinbarenPage /></Suspense>} />
                {/* </custom:routes> */}
              </Route>
            </Routes>
          </ActionsProvider>
        </HashRouter>
      </ErrorBusProvider>
    </ErrorBoundary>
  );
}
