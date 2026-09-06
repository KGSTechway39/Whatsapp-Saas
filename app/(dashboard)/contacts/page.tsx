"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { contacts as contactsApi } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Contact } from "@/types";
import {
  Search, Plus, Upload, Edit2, Trash2,
  ChevronLeft, ChevronRight, Filter, Users, Download,
} from "lucide-react";
import { TableRowSkeleton } from "@/components/shared/Skeleton";
import { ConsentBanner, ConsentBulkBar, ConsentCell } from "@/components/contacts/ConsentControls";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

const PER_PAGE = 20;

export default function ContactsPage() {
  const [contactList, setContactList] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [groups, setGroups] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  // Consent is a property of the tenant's INDUSTRY, so it arrives with the
  // list. When false, every consent affordance below is omitted entirely.
  const [consentRequired, setConsentRequired] = useState(false);
  const [consentIndustry, setConsentIndustry] = useState("");
  const [onlyMissingConsent, setOnlyMissingConsent] = useState(false);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await contactsApi.list({ search, group: groupFilter, page, limit: PER_PAGE });
      setContactList(data.contacts);
      setTotal(data.total);
      setConsentRequired(Boolean(data.consentRequired));
      setConsentIndustry(data.consentRequiredBecause || "");
    } catch {
      toast.error("Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [search, groupFilter, page]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  /** Flip one row locally so the table reflects a saved change immediately. */
  const applyConsent = (id: string, given: boolean) =>
    setContactList((prev) => prev.map((c) => (c.id === id ? { ...c, consentGiven: given } : c)));

  const missingConsent = consentRequired
    ? contactList.filter((c) => !c.consentGiven).length
    : 0;
  const visibleContacts =
    consentRequired && onlyMissingConsent
      ? contactList.filter((c) => !c.consentGiven)
      : contactList;

  useEffect(() => {
    contactsApi.list({ limit: 500 }).then((data) => {
      const unique = Array.from(new Set(data.contacts.map((c) => c.group).filter(Boolean) as string[]));
      setGroups(unique);
    }).catch(() => {});
  }, []);

  const totalPages = Math.ceil(total / PER_PAGE);

  const toggleSelect = (id: string) => {
    setSelected((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  };

  // Operates on what is VISIBLE, not on the whole page. With the "only people
  // who haven't agreed" filter on, selecting rows the user cannot see — and
  // then bulk-acting on them — is how a bulk action does something nobody
  // intended.
  const selectAll = () => {
    const visible = visibleContacts.map((c) => c.id);
    if (visible.every((id) => selected.includes(id)) && visible.length > 0) setSelected([]);
    else setSelected(visible);
  };

  const handleDelete = async (id: string) => {
    try {
      await contactsApi.remove(id);
      toast.success("Contact deleted");
      fetchContacts();
    } catch {
      toast.error("Failed to delete contact");
    }
  };

  const handleBulkDelete = async () => {
    try {
      await contactsApi.bulkDelete(selected);
      toast.success(`${selected.length} contacts deleted`);
      setSelected([]);
      fetchContacts();
    } catch {
      toast.error("Failed to delete contacts");
    }
  };

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Contacts"
        subtitle={`${total} total contacts`}
        action={
          <div className="flex gap-2">
            <button
              onClick={() => {
                const rows = [["Name","Phone","Email","Group","Tags","Added"]];
                contactList.forEach(c => rows.push([c.name, c.phone, c.email||"", c.group||"", c.tags.join(";"), c.addedDate||""]));
                const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
                const a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
                a.download = "contacts.csv"; a.click();
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <Link
              href="/contacts/import"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">Import CSV</span>
            </Link>
            <Link
              href="/contacts/import"
              className="flex items-center gap-2 wa-gradient text-primary-foreground text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Contact</span>
            </Link>
          </div>
        }
      />

      {consentRequired && (
        <div className="mb-4">
          <ConsentBanner
            industryName={consentIndustry}
            missingCount={missingConsent}
            onShowMissing={onlyMissingConsent ? undefined : () => setOnlyMissingConsent(true)}
          />
          {onlyMissingConsent && (
            <button
              onClick={() => setOnlyMissingConsent(false)}
              className="mt-2 text-sm font-medium text-primary hover:underline"
            >
              Show everyone again
            </button>
          )}
        </div>
      )}

      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="p-4 border-b border-border/50 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name or phone..."
              className="w-full bg-muted/50 border border-border rounded-xl pl-9 pr-4 py-2 text-sm outline-none focus:border-primary/60 transition-all"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <select
              value={groupFilter}
              onChange={(e) => { setGroupFilter(e.target.value); setPage(1); }}
              className="bg-muted/50 border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60 transition-all"
            >
              <option value="all">All Groups</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          {selected.length > 0 && (
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-destructive-soft text-destructive text-sm font-medium hover:bg-destructive-soft transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete ({selected.length})
            </button>
          )}
        </div>

        {/* Own full-width band. Inside the filter row it competed for
            horizontal space and collapsed the search box to a stub. */}
        {consentRequired && selected.length > 0 && (
          <div className="border-b border-border/50 p-4">
            <ConsentBulkBar
              count={selected.length}
              contactIds={selected}
              onDone={() => { setSelected([]); fetchContacts(); }}
              onCancel={() => setSelected([])}
            />
          </div>
        )}

        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50 bg-muted/10">
                  <th className="px-4 py-3 w-8" />
                  {["Name", "Phone", "Group", "Tags", "Added", "Actions"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 8 }).map((_, i) => <TableRowSkeleton key={i} cols={7} />)}
              </tbody>
            </table>
          </div>
        ) : contactList.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No contacts found"
            description="Try adjusting your search or add new contacts"
            action={
              <Link href="/contacts/import" className="wa-gradient text-primary-foreground text-sm font-semibold px-4 py-2 rounded-xl hover:opacity-90 transition-all">
                Add Contact
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50 bg-muted/10">
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={visibleContacts.length > 0 && visibleContacts.every((c) => selected.includes(c.id))}
                      onChange={selectAll}
                      className="rounded accent-primary"
                    />
                  </th>
                  {["Name", "Phone", ...(consentRequired ? ["Can we message?"] : []), "Group", "Tags", "Added", "Actions"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleContacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className={`border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors ${selected.includes(contact.id) ? "bg-primary/5" : ""}`}
                  >
                    <td className="px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={selected.includes(contact.id)}
                        onChange={() => toggleSelect(contact.id)}
                        className="rounded accent-primary"
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                          {contact.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{contact.name}</p>
                          <p className="text-xs text-muted-foreground">{contact.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm">{contact.phone}</td>
                    {consentRequired && (
                      <td className="px-4 py-3.5">
                        <ConsentCell
                          contactId={contact.id}
                          contactName={contact.name}
                          given={Boolean(contact.consentGiven)}
                          at={contact.consentAt}
                          onChanged={(given) => applyConsent(contact.id, given)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3.5">
                      <span className="text-xs bg-muted/50 px-2 py-1 rounded-lg">{contact.group || "—"}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {contact.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{tag}</span>
                        ))}
                        {contact.tags.length > 2 && (
                          <span className="text-xs text-muted-foreground">+{contact.tags.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{formatDate(contact.addedDate)}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1">
                        <button className="p-1.5 rounded-lg hover:bg-accent transition-colors">
                          <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => handleDelete(contact.id)}
                          className="p-1.5 rounded-lg hover:bg-destructive-soft transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t border-border/50">
            <p className="text-xs text-muted-foreground">
              Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg hover:bg-accent transition-colors disabled:opacity-40">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors ${page === p ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                >
                  {p}
                </button>
              ))}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded-lg hover:bg-accent transition-colors disabled:opacity-40">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
