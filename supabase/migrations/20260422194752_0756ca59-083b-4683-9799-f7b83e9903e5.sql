
-- Add new visa workflow statuses
ALTER TYPE visa_status ADD VALUE IF NOT EXISTS 'awaiting_documents';
ALTER TYPE visa_status ADD VALUE IF NOT EXISTS 'submitted_to_embassy';
