export const DEFAULT_MAILER_CALL_SCRIPT = `# Mailer inbound call script

Use the lead details on screen before you speak. Confirm their name and property address so they feel recognized.

---

## 1. Opening (warm, confident)

"Hi, is this **{{first_name}}**?"

*(Wait for yes.)*

"Great — this is **{{lo_name}}** with QuestRock Home Loans. You should have received our refinance savings letter in the mail recently. I'm following up on that offer — do you have a quick minute?"

---

## 2. Confirm identity & mail piece

"Just so I'm looking at the right file — you're at **{{address}}** in **{{city}}, {{state}}**, right?"

"Your offer reference on the mailer is **{{offer_code}}**. Does that match what you have in front of you?"

---

## 3. Acknowledge their situation (use screen data)

"I have your current loan balance around **{{mtg_amount}}**, and the offer we mailed showed a potential rate around **{{new_rate}}** with a payment near **{{new_payment}}**."

*(Do not name the servicer on the call.)*

"What's most important to you right now — lower payment, cash out, or paying off debt faster?"

---

## 4. Qualify lightly

- "Are you still in the home as your primary residence?"
- "Any major changes since that mailer — new job, credit events, or plans to move?"
- "When were you hoping to do something if the numbers made sense?"

---

## 5. Next step

**If interested:**  
"Perfect — here's what I'd like to do. I'll send you a short application link and a list of basic documents. Can we schedule **15 minutes tomorrow** to review numbers together?"

**If nurture / not ready:**  
"Totally fair. I'll email my contact info and we can reconnect when timing is better. Would **{{follow_up_window}}** be a good time to check back in?"

**If not interested:**  
"No problem at all — I'll note that and won't keep bothering you. If anything changes, you've got our number on the mailer."

---

## 6. Close

"Thanks again, **{{first_name}}**. You'll see an email from me shortly. Talk soon."

---

### Reminders
- Speak to **one person** — use their name and address from the lookup.
- **Offer code** links their call to the exact mail piece.
- Log the call outcome in Shape after you hang up.
`;

export function renderCallScript(template, context) {
  let text = template;
  for (const [key, value] of Object.entries(context)) {
    text = text.replaceAll(`{{${key}}}`, value ?? '—');
  }
  return text;
}
