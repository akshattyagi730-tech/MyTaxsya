import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import api from '@/services/api';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import EntityFormDialog from '@/components/EntityFormDialog';
import { formatINR, formatDate } from '@/utils/format';

export default function EntityDetailPage({ entityName, titleKey, fields, formFields, backPath, children = null }) {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/entities/${entityName}/${routeId}`);
        setItem(res.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [routeId, entityName]);

  const handleUpdate = async (data) => {
    setSaving(true);
    try {
      const res = await api.put(`/entities/${entityName}/${routeId}`, data);
      setItem(res.data);
      setEditOpen(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await api.delete(`/entities/${entityName}/${routeId}`);
    navigate(backPath);
  };

  if (loading) return <div className="p-8"><div className="h-64 rounded-xl bg-muted animate-pulse" /></div>;
  if (error) return <div className="p-8 text-center text-muted-foreground">{error}</div>;
  if (!item) return <div className="p-8 text-center text-muted-foreground">Not found</div>;

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(backPath)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">{item[titleKey]}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setEditOpen(true)}>
            <Pencil className="w-4 h-4" /> Edit
          </Button>
          <Button variant="outline" className="text-destructive gap-2" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
          {fields.map(field => (
            <div key={field.key} className="flex justify-between py-2.5 border-b border-border last:border-0">
              <span className="text-[11px] font-heading font-bold uppercase tracking-wider text-muted-foreground">{field.label}</span>
              <span className="text-sm font-medium text-right">
                {field.render ? field.render(item)
                  : field.type === 'currency' ? formatINR(item[field.key])
                    : field.type === 'date' ? formatDate(item[field.key])
                      : item[field.key] || '—'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {children}

      <EntityFormDialog open={editOpen} onClose={() => setEditOpen(false)} onSubmit={handleUpdate}
        title={`Edit ${entityName}`} fields={formFields} initialData={item} loading={saving} />
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete}
        title="Confirm Delete" description="Are you sure you want to delete this record? This action cannot be undone." />
    </div>
  );
}