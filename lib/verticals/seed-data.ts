/**
 * Phase 5 seed content — the real rows for every shipped vertical.
 *
 * This is DATA, not logic. It exists as a TS module only so the seeder can run it
 * through the real `sanitizeFlowGraph` before insert (Phase 0 risk #2); nothing in
 * the app imports vertical content from here at render time. Everything a client
 * or admin sees is read back out of the database, so an admin can edit or add a
 * vertical without a deploy.
 *
 * FLOW CONSTRAINTS (Phase 0 §2) — every graph below:
 *   • uses ONLY the 9 canvas node types in lib/automation/flow-schema.ts
 *   • has exactly one triggerNode
 *   • uses the config keys the executor actually reads
 *     (app/api/automation-flows/[id]/execute/route.ts)
 *
 * RUNTIME HONESTY: production currently delivers a flow's FIRST reply only
 * (lib/whatsapp/queue.ts → renderFirstReply). Multi-step graphs store, render and
 * edit correctly today and run in full once the persistent worker lands. The
 * `outcome` copy below never promises a later step as if it already fires — the
 * UI labels multi-step flows explicitly instead.
 */

import type { CanvasGraph } from "@/lib/automation/flow-schema";
import { asks, branched, done, handoff, linear, say, tag, trigger, wait } from "./flow-builders";
import type {
  BookingContext,
  CampaignPromptPayload,
  FlowJsonPayload,
  MessageTemplatePayload,
  MetaTemplateCategory,
} from "./types";

// ─── Row shapes ─────────────────────────────────────────────────────────────

interface SeedItemBase {
  title: string;
  description: string;
  outcome: string;
  adminNote?: string;
  sortOrder: number;
}

export type SeedItem =
  | (SeedItemBase & { kind: "FLOW_JSON"; payload: FlowJsonPayload })
  | (SeedItemBase & { kind: "CAMPAIGN_PROMPT"; payload: CampaignPromptPayload })
  | (SeedItemBase & { kind: "MESSAGE_TEMPLATE"; payload: MessageTemplatePayload; metaCategory: MetaTemplateCategory });

export interface SeedVertical {
  slug: string;
  displayName: string;
  description: string;
  icon: string;
  sortOrder: number;
  isBuiltin: boolean;
  items: SeedItem[];
}

const flow = (
  base: SeedItemBase,
  graph: CanvasGraph,
  triggerType: string,
  bookingContext?: BookingContext,
): SeedItem => ({
  ...base,
  kind: "FLOW_JSON",
  payload: { flow: graph, triggerType, ...(bookingContext ? { bookingContext } : {}) },
});

const prompt = (base: SeedItemBase, payload: CampaignPromptPayload): SeedItem => ({
  ...base,
  kind: "CAMPAIGN_PROMPT",
  payload,
});

const template = (
  base: SeedItemBase,
  metaCategory: MetaTemplateCategory,
  payload: Omit<MessageTemplatePayload, "language"> & { language?: string },
): SeedItem => ({
  ...base,
  kind: "MESSAGE_TEMPLATE",
  metaCategory,
  payload: { language: "en", ...payload },
});

// ════════════════════════════════════════════════════════════════════════════
// HOSPITAL
// ════════════════════════════════════════════════════════════════════════════

