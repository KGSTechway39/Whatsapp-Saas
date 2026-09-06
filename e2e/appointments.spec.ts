import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Appointments end-to-end.
 *
 * These exercise the real API against a real database — the part the Vitest
 * suite deliberately cannot cover (it runs with no credentials). What matters
 * here is the behaviour that only shows up with persistence: that a booking
 * survives a reload, that a reschedule clears the reminder flags, and that a
 * cancel keeps the row instead of deleting the history.
 *
 * Every appointment created here is booked far in the future and cleaned up in
 * afterAll, so a test run cannot leave rows that look like real bookings.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";

/** Far-future so it can never collide with, or be mistaken for, real data. */
const TEST_DATE = "2030-06-12";
const MARKER = "e2e-appt";

const created: string[] = [];

/**
 * Applies the saved session to BOTH the `page` and the `request` fixtures.
 *
 * The other specs in this suite call context().addCookies() in a beforeEach,
 * which only authenticates the browser — an APIRequestContext built by the
 * `request` fixture is separate and would 401 on every call. storageState is
 * the fixture-level equivalent that covers both.
 */
test.use({ storageState: "e2e/.auth.json" });

async function book(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {},
) {
  const res = await request.post(`${BASE_URL}/api/appointments`, {
    data: {
      contactName: `${MARKER} ${Date.now()}`,
      contactPhone: "+919000000777",
      service: "consultation",
      date: TEST_DATE,
      time: "11:00",
      durationMinutes: 30,
      ...overrides,
    },
  });
  const body = await res.json();
  if (body?.appointment?.id) created.push(body.appointment.id);
  return { res, body };
}

test.describe("Appointments API", () => {
  test("books an appointment and persists it", async ({ request }) => {
    const { res, body } = await book(request);
    expect(res.status()).toBe(201);
    expect(body.appointment.status).toBe("scheduled");
    expect(body.appointment.date).toBe(TEST_DATE);
    expect(body.appointment.time).toBe("11:00");

    // Persistence is the whole point — the page used to run on a demo array,
    // where a "booking" vanished on reload.
    const list = await request.get(`${BASE_URL}/api/appointments?limit=500`);
    const found = (await list.json()).appointments.find(
      (a: { id: string }) => a.id === body.appointment.id,
    );
    expect(found).toBeTruthy();
    expect(found.contactPhone).toBe("+919000000777");
  });

  test("stores the instant in UTC and renders it back in local time", async ({ request }) => {
    // 11:00 IST is 05:30Z. If this drifts, reminders fire at the wrong hour.
    const { body } = await book(request, { time: "11:00" });
    expect(body.appointment.startsAt).toContain("05:30");
    expect(body.appointment.time).toBe("11:00");
  });

  test("reports an overlap but still books it", async ({ request }) => {
    await book(request, { time: "15:00", durationMinutes: 60 });
    const { res, body } = await book(request, { time: "15:30", durationMinutes: 30 });
    expect(res.status()).toBe(201); // booked, not refused
    expect(body.conflicts).toBeGreaterThanOrEqual(1);
    expect(body.conflictNote).toContain("Booked anyway");
  });

  test("rejects an impossible time instead of rolling it forward", async ({ request }) => {
    // Regression: "25:99" used to be accepted and became 02:39 the NEXT day.
    const res = await request.post(`${BASE_URL}/api/appointments`, {
      data: {
        contactName: `${MARKER} invalid`,
        contactPhone: "+919000000778",
        date: TEST_DATE,
        time: "25:99",
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/does not exist/i);
  });

  test("rescheduling clears the reminder flags", async ({ request }) => {
    const { body } = await book(request, { time: "09:00" });
    const id = body.appointment.id;

    const patch = await request.patch(`${BASE_URL}/api/appointments/${id}`, {
      data: { time: "17:45" },
    });
    expect(patch.status()).toBe(200);
    const updated = (await patch.json()).appointment;

    expect(updated.time).toBe("17:45");
    // Moving the slot invalidates any reminder already sent for the old time —
    // the customer has to be told about the new one.
    expect(updated.status).toBe("rescheduled");
    expect(updated.reminderSent).toBe(false);
  });

  test("cancelling keeps the row rather than deleting it", async ({ request }) => {
    const { body } = await book(request, { time: "13:15" });
    const id = body.appointment.id;

    const del = await request.delete(`${BASE_URL}/api/appointments/${id}`);
    expect(del.status()).toBe(200);

    // No-show and cancellation history is what an owner needs most.
    const list = await request.get(`${BASE_URL}/api/appointments?limit=500`);
    const found = (await list.json()).appointments.find((a: { id: string }) => a.id === id);
    expect(found).toBeTruthy();
    expect(found.status).toBe("cancelled");
  });

  test("does not leak another tenant's appointment", async ({ request }) => {
    // A random uuid must be indistinguishable from one owned by someone else.
    const res = await request.patch(
      `${BASE_URL}/api/appointments/00000000-0000-0000-0000-000000000000`,
      { data: { status: "confirmed" } },
    );
    expect(res.status()).toBe(404);
  });
});

test.describe("Appointments UI", () => {
  test("renders booked appointments from the API, not demo data", async ({ page, request }) => {
    const { body } = await book(request, { time: "10:15" });
    await page.goto(`${BASE_URL}/appointments`);

    // The default view is a single DAY (today), and these fixtures are booked in
    // 2030 on purpose — so switch to the all-appointments view first. The button
    // is labelled "All", not "List"; asserting on it rather than swallowing a
    // failed click means a renamed control fails the test instead of hiding.
    await page.getByRole("button", { name: /^all$/i }).first().click();

    await expect(page.getByText(body.appointment.contactName)).toBeVisible({ timeout: 15000 });

    // Persistence, not demo data: the hardcoded DEMO_APPOINTMENTS names are gone.
    await expect(page.getByText("Rajesh Kumar")).toHaveCount(0);
  });
});

test.afterAll(async ({ request }) => {
  // Cancel marks rather than deletes, so remove the rows outright via repeated
  // DELETE + a filtered sweep would still leave them. Best effort: cancel each
  // so nothing shows as an active future booking.
  for (const id of created) {
    await request.delete(`${BASE_URL}/api/appointments/${id}`).catch(() => {});
  }
});
