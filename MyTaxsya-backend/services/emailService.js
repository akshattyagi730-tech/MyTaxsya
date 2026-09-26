import nodemailer from "nodemailer";

// Transactional email for sign-up codes, password resets and team invites.
//
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS  -> real delivery (any SMTP provider)
//   EMAIL_FROM                                     -> sender address (defaults to SMTP_USER)
//   EMAIL_TRANSPORT=console                        -> local development only: print instead of send
//
// With neither configured, sending throws. Callers must surface that to the user
// instead of pretending the email went out.

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS (or EMAIL_TRANSPORT=console for local development).");
    this.name = "EmailNotConfiguredError";
  }
}

// Messages captured in console mode, so tests can read the OTP they "received".
export const outbox = [];

const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let cachedTransport = null;
let cachedTransportKey = "";
const getTransport = () => {
  const port = Number(process.env.SMTP_PORT) || 587;
  const key = `${process.env.SMTP_HOST}|${port}|${process.env.SMTP_USER}|${process.env.SMTP_SECURE}`;
  if (!cachedTransport || cachedTransportKey !== key) {
    cachedTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    cachedTransportKey = key;
  }
  return cachedTransport;
};

export async function sendEmail({ to, subject, text, html }) {
  if (smtpConfigured()) {
    await getTransport().sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    return;
  }

  if (process.env.EMAIL_TRANSPORT === "console") {
    outbox.push({ to, subject, text });
    if (outbox.length > 50) outbox.shift();
    if (process.env.NODE_ENV !== "test") {
      console.log(`\n==========================================\n[EMAIL - console transport, not sent] To: ${to}\nSubject: ${subject}\n\n${text}\n==========================================\n`);
    }
    return;
  }

  throw new EmailNotConfiguredError();
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const wrapHtml = (body) =>
  `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111">${body}<p style="color:#888;font-size:12px;margin-top:24px">My Taxsya</p></div>`;

export const otpEmail = ({ to, otp }) => ({
  to,
  subject: "Your My Taxsya verification code",
  text: `Your verification code is ${otp}. It expires in 10 minutes.\n\nIf you did not try to sign up, you can ignore this email.`,
  html: wrapHtml(`<p>Your verification code is</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${escapeHtml(otp)}</p><p>It expires in 10 minutes. If you did not try to sign up, you can ignore this email.</p>`),
});

export const passwordResetEmail = ({ to, link }) => ({
  to,
  subject: "Reset your My Taxsya password",
  text: `Use this link to choose a new password. It works once and expires in 1 hour:\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
  html: wrapHtml(`<p>Use the button below to choose a new password. The link works once and expires in 1 hour.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Reset password</a></p><p>If you did not ask for this, you can ignore this email.</p>`),
});

export const inviteEmail = ({ to, link, invitedBy }) => ({
  to,
  subject: "You have been invited to My Taxsya",
  text: `${invitedBy ? `${invitedBy} invited you to My Taxsya.` : "You have been invited to My Taxsya."}\n\nSet your password to get started (the link expires in 3 days):\n\n${link}`,
  html: wrapHtml(`<p>${escapeHtml(invitedBy ? `${invitedBy} invited you to My Taxsya.` : "You have been invited to My Taxsya.")}</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Set your password</a></p><p>The link expires in 3 days.</p>`),
});
