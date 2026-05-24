"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { team as teamApi } from "@/lib/api";
import { formatDate, getInitials } from "@/lib/utils";
import {
  UserPlus, Loader2, X, Trash2, MoreVertical, Shield, User, Headphones,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

type MemberRole = "owner" | "admin" | "agent";
type MemberStatus = "active" | "invited" | "inactive";
interface Member {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  joinedDate: string;
}

const roleColors = {
  owner: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  admin: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
  agent: "bg-muted/50 text-muted-foreground border border-border",
};

const roleIcons = {
  owner: Shield,
  admin: User,
  agent: Headphones,
};

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("agent");
  const [inviting, setInviting] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    teamApi.list()
      .then((data) => setMembers(data.members as Member[]))
      .catch(() => toast.error("Failed to load team"));
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) { toast.error("Email is required"); return; }
    setInviting(true);
    try {
      const member = await teamApi.invite({ email: inviteEmail, role: inviteRole });
      setMembers((prev) => [...prev, member as Member]);
      toast.success(`Invite sent to ${inviteEmail}`);
      setShowInvite(false);
      setInviteEmail("");
      setInviteRole("agent");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await teamApi.remove(id);
      setMembers((prev) => prev.filter((m) => m.id !== id));
      toast.success("Member removed");
      setOpenMenu(null);
    } catch {
      toast.error("Failed to remove member");
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Team Members"
        subtitle={`${members.length} members`}
        action={
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-2 wa-gradient text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/25"
          >
            <UserPlus className="w-4 h-4" />
            Invite Member
          </button>
        }
      />

      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50 bg-muted/10">
                {["Member", "Email", "Role", "Status", "Joined", "Actions"].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground px-5 py-3.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const RoleIcon = roleIcons[member.role];
                return (
                  <tr
                    key={member.id}
                    className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full wa-gradient flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                          {getInitials(member.name)}
                        </div>
                        <p className="text-sm font-medium">{member.name}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">{member.email}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${roleColors[member.role]}`}>
                        <RoleIcon className="w-3 h-3" />
                        {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={member.status} />
                    </td>
                    <td className="px-5 py-4 text-sm text-muted-foreground">
                      {formatDate(member.joinedDate)}
                    </td>
                    <td className="px-5 py-4">
                      {member.role !== "owner" && (
                        <div className="relative">
                          <button
                            onClick={() => setOpenMenu(openMenu === member.id ? null : member.id)}
                            className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                          >
                            <MoreVertical className="w-4 h-4 text-muted-foreground" />
                          </button>
                          {openMenu === member.id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
                              <div className="absolute right-0 top-8 bg-card border border-border rounded-xl shadow-xl z-20 overflow-hidden w-36">
                                <button className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors w-full text-left">
                                  <User className="w-3.5 h-3.5" /> Change Role
                                </button>
                                <button
                                  onClick={() => handleRemove(member.id)}
                                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors w-full text-left"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Remove
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showInvite && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setShowInvite(false)} />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl animate-fade-in">
              <div className="flex items-center justify-between p-5 border-b border-border">
                <div>
                  <h3 className="font-semibold">Invite Team Member</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    They&apos;ll receive an email invite
                  </p>
                </div>
                <button
                  onClick={() => setShowInvite(false)}
                  className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleInvite} className="p-5 space-y-4">
                <div>
                  <label className="text-sm font-medium block mb-1.5">Email Address *</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1.5">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full bg-muted/50 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60 transition-all"
                  >
                    <option value="admin">Admin — Full access except billing</option>
                    <option value="agent">Agent — View and send messages only</option>
                  </select>
                </div>
                <div className="bg-muted/30 rounded-xl p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Role permissions:</p>
                  <p>• <strong>Admin:</strong> Manage numbers, contacts, campaigns</p>
                  <p>• <strong>Agent:</strong> View data, send messages</p>
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowInvite(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-border hover:bg-accent text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={inviting}
                    className="flex-1 flex items-center justify-center gap-2 wa-gradient text-white font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 transition-all disabled:opacity-50"
                  >
                    {inviting ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                    ) : (
                      <><UserPlus className="w-4 h-4" /> Send Invite</>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
