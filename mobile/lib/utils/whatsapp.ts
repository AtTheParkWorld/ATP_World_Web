/**
 * ATP's WhatsApp line — the admin / founder number the website footer and
 * Contact page already publish (+971 58 579 2378). One constant for the
 * whole app: the floating bubble and Help → "WhatsApp us" both read it.
 */
export const ATP_WHATSAPP_NUMBER = '971585792378';

/** Text the chat opens with, so the member only has to finish the sentence. */
export const ATP_WHATSAPP_GREETING = 'Hi ATP! ';

/** wa.me link — opens the WhatsApp app when installed, the web chat
 *  otherwise. A plain https link needs no native config (no
 *  LSApplicationQueriesSchemes / <queries> entry). */
export function atpWhatsAppUrl(text: string = ATP_WHATSAPP_GREETING): string {
  return `https://wa.me/${ATP_WHATSAPP_NUMBER}` + (text ? `?text=${encodeURIComponent(text)}` : '');
}
