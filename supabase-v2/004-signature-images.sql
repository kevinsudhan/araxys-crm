-- Storage policies for signature images.
--
-- Images in an email signature have to be fetched by the recipient's mail
-- client, which is not signed into anything -- so the bucket is public to read.
-- A data: URI would avoid that, but Gmail and Outlook both strip those, so the
-- signature would look right here and be broken everywhere it was actually sent.
--
-- Writes are restricted to the owner's own folder. Each user uploads under
-- their own uuid, so nobody can overwrite another person's logo, and a file
-- cannot be planted in someone else's signature path.

drop policy if exists "signature images are publicly readable" on storage.objects;
create policy "signature images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'signatures');

drop policy if exists "users upload their own signature images" on storage.objects;
create policy "users upload their own signature images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users replace their own signature images" on storage.objects;
create policy "users replace their own signature images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete their own signature images" on storage.objects;
create policy "users delete their own signature images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = auth.uid()::text);