const HOSPITAL: SeedVertical = {
  slug: "hospital",
  displayName: "Hospital & Clinic",
  description: "Clinics, diagnostic centres and hospitals that book patient visits.",
  icon: "Stethoscope",
  sortOrder: 10,
  isBuiltin: true,
  items: [
    flow(
      {
        title: "Book an appointment",
        description: "Replies when a patient asks for an appointment and collects what your front desk needs.",
        outcome: "Patients can book without calling, so your front desk phone stays free.",
        sortOrder: 10,
      },
      linear([
        trigger("appointment, book, booking, doctor, consult, slot", [
          "I want to book an appointment",
          "Is the doctor available today",
          "Can I see a doctor tomorrow",
        ]),
        say(
          "n2",
          "Ask what they need",
          "Hello {{name}}, happy to help you book. Please reply with:\n1) Which department or doctor\n2) Your preferred day\n3) Morning or evening",
        ),
        tag("n3", "appointment-request"),
        handoff("n4", "Front desk", "Patient wants an appointment — confirm the slot and reply."),
        done(),
      ]),
      "keyword",
      {
        captureFields: [
          { key: "department", label: "Which department or doctor", required: true },
          { key: "preferred_day", label: "Preferred day", required: true },
          { key: "preferred_time", label: "Morning or evening", options: ["Morning", "Evening"], required: true },
          { key: "patient_name", label: "Patient name", required: false },
        ],
        confirmationCopy:
          "Your appointment with {{doctor}} is confirmed for {{date}} at {{time}}. Please arrive 10 minutes early.",
        reminderCadenceHours: [24, 2, 0.5],
      },
    ),

    flow(
      {
        title: "Remind patients before their visit",
        description: "Sends a reminder the day before, again two hours before, and once just before the slot.",
        outcome: "Fewer patients forget their slot, so fewer empty chairs in the day's schedule.",
        sortOrder: 20,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Appointment is booked",
          config: { triggerType: "keyword", keywords: "confirmed appointment", intents: ["My appointment is booked"] },
        },
        say("n2", "Day-before reminder", "Hello {{name}}, a reminder about your appointment tomorrow. Reply CHANGE if you need a different time."),
        wait("n3", 22, "hours"),
        say("n4", "Two hours before", "Hello {{name}}, your appointment is in about 2 hours. Please arrive 10 minutes early."),
        wait("n5", 90, "minutes"),
        say("n6", "Just before", "Hello {{name}}, we are ready for you. Please come to the reception desk."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Check in after treatment",
        description: "Messages the patient two days after their visit to ask how they are feeling.",
        outcome: "Patients feel looked after, and you hear about problems early instead of in a bad review.",
        sortOrder: 30,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Visit is finished",
          config: { triggerType: "keyword", keywords: "visit complete, discharged", intents: ["My visit is done"] },
        },
        wait("n2", 2, "days"),
        say("n3", "Ask how they are", "Hello {{name}}, hope you are feeling better after your visit. Reply GOOD, or reply HELP if something is troubling you."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Remind about a repeat medicine",
        description: "Reminds a patient when their regular medicine is due to run out.",
        outcome: "Patients do not run out of a regular medicine, and your pharmacy keeps the repeat business.",
        sortOrder: 40,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Medicine is due",
          config: { triggerType: "keyword", keywords: "refill, medicine, tablets, prescription", intents: ["I need my medicines again"] },
        },
        say("n2", "Offer to keep it ready", "Hello {{name}}, your regular medicine is due for a repeat. Reply READY and our pharmacy will keep it aside for you."),
        tag("n3", "refill-due"),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Tell patients their report is ready",
        description:
          "Lets the patient know a report is ready to collect. It never puts the actual results in the message.",
        outcome: "Patients stop calling to ask if the report is ready, and private results stay private.",
        adminNote:
          "Doorbell pattern — this message must only announce readiness. Never add readings, values or findings to the body: WhatsApp copies sit on shared family phones and in message history. DPDP Act exposure.",
        sortOrder: 50,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Report is ready",
          config: { triggerType: "keyword", keywords: "report, result, ready", intents: ["Is my report ready"] },
        },
        say(
          "n2",
          "Announce it is ready",
          "Hello {{name}}, your report is ready. You can collect it at the front desk, or reply COLLECT and we will guide you.",
        ),
        done(),
      ]),
      "keyword",
    ),

    prompt(
      {
        title: "This week's appointment reminders",
        description: "Writes a short, warm reminder to send to everyone booked this week.",
        outcome: "One message goes out to the whole week's list instead of the desk calling each patient.",
        sortOrder: 60,
      },
      {
        prompt:
          "Write a short, warm WhatsApp reminder for patients who have an appointment at our clinic this week. Mention the day and time as blanks to fill in, ask them to arrive 10 minutes early, and offer a simple way to change the time. Keep it under 3 lines. Polite and reassuring, not clinical.",
        goal: "Reduce missed appointments this week",
        audienceHint: "Patients with a booking in the next 7 days",
      },
    ),

    prompt(
      {
        title: "Yearly check-up nudge",
        description: "Writes a gentle message inviting past patients to book their yearly check-up.",
        outcome: "Brings back patients you have not seen in a year, without sounding like an advertisement.",
        sortOrder: 70,
      },
      {
        prompt:
          "Write a gentle WhatsApp message inviting patients who last visited about a year ago to book their annual health check-up. Explain the benefit in one line, avoid fear or alarming language, avoid naming any illness, and end with a simple way to book. Under 4 lines.",
        goal: "Bring back patients due for an annual check-up",
        audienceHint: "Patients whose last visit was 10–14 months ago",
      },
    ),

    template(
      {
        title: "Appointment confirmed",
        description: "Sent as soon as a patient's slot is fixed.",
        outcome: "The patient has the day, time and doctor in writing, so fewer mix-ups at the desk.",
        sortOrder: 80,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, your appointment with {{2}} is confirmed for {{3}} at {{4}}. Please arrive 10 minutes early. Reply CHANGE if you need a different time.",
        footer: "Reply STOP to opt out",
        variableNames: ["patient_name", "doctor_name", "date", "time"],
      },
    ),

    template(
      {
        title: "Appointment reminder",
        description: "Sent the day before the visit.",
        outcome: "Reminds the patient while there is still time for them to tell you if they cannot come.",
        sortOrder: 90,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, a reminder about your appointment with {{2}} on {{3}} at {{4}}. Reply CHANGE if you need a different time.",
        variableNames: ["patient_name", "doctor_name", "date", "time"],
      },
    ),

    template(
      {
        title: "New time confirmed",
        description: "Sent when a patient's appointment has been moved.",
        outcome: "The patient sees the new time in writing, so nobody turns up at the old one.",
        sortOrder: 100,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, your appointment has been moved to {{2}} at {{3}}. Your earlier slot has been released. See you then.",
        variableNames: ["patient_name", "new_date", "new_time"],
      },
    ),

    template(
      {
        title: "Report ready to collect",
        description: "Tells the patient their report is ready, without showing any results.",
        outcome: "Stops the 'is it ready yet' phone calls while keeping private results off WhatsApp.",
        adminNote:
          "Never edit results, readings or findings into this body. Announce readiness only — the patient collects or logs in to see the report itself.",
        sortOrder: 110,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, your report from {{2}} is ready. You can collect it at our front desk between {{3}}. Reply COLLECT if you would like us to guide you.",
        variableNames: ["patient_name", "visit_date", "collection_hours"],
      },
    ),

    template(
      {
        title: "Medicine repeat reminder",
        description: "Reminds a patient that their regular medicine is running out.",
        outcome: "Patients refill on time and your pharmacy keeps the repeat sale.",
        sortOrder: 120,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, your regular medicine from {{2}} is due for a repeat around {{3}}. Reply READY and our pharmacy will keep it aside for you.",
        variableNames: ["patient_name", "doctor_name", "due_date"],
      },
    ),
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// E-COMMERCE
// ════════════════════════════════════════════════════════════════════════════

