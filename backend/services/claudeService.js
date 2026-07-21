// Wraps the Anthropic Claude API to draft customer reply emails using the
// business's own context (name, description, services, tone, sign-off).
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Build the system prompt that grounds Claude in this specific business's
 * context and instructs it how to write the reply.
 */
function buildSystemPrompt(businessContext) {
  const {
    business_name: businessName,
    description,
    services,
    tone,
    sign_off: signOff,
  } = businessContext;

  return `You are a customer-reply assistant for ${businessName}, a small business.

Business description: ${description || 'Not provided.'}
Services offered: ${services || 'Not provided.'}
Preferred tone: ${tone || 'professional'}
Sign-off to use: ${signOff || 'Best regards'}

Your job is to draft a reply to the customer inquiry provided by the user.

Rules you must follow:
- Write a reply that is 3 to 5 paragraphs long.
- Match the preferred tone described above (${tone || 'professional'}).
- Never invent specific facts, prices, dates, or policies that were not given to you above or in the inquiry.
- If you need to reference a specific detail you were not given (such as an exact price, date, or policy), use the literal token "[placeholder]" (with square brackets) instead of making one up.
- End the reply with the business's sign-off: "${signOff || 'Best regards'}".
- Do not include a subject line. Write only the body of the reply.`;
}

/**
 * Build the user-turn prompt that presents the inquiry details to Claude.
 */
function buildUserPrompt(inquiry) {
  const {
    sender_name: senderName,
    sender_email: senderEmail,
    subject,
    category,
    body,
  } = inquiry;

  return `A customer has submitted the following inquiry. Draft a reply.

Sender name: ${senderName || 'Not provided'}
Sender email: ${senderEmail || 'Not provided'}
Subject: ${subject || '(no subject)'}
Category: ${category || 'general'}

Message:
${body}`;
}

/**
 * Ask Claude to draft a reply to a customer inquiry, grounded in the
 * business's own context.
 *
 * @param {object} inquiry - inquiry row (sender_name, sender_email, subject, category, body, ...)
 * @param {object} businessContext - business_context row (business_name, description, services, tone, sign_off, ...)
 * @returns {Promise<string>} the drafted reply text
 */
async function draftReply(inquiry, businessContext) {
  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    system: buildSystemPrompt(businessContext),
    messages: [{ role: 'user', content: buildUserPrompt(inquiry) }],
  });

  return response.content[0].text;
}

module.exports = { draftReply };
