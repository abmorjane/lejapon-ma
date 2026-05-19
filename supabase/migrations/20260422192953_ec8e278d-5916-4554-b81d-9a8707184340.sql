-- Add new status to track when admin has acknowledged document receipt
ALTER TYPE public.visa_status ADD VALUE IF NOT EXISTS 'documents_received' BEFORE 'in_review';

-- Allow users to upload additional documents to their applications
-- regardless of status (draft, submitted, in_review, etc.) — but never delete after submission
DROP POLICY IF EXISTS "users insert own visa_documents" ON public.visa_documents;
CREATE POLICY "users insert own visa_documents"
ON public.visa_documents
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.visa_applications a
    WHERE a.id = visa_documents.application_id
      AND a.user_id = auth.uid()
      AND a.status <> 'completed'
      AND a.status <> 'rejected'
  )
);