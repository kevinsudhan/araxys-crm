import { Play } from "lucide-react";

/**
 * Starts the scripted run, then gets out of the way.
 *
 * Bottom-left on purpose. Bottom-right is where a page puts things that matter — chat
 * widgets, save buttons, toasts — and this is the one control that must not be in the
 * recording. It disappears the moment it is pressed, and the script does not begin for
 * another five seconds, which is the window to start the capture and let the cursor
 * leave the frame.
 */
export default function DemoPlayButton({ onStart }: { onStart: () => void }) {
  return (
    <button
      onClick={onStart}
      title="Play the scripted run"
      aria-label="Play the scripted run"
      className="fixed left-4 bottom-4 z-40 grid place-items-center w-9 h-9 rounded-full
                 border border-border bg-surface-1/80 text-text-muted backdrop-blur
                 shadow-[0_1px_3px_rgba(20,23,28,0.10)]
                 hover:text-text-primary hover:border-border-strong hover:bg-surface-1
                 transition-colors duration-150"
    >
      <Play size={13} className="translate-x-[1px]" fill="currentColor" />
    </button>
  );
}
