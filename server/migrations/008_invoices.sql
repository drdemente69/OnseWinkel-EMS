-- Onse Winkel EMS — Quotation / Invoice system
--
-- One row per quotation or invoice. The SAME structure renders both: the
-- `doc_type` field switches labels (Quote No. vs Invoice No., Valid Until vs
-- Due Date, Total Due vs Amount Due). `mode` chooses how line items are shown:
--   services  → unpriced list (no per-line price), single grand total entered
--   products  → priced rows (qty × unit price = line amount), summed total
--
-- Money is stored in rands as REAL. The template prints VAT-inclusive figures;
-- VAT @ 15% included = grand_total − grand_total / 1.15.

CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  doc_type        TEXT NOT NULL DEFAULT 'quotation',  -- quotation | invoice
  mode            TEXT NOT NULL DEFAULT 'services',    -- services | products
  number          TEXT NOT NULL,
  doc_date        TEXT NOT NULL,                       -- ISO YYYY-MM-DD
  secondary_date  TEXT,                                -- valid-until (quote) / due-date (invoice); optional

  client_name     TEXT,
  client_address  TEXT,                                -- may contain newlines

  -- Optional scope-of-work block (handy for transport jobs)
  scope_description TEXT,
  route_from      TEXT,
  route_from_sub  TEXT,
  route_to        TEXT,
  route_to_sub    TEXT,

  items_heading   TEXT,                                -- column header, e.g. "Services Included"
  items           TEXT NOT NULL DEFAULT '[]',          -- JSON: [{title, description, qty, unitPrice, amount}]

  vat_enabled     INTEGER NOT NULL DEFAULT 1,          -- show the VAT-included line
  subtotal        REAL NOT NULL DEFAULT 0,             -- VAT-inclusive amount
  vat_amount      REAL NOT NULL DEFAULT 0,
  grand_total     REAL NOT NULL DEFAULT 0,

  -- Banking details (self-contained per doc; prefilled from the company default)
  bank_name       TEXT,
  bank_account_name TEXT,
  bank_account_no TEXT,
  bank_branch     TEXT,

  terms           TEXT NOT NULL DEFAULT '[]',          -- JSON array of strings
  thanks_title    TEXT,
  thanks_sub      TEXT,
  notes           TEXT,

  pdf_path        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(doc_type, created_at);