const ECOMMERCE: SeedVertical = {
  slug: "ecommerce",
  displayName: "Online store",
  description: "Shops selling online that take orders, ship them and chase carts.",
  icon: "ShoppingBag",
  sortOrder: 20,
  isBuiltin: true,
  items: [
    flow(
      {
        title: "Win back an abandoned basket",
        description: "Messages a shopper who left items in their basket, three times over two days.",
        outcome: "Recovers sales from shoppers who were nearly finished but got distracted.",
        sortOrder: 10,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Basket left behind",
          config: { triggerType: "keyword", keywords: "cart, basket, checkout", intents: ["I left something in my cart"] },
        },
        say("n2", "First nudge", "Hello {{name}}, you left a few items in your basket. Reply BUY and we will send you the link to finish."),
        wait("n3", 20, "hours"),
        say("n4", "Second nudge", "Hello {{name}}, your items are still saved. Stock is limited — reply BUY to complete your order."),
        wait("n5", 1, "days"),
        say("n6", "Last nudge", "Hello {{name}}, last reminder about your basket. Reply BUY to order, or reply STOP and we will not message again."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Confirm a new order",
        description: "Sends an instant confirmation the moment an order is placed.",
        outcome: "Shoppers stop messaging to ask whether their order went through.",
        sortOrder: 20,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Order placed",
          config: { triggerType: "keyword", keywords: "order placed, ordered", intents: ["I just placed an order"] },
        },
        say("n2", "Confirm it", "Hello {{name}}, we have your order. We will message you as soon as it is packed and on its way."),
        tag("n3", "customer"),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Confirm a cash-on-delivery order",
        description: "Asks the shopper to confirm the order and the amount before you send it out.",
        outcome: "Cuts refused deliveries, so you stop paying return shipping on orders nobody wanted.",
        sortOrder: 30,
      },
      branched({
        before: [
          {
            id: "n1",
            type: "triggerNode",
            label: "Cash order placed",
            config: { triggerType: "keyword", keywords: "cod, cash on delivery", intents: ["I want cash on delivery"] },
          },
          say(
            "n2",
            "Ask them to confirm",
            "Hello {{name}}, please confirm your cash-on-delivery order and the amount payable. Reply YES to confirm, or NO to cancel. We will pack it once you confirm.",
          ),
        ],
        condition: asks("n3", "yes", "Did they say yes?"),
        onYes: [
          say("n4", "Confirmed", "Thank you {{name}}. Your order is confirmed and will be packed today. Please keep the exact amount ready."),
          tag("n5", "cod-confirmed"),
        ],
        onNo: [
          say("n6", "Cancelled", "No problem {{name}}, we have cancelled it. Reply if you would like to order something else."),
          tag("n7", "cod-declined"),
        ],
        end: done(),
      }),
      "keyword",
    ),

    flow(
      {
        title: "Send shipping updates",
        description: "Tells the shopper when the order ships and gives them a way to follow it.",
        outcome: "Fewer 'where is my order' messages for your team to answer by hand.",
        sortOrder: 40,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Order shipped",
          config: { triggerType: "keyword", keywords: "shipped, dispatched", intents: ["Has my order shipped"] },
        },
        say("n2", "Share the update", "Good news {{name}} — your order is on its way. Reply TRACK any time and we will send the latest update."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Answer 'where is my order'",
        description: "Recognises when someone is asking about their delivery and replies straight away.",
        outcome: "Shoppers get an answer at 11pm without anyone from your team being awake.",
        sortOrder: 50,
      },
      linear([
        trigger("where is my order, order status, delivery, track, kab aayega", [
          "Where is my order",
          "When will it be delivered",
          "My parcel has not arrived",
        ]),
        say("n2", "Acknowledge", "Hello {{name}}, let me check your order. Please reply with your order number and I will pull up the latest status."),
        {
          id: "n3",
          type: "httpRequestNode",
          label: "Look up the order",
          config: { url: "", method: "POST", body: "" },
        },
        handoff("n4", "Support", "Shopper asked about a delivery — check the order and reply."),
        done(),
      ]),
      "keyword",
      undefined,
    ),

    flow(
      {
        title: "Ask for a review, then invite them back",
        description: "Asks how the delivery went, then follows up later with a reason to shop again.",
        outcome: "Turns a one-time buyer into a repeat one, and gives you reviews you did not have to chase.",
        sortOrder: 60,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Order delivered",
          config: { triggerType: "keyword", keywords: "delivered, received", intents: ["My order arrived"] },
        },
        wait("n2", 1, "days"),
        say("n3", "Ask how it went", "Hello {{name}}, your order arrived. How did we do? Reply with a number from 1 to 5."),
        wait("n4", 20, "days"),
        say("n5", "Invite them back", "Hello {{name}}, it has been a few weeks. Reply SHOP and we will send you what is new this month."),
        done(),
      ]),
      "keyword",
    ),

    prompt(
      {
        title: "Basket recovery messages",
        description: "Writes a short series of messages for shoppers who left items behind.",
        outcome: "Gives you ready copy for the most profitable message a shop can send.",
        sortOrder: 70,
      },
      {
        prompt:
          "Write 3 short WhatsApp messages for shoppers who added items to their basket but did not complete the order. Message 1 is a friendly nudge a few hours later, message 2 the next day mentioning limited stock, message 3 a final polite reminder with an easy way to opt out. Each under 3 lines. Do not invent a discount unless I tell you to. Indian shoppers, rupees.",
        goal: "Recover abandoned baskets",
        audienceHint: "Shoppers who left items in the basket in the last 3 days",
      },
    ),

    prompt(
      {
        title: "Offer for recent buyers",
        description: "Writes an offer for people who bought from a category recently.",
        outcome: "Sells more to people who already trust you, which is far cheaper than finding new buyers.",
        adminNote: "Offers are MARKETING category and cost more per message than order updates. Check the audience size before sending.",
        sortOrder: 80,
      },
      {
        prompt:
          "Write a short WhatsApp offer for customers who bought from us in the last 30 days, suggesting something that goes well with what they already bought. Leave the product and discount as blanks I can fill in. Friendly, not pushy, under 4 lines, rupees, and include a clear way to opt out.",
        goal: "Sell again to recent buyers",
        audienceHint: "Customers who ordered in the last 30 days",
      },
    ),

    template(
      {
        title: "Order confirmed",
        description: "Sent the moment an order is placed.",
        outcome: "The shopper has proof their order went through, so they stop asking.",
        sortOrder: 90,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, we have received your order {{2}} for Rs {{3}}. We will message you as soon as it is on its way.",
        footer: "Reply STOP to opt out",
        variableNames: ["customer_name", "order_number", "amount"],
      },
    ),

    template(
      {
        title: "Please confirm your cash order",
        description: "Asks the shopper to confirm a cash-on-delivery order before you dispatch it.",
        outcome: "Stops you paying to ship orders that get refused at the door.",
        sortOrder: 100,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, please confirm your cash-on-delivery order {{2}} for Rs {{3}}. Reply YES to confirm or NO to cancel. We will pack it once you confirm.",
        variableNames: ["customer_name", "order_number", "amount"],
      },
    ),

    template(
      {
        title: "On its way",
        description: "Sent when the order leaves your shop.",
        outcome: "Shoppers can follow their parcel instead of messaging you for updates.",
        sortOrder: 110,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, your order {{2}} is on its way. You can follow it here: {{3}}. Expected by {{4}}.",
        variableNames: ["customer_name", "order_number", "tracking_link", "expected_date"],
      },
    ),

    template(
      {
        title: "Delivered — how did we do?",
        description: "Sent after delivery to ask for a quick rating.",
        outcome: "Collects reviews at the one moment the customer is most likely to reply.",
        sortOrder: 120,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, your order {{2}} has been delivered. How did we do? Reply with a number from 1 to 5.",
        variableNames: ["customer_name", "order_number"],
      },
    ),

    template(
      {
        title: "Come back offer",
        description: "An offer to bring a past customer back.",
        outcome: "Brings back buyers who have gone quiet.",
        adminNote:
          "MARKETING category — costs more per message than order updates, and only goes to people who agreed to hear from you.",
        sortOrder: 130,
      },
      "MARKETING",
      {
        body: "Hello {{1}}, it has been a while. Here is {{2}} off your next order — use code {{3}} before {{4}}.",
        footer: "Reply STOP to opt out",
        variableNames: ["customer_name", "discount", "code", "expiry_date"],
      },
    ),
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// SCHOOL
// ════════════════════════════════════════════════════════════════════════════

