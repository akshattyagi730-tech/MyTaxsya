import { useState, useEffect, useCallback } from 'react';
import apiClient from '@/api/apiClient';

export function useEntityCrud(entityName, sortField = '-created_date', limit = 200) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get(`/entities/${entityName}`, {
        params: { sort: sortField, limit }
      });
      setItems(res.data);
    } catch (err) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [entityName, sortField, limit]);

  useEffect(() => { load(); }, [load]);

  const create = async (data) => {
    setSaving(true);
    try {
      const res = await apiClient.post(`/entities/${entityName}`, data);
      setItems(prev => [res.data, ...prev]);
      return res.data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const update = async (id, data) => {
    setSaving(true);
    try {
      const res = await apiClient.put(`/entities/${entityName}/${id}`, data);
      setItems(prev => prev.map(item => item.id === id ? res.data : item));
      return res.data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    setDeleting(true);
    try {
      await apiClient.delete(`/entities/${entityName}/${id}`);
      setItems(prev => prev.filter(item => item.id !== id));
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setDeleting(false);
    }
  };

  return { items, loading, error, saving, deleting, create, update, remove, reload: load };
}