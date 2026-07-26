import api from './api';

export const invoiceService = {
  deleteAllInvoices: async () => {
    const res = await api.delete('/entities/Invoice/all');
    return res.data;
  }
};