const SCHOOL: SeedVertical = {
  slug: "school",
  displayName: "School & College",
  description: "Schools, colleges and coaching centres talking to parents and applicants.",
  icon: "GraduationCap",
  sortOrder: 30,
  isBuiltin: true,
  items: [
    flow(
      {
        title: "Answer an admission enquiry",
        description: "Replies to admission questions, collects the basics, and passes the parent to a counsellor.",
        outcome: "No enquiry is missed after office hours, and counsellors get the details before they call.",
        sortOrder: 10,
      },
      linear([
        trigger("admission, admissions, fees, seat, apply, class", [
          "I want admission for my child",
          "Are seats available",
          "What are the fees",
        ]),
        say(
          "n2",
          "Ask the basics",
          "Namaste {{name}}, thank you for your interest. Please reply with:\n1) Your child's name and class\n2) Your city or area\n3) A good time to call you",
        ),
        tag("n3", "admission-enquiry"),
        handoff("n4", "Admissions counsellor", "New admission enquiry — call the parent at the time they gave."),
        done(),
      ]),
      "keyword",
      {
        captureFields: [
          { key: "student_name", label: "Child's name", required: true },
          { key: "grade", label: "Class applying for", required: true },
          { key: "area", label: "City or area", required: false },
          { key: "callback_time", label: "Good time to call", required: true },
        ],
        confirmationCopy: "Thank you. Our counsellor will call you on {{callback_time}} about admission to class {{grade}}.",
        reminderCadenceHours: [24],
      },
    ),

    flow(
      {
        title: "Remind parents about fees",
        description: "Sends a polite fee reminder with a link to pay, and a second one if it stays unpaid.",
        outcome: "Fees come in sooner with fewer awkward phone calls from the office.",
        adminNote:
          "The payment link sits in the message text. There is no click tracking or paid/unpaid state yet — the office still reconciles payments manually. A dedicated payment step is planned.",
        sortOrder: 20,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Fee is due",
          config: { triggerType: "keyword", keywords: "fee, fees, payment, due", intents: ["When are the fees due", "How do I pay the fees"] },
        },
        say(
          "n2",
          "Send the reminder",
          "Dear Parent, this is a reminder that the term fee is due shortly. You can pay using the link the school office has shared. Reply HELP if you need assistance.",
        ),
        wait("n3", 3, "days"),
        say("n4", "Second reminder", "Dear Parent, a gentle reminder that the term fee is still pending. Please reply HELP if you would like to discuss a payment date."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Tell parents when a child is absent",
        description: "Messages the parent the same morning and lets them reply in the same chat.",
        outcome: "Parents find out the same day, not at the end of term, and can reply immediately.",
        sortOrder: 30,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Student marked absent",
          config: { triggerType: "keyword", keywords: "absent, attendance", intents: ["Why was my child marked absent"] },
        },
        say("n2", "Notify the parent", "Dear Parent, your child was marked absent today. If this is unexpected, please reply to this message and the class teacher will check."),
        handoff("n3", "Class teacher", "Parent may reply about an absence."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Follow up on an unfinished application",
        description: "Nudges a parent who started an application but did not finish it.",
        outcome: "Recovers admissions that were nearly complete and simply got forgotten.",
        sortOrder: 40,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Application left unfinished",
          config: { triggerType: "keyword", keywords: "application, form, incomplete", intents: ["I did not finish the form"] },
        },
        say("n2", "Same-day nudge", "Namaste {{name}}, we noticed your admission form is not complete. Reply HELP and we will finish it with you over the phone."),
        wait("n3", 1, "days"),
        say("n4", "Next-day nudge", "Namaste {{name}}, seats are filling up for this session. Reply HELP and our counsellor will complete your form in 5 minutes."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Share exam dates and results",
        description: "Lets parents know when the exam timetable or results are out.",
        outcome: "Every parent gets the same information at the same time, with no printed circular.",
        sortOrder: 50,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Timetable or result published",
          config: { triggerType: "keyword", keywords: "exam, result, timetable, marks", intents: ["When is the exam", "Are results out"] },
        },
        say("n2", "Announce it", "Dear Parent, the latest exam information for your child's class is now available. Reply DETAILS and we will send it to you."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Send a weekly round-up",
        description: "Sends parents one short summary of the week instead of many separate messages.",
        outcome: "Parents stay informed without the school office sending a message every day.",
        sortOrder: 60,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Weekly round-up due",
          config: { triggerType: "keyword", keywords: "weekly update, newsletter", intents: ["Send me this week's update"] },
        },
        say("n2", "Send the round-up", "Dear Parent, here is this week at school: upcoming dates, holidays and anything your child needs to bring. Reply DETAILS for the full note."),
        done(),
      ]),
      "keyword",
    ),

    prompt(
      {
        title: "Fee reminder messages",
        description: "Writes a fee reminder that is firm about the date but respectful to the parent.",
        outcome: "Gets fees paid without damaging the school's relationship with the family.",
        sortOrder: 70,
      },
      {
        prompt:
          "Write a WhatsApp fee reminder for parents. Be firm and clear about the amount and the due date, but respectful and warm — never shaming, never threatening. Leave amount, due date and payment link as blanks. Offer a way to ask for help if paying on time is difficult. Under 4 lines. Indian school, rupees.",
        goal: "Collect term fees on time",
        audienceHint: "Parents with a fee due in the next 7 days",
      },
    ),

    prompt(
      {
        title: "Open house invitation",
        description: "Writes an invitation to your admissions open house.",
        outcome: "Fills the open house from parents who already know your school.",
        adminNote: "An invitation is MARKETING category and costs more per message than fee or attendance notices.",
        sortOrder: 80,
      },
      {
        prompt:
          "Write a short WhatsApp invitation to a school admissions open house. Mention the date and time as blanks, give two concrete reasons a parent should come, and end with a simple way to reserve a seat. Warm and welcoming, under 4 lines, and include a way to opt out.",
        goal: "Fill seats at the admissions open house",
        audienceHint: "Parents who enquired about admission but have not visited",
      },
    ),

    template(
      {
        title: "Fee reminder",
        description: "A fee reminder with the amount, the date and a way to pay.",
        outcome: "Parents can pay from the message instead of coming to the office.",
        adminNote: "Paste the school's payment link into the {{4}} blank. Payment links are not tracked yet — reconcile in the office as usual.",
        sortOrder: 90,
      },
      "UTILITY",
      {
        body: "Dear Parent, the fee of Rs {{1}} for {{2}} is due on {{3}}. You can pay here: {{4}}. Reply HELP if you need assistance.",
        footer: "School office",
        variableNames: ["amount", "term_name", "due_date", "payment_link"],
      },
    ),

    template(
      {
        title: "Absent today",
        description: "Tells a parent their child was not in class.",
        outcome: "Parents hear the same day and can reply right away.",
        sortOrder: 100,
      },
      "UTILITY",
      {
        body: "Dear Parent, {{1}} was marked absent on {{2}}. If this is unexpected, please reply to this message and the class teacher will check.",
        variableNames: ["student_name", "date"],
      },
    ),

    template(
      {
        title: "Exam timetable",
        description: "Announces the exam schedule for a class.",
        outcome: "Every parent gets the dates at once, with nothing lost in a school bag.",
        sortOrder: 110,
      },
      "UTILITY",
      {
        body: "Dear Parent, the {{1}} timetable for class {{2}} is now available. The first paper is on {{3}}. Reply DETAILS for the full schedule.",
        variableNames: ["exam_name", "class_name", "first_exam_date"],
      },
    ),

    template(
      {
        title: "Open house invitation",
        description: "Invites parents to visit the school.",
        outcome: "Brings interested parents through the gate, where most admissions are actually decided.",
        adminNote: "MARKETING category — costs more per message and only goes to parents who agreed to hear from you.",
        sortOrder: 120,
      },
      "MARKETING",
      {
        body: "Admissions for {{1}} are now open at {{2}}. Join our open house on {{3}} to meet our teachers and see the campus. Reply VISIT to reserve a seat.",
        footer: "Reply STOP to opt out",
        variableNames: ["academic_year", "school_name", "event_date"],
      },
    ),
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// REAL ESTATE
// ════════════════════════════════════════════════════════════════════════════

