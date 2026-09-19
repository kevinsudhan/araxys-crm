import { Phone, Mail, MessageCircle, Globe } from "lucide-react";
import type { Channel } from "../types";

/**
 * How the customer reached us.
 *
 * Worth more weight than it had. On this desk the channel changes what you can
 * trust about a record: a voice enquiry was transcribed and extracted by a model
 * and may have misheard a number, while a web form was typed by the customer
 * themselves. Setting it in the same flat grey as every other caption buried
 * that, so it now reads as a labelled chip rather than a footnote.
 *
 * Still deliberately quiet — it is context, not status. The tinting stays on
 * StatusPill, which is the thing a person is scanning for.
 */
const config: Record<Channel, { icon: React.ElementType; label: string }> = {
  voice: { icon: Phone, label: "Voice" },
  email: { icon: Mail, label: "Email" },
  whatsapp: { icon: MessageCircle, label: "WhatsApp" },
  web_form: { icon: Globe, label: "Web form" },
};

export default function ChannelBadge({ channel }: { channel: Channel }) {
  const { icon: Icon, label } = config[channel];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 border border-border px-1.5 py-[2px] text-[11px] font-medium text-text-secondary whitespace-nowrap">
      <Icon size={12} strokeWidth={2} className="text-text-muted flex-none" />
      {label}
    </span>
  );
}
