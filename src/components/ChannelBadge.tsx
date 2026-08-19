import { Phone, Mail, MessageCircle, Globe } from "lucide-react";
import type { Channel } from "../types";

const config: Record<Channel, { icon: React.ElementType; label: string }> = {
  voice: { icon: Phone, label: "Voice" },
  email: { icon: Mail, label: "Email" },
  whatsapp: { icon: MessageCircle, label: "WhatsApp" },
  web_form: { icon: Globe, label: "Web form" },
};

export default function ChannelBadge({ channel }: { channel: Channel }) {
  const { icon: Icon, label } = config[channel];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
      <Icon size={13} />
      {label}
    </span>
  );
}