const REAL_ESTATE: SeedVertical = {
  slug: "real_estate",
  displayName: "Real Estate",
  description: "Builders and property advisors handling buyer enquiries and site visits.",
  icon: "Building2",
  sortOrder: 40,
  isBuiltin: true,
  items: [
    flow(
      {
        title: "Reply to a new enquiry in seconds",
        description: "Answers a property enquiry immediately and finds out budget, purpose and timing.",
        outcome: "You reply before your competitor does, which is usually who gets the sale.",
        sortOrder: 10,
      },
      linear([
        trigger("property, flat, apartment, price, plot, bhk, project", [
          "I am interested in this property",
          "What is the price",
          "Send me details of the flats",
        ]),
        say(
          "n2",
          "Reply and qualify",
          "Hello {{name}}, thank you for your interest. So we can send the right options, please reply with:\n1) Your budget range\n2) Buying to live in or to invest\n3) When you are looking to decide",
        ),
        tag("n3", "new-lead"),
        handoff("n4", "Sales advisor", "New buyer enquiry — details captured, call while it is warm."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Book a site visit",
        description: "Fixes a day and time for the buyer to see the property, then reminds them before it.",
        outcome: "More booked visits actually happen instead of quietly falling through.",
        sortOrder: 20,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Buyer wants to visit",
          config: {
            triggerType: "keyword",
            keywords: "site visit, visit, see the flat, sample flat",
            intents: ["I want to visit the site", "Can I see the flat this weekend"],
          },
        },
        say("n2", "Offer times", "Hello {{name}}, happy to arrange a site visit. Which suits you better — this Saturday or Sunday? Please also tell me a preferred time."),
        tag("n3", "site-visit-requested"),
        handoff("n4", "Sales advisor", "Buyer wants a site visit — confirm the slot and share directions."),
        done(),
      ]),
      "keyword",
      {
        captureFields: [
          { key: "visit_day", label: "Preferred day", required: true },
          { key: "visit_time", label: "Preferred time", options: ["Morning", "Afternoon", "Evening"], required: true },
          { key: "party_size", label: "How many people are coming", required: false },
        ],
        confirmationCopy: "Your site visit to {{project}} is confirmed for {{date}} at {{time}}. Our advisor will meet you at the gate.",
        reminderCadenceHours: [24, 3],
      },
    ),

    flow(
      {
        title: "Follow up after a site visit",
        description: "Checks in after the visit and sends material the buyer can share with family.",
        outcome: "Keeps you in the conversation while the family is deciding at home.",
        sortOrder: 30,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Site visit finished",
          config: { triggerType: "keyword", keywords: "visited, saw the flat", intents: ["We visited the site"] },
        },
        say("n2", "Same-day thanks", "Hello {{name}}, thank you for visiting today. What did the family think? Reply with any question and I will answer honestly."),
        wait("n3", 2, "days"),
        say("n4", "Send shareable details", "Hello {{name}}, here is the layout and payment plan you can share at home. Reply CALL if you would like to talk through the numbers."),
        wait("n5", 4, "days"),
        say("n6", "Address the hesitation", "Hello {{name}}, most families ask us about the payment plan and possession date at this stage. Reply ASK and I will send clear answers to both."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Greet people who click your ad",
        description: "Replies straight away when someone reaches you from a WhatsApp advert.",
        outcome: "Every rupee of ad spend gets an instant reply instead of a cold silence.",
        sortOrder: 40,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Arrived from an advert",
          config: { triggerType: "keyword", keywords: "saw your ad, advertisement, interested", intents: ["I saw your advertisement"] },
        },
        say("n2", "Welcome them", "Hello {{name}}, thanks for reaching out about our project. Would you like the price list, the layout, or to book a site visit? Reply with one."),
        tag("n3", "ad-lead"),
        handoff("n4", "Sales advisor", "Lead arrived from an advert — respond quickly."),
        done(),
      ]),
      "keyword",
    ),

    flow(
      {
        title: "Update your broker network",
        description: "A separate announcement flow for brokers and channel partners, kept apart from buyers.",
        outcome: "Brokers get trade information and commercial terms that must never reach a buyer's phone.",
        adminNote:
          "Keep this audience separate from buyers. Commission terms, inventory positions and pricing flexibility belong here and nowhere else.",
        sortOrder: 50,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Partner announcement",
          config: { triggerType: "keyword", keywords: "inventory, partner update, channel partner", intents: ["Send me the partner update"] },
        },
        say("n2", "Send the update", "Hello {{name}}, here is this week's partner update: available inventory, current terms and the site visit calendar. Reply LIST for the full sheet."),
        tag("n3", "channel-partner"),
        done(),
      ]),
      "keyword",
    ),

    prompt(
      {
        title: "New launch announcement for brokers",
        description: "Writes a launch announcement aimed at your broker network, not at buyers.",
        outcome: "Gets your channel partners selling on day one of a launch.",
        adminNote: "Broker audience only. Never send commercial terms to a buyer list.",
        sortOrder: 60,
      },
      {
        prompt:
          "Write a short WhatsApp announcement for our channel partners and brokers about a new project launch. Cover what is launching, where, the unit types and the starting price as blanks I can fill in, and what is in it for the partner. Business-like and direct — this is a trade audience, not home buyers. Under 5 lines, rupees.",
        goal: "Activate the broker network for a new launch",
        audienceHint: "Registered channel partners and brokers only",
      },
    ),

    prompt(
      {
        title: "Wake up a quiet lead",
        description: "Writes a message for a buyer who has gone quiet for about a week.",
        outcome: "Recovers buyers who went cold without you having to call and chase them.",
        sortOrder: 70,
      },
      {
        prompt:
          "Write a short WhatsApp message to a home buyer who enquired about a week ago and has gone quiet. Do not sound desperate or pushy. Give one genuinely useful reason to reply — a price update, remaining units, or a weekend visit slot — and make replying easy. Under 3 lines.",
        goal: "Re-engage leads with no reply for 7 days",
        audienceHint: "Buyers who enquired 7 or more days ago and did not reply",
      },
    ),

    template(
      {
        title: "Thanks for your enquiry",
        description: "The first reply a buyer gets after asking about a property.",
        outcome: "The buyer knows a real person is on it, within seconds.",
        sortOrder: 80,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, thank you for your interest in {{2}}. Our advisor will call you within {{3}}. Meanwhile, please reply with your budget range so we can send suitable options.",
        variableNames: ["buyer_name", "project_name", "callback_window"],
      },
    ),

    template(
      {
        title: "Site visit confirmed",
        description: "Confirms the day, time and who will meet the buyer.",
        outcome: "Buyers turn up at the right place, at the right time, expecting the right person.",
        sortOrder: 90,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, your site visit to {{2}} is confirmed for {{3}} at {{4}}. Our advisor {{5}} will meet you at the main gate.",
        variableNames: ["buyer_name", "project_name", "date", "time", "advisor_name"],
      },
    ),

    template(
      {
        title: "Brochure and payment plan",
        description: "Sends the buyer the details they can share with their family.",
        outcome: "Puts your project in front of the people at home who help decide.",
        adminNote:
          "RERA: keep the project's RERA registration number in this copy. Pricing and plan material carries advertising obligations under RERA — check before submitting to Meta.",
        sortOrder: 100,
      },
      "MARKETING",
      {
        body: "Hello {{1}}, here is the brochure and payment plan for {{2}}. RERA registration: {{3}}. Reply CALL to speak with an advisor about the numbers.",
        footer: "Reply STOP to opt out",
        variableNames: ["buyer_name", "project_name", "rera_number"],
      },
    ),

    template(
      {
        title: "New launch announcement",
        description: "Announces a new project to your list.",
        outcome: "Reaches everyone who asked to hear about new launches, on the day it opens.",
        adminNote:
          "RERA: the registration number must stay in this copy. MARKETING category — costs more per message than enquiry replies.",
        sortOrder: 110,
      },
      "MARKETING",
      {
        body: "New launch: {{1}} in {{2}}. {{3}} homes starting at Rs {{4}}. RERA registration: {{5}}. Reply INTERESTED for the full price list.",
        footer: "Reply STOP to opt out",
        variableNames: ["project_name", "location", "unit_types", "starting_price", "rera_number"],
      },
    ),
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// SEED-KIT WORKED EXAMPLES
//
// Restaurant and Salon prove the "Other" pattern is reusable, not just documented.
// Each has EXACTLY the 3 seed items the guided admin form collects:
//   1) one booking/inquiry flow   2) one reminder/status flow
//   3) one campaign prompt + 2 templates (one Utility, one Marketing)
// An admin adding "Gym" or "Travel Agency" fills the same three slots.
// ════════════════════════════════════════════════════════════════════════════

