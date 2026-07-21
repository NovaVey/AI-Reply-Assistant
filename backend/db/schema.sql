CREATE TABLE IF NOT EXISTS business_context (
  id SERIAL PRIMARY KEY,
  business_name VARCHAR(255) NOT NULL,
  description TEXT,
  services TEXT,
  tone VARCHAR(100) DEFAULT 'professional',
  sign_off VARCHAR(255),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inquiries (
  id SERIAL PRIMARY KEY,
  sender_name VARCHAR(255),
  sender_email VARCHAR(255),
  subject VARCHAR(500),
  body TEXT NOT NULL,
  category VARCHAR(100) DEFAULT 'general',
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS replies (
  id SERIAL PRIMARY KEY,
  inquiry_id INTEGER REFERENCES inquiries(id) ON DELETE CASCADE,
  draft TEXT NOT NULL,
  edited_draft TEXT,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO business_context (business_name, description, services, tone, sign_off)
VALUES (
  'My Business',
  'A small business serving local customers.',
  'General services',
  'professional',
  'Best regards'
) ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
