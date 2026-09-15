-- Records that a call's transcript has been read.
--
-- Without this the local worker had no way to tell "read, nothing found" from
-- "not read yet". It selected calls whose enquiry still had empty cargo fields,
-- so a transcript too garbled to extract anything stayed eligible forever and
-- was re-read every sixty seconds -- burning a GPU pass and republishing the
-- whole knowledge base each time, for no change.
--
-- Null means never attempted. A timestamp means attempted, whatever came back.
alter table public.calls
  add column if not exists extracted_at timestamptz;

comment on column public.calls.extracted_at is
  'When a model last read this transcript. Null = never attempted, not "found nothing".';
