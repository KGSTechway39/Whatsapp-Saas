import type { CreateTemplateInput } from "@/lib/meta";

/**
 * The two message templates WorkspaceCV needs, defined and ready to submit for
 * Meta approval via `createTemplate(wabaId, token, def)`.
 *
 * These are definitions only — nothing is submitted at import time. Submit once,
 * per WABA, during WorkspaceCV onboarding; then the send endpoints reference them
 * by name (OTP_TEMPLATE_NAME / RESUME_TEMPLATE_NAME env, defaulting to the names
 * below). Names must be lowercase with underscores per Meta's rules.
 */

/**
 * AUTHENTICATION — one-time passcode.
 * Code-only, no marketing language (enforced by createTemplate's validator).
 * Body copy + code delivery are system-generated; we only declare the security
 * recommendation line, the code expiry, and a copy-code button.
 */
export const OTP_AUTH_TEMPLATE: CreateTemplateInput = {
  name: "otp_verification",
  category: "AUTHENTICATION",
  language: "en",
  components: [
    { type: "BODY", add_security_recommendation: true },
    { type: "FOOTER", code_expiration_minutes: 5 },
    { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
  ],
};

/**
 * UTILITY — resume-ready notification with the PDF attached.
 * {{1}} = recipient name. The document is attached at send time via a media_id
 * (see POST /api/v1/documents/send); the HEADER example handle below is only the
 * sample Meta requires at creation — replace it with a real uploaded sample
 * handle (from a media-upload with the sample PDF) when submitting.
 */
export const RESUME_UTILITY_TEMPLATE: CreateTemplateInput = {
  name: "resume_ready",
  category: "UTILITY",
  language: "en",
  components: [
    {
      type: "HEADER",
      format: "DOCUMENT",
      example: { header_handle: ["REPLACE_WITH_SAMPLE_MEDIA_HANDLE"] },
    },
    {
      type: "BODY",
      text: "Hi {{1}}, your resume is ready — see the attached PDF. Thanks for using WorkspaceCV.",
      example: { body_text: [["Ravi"]] },
    },
  ],
};

export const WORKSPACECV_TEMPLATES = [OTP_AUTH_TEMPLATE, RESUME_UTILITY_TEMPLATE];
