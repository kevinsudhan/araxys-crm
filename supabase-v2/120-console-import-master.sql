-- 120: An import console's master B/L, from the copy received to the box destuffed.
--
-- ---------------------------------------------------------------------------
-- On an import console Aashish is the consignee of the line's master B/L and
-- the consol agent who files the CSN (097). Before any house B/L can be
-- delivered, the master has to be cleared with the line, and the console kept
-- no record of it. Each step is a dated fact on the console:
--
--   mbl_copy / mbl_copy_at            The master as received from the origin
--                                     agent, read (HblData) and checked.
--   mbl_release / mbl_originals       (119) How the master is released.
--   release_in_hand_at / _ref         The release in our hands: the originals
--                                     received (the courier's airway bill),
--                                     the telex release confirmed (its
--                                     number), the eBL transferred to us; a
--                                     sea waybill needs none.
--   line_invoice_no / line_charges_inr / line_paid_at
--                                     The line's charges at this end, and
--                                     when they were paid. The bill itself
--                                     belongs in Accounts (bills.console_id).
--   line_do_no / line_do_at / line_do_valid_till
--                                     The line's delivery order for the box,
--                                     collected, and until when it is good.
--   cfs_name / cfs_nominated_at / cfs_nominated_to
--                                     The CFS the box is nominated to for
--                                     destuffing, and the letter to the line.
--   destuffed_on                      The box opened at the CFS: the houses
--                                     can be delivered from then.
--
-- A house B/L's delivery order (088's release checklist) waits for the line's
-- DO and the destuffing on its console.
-- ---------------------------------------------------------------------------

alter table public.consoles add column if not exists mbl_copy jsonb;
alter table public.consoles add column if not exists mbl_copy_at timestamptz;
alter table public.consoles add column if not exists release_in_hand_at timestamptz;
alter table public.consoles add column if not exists release_in_hand_ref text not null default '';
alter table public.consoles add column if not exists line_invoice_no text not null default '';
alter table public.consoles add column if not exists line_charges_inr numeric;
alter table public.consoles drop constraint if exists consoles_line_charges_check;
alter table public.consoles add constraint consoles_line_charges_check check (line_charges_inr is null or line_charges_inr >= 0);
alter table public.consoles add column if not exists line_paid_at timestamptz;
alter table public.consoles add column if not exists line_do_no text not null default '';
alter table public.consoles add column if not exists line_do_at timestamptz;
alter table public.consoles add column if not exists line_do_valid_till date;
alter table public.consoles add column if not exists cfs_name text not null default '';
alter table public.consoles add column if not exists cfs_nominated_at timestamptz;
alter table public.consoles add column if not exists cfs_nominated_to text not null default '';
alter table public.consoles add column if not exists destuffed_on date;

notify pgrst, 'reload schema';
