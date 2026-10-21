/** brackets that mark the suggestion a message discusses, on the message's first line */
const opening = '〔';
const closing = '〕';

/**
 * prefixes a message with the suggestion it discusses, so the assistant reads which suggestion the
 * question is about and the thread can show it above the question
 * @param context the suggestion, such as 討論建議 · 年代：宋至元風格（待查證）
 * @param text what the collector wrote
 * @returns the message body
 */
export function withDiscussContext(context: string, text: string): string {
  const label = context.replaceAll(opening, '').replaceAll(closing, '');

  return text
    ? `${opening}${label}${closing}\n${text}`
    : `${opening}${label}${closing}`;
}

/**
 * separates the suggestion a message discusses from what the collector wrote
 * @param body the message body
 * @returns the suggestion, if the message names one, and the rest of the message
 */
export function splitDiscussContext(body: string): {
  context?: string;
  text: string;
} {
  if (!body.startsWith(opening)) {
    return { text: body };
  }
  const end = body.indexOf(closing);
  if (end < 0) {
    return { text: body };
  }

  return {
    context: body.slice(opening.length, end),
    text: body.slice(end + closing.length).trimStart(),
  };
}
