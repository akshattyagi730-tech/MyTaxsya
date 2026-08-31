import { useEffect, useState } from 'react';
import api from '@/services/api';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Bell, CheckCheck, Trash2, Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { formatDate } from '@/utils/format';

const typeIcons = { info: Info, success: CheckCircle, warning: AlertTriangle, error: XCircle };
const typeColors = { info: 'text-primary', success: 'text-secondary', warning: 'text-accent', error: 'text-destructive' };

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/entities/Notification', { params: { sort: '-created_date', limit: 200 } });
      setNotifications(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const markAsRead = async (id) => {
    await api.put(`/entities/Notification/${id}`, { read: true });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.read);
    await Promise.all(unread.map(n => api.put(`/entities/Notification/${n.id}`, { read: true })));
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const deleteNotification = async (id) => {
    await api.delete(`/entities/Notification/${id}`);
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  if (loading) return <div className="p-8"><div className="h-64 rounded-xl bg-muted animate-pulse" /></div>;
  if (error) return <div className="p-8 text-center text-muted-foreground">{error}</div>;

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="max-w-[1000px] mx-auto">
      <PageHeader title="Notifications" subtitle={`${unreadCount} unread of ${notifications.length} total`}>
        {unreadCount > 0 && (
          <Button variant="outline" className="gap-2" onClick={markAllRead}>
            <CheckCheck className="w-4 h-4" /> Mark all read
          </Button>
        )}
      </PageHeader>

      {notifications.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Bell className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(n => {
            const Icon = typeIcons[n.type] || Info;
            return (
              <div key={n.id} className={`bg-card border border-border rounded-xl p-4 flex items-start gap-3 ${!n.read ? 'border-l-4 border-l-indigo-500' : ''}`}>
                <div className={`w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 ${typeColors[n.type] || 'text-muted-foreground'}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{n.title}</p>
                    <span className="text-xs text-muted-foreground">{formatDate(n.created_date)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{n.message}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!n.read && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => markAsRead(n.id)} title="Mark as read">
                      <CheckCheck className="w-4 h-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteNotification(n.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}