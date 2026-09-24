import type { Env } from "./types";

/**
 * Outgoing email for the Top 3 contest. One function, sendEmail(), so the
 * provider can be swapped by changing only this file. Today it's Resend,
 * called with a plain fetch (no SDK).
 *
 * Callers wrap it in executionCtx.waitUntil() so a slow provider never
 * holds up the page. It never throws: a failure is logged and the person's
 * request still succeeds.
 *
 * No tracking pixels and no rewritten links - and click/open tracking must
 * stay switched off for the domain in the Resend dashboard too.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendEmail(env: Env, msg: EmailMessage): Promise<boolean> {
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
    console.error("email not configured (EMAIL_API_KEY / EMAIL_FROM); not sent:", msg.subject);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) {
      console.error("email send failed", res.status, (await res.text()).slice(0, 500));
      return false;
    }
    return true;
  } catch (err) {
    console.error("email send failed", err);
    return false;
  }
}

// ------------------------------------------------------------------ templates

const SITE = "https://weareradio.app";
const FOOTER = "We Are Radio · Top 3 Creator Songs of 2026 · weareradio.app/top3/rules";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Block = { p: string } | { button: { label: string; url: string } } | { quote: string } | { small: string };

// Every template is written once as a list of blocks and rendered to both
// plain text and simple, inline-styled HTML, so the two never drift apart.
function render(to: string, subject: string, blocks: Block[], extraFooter?: string): EmailMessage {
  const text: string[] = [];
  const html: string[] = [];
  for (const b of blocks) {
    if ("p" in b) {
      text.push(b.p);
      html.push(`<p style="margin:0 0 16px;line-height:1.5">${esc(b.p)}</p>`);
    } else if ("button" in b) {
      text.push(`${b.button.label}: ${b.button.url}`);
      html.push(
        `<p style="margin:0 0 20px"><a href="${esc(b.button.url)}" style="display:inline-block;background:#e11d2e;color:#ffffff;` +
          `text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">${esc(b.button.label)}</a></p>` +
          `<p style="margin:0 0 16px;font-size:13px;color:#666">Or copy this link: <a href="${esc(b.button.url)}" style="color:#e11d2e">${esc(b.button.url)}</a></p>`
      );
    } else if ("quote" in b) {
      text.push(b.quote);
      html.push(
        `<p style="margin:0 0 16px;padding:12px 14px;background:#f4f4f4;border-left:3px solid #e11d2e;line-height:1.5">${esc(b.quote)}</p>`
      );
    } else {
      text.push(b.small);
      html.push(`<p style="margin:0 0 16px;font-size:13px;color:#666;line-height:1.5">${esc(b.small)}</p>`);
    }
  }
  const footerLines = [FOOTER, ...(extraFooter ? [extraFooter] : [])];
  return {
    to,
    subject,
    text: `${text.join("\n\n")}\n\n--\n${footerLines.join("\n")}\n`,
    html:
      `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#111;font-family:Arial,Helvetica,sans-serif;font-size:16px">` +
      `<div style="max-width:560px;margin:0 auto">${html.join("")}` +
      `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px">` +
      footerLines.map((l) => `<p style="margin:0 0 6px;font-size:12px;color:#888">${esc(l)}</p>`).join("") +
      `</div></body></html>`,
  };
}

export const templates = {
  entryConfirm: (to: string, e: { title: string; token: string }) =>
    render(to, `Confirm your Top 3 entry: "${e.title}"`, [
      { p: `Thanks for entering "${e.title}" in We Are Radio's Top 3 Creator Songs of 2026.` },
      { p: "One last step: please confirm your entry. We won't review it until you do." },
      { button: { label: "Confirm my entry", url: `${SITE}/top3/confirm?t=${encodeURIComponent(e.token)}` } },
      { small: "This link works for 7 days. If you didn't enter a song, just ignore this email and nothing will happen." },
    ]),

  entryReceived: (to: string, e: { title: string }) =>
    render(to, `We've got your song, "${e.title}"`, [
      { p: `Your entry "${e.title}" is confirmed and in our review queue.` },
      { p: "We listen to every song ourselves. Review takes up to 14 days, and we'll email you either way." },
      { p: "Good luck!" },
    ]),

  entryApproved: (to: string, e: { id: number; title: string }) => {
    const url = `${SITE}/top3/${e.id}`;
    return render(to, `You're in the running: "${e.title}" is Song #${e.id}`, [
      { p: `Great news: "${e.title}" has been approved. It's now Song #${e.id} in We Are Radio's Top 3 Creator Songs of 2026.` },
      { p: "Your song's own page is live. Share it everywhere: every listener you bring now can vote for you when voting opens." },
      { button: { label: `See Song #${e.id}`, url } },
      { p: "Ready-to-copy message for your fans:" },
      { quote: `Listen to my song "${e.title}" on We Are Radio, and vote for it when voting opens on 1 April! ${url}` },
      { p: "Voting opens on 1 April 2027." },
      { p: "Approved songs can also be picked for our weekly Creator Spotlight Show on We Are Radio." },
    ]);
  },

  entryRejected: (to: string, e: { title: string; reason: string; entriesLeft: number }) =>
    render(to, `About your Top 3 entry, "${e.title}"`, [
      { p: `Thank you for entering "${e.title}". We've listened carefully, and we're sorry to say we can't accept it for the competition.` },
      { quote: e.reason },
      {
        p:
          e.entriesLeft > 0
            ? `You're welcome to enter a different song instead, before entries close on 31 March 2027: ${SITE}/top3/enter`
            : "We hope to hear more from you in future.",
      },
    ]),

  notifyConfirm: (to: string, e: { token: string; unsubscribeUrl: string }) =>
    render(
      to,
      "Confirm: remind me when voting opens",
      [
        { p: "You asked us to email you when voting opens for We Are Radio's Top 3 Creator Songs of 2026." },
        { button: { label: "Yes, remind me", url: `${SITE}/top3/notify/confirm?t=${encodeURIComponent(e.token)}` } },
        { small: "If this wasn't you, ignore this email and you won't hear from us." },
      ],
      `Unsubscribe: ${e.unsubscribeUrl}`
    ),
};
