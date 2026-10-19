import { JSDOM } from "jsdom";

const bookingButtonStyle = "display: inline-block; background-color: #5a7d58; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 14px; font-weight: 600;";

export function ensureBookingCta(bodyHtml: string, bookingLink: string): string {
  const document = new JSDOM(`<body>${bodyHtml}</body>`).window.document;
  const fallback = () => {
    const note = document.createElement("p");
    note.setAttribute("style", "color: #666666; font-size: 12px; line-height: 1.5; word-break: break-all;");
    note.append("If the button does not work, copy and paste this secure link into your browser: ");
    const link = document.createElement("a");
    link.setAttribute("href", bookingLink);
    link.textContent = bookingLink;
    note.append(link);
    return note;
  };
  const bookingAnchor = Array.from(document.querySelectorAll("a[href]")).find(anchor => anchor.getAttribute("href") === bookingLink);

  if (bookingAnchor) {
    bookingAnchor.textContent = "Book your MIAM appointment";
    bookingAnchor.setAttribute("style", bookingButtonStyle);
    const wrapper = document.createElement("div");
    wrapper.setAttribute("style", "text-align: center; margin: 24px 0;");
    bookingAnchor.replaceWith(wrapper);
    wrapper.append(bookingAnchor);
    wrapper.after(fallback());
  } else {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("style", "text-align: center; margin: 24px 0;");
    const anchor = document.createElement("a");
    anchor.setAttribute("href", bookingLink);
    anchor.setAttribute("style", bookingButtonStyle);
    anchor.textContent = "Book your MIAM appointment";
    wrapper.append(anchor);
    document.body.append(wrapper);
    document.body.append(fallback());
  }

  return document.body.innerHTML;
}
