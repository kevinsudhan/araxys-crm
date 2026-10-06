-- ---------------------------------------------------------------------------
-- 136: What the database's performance advisor flagged (6 Oct).
--
-- Small, for tables that are small today, done before they are not:
--
--   * an index under every foreign key that had none, so a delete of the row
--     it points at, and a join on it, does not read the whole table;
--   * a policy that asked auth.uid() for every row asks it once a query
--     (`(select auth.uid())`, Postgres's initplan);
--   * a table whose "for all" write policy also applied to reads, beside its
--     own read policy, so every read checked both: the write policies are
--     for writing only.
-- ---------------------------------------------------------------------------

create index if not exists outlook_links_user_idx            on private.outlook_links (user_id);
create index if not exists outlook_pending_session_idx       on private.outlook_pending (session_id);
create index if not exists outlook_pending_user_idx          on private.outlook_pending (user_id);
create index if not exists arrival_notice_sends_sent_by_idx  on public.arrival_notice_sends (sent_by);
create index if not exists company_registrations_created_idx on public.company_registrations (created_by);
create index if not exists company_registrations_updated_idx on public.company_registrations (updated_by);
create index if not exists customer_dsr_sends_sent_by_idx    on public.customer_dsr_sends (sent_by);
create index if not exists enquiry_buy_rates_created_idx     on public.enquiry_buy_rates (created_by);
create index if not exists enquiry_buy_rates_updated_idx     on public.enquiry_buy_rates (updated_by);
create index if not exists shipment_dsr_notes_updated_idx    on public.shipment_dsr_notes (updated_by);
create index if not exists shipments_dg_accepted_by_idx      on public.shipments (dg_accepted_by);

-- ---- auth.uid() once a query ----
drop policy if exists customer_dsr_sends_add on public.customer_dsr_sends;
create policy customer_dsr_sends_add on public.customer_dsr_sends
  for insert to authenticated with check (sent_by = (select auth.uid()));

-- ---- the company's registrations: everybody reads; an administrator writes (132) ----
drop policy if exists company_registrations_admin on public.company_registrations;
drop policy if exists company_registrations_insert on public.company_registrations;
drop policy if exists company_registrations_update on public.company_registrations;
drop policy if exists company_registrations_delete on public.company_registrations;
create policy company_registrations_insert on public.company_registrations
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create policy company_registrations_update on public.company_registrations
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create policy company_registrations_delete on public.company_registrations
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

-- ---- the workflow's steps and templates: the write policies for writing (059) ----
drop policy if exists shipment_checkpoints_write on public.shipment_checkpoints;
drop policy if exists shipment_checkpoints_insert on public.shipment_checkpoints;
drop policy if exists shipment_checkpoints_update on public.shipment_checkpoints;
drop policy if exists shipment_checkpoints_delete on public.shipment_checkpoints;
create policy shipment_checkpoints_insert on public.shipment_checkpoints for insert to authenticated with check (true);
create policy shipment_checkpoints_update on public.shipment_checkpoints for update to authenticated using (true) with check (true);
create policy shipment_checkpoints_delete on public.shipment_checkpoints for delete to authenticated using (true);

drop policy if exists checkpoint_templates_write on public.checkpoint_templates;
drop policy if exists checkpoint_templates_insert on public.checkpoint_templates;
drop policy if exists checkpoint_templates_update on public.checkpoint_templates;
drop policy if exists checkpoint_templates_delete on public.checkpoint_templates;
create policy checkpoint_templates_insert on public.checkpoint_templates for insert to authenticated with check (true);
create policy checkpoint_templates_update on public.checkpoint_templates for update to authenticated using (true) with check (true);
create policy checkpoint_templates_delete on public.checkpoint_templates for delete to authenticated using (true);
