import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './utils/auth';
import LoginPage from './pages/Login';
import MainLayout from './components/MainLayout';
import HomePage from './pages/HomePage';
import CompanyInfoPage from './pages/resource/CompanyInfoPage';
import QualificationManagement from './pages/resource/QualificationManagement';
import PersonnelManagement from './pages/resource/PersonnelManagement';
import FinancialInfoManagement from './pages/resource/FinancialInfoManagement';
import PerformanceManagement from './pages/resource/PerformanceManagement';
import UserManagement from './pages/UserManagement';
import BidEditor from './pages/BidEditor';
import InterfaceManagement from './pages/InterfaceManagement';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={
          isAuthenticated() ? <MainLayout /> : <Navigate to="/login" replace />
        }>
          <Route index element={<HomePage />} />
          <Route path="business" element={<BidEditor type="business" />} />
          <Route path="technical" element={<BidEditor type="technical" />} />
          <Route path="resource/company" element={<CompanyInfoPage />} />
          <Route path="resource/qualifications" element={<QualificationManagement />} />
          <Route path="resource/personnel" element={<PersonnelManagement />} />
          <Route path="resource/financial" element={<FinancialInfoManagement />} />
          <Route path="resource/performance" element={<PerformanceManagement />} />
          <Route path="users" element={<UserManagement />} />
          <Route path="interfaces" element={<InterfaceManagement />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
