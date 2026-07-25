import apiClient from '@/api/apiClient';

export const invoiceService = {
  deleteAllInvoices: async () => {
    const res = await apiClient.delete('/entities/Invoice/all');
    return res.data;
  }
};
