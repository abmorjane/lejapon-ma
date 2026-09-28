import { describe, expect, it } from "vitest";
import { DisabledOpenAiConversionSender, OPENAI_EVENT_MAPPING } from "./openai-ads";

describe("future OpenAI Ads conversion contract", () => {
  it("maps business milestones without treating a booking as an order", () => {
    expect(OPENAI_EVENT_MAPPING.booking_form_submitted).toBe("lead_created");
    expect(OPENAI_EVENT_MAPPING.payment_confirmed).toBe("order_created");
  });

  it("does not make a network request while the integration is disabled", async () => {
    await expect(new DisabledOpenAiConversionSender().send({
      event: "lead_created",
      eventId: "lead-1",
      occurredAt: "2026-09-28T00:00:00.000Z",
      openaiClickRef: "opaque%2Freference",
    })).resolves.toBeUndefined();
  });
});
