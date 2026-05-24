"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { contacts as contactsApi } from "@/lib/api";
import {
  Upload,
  Download,
  Loader2,
  CheckCircle2,
  User,
  FileSpreadsheet,
  ChevronDown,
  Plus,
  X,
  FolderPlus,
  AlertCircle,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";

type TabType = "single" | "csv";

interface ParsedRow {
  name: string;
  phone: string;
  email: string;
  group: string;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const rawHeaders = parseCSVLine(lines[0]);
  const headers = rawHeaders.map((h) => h.toLowerCase().replace(/['"]/g, "").trim());
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const idx = headers.indexOf(k);
        if (idx !== -1) return values[idx]?.replace(/^["']|["']$/g, "").trim() || "";
      }
      return "";
    };
    return {
      name:  get("name", "full name", "full_name", "contact name"),
      phone: get("phone", "phone number", "phone_number", "mobile", "whatsapp"),
      email: get("email", "email address", "email_address"),
      group: get("group", "category", "list", "segment"),
    };
  }).filter((r) => r.name || r.phone);
}

function downloadSampleCSV() {
  const csv = [
    "name,phone,email,group",
    "Rajesh Kumar,+919876543210,rajesh@example.com,Premium Customers",
    "Anita Desai,+918877665544,anita@example.com,Newsletter",
    "Suresh Babu,+917766554433,suresh@example.com,B2B Partners",
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wasend_contacts_sample.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportContactsPage() {
  const [tab, setTab] = useState<TabType>("single");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [groups, setGroups] = useState<string[]>(["Premium Customers", "Newsletter", "Festival Offers", "B2B Partners", "New Leads"]);
  const [groupDropOpen, setGroupDropOpen] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");

  const [form, setForm] = useState({ name: "", phone: "", email: "", tags: "", group: "" });

  useEffect(() => {
    contactsApi.list({ limit: 200 }).then((data) => {
      const existing = Array.from(new Set(data.contacts.map((c) => c.group).filter(Boolean) as string[]));
      setGroups((prev) => Array.from(new Set([...prev, ...existing])));
    }).catch(() => {});
  }, []);

  const handleCreateGroup = () => {
    const trimmed = newGroupName.trim();
    if (!trimmed) return;
    if (!groups.includes(trimmed)) setGroups((prev) => [...prev, trimmed]);
    setForm((p) => ({ ...p, group: trimmed }));
    setNewGroupName("");
    setNewGroupDesc("");
    setShowCreateGroup(false);
    setGroupDropOpen(false);
  };

  const handleSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.phone) { toast.error("Name and phone are required"); return; }
    setLoading(true);
    try {
      await contactsApi.create({
        name: form.name,
        phone: form.phone,
        email: form.email || undefined,
        group: form.group || undefined,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      });
      setSuccess(true);
      toast.success("Contact added successfully!");
      setTimeout(() => {
        setSuccess(false);
        setForm({ name: "", phone: "", email: "", tags: "", group: "" });
      }, 2000);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add contact");
    } finally {
      setLoading(false);
    }
  };

  const processFile = (file: File) => {
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".txt")) {
      toast.error("Please upload a CSV file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length === 0) {
        toast.error("No valid contacts found. Check your CSV format.");
        return;
      }
      setFileName(file.name);
      setParsedRows(rows);
      toast.success(`${rows.length} contact${rows.length !== 1 ? "s" : ""} found in file`);
    };
    reader.onerror = () => toast.error("Failed to read file");
    reader.readAsText(file);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const handleImport = async () => {
    if (!parsedRows.length) return;
    setImporting(true);
    try {
      const data = await contactsApi.bulkImport(
        parsedRows.map((c) => ({ name: c.name, phone: c.phone, email: c.email || undefined, group: c.group || undefined }))
      );
      toast.success(`${data.imported} contact${data.imported !== 1 ? "s" : ""} imported!`);
      setFileName("");
      setParsedRows([]);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-2xl" onClick={() => groupDropOpen && setGroupDropOpen(false)}>
      <PageHeader title="Import Contacts" subtitle="Add contacts individually or import in bulk" />

      <div className="flex gap-1 mb-6 bg-muted/30 p-1 rounded-xl w-fit">
        {[
          { id: "single" as TabType, label: "Single Add", icon: User },
          { id: "csv" as TabType, label: "CSV Import", icon: FileSpreadsheet },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === id ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "single" && (
        <div className="bg-card rounded-2xl border border-border/50 p-6">
          <h3 className="font-semibold mb-5">Add Single Contact</h3>
          <form onSubmit={handleSingle} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium block mb-1.5">Full Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Rajesh Kumar"
                  className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Phone Number *</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="+91 98765 43210"
                  className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Email</label>
              <input
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                type="email"
                placeholder="rajesh@example.com"
                className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="relative">
                <label className="text-sm font-medium block mb-1.5">Group</label>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setGroupDropOpen((o) => !o); }}
                  className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 transition-all flex items-center justify-between"
                >
                  <span className={form.group ? "text-foreground" : "text-muted-foreground"}>
                    {form.group || "Select group..."}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${groupDropOpen ? "rotate-180" : ""}`} />
                </button>

                {groupDropOpen && (
                  <div className="absolute z-30 mt-1 w-full bg-card border border-border rounded-xl shadow-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => { setForm((p) => ({ ...p, group: "" })); setGroupDropOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
                      >
                        No group
                      </button>
                      {groups.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => { setForm((p) => ({ ...p, group: g })); setGroupDropOpen(false); }}
                          className={`w-full text-left px-4 py-2.5 text-sm hover:bg-muted/40 transition-colors flex items-center justify-between ${form.group === g ? "text-primary bg-primary/10" : ""}`}
                        >
                          {g}
                          {form.group === g && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-border/50 p-2">
                      <button
                        type="button"
                        onClick={() => { setShowCreateGroup(true); setGroupDropOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-primary font-medium rounded-lg hover:bg-primary/10 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Create New Group
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Tags</label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
                  placeholder="vip, retail (comma separated)"
                  className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || success}
              className={`flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 ${
                success ? "bg-emerald-500 text-white" : "wa-gradient text-white shadow-lg shadow-primary/25"
              }`}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : success ? (
                <><CheckCircle2 className="w-4 h-4" /> Saved!</>
              ) : (
                "Save Contact"
              )}
            </button>
          </form>
        </div>
      )}

      {tab === "csv" && (
        <div className="space-y-4">
          <div className="bg-card rounded-2xl border border-border/50 p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Upload CSV File</h3>
              <button
                onClick={downloadSampleCSV}
                className="flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <Download className="w-3.5 h-3.5" />
                Download Sample CSV
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Columns: <code className="bg-muted/50 px-1 rounded text-xs">name, phone, email, group</code>
            </p>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : parsedRows.length > 0
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-border/60 hover:border-primary/40 hover:bg-primary/5"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileInput}
                className="hidden"
              />
              {parsedRows.length > 0 ? (
                <>
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                  <p className="font-medium text-emerald-400">{parsedRows.length} contacts ready</p>
                  <p className="text-sm text-muted-foreground mt-1">{fileName}</p>
                </>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="font-medium">Drop your CSV file here</p>
                  <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
                </>
              )}
            </div>
          </div>

          {parsedRows.length > 0 && (
            <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
              <div className="p-4 border-b border-border/50 flex items-center justify-between">
                <h3 className="font-medium text-sm">
                  Preview ({parsedRows.length} contact{parsedRows.length !== 1 ? "s" : ""})
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full">
                    Ready to import
                  </span>
                  <button
                    onClick={() => { setParsedRows([]); setFileName(""); }}
                    className="p-1 rounded hover:bg-muted/50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border/50 bg-muted/10">
                      {["Name", "Phone", "Email", "Group"].map((h) => (
                        <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, i) => (
                      <tr key={i} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-2.5">
                          {row.name || <span className="text-red-400 flex items-center gap-1 text-xs"><AlertCircle className="w-3 h-3" /> Missing</span>}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {row.phone || <span className="text-red-400 flex items-center gap-1 text-xs"><AlertCircle className="w-3 h-3" /> Missing</span>}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{row.email || "—"}</td>
                        <td className="px-4 py-2.5">
                          {row.group ? (
                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{row.group}</span>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t border-border/50 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Duplicates (same phone) will be skipped automatically.
                </p>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {importing ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</>
                  ) : (
                    <><Upload className="w-4 h-4" /> Import {parsedRows.length} Contacts</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showCreateGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg wa-gradient flex items-center justify-center">
                  <FolderPlus className="w-4 h-4 text-white" />
                </div>
                <h3 className="font-semibold text-base">Create New Group</h3>
              </div>
              <button
                onClick={() => { setShowCreateGroup(false); setNewGroupName(""); setNewGroupDesc(""); }}
                className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5">Group Name *</label>
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateGroup()}
                  placeholder="e.g. VIP Customers"
                  className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                <input
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="What kind of contacts will be in this group?"
                  className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowCreateGroup(false); setNewGroupName(""); setNewGroupDesc(""); }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateGroup}
                disabled={!newGroupName.trim()}
                className="flex-1 flex items-center justify-center gap-2 wa-gradient text-white font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40"
              >
                <Plus className="w-4 h-4" />
                Create Group
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
