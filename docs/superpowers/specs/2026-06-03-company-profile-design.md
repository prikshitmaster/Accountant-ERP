# Company Profile + Bank Details Design

**Date:** 2026-06-03  
**Status:** Approved — ready for implementation

---

## Problem

`org_settings` holds only `business_name`, `owner_name`, `gstin`, `state_code`, `negative_stock_policy`. The Settings UI only lets you edit `negative_stock_policy`. Nothing else is editable, and none of the company identity appears on the printed Tax Invoice (address, phone, bank details are missing).

---

## Architecture: Single Source of Truth

All org details live in `org_settings` → flow into `v_invoice_detail` → available to every future feature automatically (purchase bill print, delivery challan, GSTR exports, etc). Zero extra queries needed in future features.

---

## Scope

### In scope
- DB migration `0014`: Add 11 new columns to `org_settings`; refresh `v_invoice_detail` with all org fields
- `src/hooks/queries.ts`: Add `useOrgSettings` hook; add new org fields to `InvoiceDetail` type
- `src/features/settings/SettingsPage.tsx`: Add "Company Profile" and "Bank Details" sections
- `src/features/sales/InvoicePrint.tsx`: Show address/phone/email in header; bank + UPI in footer

### Out of scope
- Logo upload (requires file storage)
- PAN/TAN/CIN display on invoice (not standard on B2B invoices)
- Onboarding flow changes

---

## DB Changes (`0014_company_profile.sql`)

### New columns on `org_settings`

```sql
alter table org_settings
  add column if not exists phone        text,
  add column if not exists email        text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city         text,
  add column if not exists pincode      text,
  add column if not exists pan_no       text,
  add column if not exists bank_name    text,
  add column if not exists bank_account_no text,
  add column if not exists bank_ifsc    text,
  add column if not exists upi          text;
```

### Refreshed `v_invoice_detail` view

Add 11 new columns sourced from `os` (the `org_settings` LEFT JOIN already in the view):
```sql
os.phone          as org_phone,
os.email          as org_email,
os.address_line1  as org_address_line1,
os.address_line2  as org_address_line2,
os.city           as org_city,
os.pincode        as org_pincode,
os.pan_no         as org_pan_no,
os.bank_name      as org_bank_name,
os.bank_account_no as org_bank_account_no,
os.bank_ifsc      as org_bank_ifsc,
os.upi            as org_upi
```

---

## Frontend

### `useOrgSettings` hook (`src/hooks/queries.ts`)

```ts
export type OrgSettings = {
  org_id: string
  business_name: string | null
  gstin: string | null
  state_code: string | null
  pan_no: string | null
  phone: string | null
  email: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  pincode: string | null
  bank_name: string | null
  bank_account_no: string | null
  bank_ifsc: string | null
  upi: string | null
  negative_stock_policy: string
}

export function useOrgSettings(orgId: string | null) { ... }
```

Queries `org_settings` directly (SELECT *). `enabled: !!orgId`.

### `InvoiceDetail` type — 11 new fields

```ts
org_phone: string | null
org_email: string | null
org_address_line1: string | null
org_address_line2: string | null
org_city: string | null
org_pincode: string | null
org_pan_no: string | null
org_bank_name: string | null
org_bank_account_no: string | null
org_bank_ifsc: string | null
org_upi: string | null
```

### `SettingsPage.tsx` — two new sections

**Company Profile card** (above existing Negative Stock card):
- Business Name (text)
- GSTIN (text, 15 chars)
- State Code (text, 2 chars)
- PAN No (text)
- Phone (text)
- Email (text)
- Address Line 1 (text)
- Address Line 2 (text, optional)
- City (text)
- Pincode (text)

**Bank Details card** (below Company Profile):
- Bank Name
- Account No
- IFSC Code
- UPI

Both save via `supabase.from('org_settings').update(...).eq('org_id', currentOrgId)` — same pattern as the existing negative stock save. Loads on mount from `useOrgSettings`.

### `InvoicePrint.tsx` — enriched layout

**Header (supplier block):**
```
{org_name}
GSTIN: {org_gstin}   State: {org_state_code}   PAN: {org_pan_no}
{org_address_line1}
{org_address_line2}
{org_city} - {org_pincode}
Ph: {org_phone}   E: {org_email}
```

**Footer — new "Payment Details" row:**
```
Pay to: {org_bank_name}  |  A/c: {org_bank_account_no}  |  IFSC: {org_bank_ifsc}
UPI: {org_upi}
```

All fields are optional — show only if truthy.
