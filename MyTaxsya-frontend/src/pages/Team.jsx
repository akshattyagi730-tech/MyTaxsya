import { useEffect, useState } from 'react';
import api from '@/services/api';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { UserPlus, ShieldAlert } from 'lucide-react';
import { formatDate } from '@/utils/format';

export default function Team() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [inviting, setInviting] = useState(false);
  // Kept apart from `error`, which replaces the whole page with "Access restricted".
  // A failed invite (already invited, email unavailable) belongs inside the dialog.
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/entities/User', { params: { sort: '-created_date', limit: 200 } });
        setUsers(res.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const closeInvite = () => {
    setInviteOpen(false);
    setInviteError('');
  };

  const handleInvite = async () => {
    setInviting(true);
    setInviteError('');
    try {
      await api.post('/auth/invite', { email: inviteEmail, role: inviteRole });
      closeInvite();
      setInviteEmail('');
      setInviteRole('user');
      const res = await api.get('/entities/User', { params: { sort: '-created_date', limit: 200 } });
      setUsers(res.data);
    } catch (err) {
      setInviteError(err.message || 'Could not send the invitation');
    } finally {
      setInviting(false);
    }
  };

  if (loading) return <div className="p-8"><div className="h-64 rounded-xl bg-muted animate-pulse" /></div>;
  if (error) return (
    <div className="max-w-[1000px] mx-auto">
      <PageHeader title="Team Management" subtitle="Manage your team members" />
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <ShieldAlert className="w-10 h-10 text-accent mx-auto mb-3" />
        <p className="text-sm font-medium mb-1">Access restricted</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Only admin users can view the team member list. If you believe this is an error, ask an admin to upgrade your account role.
        </p>
      </div>
    </div>
  );

  return (
    <div className="max-w-[1000px] mx-auto">
      <PageHeader title="Team Management" subtitle={`${users.length} team members`}>
        <span className="cta-glow">
          <Button className="gap-2" onClick={() => setInviteOpen(true)}>
            <UserPlus className="w-4 h-4" /> Invite Member
          </Button>
        </span>
      </PageHeader>

      {users.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-sm text-muted-foreground">No team members yet. Invite your first member.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-5 py-3">Member</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-5 py-3 hidden md:table-cell">Role</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase px-5 py-3 hidden md:table-cell">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-9 h-9">
                          <AvatarFallback className="bg-gradient-to-br from-primary to-secondary text-white text-xs font-medium">
                            {(u.full_name || u.email || 'U').slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{u.full_name || 'Unnamed'}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      <span className="text-sm capitalize">{u.role || 'user'}</span>
                    </td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      <span className="text-sm text-muted-foreground">{formatDate(u.created_date)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={inviteOpen} onOpenChange={closeInvite}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email Address</Label>
              <Input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@example.com" required />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {inviteError && <p role="alert" className="text-sm text-destructive">{inviteError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeInvite}>Cancel</Button>
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail}>
              {inviting ? 'Inviting...' : 'Send Invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}