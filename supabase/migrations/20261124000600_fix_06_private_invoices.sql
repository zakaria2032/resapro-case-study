-- Correctif #6 — Factures privées.
-- Avant : bucket public (fichiers accessibles par simple URL) et lecture autorisée à tous.
-- Après : bucket privé ; chaque client lit uniquement son dossier « <id_client>/… » ; l'admin lit tout.
-- Le front utilise des liens signés à durée courte (60 s).

update storage.buckets set public = false where id = 'invoices';

drop policy "Invoices are accessible" on storage.objects;

create policy "Clients read their own invoices"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'invoices'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
