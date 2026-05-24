"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { templates as templatesApi, contacts as contactsApi, numbers as numbersApi } from "@/lib/api";
import { Check, ArrowRight, ArrowLeft, Send, Loader2, CheckCircle2, Search } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Template, Contact, WhatsAppNumber } from "@/types";

const steps = ["Select Template", "Select Recipients", "Fill Variables", "Select Number", "Send"];

export default function SendMessagePage() {
  const [step, setStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [selectedNumber, setSelectedNumber] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [approvedTemplates, setApprovedTemplates] = useState<Template[]>([]);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [numberList, setNumberList] = useState<WhatsAppNumber[]>([]);

  useEffect(() => {
    Promise.all([templatesApi.list(), contactsApi.list({ limit: 100 }), numbersApi.list()])
      .then(([t, c, n]) => {
        setApprovedTemplates(t.templates.filter((tmpl) => tmpl.status === "APPROVED"));
        setAllContacts(c.contacts);
        setNumberList(n.numbers.filter((num) => num.status === "active"));
      })
      .catch(console.error);
  }, []);

  const filteredContacts = useMemo(() => allContacts.filter(
    (c) =>
      contactSearch === "" ||
      c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
      c.phone.includes(contactSearch)
  ), [allContacts, contactSearch]);

  const previewBody = (template: Template | null) => {
    if (!template) return "";
    let body = template.body;
    template.variables.forEach((_, i) => {
      body = body.replace(`{{${i + 1}}}`, variables[`var_${i}`] || `[${template.variables[i]}]`);
    });
    return body;
  };

  const handleSend = async () => {
    setSending(true);
    try {
      await new Promise((r) => setTimeout(r, 1500));
      setSent(true);
      toast.success(`Message sent to ${selectedContacts.length} contact(s)!`);
    } finally {
      setSending(false);
    }
  };

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  if (sent) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-12 h-12 text-primary" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Messages Sent! 🎉</h2>
        <p className="text-muted-foreground mb-2">
          Your message has been dispatched successfully
        </p>
        <p className="text-primary font-semibold mb-8">
          {selectedContacts.length} recipient(s) | {selectedTemplate?.displayName}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => { setSent(false); setStep(1); setSelectedTemplate(null); setSelectedContacts([]); setVariables({}); setSelectedNumber(""); }}
            className="px-5 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
          >
            Send Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <PageHeader title="Send Message" subtitle="Send WhatsApp messages to your contacts" />

      <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
        {steps.map((s, i) => {
          const num = i + 1;
          const isCompleted = step > num;
          const isCurrent = step === num;
          return (
            <div key={s} className="flex items-center gap-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    isCompleted ? "bg-primary text-white" : isCurrent ? "bg-primary/20 border-2 border-primary text-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isCompleted ? <Check className="w-3.5 h-3.5" /> : num}
                </div>
                <span className={`text-xs font-medium ${isCurrent ? "text-foreground" : "text-muted-foreground"}`}>{s}</span>
              </div>
              {i < steps.length - 1 && <div className="w-6 h-px bg-border" />}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 bg-card rounded-2xl border border-border/50 p-6">
          {step === 1 && (
            <div className="space-y-4">
              <h3 className="font-semibold">Select a Template</h3>
              <div className="space-y-2">
                {approvedTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTemplate(t)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      selectedTemplate?.id === t.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-border/80 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{t.displayName}</p>
                      {selectedTemplate?.id === t.id && (
                        <Check className="w-4 h-4 text-primary" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.body}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">{t.category}</span>
                      <span className="text-xs text-muted-foreground">{t.language}</span>
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => selectedTemplate && setStep(2)}
                disabled={!selectedTemplate}
                className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h3 className="font-semibold">Select Recipients</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search contacts..."
                  className="w-full bg-muted/50 border border-border rounded-xl pl-9 pr-4 py-2 text-sm outline-none focus:border-primary/60 transition-all"
                />
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-thin">
                {filteredContacts.map((c: Contact) => (
                  <button
                    key={c.id}
                    onClick={() => toggleContact(c.id)}
                    className={`w-full text-left flex items-center gap-3 p-3 rounded-xl transition-all ${
                      selectedContacts.includes(c.id)
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted/30 border border-transparent"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                      {c.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.phone}</p>
                    </div>
                    {selectedContacts.includes(c.id) && (
                      <Check className="w-4 h-4 text-primary flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
              {selectedContacts.length > 0 && (
                <p className="text-sm text-primary font-medium">
                  {selectedContacts.length} contact(s) selected
                </p>
              )}
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => selectedContacts.length > 0 && setStep(3)}
                  disabled={selectedContacts.length === 0}
                  className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40"
                >
                  Next <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && selectedTemplate && (
            <div className="space-y-4">
              <h3 className="font-semibold">Fill Variables</h3>
              <p className="text-sm text-muted-foreground">
                These values will be inserted into your template
              </p>
              {selectedTemplate.variables.map((v, i) => (
                <div key={v}>
                  <label className="text-sm font-medium block mb-1.5">
                    {`{{${i + 1}}}`} — {v}
                  </label>
                  <input
                    value={variables[`var_${i}`] || ""}
                    onChange={(e) => setVariables((prev) => ({ ...prev, [`var_${i}`]: e.target.value }))}
                    placeholder={`Enter ${v}...`}
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
              ))}
              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button onClick={() => setStep(4)} className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all">
                  Next <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h3 className="font-semibold">Select Sending Number</h3>
              <div className="space-y-2">
                {numberList.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setSelectedNumber(n.id)}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      selectedNumber === n.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-border/80 hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{n.phoneNumber}</p>
                        <p className="text-xs text-muted-foreground">{n.displayName}</p>
                      </div>
                      {selectedNumber === n.id && <Check className="w-4 h-4 text-primary" />}
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(3)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => selectedNumber && setStep(5)}
                  disabled={!selectedNumber}
                  className="flex items-center gap-2 wa-gradient text-white font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40"
                >
                  Review & Send <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <h3 className="font-semibold">Review & Send</h3>
              <div className="space-y-3">
                {[
                  { label: "Template", value: selectedTemplate?.displayName },
                  { label: "Recipients", value: `${selectedContacts.length} contacts` },
                  { label: "Sending Number", value: numberList.find((n) => n.id === selectedNumber)?.phoneNumber },
                  { label: "Estimated Cost", value: `₹${selectedContacts.length * 2}` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <span className="text-sm font-medium">{value}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(4)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={handleSend}
                  disabled={sending}
                  className="flex items-center gap-2 wa-gradient text-white font-semibold px-6 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-primary/25"
                >
                  {sending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                  ) : (
                    <><Send className="w-4 h-4" /> Send Now</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <div className="bg-card rounded-2xl border border-border/50 p-5 sticky top-24">
            <p className="text-sm font-medium mb-4 text-muted-foreground">Live Preview</p>
            <div className="bg-[#0a1628] rounded-2xl p-4 min-h-48">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white">W</div>
                <div>
                  <p className="text-xs font-medium text-white">WASend Business</p>
                  <p className="text-[10px] text-green-400">Online</p>
                </div>
              </div>
              {selectedTemplate ? (
                <div className="bg-[#1a2c1e] rounded-2xl rounded-tl-none p-3.5 max-w-[85%] mt-2">
                  <p className="text-sm text-[#dcf8c6] leading-relaxed whitespace-pre-wrap">
                    {previewBody(selectedTemplate)}
                  </p>
                  <p className="text-[10px] text-[#8fbc93] text-right mt-2">12:30 ✓✓</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center mt-8">
                  Select a template to see preview
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