const RESTAURANT: SeedVertical = {
  slug: "restaurant",
  displayName: "Restaurant",
  description: "Restaurants and cafés taking table bookings and orders.",
  icon: "UtensilsCrossed",
  sortOrder: 50,
  isBuiltin: true,
  items: [
    flow(
      {
        title: "Take a table booking",
        description: "Collects the date, time and number of guests, then passes it to your floor manager.",
        outcome: "Bookings get taken during the dinner rush without anyone picking up the phone.",
        sortOrder: 10,
      },
      linear([
        trigger("table, booking, reserve, reservation, dinner", [
          "I want to book a table",
          "Do you have space tonight",
          "Table for four please",
        ]),
        say("n2", "Ask the details", "Hello {{name}}, happy to reserve a table. Please reply with:\n1) Day and time\n2) How many guests\n3) Any high chairs or seating preference"),
        tag("n3", "table-booking"),
        handoff("n4", "Floor manager", "Table booking request — confirm availability and reply."),
        done(),
      ]),
      "keyword",
      {
        captureFields: [
          { key: "date_time", label: "Day and time", required: true },
          { key: "guests", label: "Number of guests", required: true },
          { key: "seating", label: "Seating preference", options: ["Indoor", "Outdoor", "No preference"], required: false },
        ],
        confirmationCopy: "Your table for {{guests}} is booked for {{date_time}}. We will hold it for 15 minutes.",
        reminderCadenceHours: [24, 3],
      },
    ),

    flow(
      {
        title: "Tell them the table is ready",
        description: "Messages a waiting guest when their table comes free and lets them reply.",
        outcome: "Guests can wait comfortably nearby instead of crowding your entrance.",
        sortOrder: 20,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Table is free",
          config: { triggerType: "keyword", keywords: "table ready, waiting, queue", intents: ["Is my table ready"] },
        },
        say("n2", "Call them in", "Hello {{name}}, your table is ready. Please come to the front desk in the next 10 minutes. Reply LATE if you need a few more minutes."),
        done(),
      ]),
      "keyword",
    ),

    prompt(
      {
        title: "Weekend offer",
        description: "Writes a short weekend offer for your regulars.",
        outcome: "Fills quiet tables on the nights you choose.",
        adminNote: "Offers are MARKETING category and cost more per message than booking confirmations.",
        sortOrder: 30,
      },
      {
        prompt:
          "Write a short WhatsApp message for our regular guests about a weekend offer at our restaurant. Leave the offer, the days and the timing as blanks. Make the food sound appealing in one line, keep it under 3 lines, and include an easy way to book and a way to opt out.",
        goal: "Fill tables on quieter weekend shifts",
        audienceHint: "Guests who have visited in the last 3 months",
      },
    ),

    template(
      {
        title: "Table booked",
        description: "Confirms a guest's table booking.",
        outcome: "Guests have the booking in writing, so fewer no-shows and fewer disputes at the door.",
        sortOrder: 40,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, your table for {{2}} is booked on {{3}} at {{4}}. We will hold it for 15 minutes. Reply CHANGE if your plans change.",
        variableNames: ["guest_name", "guest_count", "date", "time"],
      },
    ),

    template(
      {
        title: "Weekend offer",
        description: "An offer to bring regulars back in.",
        outcome: "Turns a quiet evening into a busy one.",
        adminNote: "MARKETING category — costs more per message, and only to guests who agreed to hear from you.",
        sortOrder: 50,
      },
      "MARKETING",
      {
        body: "Hello {{1}}, this weekend at {{2}}: {{3}}. Available {{4}}. Reply BOOK to reserve a table.",
        footer: "Reply STOP to opt out",
        variableNames: ["guest_name", "restaurant_name", "offer", "days"],
      },
    ),
  ],
};

