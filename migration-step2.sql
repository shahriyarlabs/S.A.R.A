-- যদি আগে ধাপ ১-এর টেবিল বানানো থাকে, তবে sara-db Console-এ এটি রান করুন:
ALTER TABLE tasks ADD COLUMN reminded_at TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, due_date);
