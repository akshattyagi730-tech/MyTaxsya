import { useState, useMemo } from 'react';
import {
  Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Inbox, AlertTriangle,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function DataTable({
  data = [], columns = [], loading = false, error = null,
  searchKeys = [], pageSize = 10, onRowClick = null, actions = null,
  emptyMessage = 'No records found', toolbar = null,
}) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let result = [...data];
    if (search && searchKeys.length) {
      const q = search.toLowerCase();
      result = result.filter(row =>
        searchKeys.some(k => String(row[k] || '').toLowerCase().includes(q))
      );
    }
    if (sortBy) {
      result.sort((a, b) => {
        const av = a[sortBy], bv = b[sortBy];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number')
          return sortDir === 'asc' ? av - bv : bv - av;
        return sortDir === 'asc'
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }
    return result;
  }, [data, search, searchKeys, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSort = (key) => {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };

  if (loading) {
    return (
      <div>
        <div className="h-10 rounded-lg bg-muted animate-pulse mb-4 max-w-md" />
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="h-12 bg-muted/30 border-b border-border" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-14 border-b border-border last:border-0 bg-card animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-600" />
        </div>
        <p className="text-sm font-medium mb-1">Something went wrong</p>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search..." className="pl-9 h-10" />
        </div>
        {toolbar}
      </div>

      <div className="hidden md:block overflow-x-auto bg-card border border-border rounded-xl">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {columns.map(col => (
                <th key={col.key} className={`text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3 ${col.sortable ? 'cursor-pointer select-none hover:text-foreground' : ''}`}
                  onClick={() => col.sortable && handleSort(col.key)}>
                  <span className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortBy === col.key && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </span>
                </th>
              ))}
              {actions && <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="py-16 text-center">
                  <Inbox className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                </td>
              </tr>
            ) : (
              paginated.map(row => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => onRowClick?.(row)}>
                  {columns.map(col => (
                    <td key={col.key} className="px-4 py-3 text-sm">{col.render ? col.render(row) : row[col.key]}</td>
                  ))}
                  {actions && <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>{actions(row)}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {paginated.length === 0 ? (
          <div className="bg-card border border-border rounded-xl py-12 text-center">
            <Inbox className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : paginated.map(row => (
          <div key={row.id} className="bg-card border border-border rounded-xl p-4 cursor-pointer hover:bg-muted/30"
            onClick={() => onRowClick?.(row)}>
            {columns.slice(0, 3).map(col => (
              <div key={col.key} className="flex justify-between items-center py-1">
                <span className="text-xs text-muted-foreground">{col.label}</span>
                <span className="text-sm font-medium text-right">{col.render ? col.render(row) : row[col.key]}</span>
              </div>
            ))}
            {actions && <div className="mt-2 pt-2 border-t border-border flex justify-end gap-2" onClick={e => e.stopPropagation()}>{actions(row)}</div>}
          </div>
        ))}
      </div>

      {filtered.length > pageSize && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">Showing {paginated.length} of {filtered.length}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm px-2">{currentPage} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}