const SALON: SeedVertical = {
  slug: "salon",
  displayName: "Salon & Spa",
  description: "Salons, spas and clinics booking appointments with a stylist or therapist.",
  icon: "Scissors",
  sortOrder: 60,
  isBuiltin: true,
  items: [
    flow(
      {
        title: "Book an appointment",
        description: "Collects the service, the stylist and the time, then confirms with your front desk.",
        outcome: "Clients book while they are thinking about it, even after you have closed.",
        sortOrder: 10,
      },
      linear([
        trigger("appointment, booking, haircut, facial, spa, slot", [
          "I want to book an appointment",
          "Is anyone free this evening",
          "Can I get a haircut tomorrow",
        ]),
        say("n2", "Ask what they want", "Hello {{name}}, happy to book you in. Please reply with:\n1) Which service\n2) Preferred day and time\n3) Any stylist you prefer"),
        tag("n3", "appointment-request"),
        handoff("n4", "Front desk", "Booking request — confirm the stylist and slot."),
        done(),
      ]),
      "keyword",
      {
        captureFields: [
          { key: "service", label: "Which service", required: true },
          { key: "date_time", label: "Preferred day and time", required: true },
          { key: "stylist", label: "Preferred stylist", required: false },
        ],
        confirmationCopy: "Your {{service}} with {{stylist}} is booked for {{date_time}}. See you then.",
        reminderCadenceHours: [24, 2],
      },
    ),

    flow(
      {
        title: "Remind them before the appointment",
        description: "Sends a reminder the day before and lets the client change the time.",
        outcome: "Fewer empty chairs, and cancellations come early enough to fill the slot.",
        sortOrder: 20,
      },
      linear([
        {
          id: "n1",
          type: "triggerNode",
          label: "Appointment is tomorrow",
          config: { triggerType: "keyword", keywords: "reminder, tomorrow, my appointment", intents: ["When is my appointment"] },
        },
        say("n2", "Remind them", "Hello {{name}}, a reminder about your appointment with us tomorrow. Reply CHANGE if you need a different time, or YES to confirm."),
        done(),
      ]),
      "keyword",
    ),

    prompt(
      {
        title: "Invite clients back",
        description: "Writes a message for clients who have not visited for a while.",
        outcome: "Brings back regulars who simply drifted, which costs far less than finding new clients.",
        adminNote: "MARKETING category — costs more per message than booking confirmations.",
        sortOrder: 30,
      },
      {
        prompt:
          "Write a short, warm WhatsApp message for salon clients who have not visited in about two months. Make it feel personal rather than promotional, leave any offer as a blank I can fill in, suggest booking a time, and include a way to opt out. Under 3 lines.",
        goal: "Bring back clients who have not visited recently",
        audienceHint: "Clients whose last visit was 8 or more weeks ago",
      },
    ),

    template(
      {
        title: "Appointment booked",
        description: "Confirms the service, stylist and time.",
        outcome: "The client has it in writing, so fewer mix-ups at the chair.",
        sortOrder: 40,
      },
      "UTILITY",
      {
        body: "Hello {{1}}, your {{2}} with {{3}} is booked for {{4}}. Reply CHANGE if you need a different time.",
        variableNames: ["client_name", "service", "stylist_name", "date_time"],
      },
    ),

    template(
      {
        title: "We miss you",
        description: "An invitation for clients who have not been in for a while.",
        outcome: "Refills your quieter weekdays from people who already like your work.",
        adminNote: "MARKETING category — costs more per message, and only to clients who agreed to hear from you.",
        sortOrder: 50,
      },
      "MARKETING",
      {
        body: "Hello {{1}}, it has been a while since your last visit to {{2}}. Book this week and enjoy {{3}}. Reply BOOK to pick a time.",
        footer: "Reply STOP to opt out",
        variableNames: ["client_name", "salon_name", "offer"],
      },
    ),
  ],
};

/**
 * Every vertical SendAnjal ships. "Other" is deliberately absent: it is not a
 * vertical, it is the admin seed-kit form (Phase 2) that creates new ones —
 * Restaurant and Salon above are what that form produces.
 */
export const SEED_VERTICALS: SeedVertical[] = [HOSPITAL, ECOMMERCE, SCHOOL, REAL_ESTATE, RESTAURANT, SALON];
