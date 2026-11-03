-- The email address is no longer stored at all, not even encrypted. Accounts keep only email_bidx, a keyed
-- HMAC-SHA256 fingerprint. Recovery and re-verification take the address the user types, fingerprint it,
-- look the account up, and send mail to the typed address.
ALTER TABLE users DROP COLUMN email_enc;
