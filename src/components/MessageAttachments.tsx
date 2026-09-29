import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowDownToLine, Check, Download, Loader2, Paperclip, Save } from "lucide-react";
import { getMailAttachment, type MailMessage } from "../services/backend";
import { base64ToBytes } from "../lib/base64";
import { canView, downloadBytes, type ViewerFile } from "../lib/attachmentFiles";

/** Loaded when an attachment is first opened: it brings PDF.js with it. */
const AttachmentViewer = lazy(() => import("./AttachmentViewer"));
import { fileMailAttachment, fileUrl, listFiles } from "../services/attachments";
import { failureText } from "../lib/errorText";
import { useLiveVersion } from "../lib/liveVersions";

/**
 * The files that arrived on a message, and what can be done with them.
 *
 * ---------------------------------------------------------------------------
 * WHY SAVING ONTO THE ENQUIRY IS THE POINT
 *
 * A Graph attachment can only be fetched by a token for the mailbox holding
 * the message. So the shipper's MSDS, sitting on a mail in one person's inbox,
 * belongs to that person: nobody else on the desk can open it, it goes with
 * them when they leave, and the standard way to get it is to ask the customer
 * to send it again.
 *
 * Saving copies the bytes into the CRM's own bucket against the enquiry. After
 * that the file is the job's rather than the mailbox's, and it can be attached
 * to the mail going out to the consol agent without anybody going back through
 * the thread to download it first.
 *
 * WHY SAVED FILES ARE MARKED
 *
 * Nothing on a message says whether its attachment was already filed, so
 * without this somebody either saves it again on every visit or leaves it
 * unsaved on the assumption that a colleague did. The check is by message and
 * filename, matching the unique index in 049.
 * ---------------------------------------------------------------------------
 */
export default function MessageAttachments({
  message,
  enquiryRef,
  onFiled,
}: {
  message: MailMessage;
  /** Enables saving. Absent where there is no single case to file onto. */
  enquiryRef?: string | null;
  onFiled?: () => void;
}) {
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The attachment open in the viewer, inside the app (a PDF, a picture or
   * text). It used to open a new tab, which in the installed app meant leaving
   * it — and on an iPhone, a blank Safari page.
   */
  const [viewing, setViewing] = useState<{ id?: string; name: string } | null>(null);
  // A colleague saving one of these to the job shows here as saved (084).
  const filedElsewhere = useLiveVersion("enquiry_files");

  useEffect(() => {
    if (!enquiryRef || !message.attachments.length) return;
    let live = true;
    void listFiles(enquiryRef)
      .then((files) => {
        if (!live) return;
        setSaved(
          new Set(files.filter((f) => f.message_id === message.id).map((f) => f.name))
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enquiryRef, message.id, message.attachments.length, filedElsewhere]);

  if (!message.attachments.length) return null;

  async function save(a: { id?: string; name: string }) {
    if (!enquiryRef || !a.id) return;
    setBusy(a.name);
    setError(null);
    try {
      // null means it was already filed — the unique index caught it. Not an
      // error: the file is where it should be, which is what was wanted.
      await fileMailAttachment({
        enquiryRef,
        messageId: message.id,
        attachmentId: a.id,
        subject: message.subject,
      });
      setSaved((prev) => new Set(prev).add(a.name));
      onFiled?.();
    } catch (e) {
      setError(failureText(e, `Could not save ${a.name}.`).message);
    } finally {
      setBusy(null);
    }
  }

  /** The file's bytes, from the mailbox. */
  async function fetchFile(a: { id?: string; name: string }): Promise<ViewerFile> {
    if (!a.id) throw new Error(`${a.name} cannot be fetched.`);
    const got = await getMailAttachment(message.id, a.id);
    return { name: got.name || a.name, contentType: got.contentType || "application/octet-stream", bytes: base64ToBytes(got.contentBytes) };
  }

  /** Saves the file to this device. */
  async function download(a: { id?: string; name: string }) {
    if (!a.id) return;
    setBusy(a.name);
    setError(null);
    try {
      downloadBytes(await fetchFile(a));
    } catch (e) {
      setError(failureText(e, `Could not download ${a.name}.`).message);
    } finally {
      setBusy(null);
    }
  }

  async function open(a: { id?: string; name: string }) {
    if (!enquiryRef || !a.id) return;
    setBusy(a.name);
    setError(null);
    try {
      // Read through the CRM's copy rather than Graph: a signed url opens in a
      // tab, whereas Graph's bytes would have to become a blob url here.
      const files = await listFiles(enquiryRef);
      const f = files.find((x) => x.message_id === message.id && x.name === a.name);
      if (!f) return;
      window.open(await fileUrl(f.path), "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(failureText(e, `Could not open ${a.name}.`).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        {message.attachments.length} attachment{message.attachments.length > 1 ? "s" : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {message.attachments.map((a) => {
          const isSaved = saved.has(a.name);
          return (
            <span
              key={a.name}
              className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 py-1.5 pl-2.5 pr-1.5 text-[12px] text-text-secondary"
            >
              <Paperclip size={11} className="shrink-0 opacity-70" />
              {/* The name opens it inside the app — a PDF, a picture or text, as
                  Outlook previews it; anything else downloads. */}
              {a.id ? (
                <button
                  type="button"
                  onClick={() => (canView(a) ? setViewing(a) : void download(a))}
                  title={canView(a) ? `Open ${a.name}` : `Download ${a.name}`}
                  className="max-w-[240px] truncate text-left text-text-primary hover:underline"
                >
                  {a.name}
                </button>
              ) : (
                <span className="max-w-[240px] truncate" title={a.name}>
                  {a.name}
                </span>
              )}
              <span className="tabular-nums text-text-muted">{Math.round(a.size / 1024)} KB</span>

              {a.id && busy !== a.name && (
                <button
                  type="button"
                  onClick={() => void download(a)}
                  title="Download"
                  aria-label={`Download ${a.name}`}
                  className="rounded p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
                >
                  <ArrowDownToLine size={12} />
                </button>
              )}
              {!enquiryRef && busy === a.name && <Loader2 size={12} className="mx-1 animate-spin text-text-muted" />}

              {enquiryRef && a.id && (
                <>
                  {busy === a.name ? (
                    <Loader2 size={12} className="mx-1 animate-spin text-text-muted" />
                  ) : isSaved ? (
                    <>
                      <span
                        className="ml-0.5 inline-flex items-center gap-1 rounded px-1 text-[11px] text-text-success"
                        title={`Filed on ${enquiryRef}`}
                      >
                        <Check size={11} /> Filed
                      </span>
                      <button
                        type="button"
                        onClick={() => void open(a)}
                        title="Open the filed copy"
                        aria-label={`Open ${a.name}`}
                        className="rounded p-1 text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
                      >
                        <Download size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void save(a)}
                      title={`Save to ${enquiryRef}`}
                      className="ml-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary"
                    >
                      <Save size={11} /> Save
                    </button>
                  )}
                </>
              )}
            </span>
          );
        })}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-text-danger">{error}</p>}

      {viewing && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[60] grid place-items-center bg-[#1c2230]/95">
              <Loader2 size={20} className="animate-spin text-white/70" />
            </div>
          }
        >
          <AttachmentViewer name={viewing.name} load={() => fetchFile(viewing)} onClose={() => setViewing(null)} />
        </Suspense>
      )}
    </div>
  );
}
