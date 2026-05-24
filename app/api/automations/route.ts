import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("automations")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const automations = data.map((a) => ({
    id: a.id,
    name: a.name,
    trigger: { type: a.trigger_type, value: a.trigger_value },
    action: {
      type: a.action_type,
      templateId: a.action_template_id,
      groupName: a.action_group_name,
      tag: a.action_tag,
      delayHours: a.action_delay_hours,
    },
    isActive: a.is_active,
    createdAt: a.created_at,
    lastTriggered: a.last_triggered,
  }));

  return NextResponse.json({ automations });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, trigger, action } = body;

  if (!name || !trigger?.type || !action?.type) {
    return NextResponse.json({ error: "Name, trigger, and action required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("automations")
    .insert({
      user_id: user.id,
      name,
      trigger_type: trigger.type,
      trigger_value: trigger.value || null,
      action_type: action.type,
      action_template_id: action.templateId || null,
      action_group_name: action.groupName || null,
      action_tag: action.tag || null,
      action_delay_hours: action.delayHours || null,
      is_active: true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, name: data.name, isActive: data.is_active }, { status: 201 });
}
