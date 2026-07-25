import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
// Add page imports here
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Navigate } from 'react-router-dom';
import Invoices from '@/pages/Invoices';
import InvoiceDetail from '@/pages/InvoiceDetail';
import Customers from '@/pages/Customers';
import CustomerDetail from '@/pages/CustomerDetail';
import Suppliers from '@/pages/Suppliers';
import SupplierDetail from '@/pages/SupplierDetail';
import Products from '@/pages/Products';
import ProductDetail from '@/pages/ProductDetail';
import Inventory from '@/pages/Inventory';
import Payments from '@/pages/Payments';
import PaymentDetail from '@/pages/PaymentDetail';
import Expenses from '@/pages/Expenses';
import ExpenseDetail from '@/pages/ExpenseDetail';
import Ledger from '@/pages/Ledger';
import GstCenter from '@/pages/GstCenter';
import Reports from '@/pages/Reports';
import AnalyticsPage from '@/pages/Analytics';
import Assistant from '@/pages/Assistant';
import Notifications from '@/pages/Notifications';
import Team from '@/pages/Team';
import Settings from '@/pages/Settings';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <ScrollToTop />
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
                <Route element={<Layout />}>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/invoices" element={<Invoices />} />
                  <Route path="/invoices/:id" element={<InvoiceDetail />} />
                  <Route path="/customers" element={<Customers />} />
                  <Route path="/customers/:id" element={<CustomerDetail />} />
                  <Route path="/suppliers" element={<Suppliers />} />
                  <Route path="/suppliers/:id" element={<SupplierDetail />} />
                  <Route path="/products" element={<Products />} />
                  <Route path="/products/:id" element={<ProductDetail />} />
                  <Route path="/inventory" element={<Inventory />} />
                  <Route path="/payments" element={<Payments />} />
                  <Route path="/payments/:id" element={<PaymentDetail />} />
                  <Route path="/expenses" element={<Expenses />} />
                  <Route path="/expenses/:id" element={<ExpenseDetail />} />
                  <Route path="/ledger" element={<Ledger />} />
                  <Route path="/gst" element={<GstCenter />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/assistant" element={<Assistant />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/team" element={<Team />} />
                  <Route path="/settings" element={<Settings />} />
                </Route>
              </Route>
              <Route path="*" element={<PageNotFound />} />
            </Routes>
          </Router>
          <Toaster />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App