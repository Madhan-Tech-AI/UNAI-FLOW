import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Connections from './pages/Connections';
import NewAutomation from './pages/NewAutomation';
import PreviewVariants from './pages/PreviewVariants';
import AutomationHistory from './pages/AutomationHistory';
import Settings from './pages/Settings';
import WhatsAppChannels from './pages/WhatsAppChannels';
import EmailAutomation from './pages/EmailAutomation';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/" element={<Dashboard />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/whatsapp-channels" element={<WhatsAppChannels />} />
          <Route path="/email-automation" element={<EmailAutomation />} />
          <Route path="/automations/new" element={<NewAutomation />} />
          <Route path="/automations/preview" element={<PreviewVariants />} />
          <Route path="/history" element={<AutomationHistory />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
