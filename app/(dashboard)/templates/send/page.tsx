"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { templates as templatesApi, contacts as contactsApi, numbers as numbersApi } from "@/lib/api";
import { Check, ArrowRight, ArrowLeft, Send, Loader2, CheckCircle2, Search, Smartphone, MessageSquare } from "lucide-react";
import Link from "next/link";
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
  // Kept separately so the empty state can tell the two cases apart:
  // "you have no number" vs "you have one but it isn't active". They need
  // different advice, and collapsing them into one blank panel is what made
  // this step look broken.
  const [totalNumbers, setTotalNumbers] = useState(0);
  // Templates that exist locally vs. templates WhatsApp will actually accept.
  // The gap between them is the whole story on this screen.
  const [totalTemplates, setTotalTemplates] = useState(0);

  useEffect(() => {
    Promise.all([templatesApi.list(), contactsApi.list({ limit: 100 }), numbersApi.list()])
      .then(([t, c, n]) => {
        // Sendable, not merely APPROVED — a template Meta never received would
        // fail at send time with a misleading "does not exist" error.
        setTotalTemplates(t.templates.length);
        setApprovedTemplates(t.templates.filter((tmpl) => tmpl.sendable !== false && tmpl.status === "APPROVED"));
        setAllContacts(c.contacts);
        setTotalNumbers(n.numbers.length);
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

  /**
   * Actually send.
   *
   * This previously did `await sleep(1500); setSent(true)` — it called no API
   * at all and reported success unconditionally, so the wizard claimed every
   * message was delivered while nothing was ever sent. Now it posts one real
   * send per recipient and reports what actually happened, including partial
   * failures. A send screen that cannot fail is not a send screen.
   */
  const handleSend = async () => {
    if (!selectedTemplate || !selectedNumber) return;
    setSending(true);

    const chosen = allContacts.filter((c) => selectedContacts.includes(c.id));
    const failures: { name: string; error: string }[] = [];
    let ok = 0;

    try {
      for (const contact of chosen) {
        // Positional template parameters, in the order Meta expects.
        const components = selectedTemplate.variables.length
          ? [{
              type: "body",
              parameters: selectedTemplate.variables.map((_, i) => ({
                type: "text",
                text: variables[`var_${i}`] || contact.name,
              })),
            }]
          : [];

        try {
          const res = await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              numberId: selectedNumber,
              to: contact.phone,
              type: "template",
              templateName: selectedTemplate.name,
              languageCode: selectedTemplate.language || "en_US",
              components,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `Send failed (${res.status})`);
          ok++;
        } catch (err) {
          failures.push({ name: contact.name, error: (err as Error).message });
        }
      }

      if (ok > 0 && failures.length === 0) {
        setSent(true);
        toast.success(`Sent to ${ok} contact${ok === 1 ? "" : "s"}`);
      } else if (ok > 0) {
        // Partial success is reported as such — the ones that went, went.
        setSent(true);
        toast.warning(`Sent to ${ok}, failed for ${failures.length}. ${failures[0].error}`);
      } else {
        // Nothing sent → do NOT show the success screen.
        toast.error(failures[0]?.error || "Couldn't send. Please try again.");
      }
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
                    isCompleted ? "bg-primary text-primary-foreground" : isCurrent ? "bg-primary/20 border-2 border-primary text-primary" : "bg-muted text-muted-foreground"
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
                {approvedTemplates.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center">
                    <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" />
                    {totalTemplates === 0 ? (
                      <>
                        <p className="mt-3 font-medium">No templates yet</p>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                          You need an approved template before you can message someone who
                          hasn&apos;t written to you first.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="mt-3 font-medium">None of your templates are on WhatsApp yet</p>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                          You have {totalTemplates} template{totalTemplates === 1 ? "" : "s"} saved
                          here, but WhatsApp hasn&apos;t approved any of them — so they can&apos;t be
                          sent. Add one from the Meta Library, then sync.
                        </p>
                      </>
                    )}
                    <Link
                      href="/templates"
                      className="mt-4 inline-flex items-center gap-2 rounded-xl wa-gradient px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                    >
                      Go to Templates
                    </Link>
                  </div>
                )}
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
                      <span className="text-xs bg-accent text-primary px-2 py-0.5 rounded-full">{t.category}</span>
                      <span className="text-xs text-muted-foreground">{t.language}</span>
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => selectedTemplate && setStep(2)}
                disabled={!selectedTemplate}
                className="flex items-center gap-2 wa-gradient text-primary-foreground font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
                  className="flex items-center gap-2 wa-gradient text-primary-foreground font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40"
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
                <button onClick={() => setStep(4)} className="flex items-center gap-2 wa-gradient text-primary-foreground font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all">
                  Next <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h3 className="font-semibold">Select Sending Number</h3>
              <div className="space-y-2">
                {numberList.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center">
                    <Smartphone className="mx-auto h-8 w-8 text-muted-foreground" />
                    {totalNumbers === 0 ? (
                      <>
                        <p className="mt-3 font-medium">No WhatsApp number connected</p>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                          You need a connected number before you can send. It takes a few minutes.
                        </p>
                        <Link
                          href="/numbers/connect"
                          className="mt-4 inline-flex items-center gap-2 rounded-xl wa-gradient px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                        >
                          Connect a number
                        </Link>
                      </>
                    ) : (
                      <>
                        <p className="mt-3 font-medium">
                          Your number isn&apos;t active yet
                        </p>
                        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                          {totalNumbers === 1 ? "The number you connected is" : "Your numbers are"} still
                          being set up, so {totalNumbers === 1 ? "it" : "they"} can&apos;t send messages
                          right now. Check its status on the numbers page.
                        </p>
                        <Link
                          href="/numbers"
                          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-accent"
                        >
                          View my numbers
                        </Link>
                      </>
                    )}
                  </div>
                )}
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
                  className="flex items-center gap-2 wa-gradient text-primary-foreground font-semibold px-5 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-40"
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
                  className="flex items-center gap-2 wa-gradient text-primary-foreground font-semibold px-6 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-primary/25"
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
            <div className="bg-rail rounded-2xl p-4 min-h-48">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white">W</div>
                <div>
                  <p className="text-xs font-medium text-white">SendAnjal Business</p>
                  <p className="text-[10px] text-success">Online</p>
                </div>
              </div>
              {selectedTemplate ? (
                <div className="bg-chat-out rounded-2xl rounded-tl-none p-3.5 max-w-[85%] mt-2">
                  <p className="text-sm text-chat-outForeground leading-relaxed whitespace-pre-wrap">
                    {previewBody(selectedTemplate)}
                  </p>
                  <p className="text-[10px] text-muted-foreground text-right mt-2">12:30 ✓✓</p>
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
